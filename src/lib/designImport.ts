// Import design in the renderer: an SVG (a file, a drop or the clipboard, as Figma's Copy as SVG puts it there) or a
// picture, as design elements. The SVG is converted by shared/svgImport.ts; here its pictures are stored in the media
// folder, missing fonts fall back to the Default Font with a warning, and a PNG with transparency gets 9 slice insets
// found from its corners, so a rounded bar stretches without bending them.

import { imageElement } from '../../shared/designs'
import { importSvg, type ImportAsset } from '../../shared/svgImport'
import type { DesignElement, DesignInsets, ThemeBox } from '../../shared/types'
import { isFontAvailable } from './fonts'

export interface DesignImport {
  elements: DesignElement[]
  warnings: string[]
}

/** The files Import design takes, for a file picker's accept. */
export const IMPORT_ACCEPT = '.svg,image/svg+xml,.png,image/png,.jpg,.jpeg,image/jpeg,.webp,image/webp'

const PICTURE_TYPES: Record<string, ImportAsset['extension']> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

const isSvg = (file: File) => file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')

/** Whether a file is one Import design can read. */
export const canImport = (file: File) => isSvg(file) || file.type in PICTURE_TYPES

/** Whether pasted text is an SVG, as Figma's Copy as SVG gives. */
export const isSvgText = (text: string) => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text)

const fromBase64 = (data: string) => Uint8Array.from(atob(data), (c) => c.charCodeAt(0))

/** Converts SVG text, storing its pictures and checking its fonts. */
export async function importSvgText(text: string): Promise<DesignImport> {
  const result = importSvg(text)
  const urls = await Promise.all(
    result.assets.map((asset) =>
      window.api.designs.saveAsset(asset.extension === 'svg' ? new TextEncoder().encode(asset.data) : fromBase64(asset.data), asset.extension),
    ),
  )
  const warnings = [...result.warnings]
  const missing = result.fonts.filter((family) => !isFontAvailable(family))
  for (const family of missing) warnings.push(`The font “${family}” is not installed, so that text uses the Default Font. Import the font in Settings, Fonts, to use it.`)
  const elements = result.elements.map((e): DesignElement => {
    if (e.kind === 'image' && e.src?.startsWith('asset:')) return { ...e, src: urls[Number(e.src.slice(6))] ?? null }
    if (e.kind === 'text' && missing.includes(e.fontFamily)) return { ...e, fontFamily: '' }
    return e
  })
  return { elements, warnings }
}

/** The picture's pixels, to read its transparency. */
async function pixels(blob: Blob): Promise<ImageData | null> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/**
 * 9 slice insets for a picture with transparent corners, in percent of the picture: each corner's rounding, found by
 * walking in from the corner along the diagonal until the picture is solid. Null for a picture with no transparency.
 */
export function sliceInsets(image: { width: number; height: number; data: Uint8ClampedArray }): DesignInsets | null {
  const { width, height, data } = image
  const alpha = (x: number, y: number) => data[(y * width + x) * 4 + 3]
  let transparent = false
  for (let i = 3; i < data.length; i += 4 * 7) if (data[i] < 250) transparent = true
  if (!transparent) return null
  // How far in each corner is before the picture is solid.
  const corner = (sx: 1 | -1, sy: 1 | -1) => {
    const x0 = sx > 0 ? 0 : width - 1
    const y0 = sy > 0 ? 0 : height - 1
    const limit = Math.min(width, height) / 2
    for (let d = 0; d < limit; d++) if (alpha(x0 + sx * d, y0 + sy * d) > 200) return d
    return limit
  }
  const [tl, tr, bl, br] = [corner(1, 1), corner(-1, 1), corner(1, -1), corner(-1, -1)]
  // The diagonal reaches a round corner's edge at about 0.29 of its radius; a little more keeps the whole curve.
  const radius = (d: number) => d / (1 - Math.SQRT1_2) + 2
  const side = (a: number, b: number, size: number) => {
    const px = Math.max(radius(a), radius(b), size * 0.08)
    return Math.round(Math.min(45, (px / size) * 100) * 10) / 10
  }
  return { top: side(tl, tr, height), right: side(tr, br, width), bottom: side(bl, br, height), left: side(tl, bl, width) }
}

/** A picture's box at 1080p size: a 16:9 one fills the screen; another sits in from the left, above the bottom. */
function pictureBox(width: number, height: number): ThemeBox {
  if (Math.abs(width / height - 16 / 9) < 0.02 && width >= 1280) return { x: 0, y: 0, width: 100, height: 100 }
  const scale = Math.min(1, (1920 * 0.9) / width, (1080 * 0.9) / height)
  const w = ((width * scale) / 1920) * 100
  const h = ((height * scale) / 1080) * 100
  return { x: 5, y: 90 - h, width: w, height: h }
}

/** A picture as an image element; a PNG (or WebP) with transparency gets 9 slice insets. */
export async function importPicture(file: Blob, name: string): Promise<DesignImport> {
  const extension = PICTURE_TYPES[file.type]
  if (!extension) throw new Error('Import design takes SVG, PNG, JPEG and WebP files.')
  const image = await pixels(file)
  if (!image) throw new Error('The picture could not be read.')
  const url = await window.api.designs.saveAsset(new Uint8Array(await file.arrayBuffer()), extension)
  const slice = extension === 'png' || extension === 'webp' ? sliceInsets(image) : null
  const layer = name.replace(/\.[^.]+$/, '').slice(0, 100) || 'Picture'
  const element = imageElement(crypto.randomUUID().slice(0, 8), layer, pictureBox(image.width, image.height), { src: url, fit: 'cover', slice })
  return { elements: [element], warnings: slice ? [`“${layer}” has transparent corners, so it stretches as 9 slice: drag the guides to change which parts stretch.`] : [] }
}

/** A file from the picker, a drop or the clipboard. */
export async function importDesignFile(file: File): Promise<DesignImport> {
  if (isSvg(file)) return importSvgText(await file.text())
  return importPicture(file, file.name)
}

/**
 * The import for what a paste or a drop holds, a picture or SVG text, or null when it holds neither. Read at once,
 * since the clipboard's contents are gone once the event is over; the import itself runs when called.
 */
export function importFromTransfer(data: DataTransfer | null): (() => Promise<DesignImport>) | null {
  if (!data) return null
  const file = [...data.files].find(canImport)
  if (file) return () => importDesignFile(file)
  const text = data.getData('text/plain') || data.getData('image/svg+xml')
  if (text && isSvgText(text)) return () => importSvgText(text)
  return null
}

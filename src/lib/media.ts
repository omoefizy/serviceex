// The legacy build carries polyfills: the modern one needs JavaScript newer than Electron's Chromium has.
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { MediaItem } from '../../shared/types'

GlobalWorkerOptions.workerSrc = workerUrl

/** Drag-and-drop type for a library item; the data is its id. */
export const MEDIA_DRAG_TYPE = 'application/x-worshipdeck-media'

/** Filters by name or tag. */
export function matchesSearch(item: MediaItem, search: string): boolean {
  const q = search.trim().toLowerCase()
  return !q || item.name.toLowerCase().includes(q) || item.tags.some((tag) => tag.toLowerCase().includes(q))
}

const THUMB_WIDTH = 320
/** Presentation slides are drawn this size, a 1080p screen. */
const SLIDE_WIDTH = 1920
const SLIDE_HEIGHT = 1080
export const MAX_PDF_PAGES = 500

function canvasBytes(canvas: HTMLCanvasElement, type: 'image/jpeg' | 'image/png'): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject) : reject(new Error('Could not encode image'))),
      type,
      0.82,
    ),
  )
}

function once(target: EventTarget, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    target.addEventListener(event, () => resolve(), { once: true })
    target.addEventListener('error', () => reject(new Error('Could not load media')), { once: true })
  })
}

/** Draws a small JPEG of an image, or of a frame a little into a video (the poster frame). */
async function drawThumbnail(item: MediaItem): Promise<Uint8Array> {
  let source: HTMLImageElement | HTMLVideoElement
  let width: number
  let height: number
  if (item.kind === 'image') {
    const image = new Image()
    // wd-media:// answers with CORS headers; without crossOrigin the canvas could not be exported.
    image.crossOrigin = 'anonymous'
    image.src = item.url
    await image.decode()
    ;[source, width, height] = [image, image.naturalWidth, image.naturalHeight]
  } else {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.preload = 'auto'
    video.src = item.url
    await once(video, 'loadeddata')
    // Skip a likely black first frame.
    video.currentTime = Math.min(1, (video.duration || 0) / 10)
    await once(video, 'seeked')
    ;[source, width, height] = [video, video.videoWidth, video.videoHeight]
  }
  const canvas = document.createElement('canvas')
  canvas.width = THUMB_WIDTH
  canvas.height = Math.max(1, Math.round((THUMB_WIDTH * height) / Math.max(1, width)))
  canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvasBytes(canvas, 'image/jpeg')
}

/** Items whose thumbnail is being made, so two views of the library do not make it twice. */
const inProgress = new Set<number>()

/** Makes and stores thumbnails for items that lack one, one at a time; calls back with each updated item. */
export async function ensureThumbnails(items: MediaItem[], onUpdate: (item: MediaItem) => void): Promise<void> {
  for (const item of items.filter((i) => !i.thumbUrl && !inProgress.has(i.id))) {
    inProgress.add(item.id)
    try {
      const updated = await window.api.media.saveThumbnail(item.id, await drawThumbnail(item))
      if (updated) onUpdate(updated)
    } catch (err) {
      // The grid falls back to the file itself or a placeholder.
      console.error(`No thumbnail for ${item.name}`, err)
    } finally {
      inProgress.delete(item.id)
    }
  }
}

/** A black 1920x1080 slide to draw on. */
function slideCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = SLIDE_WIDTH
  canvas.height = SLIDE_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is not available')
  context.fillStyle = '#000000'
  context.fillRect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT)
  return [canvas, context]
}

/** Where a picture of this shape sits on the slide: scaled to fit, centred. */
function fitBox(width: number, height: number) {
  const scale = Math.min(SLIDE_WIDTH / width, SLIDE_HEIGHT / height)
  const w = Math.round(width * scale)
  const h = Math.round(height * scale)
  return { x: Math.round((SLIDE_WIDTH - w) / 2), y: Math.round((SLIDE_HEIGHT - h) / 2), w, h, scale }
}

/**
 * Draws each page of a PDF fitted onto a black 1920x1080 slide and calls back with its PNG and text, in order.
 */
export async function drawPdfSlides(
  data: Uint8Array,
  onPage: (index: number, total: number, png: Uint8Array, text: string) => void,
): Promise<void> {
  const task = getDocument({ data })
  try {
    const pdf = await task.promise
    if (pdf.numPages > MAX_PDF_PAGES) throw new Error(`The PDF has ${pdf.numPages} pages; the limit is ${MAX_PDF_PAGES}`)
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const box = fitBox(base.width, base.height)
      const viewport = page.getViewport({ scale: box.scale, offsetX: box.x, offsetY: box.y })
      const [canvas, context] = slideCanvas()
      // Pages without a background are transparent; slides need white paper behind them.
      context.fillStyle = '#ffffff'
      context.fillRect(box.x, box.y, box.w, box.h)
      // The print intent draws in one go; the display intent waits on requestAnimationFrame, which stalls in a
      // hidden window.
      await page.render({ canvas, canvasContext: context, viewport, intent: 'print' }).promise
      const content = await page.getTextContent()
      const text = content.items
        .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
        .join('')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .trim()
      onPage(n - 1, pdf.numPages, await canvasBytes(canvas, 'image/png'), text)
      page.cleanup()
    }
  } finally {
    await task.destroy()
  }
}

/** Fits an image onto a black 1920x1080 slide and returns the PNG. */
export async function fitImageSlide(bytes: Uint8Array): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
  try {
    const [canvas, context] = slideCanvas()
    const box = fitBox(bitmap.width, bitmap.height)
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, box.x, box.y, box.w, box.h)
    return await canvasBytes(canvas, 'image/png')
  } finally {
    bitmap.close()
  }
}

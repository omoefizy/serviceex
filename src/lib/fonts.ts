// Fonts in the renderer: loading the bundled and imported fonts into each window, listing what this machine has,
// and the font picker's favorites and recently used. Names, fallbacks and the bundled list are in shared/fonts.ts.

import { BUNDLED_FONTS, cssFontFamily, familiesOf, isGenericFamily } from '../../shared/fonts'
import type { ImportedFont } from '../../shared/types'

export { cssFontFamily }

// ---------- Loading ----------

let imported: ImportedFont[] = []
const importedFaces: FontFace[] = []
const listeners = new Set<() => void>()

/** Paths are relative to the page, so they work from the dev server and from the packaged app's file:// page. */
const fontUrl = (file: string) => new URL(`fonts/${file}`, document.baseURI).href

/** The bundled fonts as @font-face rules. A face downloads only once text uses it. */
function bundledFontFaces(): string {
  return BUNDLED_FONTS.flatMap((font) =>
    font.faces.map(
      (face) =>
        `@font-face { font-family: "${font.family}"; src: url("${fontUrl(face.file)}") format("woff2"); font-weight: ${face.weight}; font-style: ${face.italic ? 'italic' : 'normal'}; font-display: block; }`,
    ),
  ).join('\n')
}

async function loadImported(): Promise<void> {
  const fonts = await window.api.fonts.list()
  for (const face of importedFaces.splice(0)) document.fonts.delete(face)
  for (const font of fonts) {
    const face = new FontFace(font.family, `url("${font.url}")`, { weight: font.weight, style: font.italic ? 'italic' : 'normal', display: 'block' })
    document.fonts.add(face)
    importedFaces.push(face)
  }
  imported = fonts
  listeners.forEach((listener) => listener())
}

/** Called once per window: every window draws slides, so each needs the fonts. */
export function installFonts(): void {
  const style = document.createElement('style')
  style.dataset.fonts = 'bundled'
  style.textContent = bundledFontFaces()
  document.head.appendChild(style)
  if (!window.api?.fonts) return
  loadImported().catch(console.error)
  // A font imported in the operator window reaches the output and stream windows too.
  window.api.fonts.onChanged(() => loadImported().catch(console.error))
}

/** Imports font files the operator picks; resolves to the families added and the files that could not be read. */
export async function importFonts(): Promise<{ families: string[]; skipped: string[] }> {
  const result = await window.api.fonts.import()
  await loadImported()
  return { families: [...new Set(result.fonts.map((font) => font.family))], skipped: result.skipped }
}

export const importedFamilies = (): string[] => [...new Set(imported.map((font) => font.family))].sort((a, b) => a.localeCompare(b))

/** Called when the imported fonts change. Returns an unsubscribe function. */
export function onFontsChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// ---------- System fonts ----------

let systemFonts: Promise<string[]> | null = null

/**
 * Installed font families, through Chromium's Local Font Access API, which Electron allows on macOS and Windows.
 * Asked once, on first use (it needs a click). Empty when the system will not list them.
 */
export function loadSystemFonts(): Promise<string[]> {
  systemFonts ??= (async () => {
    const query = (window as Window & { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
    if (!query) return []
    try {
      const fonts = await query.call(window)
      return [...new Set(fonts.map((font) => font.family))].sort((a, b) => a.localeCompare(b))
    } catch {
      systemFonts = null
      return []
    }
  })()
  return systemFonts
}

// ---------- Availability ----------

const measured = new Map<string, boolean>()
let canvas: CanvasRenderingContext2D | null = null

/**
 * Whether the machine has a font, by drawing a sample with it and with only a generic family: the same width with
 * every generic means it fell back. Bundled and imported fonts count before they have loaded.
 */
function installed(family: string): boolean {
  const key = family.toLowerCase()
  const known = measured.get(key)
  if (known !== undefined) return known
  canvas ??= document.createElement('canvas').getContext('2d')
  if (!canvas) return true
  const sample = 'mmmmmmmmmmlliWWQ@#&0123'
  const quotedName = `"${family.replace(/"/g, '')}"`
  const found = ['monospace', 'serif', 'sans-serif'].some((generic) => {
    canvas!.font = `72px ${generic}`
    const plain = canvas!.measureText(sample).width
    canvas!.font = `72px ${quotedName}, ${generic}`
    return canvas!.measureText(sample).width !== plain
  })
  measured.set(key, found)
  return found
}

export function isFamilyAvailable(family: string): boolean {
  const key = family.trim().toLowerCase()
  if (!key || isGenericFamily(key)) return true
  if (BUNDLED_FONTS.some((font) => font.family.toLowerCase() === key)) return true
  if (imported.some((font) => font.family.toLowerCase() === key)) return true
  return installed(family.trim())
}

/** A theme's font is there when any family of its stack is (a stack lists its own fallbacks). */
export const isFontAvailable = (value: string) => familiesOf(value).some(isFamilyAvailable)

/** The fonts among these that this machine cannot draw, once each, by the name the picker shows. */
export function missingFonts(values: (string | undefined)[]): string[] {
  const missing = new Set<string>()
  for (const value of values) if (value && !isFontAvailable(value)) missing.add(familiesOf(value)[0])
  return [...missing]
}

// ---------- Favorites and recently used ----------

const FAVORITES_KEY = 'fonts.favorites'
const RECENT_KEY = 'fonts.recent'
const MAX_RECENT = 8

function readList(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function writeList(key: string, list: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list))
  } catch {
    // The lists start again next time.
  }
}

export const favoriteFonts = () => readList(FAVORITES_KEY)
export const recentFonts = () => readList(RECENT_KEY)

export function toggleFavoriteFont(family: string): string[] {
  const list = favoriteFonts()
  const next = list.includes(family) ? list.filter((f) => f !== family) : [...list, family].sort((a, b) => a.localeCompare(b))
  writeList(FAVORITES_KEY, next)
  return next
}

export function rememberRecentFont(family: string): void {
  writeList(RECENT_KEY, [family, ...recentFonts().filter((f) => f !== family)].slice(0, MAX_RECENT))
}

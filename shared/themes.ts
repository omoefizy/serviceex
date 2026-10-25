// Theme defaults, the built-in themes, validation and the migration of themes made before the layout editor.
// Shared by the main process (database, output IPC) and the renderer (ThemedSlide, theme editor).

import type {
  TextCase,
  ThemeBackground,
  ThemeBox,
  ThemeCategory,
  ThemeContentType,
  ThemeElement,
  ThemeStyle,
  ThemeTextParagraph,
  ThemeTextProps,
  ThemeTextRun,
} from './types'
import { migrateFontName } from './fonts'

/** The Default Font until Live Options picks another. Text boxes with no font of their own use it. */
export const DEFAULT_FONT = "'Helvetica Neue', Inter, 'Segoe UI', Arial, sans-serif"
const SERIF = "Georgia, 'Times New Roman', serif"

// ---------- Validation helpers ----------
// Themes come from the database, the renderer and old versions of this file, so every field is checked
// and anything missing or out of range falls back to the default. Lower third templates use the same checks.

type Fields = Record<string, unknown>

export const fieldsOf = (value: unknown): Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Fields) : {}
export const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback)
export const hex = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback
export const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)
export const number = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
export const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback

export const TEXT_CASES: TextCase[] = ['normal', 'upper', 'lower']
export const THEME_CATEGORIES: ThemeCategory[] = ['song', 'scripture', 'presentation', 'lowerThird', 'logo']
export const THEME_CONTENT_TYPES: ThemeContentType[] = ['song', 'scripture', 'announcement', 'quote', 'lowerThird', 'logo']

/** The theme type each content type's default is picked from. */
export const CATEGORY_OF: Record<ThemeContentType, ThemeCategory> = {
  song: 'song',
  scripture: 'scripture',
  announcement: 'presentation',
  quote: 'presentation',
  lowerThird: 'lowerThird',
  logo: 'logo',
}

export const isTextKind = (kind: ThemeElement['kind']) => kind === 'text' || kind === 'reference' || kind === 'copyright'

const weight = (value: unknown, fallback: number) => Math.round(number(value, fallback, 100, 900) / 100) * 100

/** Luma (Rec. 709) of a color from 0 to 1, as a luma key sees it. */
export function keyLuma(color: string): number {
  const n = parseInt(color.slice(1), 16)
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
}

/** Below this, a luma key starts cutting a color out along with the black. */
export const LUMA_KEY_THRESHOLD = 0.2

/** The largest auto fit size in percent of screen height, unless a text box sets its own, so one short line does not fill the screen. */
export const AUTO_FIT_MAX = 16

// ---------- Elements ----------

export const DEFAULT_TEXT_PROPS: ThemeTextProps = {
  fontFamily: '',
  fontWeight: 600,
  italic: false,
  underline: false,
  sizeMode: 'auto',
  fontSize: 8,
  color: '#ffffff',
  textCase: 'normal',
  align: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.25,
  shadow: { enabled: true, color: '#000000', blur: 0.12, offset: 0.04 },
  outline: { enabled: false, color: '#000000', width: 0.03 },
  padding: 0,
}

const textProps = (overrides: Partial<ThemeTextProps>): ThemeTextProps => ({ ...DEFAULT_TEXT_PROPS, ...overrides })

/** A new element of each kind, as the editor adds it. */
export function newElement(kind: ThemeElement['kind'], id: string): ThemeElement {
  switch (kind) {
    case 'text':
      return { id, kind, box: { x: 10, y: 20, width: 80, height: 60 }, locked: false, text: textProps({}) }
    case 'reference':
      return {
        id,
        kind,
        box: { x: 10, y: 84, width: 80, height: 7 },
        locked: false,
        attached: false,
        text: textProps({ sizeMode: 'fixed', fontSize: 4, fontWeight: 500, color: '#d6dae0', lineHeight: 1.2 }),
      }
    case 'copyright':
      return {
        id,
        kind,
        box: { x: 10, y: 92, width: 80, height: 5 },
        locked: false,
        attached: false,
        text: textProps({ sizeMode: 'fixed', fontSize: 2.4, fontWeight: 400, color: '#bfc4cc', lineHeight: 1.2, shadow: { ...DEFAULT_TEXT_PROPS.shadow, enabled: false } }),
      }
    case 'image':
      return { id, kind, box: { x: 82, y: 6, width: 12, height: 14 }, locked: false, src: null, fit: 'contain', opacity: 1 }
    case 'shape':
      return { id, kind, box: { x: 0, y: 75, width: 100, height: 18 }, locked: false, color: '#2563eb', opacity: 1 }
    case 'video':
      return { id, kind, box: { x: 25, y: 25, width: 50, height: 50 }, locked: false, src: '', fit: 'contain', opacity: 1 }
  }
}

// ---------- Themes made before the layout editor ----------

/** The fields every theme had before elements: one text area inside margins, an optional band and a caption line. */
interface LegacyStyle {
  fontFamily: string
  fontWeight: number
  sizeMode: 'auto' | 'fixed'
  fontSize: number
  color: string
  align: 'left' | 'center' | 'right'
  verticalAlign: 'top' | 'middle' | 'bottom'
  lineHeight: number
  textCase: TextCase
  shadow: { enabled: boolean; color: string; blur: number; offset: number }
  outline: { enabled: boolean; color: string; width: number }
  margins: { top: number; right: number; bottom: number; left: number }
  band: { enabled: boolean; color: string; opacity: number }
  background: ThemeBackground
  overlay: number
  caption: { fontFamily: string; fontWeight: number; size: number; color: string; textCase: TextCase; italic: boolean; position: 'below' | 'top' }
}

const LEGACY_DEFAULTS: LegacyStyle = {
  fontFamily: DEFAULT_FONT,
  fontWeight: 600,
  sizeMode: 'auto',
  fontSize: 8,
  color: '#ffffff',
  align: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.25,
  textCase: 'normal',
  shadow: { enabled: true, color: '#000000', blur: 0.12, offset: 0.04 },
  outline: { enabled: false, color: '#000000', width: 0.03 },
  margins: { top: 6, right: 5, bottom: 6, left: 5 },
  band: { enabled: false, color: '#000000', opacity: 0.6 },
  background: { kind: 'solid', color: '#000000' },
  overlay: 0,
  caption: { fontFamily: '', fontWeight: 500, size: 3.2, color: '#bfc4cc', textCase: 'normal', italic: false, position: 'below' },
}

/** The old default stack becomes "use the Default Font", so changing that font reaches older themes too. */
const fontOf = (family: string) => (family === DEFAULT_FONT ? '' : family)

/** Reads the old fields, checking each like normalizeTheme does. */
function readLegacy(v: Fields): LegacyStyle {
  const d = LEGACY_DEFAULTS
  const shadow = fieldsOf(v.shadow)
  const outline = fieldsOf(v.outline)
  const margins = fieldsOf(v.margins)
  const band = fieldsOf(v.band)
  const caption = fieldsOf(v.caption)
  return {
    fontFamily: migrateFontName(text(v.fontFamily, d.fontFamily)) || d.fontFamily,
    fontWeight: weight(v.fontWeight, d.fontWeight),
    sizeMode: oneOf(v.sizeMode, ['auto', 'fixed'], d.sizeMode),
    fontSize: number(v.fontSize, d.fontSize, 1, 30),
    color: hex(v.color, d.color),
    align: oneOf(v.align, ['left', 'center', 'right'], d.align),
    verticalAlign: oneOf(v.verticalAlign, ['top', 'middle', 'bottom'], d.verticalAlign),
    lineHeight: number(v.lineHeight, d.lineHeight, 0.8, 2.5),
    textCase: oneOf(v.textCase, TEXT_CASES, d.textCase),
    shadow: {
      enabled: flag(shadow.enabled, d.shadow.enabled),
      color: hex(shadow.color, d.shadow.color),
      blur: number(shadow.blur, d.shadow.blur, 0, 1),
      offset: number(shadow.offset, d.shadow.offset, 0, 0.5),
    },
    outline: {
      enabled: flag(outline.enabled, d.outline.enabled),
      color: hex(outline.color, d.outline.color),
      width: number(outline.width, d.outline.width, 0, 0.2),
    },
    margins: {
      top: number(margins.top, d.margins.top, 0, 90),
      right: number(margins.right, d.margins.right, 0, 45),
      bottom: number(margins.bottom, d.margins.bottom, 0, 90),
      left: number(margins.left, d.margins.left, 0, 45),
    },
    band: {
      enabled: flag(band.enabled, d.band.enabled),
      color: hex(band.color, d.band.color),
      opacity: number(band.opacity, d.band.opacity, 0, 1),
    },
    background: normalizeBackground(v.background, d.background),
    overlay: number(v.overlay, d.overlay, 0, 1),
    caption: {
      fontFamily: migrateFontName(text(caption.fontFamily, d.caption.fontFamily)),
      fontWeight: weight(caption.fontWeight, d.caption.fontWeight),
      size: number(caption.size, d.caption.size, 1, 15),
      color: hex(caption.color, d.caption.color),
      textCase: oneOf(caption.textCase, TEXT_CASES, d.caption.textCase),
      italic: flag(caption.italic, d.caption.italic),
      position: oneOf(caption.position, ['below', 'top'], d.caption.position),
    },
  }
}

/**
 * The element layout that draws an old theme as it looked: the band as a shape filling the safe area, the text in
 * the safe area (inside the band's padding), and the caption line as Reference and Copyright boxes attached under
 * the text, or a Reference box across the top for a caption that sat on top.
 */
function migrateLegacy(old: LegacyStyle, category: ThemeCategory): ThemeStyle {
  const { margins, band, caption } = old
  const safe: ThemeBox = { x: margins.left, y: margins.top, width: Math.max(1, 100 - margins.left - margins.right), height: Math.max(1, 100 - margins.top - margins.bottom) }
  const elements: ThemeElement[] = []
  if (band.enabled) elements.push({ id: 'band', kind: 'shape', box: safe, locked: false, color: band.color, opacity: band.opacity })
  // The band had 3% of the height and 4% of the width of padding.
  let box = band.enabled ? { x: safe.x + 4, y: safe.y + 3, width: Math.max(1, safe.width - 8), height: Math.max(1, safe.height - 6) } : safe
  const main = textProps({
    fontFamily: fontOf(old.fontFamily),
    fontWeight: old.fontWeight,
    sizeMode: old.sizeMode,
    fontSize: old.fontSize,
    color: old.color,
    textCase: old.textCase,
    align: old.align,
    verticalAlign: old.verticalAlign,
    lineHeight: old.lineHeight,
    shadow: old.shadow,
    outline: old.outline,
  })
  const captionText = textProps({
    fontFamily: fontOf(caption.fontFamily || old.fontFamily),
    fontWeight: caption.fontWeight,
    italic: caption.italic,
    sizeMode: 'fixed',
    fontSize: caption.size,
    color: caption.color,
    textCase: caption.textCase,
    align: old.align,
    verticalAlign: 'top',
    lineHeight: 1.2,
    shadow: old.shadow,
    outline: { ...old.outline, enabled: false },
  })
  const onTop = caption.position === 'top'
  if (onTop) {
    // One line of caption and the 0.4em gap under it.
    const height = Math.min(box.height / 2, caption.size * 1.6)
    elements.push({ id: 'reference', kind: 'reference', box: { ...box, height }, locked: false, attached: false, text: captionText })
    box = { ...box, y: box.y + height, height: box.height - height }
  }
  elements.push({ id: 'text', kind: 'text', box, locked: false, text: main })
  if (!onTop) elements.push({ id: 'reference', kind: 'reference', box: { ...box, y: Math.max(0, box.y + box.height - 6), height: Math.min(6, box.height) }, locked: false, attached: true, text: captionText })
  elements.push({ id: 'copyright', kind: 'copyright', box: { ...box, y: Math.max(0, box.y + box.height - 5), height: Math.min(5, box.height) }, locked: false, attached: true, text: captionText })
  return { category, background: old.background, overlay: old.overlay, keyTransparent: false, elements }
}

/** An old-style theme, for the built-ins written that way. */
const legacy = (category: ThemeCategory, overrides: Partial<LegacyStyle>): ThemeStyle =>
  migrateLegacy({ ...LEGACY_DEFAULTS, ...overrides }, category)

// ---------- Built-in themes ----------

/** Classic Black, and the fallback for anything a stored theme lacks. */
export const DEFAULT_THEME_STYLE: ThemeStyle = legacy('song', {})

/** A lower third for a luma key: black (or the Stream's key color) everywhere but the bright bars and their text. */
function lowerThird(elements: ThemeElement[]): ThemeStyle {
  return { category: 'lowerThird', background: { kind: 'solid', color: '#000000' }, overlay: 0, keyTransparent: true, elements }
}

/** Solid white text with no soft shadow, which a key would turn into a dark fringe. */
const keyText = (overrides: Partial<ThemeTextProps>): ThemeTextProps =>
  textProps({ fontWeight: 700, align: 'left', lineHeight: 1.15, shadow: { ...DEFAULT_TEXT_PROPS.shadow, enabled: false }, ...overrides })

const keyLine = (kind: 'reference' | 'copyright', box: ThemeBox, overrides: Partial<ThemeTextProps>): ThemeElement => ({
  id: kind,
  kind,
  box,
  locked: false,
  attached: false,
  text: keyText({ sizeMode: 'fixed', fontWeight: 600, lineHeight: 1.2, ...overrides }),
})

const shape = (id: string, box: ThemeBox, color: string): ThemeElement => ({ id, kind: 'shape', box, locked: false, color, opacity: 1 })
const mainText = (box: ThemeBox, overrides: Partial<ThemeTextProps> = {}): ThemeElement => ({ id: 'text', kind: 'text', box, locked: false, text: keyText(overrides) })

/** Seeded into the database on every start, so changes here reach existing installs. Names are their identity. */
export const BUILTIN_THEMES: { name: string; style: ThemeStyle }[] = [
  { name: 'Classic Black', style: DEFAULT_THEME_STYLE },
  {
    name: 'Deep Blue Gradient',
    style: legacy('song', {
      fontWeight: 700,
      background: { kind: 'gradient', from: '#0b1d4d', to: '#1f5fbf', angle: 160 },
      shadow: { enabled: true, color: '#020617', blur: 0.18, offset: 0.05 },
      caption: { ...LEGACY_DEFAULTS.caption, color: '#c7d7f5' },
    }),
  },
  {
    name: 'Warm Sunset',
    style: legacy('song', {
      fontWeight: 700,
      background: { kind: 'gradient', from: '#f59e0b', to: '#7c2d12', angle: 135 },
      overlay: 0.15,
      shadow: { enabled: true, color: '#3b0d02', blur: 0.2, offset: 0.05 },
      caption: { ...LEGACY_DEFAULTS.caption, color: '#ffe7c2' },
    }),
  },
  {
    name: 'Minimal White',
    style: legacy('presentation', {
      fontWeight: 500,
      color: '#111111',
      shadow: { ...LEGACY_DEFAULTS.shadow, enabled: false },
      background: { kind: 'solid', color: '#ffffff' },
      caption: { ...LEGACY_DEFAULTS.caption, color: '#666666' },
    }),
  },
  {
    // Chroma green behind an opaque band at the bottom: key the green out in OBS or a video switcher.
    name: 'Lower Third',
    style: legacy('lowerThird', {
      fontWeight: 600,
      align: 'left',
      lineHeight: 1.2,
      margins: { top: 72, right: 0, bottom: 0, left: 0 },
      band: { enabled: true, color: '#0b0f1a', opacity: 1 },
      background: { kind: 'solid', color: '#00b140' },
      shadow: { ...LEGACY_DEFAULTS.shadow, enabled: false },
      caption: { ...LEGACY_DEFAULTS.caption, size: 2.8 },
    }),
  },
  {
    name: 'Scripture Serif',
    style: legacy('scripture', {
      fontFamily: SERIF,
      fontWeight: 400,
      align: 'left',
      lineHeight: 1.45,
      color: '#f4efe6',
      margins: { top: 8, right: 8, bottom: 8, left: 8 },
      background: { kind: 'gradient', from: '#1c1712', to: '#0d0b09', angle: 180 },
      shadow: { enabled: true, color: '#000000', blur: 0.1, offset: 0.03 },
      caption: { fontFamily: SERIF, fontWeight: 400, size: 3.4, color: '#d6b98c', textCase: 'normal', italic: true, position: 'below' },
    }),
  },
  {
    // A sermon statement: large serif text (the slide adds the quote marks) and the speaker's name as the reference.
    name: 'Quote',
    style: legacy('presentation', {
      fontFamily: SERIF,
      fontWeight: 500,
      sizeMode: 'fixed',
      fontSize: 9,
      lineHeight: 1.3,
      color: '#fdfaf3',
      margins: { top: 10, right: 10, bottom: 10, left: 10 },
      background: { kind: 'gradient', from: '#1e1b2e', to: '#0b0a12', angle: 160 },
      shadow: { enabled: true, color: '#000000', blur: 0.1, offset: 0.03 },
      caption: { fontFamily: DEFAULT_FONT, fontWeight: 600, size: 3.6, color: '#d6b98c', textCase: 'normal', italic: false, position: 'below' },
    }),
  },
  {
    // Dark blue with slow drifting smoke: the reference or title in yellow across the top, bold white words centred.
    name: 'Blue Smoke',
    style: legacy('song', {
      fontWeight: 700,
      sizeMode: 'auto',
      align: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.2,
      margins: { top: 7, right: 6, bottom: 7, left: 6 },
      background: { kind: 'smoke', color: '#06143a', smoke: '#5a7bc4' },
      shadow: { enabled: true, color: '#000814', blur: 0.16, offset: 0.04 },
      caption: { fontFamily: '', fontWeight: 700, size: 4.4, color: '#ffd400', textCase: 'normal', italic: false, position: 'top' },
    }),
  },
  // Lower thirds for a luma key: bright solid bars on black with white text near the bottom, nothing dark and no soft
  // shadows, so the key cuts them cleanly. Transparent for keying lets the Stream output's key color show instead.
  {
    name: 'Classic Bar',
    style: lowerThird([
      shape('bar', { x: 5, y: 72, width: 90, height: 20 }, '#2563eb'),
      mainText({ x: 7, y: 73.5, width: 86, height: 12.5 }),
      keyLine('reference', { x: 7, y: 86, width: 86, height: 5 }, { fontSize: 3.2, color: '#dbeafe' }),
      keyLine('copyright', { x: 5, y: 93, width: 90, height: 4 }, { fontSize: 2.2, fontWeight: 500, color: '#e2e8f0' }),
    ]),
  },
  {
    name: 'Accent Stripe',
    style: lowerThird([
      shape('accent', { x: 5, y: 72, width: 1.4, height: 20 }, '#facc15'),
      shape('bar', { x: 6.4, y: 72, width: 88.6, height: 20 }, '#0f766e'),
      mainText({ x: 9, y: 73.5, width: 84, height: 12.5 }),
      keyLine('reference', { x: 9, y: 86, width: 84, height: 5 }, { fontSize: 3.2, color: '#fef08a' }),
      keyLine('copyright', { x: 5, y: 93, width: 90, height: 4 }, { fontSize: 2.2, fontWeight: 500, color: '#e2e8f0' }),
    ]),
  },
  {
    name: 'Minimal Text',
    style: lowerThird([
      mainText({ x: 6, y: 72, width: 88, height: 15 }, { align: 'center', verticalAlign: 'bottom' }),
      keyLine('reference', { x: 6, y: 87.5, width: 88, height: 5 }, { fontSize: 3.2, color: '#facc15', align: 'center' }),
      keyLine('copyright', { x: 6, y: 93, width: 88, height: 4 }, { fontSize: 2.2, fontWeight: 500, color: '#e2e8f0', align: 'center' }),
    ]),
  },
  {
    name: 'Two Line Banner',
    style: lowerThird([
      shape('tab', { x: 5, y: 70, width: 40, height: 6.5 }, '#dc2626'),
      shape('bar', { x: 5, y: 76.5, width: 90, height: 15.5 }, '#1d4ed8'),
      keyLine('reference', { x: 6.5, y: 70.5, width: 37, height: 5.5 }, { fontSize: 3.4, fontWeight: 700, textCase: 'upper', verticalAlign: 'middle', color: '#ffffff' }),
      mainText({ x: 7, y: 77.5, width: 86, height: 13.5 }),
      keyLine('copyright', { x: 5, y: 93, width: 90, height: 4 }, { fontSize: 2.2, fontWeight: 500, color: '#e2e8f0' }),
    ]),
  },
  {
    // What the Logo button shows: the church logo from Settings (or the placeholder) on black.
    name: 'Logo',
    style: {
      category: 'logo',
      background: { kind: 'solid', color: '#000000' },
      overlay: 0,
      keyTransparent: false,
      elements: [{ id: 'logo', kind: 'image', box: { x: 20, y: 20, width: 60, height: 60 }, locked: false, src: null, fit: 'contain', opacity: 1 }],
    },
  },
]

/** Built-in themes used until someone picks other defaults. */
export const BUILTIN_DEFAULTS: Record<ThemeContentType, string> = {
  song: 'Blue Smoke',
  scripture: 'Blue Smoke',
  announcement: 'Blue Smoke',
  quote: 'Quote',
  lowerThird: 'Classic Bar',
  logo: 'Logo',
}

// ---------- Validation ----------

function normalizeBackground(value: unknown, fallback: ThemeBackground): ThemeBackground {
  const v = fieldsOf(value)
  switch (v.kind) {
    case 'solid':
      return { kind: 'solid', color: hex(v.color, '#000000') }
    case 'gradient':
      return { kind: 'gradient', from: hex(v.from, '#000000'), to: hex(v.to, '#333333'), angle: number(v.angle, 180, 0, 360) }
    case 'image':
      if (typeof v.src !== 'string' || !v.src) return { kind: 'solid', color: '#000000' }
      return v.fit === 'contain' ? { kind: 'image', src: v.src, fit: 'contain' } : { kind: 'image', src: v.src }
    case 'video':
      return typeof v.src === 'string' && v.src ? { kind: 'video', src: v.src } : { kind: 'solid', color: '#000000' }
    case 'smoke':
      return { kind: 'smoke', color: hex(v.color, '#06143a'), smoke: hex(v.smoke, '#5a7bc4') }
    case 'none':
      return { kind: 'none' }
    default:
      return fallback
  }
}

/** A box kept on screen and at least half a percent across. */
export function normalizeBox(value: unknown, fallback: ThemeBox): ThemeBox {
  const v = fieldsOf(value)
  const width = number(v.width, fallback.width, 0.5, 100)
  const height = number(v.height, fallback.height, 0.5, 100)
  return { x: number(v.x, fallback.x, 0, 100 - width), y: number(v.y, fallback.y, 0, 100 - height), width, height }
}

function normalizeTextProps(value: unknown, fallback: ThemeTextProps): ThemeTextProps {
  const v = fieldsOf(value)
  const shadow = fieldsOf(v.shadow)
  const outline = fieldsOf(v.outline)
  const d = fallback
  return {
    fontFamily: migrateFontName(text(v.fontFamily, d.fontFamily)).slice(0, 200),
    fontWeight: weight(v.fontWeight, d.fontWeight),
    italic: flag(v.italic, d.italic),
    underline: flag(v.underline, d.underline),
    sizeMode: oneOf(v.sizeMode, ['auto', 'fixed'], d.sizeMode),
    fontSize: number(v.fontSize, d.fontSize, 1, 30),
    color: hex(v.color, d.color),
    textCase: oneOf(v.textCase, TEXT_CASES, d.textCase),
    align: oneOf(v.align, ['left', 'center', 'right'], d.align),
    verticalAlign: oneOf(v.verticalAlign, ['top', 'middle', 'bottom'], d.verticalAlign),
    lineHeight: number(v.lineHeight, d.lineHeight, 0.8, 2.5),
    shadow: {
      enabled: flag(shadow.enabled, d.shadow.enabled),
      color: hex(shadow.color, d.shadow.color),
      blur: number(shadow.blur, d.shadow.blur, 0, 1),
      offset: number(shadow.offset, d.shadow.offset, 0, 0.5),
    },
    outline: {
      enabled: flag(outline.enabled, d.outline.enabled),
      color: hex(outline.color, d.outline.color),
      width: number(outline.width, d.outline.width, 0, 0.2),
    },
    padding: number(v.padding, d.padding, 0, 20),
    ...(typeof v.maxSize === 'number' ? { maxSize: number(v.maxSize, AUTO_FIT_MAX, 1, 30) } : {}),
    ...(typeof v.offset === 'number' && v.offset !== 0 ? { offset: number(v.offset, 0, -50, 50) } : {}),
  }
}

const MAX_PARAGRAPHS = 100
const MAX_RUNS = 100

function normalizeRun(value: unknown): ThemeTextRun {
  const v = fieldsOf(value)
  const run: ThemeTextRun = { text: text(v.text, '').slice(0, 5000) }
  if (typeof v.fontFamily === 'string' && v.fontFamily.trim()) run.fontFamily = migrateFontName(v.fontFamily).slice(0, 200)
  if (typeof v.fontSize === 'number') run.fontSize = number(v.fontSize, 4, 0.5, 30)
  if (typeof v.color === 'string') run.color = hex(v.color, '#ffffff')
  for (const key of ['bold', 'italic', 'underline', 'strike'] as const) if (typeof v[key] === 'boolean') run[key] = v[key] as boolean
  if (typeof v.highlight === 'string') run.highlight = hex(v.highlight, '#ffff00')
  if (typeof v.textCase === 'string') run.textCase = oneOf(v.textCase, ['normal', 'upper', 'lower'] as const, 'normal')
  return run
}

/** The fixed paragraphs of an imported text box, or undefined when it has none (it shows the slide's text). */
function normalizeParagraphs(value: unknown): ThemeTextParagraph[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.slice(0, MAX_PARAGRAPHS).map((item) => {
    const v = fieldsOf(item)
    const paragraph: ThemeTextParagraph = { runs: Array.isArray(v.runs) ? v.runs.slice(0, MAX_RUNS).map(normalizeRun) : [] }
    if (typeof v.align === 'string') paragraph.align = oneOf(v.align, ['left', 'center', 'right', 'justify'] as const, 'left')
    if (typeof v.lineHeight === 'number') paragraph.lineHeight = number(v.lineHeight, 1.2, 0.5, 4)
    if (typeof v.bullet === 'string' && v.bullet) paragraph.bullet = v.bullet.slice(0, 4)
    return paragraph
  })
}

const MAX_ELEMENTS = 50
const ELEMENT_KINDS: ThemeElement['kind'][] = ['text', 'reference', 'copyright', 'image', 'shape', 'video']

/** An element with every field checked, or null for one of no known kind. */
function normalizeElement(value: unknown, id: string): ThemeElement | null {
  const v = fieldsOf(value)
  const kind = oneOf(v.kind, ELEMENT_KINDS, 'text')
  if (v.kind !== kind) return null
  const d = newElement(kind, id)
  const box = normalizeBox(v.box, d.box)
  const locked = flag(v.locked, false)
  switch (d.kind) {
    case 'text': {
      const paragraphs = normalizeParagraphs(v.paragraphs)
      return { id, kind: d.kind, box, locked, text: normalizeTextProps(v.text, d.text), ...(paragraphs ? { paragraphs } : {}) }
    }
    case 'reference':
    case 'copyright':
      return { id, kind: d.kind, box, locked, attached: flag(v.attached, false), ...(v.above === true ? { above: true } : {}), text: normalizeTextProps(v.text, d.text) }
    case 'image':
      return {
        id,
        kind: d.kind,
        box,
        locked,
        src: typeof v.src === 'string' && v.src.startsWith('wd-media://') ? v.src : null,
        fit: oneOf(v.fit, ['contain', 'cover'], d.fit),
        opacity: number(v.opacity, 1, 0, 1),
      }
    case 'shape':
      return { id, kind: d.kind, box, locked, color: hex(v.color, d.color), opacity: number(v.opacity, 1, 0, 1) }
    case 'video':
      if (typeof v.src !== 'string' || !v.src.startsWith('wd-media://')) return null
      return { id, kind: d.kind, box, locked, src: v.src, fit: oneOf(v.fit, ['contain', 'cover'], d.fit), opacity: number(v.opacity, 1, 0, 1) }
  }
}

/**
 * A usable theme from anything stored or sent. A theme saved before the layout editor (no `elements`) is migrated to
 * the element layout that draws it the same way; `legacyCategory` is the type to give it.
 */
export function normalizeTheme(value: unknown, legacyCategory: ThemeCategory = 'song'): ThemeStyle {
  const v = fieldsOf(value)
  if (!Array.isArray(v.elements)) return migrateLegacy(readLegacy(v), oneOf(v.category, THEME_CATEGORIES, legacyCategory))
  const ids = new Set<string>()
  const elements: ThemeElement[] = []
  for (const [index, item] of v.elements.slice(0, MAX_ELEMENTS).entries()) {
    const raw = fieldsOf(item).id
    let id = typeof raw === 'string' && raw && raw.length <= 64 ? raw : `element-${index}`
    while (ids.has(id)) id = `${id}-${index}`
    const element = normalizeElement(item, id)
    if (!element) continue
    ids.add(id)
    elements.push(element)
  }
  return {
    category: oneOf(v.category, THEME_CATEGORIES, 'song'),
    background: normalizeBackground(v.background, DEFAULT_THEME_STYLE.background),
    overlay: number(v.overlay, 0, 0, 1),
    keyTransparent: flag(v.keyTransparent, false),
    elements,
  }
}

/** True for a theme stored before the layout editor, which normalizeTheme migrates. */
export const isLegacyTheme = (value: unknown) => !Array.isArray(fieldsOf(value).elements)

// Theme defaults, the built-in themes and validation. Shared by the main process (database, output IPC)
// and the renderer (ThemedSlide, theme editor).

import type { TextCase, ThemeBackground, ThemeContentType, ThemeStyle } from './types'

const SANS = "'Helvetica Neue', Inter, 'Segoe UI', Arial, sans-serif"
const SERIF = "Georgia, 'Times New Roman', serif"

/** Classic Black, and the fallback for any field a stored theme lacks. */
export const DEFAULT_THEME_STYLE: ThemeStyle = {
  fontFamily: SANS,
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
  caption: { fontFamily: '', fontWeight: 500, size: 3.2, color: '#bfc4cc', textCase: 'normal', italic: false },
}

const style = (overrides: Partial<ThemeStyle>): ThemeStyle => ({ ...DEFAULT_THEME_STYLE, ...overrides })

/** Seeded into the database on every start, so changes here reach existing installs. Names are their identity. */
export const BUILTIN_THEMES: { name: string; style: ThemeStyle }[] = [
  { name: 'Classic Black', style: DEFAULT_THEME_STYLE },
  {
    name: 'Deep Blue Gradient',
    style: style({
      fontWeight: 700,
      background: { kind: 'gradient', from: '#0b1d4d', to: '#1f5fbf', angle: 160 },
      shadow: { enabled: true, color: '#020617', blur: 0.18, offset: 0.05 },
      caption: { ...DEFAULT_THEME_STYLE.caption, color: '#c7d7f5' },
    }),
  },
  {
    name: 'Warm Sunset',
    style: style({
      fontWeight: 700,
      background: { kind: 'gradient', from: '#f59e0b', to: '#7c2d12', angle: 135 },
      overlay: 0.15,
      shadow: { enabled: true, color: '#3b0d02', blur: 0.2, offset: 0.05 },
      caption: { ...DEFAULT_THEME_STYLE.caption, color: '#ffe7c2' },
    }),
  },
  {
    name: 'Minimal White',
    style: style({
      fontWeight: 500,
      color: '#111111',
      shadow: { ...DEFAULT_THEME_STYLE.shadow, enabled: false },
      background: { kind: 'solid', color: '#ffffff' },
      caption: { ...DEFAULT_THEME_STYLE.caption, color: '#666666' },
    }),
  },
  {
    // Chroma green behind an opaque band at the bottom: key the green out in OBS or a video switcher.
    name: 'Lower Third',
    style: style({
      fontWeight: 600,
      align: 'left',
      lineHeight: 1.2,
      margins: { top: 72, right: 0, bottom: 0, left: 0 },
      band: { enabled: true, color: '#0b0f1a', opacity: 1 },
      background: { kind: 'solid', color: '#00b140' },
      shadow: { ...DEFAULT_THEME_STYLE.shadow, enabled: false },
      caption: { ...DEFAULT_THEME_STYLE.caption, size: 2.8 },
    }),
  },
  {
    name: 'Scripture Serif',
    style: style({
      fontFamily: SERIF,
      fontWeight: 400,
      align: 'left',
      lineHeight: 1.45,
      color: '#f4efe6',
      margins: { top: 8, right: 8, bottom: 8, left: 8 },
      background: { kind: 'gradient', from: '#1c1712', to: '#0d0b09', angle: 180 },
      shadow: { enabled: true, color: '#000000', blur: 0.1, offset: 0.03 },
      caption: { fontFamily: SERIF, fontWeight: 400, size: 3.4, color: '#d6b98c', textCase: 'normal', italic: true },
    }),
  },
]

/** Built-in themes used until someone picks other defaults. */
export const BUILTIN_DEFAULTS: Record<ThemeContentType, string> = {
  song: 'Classic Black',
  scripture: 'Scripture Serif',
  announcement: 'Deep Blue Gradient',
}

export const THEME_CONTENT_TYPES: ThemeContentType[] = ['song', 'scripture', 'announcement']

// ---------- Validation ----------
// Themes come from the database, the renderer and old versions of this file, so every field is checked
// and anything missing or out of range falls back to the default.

type Fields = Record<string, unknown>

const fieldsOf = (value: unknown): Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Fields) : {}
const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback)
const hex = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback
const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)
const number = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback

const TEXT_CASES: TextCase[] = ['normal', 'upper', 'lower']

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
    default:
      return fallback
  }
}

export function normalizeTheme(value: unknown): ThemeStyle {
  const d = DEFAULT_THEME_STYLE
  const v = fieldsOf(value)
  const shadow = fieldsOf(v.shadow)
  const outline = fieldsOf(v.outline)
  const margins = fieldsOf(v.margins)
  const band = fieldsOf(v.band)
  const caption = fieldsOf(v.caption)
  return {
    fontFamily: text(v.fontFamily, d.fontFamily).trim() || d.fontFamily,
    fontWeight: Math.round(number(v.fontWeight, d.fontWeight, 100, 900) / 100) * 100,
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
      fontFamily: text(caption.fontFamily, d.caption.fontFamily).trim(),
      fontWeight: Math.round(number(caption.fontWeight, d.caption.fontWeight, 100, 900) / 100) * 100,
      size: number(caption.size, d.caption.size, 1, 15),
      color: hex(caption.color, d.caption.color),
      textCase: oneOf(caption.textCase, TEXT_CASES, d.caption.textCase),
      italic: flag(caption.italic, d.caption.italic),
    },
  }
}

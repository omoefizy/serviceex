// Lower third templates: the default, the built-in templates and validation. Shared by the main process (database,
// stream IPC) and the renderer (the lower third layer and the template editor), like shared/themes.ts for slides.

import { migrateFontName } from './fonts'
import { fieldsOf, flag, hex, number, oneOf, text, TEXT_CASES } from './themes'
import type { LowerThirdBox, LowerThirdStyle, LowerThirdTextStyle } from './types'

const SANS = "'Helvetica Neue', Inter, 'Segoe UI', Arial, sans-serif"

const headline = (overrides: Partial<LowerThirdTextStyle>): LowerThirdTextStyle => ({
  box: { x: 4, y: 10, width: 92, height: 48 },
  fontFamily: SANS,
  fontWeight: 700,
  size: 5,
  color: '#ffffff',
  textCase: 'normal',
  italic: false,
  maxLines: 2,
  ...overrides,
})

const body = (overrides: Partial<LowerThirdTextStyle>): LowerThirdTextStyle =>
  headline({ box: { x: 4, y: 58, width: 92, height: 32 }, fontWeight: 500, size: 3.2, maxLines: 1, ...overrides })

/** Classic Bar, and the fallback for any field a stored template lacks. */
export const DEFAULT_LOWER_THIRD_STYLE: LowerThirdStyle = {
  frame: { x: 5, y: 72, width: 55, height: 17 },
  bar: { enabled: true, color: '#0b1f44' },
  accent: { enabled: false, color: '#f59e0b', side: 'left', size: 2 },
  logo: { enabled: false, url: null, box: { x: 86, y: 14, width: 11, height: 72 } },
  headline: headline({}),
  body: body({ color: '#d6e2ff' }),
  align: 'left',
  outline: { enabled: false, color: '#000000', width: 0.05 },
}

const style = (overrides: Partial<LowerThirdStyle>): LowerThirdStyle => ({ ...DEFAULT_LOWER_THIRD_STYLE, ...overrides })

/** Seeded into the database on every start, so changes here reach existing installs. Names are their identity. */
export const BUILTIN_LOWER_THIRDS: { name: string; style: LowerThirdStyle }[] = [
  { name: 'Classic Bar', style: DEFAULT_LOWER_THIRD_STYLE },
  {
    // A white bar with a red stripe down its left edge.
    name: 'Accent Stripe',
    style: style({
      bar: { enabled: true, color: '#ffffff' },
      accent: { enabled: true, color: '#e11d48', side: 'left', size: 2.5 },
      headline: headline({ box: { x: 6, y: 10, width: 90, height: 48 }, color: '#111111' }),
      body: body({ box: { x: 6, y: 58, width: 90, height: 32 }, color: '#4b5563' }),
    }),
  },
  {
    // No bar: white text with a thin black outline, so it reads over any picture.
    name: 'Minimal Text',
    style: style({
      frame: { x: 5, y: 73, width: 60, height: 16 },
      bar: { enabled: false, color: '#000000' },
      headline: headline({ box: { x: 0, y: 6, width: 100, height: 54 }, size: 5.5 }),
      body: body({ box: { x: 0, y: 60, width: 100, height: 34 }, color: '#ffffff' }),
      outline: { enabled: true, color: '#000000', width: 0.06 },
    }),
  },
  {
    // Edge to edge across the bottom with an amber stripe on top; two centred lines inside the title safe area.
    name: 'Two Line Banner',
    style: style({
      frame: { x: 0, y: 76, width: 100, height: 17 },
      bar: { enabled: true, color: '#111827' },
      accent: { enabled: true, color: '#f59e0b', side: 'top', size: 7 },
      headline: headline({ box: { x: 10, y: 14, width: 80, height: 44 }, maxLines: 1 }),
      body: body({ box: { x: 10, y: 58, width: 80, height: 32 }, color: '#e5e7eb' }),
      align: 'center',
    }),
  },
]

// ---------- Validation ----------
// Templates come from the database, the renderer and old versions of this file, so every field is checked.

function normalizeBox(value: unknown, fallback: LowerThirdBox): LowerThirdBox {
  const v = fieldsOf(value)
  const x = number(v.x, fallback.x, 0, 99)
  const y = number(v.y, fallback.y, 0, 99)
  return { x, y, width: number(v.width, fallback.width, 1, 100 - x), height: number(v.height, fallback.height, 1, 100 - y) }
}

function normalizeText(value: unknown, fallback: LowerThirdTextStyle): LowerThirdTextStyle {
  const v = fieldsOf(value)
  return {
    box: normalizeBox(v.box, fallback.box),
    fontFamily: migrateFontName(text(v.fontFamily, fallback.fontFamily)) || fallback.fontFamily,
    fontWeight: Math.round(number(v.fontWeight, fallback.fontWeight, 100, 900) / 100) * 100,
    size: number(v.size, fallback.size, 1, 20),
    color: hex(v.color, fallback.color),
    textCase: oneOf(v.textCase, TEXT_CASES, fallback.textCase),
    italic: flag(v.italic, fallback.italic),
    maxLines: Math.round(number(v.maxLines, fallback.maxLines, 1, 4)),
  }
}

export function normalizeLowerThirdStyle(value: unknown): LowerThirdStyle {
  const d = DEFAULT_LOWER_THIRD_STYLE
  const v = fieldsOf(value)
  const bar = fieldsOf(v.bar)
  const accent = fieldsOf(v.accent)
  const logo = fieldsOf(v.logo)
  const outline = fieldsOf(v.outline)
  return {
    frame: normalizeBox(v.frame, d.frame),
    bar: { enabled: flag(bar.enabled, d.bar.enabled), color: hex(bar.color, d.bar.color) },
    accent: {
      enabled: flag(accent.enabled, d.accent.enabled),
      color: hex(accent.color, d.accent.color),
      side: oneOf(accent.side, ['left', 'top', 'bottom'], d.accent.side),
      size: number(accent.size, d.accent.size, 0.5, 30),
    },
    logo: {
      enabled: flag(logo.enabled, d.logo.enabled),
      url: typeof logo.url === 'string' && logo.url.startsWith('wd-media://') ? logo.url : null,
      box: normalizeBox(logo.box, d.logo.box),
    },
    headline: normalizeText(v.headline, d.headline),
    body: normalizeText(v.body, d.body),
    align: oneOf(v.align, ['left', 'center', 'right'], d.align),
    outline: {
      enabled: flag(outline.enabled, d.outline.enabled),
      color: hex(outline.color, d.outline.color),
      width: number(outline.width, d.outline.width, 0.01, 0.15),
    },
  }
}

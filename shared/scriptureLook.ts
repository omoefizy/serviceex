// How scripture looks on screen: the Scripture display settings, read from and written to a theme's verse and
// Reference boxes; the quick adjustments of the Aa popover over them; and the contrast checks for both.
// Every translation of a verse, and both lines of two translations, use the same look.

import { AUTO_FIT_MAX, keyLuma, LUMA_KEY_THRESHOLD, newElement } from './themes'
import type { ScriptureAdjust, ThemeBox, ThemeElement, ThemeStyle, ThemeTextProps } from './types'

/** What Settings, Scripture display edits. Sizes and the offset are percent of screen height. */
export interface ScriptureLook {
  sizeMode: 'auto' | 'fixed'
  /** The verse size in fixed mode. */
  fontSize: number
  /** The largest size auto fit picks. */
  maxSize: number
  color: string
  /** A family name; empty uses the Default Font. */
  fontFamily: string
  bold: boolean
  italic: boolean
  align: ThemeTextProps['align']
  lineHeight: number
  shadow: ThemeTextProps['shadow']
  outline: ThemeTextProps['outline']
  padding: number
  /** The reference line, such as "John 3:16 KJV". */
  reference: { show: boolean; fontSize: number; color: string; fontFamily: string; position: 'above' | 'below' }
  /** Where the verse and its reference sit in the verse box. */
  position: ThemeTextProps['verticalAlign']
  /** Moves the verse and its reference up (negative) or down. */
  offset: number
}

export const SIZE_LIMITS = { min: 1, max: 30 } as const
export const OFFSET_LIMIT = 25
/** How far the nudge arrows (and Alt+Up and Down) move the verse. */
export const NUDGE_STEP = 1
/** How much the size buttons (and Cmd+Plus and Minus) change the verse size. */
export const SIZE_STEP = 0.5

type TextBoxElement = Extract<ThemeElement, { kind: 'text' }>
type LineElement = Extract<ThemeElement, { attached: boolean }>

/** The box the verse is drawn in: the first text box that shows the slide's words. */
const verseBox = (theme: ThemeStyle) => theme.elements.find((e): e is TextBoxElement => e.kind === 'text' && !e.paragraphs)
const referenceBox = (theme: ThemeStyle) => theme.elements.find((e): e is LineElement => e.kind === 'reference')
const middle = (box: ThemeBox) => box.y + box.height / 2
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const round = (value: number) => Math.round(value * 100) / 100

export const clampSize = (size: number) => round(Math.min(SIZE_LIMITS.max, Math.max(SIZE_LIMITS.min, size)))
export const clampOffset = (offset: number) => round(Math.min(OFFSET_LIMIT, Math.max(-OFFSET_LIMIT, offset)))

/** The theme's scripture look, or null for a theme with no text box for the verse. */
export function readScriptureLook(theme: ThemeStyle): ScriptureLook | null {
  const verse = verseBox(theme)
  if (!verse) return null
  const t = verse.text
  const ref = referenceBox(theme)
  const r = ref?.text ?? (newElement('reference', 'reference') as LineElement).text
  const above = ref ? (ref.attached ? ref.above === true : middle(ref.box) < middle(verse.box)) : false
  return {
    sizeMode: t.sizeMode,
    fontSize: t.fontSize,
    maxSize: t.maxSize ?? AUTO_FIT_MAX,
    color: t.color,
    fontFamily: t.fontFamily,
    bold: t.fontWeight >= 600,
    italic: t.italic,
    align: t.align,
    lineHeight: t.lineHeight,
    shadow: t.shadow,
    outline: t.outline,
    padding: t.padding,
    reference: { show: ref !== undefined, fontSize: r.fontSize, color: r.color, fontFamily: r.fontFamily, position: above ? 'above' : 'below' },
    position: t.verticalAlign,
    offset: t.offset ?? 0,
  }
}

const withOffset = (props: ThemeTextProps, offset: number): ThemeTextProps => {
  const next: ThemeTextProps = { ...props, offset }
  if (!offset) delete next.offset
  return next
}

/**
 * The theme drawn with `look`. Only what differs from the theme's own look is written, so a theme keeps its layout
 * where nothing changed: a Reference box in its own place stays there until its position is changed, which attaches
 * it just above or below the verse.
 */
export function applyScriptureLook(theme: ThemeStyle, look: ScriptureLook): ThemeStyle {
  const was = readScriptureLook(theme)
  const verse = verseBox(theme)
  if (!was || !verse) return theme
  const changed = (key: keyof ScriptureLook) => !same(look[key], was[key])

  let t: ThemeTextProps = { ...verse.text }
  if (changed('sizeMode')) t.sizeMode = look.sizeMode
  if (changed('fontSize')) t.fontSize = look.fontSize
  if (changed('maxSize')) t.maxSize = look.maxSize
  if (changed('color')) t.color = look.color
  if (changed('fontFamily')) t.fontFamily = look.fontFamily
  if (changed('bold')) t.fontWeight = look.bold ? Math.max(700, t.fontWeight) : 400
  if (changed('italic')) t.italic = look.italic
  if (changed('align')) t.align = look.align
  if (changed('lineHeight')) t.lineHeight = look.lineHeight
  if (changed('shadow')) t.shadow = look.shadow
  if (changed('outline')) t.outline = look.outline
  if (changed('padding')) t.padding = look.padding
  if (changed('position')) t.verticalAlign = look.position
  if (changed('offset')) t = withOffset(t, look.offset)
  let elements = theme.elements.map((e) => (e === verse ? { ...verse, text: t } : e))

  const ref = referenceBox(theme)
  if (!look.reference.show) return { ...theme, elements: elements.filter((e) => e !== ref) }
  // A Reference box shown again (or for the first time) is attached to the verse.
  const refChanged = (key: keyof ScriptureLook['reference']) => !ref || !same(look.reference[key], was.reference[key])
  const base = ref ?? (newElement('reference', 'reference') as LineElement)
  let r: ThemeTextProps = { ...base.text }
  if (refChanged('fontSize')) r = { ...r, sizeMode: 'fixed', fontSize: look.reference.fontSize }
  if (refChanged('color')) r.color = look.reference.color
  if (refChanged('fontFamily')) r.fontFamily = look.reference.fontFamily
  let next: LineElement = { ...base, text: r }
  if (refChanged('position')) {
    next = { ...next, attached: true, above: look.reference.position === 'above' }
    if (!next.above) delete next.above
  }
  // An attached line moves with the verse; one in its own box moves by itself.
  if ((changed('offset') || !ref) && !next.attached) next.text = withOffset(next.text, look.offset)
  elements = ref ? elements.map((e) => (e === ref ? next : e)) : [...elements, next]
  return { ...theme, elements }
}

export const isEmptyAdjust = (adjust: ScriptureAdjust | null | undefined) => !adjust || Object.keys(adjust).length === 0

/** A look with quick adjustments over it: a size makes the verse that fixed size. */
export function adjustLook(look: ScriptureLook, adjust: ScriptureAdjust): ScriptureLook {
  return {
    ...look,
    ...(adjust.fontSize !== undefined ? { sizeMode: 'fixed' as const, fontSize: adjust.fontSize } : {}),
    color: adjust.color ?? look.color,
    fontFamily: adjust.fontFamily ?? look.fontFamily,
    bold: adjust.bold ?? look.bold,
    offset: adjust.offset ?? look.offset,
  }
}

/** The theme with quick adjustments over it; unchanged when there are none or it has no verse box. */
export function adjustTheme(theme: ThemeStyle, adjust: ScriptureAdjust | null | undefined): ThemeStyle {
  const look = adjust && !isEmptyAdjust(adjust) ? readScriptureLook(theme) : null
  return look && adjust ? applyScriptureLook(theme, adjustLook(look, adjust)) : theme
}

// ---------- Contrast ----------

const channels = (color: string) => {
  const n = parseInt(color.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = (rgb: number[]) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`

/** `color` laid over `under` at `opacity`. */
const mix = (color: string, under: string, opacity: number) => {
  const a = channels(color)
  const b = channels(under)
  return toHex(a.map((c, i) => c * opacity + b[i] * (1 - opacity)))
}

/** WCAG relative luminance, 0 to 1. */
function luminance(color: string): number {
  const [r, g, b] = channels(color).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two colors, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, z) => z - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Large text on a screen needs at least this much contrast (WCAG's level for large text). */
export const MIN_CONTRAST = 3

/**
 * The colors behind the verse: the background (both ends of a gradient) darkened by the theme's darkening, or a shape
 * under the middle of the verse box. Empty for a picture or video, which could be any color.
 */
export function colorsBehind(theme: ThemeStyle): string[] {
  const bg = theme.background
  let colors: string[]
  if (theme.keyTransparent || bg.kind === 'none') colors = ['#000000']
  else if (bg.kind === 'solid') colors = [bg.color]
  else if (bg.kind === 'gradient') colors = [bg.from, bg.to]
  else if (bg.kind === 'smoke') colors = [bg.color, mix(bg.smoke, bg.color, 0.5)]
  else colors = []
  if (!theme.keyTransparent && theme.overlay > 0) colors = colors.map((c) => mix('#000000', c, theme.overlay))
  const verse = verseBox(theme)
  if (!verse) return colors
  const x = verse.box.x + verse.box.width / 2
  const y = middle(verse.box)
  const under = theme.elements
    .slice(0, theme.elements.indexOf(verse))
    .filter((e): e is Extract<ThemeElement, { kind: 'shape' }> => e.kind === 'shape' && e.opacity > 0)
    .filter((e) => x >= e.box.x && x <= e.box.x + e.box.width && y >= e.box.y && y <= e.box.y + e.box.height)
    .pop()
  if (!under) return colors
  return colors.length > 0 ? colors.map((c) => mix(under.color, c, under.opacity)) : under.opacity >= 1 ? [under.color] : []
}

/**
 * Warnings for the verse and reference colors: too close to the background to read, or (on a luma key) so dark the
 * key cuts them out along with the black.
 */
export function contrastWarnings(theme: ThemeStyle, lumaKey: boolean): string[] {
  const look = readScriptureLook(theme)
  if (!look) return []
  const behind = colorsBehind(theme)
  const lines: [string, string][] = [['Verse text', look.color]]
  if (look.reference.show) lines.push(['The reference', look.reference.color])
  const warnings: string[] = []
  for (const [name, color] of lines) {
    const worst = behind.length > 0 ? Math.min(...behind.map((c) => contrastRatio(color, c))) : null
    if (worst !== null && worst < MIN_CONTRAST) {
      warnings.push(`${name} is too close to the background color to read well (contrast ${worst.toFixed(1)}:1, aim for ${MIN_CONTRAST}:1 or more).`)
    }
    if (lumaKey && keyLuma(color) < LUMA_KEY_THRESHOLD) {
      warnings.push(`${name} is too dark for a luma key: the key would cut it out along with the black. Pick a brighter color.`)
    }
  }
  return warnings
}

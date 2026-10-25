// Live word highlighting: marks the operator puts on words of the live or preview slide by clicking them (a
// highlighter, bold, underline or a text color). They are ordinary marks in the slide's formatting (richText.ts), so
// the output, the stage display, the Stream and the thumbnails draw them like any other. A marked slide keeps the
// formatting it had before (`unmarked`), so the marks come off again word by word, or all at once.
//
// Everything here is pure, so the store, the Live and Preview boxes and the tests share one set of rules.

import { applyMarks, hasFormatting, marksInRange, normalize, orderRange, paragraphText, richOrPlain, sliceSpans, type RichMarksPatch, type RichPos, type RichRange } from './richText'
import type { HighlightColor, HighlightKind, HighlightStyle, RichMarks, RichSpan, RichText } from './types'

/**
 * `fill` goes behind highlighted words, `ink` is the Color text color. Every fill and ink is light enough not to key
 * out with a luma key (which keys on black), and each fill has a text color that reads on it (see highlightText).
 */
export const HIGHLIGHT_COLORS: { id: HighlightColor; label: string; fill: string; ink: string }[] = [
  { id: 'yellow', label: 'Yellow', fill: '#ffd60a', ink: '#ffd60a' },
  { id: 'green', label: 'Green', fill: '#30d158', ink: '#30d158' },
  { id: 'blue', label: 'Blue', fill: '#0057d9', ink: '#64b5ff' },
  { id: 'red', label: 'Red', fill: '#d70015', ink: '#ff6961' },
  { id: 'orange', label: 'Orange', fill: '#ff9f0a', ink: '#ff9f0a' },
]

export const HIGHLIGHT_KINDS: { id: HighlightKind; label: string }[] = [
  { id: 'highlight', label: 'Highlight' },
  { id: 'bold', label: 'Bold' },
  { id: 'underline', label: 'Underline' },
  { id: 'color', label: 'Color text' },
]

export const DEFAULT_HIGHLIGHT: HighlightStyle = { kind: 'highlight', color: 'yellow' }

/** Text on a highlight must reach this contrast with it (WCAG AA for normal text). */
export const MIN_CONTRAST = 4.5

/** The darkest a highlight or its text may be: darker would key out with a luma key, leaving a hole in the word. */
export const LUMA_KEY_FLOOR = 0.05

const LIGHT_TEXT = '#ffffff'
/** The dark text on light highlights: as dark as a luma key allows, not black. */
const DARK_TEXT = '#404040'

const colorOf = (id: HighlightColor) => HIGHLIGHT_COLORS.find((c) => c.id === id) ?? HIGHLIGHT_COLORS[0]

/** Relative luminance of a #rrggbb color, 0 for black to 1 for white. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** The text color for words on a highlight: white or the dark text, whichever contrasts more. */
export const highlightText = (fill: string) => (contrastRatio(fill, LIGHT_TEXT) >= contrastRatio(fill, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT)

/** The marks a style puts on words. A highlight sets the text color too, so the words read on it whatever the theme. */
export function stylePatch(style: HighlightStyle): RichMarksPatch {
  const color = colorOf(style.color)
  switch (style.kind) {
    case 'highlight':
      return { highlight: color.fill, color: highlightText(color.fill) }
    case 'bold':
      return { bold: true }
    case 'underline':
      return { underline: true }
    case 'color':
      return { color: color.ink }
  }
}

/** True when every word in `range` already has the style. */
export function hasStyle(rich: RichText, range: RichRange, style: HighlightStyle): boolean {
  const marks = marksInRange(rich, range)
  return Object.entries(stylePatch(style)).every(([key, value]) => marks[key as keyof RichMarks] === value)
}

/** `rich` with the marks `keys` in `range` put back as they are in `base` (the same words). */
export function restoreMarks(rich: RichText, base: RichText, range: RichRange, keys: (keyof RichMarks)[]): RichText {
  const { start, end } = orderRange(range)
  const paragraphs = rich.paragraphs.map((paragraph, p) => {
    if (p < start.p || p > end.p) return paragraph
    const from = p === start.p ? start.o : 0
    const to = p === end.p ? end.o : paragraphText(paragraph).length
    const baseSpans = base.paragraphs[p]?.spans ?? []
    // Cut wherever either text changes look, so each piece is one span in both.
    const cuts = new Set([from, to])
    for (const spans of [paragraph.spans, baseSpans]) {
      let at = 0
      for (const span of spans) {
        at += span.text.length
        if (at > from && at < to) cuts.add(at)
      }
    }
    const points = [...cuts].sort((a, b) => a - b)
    const restored: RichSpan[] = []
    for (let i = 0; i < points.length - 1; i++) {
      const [piece] = sliceSpans(paragraph.spans, points[i], points[i + 1])
      if (!piece) continue
      const [was] = sliceSpans(baseSpans, points[i], points[i + 1])
      const next: Record<string, unknown> = { ...piece }
      for (const key of keys) {
        if (was?.[key] === undefined) delete next[key]
        else next[key] = was[key]
      }
      restored.push(next as unknown as RichSpan)
    }
    return { ...paragraph, spans: [...sliceSpans(paragraph.spans, 0, from), ...restored, ...sliceSpans(paragraph.spans, to)] }
  })
  return normalize({ paragraphs })
}

/** Puts the style on the words in `range`, or takes it off (back to `base`) when they all have it already. */
export function toggleStyle(rich: RichText, base: RichText, range: RichRange, style: HighlightStyle): RichText {
  const patch = stylePatch(style)
  if (hasStyle(rich, range, style)) return restoreMarks(rich, base, range, Object.keys(patch) as (keyof RichMarks)[])
  return applyMarks(rich, range, patch)
}

// ---------- Words and sentences ----------

const WORD = /[\p{L}\p{N}\p{M}]+(?:['’-][\p{L}\p{N}\p{M}]+)*/gu

function words(text: string): [number, number][] {
  return [...text.matchAll(WORD)].map((m) => [m.index, m.index + m[0].length])
}

/** The word at offset `o` of a paragraph (a caret just after a word counts as on it), or null between words. */
export function wordAt(rich: RichText, pos: RichPos): RichRange | null {
  const paragraph = rich.paragraphs[pos.p]
  if (!paragraph) return null
  const found = words(paragraphText(paragraph)).find(([start, end]) => pos.o >= start && pos.o <= end)
  return found ? { start: { p: pos.p, o: found[0] }, end: { p: pos.p, o: found[1] } } : null
}

/** The words from one place to another, either way round, widened to whole words; null when no word is between them. */
export function wordsBetween(rich: RichText, a: RichPos, b: RichPos): RichRange | null {
  const { start, end } = orderRange({ start: a, end: b })
  const first = wordAt(rich, start)?.start ?? nextWord(rich, start)
  const last = wordAt(rich, end)?.end ?? previousWord(rich, end)
  if (!first || !last || first.p > last.p || (first.p === last.p && first.o >= last.o)) return null
  return { start: first, end: last }
}

function nextWord(rich: RichText, pos: RichPos): RichPos | null {
  for (let p = pos.p; p < rich.paragraphs.length; p++) {
    const found = words(paragraphText(rich.paragraphs[p])).find(([start]) => p > pos.p || start >= pos.o)
    if (found) return { p, o: found[0] }
  }
  return null
}

function previousWord(rich: RichText, pos: RichPos): RichPos | null {
  for (let p = pos.p; p >= 0; p--) {
    const found = words(paragraphText(rich.paragraphs[p])).filter(([, end]) => p < pos.p || end <= pos.o).at(-1)
    if (found) return { p, o: found[1] }
  }
  return null
}

/** Where a sentence ends: its stop and any closing quotes or brackets. */
const SENTENCE_END = /[.!?…]+["'”’)\]]*/g

/** The sentence around a place, across line breaks, without the spaces around it. */
export function sentenceAt(rich: RichText, pos: RichPos): RichRange | null {
  const lines = rich.paragraphs.map(paragraphText)
  const text = lines.join('\n')
  const offset = lines.slice(0, pos.p).reduce((sum, line) => sum + line.length + 1, 0) + pos.o
  let start = 0
  let end = text.length
  for (const m of text.matchAll(SENTENCE_END)) {
    const stop = m.index + m[0].length
    if (stop <= offset) start = stop
    else {
      end = stop
      break
    }
  }
  while (start < end && /\s/.test(text[start])) start++
  while (end > start && /\s/.test(text[end - 1])) end--
  if (start >= end) return null
  return { start: posAt(lines, start), end: posAt(lines, end) }
}

function posAt(lines: string[], offset: number): RichPos {
  let rest = offset
  for (let p = 0; p < lines.length; p++) {
    if (rest <= lines[p].length) return { p, o: rest }
    rest -= lines[p].length + 1
  }
  return { p: lines.length - 1, o: lines[lines.length - 1].length }
}

// ---------- Slides ----------

/** What marking needs of a slide: its words, its formatting, and its formatting before any marks. */
export interface MarkableSlide {
  text: string
  rich?: RichText | null
  /** The slide's own formatting before live highlighting, kept to take the marks off; set only while it has some. */
  unmarked?: RichText
}

const sameRich = (a: RichText, b: RichText) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))

/** `slide` showing `rich`; when that is just its formatting from before, the marks are gone and so is `unmarked`. */
function withRich<T extends MarkableSlide>(slide: T, rich: RichText, base: RichText): T {
  const next = { ...slide }
  delete next.rich
  delete next.unmarked
  if (!sameRich(rich, base)) return { ...next, rich, unmarked: base }
  return hasFormatting(base) ? { ...next, rich: base } : next
}

/** The slide's words as formatted text, marks and all. */
export const slideRich = (slide: MarkableSlide): RichText => richOrPlain(slide.rich, slide.text)

/** `slide` with `style` toggled on the words in `range` (see toggleStyle). */
export function markSlide<T extends MarkableSlide>(slide: T, range: RichRange, style: HighlightStyle): T {
  const base = slide.unmarked ?? slideRich(slide)
  return withRich(slide, toggleStyle(slideRich(slide), base, range, style), base)
}

/** `slide` without its marks, back to its own formatting. */
export function unmarkSlide<T extends MarkableSlide>(slide: T): T {
  return slide.unmarked ? withRich(slide, slide.unmarked, slide.unmarked) : slide
}

/** True when the slide has live marks on it. */
export const isMarked = (slide: MarkableSlide | null | undefined) => !!slide?.unmarked

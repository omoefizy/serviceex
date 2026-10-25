// Formatted slide text: paragraphs of spans with a few marks (see RichText in types.ts). The plain text stays the
// source everywhere else (search, the AI features, the speech matcher); formatting is kept next to it and used only
// while its plain text still matches, so an edit made anywhere else can never show stale words.
//
// Everything here is pure, so the editor, the renderer, the main process and the tests share one set of rules.

import type {
  RichMarks,
  RichParagraph,
  RichParagraphStyle,
  RichSpan,
  RichText,
  SlideFormats,
  TextCase,
  ThemeTextParagraph,
  ThemeTextProps,
  ThemeTextRun,
} from './types'

export const MARK_KEYS = ['bold', 'italic', 'underline', 'strike', 'color', 'highlight', 'size', 'font', 'textCase'] as const
export const PARAGRAPH_KEYS = ['align', 'verticalAlign', 'lineHeight'] as const

/** Font size multiples and line spacing a formatted text may use. */
export const SIZE_LIMITS = [0.25, 4] as const
export const LINE_HEIGHT_LIMITS = [0.5, 3] as const

const LIMITS = { paragraphs: 2000, spans: 500, text: 20000, font: 200, formats: 2000 }

/** A change to marks: a value sets it, null puts the theme's back. */
export type RichMarksPatch = { [K in keyof RichMarks]?: RichMarks[K] | null }
export type RichParagraphPatch = { [K in keyof RichParagraphStyle]?: RichParagraphStyle[K] | null }

/** A place in a formatted text: paragraph `p`, `o` characters in. */
export interface RichPos {
  p: number
  o: number
}

export interface RichRange {
  start: RichPos
  end: RichPos
}

// ---------- Reading ----------

export const paragraphText = (paragraph: RichParagraph) => paragraph.spans.map((span) => span.text).join('')

/** The plain text: paragraphs joined with line breaks. */
export const plainText = (rich: RichText) => rich.paragraphs.map(paragraphText).join('\n')

export function spanMarks(span: RichMarks): RichMarks {
  const marks: RichMarks = {}
  for (const key of MARK_KEYS) if (span[key] !== undefined) (marks as Record<string, unknown>)[key] = span[key]
  return marks
}

export function paragraphStyle(paragraph: RichParagraphStyle): RichParagraphStyle {
  const style: RichParagraphStyle = {}
  for (const key of PARAGRAPH_KEYS) if (paragraph[key] !== undefined) (style as Record<string, unknown>)[key] = paragraph[key]
  return style
}

const sameMarks = (a: RichMarks, b: RichMarks) => MARK_KEYS.every((key) => a[key] === b[key])

/** True when anything differs from the theme. */
export function hasFormatting(rich: RichText): boolean {
  return rich.paragraphs.some(
    (p) => PARAGRAPH_KEYS.some((key) => p[key] !== undefined) || p.spans.some((span) => MARK_KEYS.some((key) => span[key] !== undefined)),
  )
}

/** Plain text as a formatted text with no formatting: a paragraph per line. */
export function fromPlain(text: string): RichText {
  return { paragraphs: text.replace(/\r\n?/g, '\n').split('\n').map((line) => ({ spans: line ? [{ text: line }] : [] })) }
}

/** `rich` when its plain text is `text`, else null: formatting that no longer matches its words is never shown. */
export const matching = (rich: RichText | null | undefined, text: string): RichText | null => (rich && plainText(rich) === text ? rich : null)

/** `rich` when it matches `text`, else `text` without formatting. */
export const richOrPlain = (rich: RichText | null | undefined, text: string): RichText => matching(rich, text) ?? fromPlain(text)

/** Merges neighbouring spans that look alike, drops empty ones and always leaves at least one paragraph. */
export function normalize(rich: RichText): RichText {
  const paragraphs = rich.paragraphs.map((paragraph) => {
    const spans: RichSpan[] = []
    for (const span of paragraph.spans) {
      if (!span.text) continue
      const last = spans[spans.length - 1]
      if (last && sameMarks(last, span)) spans[spans.length - 1] = { ...last, text: last.text + span.text }
      else spans.push({ ...spanMarks(span), text: span.text })
    }
    return { ...paragraphStyle(paragraph), spans }
  })
  return { paragraphs: paragraphs.length > 0 ? paragraphs : [{ spans: [] }] }
}

// ---------- Positions ----------

export const comparePos = (a: RichPos, b: RichPos) => a.p - b.p || a.o - b.o

export const orderRange = ({ start, end }: RichRange): RichRange => (comparePos(start, end) <= 0 ? { start, end } : { start: end, end: start })

export const isCollapsed = (range: RichRange) => comparePos(range.start, range.end) === 0

export function clampPos(rich: RichText, pos: RichPos): RichPos {
  const p = Math.min(Math.max(0, pos.p), rich.paragraphs.length - 1)
  return { p, o: Math.min(Math.max(0, pos.o), paragraphText(rich.paragraphs[p]).length) }
}

/** The whole text as a range. */
export function wholeRange(rich: RichText): RichRange {
  const last = rich.paragraphs.length - 1
  return { start: { p: 0, o: 0 }, end: { p: last, o: paragraphText(rich.paragraphs[last]).length } }
}

/** The spans between two offsets of a paragraph, cut where needed. */
export function sliceSpans(spans: RichSpan[], from: number, to = Infinity): RichSpan[] {
  const result: RichSpan[] = []
  let at = 0
  for (const span of spans) {
    const start = at
    const end = at + span.text.length
    at = end
    if (end <= from || start >= to) continue
    const text = span.text.slice(Math.max(0, from - start), Math.min(span.text.length, to - start))
    if (text) result.push({ ...span, text })
  }
  return result
}

/** Spans without the spaces at either end. */
export function trimSpans(spans: RichSpan[]): RichSpan[] {
  const text = spans.map((span) => span.text).join('')
  const start = text.length - text.trimStart().length
  return sliceSpans(spans, start, text.trimEnd().length)
}

/** The part of `rich` between two offsets of its plain text. */
export function sliceRich(rich: RichText, from: number, to: number): RichText {
  const paragraphs: RichParagraph[] = []
  let at = 0
  rich.paragraphs.forEach((paragraph) => {
    const length = paragraphText(paragraph).length
    const start = at
    at += length + 1
    if (start + length < from || start > to) return
    paragraphs.push({ ...paragraphStyle(paragraph), spans: sliceSpans(paragraph.spans, from - start, to - start) })
  })
  return normalize({ paragraphs })
}

/** Without the spaces and blank lines at either end, like String.trim on the plain text. */
export function trimRich(rich: RichText): RichText {
  const text = plainText(rich)
  return sliceRich(rich, text.length - text.trimStart().length, text.trimEnd().length)
}

// ---------- Editing ----------

/** The marks typing at `range` uses: those of the first chosen letter, or of the letter before the caret. */
export function typingMarks(rich: RichText, range: RichRange): RichMarks {
  const { start } = orderRange(range)
  const paragraph = rich.paragraphs[start.p]
  if (!paragraph) return {}
  const collapsed = isCollapsed(range)
  const at = collapsed ? Math.max(0, start.o - 1) : start.o
  const [span] = sliceSpans(paragraph.spans, at, at + 1)
  return spanMarks(span ?? paragraph.spans[0] ?? {})
}

/** Removes what is in `range`, joining its first and last paragraphs. */
export function deleteRange(rich: RichText, range: RichRange): { rich: RichText; caret: RichPos } {
  const { start, end } = orderRange(range)
  if (isCollapsed({ start, end })) return { rich, caret: start }
  const first = rich.paragraphs[start.p]
  const last = rich.paragraphs[end.p]
  const joined: RichParagraph = { ...paragraphStyle(first), spans: [...sliceSpans(first.spans, 0, start.o), ...sliceSpans(last.spans, end.o)] }
  const paragraphs = [...rich.paragraphs.slice(0, start.p), joined, ...rich.paragraphs.slice(end.p + 1)]
  return { rich: normalize({ paragraphs }), caret: start }
}

/**
 * Puts `text` in place of `range`, in `marks` (by default those of the letter before). Line breaks in `text` start
 * new paragraphs, which take the look of the one they split.
 */
export function insertText(rich: RichText, range: RichRange, text: string, marks?: RichMarks): { rich: RichText; caret: RichPos } {
  const look = marks ?? typingMarks(rich, range)
  const { rich: cleared, caret } = deleteRange(rich, range)
  const paragraph = cleared.paragraphs[caret.p]
  const before = sliceSpans(paragraph.spans, 0, caret.o)
  const after = sliceSpans(paragraph.spans, caret.o)
  const style = paragraphStyle(paragraph)
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const made: RichParagraph[] = lines.map((line, index) => ({
    ...style,
    spans: [...(index === 0 ? before : []), ...(line ? [{ ...look, text: line }] : []), ...(index === lines.length - 1 ? after : [])],
  }))
  const paragraphs = [...cleared.paragraphs.slice(0, caret.p), ...made, ...cleared.paragraphs.slice(caret.p + 1)]
  const lastLine = lines[lines.length - 1]
  return {
    rich: normalize({ paragraphs }),
    caret: { p: caret.p + lines.length - 1, o: (lines.length === 1 ? caret.o : 0) + lastLine.length },
  }
}

function patchMarks(span: RichSpan, patch: RichMarksPatch): RichSpan {
  const next: Record<string, unknown> = { ...span }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete next[key]
    else next[key] = value
  }
  return next as unknown as RichSpan
}

/** Changes the marks of everything in `range`. */
export function applyMarks(rich: RichText, range: RichRange, patch: RichMarksPatch): RichText {
  const { start, end } = orderRange(range)
  const paragraphs = rich.paragraphs.map((paragraph, p) => {
    if (p < start.p || p > end.p) return paragraph
    const from = p === start.p ? start.o : 0
    const to = p === end.p ? end.o : Infinity
    return {
      ...paragraph,
      spans: [
        ...sliceSpans(paragraph.spans, 0, from),
        ...sliceSpans(paragraph.spans, from, to).map((span) => patchMarks(span, patch)),
        ...sliceSpans(paragraph.spans, to),
      ],
    }
  })
  return normalize({ paragraphs })
}

/** Changes the paragraph style of the paragraphs `range` touches. */
export function applyParagraphStyle(rich: RichText, range: RichRange, patch: RichParagraphPatch): RichText {
  const { start, end } = orderRange(range)
  const paragraphs = rich.paragraphs.map((paragraph, p) => {
    if (p < start.p || p > end.p) return paragraph
    const next: Record<string, unknown> = { ...paragraph }
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined) delete next[key]
      else next[key] = value
    }
    return next as unknown as RichParagraph
  })
  return normalize({ paragraphs })
}

/** Takes every mark off what is in `range` (the whole paragraph when nothing is chosen) and its paragraph style. */
export function clearFormatting(rich: RichText, range: RichRange): RichText {
  const { start, end } = orderRange(range)
  const target = isCollapsed(range) ? { start: { p: start.p, o: 0 }, end: { p: end.p, o: paragraphText(rich.paragraphs[end.p]).length } } : { start, end }
  const noMarks = Object.fromEntries(MARK_KEYS.map((key) => [key, null])) as RichMarksPatch
  const noStyle = Object.fromEntries(PARAGRAPH_KEYS.map((key) => [key, null])) as RichParagraphPatch
  return applyParagraphStyle(applyMarks(rich, target, noMarks), target, noStyle)
}

/** The marks everything in `range` shares (a mark that differs is left out), for the toolbar. */
export function marksInRange(rich: RichText, range: RichRange): RichMarks {
  if (isCollapsed(range)) return typingMarks(rich, range)
  const { start, end } = orderRange(range)
  let shared: RichMarks | null = null
  for (let p = start.p; p <= end.p; p++) {
    const paragraph = rich.paragraphs[p]
    const spans = sliceSpans(paragraph.spans, p === start.p ? start.o : 0, p === end.p ? end.o : Infinity)
    for (const span of spans) {
      const marks = spanMarks(span)
      if (shared === null) shared = marks
      else for (const key of MARK_KEYS) if (shared[key] !== marks[key]) delete shared[key]
    }
  }
  return shared ?? typingMarks(rich, range)
}

/** The vertical alignment a slide asks for: its first paragraph that sets one. */
export const richVerticalAlign = (rich: RichText) => rich.paragraphs.find((p) => p.verticalAlign !== undefined)?.verticalAlign

// ---------- Slides ----------

/**
 * Splits a formatted text into slides on blank lines, each trimmed, exactly as splitIntoSlides (src/lib/slides.ts)
 * splits its plain text, so each slide's formatting lines up with its words.
 */
export function splitRichSlides(rich: RichText): RichText[] {
  const slides: RichText[] = []
  let current: RichParagraph[] = []
  const flush = () => {
    if (current.length > 0) slides.push(trimRich({ paragraphs: current }))
    current = []
  }
  for (const paragraph of rich.paragraphs) {
    if (paragraphText(paragraph).trim() === '') flush()
    else current.push(paragraph)
  }
  flush()
  return slides.filter((slide) => plainText(slide) !== '')
}

const hasKey = (formats: SlideFormats, key: string) => Object.prototype.hasOwnProperty.call(formats, key)

/** A slide's formatting, if it has any that still matches its words. */
export function formatFor(formats: SlideFormats | null | undefined, text: string): RichText | undefined {
  if (!formats || !hasKey(formats, text)) return undefined
  return matching(formats[text], text) ?? undefined
}

/** Sets or (with null, or a text with no formatting) removes a slide's formatting. Never mutates `formats`. */
export function setFormat(formats: SlideFormats, text: string, rich: RichText | null): SlideFormats {
  const keep = rich !== null && hasFormatting(rich) && plainText(rich) === text
  // fromEntries makes own properties, so a slide reading "__proto__" is stored like any other.
  return Object.fromEntries([...Object.entries(formats).filter(([key]) => key !== text), ...(keep ? [[text, normalize(rich)]] : [])])
}

/** Only the formatting of slides that still exist. */
export function pruneFormats(formats: SlideFormats, texts: string[]): SlideFormats {
  const live = new Set(texts)
  return Object.fromEntries(Object.entries(formats).filter(([key, rich]) => live.has(key) && matching(rich, key)))
}

/** A slide's words changed in the editor: its formatting moves to the new words, left behind for any slide still using the old ones. */
export function renameFormat(formats: SlideFormats, oldText: string, newText: string, rich: RichText, texts: string[]): SlideFormats {
  const stillUsed = texts.some((text) => text === oldText)
  return setFormat(stillUsed ? formats : setFormat(formats, oldText, null), newText, rich)
}

/** The look of a slide as a whole, for Apply to all: its first letter's marks and its first paragraph's style. */
export function styleOf(rich: RichText): { marks: RichMarks; paragraph: RichParagraphStyle } {
  const first = rich.paragraphs.find((p) => p.spans.length > 0) ?? rich.paragraphs[0]
  return { marks: spanMarks(first?.spans[0] ?? {}), paragraph: paragraphStyle(rich.paragraphs[0] ?? { spans: [] }) }
}

/** `text` in one look throughout. */
export function withStyle(text: string, style: { marks: RichMarks; paragraph: RichParagraphStyle }): RichText {
  return normalize({ paragraphs: fromPlain(text).paragraphs.map((p) => ({ ...style.paragraph, spans: p.spans.map((span) => ({ ...style.marks, ...span })) })) })
}

/** Gives every slide in `texts` the look of `rich` (Apply to all slides, Apply to this section). */
export function applyStyleTo(formats: SlideFormats, texts: string[], rich: RichText): SlideFormats {
  const style = styleOf(rich)
  return [...new Set(texts)].reduce((result, text) => setFormat(result, text, withStyle(text, style)), formats)
}

// ---------- Checking stored values ----------

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const hexColor = (value: unknown) => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined)
const ranged = (value: unknown, [min, max]: readonly [number, number]) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.min(max, Math.max(min, value)) * 1000) / 1000 : undefined
const oneOf = <T extends string>(value: unknown, options: readonly T[]) => (options.includes(value as T) ? (value as T) : undefined)
/** A family name or CSS font stack: no characters that could end a CSS value. */
const fontName = (value: unknown) =>
  typeof value === 'string' && value.trim() && value.length <= LIMITS.font && !/[;{}<>\\\n\r]/.test(value) ? value.trim() : undefined

const TEXT_CASES: readonly TextCase[] = ['normal', 'upper', 'lower']

function sanitizeSpan(value: unknown): RichSpan | null {
  if (!isRecord(value) || typeof value.text !== 'string' || /[\r\n]/.test(value.text)) return null
  const span: RichSpan = { text: value.text }
  for (const key of ['bold', 'italic', 'underline', 'strike'] as const) if (typeof value[key] === 'boolean') span[key] = value[key] as boolean
  const color = hexColor(value.color)
  const highlight = hexColor(value.highlight)
  const size = ranged(value.size, SIZE_LIMITS)
  const font = fontName(value.font)
  const textCase = oneOf(value.textCase, TEXT_CASES)
  if (color) span.color = color
  if (highlight) span.highlight = highlight
  if (size !== undefined) span.size = size
  if (font) span.font = font
  if (textCase) span.textCase = textCase
  return span
}

/**
 * A stored formatted text with every field checked, unknown ones dropped, or null when it is not one. Only this
 * schema is ever stored or drawn: never HTML.
 */
export function sanitizeRichText(value: unknown): RichText | null {
  if (!isRecord(value) || !Array.isArray(value.paragraphs) || value.paragraphs.length > LIMITS.paragraphs) return null
  const paragraphs: RichParagraph[] = []
  let length = 0
  for (const item of value.paragraphs) {
    if (!isRecord(item) || !Array.isArray(item.spans) || item.spans.length > LIMITS.spans) return null
    const spans: RichSpan[] = []
    for (const raw of item.spans) {
      const span = sanitizeSpan(raw)
      if (!span) return null
      length += span.text.length
      spans.push(span)
    }
    const paragraph: RichParagraph = { spans }
    const align = oneOf(item.align, ['left', 'center', 'right', 'justify'] as const)
    const verticalAlign = oneOf(item.verticalAlign, ['top', 'middle', 'bottom'] as const)
    const lineHeight = ranged(item.lineHeight, LINE_HEIGHT_LIMITS)
    if (align) paragraph.align = align
    if (verticalAlign) paragraph.verticalAlign = verticalAlign
    if (lineHeight !== undefined) paragraph.lineHeight = lineHeight
    paragraphs.push(paragraph)
  }
  if (length > LIMITS.text) return null
  return normalize({ paragraphs })
}

/** Stored slide formats with every entry checked; entries that are broken or no longer match their key are dropped. */
export function sanitizeSlideFormats(value: unknown): SlideFormats {
  if (!isRecord(value)) return {}
  const entries: [string, RichText][] = []
  for (const [key, raw] of Object.entries(value).slice(0, LIMITS.formats)) {
    const rich = sanitizeRichText(raw)
    if (rich && plainText(rich) === key && hasFormatting(rich)) entries.push([key, rich])
  }
  return Object.fromEntries(entries)
}

/** A stored formatted text for `text`, or undefined when there is none, it is broken or it no longer matches. */
export function sanitizeRichFor(value: unknown, text: string): RichText | undefined {
  const rich = value === undefined ? null : sanitizeRichText(value)
  return rich && plainText(rich) === text && hasFormatting(rich) ? rich : undefined
}

// ---------- Imported PowerPoint text boxes ----------

/** An imported text box's paragraphs as a formatted text. Run sizes are in percent of screen height, so they become multiples of the box's. */
export function richFromParagraphs(paragraphs: ThemeTextParagraph[], props: ThemeTextProps): RichText {
  return normalize({
    paragraphs: paragraphs.map((paragraph) => ({
      ...(paragraph.align ? { align: paragraph.align } : {}),
      ...(paragraph.lineHeight !== undefined ? { lineHeight: paragraph.lineHeight } : {}),
      spans: paragraph.runs.map((run) =>
        withoutUndefined({
          text: run.text,
          bold: run.bold,
          italic: run.italic,
          underline: run.underline,
          strike: run.strike,
          color: run.color,
          highlight: run.highlight,
          font: run.fontFamily,
          textCase: run.textCase,
          size: run.fontSize !== undefined && props.fontSize > 0 ? Math.round((run.fontSize / props.fontSize) * 1000) / 1000 : undefined,
        }),
      ),
    })),
  })
}

/**
 * A formatted text back as a text box's paragraphs, keeping each paragraph's bullet, and the vertical alignment it
 * asks for (which belongs to the box).
 */
export function paragraphsFromRich(
  rich: RichText,
  original: ThemeTextParagraph[],
  props: ThemeTextProps,
): { paragraphs: ThemeTextParagraph[]; verticalAlign: ThemeTextProps['verticalAlign'] | undefined } {
  const paragraphs = rich.paragraphs.map((paragraph, index): ThemeTextParagraph => {
    const bullet = original[index]?.bullet
    return withoutUndefined({
      runs: paragraph.spans.map(
        (span): ThemeTextRun =>
          withoutUndefined({
            text: span.text,
            fontFamily: span.font,
            fontSize: span.size !== undefined ? Math.round(span.size * props.fontSize * 100) / 100 : undefined,
            color: span.color,
            bold: span.bold,
            italic: span.italic,
            underline: span.underline,
            strike: span.strike,
            highlight: span.highlight,
            textCase: span.textCase,
          }),
      ),
      align: paragraph.align,
      lineHeight: paragraph.lineHeight,
      bullet,
    })
  })
  return { paragraphs, verticalAlign: richVerticalAlign(rich) }
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

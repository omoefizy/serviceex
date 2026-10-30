// Auto layout for designs, as in Figma: text that grows with its words, shapes and pictures fitted to a text element as
// its background, pins that keep the other elements in place as the lower third grows, and 9 slice pictures whose
// corners keep their size. Pure, so the designer, Preview, the outputs and the tests lay a design out the same way;
// only measuring the words' width is handed in (the renderer measures with a canvas, the tests with a fixed width per
// character). Boxes are percent of the canvas (see ThemeBox); font sizes percent of its height.

import { shownText } from './designs'
import type { DesignElement, DesignFitToText, DesignGrowth, DesignInsets, DesignTextField, TextCase, ThemeBox } from './types'

type Text = Extract<DesignElement, { kind: 'text' }>

/** The width of one line of `words` in `element`'s font, in percent of the canvas width, unwrapped. */
export type MeasureLine = (element: Text, words: string) => number

/** The smallest box a stretching element shrinks to, in percent. */
const MIN_SIZE = 0.5

const CASES: Record<TextCase, (words: string) => string> = { normal: (w) => w, upper: (w) => w.toUpperCase(), lower: (w) => w.toLowerCase() }

/** The words as drawn: in the element's case, so they measure as they show. */
export const casedText = (element: Text, words: string) => CASES[element.textCase](words)

/** Splits `words` into the lines they wrap to at `maxWidth`, a word at a time; a word too long for a line keeps one. */
export function wrapLines(element: Text, words: string, maxWidth: number | null, measure: MeasureLine): string[] {
  const lines: string[] = []
  for (const paragraph of casedText(element, words).split('\n')) {
    if (maxWidth === null || measure(element, paragraph) <= maxWidth) {
      lines.push(paragraph)
      continue
    }
    let line = ''
    for (const word of paragraph.split(/ +/)) {
      const tried = line ? `${line} ${word}` : word
      if (line && measure(element, tried) > maxWidth) {
        lines.push(line)
        line = word
      } else line = tried
    }
    lines.push(line)
  }
  return lines
}

/** The height of `lines` lines of `element`, in percent of the canvas height. */
export const linesHeight = (element: Text, lines: number) => lines * element.fontSize * element.lineHeight

const stretches = (e: DesignElement): e is Text => e.kind === 'text' && (e.sizing === 'autoWidth' || e.sizing === 'autoHeight')

/** The way a text element grows: its first fitted shape's anchor, else its alignment (left aligned grows right). */
export function growthOf(text: Text, elements: DesignElement[]): { x: 'start' | 'end' | 'center'; y: 'start' | 'end' | 'center' } {
  const anchor: DesignGrowth | undefined = elements.find((e) => e.fitToText?.textId === text.id && !e.hidden)?.fitToText?.anchor
  const byAlign = text.align === 'left' ? 'start' : text.align === 'right' ? 'end' : 'center'
  const byVertical = text.verticalAlign === 'top' ? 'start' : text.verticalAlign === 'bottom' ? 'end' : 'center'
  return {
    // The edge that stays: growing right keeps the left edge (start).
    x: anchor === 'right' ? 'start' : anchor === 'left' ? 'end' : anchor === 'center' ? 'center' : byAlign,
    y: anchor === 'down' ? 'start' : anchor === 'up' ? 'end' : anchor === 'center' ? 'center' : byVertical,
  }
}

/** Places a size along one axis, keeping the start edge, the end edge or the centre of `from`. */
function place(start: number, size: number, newSize: number, keep: 'start' | 'end' | 'center'): number {
  if (keep === 'start') return start
  if (keep === 'end') return start + size - newSize
  return start + (size - newSize) / 2
}

export interface TextLayout {
  box: ThemeBox
  lines: string[]
  /** True when the words need more room than the maximum size: they wrap, then shrink when that is on. */
  overflow: boolean
}

/**
 * A stretching text element's box for `words`. Auto width hugs the longest line up to the maximum width, then wraps;
 * Auto height wraps at the box's width. Either grows taller as lines are added, up to the maximum height, and never gets
 * shorter than designed, so a single line keeps its place in its bar.
 */
export function textBox(element: Text, words: string, elements: DesignElement[], measure: MeasureLine): TextLayout {
  const stored = element.box
  if (!stretches(element)) return { box: stored, lines: casedText(element, words).split('\n'), overflow: false }
  const growth = growthOf(element, elements)
  // A little room past the measured width, so the browser never wraps a line the measure fitted.
  const slack = element.fontSize * 0.05
  let width = stored.width
  let lines: string[]
  if (element.sizing === 'autoWidth') {
    const natural = Math.max(0, ...casedText(element, words).split('\n').map((line) => measure(element, line))) + slack
    width = Math.max(MIN_SIZE, Math.min(element.maxWidth, natural))
    lines = wrapLines(element, words, natural > element.maxWidth ? element.maxWidth - slack : null, measure)
  } else {
    lines = wrapLines(element, words, Math.max(MIN_SIZE, stored.width - slack), measure)
  }
  const needed = linesHeight(element, lines.length)
  const height = Math.max(stored.height, Math.min(element.maxHeight, needed))
  const overflow = needed > height + 0.01
  return {
    box: { x: place(stored.x, stored.width, width, growth.x), y: place(stored.y, stored.height, height, growth.y), width, height },
    lines,
    overflow,
  }
}

/** A shape's box fitted to a text element's box `text`: the text's box with padding, within the width limits. */
export function fittedBox(stored: ThemeBox, text: ThemeBox, fit: DesignFitToText, keep: 'start' | 'end' | 'center'): ThemeBox {
  const { padding: p } = fit
  let { x, y, width, height } = stored
  if (fit.axes !== 'height') {
    const wanted = text.width + p.left + p.right
    width = Math.max(fit.minWidth, MIN_SIZE, fit.maxWidth > 0 ? Math.min(fit.maxWidth, wanted) : wanted)
    // Held to a limit, it keeps the edge (or centre) the text grows from.
    x = place(text.x - p.left, wanted, width, keep)
  }
  if (fit.axes !== 'width') {
    height = Math.max(MIN_SIZE, text.height + p.top + p.bottom)
    y = text.y - p.top
  }
  return { x, y, width, height }
}

/** The padding that keeps `shape` where it is around `text`: what linking a shape to a text starts with. */
export function paddingBetween(shape: ThemeBox, text: ThemeBox): DesignInsets {
  const round = (n: number) => Math.round(n * 100) / 100
  return {
    top: round(Math.max(0, text.y - shape.y)),
    right: round(Math.max(0, shape.x + shape.width - (text.x + text.width))),
    bottom: round(Math.max(0, shape.y + shape.height - (text.y + text.height))),
    left: round(Math.max(0, text.x - shape.x)),
  }
}

/** Which of an element's sizes the layout sets from text, not its pins. */
function drivenAxes(e: DesignElement, byId: Map<string, DesignElement>): { x: boolean; y: boolean } {
  if (stretches(e)) return { x: true, y: true }
  const fit = e.fitToText
  const target = fit ? byId.get(fit.textId) : undefined
  if (!fit || target?.kind !== 'text' || target.hidden) return { x: false, y: false }
  return { x: fit.axes !== 'height', y: fit.axes !== 'width' }
}

/** The boxes of the text and the shapes fitted to it, for the given words (the samples when `fields` is undefined). */
function drivenBoxes(elements: DesignElement[], fields: Partial<Record<DesignTextField, string>> | undefined, measure: MeasureLine) {
  const texts = new Map<string, TextLayout>()
  for (const e of elements) if (e.kind === 'text' && !e.hidden) texts.set(e.id, textBox(e, shownText(e, fields), elements, measure))
  const boxes = new Map<string, ThemeBox>()
  for (const e of elements) {
    if (e.hidden) continue
    if (stretches(e)) boxes.set(e.id, texts.get(e.id)!.box)
    else if (e.fitToText) {
      const text = texts.get(e.fitToText.textId)
      const target = elements.find((t) => t.id === e.fitToText!.textId)
      if (text && target?.kind === 'text') boxes.set(e.id, fittedBox(e.box, text.box, e.fitToText, growthOf(target, elements).x))
    }
  }
  return { boxes, texts }
}

export interface DesignLayout {
  /** Every visible element's box as drawn. */
  boxes: Map<string, ThemeBox>
  /** Stretching text elements whose words need more room than their maximum size. */
  overflow: Set<string>
}

type Edges = { start: number; end: number }

/** One axis's pin: where an element's start and size go when the group's edges move from `before` to `after`. */
function pin(start: number, size: number, how: 'start' | 'end' | 'center' | 'scale', before: Edges, after: Edges): [number, number] {
  const dStart = after.start - before.start
  const dEnd = after.end - before.end
  if (Math.abs(dStart) < 1e-9 && Math.abs(dEnd) < 1e-9) return [start, size]
  if (how === 'start') return [start + dStart, size]
  if (how === 'end') return [start + dEnd, size]
  if (how === 'center') return [start + (dStart + dEnd) / 2, size]
  const span = before.end - before.start
  const scale = span > 0 ? (after.end - after.start) / span : 1
  return [after.start + (start - before.start) * scale, size * scale]
}

const PIN_X = { left: 'start', right: 'end', center: 'center', scale: 'scale' } as const
const PIN_Y = { top: 'start', bottom: 'end', center: 'center', scale: 'scale' } as const

/** The span of the boxes along one axis, or null with none. */
function span(boxes: ThemeBox[], axis: 'x' | 'y'): Edges | null {
  if (boxes.length === 0) return null
  const size = axis === 'x' ? 'width' : 'height'
  return { start: Math.min(...boxes.map((b) => b[axis])), end: Math.max(...boxes.map((b) => b[axis] + b[size])) }
}

/**
 * Lays a design out for `fields` (the bound words; undefined shows the samples, as the designer does). Stretching text
 * and the shapes fitted to it are sized to the words. The lower third group (all the visible elements) grows or shrinks
 * by as much as they do, measured against the samples, and every other element keeps to its pins within it: pinned
 * left it moves with the group's left edge, pinned right with its right edge, centred with its middle, and Scale keeps
 * its share of the group. With the samples nothing moves from where it was designed.
 */
export function layoutDesign(elements: DesignElement[], fields: Partial<Record<DesignTextField, string>> | undefined, measure: MeasureLine): DesignLayout {
  const visible = elements.filter((e) => !e.hidden)
  const byId = new Map(visible.map((e) => [e.id, e]))
  const actual = drivenBoxes(visible, fields, measure)
  const reference = fields === undefined ? actual : drivenBoxes(visible, undefined, measure)
  const axes = new Map(visible.map((e) => [e.id, drivenAxes(e, byId)]))

  // The group's edges move as far as the edges of what stretches.
  const group = { x: span(visible.map((e) => e.box), 'x'), y: span(visible.map((e) => e.box), 'y') }
  const moved = (axis: 'x' | 'y'): { before: Edges; after: Edges } | null => {
    const ids = visible.filter((e) => axes.get(e.id)![axis] && actual.boxes.has(e.id)).map((e) => e.id)
    const was = span(ids.map((id) => reference.boxes.get(id)!), axis)
    const now = span(ids.map((id) => actual.boxes.get(id)!), axis)
    const before = group[axis]
    if (!was || !now || !before) return null
    return { before, after: { start: before.start + now.start - was.start, end: before.end + now.end - was.end } }
  }
  const mx = moved('x')
  const my = moved('y')

  const boxes = new Map<string, ThemeBox>()
  for (const e of visible) {
    const driven = axes.get(e.id)!
    const own = actual.boxes.get(e.id) ?? e.box
    let [x, width] = [e.box.x, e.box.width]
    let [y, height] = [e.box.y, e.box.height]
    if (driven.x && actual.boxes.has(e.id)) [x, width] = [own.x, own.width]
    else if (mx) [x, width] = pin(e.box.x, e.box.width, PIN_X[e.constraints.horizontal], mx.before, mx.after)
    if (driven.y && actual.boxes.has(e.id)) [y, height] = [own.y, own.height]
    else if (my) [y, height] = pin(e.box.y, e.box.height, PIN_Y[e.constraints.vertical], my.before, my.after)
    boxes.set(e.id, { x, y, width, height })
  }
  const overflow = new Set([...actual.texts].filter(([, t]) => t.overflow).map(([id]) => id))
  return { boxes, overflow }
}

// ---------- 9 slice ----------

/**
 * The border widths that draw a 9 slice picture: the corners and edges at the size they have in the designed box, so
 * they do not stretch as the box does. Left and right are percent of the canvas width, top and bottom of its height.
 * In a box too small for both corners they shrink together to fit.
 */
export function nineSliceBorders(slice: DesignInsets, designed: ThemeBox, box: ThemeBox): DesignInsets {
  let left = (slice.left / 100) * designed.width
  let right = (slice.right / 100) * designed.width
  let top = (slice.top / 100) * designed.height
  let bottom = (slice.bottom / 100) * designed.height
  if (left + right > box.width && left + right > 0) {
    const k = box.width / (left + right)
    left *= k
    right *= k
  }
  if (top + bottom > box.height && top + bottom > 0) {
    const k = box.height / (top + bottom)
    top *= k
    bottom *= k
  }
  return { top, right, bottom, left }
}

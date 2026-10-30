// Linking shapes to text so a design stretches with its words: which background goes with which text, and Make this
// stretch, which turns a text element to Auto width and fits the shapes behind it, keeping the design's look with its
// sample words. Used by the designer and after an import.

import { growthOf, paddingBetween, textBox, type MeasureLine } from './autoLayout'
import { DEFAULT_MAX } from './designs'
import type { DesignElement, DesignGrowth, ThemeBox } from './types'

type Text = Extract<DesignElement, { kind: 'text' }>

const area = (b: ThemeBox) => Math.max(0, b.width) * Math.max(0, b.height)

function overlap(a: ThemeBox, b: ThemeBox): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

const centreDistance = (a: ThemeBox, b: ThemeBox) => Math.hypot(a.x + a.width / 2 - (b.x + b.width / 2), a.y + a.height / 2 - (b.y + b.height / 2))

/** Shapes and pictures that can sit behind text: not lines, and not already linked. */
const canFit = (e: DesignElement) => (e.kind === 'rect' || e.kind === 'image') && !e.hidden && !e.fitToText

/**
 * The text a shape is the background of: the visible text element at least half inside it, the one nearest its centre
 * when there are several. Null when no text sits on it.
 */
export function textBehind(shape: DesignElement, elements: DesignElement[]): Text | null {
  let best: { text: Text; distance: number } | null = null
  for (const e of elements) {
    if (e.kind !== 'text' || e.hidden || e.id === shape.id) continue
    if (overlap(shape.box, e.box) < area(e.box) * 0.5) continue
    // A background is larger than its text.
    if (area(shape.box) < area(e.box) * 0.9) continue
    const distance = centreDistance(shape.box, e.box)
    if (!best || distance < best.distance) best = { text: e, distance }
  }
  return best?.text ?? null
}

/** Every unlinked background with a text on it, as the import offers to link them. */
export function suggestLinks(elements: DesignElement[]): { shapeId: string; textId: string }[] {
  return elements.flatMap((e) => {
    if (!canFit(e)) return []
    const text = textBehind(e, elements)
    return text ? [{ shapeId: e.id, textId: text.id }] : []
  })
}

/** The growth a text's alignment suggests: left aligned text grows right. */
const growthFor = (text: Text): DesignGrowth => (text.align === 'left' ? 'right' : text.align === 'right' ? 'left' : 'center')

/**
 * Makes `textId` stretch: Auto width (unless it already stretches), sized to its sample words, with `shapeIds` fitted
 * to it as backgrounds. The padding is what keeps each shape exactly where it is with the sample, so the design looks
 * the same until the words change. Elements level with the shapes and past their right end are pinned right, so a logo
 * at the end of a bar rides along.
 */
export function makeStretch(elements: DesignElement[], textId: string, shapeIds: string[], measure: MeasureLine): DesignElement[] {
  const text = elements.find((e): e is Text => e.id === textId && e.kind === 'text')
  if (!text) return elements
  const anchor = elements.find((e) => e.fitToText?.textId === textId)?.fitToText?.anchor ?? growthFor(text)
  const stretching: Text =
    text.sizing === 'autoWidth' || text.sizing === 'autoHeight'
      ? text
      : { ...text, sizing: 'autoWidth', maxWidth: Math.max(text.box.width, Math.min(DEFAULT_MAX.width, 100 - text.box.x)) }
  // With the shapes linked, the text grows the way their anchor says; place its box as it will show.
  const linked = elements.map((e) => (shapeIds.includes(e.id) ? ({ ...e, fitToText: { textId, padding: { top: 0, right: 0, bottom: 0, left: 0 }, minWidth: 0, maxWidth: 0, anchor, axes: 'both' } } as DesignElement) : e))
  const hugged = textBox(stretching, text.text, linked, measure).box
  const shapes = elements.filter((e) => shapeIds.includes(e.id))
  const end = Math.max(...shapes.map((s) => s.box.x + s.box.width))
  return elements.map((e) => {
    if (e.id === textId) return { ...stretching, box: hugged }
    if (shapeIds.includes(e.id)) return { ...e, fitToText: { textId, padding: paddingBetween(e.box, hugged), minWidth: 0, maxWidth: 0, anchor, axes: 'both' } } as DesignElement
    if (shapes.length === 0 || e.fitToText || e.hidden) return e
    // Level with the bar and past its right end: pinned right, to stay at its end. Those before it stay pinned left.
    const level = shapes.some((s) => e.box.y < s.box.y + s.box.height && e.box.y + e.box.height > s.box.y)
    return level && e.box.x >= end - 0.5 ? { ...e, constraints: { ...e.constraints, horizontal: 'right' } } : e
  })
}

/** Every text with backgrounds on it made to stretch, as the import's Link them does. */
export function linkAll(elements: DesignElement[], measure: MeasureLine): DesignElement[] {
  const byText = new Map<string, string[]>()
  for (const { shapeId, textId } of suggestLinks(elements)) byText.set(textId, [...(byText.get(textId) ?? []), shapeId])
  let next = elements
  for (const [textId, shapeIds] of byText) next = makeStretch(next, textId, shapeIds, measure)
  return next
}

/** For the inspector: the anchor a text grows by now (its first shape's, else its alignment's). */
export const anchorOf = (text: Text, elements: DesignElement[]): DesignGrowth => {
  const g = growthOf(text, elements)
  return g.x === 'start' ? 'right' : g.x === 'end' ? 'left' : 'center'
}

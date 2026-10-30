import { describe, expect, it } from 'vitest'
import { fittedBox, layoutDesign, nineSliceBorders, paddingBetween, textBox, wrapLines, type MeasureLine } from './autoLayout'
import { imageElement, normalizeDesign, rectElement, textElement } from './designs'
import type { DesignElement, DesignFitToText } from './types'

/** One percent of the canvas width per character, whatever the font: easy to reckon with. */
const measure: MeasureLine = (_element, words) => words.length

const close = (box: { x: number; y: number; width: number; height: number }) =>
  Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v * 100) / 100]))

const fit = (textId: string, overrides: Partial<DesignFitToText> = {}): DesignFitToText => ({
  textId,
  padding: { top: 1, right: 2, bottom: 1, left: 2 },
  minWidth: 0,
  maxWidth: 0,
  anchor: 'right',
  axes: 'both',
  ...overrides,
})

// The name: 10 characters of sample at font size 4 (slack 0.2), in a 10 wide box at x 10.
const name = (overrides: Partial<Extract<DesignElement, { kind: 'text' }>> = {}) =>
  textElement('name', 'Name', { x: 10, y: 80, width: 10.2, height: 6 }, { text: 'Sam Sample', field: 'headline', sizing: 'autoWidth', lineHeight: 1, ...overrides })

describe('text growth', () => {
  it('Auto width hugs the words and grows right from a left aligned box', () => {
    const t = name()
    expect(close(textBox(t, 'Pastor Sam Example', [t], measure).box)).toEqual({ x: 10, y: 80, width: 18.2, height: 6 })
    expect(close(textBox(t, 'Sam', [t], measure).box)).toEqual({ x: 10, y: 80, width: 3.2, height: 6 })
  })

  it('grows left from a right aligned box and from the centre of a centred one', () => {
    const right = name({ align: 'right' })
    expect(close(textBox(right, 'Pastor Sam Example', [right], measure).box)).toMatchObject({ x: 2, width: 18.2 })
    const centre = name({ align: 'center' })
    expect(close(textBox(centre, 'Pastor Sam Example', [centre], measure).box)).toMatchObject({ x: 6, width: 18.2 })
  })

  it('wraps at the maximum width and grows taller, up to the maximum height', () => {
    const t = name({ maxWidth: 12, maxHeight: 9 })
    const laid = textBox(t, 'one two three four', [t], measure)
    expect(laid.lines).toEqual(['one two', 'three four'])
    expect(close(laid.box)).toMatchObject({ width: 12, height: 8 })
    expect(laid.overflow).toBe(false)
    const long = textBox(t, 'one two three four five six', [t], measure)
    expect(long.box.height).toBe(9)
    expect(long.overflow).toBe(true)
  })

  it('Auto height keeps the width, wraps in it and grows up from a bottom aligned box', () => {
    const t = name({ sizing: 'autoHeight', verticalAlign: 'bottom', box: { x: 10, y: 80, width: 10, height: 4 } })
    const laid = textBox(t, 'one two three four', [t], measure)
    expect(laid.lines).toEqual(['one two', 'three', 'four'])
    expect(close(laid.box)).toEqual({ x: 10, y: 72, width: 10, height: 12 })
  })

  it('never gets shorter than designed and leaves Fixed and Shrink to fit boxes alone', () => {
    const t = name({ box: { x: 10, y: 80, width: 10, height: 10 } })
    expect(textBox(t, 'Hi', [t], measure).box.height).toBe(10)
    for (const sizing of ['fixed', 'shrink'] as const) {
      const fixed = name({ sizing })
      expect(textBox(fixed, 'A much longer line of words', [fixed], measure).box).toEqual(fixed.box)
    }
  })

  it('wraps on explicit new lines and in the text case shown', () => {
    expect(wrapLines(name({ textCase: 'upper' }), 'ab\ncd', null, measure)).toEqual(['AB', 'CD'])
  })
})

describe('shapes fitted to text', () => {
  it('sizes a shape to the text box with padding, as the text changes', () => {
    const t = name()
    const bar = rectElement('bar', 'Bar', { x: 8, y: 79, width: 14.2, height: 8 }, { fitToText: fit('name') })
    const layout = layoutDesign([bar, t], { headline: 'Pastor Sam Example' }, measure)
    expect(close(layout.boxes.get('name')!)).toEqual({ x: 10, y: 80, width: 18.2, height: 6 })
    expect(close(layout.boxes.get('bar')!)).toEqual({ x: 8, y: 79, width: 22.2, height: 8 })
  })

  it('keeps within the minimum and maximum width, holding the edge the text grows from', () => {
    const text = { x: 10, y: 80, width: 30, height: 6 }
    const stored = { x: 8, y: 79, width: 14, height: 8 }
    expect(fittedBox(stored, text, fit('t', { maxWidth: 20 }), 'start')).toMatchObject({ x: 8, width: 20 })
    expect(fittedBox(stored, text, fit('t', { maxWidth: 20 }), 'end')).toMatchObject({ x: 22, width: 20 })
    expect(fittedBox(stored, { ...text, width: 2 }, fit('t', { minWidth: 12 }), 'center')).toMatchObject({ x: 5, width: 12 })
  })

  it('grows left with the anchor, text and shape together', () => {
    const t = name()
    const bar = rectElement('bar', 'Bar', { x: 8, y: 79, width: 14.2, height: 8 }, { fitToText: fit('name', { anchor: 'left' }) })
    const layout = layoutDesign([bar, t], { headline: 'Pastor Sam Example' }, measure)
    // The text's right edge (20.2) stays; it is 8 wider, so the bar's left edge moves 8 left too.
    expect(close(layout.boxes.get('name')!)).toMatchObject({ x: 2, width: 18.2 })
    expect(close(layout.boxes.get('bar')!)).toMatchObject({ x: 0, width: 22.2 })
  })

  it('lets several shapes follow one text, each on its own sizes', () => {
    const t = name()
    const bar = rectElement('bar', 'Bar', { x: 8, y: 79, width: 14.2, height: 8 }, { fitToText: fit('name') })
    const stripe = rectElement('stripe', 'Stripe', { x: 8, y: 79, width: 0.8, height: 8 }, { fitToText: fit('name', { axes: 'height' }) })
    const layout = layoutDesign([bar, stripe, t], { headline: 'Pastor Sam Example' }, measure)
    expect(close(layout.boxes.get('bar')!)).toMatchObject({ width: 22.2 })
    expect(close(layout.boxes.get('stripe')!)).toEqual({ x: 8, y: 79, width: 0.8, height: 8 })
  })

  it('works out the padding that keeps a shape in place when it is linked', () => {
    expect(paddingBetween({ x: 8, y: 79, width: 14, height: 8 }, { x: 10, y: 80, width: 10, height: 6 })).toEqual({ top: 1, right: 2, bottom: 1, left: 2 })
  })

  it('shows the design as designed with the sample words', () => {
    const t = name()
    const bar = rectElement('bar', 'Bar', { x: 8, y: 79, width: 14.2, height: 8 }, { fitToText: fit('name') })
    const logo = imageElement('logo', 'Logo', { x: 23, y: 79, width: 4, height: 8 }, { constraints: { horizontal: 'right', vertical: 'top' } })
    const layout = layoutDesign([bar, t, logo], undefined, measure)
    expect(close(layout.boxes.get('bar')!)).toEqual(close(bar.box))
    expect(layout.boxes.get('logo')).toEqual(logo.box)
  })
})

describe('pinning', () => {
  // A bar fitted to the name, which grows 8 wider; the group spans 4 to 27.
  const t = name()
  const bar = rectElement('bar', 'Bar', { x: 8, y: 79, width: 14.2, height: 8 }, { fitToText: fit('name') })
  const at = (box: { x: number; width: number }, horizontal: 'left' | 'right' | 'center' | 'scale') =>
    rectElement(horizontal, horizontal, { ...box, y: 79, height: 8 }, { constraints: { horizontal, vertical: 'top' } })
  const tab = at({ x: 4, width: 4 }, 'left')
  const logo = at({ x: 23, width: 4 }, 'right')
  const mark = at({ x: 14, width: 2 }, 'center')
  const scaled = at({ x: 4, width: 23 }, 'scale')
  const layout = layoutDesign([bar, t, tab, logo, mark, scaled], { headline: 'Pastor Sam Example' }, measure)

  it('keeps a left pinned number tab put while the bar stretches', () => {
    expect(close(layout.boxes.get('left')!)).toMatchObject({ x: 4, width: 4 })
  })

  it('moves a right pinned logo with the end of the bar', () => {
    expect(close(layout.boxes.get('right')!)).toMatchObject({ x: 31, width: 4 })
  })

  it('moves a centred element half as far, and scales one pinned to Scale', () => {
    expect(close(layout.boxes.get('center')!)).toMatchObject({ x: 18, width: 2 })
    expect(close(layout.boxes.get('scale')!)).toMatchObject({ x: 4, width: 31 })
  })

  it('pins vertically too when the text wraps taller', () => {
    const wrapping = name({ maxWidth: 12, verticalAlign: 'bottom' })
    const under = rectElement('under', 'Under', { x: 10, y: 86, width: 10, height: 1 }, { constraints: { horizontal: 'left', vertical: 'bottom' } })
    const above = rectElement('above', 'Above', { x: 10, y: 78, width: 10, height: 1 }, { constraints: { horizontal: 'left', vertical: 'top' } })
    const laid = layoutDesign([wrapping, under, above], { headline: 'one two three four five' }, measure)
    // Three lines of 4 is 12 tall, 6 more than designed, growing up from the bottom.
    expect(close(laid.boxes.get('name')!)).toMatchObject({ y: 74, height: 12 })
    expect(close(laid.boxes.get('above')!)).toMatchObject({ y: 72 })
    expect(close(laid.boxes.get('under')!)).toMatchObject({ y: 86 })
  })

  it('leaves designs without stretching text exactly as they were', () => {
    const old = normalizeDesign({
      category: 'lowerThird',
      elements: [
        { kind: 'rect', id: 'bar', box: { x: 5, y: 72, width: 40, height: 10 } },
        { kind: 'text', id: 'name', box: { x: 7, y: 72, width: 36, height: 10 }, text: 'Pastor', field: 'headline', autoFit: true },
      ],
    })
    const laid = layoutDesign(old.elements, { headline: 'A far longer name than the sample' }, measure)
    for (const e of old.elements) expect(laid.boxes.get(e.id)).toEqual(e.box)
  })
})

describe('9 slice', () => {
  const designed = { x: 0, y: 0, width: 20, height: 10 }
  const slice = { top: 20, right: 10, bottom: 20, left: 10 }

  it('keeps the corners at their designed size as the picture stretches', () => {
    const wide = nineSliceBorders(slice, designed, { x: 0, y: 0, width: 60, height: 10 })
    const tall = nineSliceBorders(slice, designed, { x: 0, y: 0, width: 20, height: 40 })
    expect(wide).toEqual({ top: 2, right: 2, bottom: 2, left: 2 })
    expect(tall).toEqual(wide)
  })

  it('shrinks the corners together in a box too small for both', () => {
    expect(nineSliceBorders(slice, designed, { x: 0, y: 0, width: 2, height: 2 })).toEqual({ top: 1, right: 1, bottom: 1, left: 1 })
  })

  it('migrates pictures without insets as plain pictures', () => {
    const design = normalizeDesign({ elements: [{ kind: 'image', id: 'logo', src: 'wd-media://a.png' }, { kind: 'image', id: 'bar', slice: { top: 30, right: 80, bottom: 5, left: 5 } }] })
    expect(design.elements.map((e) => e.kind === 'image' && e.slice)).toEqual([null, { top: 30, right: 49, bottom: 5, left: 5 }])
  })
})

describe('migration', () => {
  it('turns auto fit into Shrink to fit and its absence into Fixed, with no pins or links', () => {
    const design = normalizeDesign({ elements: [{ kind: 'text', id: 'a', autoFit: true }, { kind: 'text', id: 'b', autoFit: false }, { kind: 'rect', id: 'c' }] })
    expect(design.elements.map((e) => e.kind === 'text' && e.sizing)).toEqual(['shrink', 'fixed', false])
    expect(design.elements.every((e) => e.fitToText === null && e.constraints.horizontal === 'left' && e.constraints.vertical === 'top')).toBe(true)
  })

  it('keeps a link to a text element and drops one on text', () => {
    const design = normalizeDesign({
      elements: [
        { kind: 'text', id: 't', fitToText: { textId: 'x' } },
        { kind: 'rect', id: 'r', fitToText: { textId: 't', padding: { left: 2 }, anchor: 'sideways' } },
      ],
    })
    expect(design.elements[0].fitToText).toBeNull()
    expect(design.elements[1].fitToText).toEqual({ textId: 't', padding: { top: 0, right: 0, bottom: 0, left: 2 }, minWidth: 0, maxWidth: 0, anchor: 'right', axes: 'both' })
  })
})

describe('linking backgrounds to text', async () => {
  const { linkAll, makeStretch, suggestLinks } = await import('./designLinks')
  const bar = rectElement('bar', 'Bar', { x: 5, y: 72, width: 40, height: 10 })
  const accent = rectElement('accent', 'Accent', { x: 5, y: 72, width: 0.9, height: 10 })
  const title = textElement('name', 'Name', { x: 7, y: 72, width: 36, height: 10 }, { text: 'Pastor Sam', field: 'headline' })
  const logo = imageElement('logo', 'Logo', { x: 46, y: 72, width: 5, height: 10 })
  const caption = textElement('caption', 'Caption', { x: 60, y: 10, width: 20, height: 5 })

  it('pairs each background with the text on it, and leaves thin stripes and lone text alone', () => {
    expect(suggestLinks([bar, accent, title, logo, caption])).toEqual([{ shapeId: 'bar', textId: 'name' }])
  })

  it('makes the text stretch without changing the look with its sample words', () => {
    const before = [bar, accent, title, logo]
    const after = makeStretch(before, 'name', ['bar'], measure)
    const text = after.find((e) => e.id === 'name')
    expect(text?.kind === 'text' && text.sizing).toBe('autoWidth')
    // "Pastor Sam" is 10 wide at 1 per letter, plus a little slack.
    expect(close(text!.box)).toEqual({ x: 7, y: 72, width: 10.2, height: 10 })
    expect(after.find((e) => e.id === 'bar')?.fitToText).toMatchObject({ textId: 'name', anchor: 'right', padding: { left: 2, right: 27.8, top: 0, bottom: 0 } })
    const shown = layoutDesign(after, undefined, measure)
    for (const e of before) expect(close(shown.boxes.get(e.id)!)).toEqual(close(e.id === 'name' ? text!.box : e.box))
    // The logo past the bar's end rides along with it.
    expect(after.find((e) => e.id === 'logo')?.constraints.horizontal).toBe('right')
    const longer = layoutDesign(after, { headline: 'Pastor Sam Example' }, measure)
    expect(close(longer.boxes.get('bar')!)).toMatchObject({ width: 48 })
    expect(close(longer.boxes.get('logo')!)).toMatchObject({ x: 54 })
    expect(longer.boxes.get('accent')).toEqual(accent.box)
  })

  it('links everything the import found in one go', () => {
    const linked = linkAll([bar, accent, title], measure)
    expect(linked.find((e) => e.id === 'bar')?.fitToText?.textId).toBe('name')
    expect(linked.find((e) => e.id === 'accent')?.fitToText).toBeNull()
  })
})

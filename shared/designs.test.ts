import { describe, expect, it } from 'vitest'
import { BUILTIN_DESIGNS, designFromLowerThird, normalizeDesign, shownText, textElement } from './designs'
import { BUILTIN_LOWER_THIRDS } from './lowerThirds'

describe('designs', () => {
  it('ships the six built-in lower third designs, each already valid and transparent', () => {
    expect(BUILTIN_DESIGNS.map((d) => d.name)).toEqual(['Name Bar', 'Simple Bar', 'Title with Subtitle', 'Point with Number', 'Quote', 'Full Width Bar'])
    for (const { style } of BUILTIN_DESIGNS) {
      expect(normalizeDesign(style)).toEqual(style)
      expect(style.background).toEqual({ kind: 'transparent' })
      expect(style.elements.some((e) => e.kind === 'text' && e.field === 'headline')).toBe(true)
    }
  })

  it('drops unknown elements, unsafe images and duplicate ids, and fills in missing fields', () => {
    const style = normalizeDesign({
      category: 'slide',
      background: { kind: 'image', src: 'file:///etc/passwd' },
      elements: [
        { kind: 'video', id: 'a' },
        { kind: 'image', id: 'a', src: 'https://example.com/x.png', rotation: 999 },
        { kind: 'rect', id: 'a', fill: { kind: 'gradient', from: '#FF0000' }, opacity: 3 },
        { kind: 'text', text: 'Hi', field: 'nope', fontWeight: 650 },
      ],
    })
    expect(style.background).toEqual({ kind: 'solid', color: '#0b1f44' })
    expect(style.elements.map((e) => [e.kind, e.id])).toEqual([
      ['image', 'a'],
      ['rect', 'a-2'],
      ['text', 'text'],
    ])
    const [image, rect, text] = style.elements
    expect(image).toMatchObject({ src: null, rotation: 180 })
    expect(rect).toMatchObject({ opacity: 1, fill: { kind: 'gradient', from: '#ff0000', to: '#0b1f44' } })
    expect(text).toMatchObject({ text: 'Hi', field: null, fontWeight: 700, autoFit: true })
    expect(normalizeDesign(null)).toEqual({ category: 'lowerThird', background: { kind: 'transparent' }, elements: [] })
  })

  it('opens a lower third template as a design in the same place on screen', () => {
    const banner = BUILTIN_LOWER_THIRDS.find((t) => t.name === 'Two Line Banner')!.style
    const design = designFromLowerThird(banner, { headline: 'Pastor Sam', body: 'Lead Pastor' })
    expect(design.background).toEqual({ kind: 'transparent' })
    expect(design.elements.map((e) => e.id)).toEqual(['bar', 'accent', 'headline', 'body'])
    expect(design.elements[0].box).toEqual(banner.frame)
    // The accent runs along the top, 7% of the frame's height.
    expect(design.elements[1].box.height).toBeCloseTo((7 * 17) / 100)
    const headline = design.elements[2]
    expect(headline).toMatchObject({ kind: 'text', text: 'Pastor Sam', field: 'headline', align: 'center' })
    expect(headline.box.x).toBeCloseTo(10)
    expect(headline.box.y).toBeCloseTo(76 + (14 * 17) / 100)
    expect(normalizeDesign(design)).toEqual(design)
  })

  it('shows a bound field when given, else the sample words', () => {
    const element = textElement('t', 'T', { x: 0, y: 0, width: 10, height: 10 }, { text: 'Sample', field: 'headline' })
    expect(shownText(element)).toBe('Sample')
    expect(shownText(element, { headline: 'Live words' })).toBe('Live words')
    expect(shownText({ ...element, field: null }, { headline: 'Live words' })).toBe('Sample')
  })
})

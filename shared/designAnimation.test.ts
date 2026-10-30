// The design animation timeline: elements build by order, each after its delay; the way out runs in reverse; elements
// without a movement appear at their turn and go with the design; and the CSS each element gets.
import { describe, expect, it } from 'vitest'
import { animatesItself, designTimeline, motionCss, NO_ANIMATION, progressAt, slideOffsets } from './designAnimation'
import { normalizeDesign, rectElement, textElement } from './designs'
import type { DesignElementAnimation, DesignMotionStep } from './types'

const step = (patch: Partial<DesignMotionStep>): DesignMotionStep => ({ ...NO_ANIMATION.in, ...patch })
const anim = (patch: { in?: Partial<DesignMotionStep>; out?: Partial<DesignMotionStep>; order?: number }): DesignElementAnimation => ({
  in: step({ ...patch.in }),
  out: step({ easing: 'easeIn', ...patch.out }),
  order: patch.order ?? 0,
})
const box = { x: 5, y: 72, width: 40, height: 10 }

const bar = rectElement('bar', 'Bar', box, { animation: anim({ in: { motion: 'slideLeft', durationMs: 400 }, out: { motion: 'fade', durationMs: 300 }, order: 0 }) })
const name = textElement('name', 'Name', box, { animation: anim({ in: { motion: 'fade', durationMs: 500, delayMs: 100 }, out: { motion: 'wipe', durationMs: 200 }, order: 1 }) })
const title = textElement('title', 'Title', box, { animation: anim({ in: { motion: 'scale', durationMs: 300, delayMs: 50 }, order: 1 }) })
const tag = textElement('tag', 'Tag', box, { animation: anim({ in: { delayMs: 0 }, order: 2 }) })

const byId = (elements = [bar, name, title, tag], phase: 'in' | 'out' = 'in') =>
  Object.fromEntries(designTimeline(elements, phase).entries.map((e) => [e.id, e]))

describe('design animation timeline', () => {
  it('builds one order after another, each element after its own delay', () => {
    const t = designTimeline([bar, name, title, tag], 'in')
    const at = byId()
    // Order 0: the bar slides in over 400 ms.
    expect(at.bar).toMatchObject({ motion: 'slideLeft', startMs: 0, durationMs: 400 })
    // Order 1 starts when the bar is in: the name after 100 ms, the title after 50 ms, side by side.
    expect(at.name).toMatchObject({ startMs: 500, durationMs: 500 })
    expect(at.title).toMatchObject({ startMs: 450, durationMs: 300 })
    // Order 2 waits for the slowest of order 1 (the name, done at 1000 ms) and, with no movement, just appears.
    expect(at.tag).toMatchObject({ motion: 'none', startMs: 1000, durationMs: 0 })
    expect(t.totalMs).toBe(1000)
  })

  it('runs the way out in reverse order, leaving elements without a movement to go at the end', () => {
    const out = designTimeline([bar, name, title, tag], 'out')
    const at = byId(undefined, 'out')
    // Order 2 (the tag) has no way out, so order 1 goes first: the name wipes, the title stays to the end.
    expect(at.tag).toBeUndefined()
    expect(at.title).toBeUndefined()
    expect(at.name).toMatchObject({ motion: 'wipe', startMs: 0, durationMs: 200 })
    expect(at.bar).toMatchObject({ motion: 'fade', startMs: 200, durationMs: 300 })
    expect(out.totalMs).toBe(500)
  })

  it('moves everything of one order together, keeps element order and leaves hidden elements out', () => {
    const together = [bar, { ...name, animation: { ...name.animation, order: 0 } }, { ...title, hidden: true }]
    const t = designTimeline(together, 'in')
    expect(t.entries.map((e) => [e.id, e.startMs])).toEqual([
      ['bar', 0],
      ['name', 100],
    ])
    expect(t.totalMs).toBe(600)
  })

  it('has nothing to play for a design without movements, so the lower third moves it as a whole', () => {
    const still = normalizeDesign({ category: 'lowerThird', elements: [{ kind: 'rect', id: 'a' }, { kind: 'text', id: 'b' }] })
    expect(designTimeline(still.elements, 'in').totalMs).toBe(0)
    expect(animatesItself(still)).toBe(false)
    expect(animatesItself({ ...still, elements: [bar] })).toBe(true)
    // A delay alone still makes a build.
    expect(animatesItself({ ...still, elements: [tag, { ...tag, id: 'late', animation: anim({ in: { delayMs: 300 } }) }] })).toBe(true)
  })

  it('reports progress through a movement', () => {
    const entry = byId().name
    expect(progressAt(entry, 0)).toBe(0)
    expect(progressAt(entry, 750)).toBe(0.5)
    expect(progressAt(entry, 2000)).toBe(1)
    expect(progressAt(byId().tag, 1000)).toBe(1)
  })

  it('turns each entry into a CSS animation that holds its first frame in, and its last frame out', () => {
    const at = byId()
    expect(motionCss(at.bar, 'in')).toBe('dv-in-slideLeft 400ms ease-out 0ms backwards')
    expect(motionCss(at.title, 'in')).toBe('dv-in-scale 300ms ease-out 450ms backwards')
    expect(motionCss(byId(undefined, 'out').name, 'out')).toBe('dv-out-wipe 200ms ease-in 0ms forwards')
    // No movement: hidden until its turn, or nothing at all when that is straight away.
    expect(motionCss(at.tag, 'in')).toBe('dv-in-pop 1ms linear 1000ms backwards')
    expect(motionCss({ ...at.tag, startMs: 0 }, 'in')).toBeNull()
    expect(motionCss(undefined, 'out')).toBeNull()
  })

  it('slides each element far enough to start off screen', () => {
    expect(slideOffsets(bar)).toEqual({ dx: 95, dy: 82 })
    expect(slideOffsets(textElement('right', 'Right', { x: 80, y: 5, width: 15, height: 10 }))).toEqual({ dx: 95, dy: 95 })
  })

  it('keeps animations through saving, and repairs bad ones', () => {
    const saved = normalizeDesign({ category: 'lowerThird', elements: [bar, name] })
    expect(saved.elements.map((e) => e.animation)).toEqual([bar.animation, name.animation])
    const repaired = normalizeDesign({
      category: 'lowerThird',
      elements: [{ kind: 'text', id: 'x', loop: 'shimmer', animation: { in: { motion: 'teleport', durationMs: 99999, delayMs: -5, easing: 'wobbly' }, order: 7.6 } }],
    }).elements[0]
    expect(repaired.loop).toBe('shimmer')
    expect(repaired.animation).toEqual({ in: { motion: 'none', durationMs: 5000, delayMs: 0, easing: 'easeOut' }, out: NO_ANIMATION.out, order: 8 })
    // Designs saved before animations existed simply appear and go.
    expect(normalizeDesign({ elements: [{ kind: 'rect' }] }).elements[0].animation).toEqual(NO_ANIMATION)
  })
})

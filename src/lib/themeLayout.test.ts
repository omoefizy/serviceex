import { describe, expect, it } from 'vitest'
import { moveBoxes, resizeBox, resizeKeepingAspect, TEXT_AREA_TARGETS } from './themeLayout'

const box = { x: 20, y: 20, width: 40, height: 20 }

describe('text area geometry', () => {
  it('keeps the shape when resizing with the aspect locked', () => {
    for (const [handle, dx, dy] of [
      ['se', 10, 0],
      ['nw', -6, -1],
      ['e', 8, 0],
      ['s', 0, 5],
      ['ne', 2, -10],
    ] as const) {
      const resized = resizeKeepingAspect(box, handle, dx, dy)
      expect(resized.width / resized.height, handle).toBeCloseTo(2, 1)
    }
    // A corner keeps the opposite corner still.
    const se = resizeKeepingAspect(box, 'se', 10, 0)
    expect([se.x, se.y, se.width, se.height]).toEqual([20, 20, 50, 25])
    const nw = resizeKeepingAspect(box, 'nw', -10, 0)
    expect(nw.x + nw.width).toBe(60)
    expect(nw.y + nw.height).toBe(40)
  })

  it('never grows past the slide with the aspect locked', () => {
    const resized = resizeKeepingAspect(box, 'se', 200, 200)
    expect(resized.x + resized.width).toBeLessThanOrEqual(100)
    expect(resized.y + resized.height).toBeLessThanOrEqual(100)
  })

  it('snaps to the centre lines and the safe margin', () => {
    // The centre 0.6% off the middle snaps onto it.
    const moved = moveBoxes([box], 9.4, 0, TEXT_AREA_TARGETS)
    expect(moved.boxes[0].x + moved.boxes[0].width / 2).toBe(50)
    expect(moved.guides).toContainEqual({ axis: 'x', at: 50 })
    // The left edge dragged near the safe margin lands on it.
    const resized = resizeBox(box, 'w', -14.4, 0, TEXT_AREA_TARGETS)
    expect(resized.box.x).toBe(5)
    expect(resized.guides).toContainEqual({ axis: 'x', at: 5 })
    // Without targets (Alt held), no snapping.
    expect(moveBoxes([box], 9.4, 0, null).boxes[0].x).toBe(29.4)
  })
})

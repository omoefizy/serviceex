import { describe, expect, it } from 'vitest'
import { rectElement } from '../../shared/designs'
import {
  commitFrom,
  copiesOf,
  designTargets,
  moveDesignBoxes,
  moveToIndex,
  preview,
  record,
  redo,
  resizeDesignBox,
  rotationToward,
  startHistory,
  undo,
} from './designLayout'

const box = { x: 10, y: 10, width: 20, height: 10 }

/** Where a point of the box (fractions of its width and height) lands on screen, in percent of screen height. */
function screenPoint(b: typeof box, rotation: number, fx: number, fy: number) {
  const aspect = 16 / 9
  const w = b.width * aspect
  const cx = (b.x + b.width / 2) * aspect
  const cy = b.y + b.height / 2
  const lx = (fx - 0.5) * w
  const ly = (fy - 0.5) * b.height
  const rad = (rotation * Math.PI) / 180
  return { x: cx + lx * Math.cos(rad) - ly * Math.sin(rad), y: cy + lx * Math.sin(rad) + ly * Math.cos(rad) }
}

describe('design layout', () => {
  it('moves boxes off the canvas freely, and snaps to the centre and other elements', () => {
    expect(moveDesignBoxes([box], -15, 0, null).boxes[0]).toEqual({ ...box, x: -5 })
    const others = [rectElement('a', 'A', { x: 60, y: 0, width: 10, height: 10 }), rectElement('me', 'Me', box)]
    const targets = designTargets(others, new Set(['me']))
    const moved = moveDesignBoxes([box], 49.6, 0, targets)
    // Its left edge lands on the other box's left edge, at 60.
    expect(moved.boxes[0].x).toBe(60)
    expect(moved.guides).toContainEqual({ axis: 'x', at: 60 })
  })

  it('resizes an unrotated box from any handle, snapping the moving edge', () => {
    expect(resizeDesignBox(box, 0, 'se', 5, 5, null).box).toEqual({ x: 10, y: 10, width: 25, height: 15 })
    expect(resizeDesignBox(box, 0, 'w', -5, 0, null).box).toEqual({ x: 5, y: 10, width: 25, height: 10 })
    expect(resizeDesignBox(box, 0, 'e', 19.7, 0, { x: [50], y: [] }).box.width).toBe(40)
    expect(resizeDesignBox(box, 0, 'n', 0, 50, null).box.height).toBe(0.5)
  })

  it('keeps the opposite corner still when resizing a rotated box', () => {
    for (const rotation of [30, -75, 180]) {
      const before = screenPoint(box, rotation, 0, 0)
      const resized = resizeDesignBox(box, rotation, 'se', 6, 4, null).box
      const after = screenPoint(resized, rotation, 0, 0)
      expect(after.x).toBeCloseTo(before.x, 1)
      expect(after.y).toBeCloseTo(before.y, 1)
      expect(resized.width).not.toBe(box.width)
    }
  })

  it('keeps the shape when asked', () => {
    const resized = resizeDesignBox(box, 0, 'se', 10, 0, null, true).box
    expect(resized.width / resized.height).toBeCloseTo(2)
    expect(resized.x).toBeCloseTo(10)
    expect(resized.y).toBeCloseTo(10)
  })

  it('rotates toward the pointer, settling on quarter turns and 15 degree steps with Shift', () => {
    const centre = { x: 100, y: 100 }
    expect(rotationToward(centre, { x: 100, y: 0 }, false)).toBe(0)
    expect(rotationToward(centre, { x: 200, y: 102 }, false)).toBe(90)
    expect(rotationToward(centre, { x: 200, y: 0 }, false)).toBe(45)
    expect(rotationToward(centre, { x: 200, y: 20 }, true)).toBe(45)
    expect(rotationToward(centre, { x: 0, y: 100 }, false)).toBe(-90)
  })

  it('reorders layers and pastes copies with new ids', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(moveToIndex(items, 'a', 2).map((i) => i.id)).toEqual(['b', 'c', 'a'])
    expect(moveToIndex(items, 'c', 0).map((i) => i.id)).toEqual(['c', 'a', 'b'])
    let n = 0
    const [copy] = copiesOf([{ ...rectElement('a', 'A', box), locked: true }], () => `new-${++n}`, 2)
    expect(copy).toMatchObject({ id: 'new-1', locked: false, box: { x: 12, y: 12 } })
  })

  it('undoes and redoes, folding quick changes to one field into one step and a drag into one step', () => {
    let h = startHistory('a')
    h = record(h, 'ab', 'name', 0)
    h = record(h, 'abc', 'name', 500)
    h = record(h, 'abcd', 'color', 600)
    expect(h.past).toEqual(['a', 'abc'])
    h = undo(h)
    expect(h.present).toBe('abc')
    h = undo(h)
    expect(h.present).toBe('a')
    h = redo(h)
    expect(h.present).toBe('abc')

    const before = h.present
    h = preview(preview(h, 'drag 1'), 'drag 2')
    h = commitFrom(h, before)
    expect(h.future).toEqual([])
    expect(undo(h).present).toBe('abc')
    expect(commitFrom(h, h.present)).toBe(h)
  })
})

describe('stretching in the designer', async () => {
  const { resizedElement, withLinked } = await import('./designLayout')
  const { rectElement, textElement } = await import('../../shared/designs')
  const text = textElement('name', 'Name', { x: 10, y: 80, width: 10, height: 6 }, { sizing: 'autoWidth' })
  const bar = rectElement('bar', 'Bar', { x: 8, y: 79, width: 14, height: 8 }, {
    fitToText: { textId: 'name', padding: { top: 1, right: 2, bottom: 1, left: 2 }, minWidth: 0, maxWidth: 0, anchor: 'right', axes: 'both' },
  })
  const logo = rectElement('logo', 'Logo', { x: 30, y: 79, width: 4, height: 8 })

  it('moves a text and the shapes fitted to it together, whichever is dragged', () => {
    expect(withLinked([bar, text, logo], ['bar']).sort()).toEqual(['bar', 'name'])
    expect(withLinked([bar, text, logo], ['name']).sort()).toEqual(['bar', 'name'])
    expect(withLinked([bar, text, logo], ['logo'])).toEqual(['logo'])
  })

  it('turns Auto width text resized sideways into Auto height, and resized taller into Fixed', () => {
    const box = { x: 10, y: 80, width: 20, height: 6 }
    expect(resizedElement(text, box, 'e', new Map())).toMatchObject({ sizing: 'autoHeight', box })
    expect(resizedElement(text, box, 's', new Map())).toMatchObject({ sizing: 'fixed' })
  })

  it('keeps a fitted shape’s new size as its padding around the text', () => {
    const resized = resizedElement(bar, { x: 6, y: 79, width: 18, height: 8 }, 'w', new Map([['name', text.box]]))
    expect(resized.fitToText?.padding).toEqual({ top: 1, right: 4, bottom: 1, left: 4 })
  })
})

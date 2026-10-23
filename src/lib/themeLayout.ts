// Geometry for the theme editor's canvas: moving, resizing and snapping element boxes, the align and distribute
// tools and layer order. Boxes are in percent of the slide (see ThemeBox), so nothing here depends on screen size.

import type { ThemeBox, ThemeElement } from '../../shared/types'

/** How close, in percent of the slide, an edge has to come to a guide to snap to it. */
export const SNAP_DISTANCE = 1
/** The smallest box the editor makes, in percent. */
export const MIN_SIZE = 0.5

/** A guide line shown while snapping: a vertical line at x, or a horizontal one at y. */
export interface Guide {
  axis: 'x' | 'y'
  at: number
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
export type ArrangeMode = 'front' | 'forward' | 'backward' | 'back'

const round = (value: number) => Math.round(value * 100) / 100

/** Keeps a box on the slide, rounded to a hundredth of a percent. */
export function clampBox(box: ThemeBox): ThemeBox {
  const width = Math.min(100, Math.max(MIN_SIZE, box.width))
  const height = Math.min(100, Math.max(MIN_SIZE, box.height))
  return {
    x: round(Math.min(100 - width, Math.max(0, box.x))),
    y: round(Math.min(100 - height, Math.max(0, box.y))),
    width: round(width),
    height: round(height),
  }
}

/** The smallest box around all of `boxes`. */
export function unionBox(boxes: ThemeBox[]): ThemeBox {
  const left = Math.min(...boxes.map((b) => b.x))
  const top = Math.min(...boxes.map((b) => b.y))
  const right = Math.max(...boxes.map((b) => b.x + b.width))
  const bottom = Math.max(...boxes.map((b) => b.y + b.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** The lines to snap to: the slide's edges and centre, and the edges and centres of the other boxes. */
export function snapTargets(others: ThemeBox[]): { x: number[]; y: number[] } {
  const x = [0, 50, 100]
  const y = [0, 50, 100]
  for (const b of others) {
    x.push(b.x, b.x + b.width / 2, b.x + b.width)
    y.push(b.y, b.y + b.height / 2, b.y + b.height)
  }
  return { x, y }
}

/** The smallest shift that puts one of `edges` on a target within `distance`, and the target; no snap gives 0 and null. */
export function snapShift(edges: number[], targets: number[], distance = SNAP_DISTANCE): { shift: number; at: number | null } {
  let best: { shift: number; at: number | null } = { shift: 0, at: null }
  for (const edge of edges) {
    for (const target of targets) {
      const shift = target - edge
      if (Math.abs(shift) <= distance && (best.at === null || Math.abs(shift) < Math.abs(best.shift))) best = { shift, at: target }
    }
  }
  return best
}

/**
 * Moves `boxes` together by (dx, dy), snapping the group's edges or centre to the targets, and keeps the group on the
 * slide. Returns the moved boxes and the guides that snapped.
 */
export function moveBoxes(boxes: ThemeBox[], dx: number, dy: number, targets: { x: number[]; y: number[] } | null): { boxes: ThemeBox[]; guides: Guide[] } {
  const start = unionBox(boxes)
  let moved = { ...start, x: start.x + dx, y: start.y + dy }
  const guides: Guide[] = []
  if (targets) {
    const sx = snapShift([moved.x, moved.x + moved.width / 2, moved.x + moved.width], targets.x)
    const sy = snapShift([moved.y, moved.y + moved.height / 2, moved.y + moved.height], targets.y)
    moved = { ...moved, x: moved.x + sx.shift, y: moved.y + sy.shift }
    if (sx.at !== null) guides.push({ axis: 'x', at: sx.at })
    if (sy.at !== null) guides.push({ axis: 'y', at: sy.at })
  }
  // The whole group stays on the slide.
  const shiftX = Math.min(100 - moved.width, Math.max(0, moved.x)) - start.x
  const shiftY = Math.min(100 - moved.height, Math.max(0, moved.y)) - start.y
  return { boxes: boxes.map((b) => clampBox({ ...b, x: b.x + shiftX, y: b.y + shiftY })), guides }
}

/** Resizes a box by dragging one of its handles by (dx, dy), snapping the edges that move. */
export function resizeBox(box: ThemeBox, handle: Handle, dx: number, dy: number, targets: { x: number[]; y: number[] } | null): { box: ThemeBox; guides: Guide[] } {
  let left = box.x
  let top = box.y
  let right = box.x + box.width
  let bottom = box.y + box.height
  const guides: Guide[] = []
  const snap = (value: number, axis: 'x' | 'y') => {
    if (!targets) return value
    const { shift, at } = snapShift([value], targets[axis])
    if (at !== null) guides.push({ axis, at })
    return value + shift
  }
  if (handle.includes('w')) left = Math.min(snap(left + dx, 'x'), right - MIN_SIZE)
  if (handle.includes('e')) right = Math.max(snap(right + dx, 'x'), left + MIN_SIZE)
  if (handle.includes('n')) top = Math.min(snap(top + dy, 'y'), bottom - MIN_SIZE)
  if (handle.includes('s')) bottom = Math.max(snap(bottom + dy, 'y'), top + MIN_SIZE)
  left = Math.max(0, left)
  top = Math.max(0, top)
  right = Math.min(100, right)
  bottom = Math.min(100, bottom)
  return { box: clampBox({ x: left, y: top, width: right - left, height: bottom - top }), guides }
}

/** Lines boxes up with each other, or with the slide when there is only one. */
export function alignBoxes(boxes: ThemeBox[], mode: AlignMode): ThemeBox[] {
  const to = boxes.length === 1 ? { x: 0, y: 0, width: 100, height: 100 } : unionBox(boxes)
  return boxes.map((b) => {
    switch (mode) {
      case 'left':
        return clampBox({ ...b, x: to.x })
      case 'center':
        return clampBox({ ...b, x: to.x + (to.width - b.width) / 2 })
      case 'right':
        return clampBox({ ...b, x: to.x + to.width - b.width })
      case 'top':
        return clampBox({ ...b, y: to.y })
      case 'middle':
        return clampBox({ ...b, y: to.y + (to.height - b.height) / 2 })
      case 'bottom':
        return clampBox({ ...b, y: to.y + to.height - b.height })
    }
  })
}

/** Spaces three or more boxes evenly across (or down) the space they span, keeping the outer two where they are. */
export function distributeBoxes(boxes: ThemeBox[], axis: 'x' | 'y'): ThemeBox[] {
  if (boxes.length < 3) return boxes
  const size = (b: ThemeBox) => (axis === 'x' ? b.width : b.height)
  const start = (b: ThemeBox) => (axis === 'x' ? b.x : b.y)
  const order = boxes.map((b, index) => ({ b, index })).sort((a, z) => start(a.b) + size(a.b) / 2 - (start(z.b) + size(z.b) / 2))
  const span = unionBox(boxes)
  const total = order.reduce((sum, { b }) => sum + size(b), 0)
  const gap = ((axis === 'x' ? span.width : span.height) - total) / (boxes.length - 1)
  const result = [...boxes]
  let at = axis === 'x' ? span.x : span.y
  for (const { b, index } of order) {
    result[index] = clampBox(axis === 'x' ? { ...b, x: at } : { ...b, y: at })
    at += size(b) + gap
  }
  return result
}

/** Changes the drawing order of the elements in `ids` (later elements are drawn on top). */
export function arrange(elements: ThemeElement[], ids: Set<string>, mode: ArrangeMode): ThemeElement[] {
  const picked = elements.filter((e) => ids.has(e.id))
  const rest = elements.filter((e) => !ids.has(e.id))
  if (picked.length === 0) return elements
  if (mode === 'front') return [...rest, ...picked]
  if (mode === 'back') return [...picked, ...rest]
  const result = [...elements]
  if (mode === 'forward') {
    for (let i = result.length - 2; i >= 0; i--) {
      if (ids.has(result[i].id) && !ids.has(result[i + 1].id)) [result[i], result[i + 1]] = [result[i + 1], result[i]]
    }
  } else {
    for (let i = 1; i < result.length; i++) {
      if (ids.has(result[i].id) && !ids.has(result[i - 1].id)) [result[i], result[i - 1]] = [result[i - 1], result[i]]
    }
  }
  return result
}

/**
 * Puts `element` into `elements`: in place of the element with its id (so applying again updates it), else on top.
 * Used by "Apply to all themes".
 */
export function placeElement(elements: ThemeElement[], element: ThemeElement): ThemeElement[] {
  const index = elements.findIndex((e) => e.id === element.id)
  if (index === -1) return [...elements, element]
  return elements.map((e, i) => (i === index ? element : e))
}

// Geometry and history for the designer's canvas: moving, resizing and rotating element boxes with snapping, layer
// order, paste, and undo and redo. Boxes are in percent of the canvas (see ThemeBox), so nothing here depends on screen
// size; rotation works in units of screen height so it stays true on the 16:9 canvas. Unlike the theme editor, boxes
// may run off the canvas, as a full width bar or a bleed often does.

import { paddingBetween } from '../../shared/autoLayout'
import type { DesignElement, DesignTextSizing, ThemeBox } from '../../shared/types'
import { snapShift, snapTargets, unionBox, type Guide, type Handle } from './themeLayout'

export { HANDLES, type Guide, type Handle } from './themeLayout'

/** The smallest box the designer makes, in percent. */
export const MIN_SIZE = 0.5
/** The canvas's width over its height. */
export const ASPECT = 16 / 9

const round = (value: number) => Math.round(value * 100) / 100
export const roundBox = (box: ThemeBox): ThemeBox => ({ x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height) })

/** What a move or resize snaps to: the canvas's edges and centre, and the visible elements not being moved. */
export function designTargets(elements: DesignElement[], exclude: Set<string>): { x: number[]; y: number[] } {
  return snapTargets(elements.filter((e) => !exclude.has(e.id) && !e.hidden).map((e) => e.box))
}

/** Moves `boxes` together by (dx, dy), snapping the group's edges or centre to the targets. */
export function moveDesignBoxes(boxes: ThemeBox[], dx: number, dy: number, targets: { x: number[]; y: number[] } | null): { boxes: ThemeBox[]; guides: Guide[] } {
  const start = unionBox(boxes)
  let shiftX = dx
  let shiftY = dy
  const guides: Guide[] = []
  if (targets) {
    const x = start.x + dx
    const y = start.y + dy
    const sx = snapShift([x, x + start.width / 2, x + start.width], targets.x)
    const sy = snapShift([y, y + start.height / 2, y + start.height], targets.y)
    shiftX += sx.shift
    shiftY += sy.shift
    if (sx.at !== null) guides.push({ axis: 'x', at: sx.at })
    if (sy.at !== null) guides.push({ axis: 'y', at: sy.at })
  }
  return { boxes: boxes.map((b) => roundBox({ ...b, x: b.x + shiftX, y: b.y + shiftY })), guides }
}

/**
 * Resizes a box by dragging one of its handles by (dx, dy) percent of the canvas. The opposite side or corner stays
 * where it is on screen, also when the box is rotated. An unrotated box snaps the edges that move; `keepRatio` keeps
 * its shape (Shift, or always for a picture).
 */
export function resizeDesignBox(
  box: ThemeBox,
  rotation: number,
  handle: Handle,
  dx: number,
  dy: number,
  targets: { x: number[]; y: number[] } | null,
  keepRatio = false,
): { box: ThemeBox; guides: Guide[] } {
  const guides: Guide[] = []
  if (rotation === 0 && !keepRatio) {
    let left = box.x
    let top = box.y
    let right = box.x + box.width
    let bottom = box.y + box.height
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
    return { box: roundBox({ x: left, y: top, width: right - left, height: bottom - top }), guides }
  }
  const rad = (rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  // The pointer's movement along the box's own axes, in percent of screen height.
  const sx = dx * ASPECT
  const lx = sx * cos + dy * sin
  const ly = -sx * sin + dy * cos
  const w = box.width * ASPECT
  const h = box.height
  const signX = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0
  const signY = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0
  let nw = Math.max(MIN_SIZE * ASPECT, w + signX * lx)
  let nh = Math.max(MIN_SIZE, h + signY * ly)
  if (keepRatio) {
    const scale = signX && signY ? Math.max(nw / w, nh / h) : signX ? nw / w : nh / h
    nw = Math.max(MIN_SIZE * ASPECT, w * scale)
    nh = Math.max(MIN_SIZE, h * scale)
  }
  // The centre moves half the change along the box's axes, so the opposite side holds still.
  const cx = (signX * (nw - w)) / 2
  const cy = (signY * (nh - h)) / 2
  const centreX = (box.x + box.width / 2) * ASPECT + cx * cos - cy * sin
  const centreY = box.y + box.height / 2 + cx * sin + cy * cos
  return { box: roundBox({ x: (centreX - nw / 2) / ASPECT, y: centreY - nh / 2, width: nw / ASPECT, height: nh }), guides }
}

/** Keeps an angle in -180 to 180 degrees. */
export const normalizeAngle = (degrees: number) => {
  const a = ((((degrees + 180) % 360) + 360) % 360) - 180
  return a === -180 ? 180 : a
}

/**
 * The rotation that points a box's top at the pointer, from the box's centre and the pointer in screen pixels. It
 * settles on the nearest quarter turn within 3 degrees; `step` (Shift) snaps to 15 degree steps.
 */
export function rotationToward(centre: { x: number; y: number }, pointer: { x: number; y: number }, step: boolean): number {
  const raw = (Math.atan2(pointer.y - centre.y, pointer.x - centre.x) * 180) / Math.PI + 90
  if (step) return normalizeAngle(Math.round(raw / 15) * 15)
  const quarter = Math.round(raw / 90) * 90
  return normalizeAngle(Math.abs(raw - quarter) <= 3 ? quarter : Math.round(raw * 10) / 10)
}

/** Moves the element with `id` to `index` in the list (later elements are drawn on top). */
export function moveToIndex<T extends { id: string }>(items: T[], id: string, index: number): T[] {
  const from = items.findIndex((item) => item.id === id)
  if (from === -1) return items
  const rest = items.filter((item) => item.id !== id)
  const to = Math.max(0, Math.min(rest.length, index))
  return [...rest.slice(0, to), items[from], ...rest.slice(to)]
}

/** Copies of `copied` with new ids, moved by `offset` percent, for paste and duplicate. Copies are never locked. */
export function copiesOf(copied: DesignElement[], newId: () => string, offset: number): DesignElement[] {
  return copied.map((e) => ({ ...e, id: newId(), locked: false, box: roundBox({ ...e.box, x: e.box.x + offset, y: e.box.y + offset }) }))
}

/** A text element and the shapes fitted to it move together, so a background never parts from its words. */
export function withLinked(elements: DesignElement[], ids: string[]): string[] {
  const set = new Set(ids)
  for (const e of elements) if (set.has(e.id) && e.fitToText) set.add(e.fitToText.textId)
  for (const e of elements) if (e.fitToText && set.has(e.fitToText.textId)) set.add(e.id)
  return elements.filter((e) => set.has(e.id) && !e.locked).map((e) => e.id)
}

/**
 * An element after its frame was resized to `box` (from `from`, where it was drawn). Stretching text that is resized
 * sideways wraps at the new width (Auto height); made taller or shorter by hand it becomes Fixed, as in Figma. A shape
 * fitted to text keeps the new size as its padding around the text.
 */
export function resizedElement(element: DesignElement, box: ThemeBox, handle: Handle, boxes: Map<string, ThemeBox>): DesignElement {
  if (element.kind === 'text' && (element.sizing === 'autoWidth' || element.sizing === 'autoHeight')) {
    const sizing: DesignTextSizing = handle.includes('n') || handle.includes('s') ? 'fixed' : 'autoHeight'
    return { ...element, sizing, box }
  }
  const text = element.fitToText ? boxes.get(element.fitToText.textId) : undefined
  if (element.fitToText && text) return { ...element, box, fitToText: { ...element.fitToText, padding: paddingBetween(box, text) } } as DesignElement
  return { ...element, box }
}

// ---------- Undo and redo ----------

export interface History<T> {
  past: T[]
  present: T
  future: T[]
  /** The last change's key and time, so quick changes to one field (typing, a slider) undo together. */
  lastKey: string | null
  lastAt: number
}

/** How many steps undo goes back. */
export const HISTORY_LIMIT = 100
/** Changes with the same key this close together are one step. */
export const COALESCE_MS = 1000

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [], lastKey: null, lastAt: 0 })

/** A change as one undo step, or folded into the last one when it has the same key and follows quickly. */
export function record<T>(h: History<T>, next: T, key: string | null = null, now = Date.now()): History<T> {
  if (next === h.present) return h
  if (key !== null && key === h.lastKey && now - h.lastAt < COALESCE_MS) return { ...h, present: next, future: [], lastAt: now }
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [], lastKey: key, lastAt: now }
}

/** Shows `next` without an undo step: many times a second while dragging. `commitFrom` makes the step at the end. */
export const preview = <T>(h: History<T>, next: T): History<T> => ({ ...h, present: next })

/** Ends a drag that began at `before` as one undo step, if it changed anything. */
export function commitFrom<T>(h: History<T>, before: T): History<T> {
  if (before === h.present) return h
  return { past: [...h.past, before].slice(-HISTORY_LIMIT), present: h.present, future: [], lastKey: null, lastAt: 0 }
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], lastKey: null, lastAt: 0 }
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), lastKey: null, lastAt: 0 }
}

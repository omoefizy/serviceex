/**
 * The designer's canvas zoom: Fit scales the 16:9 canvas to the largest size the area holds; otherwise it is drawn at a
 * set zoom, where 100% is the output's 1920 by 1080, and can be panned. Pan is the canvas centre's offset from the
 * area's centre, in screen px.
 */

/** The canvas at 100%: the output's size. */
export const CANVAS = { width: 1920, height: 1080 } as const
export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 4
/** How much of the canvas stays in view however far it is panned, in px. */
const KEEP_VISIBLE = 48

export type ZoomMode = { mode: 'fit' } | { mode: 'zoom'; zoom: number }
export interface Point {
  x: number
  y: number
}
export interface Size {
  width: number
  height: number
}

export const clampZoom = (zoom: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))

/** The scale that fits the canvas in `area` (already less its padding), keeping 16:9. */
export function fitScale(area: Size): number {
  if (area.width <= 0 || area.height <= 0) return 0
  return Math.min(area.width / CANVAS.width, area.height / CANVAS.height)
}

export const scaleOf = (mode: ZoomMode, area: Size) => (mode.mode === 'fit' ? fitScale(area) : mode.zoom)

/** The canvas in px at `scale`, its height following its width so it is exactly 16:9. */
export function canvasSize(scale: number): Size {
  const width = Math.round(CANVAS.width * scale)
  return { width, height: Math.round((width * CANVAS.height) / CANVAS.width) }
}

/** Keeps at least a strip of the canvas in the area, so it cannot be panned out of reach. */
export function clampPan(pan: Point, canvas: Size, area: Size): Point {
  const maxX = Math.max(0, (canvas.width + area.width) / 2 - KEEP_VISIBLE)
  const maxY = Math.max(0, (canvas.height + area.height) / 2 - KEEP_VISIBLE)
  return { x: Math.min(maxX, Math.max(-maxX, pan.x)), y: Math.min(maxY, Math.max(-maxY, pan.y)) }
}

/** The pan that keeps the point `at` (from the area's centre) over the same spot of the canvas as it scales. */
export function panToKeep(pan: Point, at: Point, from: number, to: number): Point {
  if (from <= 0) return pan
  const k = to / from
  return { x: at.x - (at.x - pan.x) * k, y: at.y - (at.y - pan.y) * k }
}

/** The stored zoom mode, or Fit for anything else. */
export function readZoomMode(value: unknown): ZoomMode {
  if (typeof value === 'object' && value !== null) {
    const v = value as { mode?: unknown; zoom?: unknown }
    if (v.mode === 'zoom' && typeof v.zoom === 'number' && Number.isFinite(v.zoom)) return { mode: 'zoom', zoom: clampZoom(v.zoom) }
  }
  return { mode: 'fit' }
}

/** Where a design's zoom mode is remembered: by its id, or one place for designs not saved yet. */
export const zoomKey = (id: number | null) => `designer.zoom.${id ?? 'new'}`

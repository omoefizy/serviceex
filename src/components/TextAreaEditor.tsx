import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { pixelsToBox } from '../../shared/textAreas'
import type { TextAreaContent, ThemeBox } from '../../shared/types'
import { clampBox, HANDLES, moveBoxes, resizeBox, resizeKeepingAspect, SAFE_MARGIN, TEXT_AREA_TARGETS, type Guide, type Handle } from '../lib/themeLayout'
import { boxStyle } from './themedSlideLayers'

/** Arrow keys move the text area by a percent of the slide; with Shift, five. */
const NUDGE = 1
const NUDGE_FAR = 5

const CONTENT_NAMES: Record<TextAreaContent, string> = { scripture: 'Scripture', song: 'Song' }

const HANDLE_NAMES: Record<Handle, string> = {
  nw: 'top left corner',
  n: 'top edge',
  ne: 'top right corner',
  e: 'right edge',
  se: 'bottom right corner',
  s: 'bottom edge',
  sw: 'bottom left corner',
  w: 'left edge',
}

interface StageProps {
  area: ThemeBox
  content: TextAreaContent
  lockAspect: boolean
  /** Called once before each change (a drag, a nudge), so it can be undone as one step. */
  onBegin(): void
  /** Called with the new area, many times a second while dragging. */
  onChange(area: ThemeBox): void
  /** The slide drawn with the theme, under the rectangle. */
  children: ReactNode
}

type Drag = { x: number; y: number; start: ThemeBox; handle: Handle | null }

/**
 * The theme preview with the text area over it: drag inside the rectangle to move it, drag one of its eight handles
 * to resize it. Edges and the centre snap to the slide's centre lines and the safe margin, whose guide lines show
 * while dragging (hold Alt to place freely). Arrow keys nudge it.
 */
export function TextAreaStage({ area, content, lockAspect, onBegin, onChange, children }: StageProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [dragging, setDragging] = useState(false)
  const [snapped, setSnapped] = useState<Guide[]>([])

  function start(e: PointerEvent, handle: Handle | null) {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    onBegin()
    dragRef.current = { x: e.clientX, y: e.clientY, start: area, handle }
    stageRef.current?.setPointerCapture(e.pointerId)
    ;(e.currentTarget.closest('.text-area-rect') as HTMLElement | null)?.focus()
    setDragging(true)
  }

  function move(e: PointerEvent) {
    const drag = dragRef.current
    const rect = stageRef.current?.getBoundingClientRect()
    if (!drag || !rect || rect.width === 0) return
    // The pointer's movement as a share of the slide, so the area is the same at any preview size.
    const { x: dx, y: dy } = pixelsToBox({ left: e.clientX - drag.x, top: e.clientY - drag.y, width: 0, height: 0 }, rect.width, rect.height)
    const targets = e.altKey ? null : TEXT_AREA_TARGETS
    if (drag.handle === null) {
      const moved = moveBoxes([drag.start], dx, dy, targets)
      onChange(moved.boxes[0])
      setSnapped(moved.guides)
    } else if (lockAspect) {
      onChange(resizeKeepingAspect(drag.start, drag.handle, dx, dy))
      setSnapped([])
    } else {
      const resized = resizeBox(drag.start, drag.handle, dx, dy, targets)
      onChange(resized.box)
      setSnapped(resized.guides)
    }
  }

  function end() {
    dragRef.current = null
    setDragging(false)
    setSnapped([])
  }

  function handleKeyDown(e: KeyboardEvent) {
    const step = e.shiftKey ? NUDGE_FAR : NUDGE
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const by = moves[e.key]
    if (!by) return
    e.preventDefault()
    onBegin()
    onChange(moveBoxes([area], by[0], by[1], null).boxes[0])
  }

  const isSnapped = (axis: Guide['axis'], at: number) => snapped.some((g) => g.axis === axis && Math.abs(g.at - at) < 0.01)

  return (
    <div ref={stageRef} className={`theme-preview text-area-stage${dragging ? ' dragging' : ''}`} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      {children}
      {dragging && (
        <div className="text-area-guides" aria-hidden="true">
          <span className="text-area-safe" style={{ inset: `${SAFE_MARGIN}%` }} />
          {TEXT_AREA_TARGETS.x.map((at) => (
            <span key={`x${at}`} className={`text-area-guide x${isSnapped('x', at) ? ' snapped' : ''}`} style={{ left: `${at}%` }} />
          ))}
          {TEXT_AREA_TARGETS.y.map((at) => (
            <span key={`y${at}`} className={`text-area-guide y${isSnapped('y', at) ? ' snapped' : ''}`} style={{ top: `${at}%` }} />
          ))}
        </div>
      )}
      <div
        className="text-area-rect"
        style={boxStyle(area)}
        tabIndex={0}
        role="group"
        aria-label={`${CONTENT_NAMES[content]} text area. Drag to move, drag a handle to resize. Arrow keys move it 1%, with Shift 5%.`}
        onPointerDown={(e) => start(e, null)}
        onKeyDown={handleKeyDown}
      >
        <span className="text-area-label">{CONTENT_NAMES[content]} text</span>
        {HANDLES.map((handle) => (
          <span
            key={handle}
            className={`text-area-handle ${handle}`}
            title={`Resize from the ${HANDLE_NAMES[handle]}`}
            onPointerDown={(e) => start(e, handle)}
          />
        ))}
      </div>
    </div>
  )
}

const round = (value: number) => Math.round(value * 100) / 100

interface FieldsProps {
  area: ThemeBox
  lockAspect: boolean
  onLockAspect(lock: boolean): void
  onBegin(): void
  onChange(area: ThemeBox): void
  onReset(): void
}

/** X, Y, width and height of the text area in percent of the slide, kept in step with the rectangle. */
export function TextAreaFields({ area, lockAspect, onLockAspect, onBegin, onChange, onReset }: FieldsProps) {
  const ratio = area.width / area.height

  function set(field: keyof ThemeBox, value: number) {
    if (!Number.isFinite(value)) return
    let next = { ...area, [field]: value }
    if (lockAspect && field === 'width') next = { ...next, height: value / ratio }
    if (lockAspect && field === 'height') next = { ...next, width: value * ratio }
    if (lockAspect && (next.width > 100 || next.height > 100)) {
      // As large as the slide allows at the same shape.
      const scale = Math.min(100 / next.width, 100 / next.height)
      next = { ...next, width: next.width * scale, height: next.height * scale }
    }
    onBegin()
    onChange(clampBox(next))
  }

  const fields: { key: keyof ThemeBox; label: string; max: number }[] = [
    { key: 'x', label: 'X', max: 100 - area.width },
    { key: 'y', label: 'Y', max: 100 - area.height },
    { key: 'width', label: 'Width', max: 100 },
    { key: 'height', label: 'Height', max: 100 },
  ]

  return (
    <div className="text-area-fields">
      {fields.map(({ key, label, max }) => (
        <label key={key} className="text-area-field">
          <small>{label}</small>
          <span className="number-input">
            <input
              className="input"
              type="number"
              aria-label={`Text area ${label.toLowerCase()} in percent of the slide`}
              value={round(area[key])}
              min={0}
              max={round(max)}
              step={0.5}
              onChange={(e) => e.target.value !== '' && set(key, Number(e.target.value))}
            />
            <small>%</small>
          </span>
        </label>
      ))}
      <label className="inline-check">
        <input type="checkbox" checked={lockAspect} onChange={(e) => onLockAspect(e.target.checked)} />
        Lock aspect
      </label>
      <button type="button" className="button" title="Put the text area back where the theme's text box is" onClick={onReset}>
        Reset
      </button>
    </div>
  )
}

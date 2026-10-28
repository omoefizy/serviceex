import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { OutputMode, ThemeBox, ThemeElement, ThemeStyle } from '../../shared/types'
import { HANDLES, moveBoxes, resizeBox, snapTargets, type Guide, type Handle } from '../lib/themeLayout'
import { ThemedSlide } from './ThemedSlide'
import { boxStyle } from './themedSlideLayers'

const KIND_LABELS: Record<ThemeElement['kind'], string> = {
  text: 'Text box',
  reference: 'Reference box',
  copyright: 'Copyright box',
  image: 'Image',
  shape: 'Shape',
  video: 'Video',
}

/** Attached Reference and Copyright boxes follow the main text, so they have no frame of their own on the canvas. */
const followsText = (element: ThemeElement, elements: ThemeElement[]) =>
  (element.kind === 'reference' || element.kind === 'copyright') && element.attached && elements.some((e) => e.kind === 'text')

/** Arrow keys move by a tenth of a percent of the slide; with Shift, ten times as far. */
const NUDGE = 0.1

interface Props {
  style: ThemeStyle
  sample: { text: string; caption: string; copyright: string }
  mode: OutputMode
  logoUrl: string | null
  selected: string[]
  onSelect(ids: string[]): void
  /** Called with the whole element list on every change, many times a second while dragging. */
  onChange(elements: ThemeElement[]): void
  onDelete(): void
}

type Drag =
  | { kind: 'move'; x: number; y: number; ids: string[]; start: ThemeElement[] }
  | { kind: 'resize'; x: number; y: number; id: string; handle: Handle; start: ThemeElement[] }

/**
 * The theme editor's 16:9 canvas: the theme drawn with sample text, and a frame over each element to select it,
 * drag it and resize it from its sides and corners. Edges snap to the slide's edges and centre and to the other
 * elements (hold Alt to place freely); arrow keys nudge the selection.
 */
export function ThemeCanvas({ style, sample, mode, logoUrl, selected, onSelect, onChange, onDelete }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [guides, setGuides] = useState<Guide[]>([])
  const { elements } = style
  const selectedSet = new Set(selected)
  const single = selected.length === 1 ? elements.find((e) => e.id === selected[0] && !e.locked) : undefined

  /** The pointer's movement since the drag began, in percent of the canvas. */
  function delta(e: PointerEvent, drag: Drag) {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return { dx: 0, dy: 0 }
    return { dx: ((e.clientX - drag.x) / rect.width) * 100, dy: ((e.clientY - drag.y) / rect.height) * 100 }
  }

  const targetsFor = (exclude: Set<string>, start: ThemeElement[]) =>
    snapTargets(start.filter((e) => !exclude.has(e.id) && !followsText(e, start)).map((e) => e.box))

  function withBoxes(start: ThemeElement[], boxes: Map<string, ThemeBox>): ThemeElement[] {
    return start.map((e) => (boxes.has(e.id) ? { ...e, box: boxes.get(e.id)! } : e))
  }

  function startMove(e: PointerEvent, element: ThemeElement) {
    if (e.button !== 0) return
    e.stopPropagation()
    canvasRef.current?.focus()
    let ids: string[]
    if (e.shiftKey) {
      ids = selectedSet.has(element.id) ? selected.filter((id) => id !== element.id) : [...selected, element.id]
      onSelect(ids)
      if (!ids.includes(element.id)) return
    } else {
      ids = selectedSet.has(element.id) ? selected : [element.id]
      if (!selectedSet.has(element.id)) onSelect(ids)
    }
    const movable = ids.filter((id) => elements.some((el) => el.id === id && !el.locked))
    dragRef.current = { kind: 'move', x: e.clientX, y: e.clientY, ids: movable, start: elements }
    canvasRef.current?.setPointerCapture(e.pointerId)
  }

  function startResize(e: PointerEvent, element: ThemeElement, handle: Handle) {
    if (e.button !== 0) return
    e.stopPropagation()
    dragRef.current = { kind: 'resize', x: e.clientX, y: e.clientY, id: element.id, handle, start: elements }
    canvasRef.current?.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: PointerEvent) {
    const drag = dragRef.current
    if (!drag) return
    const { dx, dy } = delta(e, drag)
    if (drag.kind === 'move') {
      if (drag.ids.length === 0) return
      const ids = new Set(drag.ids)
      const picked = drag.start.filter((el) => ids.has(el.id))
      const moved = moveBoxes(picked.map((el) => el.box), dx, dy, e.altKey ? null : targetsFor(ids, drag.start))
      onChange(withBoxes(drag.start, new Map(picked.map((el, i) => [el.id, moved.boxes[i]]))))
      setGuides(moved.guides)
    } else {
      const element = drag.start.find((el) => el.id === drag.id)
      if (!element) return
      const resized = resizeBox(element.box, drag.handle, dx, dy, e.altKey ? null : targetsFor(new Set([drag.id]), drag.start))
      onChange(withBoxes(drag.start, new Map([[drag.id, resized.box]])))
      setGuides(resized.guides)
    }
  }

  function endDrag() {
    dragRef.current = null
    setGuides([])
  }

  function handleKeyDown(e: KeyboardEvent) {
    const step = e.shiftKey ? NUDGE * 10 : NUDGE
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (moves[e.key] && selected.length > 0) {
      e.preventDefault()
      const ids = new Set(selected.filter((id) => elements.some((el) => el.id === id && !el.locked)))
      const picked = elements.filter((el) => ids.has(el.id))
      if (picked.length === 0) return
      const [dx, dy] = moves[e.key]
      const moved = moveBoxes(picked.map((el) => el.box), dx, dy, null)
      onChange(withBoxes(elements, new Map(picked.map((el, i) => [el.id, moved.boxes[i]]))))
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length > 0) {
      e.preventDefault()
      onDelete()
    } else if (e.key === 'Escape' && selected.length > 0) {
      // Clears the selection rather than closing anything.
      e.stopPropagation()
      onSelect([])
    }
  }

  return (
    <div
      ref={canvasRef}
      className="theme-canvas"
      tabIndex={0}
      aria-label="Theme layout. Arrow keys move the selection; Shift moves it further."
      onPointerDown={(e) => {
        if (e.button === 0 && e.target === e.currentTarget) onSelect([])
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
    >
      <ThemedSlide theme={style} text={sample.text} caption={sample.caption} copyright={sample.copyright} mode={mode} logoUrl={logoUrl} />
      <div className="theme-frames" onPointerDown={(e) => e.target === e.currentTarget && e.button === 0 && onSelect([])}>
        {elements.map((element) =>
          followsText(element, elements) ? null : (
            <div
              key={element.id}
              className={`theme-frame${selectedSet.has(element.id) ? ' selected' : ''}${element.locked ? ' locked' : ''}`}
              style={boxStyle(element.box)}
              title={element.locked ? `${KIND_LABELS[element.kind]} (locked)` : KIND_LABELS[element.kind]}
              onPointerDown={(e) => startMove(e, element)}
            >
              {selectedSet.has(element.id) && <span className="theme-frame-label">{KIND_LABELS[element.kind]}</span>}
              {single?.id === element.id &&
                HANDLES.map((handle) => (
                  <span key={handle} className={`theme-handle ${handle}`} onPointerDown={(e) => startResize(e, element, handle)} />
                ))}
            </div>
          ),
        )}
        {guides.map((guide, index) => (
          <span
            key={index}
            className={`theme-guide ${guide.axis}`}
            style={guide.axis === 'x' ? { left: `${guide.at}%` } : { top: `${guide.at}%` }}
          />
        ))}
      </div>
    </div>
  )
}

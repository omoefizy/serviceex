import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

interface Props {
  label: string
  value: number
  min: number
  max: number
  /** 1 when dragging right grows the panel (it sits left of the splitter), -1 when dragging left does. */
  direction: 1 | -1
  /** The panel it resizes. A narrow window can draw it narrower than `value`; dragging starts from what is drawn. */
  panel?: string
  onChange(value: number): void
}

const STEP = 16

/** A draggable divider between two panel columns; arrow keys resize it too. */
export function Splitter({ label, value, min, max, direction, panel, onChange }: Props) {
  const start = useRef<{ x: number; value: number } | null>(null)
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)))
  const drawn = () => {
    const width = panel ? document.querySelector(panel)?.getBoundingClientRect().width : undefined
    return width ? Math.min(value, Math.round(width)) : value
  }

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { x: e.clientX, value: drawn() }
    document.body.classList.add('resizing')
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (start.current) onChange(clamp(start.current.value + direction * (e.clientX - start.current.x)))
  }

  function handlePointerUp(e: PointerEvent<HTMLDivElement>) {
    start.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
    document.body.classList.remove('resizing')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    // Keep the arrow keys from also moving between slides.
    e.stopPropagation()
    onChange(clamp(drawn() + (e.key === 'ArrowRight' ? STEP : -STEP) * direction))
  }

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    />
  )
}

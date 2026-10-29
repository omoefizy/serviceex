import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

interface Props {
  label: string
  /** The size saved, or null while the panel is at its default (the stylesheet's). */
  value: number | null
  min: number
  max: number
  /** 'vertical' sits between two columns and drags sideways; 'horizontal' sits between two rows and drags up and down. */
  orientation: 'vertical' | 'horizontal'
  /** 1 when dragging right (or down) grows the panel, -1 when dragging left (or up) does. */
  direction: 1 | -1
  /** The panel it resizes. Dragging starts from its drawn size, which a small window can make less than `value`. */
  panel: string
  onChange(value: number): void
  /** Double click: back to the default size. */
  onReset(): void
}

const STEP = 16

/** A draggable divider between two panels; arrow keys resize it too, and a double click puts it back. */
export function Splitter({ label, value, min, max, orientation, direction, panel, onChange, onReset }: Props) {
  const start = useRef<{ at: number; value: number } | null>(null)
  const vertical = orientation === 'vertical'
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)))
  const drawn = () => {
    const box = document.querySelector(panel)?.getBoundingClientRect()
    const size = box ? (vertical ? box.width : box.height) : 0
    return size > 0 ? Math.round(size) : (value ?? min)
  }
  const pointer = (e: PointerEvent) => (vertical ? e.clientX : e.clientY)

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { at: pointer(e), value: drawn() }
    document.body.classList.add(vertical ? 'resizing' : 'resizing-rows')
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (start.current) onChange(clamp(start.current.value + direction * (pointer(e) - start.current.at)))
  }

  function handlePointerUp(e: PointerEvent<HTMLDivElement>) {
    start.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    document.body.classList.remove('resizing', 'resizing-rows')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const keys = vertical ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
    if (!keys.includes(e.key)) return
    e.preventDefault()
    // Keep the arrow keys from also moving between slides.
    e.stopPropagation()
    onChange(clamp(drawn() + (e.key === keys[1] ? STEP : -STEP) * direction))
  }

  return (
    <div
      className={`splitter ${orientation}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={value ?? undefined}
      aria-valuemin={min}
      aria-valuemax={max}
      title={`${label}. Double click to reset.`}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
    />
  )
}

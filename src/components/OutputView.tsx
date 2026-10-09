import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { OutputState } from '../../shared/types'

/** Keep in sync with the `output-fade` animation duration in index.css. */
const FADE_MS = 400

interface Frame {
  key: number
  state: OutputState
}

/** True when two states look the same on screen, so switching between them needs no fade. */
function looksSame(a: OutputState, b: OutputState): boolean {
  if (a.mode !== b.mode) return false
  if (a.mode === 'black') return true
  return a.background === b.background && (a.mode !== 'show' || (a.text === b.text && a.caption === b.caption))
}

export function LogoPlaceholder() {
  return (
    <div className="logo-placeholder">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 2h4v6h6v4h-6v10h-4V12H4V8h6z" />
      </svg>
      <span>WorshipDeck</span>
    </div>
  )
}

/** Slide text at the largest font size that still fits the screen, with an optional caption line under it. */
function FittedText({ text, caption }: { text: string; caption: string }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLParagraphElement>(null)
  const captionRef = useRef<HTMLParagraphElement>(null)

  useLayoutEffect(() => {
    const box = boxRef.current
    const el = textRef.current
    if (!box || !el) return

    const fit = () => {
      const captionEl = captionRef.current
      const captionHeight = captionEl
        ? captionEl.offsetHeight + parseFloat(getComputedStyle(captionEl).marginTop)
        : 0
      const height = box.clientHeight - captionHeight
      let low = 8
      let high = Math.max(low, box.clientHeight * 0.16)
      while (high - low > 0.5) {
        const size = (low + high) / 2
        el.style.fontSize = `${size}px`
        if (el.scrollWidth <= box.clientWidth && el.scrollHeight <= height) low = size
        else high = size
      }
      el.style.fontSize = `${low}px`
    }

    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(box)
    return () => observer.disconnect()
  }, [text, caption])

  return (
    <div className="output-text-box" ref={boxRef}>
      <p className="output-text" ref={textRef}>
        {text}
      </p>
      {caption && (
        <p className="output-caption" ref={captionRef}>
          {caption}
        </p>
      )}
    </div>
  )
}

/** The projector screen. New frames fade in over the previous one, which is removed once covered. */
export function OutputView() {
  const [frames, setFrames] = useState<Frame[]>([])

  useEffect(() => {
    let lastKey = 0
    let current: OutputState | null = null
    const timers: number[] = []

    const unsubscribe = window.api.output.onState((state) => {
      if (current && looksSame(current, state)) {
        current = state
        return
      }
      current = state
      const key = ++lastKey
      setFrames((frames) => [...frames, { key, state }])
      timers.push(window.setTimeout(() => setFrames((frames) => frames.filter((f) => f.key >= key)), FADE_MS))
    })

    return () => {
      unsubscribe()
      timers.forEach(clearTimeout)
    }
  }, [])

  return (
    <div className="output">
      {frames.map(({ key, state }) => (
        <div
          key={key}
          className="output-frame"
          style={{ background: state.mode === 'black' ? '#000' : state.background }}
        >
          {state.mode === 'show' && state.text !== '' && <FittedText text={state.text} caption={state.caption} />}
          {state.mode === 'logo' && <LogoPlaceholder />}
        </div>
      ))}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { OutputState } from '../../shared/types'
import { ThemedSlide } from './ThemedSlide'

/** Keep in sync with the `output-fade` animation duration in index.css. */
const FADE_MS = 400

interface Frame {
  key: number
  state: OutputState
  leaving: boolean
}

/** What the background layer shows: unchanged backgrounds (a playing video, say) are not redrawn between slides. */
function backgroundOf(state: OutputState): string {
  return state.mode === 'black' ? 'black' : JSON.stringify([state.theme.background, state.theme.overlay])
}

/** What the text layer shows, so identical states need no fade. */
function contentOf(state: OutputState): string {
  if (state.mode === 'black' || state.mode === 'clear') return state.mode
  if (state.mode === 'logo') return 'logo'
  return JSON.stringify([state.text, state.caption, { ...state.theme, background: null, overlay: null }])
}

/**
 * A stack of fading frames for one layer. A new frame fades in on top; with `fadeOut`, older frames fade out
 * at the same time (text layers are transparent, so the old words would otherwise show through).
 */
function useFrames(state: OutputState | null, identity: (state: OutputState) => string, fadeOut: boolean): Frame[] {
  const [frames, setFrames] = useState<Frame[]>([])
  const currentRef = useRef<string | null>(null)
  const lastKeyRef = useRef(0)
  const timersRef = useRef<number[]>([])

  useEffect(() => {
    const timers = timersRef.current
    return () => timers.forEach(clearTimeout)
  }, [])

  useEffect(() => {
    if (!state) return
    const id = identity(state)
    if (id === currentRef.current) {
      // Same look; keep the newest state on the top frame without a fade.
      setFrames((frames) => frames.map((f, i) => (i === frames.length - 1 ? { ...f, state } : f)))
      return
    }
    currentRef.current = id
    const key = ++lastKeyRef.current
    setFrames((frames) => [...frames.map((f) => ({ ...f, leaving: fadeOut })), { key, state, leaving: false }])
    timersRef.current.push(window.setTimeout(() => setFrames((frames) => frames.filter((f) => f.key >= key)), FADE_MS))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per new output state
  }, [state])

  return frames
}

/** The projector screen: a background layer and a text layer, each crossfading on its own. */
export function OutputView() {
  const [state, setState] = useState<OutputState | null>(null)

  useEffect(() => window.api.output.onState(setState), [])

  const backgrounds = useFrames(state, backgroundOf, false)
  const contents = useFrames(state, contentOf, true)

  return (
    <div className="output">
      {backgrounds.map(({ key, state }) => (
        <div key={key} className="output-frame">
          <ThemedSlide theme={state.theme} text="" mode={state.mode} layer="background" />
        </div>
      ))}
      {contents.map(({ key, state, leaving }) => (
        <div key={key} className={`output-frame${leaving ? ' leaving' : ''}`}>
          <ThemedSlide theme={state.theme} text={state.text} caption={state.caption} mode={state.mode} layer="content" />
        </div>
      ))}
    </div>
  )
}

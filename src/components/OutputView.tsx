import { useEffect, useRef, useState } from 'react'
import type { OutputState } from '../../shared/types'
import { AlertBand } from './AlertBand'
import { Overlays } from './Overlays'
import { ThemedSlide } from './ThemedSlide'

interface Frame {
  key: number
  state: OutputState
  leaving: boolean
  /** How long this frame's fade in, or fade out once leaving, lasts: the fade of the state that replaced it. */
  fadeMs: number
}

/** What the background layer shows: unchanged backgrounds (a playing video, say) are not redrawn between slides. */
function backgroundOf(state: OutputState): string {
  return state.mode === 'black' ? 'black' : JSON.stringify([state.theme.background, state.theme.overlay])
}

/** On a keyed output (the Stream), Clear empties the slide layer, background and all. */
function keyedBackgroundOf(state: OutputState): string {
  return state.mode === 'clear' ? 'clear' : backgroundOf(state)
}

/** What the text layer shows, so identical states need no fade. */
function contentOf(state: OutputState): string {
  if (state.mode === 'black' || state.mode === 'clear') return state.mode
  if (state.mode === 'logo') return 'logo'
  return JSON.stringify([state.text, state.caption, { ...state.theme, background: null, overlay: null }])
}

/**
 * A stack of fading frames for one layer. A new frame fades in on top; when `fadeOut` says so for the new state,
 * older frames fade out at the same time (text layers are transparent, so the old words would otherwise show through).
 */
function useFrames(state: OutputState | null, identity: (state: OutputState) => string, fadeOut: (state: OutputState) => boolean): Frame[] {
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
    const leaving = fadeOut(state)
    setFrames((frames) => [
      // A frame already fading out keeps going.
      ...frames.map((f) => ({ ...f, leaving: f.leaving || leaving, fadeMs: state.fadeMs })),
      { key, state, leaving: false, fadeMs: state.fadeMs },
    ])
    timersRef.current.push(window.setTimeout(() => setFrames((frames) => frames.filter((f) => f.key >= key)), state.fadeMs))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per new output state
  }, [state])

  return frames
}

const never = () => false
const always = () => true
const isClear = (state: OutputState) => state.mode === 'clear'

/**
 * The live slide: a background layer and a text layer, each crossfading on its own over the chosen fade length.
 * `keyed` (the Stream output) leaves the layer empty in Clear, fading the slide out so the layers below show.
 */
export function SlideLayers({ state, keyed = false }: { state: OutputState | null; keyed?: boolean }) {
  const backgrounds = useFrames(state, keyed ? keyedBackgroundOf : backgroundOf, keyed ? isClear : never)
  const contents = useFrames(state, contentOf, always)

  return (
    <>
      {backgrounds.map(({ key, state, leaving, fadeMs }) => (
        <div key={key} className={`output-frame${leaving ? ' leaving' : ''}`} style={{ animationDuration: `${fadeMs}ms` }}>
          {!(keyed && state.mode === 'clear') && <ThemedSlide theme={state.theme} text="" mode={state.mode} layer="background" />}
        </div>
      ))}
      {contents.map(({ key, state, leaving, fadeMs }) => (
        <div key={key} className={`output-frame${leaving ? ' leaving' : ''}`} style={{ animationDuration: `${fadeMs}ms` }}>
          <ThemedSlide
            theme={state.theme}
            text={state.text}
            caption={state.caption}
            mode={state.mode}
            layer="content"
            logoUrl={state.logoUrl}
          />
        </div>
      ))}
    </>
  )
}

/** The projector screen: the live slide, the overlays if the setting allows them, and the alert ticker. */
export function OutputView() {
  const [state, setState] = useState<OutputState | null>(null)

  useEffect(() => window.api.output.onState(setState), [])

  return (
    <div className="output">
      <SlideLayers state={state} />
      {/* Above the slide layers and outside their crossfades, so changing slides never touches them. */}
      {state?.overlays && <Overlays overlays={state.overlays} />}
      <AlertBand alert={state?.alert ?? null} />
    </div>
  )
}

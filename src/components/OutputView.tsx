import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { DEFAULT_FONT, DEFAULT_TEXT_PROPS } from '../../shared/themes'
import type { OutputState, ScreenMargins, ThemeStyle } from '../../shared/types'
import { AlertBand } from './AlertBand'
import { Overlays } from './Overlays'
import { TestPattern } from './StreamView'
import { ThemedSlide } from './ThemedSlide'
import { backdropKey, DefaultFontContext, underKey } from './themedSlideLayers'
import { CONTENT_COLORS } from '../styles/contentColors'

interface Frame {
  key: number
  state: OutputState
  leaving: boolean
  /** How long this frame's fade in, or fade out once leaving, lasts: the fade of the state that replaced it. */
  fadeMs: number
}

/** What the backdrop layer shows: an unchanged background (a playing video, say) is not redrawn between slides. */
function backgroundOf(state: OutputState): string {
  return state.mode === 'black' ? 'black' : backdropKey(state.theme)
}

/** What the layer of shapes and images under the text shows, so unchanged ones hold still. */
function underOf(state: OutputState): string {
  return state.mode === 'black' ? 'black' : underKey(state.theme, state.logoUrl)
}

/** On a keyed output (the Stream), Clear empties the slide layer, background and all. */
function keyedBackgroundOf(state: OutputState): string {
  return state.mode === 'clear' ? 'clear' : backgroundOf(state)
}

function keyedUnderOf(state: OutputState): string {
  return state.mode === 'clear' ? 'clear' : underOf(state)
}

/** What the text layer shows, so identical states need no fade. */
function contentOf(state: OutputState): string {
  if (state.mode === 'black' || state.mode === 'clear') return state.mode
  return JSON.stringify([state.mode, state.text, state.caption, state.copyright, state.rich ?? null, state.defaultFont, state.logoUrl, state.theme.elements])
}

/**
 * Marking words on the live slide (live highlighting) or a quick adjustment to the live verse changes only how it
 * looks: a quick soft fade, not the slide crossfade.
 */
const MARK_FADE_MS = 120

/** The theme with every text box given one look, to tell a change of look from a change of slide. */
const unstyled = (theme: ThemeStyle): ThemeStyle => ({
  ...theme,
  elements: theme.elements.map((element) => ('text' in element ? { ...element, text: DEFAULT_TEXT_PROPS } : element)),
})

/** The fade from `previous` to `state`: quick when only the formatting changed. */
function contentFade(previous: OutputState | null, state: OutputState): number {
  const restyled =
    previous !== null &&
    contentOf({ ...previous, rich: null, theme: unstyled(previous.theme) }) === contentOf({ ...state, rich: null, theme: unstyled(state.theme) })
  return restyled ? Math.min(MARK_FADE_MS, state.fadeMs) : state.fadeMs
}

/**
 * A stack of fading frames for one layer. A new frame fades in on top; when `fadeOut` says so for the new state,
 * older frames fade out at the same time (text layers are transparent, so the old words would otherwise show through).
 * `fadeFor` can shorten the fade for some changes.
 */
function useFrames(
  state: OutputState | null,
  identity: (state: OutputState) => string,
  fadeOut: (state: OutputState) => boolean,
  fadeFor: (previous: OutputState | null, state: OutputState) => number = (_previous, state) => state.fadeMs,
): Frame[] {
  const [frames, setFrames] = useState<Frame[]>([])
  const currentRef = useRef<string | null>(null)
  const previousRef = useRef<OutputState | null>(null)
  const lastKeyRef = useRef(0)
  const timersRef = useRef<number[]>([])

  useEffect(() => {
    const timers = timersRef.current
    return () => timers.forEach(clearTimeout)
  }, [])

  useEffect(() => {
    if (!state) return
    const id = identity(state)
    const previous = previousRef.current
    previousRef.current = state
    if (id === currentRef.current) {
      // Same look; keep the newest state on the top frame without a fade.
      setFrames((frames) => frames.map((f, i) => (i === frames.length - 1 ? { ...f, state } : f)))
      return
    }
    currentRef.current = id
    const key = ++lastKeyRef.current
    const leaving = fadeOut(state)
    const fadeMs = fadeFor(previous, state)
    setFrames((frames) => [
      // A frame already fading out keeps going.
      ...frames.map((f) => ({ ...f, leaving: f.leaving || leaving, fadeMs })),
      { key, state, leaving: false, fadeMs },
    ])
    timersRef.current.push(window.setTimeout(() => setFrames((frames) => frames.filter((f) => f.key >= key)), fadeMs))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per new output state
  }, [state])

  return frames
}

const never = () => false
const always = () => true
const isClear = (state: OutputState) => state.mode === 'clear'

/**
 * The live slide: a backdrop layer, a layer of the shapes and images under the text, and a text layer, each
 * crossfading on its own over the chosen fade length. Slides sharing a video background share one playing video.
 * `keyed` (the Stream output) leaves the layer empty in Clear, fading the slide out so the layers below show.
 */
export function SlideLayers({ state, keyed = false }: { state: OutputState | null; keyed?: boolean }) {
  const backgrounds = useFrames(state, keyed ? keyedBackgroundOf : backgroundOf, keyed ? isClear : never)
  const unders = useFrames(state, keyed ? keyedUnderOf : underOf, always)
  const contents = useFrames(state, contentOf, always, contentFade)

  return (
    <>
      {backgrounds.map(({ key, state, leaving, fadeMs }) => (
        <div key={key} className={`output-frame${leaving ? ' leaving' : ''}`} style={{ animationDuration: `${fadeMs}ms` }}>
          {!(keyed && state.mode === 'clear') && (
            <ThemedSlide theme={state.theme} text="" mode={state.mode} layer="backdrop" logoUrl={state.logoUrl} keyed={keyed} />
          )}
        </div>
      ))}
      {unders.map(({ key, state, leaving, fadeMs }) => (
        <div key={key} className={`output-frame${leaving ? ' leaving' : ''}`} style={{ animationDuration: `${fadeMs}ms` }}>
          {!(keyed && state.mode === 'clear') && (
            <ThemedSlide theme={state.theme} text="" mode={state.mode} layer="under" logoUrl={state.logoUrl} keyed={keyed} />
          )}
        </div>
      ))}
      {contents.map(({ key, state, leaving, fadeMs }) => (
        <div key={key} className={`output-frame${leaving ? ' leaving' : ''}`} style={{ animationDuration: `${fadeMs}ms` }}>
          <ThemedSlide
            theme={state.theme}
            text={state.text}
            caption={state.caption}
            copyright={state.copyright}
            rich={state.rich}
            mode={state.mode}
            layer="content"
            logoUrl={state.logoUrl}
            keyed={keyed}
          />
        </div>
      ))}
    </>
  )
}

/** Live Options' screen margins: the area everything is drawn in, with black around it. */
const marginsStyle = (m: ScreenMargins): CSSProperties => ({ top: `${m.top}%`, right: `${m.right}%`, bottom: `${m.bottom}%`, left: `${m.left}%` })

/**
 * The projector picture inside the screen margins: the live slide, the overlays if the setting allows them, the alert
 * ticker and the test pattern. The operator window's live screen draws the same.
 */
export function OutputScreen({ state, width = 1920, height = 1080 }: { state: OutputState | null; width?: number; height?: number }) {
  return (
    <DefaultFontContext.Provider value={state?.defaultFont ?? DEFAULT_FONT}>
      <div className="output-area" style={state ? marginsStyle(state.screenMargins) : undefined}>
        <SlideLayers state={state} />
        {/* Above the slide layers and outside their crossfades, so changing slides never touches them. */}
        {state?.overlays && <Overlays overlays={state.overlays} />}
        <AlertBand alert={state?.alert ?? null} />
      </div>
      {state?.testPattern && <TestPattern width={width} height={height} fill={CONTENT_COLORS.black} label={`Output ${width}×${height}`} />}
    </DefaultFontContext.Provider>
  )
}

/** The projector screen. */
export function OutputView() {
  const [state, setState] = useState<OutputState | null>(null)
  const [size, setSize] = useState(() => ({ width: window.screen.width * devicePixelRatio, height: window.screen.height * devicePixelRatio }))

  useEffect(() => window.api.output.onState(setState), [])
  useEffect(() => {
    const measure = () => setSize({ width: Math.round(window.innerWidth * devicePixelRatio), height: Math.round(window.innerHeight * devicePixelRatio) })
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  return (
    <div className="output">
      <OutputScreen state={state} width={size.width} height={size.height} />
    </div>
  )
}

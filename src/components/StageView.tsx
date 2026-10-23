import { useEffect, useState } from 'react'
import { DEFAULT_TEXT_PROPS } from '../../shared/themes'
import type { StageState, ThemeStyle } from '../../shared/types'
import { AlertBand } from './AlertBand'
import { ThemedSlide } from './ThemedSlide'

const NO_SHADOW = { ...DEFAULT_TEXT_PROPS.shadow, enabled: false }

/** Plain, high-contrast text for reading at a glance, with the reference under it; the audience's theme does not matter here. */
const stageStyle = (color: string, fontWeight: number): ThemeStyle => ({
  category: 'song',
  background: { kind: 'solid', color: '#000000' },
  overlay: 0,
  keyTransparent: false,
  elements: [
    { id: 'text', kind: 'text', box: { x: 3, y: 4, width: 94, height: 92 }, locked: false, text: { ...DEFAULT_TEXT_PROPS, fontWeight, color, lineHeight: 1.2, shadow: NO_SHADOW } },
    {
      id: 'reference',
      kind: 'reference',
      box: { x: 3, y: 90, width: 94, height: 6 },
      locked: false,
      attached: true,
      text: { ...DEFAULT_TEXT_PROPS, sizeMode: 'fixed', fontSize: 3.2, fontWeight: 500, color: '#9ca3af', lineHeight: 1.2, shadow: NO_SHADOW },
    },
  ],
})
const CURRENT_STYLE = stageStyle('#ffffff', 700)
const NEXT_STYLE = stageStyle('#facc15', 600)

const MODE_WARNINGS: Record<string, string> = {
  black: 'Output is BLACK',
  clear: 'Output is CLEAR (text hidden)',
  logo: 'Output is showing the LOGO',
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  return <time className="stage-clock">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
}

/** The confidence monitor for the worship leader: the live slide, what comes next and the time. */
export function StageView() {
  const [state, setState] = useState<StageState | null>(null)
  useEffect(() => window.api.stage.onState(setState), [])

  const warning = state ? MODE_WARNINGS[state.mode] : undefined

  return (
    <div className="stage">
      <header className="stage-top">
        <span className="stage-title">{state?.title ?? 'Nothing loaded'}</span>
        {warning && <span className="stage-warning">{warning}</span>}
        <Clock />
      </header>

      <section className="stage-current" aria-label="Current slide">
        {state?.current?.text ? (
          <ThemedSlide theme={CURRENT_STYLE} text={state.current.text} caption={state.current.caption} />
        ) : (
          <p className="stage-empty">No slide live</p>
        )}
        <AlertBand alert={state?.alert ?? null} />
      </section>

      <section className="stage-next" aria-label="Next slide">
        <span className="stage-next-label">Next</span>
        <div className="stage-next-slide">
          {state?.next?.text ? (
            <ThemedSlide theme={NEXT_STYLE} text={state.next.text} caption={state.next.caption} />
          ) : (
            <p className="stage-empty">{state?.nextItemTitle ? `Next item: ${state.nextItemTitle}` : 'End'}</p>
          )}
        </div>
      </section>
    </div>
  )
}

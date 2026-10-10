import { useMemo } from 'react'
import { selectDeckTheme, selectNextSlide, slideTheme, useOperatorStore } from '../store'
import { ThemedSlide } from './ThemedSlide'

/** What the projector shows now, the slide that comes next, and the crossfade length. The mode buttons live in the toolbar. */
export function LivePreview() {
  const slide = useOperatorStore((s) => (s.liveSlideIndex === null ? null : s.slides[s.liveSlideIndex]))
  const next = useOperatorStore(selectNextSlide)
  const mode = useOperatorStore((s) => s.outputMode)
  const deckTheme = useOperatorStore(selectDeckTheme)
  const theme = useMemo(() => slideTheme(deckTheme, slide), [deckTheme, slide])
  const nextTheme = useMemo(() => slideTheme(deckTheme, next), [deckTheme, next])
  const fadeMs = useOperatorStore((s) => s.settings.fadeMs)
  const logoUrl = useOperatorStore((s) => s.settings.logoUrl)
  const setFadeMs = useOperatorStore((s) => s.setFadeMs)

  return (
    <section className="panel preview-panel">
      <header className="panel-header">
        <h2>Live output</h2>
      </header>

      <div className={`preview-screen${mode === 'show' && slide ? ' on-air' : ''}`}>
        <ThemedSlide theme={theme} text={slide?.text ?? ''} caption={slide?.caption} mode={mode} logoUrl={logoUrl} />
      </div>

      <label className="fade-control">
        <span>Crossfade</span>
        <input
          type="range"
          min={0}
          max={1500}
          step={100}
          value={fadeMs}
          onChange={(e) => setFadeMs(Number(e.target.value)).catch(console.error)}
        />
        <span className="fade-value">{(fadeMs / 1000).toFixed(1)} s</span>
      </label>

      <h2 className="preview-subheading">Next</h2>
      <div className="preview-screen next">
        {next ? <ThemedSlide theme={nextTheme} text={next.text} caption={next.caption} still /> : <p className="empty">End of slides</p>}
      </div>
    </section>
  )
}

import { useMemo } from 'react'
import type { OutputMode } from '../../shared/types'
import { selectDeckTheme, slideTheme, useOperatorStore } from '../store'
import { ThemedSlide } from './ThemedSlide'

const MODES: { mode: OutputMode; label: string }[] = [
  { mode: 'show', label: 'Show' },
  { mode: 'black', label: 'Black' },
  { mode: 'clear', label: 'Clear' },
  { mode: 'logo', label: 'Logo' },
]

export function LivePreview() {
  const slide = useOperatorStore((s) => (s.liveSlideIndex === null ? null : s.slides[s.liveSlideIndex]))
  const mode = useOperatorStore((s) => s.outputMode)
  const deckTheme = useOperatorStore(selectDeckTheme)
  const theme = useMemo(() => slideTheme(deckTheme, slide), [deckTheme, slide])
  const fadeMs = useOperatorStore((s) => s.fadeMs)
  const setFadeMs = useOperatorStore((s) => s.setFadeMs)
  const setOutputMode = useOperatorStore((s) => s.setOutputMode)
  const onAir = mode === 'show' && slide !== null

  return (
    <section className="panel preview-panel">
      <header className="panel-header">
        <h2>Live</h2>
        <span className={`live-badge${onAir ? ' on' : ''}`}>
          {onAir ? 'ON AIR' : mode === 'show' ? 'OFF' : mode.toUpperCase()}
        </span>
      </header>

      <div className="output-modes">
        {MODES.map(({ mode: m, label }) => (
          <button
            key={m}
            className={`button${mode === m ? ' active' : ''}`}
            aria-pressed={mode === m}
            onClick={() => setOutputMode(m)}
          >
            {label}
          </button>
        ))}
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

      <div className="preview-screen">
        <ThemedSlide theme={theme} text={slide?.text ?? ''} caption={slide?.caption} mode={mode} />
      </div>
    </section>
  )
}

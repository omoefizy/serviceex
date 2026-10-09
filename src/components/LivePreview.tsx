import type { OutputMode } from '../../shared/types'
import { useOperatorStore } from '../store'
import { LogoPlaceholder } from './OutputView'

const MODES: { mode: OutputMode; label: string }[] = [
  { mode: 'show', label: 'Show' },
  { mode: 'black', label: 'Black' },
  { mode: 'clear', label: 'Clear' },
  { mode: 'logo', label: 'Logo' },
]

export function LivePreview() {
  const slide = useOperatorStore((s) => (s.liveSlideIndex === null ? null : s.slides[s.liveSlideIndex]))
  const mode = useOperatorStore((s) => s.outputMode)
  const background = useOperatorStore((s) => s.background)
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

      <div className="preview-screen" style={{ background: mode === 'black' ? '#000' : background }}>
        {mode === 'show' && slide !== null && (
          <div className="preview-slide">
            <p className="preview-text">{slide.text}</p>
            {slide.caption && <p className="preview-caption">{slide.caption}</p>}
          </div>
        )}
        {mode === 'logo' && <LogoPlaceholder />}
      </div>
    </section>
  )
}

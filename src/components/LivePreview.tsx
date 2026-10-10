import { RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { selectDeckTheme, selectLiveSlide, selectPreviewSlide, slideTheme, useOperatorStore } from '../store'
import { ThemedSlide } from './ThemedSlide'

/** "Amazing Song · slide 2 of 5", or a placeholder. */
function slideLabel(title: string | null, index: number | null, count: number, empty: string): string {
  if (!title || index === null) return empty
  return `${title} · slide ${index + 1} of ${count}`
}

/**
 * LIVE shows the live snapshot, exactly what the projector shows. PREVIEW shows the highlighted slide of the item
 * in the grid, with its theme; Enter or Go Live sends it.
 */
export function LivePreview() {
  const live = useOperatorStore((s) => s.live)
  const liveSlide = useOperatorStore(selectLiveSlide)
  const liveTheme = useMemo(() => slideTheme(live.theme, liveSlide), [live.theme, liveSlide])
  const previewSlide = useOperatorStore(selectPreviewSlide)
  const deckTheme = useOperatorStore(selectDeckTheme)
  const previewTheme = useMemo(() => slideTheme(deckTheme, previewSlide), [deckTheme, previewSlide])
  const deckTitle = useOperatorStore((s) => s.deckTitle)
  const highlightIndex = useOperatorStore((s) => s.highlightIndex)
  const slideCount = useOperatorStore((s) => s.slides.length)
  const fadeMs = useOperatorStore((s) => s.settings.fadeMs)
  const logoUrl = useOperatorStore((s) => s.settings.logoUrl)
  const setFadeMs = useOperatorStore((s) => s.setFadeMs)
  const resendLive = useOperatorStore((s) => s.resendLive)
  const [error, setError] = useState<string | null>(null)

  async function resend() {
    try {
      await resendLive()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="panel preview-panel">
      <header className="panel-header">
        <h2>Live</h2>
      </header>
      <div className="preview-screen live">
        <ThemedSlide theme={liveTheme} text={liveSlide?.text ?? ''} caption={liveSlide?.caption} mode={live.mode} logoUrl={logoUrl} />
      </div>
      <p className="screen-label">
        {slideLabel(live.title, live.slideIndex, live.slides.length, 'Nothing live')}
        {live.mode !== 'show' && <span className="screen-mode"> · {live.mode.toUpperCase()}</span>}
      </p>
      {live.stale && (
        <button type="button" className="stale-chip" onClick={resend} title="The live item was edited after it went live">
          <RefreshCw size={13} aria-hidden="true" /> Live version is older, resend
        </button>
      )}
      {error && <p className="error">{error}</p>}

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

      <h2 className="preview-subheading">Preview</h2>
      <div className="preview-screen preview">
        {previewSlide ? (
          <ThemedSlide theme={previewTheme} text={previewSlide.text} caption={previewSlide.caption} />
        ) : (
          <p className="empty">Select something to preview</p>
        )}
      </div>
      <p className="screen-label">{slideLabel(deckTitle, highlightIndex, slideCount, 'Nothing selected')}</p>
    </section>
  )
}

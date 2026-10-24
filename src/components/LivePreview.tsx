import { AlertTriangle, Eye, EyeOff, Presentation, RefreshCw, Undo2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { LivePowerPointStatus, OutputState } from '../../shared/types'
import { selectDeckTheme, selectOutputState, selectPreviewSlide, slideTheme, useOperatorStore } from '../store'
import { OutputScreen } from './OutputView'
import { ThemedSlide } from './ThemedSlide'

/** "Slide 2 of 5" across the corner of a screen, when it shows a slide. */
function SlideBadge({ index, count }: { index: number | null; count: number }) {
  if (index === null || count === 0) return null
  return (
    <span className="screen-badge">
      Slide {index + 1} of {count}
    </span>
  )
}

/** "Slide 3, step 2 of 4" while PowerPoint plays the live slide, when it can tell the step. */
function powerPointText(status: LivePowerPointStatus): string {
  if (status.phase === 'starting') return 'Starting…'
  if (status.slideIndex === null) return 'Waiting'
  const step = status.steps ? `, step ${status.step ?? '?'} of ${status.steps}` : ''
  return `Slide ${status.slideIndex + 1}${step}${status.phase === 'covered' ? ' (under the output)' : ''}`
}

/**
 * LIVE shows the live snapshot, exactly what the projector shows. PREVIEW shows the highlighted slide of the item
 * in the grid, with its theme; Enter or Go Live sends it.
 */
export function LivePreview() {
  const live = useOperatorStore((s) => s.live)
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
  const goBack = useOperatorStore((s) => s.goBack)
  const previewOutput = useOperatorStore((s) => s.settings.previewOutput)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  // Exactly what the projector draws; a string compares by value, so the screen redraws only when it changes.
  const outputJson = useOperatorStore((s) => (s.settings.previewOutput ? JSON.stringify(selectOutputState(s)) : null))
  const output = useMemo(() => (outputJson ? (JSON.parse(outputJson) as OutputState) : null), [outputJson])
  const canGoBack = useOperatorStore((s) => s.liveHistory.length > 0)
  const powerPoint = useOperatorStore((s) => s.live.powerPoint && s.settings.presentationLivePowerPoint)
  const powerPointStatus = useOperatorStore((s) => s.livePowerPoint)
  const [dismissedFailure, setDismissedFailure] = useState(0)
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
        <button
          type="button"
          className={`button preview-output-toggle${previewOutput ? ' active' : ''}`}
          aria-pressed={previewOutput}
          onClick={() => updateSettings({ previewOutput: !previewOutput }).catch(console.error)}
          title={previewOutput ? 'Stop drawing the output here' : 'Show what the output shows'}
        >
          {previewOutput ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />} Preview Output
        </button>
        <button type="button" className="button go-back-button" disabled={!canGoBack} onClick={goBack} title="Put the previous live slide back on screen">
          <Undo2 size={14} aria-hidden="true" /> Go Back
        </button>
      </header>
      <div className="preview-screen live">
        {output ? <OutputScreen state={output} /> : <p className="empty">Preview Output is off</p>}
        <SlideBadge index={live.slideIndex} count={live.slides.length} />
      </div>
      <p className="screen-label">
        {(live.slideIndex !== null && live.title) || 'Nothing live'}
        {live.mode !== 'show' && <span className="screen-mode"> · {live.mode.toUpperCase()}</span>}
      </p>
      {powerPoint && (
        // The output shows PowerPoint's own slide show; the screen above shows the still slide.
        <p className="powerpoint-status" aria-live="polite">
          <Presentation size={13} aria-hidden="true" /> PowerPoint · {powerPointText(powerPointStatus)}
        </p>
      )}
      {powerPointStatus.phase === 'failed' && powerPointStatus.message && powerPointStatus.failures !== dismissedFailure && (
        <p className="powerpoint-failure" role="alert">
          <AlertTriangle size={13} aria-hidden="true" />
          <span>{powerPointStatus.message}</span>
          <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setDismissedFailure(powerPointStatus.failures)}>
            <X size={12} aria-hidden="true" />
          </button>
        </p>
      )}
      {live.stale &&
        (live.itemType === 'presentation' ? (
          // The original was saved again; the output keeps the older slides until resent (see Auto refresh live).
          <span className="stale-chip" title="The presentation was saved again after it went live">
            <RefreshCw size={13} aria-hidden="true" /> Updated
            <button type="button" className="stale-chip-action" onClick={resend}>
              Resend
            </button>
          </span>
        ) : (
          <button type="button" className="stale-chip" onClick={resend} title="The live item was edited after it went live">
            <RefreshCw size={13} aria-hidden="true" /> Live version is older, resend
          </button>
        ))}
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
          <ThemedSlide theme={previewTheme} text={previewSlide.text} caption={previewSlide.caption} copyright={previewSlide.copyright} logoUrl={logoUrl} />
        ) : (
          <p className="empty">Select something to preview</p>
        )}
        <SlideBadge index={previewSlide ? highlightIndex : null} count={slideCount} />
      </div>
      <p className="screen-label">{(highlightIndex !== null && deckTitle) || 'Nothing selected'}</p>
    </section>
  )
}

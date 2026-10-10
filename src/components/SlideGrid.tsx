import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { CornerUpLeft, ImageOff, MonitorUp, RefreshCw, ZoomIn } from 'lucide-react'
import { MEDIA_DRAG_TYPE } from '../lib/media'
import { sectionColor } from '../lib/sections'
import { MOD } from '../lib/shortcuts'
import { usePersistentState } from '../lib/usePersistentState'
import { selectBaseThemeId, selectBrowsingLive, selectDeckTheme, slideTheme, useOperatorStore } from '../store'
import { ThemedSlide } from './ThemedSlide'

export function SlideGrid() {
  const song = useOperatorStore((s) => s.selectedSong)
  const title = useOperatorStore((s) => s.deckTitle)
  const slides = useOperatorStore((s) => s.slides)
  const highlightIndex = useOperatorStore((s) => s.highlightIndex)
  const live = useOperatorStore((s) => s.live)
  const browsingLive = useOperatorStore(selectBrowsingLive)
  /** The live slide's index in this grid, only when the grid shows the live item. */
  const liveIndexHere = browsingLive ? live.slideIndex : null
  const goLive = useOperatorStore((s) => s.goLive)
  const goLiveHighlighted = useOperatorStore((s) => s.goLiveHighlighted)
  const jumpToLive = useOperatorStore((s) => s.jumpToLive)
  const resendLive = useOperatorStore((s) => s.resendLive)
  const theme = useOperatorStore(selectDeckTheme)
  const themes = useOperatorStore((s) => s.themes)
  const deckThemeId = useOperatorStore((s) => s.deckThemeId)
  const setDeckTheme = useOperatorStore((s) => s.setDeckTheme)
  const baseTheme = useOperatorStore((s) => s.themes.find((t) => t.id === selectBaseThemeId(s)))
  const usesSongTheme = useOperatorStore((s) => s.deckType === 'song' && !!s.selectedSong?.themeId)
  const deckKey = useOperatorStore((s) => s.deckKey)
  const setSlideBackground = useOperatorStore((s) => s.setSlideBackground)
  /** Thumbnail width in pixels, from the zoom slider. */
  const [thumbWidth, setThumbWidth] = usePersistentState(
    'worshipdeck.thumbWidth',
    200,
    (v): v is number => typeof v === 'number' && v >= 120 && v <= 400,
  )
  const gridRef = useRef<HTMLDivElement>(null)
  /** The slide a library item is being dragged over. */
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const slideThemes = useMemo(() => slides.map((slide) => slideTheme(theme, slide)), [slides, theme])

  // Presentation pages are their own picture, so they take no background.
  const canDrop = (e: DragEvent, index: number) =>
    deckKey !== null && !slides[index]?.page && e.dataTransfer.types.includes(MEDIA_DRAG_TYPE)

  function handleDrop(e: DragEvent, index: number) {
    e.preventDefault()
    setDropIndex(null)
    const mediaId = Number(e.dataTransfer.getData(MEDIA_DRAG_TYPE))
    if (mediaId > 0) setSlideBackground(index, mediaId).catch(console.error)
  }

  // Keep the preview highlight, and the live slide when this is the live item, in view as the keys move them.
  useEffect(() => {
    for (const index of [highlightIndex, liveIndexHere]) {
      if (index === null) continue
      gridRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightIndex, liveIndexHere])

  /** The grid shows the live item, but its theme or content changed since it went live. */
  const liveDiffers = browsingLive && (live.stale || JSON.stringify(theme) !== JSON.stringify(live.theme))

  return (
    <section className="panel slide-panel">
      <header className="panel-header">
        <h2>{title ?? 'Slides'}</h2>
        <div className="panel-header-actions">
          {/* Changes the theme of the item in the grid and preview only; Resend takes it to live. */}
          <select
            className="input theme-picker"
            aria-label="Theme"
            value={deckThemeId ?? ''}
            disabled={title === null}
            onChange={(e) => setDeckTheme(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">
              {usesSongTheme ? 'Song theme' : 'Default'}
              {baseTheme ? `: ${baseTheme.name}` : ''}
            </option>
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <label className="zoom-control" title="Thumbnail size">
            <ZoomIn size={15} aria-hidden="true" />
            <input
              type="range"
              aria-label="Thumbnail size"
              min={120}
              max={400}
              step={20}
              value={thumbWidth}
              onChange={(e) => setThumbWidth(Number(e.target.value))}
            />
          </label>
        </div>
      </header>
      <div className="grid-live-bar">
        {live.deckKey !== null && !browsingLive && (
          <span className="live-chip" title="What the projector is showing">
            <span className="live-dot" aria-hidden="true" /> Live: {live.title}
            <button type="button" className="live-chip-jump" onClick={jumpToLive} title="Show the live item in the grid">
              <CornerUpLeft size={13} aria-hidden="true" /> Show
            </button>
          </span>
        )}
        {liveDiffers && (
          <button type="button" className="button resend-button" onClick={() => resendLive().catch(console.error)}>
            <RefreshCw size={14} aria-hidden="true" /> Resend to live
          </button>
        )}
        <button
          type="button"
          className="button primary go-live-button"
          disabled={slides.length === 0}
          title="Send the highlighted slide live (Enter)"
          onClick={goLiveHighlighted}
        >
          <MonitorUp size={15} aria-hidden="true" /> Go Live
        </button>
      </div>
      {title !== null && (
        <p className="hint slide-hint">
          Click a slide or press Enter to go live · ↑ ↓ preview · ← → live slide · {MOD}↓ next schedule item
        </p>
      )}

      {title === null && <p className="empty">Select a song or look up scripture to see its slides.</p>}
      {song && slides.length === 0 && <p className="empty">This song has no lyrics.</p>}

      <div className="slide-grid" ref={gridRef} style={{ '--thumb-width': `${thumbWidth}px` } as CSSProperties}>
        {slides.map(({ text, caption, label, background, page }, index) => (
          <div
            key={index}
            className={`slide-cell${dropIndex === index ? ' drop' : ''}`}
            onDragOver={(e) => {
              if (!canDrop(e, index)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
              setDropIndex(index)
            }}
            onDragLeave={() => setDropIndex((current) => (current === index ? null : current))}
            onDrop={(e) => handleDrop(e, index)}
          >
            <button
              data-index={index}
              className={`slide-card themed${index === liveIndexHere ? ' live' : ''}${index === highlightIndex ? ' preview' : ''}`}
              style={label ? ({ '--section-color': sectionColor(label) } as CSSProperties) : undefined}
              aria-label={`Slide ${index + 1}${label ? `, ${label}` : ''}${index === liveIndexHere ? ', live' : ''}${index === highlightIndex ? ', in preview' : ''}`}
              title="Go live with this slide"
              onClick={() => goLive(index)}
            >
              <ThemedSlide theme={slideThemes[index]} text={text} caption={caption} still />
              <span className="slide-number">{index + 1}</span>
              {label && <span className="slide-caption section-label">{label}</span>}
            </button>
            {background && !page && (
              <button
                className="slide-bg-clear"
                aria-label="Use the theme background for this slide"
                title="Use the theme background for this slide"
                onClick={() => setSlideBackground(index, null).catch(console.error)}
              >
                <ImageOff size={12} aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

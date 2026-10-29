import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { AlertTriangle, Clapperboard, Columns2, CornerUpLeft, ImageOff, LayoutGrid, List, MonitorUp, RefreshCw, StickyNote, Type, ZoomIn } from 'lucide-react'
import { MEDIA_DRAG_TYPE } from '../lib/media'
import { sectionColor } from '../lib/sections'
import { slideLines } from '../lib/slides'
import { MOD } from '../lib/shortcuts'
import { usePersistentState } from '../lib/usePersistentState'
import { useVirtualGrid } from '../lib/useVirtualGrid'
import { selectBaseThemeId, selectBrowsingLive, selectDeckPresentation, selectDeckTheme, slideTheme, useOperatorStore } from '../store'
import { NativeSlideEditor } from './NativeSlideEditor'
import { SlideFormatModal } from './SlideFormatModal'
import { ThemedSlide } from './ThemedSlide'

type SlideView = 'grid' | 'list'

const ANIMATED_HINT = 'Animated in PowerPoint, shown as a still image'

/** Marks a presentation slide that has animations or a transition in PowerPoint. */
function AnimatedMark() {
  return (
    <span className="slide-animated" title={ANIMATED_HINT} aria-label={ANIMATED_HINT} role="img">
      <Clapperboard size={12} aria-hidden="true" />
    </span>
  )
}

/** Marks a Native mode slide with something it could not draw; the tooltip says what. */
function WarningMark({ warnings }: { warnings: string[] }) {
  const hint = warnings.join('\n')
  return (
    <span className="slide-warning" title={hint} aria-label={hint} role="img">
      <AlertTriangle size={12} aria-hidden="true" />
    </span>
  )
}

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
  const setHighlight = useOperatorStore((s) => s.setHighlight)
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
  const deckType = useOperatorStore((s) => s.deckType)
  const setSlideBackground = useOperatorStore((s) => s.setSlideBackground)
  /** A Native mode presentation in the grid, whose slides open in the compare view. */
  const nativePresentation = useOperatorStore((s) => {
    const presentation = selectDeckPresentation(s)
    return presentation?.mode === 'native' ? presentation : undefined
  })
  /** The slide open in the compare view. */
  const [comparing, setComparing] = useState<number | null>(null)
  /** A scripture or announcement item from the schedule, whose slides can be formatted and kept with it. */
  const formattableItemId = useOperatorStore((s) => {
    const item = s.service?.items.find((i) => i.id === s.activeItemId)
    return item && s.deckKey === `item:${item.id}` && (item.type === 'scripture' || item.type === 'announcement') ? item.id : null
  })
  const editSong = useOperatorStore((s) => s.editSong)
  const selectedSongId = useOperatorStore((s) => (s.deckType === 'song' ? (s.selectedSong?.id ?? null) : null))
  const [formatting, setFormatting] = useState(false)
  /** Thumbnail width in pixels, from the zoom slider; the grid never draws them under 180. */
  const [thumbWidth, setThumbWidth] = usePersistentState(
    'worshipdeck.thumbWidth',
    180,
    (v): v is number => typeof v === 'number' && v >= 120 && v <= 400,
  )
  /** Thumbnails, or compact numbered rows of slide text. */
  const [view, setView] = usePersistentState<SlideView>('worshipdeck.slideView', 'grid', (v): v is SlideView => v === 'grid' || v === 'list')
  const gridRef = useRef<HTMLDivElement>(null)
  /** The slide a library item is being dragged over. */
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  // A presentation page shows its small picture in the grid; the preview and live output load the full one.
  const slideThemes = useMemo(
    () =>
      slides.map((slide) =>
        slideTheme(theme, slide.page && slide.thumb && slide.background?.kind === 'image' ? { ...slide, background: { ...slide.background, src: slide.thumb } } : slide),
      ),
    [slides, theme],
  )
  /** Only the rows in view, for large decks. */
  const windowed = useVirtualGrid(gridRef, slides.length, thumbWidth, view === 'grid')

  // Presentation pages are their own picture, so they take no background.
  const canDrop = (e: DragEvent, index: number) =>
    deckKey !== null && !slides[index]?.page && e.dataTransfer.types.includes(MEDIA_DRAG_TYPE)

  function handleDrop(e: DragEvent, index: number) {
    e.preventDefault()
    setDropIndex(null)
    const mediaId = Number(e.dataTransfer.getData(MEDIA_DRAG_TYPE))
    if (mediaId > 0) setSlideBackground(index, mediaId).catch(console.error)
  }

  /** Lets a library item be dropped on a slide, in either view. */
  const dropTarget = (index: number) => ({
    onDragOver(e: DragEvent) {
      if (!canDrop(e, index)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setDropIndex(index)
    },
    onDragLeave() {
      setDropIndex((current) => (current === index ? null : current))
    },
    onDrop(e: DragEvent) {
      handleDrop(e, index)
    },
  })

  // Keep the preview highlight, and the live slide when this is the live item, in view as the keys move them. Only the
  // grid scrolls: scrollIntoView would also scroll the card (and the column) that clip it.
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    for (const index of [highlightIndex, liveIndexHere]) {
      if (index === null) continue
      let top: number
      let height: number
      if (windowed) {
        // The slide may not be rendered: place it from the layout.
        top = windowed.rowTop(index)
        height = windowed.rowHeight
      } else {
        const cell = grid.querySelector<HTMLElement>(`[data-index="${index}"]`)
        if (!cell) continue
        top = cell.getBoundingClientRect().top - grid.getBoundingClientRect().top + grid.scrollTop
        height = cell.offsetHeight
      }
      if (top < grid.scrollTop) grid.scrollTop = top
      else if (top + height > grid.scrollTop + grid.clientHeight) grid.scrollTop = top + height - grid.clientHeight
    }
    // The window moves with the scroll; only a new slide to show matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightIndex, liveIndexHere, view])

  /** The grid shows the live item, but its theme or content changed since it went live. */
  const liveDiffers = browsingLive && (live.stale || JSON.stringify(theme) !== JSON.stringify(live.theme))
  /** The highlighted presentation slide's speaker notes. */
  const notes = deckType === 'presentation' && highlightIndex !== null ? slides[highlightIndex]?.notes?.trim() : undefined

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
          {(formattableItemId !== null || selectedSongId !== null) && (
            <button
              type="button"
              className="icon-button"
              aria-label="Format slides"
              title={selectedSongId !== null ? 'Format slides in the song editor' : 'Format slides'}
              onClick={() => (selectedSongId !== null ? editSong(selectedSongId) : setFormatting(true))}
            >
              <Type size={15} />
            </button>
          )}
          <span className="segmented view-toggle" role="radiogroup" aria-label="Slide view">
            <button type="button" role="radio" aria-checked={view === 'grid'} className={view === 'grid' ? 'active' : ''} title="Grid" aria-label="Grid" onClick={() => setView('grid')}>
              <LayoutGrid size={14} aria-hidden="true" />
            </button>
            <button type="button" role="radio" aria-checked={view === 'list'} className={view === 'list' ? 'active' : ''} title="List" aria-label="List" onClick={() => setView('list')}>
              <List size={14} aria-hidden="true" />
            </button>
          </span>
          <label className="zoom-control" title="Thumbnail size" hidden={view === 'list'}>
            <ZoomIn size={15} aria-hidden="true" />
            <input
              type="range"
              aria-label="Thumbnail size"
              min={180}
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
          Click a slide to preview it, double click or Enter to go live · ↑ ↓ preview (next or previous verse when scripture
          is live) · ← → live slide · {MOD}↓ next schedule item
        </p>
      )}

      {title === null && <p className="empty">Select a song or look up scripture to see its slides.</p>}
      {song && slides.length === 0 && <p className="empty">This song has no lyrics.</p>}

      {view === 'list' ? (
        <div className="slide-list" ref={gridRef}>
          {slides.map(({ text, caption, label, page, pageText, animated, warnings }, index) => (
            <div
              key={index}
              className={`slide-cell${dropIndex === index ? ' drop' : ''}`}
              {...dropTarget(index)}
            >
              <button
                data-index={index}
                className={`slide-row${index === liveIndexHere ? ' live' : ''}${index === highlightIndex ? ' preview' : ''}`}
                style={label ? ({ '--section-color': sectionColor(label) } as CSSProperties) : undefined}
                aria-label={`Slide ${index + 1}${label ? `, ${label}` : ''}${index === liveIndexHere ? ', live' : ''}${index === highlightIndex ? ', in preview' : ''}`}
                title="Click to preview, double click to go live"
                onClick={() => setHighlight(index)}
                onDoubleClick={() => goLive(index)}
              >
                <span className="slide-row-number">{index + 1}</span>
                <span className="slide-row-bar" aria-hidden="true" />
                <span className="slide-row-body">
                  {label && <span className="slide-row-label">{label}</span>}
                  <span className="slide-row-text">
                    {page ? (
                      <span className={`slide-row-line${pageText ? '' : ' hint'}`}>{pageText?.split('\n')[0] || 'Presentation page'}</span>
                    ) : (
                      slideLines(text).map((line, i) => (
                        <span key={i} className={`slide-row-line ${line.kind}`}>
                          {line.text}
                        </span>
                      ))
                    )}
                  </span>
                  {/* A scripture slide's reference; a song's only caption is its copyright, which is left out. */}
                  {caption && deckType !== 'song' && <span className="slide-row-caption">{caption}</span>}
                </span>
                {animated && <AnimatedMark />}
                {warnings && <WarningMark warnings={warnings} />}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="slide-grid" ref={gridRef} style={{ '--thumb-width': `${thumbWidth}px` } as CSSProperties}>
          {windowed && windowed.padTop > 0 && <div className="slide-grid-spacer" style={{ height: windowed.padTop }} aria-hidden="true" />}
          {(windowed ? slides.slice(windowed.start, windowed.end) : slides).map(({ text, caption, rich, label, background, page, animated, warnings }, offset) => {
            const index = offset + (windowed?.start ?? 0)
            return (
            <div
              key={index}
              className={`slide-cell${dropIndex === index ? ' drop' : ''}`}
              {...dropTarget(index)}
            >
              <button
                data-index={index}
                className={`slide-card themed${index === liveIndexHere ? ' live' : ''}${index === highlightIndex ? ' preview' : ''}`}
                style={label ? ({ '--section-color': sectionColor(label) } as CSSProperties) : undefined}
                aria-label={`Slide ${index + 1}${label ? `, ${label}` : ''}${index === liveIndexHere ? ', live' : ''}${index === highlightIndex ? ', in preview' : ''}`}
                title="Click to preview, double click to go live"
                onClick={() => setHighlight(index)}
                onDoubleClick={() => goLive(index)}
              >
                <ThemedSlide theme={slideThemes[index]} text={text} caption={caption} rich={rich} still />
                <span className="slide-number">{index + 1}</span>
                {index === liveIndexHere && <span className="slide-live-chip">LIVE</span>}
                {label && <span className="slide-caption section-label">{label}</span>}
                {animated && <AnimatedMark />}
                {warnings && <WarningMark warnings={warnings} />}
              </button>
              {nativePresentation && (
                <button
                  className="slide-bg-clear"
                  aria-label={`Compare slide ${index + 1} with PowerPoint`}
                  title="Compare with PowerPoint"
                  onClick={() => setComparing(index)}
                >
                  <Columns2 size={12} aria-hidden="true" />
                </button>
              )}
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
            )
          })}
          {windowed && windowed.padBottom > 0 && <div className="slide-grid-spacer" style={{ height: windowed.padBottom }} aria-hidden="true" />}
        </div>
      )}
      {formatting && formattableItemId !== null && (
        <SlideFormatModal itemId={formattableItemId} startIndex={highlightIndex ?? 0} onClose={() => setFormatting(false)} />
      )}
      {nativePresentation && comparing !== null && (
        <NativeSlideEditor presentationId={nativePresentation.id} index={comparing} onClose={() => setComparing(null)} />
      )}
      {notes && (
        <aside className="speaker-notes" aria-label={`Speaker notes for slide ${(highlightIndex ?? 0) + 1}`}>
          <h3>
            <StickyNote size={13} aria-hidden="true" /> Notes · slide {(highlightIndex ?? 0) + 1}
          </h3>
          <p>{notes}</p>
        </aside>
      )}
    </section>
  )
}

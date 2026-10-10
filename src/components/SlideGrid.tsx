import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { ImageOff, ZoomIn } from 'lucide-react'
import { MEDIA_DRAG_TYPE } from '../lib/media'
import { sectionColor } from '../lib/sections'
import { MOD } from '../lib/shortcuts'
import { usePersistentState } from '../lib/usePersistentState'
import { selectBaseThemeId, selectDeckTheme, selectNextSlide, slideTheme, useOperatorStore } from '../store'
import { ThemedSlide } from './ThemedSlide'

export function SlideGrid() {
  const song = useOperatorStore((s) => s.selectedSong)
  const title = useOperatorStore((s) => s.deckTitle)
  const slides = useOperatorStore((s) => s.slides)
  const liveSlideIndex = useOperatorStore((s) => s.liveSlideIndex)
  const showSlide = useOperatorStore((s) => s.showSlide)
  const theme = useOperatorStore(selectDeckTheme)
  const themes = useOperatorStore((s) => s.themes)
  const deckThemeId = useOperatorStore((s) => s.deckThemeId)
  const setDeckTheme = useOperatorStore((s) => s.setDeckTheme)
  const baseTheme = useOperatorStore((s) => s.themes.find((t) => t.id === selectBaseThemeId(s)))
  const usesSongTheme = useOperatorStore((s) => s.deckType === 'song' && !!s.selectedSong?.themeId)
  const deckKey = useOperatorStore((s) => s.deckKey)
  const setSlideBackground = useOperatorStore((s) => s.setSlideBackground)
  const nextSlideIndex = useOperatorStore((s) => {
    const next = selectNextSlide(s)
    return next ? s.slides.indexOf(next) : null
  })
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

  // Keep the live slide visible when the arrow keys move past the edge of the panel.
  useEffect(() => {
    if (liveSlideIndex === null) return
    gridRef.current
      ?.querySelector<HTMLElement>(`[data-index="${liveSlideIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [liveSlideIndex])

  return (
    <section className="panel slide-panel">
      <header className="panel-header">
        <h2>{title ?? 'Slides'}</h2>
        <div className="panel-header-actions">
          {/* Changes the theme of what is loaded right now, live; loading something else goes back to its default. */}
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
      {title !== null && <p className="hint slide-hint">← → move between slides · {MOD}↓ next schedule item</p>}

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
              className={`slide-card themed${index === liveSlideIndex ? ' live' : index === nextSlideIndex ? ' next' : ''}`}
              style={label ? ({ '--section-color': sectionColor(label) } as CSSProperties) : undefined}
              aria-label={`Slide ${index + 1}${label ? `, ${label}` : ''}${index === liveSlideIndex ? ', live' : index === nextSlideIndex ? ', next' : ''}`}
              onClick={() => showSlide(index)}
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

import { useEffect, useRef } from 'react'
import { selectBaseThemeId, selectDeckTheme, useOperatorStore } from '../store'
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
  const openThemeEditor = useOperatorStore((s) => s.openThemeEditor)
  const baseTheme = useOperatorStore((s) => s.themes.find((t) => t.id === selectBaseThemeId(s)))
  const usesSongTheme = useOperatorStore((s) => s.deckType === 'song' && !!s.selectedSong?.themeId)
  const gridRef = useRef<HTMLDivElement>(null)

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
          <button className="button" onClick={() => openThemeEditor(true)}>
            Themes…
          </button>
        </div>
      </header>
      {title !== null && <p className="hint slide-hint">← → to move between slides · ⌘↓ next schedule item</p>}

      {title === null && <p className="empty">Select a song or look up scripture to see its slides.</p>}
      {song && slides.length === 0 && <p className="empty">This song has no lyrics.</p>}

      <div className="slide-grid" ref={gridRef}>
        {slides.map(({ text, caption, label }, index) => (
          <button
            key={index}
            data-index={index}
            className={`slide-card themed${index === liveSlideIndex ? ' live' : ''}`}
            onClick={() => showSlide(index)}
          >
            <ThemedSlide theme={theme} text={text} caption={caption} still />
            <span className="slide-number">{index + 1}</span>
            {label && <span className="slide-caption">{label}</span>}
          </button>
        ))}
      </div>
    </section>
  )
}

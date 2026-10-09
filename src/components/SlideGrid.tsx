import { useEffect, useRef } from 'react'
import { useOperatorStore } from '../store'

export function SlideGrid() {
  const song = useOperatorStore((s) => s.selectedSong)
  const slides = useOperatorStore((s) => s.slides)
  const liveSlideIndex = useOperatorStore((s) => s.liveSlideIndex)
  const showSlide = useOperatorStore((s) => s.showSlide)
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
        <h2>{song ? song.title : 'Slides'}</h2>
        {song && <span className="hint">← → to move between slides</span>}
      </header>

      {!song && <p className="empty">Select a song to see its slides.</p>}
      {song && slides.length === 0 && <p className="empty">This song has no lyrics.</p>}

      <div className="slide-grid" ref={gridRef}>
        {slides.map((text, index) => (
          <button
            key={index}
            data-index={index}
            className={`slide-card${index === liveSlideIndex ? ' live' : ''}`}
            onClick={() => showSlide(index)}
          >
            <span className="slide-number">{index + 1}</span>
            <span className="slide-text">{text}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

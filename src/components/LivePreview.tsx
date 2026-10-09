import { useOperatorStore } from '../store'

export function LivePreview() {
  const text = useOperatorStore((s) => (s.liveSlideIndex === null ? null : s.slides[s.liveSlideIndex]))

  return (
    <section className="panel preview-panel">
      <header className="panel-header">
        <h2>Live</h2>
        <span className={`live-badge${text !== null ? ' on' : ''}`}>{text !== null ? 'ON AIR' : 'OFF'}</span>
      </header>

      <div className="preview-screen">
        {text !== null && <p className="preview-text">{text}</p>}
      </div>
    </section>
  )
}

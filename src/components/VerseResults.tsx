import { ListPlus, MonitorUp } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { canMakeRange, itemTitle, passageOf, sendLive, type ResultItem } from '../lib/scripture'
import { useOperatorStore } from '../store'

interface Props {
  items: ResultItem[]
  /** Shown above the cards, such as "128 verses". */
  heading: ReactNode
  /** When this changes (a new search), the selection is cleared. */
  resetKey: string
  hasMore?: boolean
  loading?: boolean
  onLoadMore?(): void
  /** Called when a result is sent live or scheduled, to remember the search. */
  onUse?(): void
}

/** Verse cards: click one to send it live; tick several to send or schedule them as a range or a sequence. */
export function VerseResults({ items, heading, resetKey, hasMore = false, loading = false, onLoadMore, onUse }: Props) {
  const service = useOperatorStore((s) => s.service)
  const addToSchedule = useOperatorStore((s) => s.addToSchedule)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<'range' | 'sequence'>('sequence')
  const [error, setError] = useState<string | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)

  useEffect(() => setSelected(new Set()), [resetKey])

  // Load the next 30 when the end of the list scrolls into view.
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasMore || !onLoadMore) return
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onLoadMore())
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, onLoadMore, items.length])

  const chosen = items.filter((item) => selected.has(item.key))
  const rangeOk = canMakeRange(chosen)
  const effectiveMode = mode === 'range' && !rangeOk ? 'sequence' : mode

  async function use(list: ResultItem[], how: 'range' | 'sequence', action: 'live' | 'schedule') {
    setError(null)
    try {
      const passage = await passageOf(list, how)
      if (!passage) throw new Error('Those verses could not be read from the Bible.')
      if (action === 'live') sendLive(passage)
      else await addToSchedule('scripture', null, passage)
      onUse?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="verse-results">
      <div className="verse-results-head">{heading}</div>

      {chosen.length > 0 && (
        <div className="selection-bar" role="region" aria-label="Selected verses">
          <span>{chosen.length} selected</span>
          <span className="segmented" role="radiogroup" aria-label="Send as">
            <button
              type="button"
              role="radio"
              aria-checked={effectiveMode === 'range'}
              className={effectiveMode === 'range' ? 'active' : ''}
              disabled={!rangeOk}
              title={rangeOk ? 'Every verse from the first selected to the last' : 'A range needs verses from one chapter of one version'}
              onClick={() => setMode('range')}
            >
              Range
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={effectiveMode === 'sequence'}
              className={effectiveMode === 'sequence' ? 'active' : ''}
              title="Just the selected verses, one after another"
              onClick={() => setMode('sequence')}
            >
              Sequence
            </button>
          </span>
          <button type="button" className="button" onClick={() => use(chosen, effectiveMode, 'live')}>
            <MonitorUp size={15} aria-hidden="true" /> Send live
          </button>
          <button
            type="button"
            className="button"
            disabled={!service}
            title={service ? `Add to ${service.name}` : 'Create a service first'}
            onClick={() => use(chosen, effectiveMode, 'schedule')}
          >
            <ListPlus size={15} aria-hidden="true" /> Schedule
          </button>
          <button type="button" className="button" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      <ul className="verse-cards">
        {items.map((item) => {
          const title = itemTitle(item)
          return (
            <li key={item.key} className={`verse-card${selected.has(item.key) ? ' selected' : ''}`}>
              <input type="checkbox" aria-label={`Select ${title}`} checked={selected.has(item.key)} onChange={() => toggle(item.key)} />
              <button type="button" className="verse-card-main" title="Send live" onClick={() => use([item], 'sequence', 'live')}>
                <span className="verse-card-ref">{title}</span>
                <span className="verse-card-text">
                  {item.segments
                    ? item.segments.map((s, i) => (s.match ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>))
                    : item.verses.map((v) => v.text).join(' ')}
                </span>
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Add ${title} to schedule`}
                title={service ? `Add to ${service.name}` : 'Create a service first'}
                disabled={!service}
                onClick={() => use([item], 'sequence', 'schedule')}
              >
                <ListPlus size={15} />
              </button>
            </li>
          )
        })}
      </ul>

      {hasMore && (
        <div ref={sentinel} className="verse-results-more">
          <button type="button" className="button" disabled={loading} onClick={onLoadMore}>
            {loading ? 'Loading…' : 'Load 30 more'}
          </button>
        </div>
      )}
    </div>
  )
}

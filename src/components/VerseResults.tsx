import { Eye, ListPlus } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { formatReference } from '../../shared/parseReference'
import { canMakeRange, passageOf, previewPassage, resultSegments, type ResultItem } from '../lib/scripture'
import { verseCaption } from '../lib/slides'
import { selectLiveSlide, selectPreviewSlide, useOperatorStore } from '../store'

export interface VerseResultsHandle {
  /** Ticks or unticks the row at `index` (Space in the search box). */
  toggle(index: number): void
}

interface Props {
  items: ResultItem[]
  /** Shown above the table, such as "1 Peter 2, 25 verses". */
  heading: ReactNode
  /** When this changes (a new search), the ticks are cleared. */
  resetKey: string
  /** When this changes, the active row is scrolled to the top so the verses after it show; otherwise just into view. */
  scrollKey: string
  /** The row Up and Down in the search box have moved to. */
  active: number
  onActiveChange(index: number): void
  /** Rows in the typed verse or range, such as John 3:16-18. */
  isMarked?(item: ResultItem): boolean
  /** Click previews a row (live false); double-click sends it live. */
  onOpen(item: ResultItem, live: boolean): void
  /** A last row under the verses, such as "Search verses for job"; it is active at index `items.length`. */
  footer?: { label: ReactNode; onChoose(): void }
  hasMore?: boolean
  loading?: boolean
  onLoadMore?(): void
  /** Called when a result is previewed or scheduled, to remember the search. */
  onUse?(): void
}

/** A result's verse text, the keyword matches highlighted. */
export function VerseText({ item }: { item: ResultItem }) {
  return <>{resultSegments(item).map((s, i) => (s.match ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>))}</>
}

/**
 * The results as a table with Translation, Reference and Scripture columns. Click a row to preview it, double-click
 * to go live; tick several to preview or schedule them as a range or a sequence. The live verse is marked.
 */
export const VerseResults = forwardRef<VerseResultsHandle, Props>(function VerseResults(
  { items, heading, resetKey, scrollKey, active, onActiveChange, isMarked, onOpen, footer, hasMore = false, loading = false, onLoadMore, onUse },
  ref,
) {
  const service = useOperatorStore((s) => s.service)
  const addToSchedule = useOperatorStore((s) => s.addToSchedule)
  const previewCaption = useOperatorStore((s) => (s.deckType === 'scripture' ? (selectPreviewSlide(s)?.caption ?? null) : null))
  const liveCaption = useOperatorStore((s) => (s.live.itemType === 'scripture' ? (selectLiveSlide(s)?.caption ?? null) : null))
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<'range' | 'sequence'>('sequence')
  const [error, setError] = useState<string | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const rows = useRef<(HTMLTableRowElement | null)[]>([])
  const scrolledFor = useRef<string | null>(null)
  const scrolledAt = useRef(-1)

  useEffect(() => setSelected(new Set()), [resetKey])

  // Keep the active row in view; for a new search or verse, put it at the top with what follows below it.
  useEffect(() => {
    const row = rows.current[active]
    if (!row) return
    const fresh = scrolledFor.current !== scrollKey
    // More rows loading in (Load 30 more) leave the scroll where it is.
    if (!fresh && scrolledAt.current === active) return
    scrolledFor.current = scrollKey
    scrolledAt.current = active
    row.scrollIntoView({ block: fresh ? 'start' : 'nearest' })
  }, [active, scrollKey, items])

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

  async function use(list: ResultItem[], how: 'range' | 'sequence', action: 'preview' | 'schedule') {
    setError(null)
    try {
      const passage = await passageOf(list, how)
      if (!passage) throw new Error('Those verses could not be read from the Bible.')
      if (action === 'preview') previewPassage(passage)
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

  useImperativeHandle(ref, () => ({ toggle: (index) => items[index] && toggle(items[index].key) }), [items])

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
          <button type="button" className="button" onClick={() => use(chosen, effectiveMode, 'preview')}>
            <Eye size={15} aria-hidden="true" /> Preview
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

      {(items.length > 0 || footer) && (
        <table className="verse-table">
          <thead>
            <tr>
              <th scope="col" aria-label="Select" />
              <th scope="col">Translation</th>
              <th scope="col">Reference</th>
              <th scope="col">Scripture</th>
              <th scope="col" aria-label="Schedule" />
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const reference = formatReference(item)
              const caption = item.verseStart === item.verseEnd && item.verses[0] ? verseCaption(item.verses[0], item.version) : null
              return (
                <tr
                  key={item.key}
                  ref={(el) => {
                    rows.current[index] = el
                  }}
                  className={[
                    index === active ? 'active' : '',
                    isMarked?.(item) ? 'marked' : '',
                    selected.has(item.key) ? 'selected' : '',
                    caption && caption === liveCaption ? 'live' : '',
                    caption && caption === previewCaption ? 'preview' : '',
                  ].join(' ')}
                  aria-selected={index === active}
                  title="Click to preview, double-click to go live"
                  // Keep the keyboard in the search box.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onActiveChange(index)
                    onOpen(item, false)
                  }}
                  onDoubleClick={() => onOpen(item, true)}
                >
                  <td className="verse-table-tick" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${reference} ${item.version}`} checked={selected.has(item.key)} onChange={() => toggle(item.key)} />
                  </td>
                  <td className="verse-table-version">{item.version}</td>
                  <td className="verse-table-ref">{reference}</td>
                  <td className="verse-table-text" title={item.verses.map((v) => v.text).join(' ')}>
                    {/* At most 3 lines; the whole verse is in the tooltip and the strip under the list. */}
                    <div className="verse-table-clamp">
                      <VerseText item={item} />
                    </div>
                  </td>
                  <td onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Add ${reference} ${item.version} to schedule`}
                      title={service ? `Add to ${service.name}` : 'Create a service first'}
                      disabled={!service}
                      onClick={() => use([item], 'sequence', 'schedule')}
                    >
                      <ListPlus size={15} />
                    </button>
                  </td>
                </tr>
              )
            })}
            {footer && (
              <tr
                ref={(el) => {
                  rows.current[items.length] = el
                }}
                className={`verse-table-footer${active === items.length ? ' active' : ''}`}
                aria-selected={active === items.length}
                onMouseDown={(e) => e.preventDefault()}
                onClick={footer.onChoose}
              >
                <td colSpan={5}>{footer.label}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {hasMore && (
        <div ref={sentinel} className="verse-results-more">
          <button type="button" className="button" disabled={loading} onClick={onLoadMore}>
            {loading ? 'Loading…' : 'Load 30 more'}
          </button>
        </div>
      )}
    </div>
  )
})

import { Check, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import type { AiError, AiTasks } from '../../shared/types'
import { diffLines } from '../lib/lineDiff'

type Cleaned = AiTasks['cleanLyrics']['output']

interface Props {
  /** The lyrics that were sent to be cleaned. */
  original: string
  /** The answer, or null while the request runs. */
  result: Cleaned | null
  error: AiError | null
  onAccept(cleaned: Cleaned): void
  onClose(): void
}

/** Original on the left, cleaned on the right; changed lines highlighted on both sides. */
export function LyricsDiff({ original, cleaned }: { original: string; cleaned: string }) {
  const rows = useMemo(() => diffLines(original, cleaned), [original, cleaned])
  return (
    <div className="diff" role="table" aria-label="Original and cleaned lyrics">
      <div className="diff-row diff-head" role="row">
        <span role="columnheader">Original</span>
        <span role="columnheader">Cleaned</span>
      </div>
      {rows.map((row, index) => (
        <div key={index} className={`diff-row ${row.kind}`} role="row">
          <span role="cell" className={row.left === null ? 'diff-empty' : undefined}>
            {row.left ?? ''}
          </span>
          <span role="cell" className={row.right === null ? 'diff-empty' : undefined}>
            {row.right ?? ''}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * Shows the cleaned lyrics beside the original to accept or discard. The editor makes the request (from the
 * click, so it is sent once); errors, including the main process rejecting changed wording, show here.
 */
export function LyricsDiffModal({ original, result, error, onAccept, onClose }: Props) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const loading = !result && !error

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal lyrics-diff-modal" role="dialog" aria-label="Clean lyrics" onMouseDown={(e) => e.stopPropagation()}>
        <h2>
          <Sparkles size={16} aria-hidden="true" /> Clean lyrics
        </h2>

        {loading && (
          <p className="hint" role="status">
            Cleaning the lyrics… this usually takes a few seconds.
          </p>
        )}

        {error && (
          <p className="error" role="alert">
            {error.message} Your lyrics were not changed.
          </p>
        )}

        {result && (
          <>
            <p className="hint">
              Review the changes. The words themselves are checked to be the same as yours; only labels, layout and
              removed junk differ.
            </p>
            {result.order.length > 0 && (
              <div className="chips" aria-label="Play order">
                <span className="hint">Play order:</span>
                {result.order.map((label, index) => (
                  <span key={index} className="chip">
                    {label}
                  </span>
                ))}
              </div>
            )}
            <LyricsDiff original={original} cleaned={result.lyrics} />
          </>
        )}

        <footer className="modal-actions">
          <button className="button" onClick={onClose}>
            <X size={15} aria-hidden="true" /> Discard
          </button>
          <button className="button primary" disabled={!result} onClick={() => result && onAccept(result)}>
            <Check size={15} aria-hidden="true" /> Accept
          </button>
        </footer>
      </div>
    </div>
  )
}

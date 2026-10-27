import { Mic } from 'lucide-react'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { today } from '../../shared/license'
import { UNTITLED_SERMON } from '../../shared/sermons'
import type { SermonInput } from '../../shared/types'

interface Props {
  /** Creates the sermon with these details (all optional) and starts listening. */
  onStart(input: SermonInput): void
  onCancel(): void
}

/**
 * Asked as the listener starts: the sermon's title, preacher and series, all optional, dated today. The preacher is
 * free text with past names offered, starting with the last one used. Skip records an untitled sermon dated today.
 */
export function StartSermonModal({ onStart, onCancel }: Props) {
  const listId = useId()
  const [title, setTitle] = useState('')
  const [preacher, setPreacher] = useState('')
  const [series, setSeries] = useState('')
  const [date, setDate] = useState(today())
  const [preachers, setPreachers] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    window.api.sermons.preachers().then((names) => {
      if (cancelled) return
      setPreachers(names ?? [])
      // Prefilled with the last preacher, unless something was typed meanwhile.
      if (names?.[0]) setPreacher((typed) => typed || names[0])
    }, console.error)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  function submit(e: FormEvent) {
    e.preventDefault()
    onStart({ title: title.trim(), preacher: preacher.trim(), series: series.trim(), date })
  }

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form className="modal start-sermon-modal" role="dialog" aria-label="Start sermon" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Start sermon</h2>
        <p className="hint">The transcript, the scripture heard and the statements you show are saved to this sermon as you listen.</p>
        <label className="field">
          <span>
            Title <small>optional</small>
          </span>
          <input className="input" value={title} placeholder={UNTITLED_SERMON} maxLength={200} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>
            Preacher <small>optional</small>
          </span>
          <input className="input" list={listId} value={preacher} maxLength={120} onChange={(e) => setPreacher(e.target.value)} />
          <datalist id={listId}>
            {preachers.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        <div className="start-sermon-row">
          <label className="field">
            <span>
              Series <small>optional</small>
            </span>
            <input className="input" value={series} maxLength={120} onChange={(e) => setSeries(e.target.value)} />
          </label>
          <label className="field">
            <span>Date</span>
            <input className="input" type="date" value={date} required onChange={(e) => setDate(e.target.value || today())} />
          </label>
        </div>
        <footer className="modal-actions">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="button" title="Record an untitled sermon dated today" onClick={() => onStart({ date: today() })}>
            Skip
          </button>
          <button type="submit" className="button primary">
            <Mic size={15} aria-hidden="true" /> Start Listening
          </button>
        </footer>
      </form>
    </div>
  )
}

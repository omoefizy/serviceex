import { BookOpenText, Download, FileText, ListPlus, Pin, PinOff, Plus, Presentation, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { can, upgradeNote, type FeatureKey } from '../../shared/features'
import { formatReference, parseReference } from '../../shared/parseReference'
import { DEFAULT_EXPORT, longDate, rawParagraphs, sermonContentCount, sermonTitle, textParagraphs, UNTITLED_SERMON } from '../../shared/sermons'
import type { AiError, AiResult, Sermon, SermonAiOutcome, SermonAiProgress, SermonExportOptions, SermonExportResult, SermonPatch, SermonSummary } from '../../shared/types'
import { useListener } from '../lib/listener'
import { outcomeMessage, progressLabel } from '../lib/sermonAi'
import { useOperatorStore } from '../store'
import { AiButton } from './AiButton'

/** How often a sermon being recorded is read again, so its transcript grows on screen. */
const RECORDING_REFRESH_MS = 3000

const clock = (ms: number) => {
  const seconds = Math.floor(ms / 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}` : `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`
}

/** A button gated by a plan feature: disabled with the plan's note when it is not included. */
function GatedButton({ feature, children, onClick, busy, primary }: { feature: FeatureKey; children: ReactNode; onClick(): void; busy?: boolean; primary?: boolean }) {
  const allowed = can(feature)
  return (
    <span title={allowed ? undefined : upgradeNote(feature)}>
      <button type="button" className={`button${primary ? ' primary' : ''}`} disabled={!allowed || busy} onClick={onClick}>
        {children}
      </button>
    </span>
  )
}

/**
 * Saved sermons: a list by date with search across title, preacher and transcript, and the chosen sermon's details,
 * transcript, scripture and statements, with exports. Everything stays on this computer.
 */
export function SermonsPanel() {
  const openSermons = useOperatorStore((s) => s.openSermons)
  const recordingId = useListener((s) => s.sermon?.id ?? null)
  const [query, setQuery] = useState('')
  const [list, setList] = useState<SermonSummary[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadList = useCallback(async () => {
    const q = query.trim()
    const found = q ? await window.api.sermons.search(q) : await window.api.sermons.list()
    setList(Array.isArray(found) ? found : [])
  }, [query])

  // Searches as the operator types, after a short pause.
  useEffect(() => {
    const timer = setTimeout(() => loadList().catch((err) => setError(String(err))), 200)
    return () => clearTimeout(timer)
  }, [loadList])

  // A new recording shows in the list (and is chosen when nothing else is).
  useEffect(() => {
    if (recordingId === null) return
    loadList().catch(console.error)
    setSelectedId((id) => id ?? recordingId)
  }, [recordingId, loadList])

  return (
    <section className="panel sermons-panel" aria-label="Sermons">
      <header className="panel-header">
        <h2>Sermons</h2>
        <button className="icon-button" aria-label="Close sermons" title="Close" onClick={() => openSermons(false)}>
          <X size={18} />
        </button>
      </header>
      {error && <p className="error">{error}</p>}
      <div className="sermons-body">
        <div className="sermons-list-column">
          <label className="sermons-search">
            <Search size={14} aria-hidden="true" />
            <input className="input" type="search" placeholder="Search title, preacher or words said" aria-label="Search sermons" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {list.length === 0 ? (
            <p className="hint">
              {query.trim() ? 'No sermon matches.' : 'No sermons yet. Start the listener and the sermon is saved here as it is preached.'}
            </p>
          ) : (
            <ul className="sermons-list" role="listbox" aria-label="Sermons">
              {list.map((s) => (
                <li key={s.id}>
                  <button type="button" role="option" aria-selected={s.id === selectedId} className={`sermons-list-item${s.id === selectedId ? ' active' : ''}`} onClick={() => setSelectedId(s.id)}>
                    <span className="sermons-list-title">
                      {sermonTitle(s)}
                      {s.status === 'recording' && <span className="sermons-recording">Recording</span>}
                    </span>
                    <span className="sermons-list-meta">
                      {s.date}
                      {s.preacher && ` · ${s.preacher}`}
                      {s.series && ` · ${s.series}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="sermons-detail-column">
          {selectedId === null ? (
            <p className="hint sermons-empty">
              <BookOpenText size={16} aria-hidden="true" /> Choose a sermon to see its transcript, scripture and statements.
            </p>
          ) : (
            <SermonDetail
              key={selectedId}
              id={selectedId}
              onChanged={() => loadList().catch(console.error)}
              onDeleted={() => {
                setSelectedId(null)
                loadList().catch(console.error)
              }}
            />
          )}
        </div>
      </div>
    </section>
  )
}

function SermonDetail({ id, onChanged, onDeleted }: { id: number; onChanged(): void; onDeleted(): void }) {
  const service = useOperatorStore((s) => s.service)
  const addToSchedule = useOperatorStore((s) => s.addToSchedule)
  const [sermon, setSermon] = useState<Sermon | null>(null)
  const [missing, setMissing] = useState(false)
  const [draft, setDraft] = useState<Required<Pick<SermonPatch, 'title' | 'preacher' | 'date' | 'series' | 'notes' | 'summary'>> & { points: string }>({
    title: '',
    preacher: '',
    date: '',
    series: '',
    notes: '',
    summary: '',
    points: '',
  })
  const [showCleaned, setShowCleaned] = useState(true)
  const [options, setOptions] = useState<SermonExportOptions>(DEFAULT_EXPORT)
  const [aiAvailable, setAiAvailable] = useState(false)
  const [developerMode, setDeveloperMode] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aiError, setAiError] = useState<AiError | null>(null)
  const [progress, setProgress] = useState<SermonAiProgress | null>(null)
  const [newReference, setNewReference] = useState('')
  /** Whether a field is being typed in, so a refresh while recording does not overwrite it. */
  const editing = useRef(false)

  const apply = useCallback((next: Sermon | null) => {
    if (!next) return setMissing(true)
    setSermon(next)
    if (!editing.current) {
      setDraft({
        title: next.title,
        preacher: next.preacher,
        date: next.date,
        series: next.series,
        notes: next.notes,
        summary: next.summary,
        points: next.keyPoints.join('\n'),
      })
    }
  }, [])

  const reload = useCallback(() => window.api.sermons.get(id).then(apply), [id, apply])

  useEffect(() => {
    reload().catch((err) => setError(String(err)))
    window.api.sermons.aiAvailable().then((ok) => setAiAvailable(ok === true), console.error)
    window.api.ai.status().then((s) => setDeveloperMode(s.developerMode), console.error)
  }, [reload])

  // Progress of this sermon's clean or notes job, sent by the main process.
  useEffect(() => {
    const off = window.api.sermons.onAiProgress?.((next) => {
      if (next.sermonId === id) setProgress(next)
    })
    return () => {
      if (typeof off === 'function') off()
    }
  }, [id])

  // A sermon being recorded is read again every few seconds.
  const recording = sermon?.status === 'recording'
  useEffect(() => {
    if (!recording) return
    const timer = setInterval(() => reload().catch(console.error), RECORDING_REFRESH_MS)
    return () => clearInterval(timer)
  }, [recording, reload])

  if (missing) return <p className="hint">This sermon no longer exists.</p>
  if (!sermon) return <p className="hint">Loading…</p>

  async function save(patch: SermonPatch) {
    editing.current = false
    setError(null)
    try {
      apply(await window.api.sermons.update(id, patch))
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /** Runs an action with a busy label; a message for the operator on success. */
  async function run(label: string, action: () => Promise<string | null | void>) {
    setBusy(label)
    setError(null)
    setMessage(null)
    try {
      const done = await action()
      if (done) setMessage(done)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const saved = (result: SermonExportResult, what: string) => {
    if (!result.ok) throw new Error(result.error)
    return result.path ? `${what} saved to ${result.path}` : null
  }

  /** Runs a clean or notes job, showing its progress; the updated sermon on success, null when it failed. */
  async function aiJob(task: 'clean' | 'notes'): Promise<Sermon | null> {
    setAiError(null)
    let answer: AiResult<SermonAiOutcome>
    try {
      answer = await (task === 'clean' ? window.api.sermons.cleanTranscript(id) : window.api.sermons.generateNotes(id))
    } finally {
      setProgress(null)
    }
    if (!answer.ok) {
      setAiError(answer.error)
      return null
    }
    editing.current = false
    apply(answer.value.sermon)
    const note = outcomeMessage(task, answer.value, developerMode)
    if (note) setMessage(note)
    return answer.value.sermon
  }

  async function runAi(task: 'clean' | 'notes') {
    await run(task, async () => {
      await aiJob(task)
    })
  }

  /**
   * Before a slide export: offers to make key points first when there are none and AI can, then asks before
   * exporting a deck with nothing but its title and closing slides. False when the operator cancels.
   */
  async function readyForSlides(): Promise<boolean> {
    let current = sermon!
    const canGenerate = aiAvailable && can('sermon.ai.cleanup') && current.segments.length > 0
    if (current.keyPoints.length === 0 && canGenerate) {
      if (window.confirm('This sermon has no key points yet. Generate them from the transcript with AI before exporting?\n\nOK generates them first. Cancel exports without them.')) {
        current = (await aiJob('notes')) ?? current
      }
    }
    if (sermonContentCount(current) > 0) return true
    return window.confirm('This sermon has no key points, scriptures or statements yet. Generate notes first.\n\nOK exports only the title and closing slides. Cancel goes back.')
  }

  async function exportPptx() {
    if (!(await readyForSlides())) return null
    return saved(await window.api.sermons.exportPptx(id), 'PowerPoint')
  }

  async function addSlides() {
    if (!(await readyForSlides())) return null
    const payload = await window.api.sermons.exportSlides(id)
    await addToSchedule('announcement', null, payload)
    const count = payload.body.split(/\n\s*\n/).length
    return `Added “${payload.title}” to ${service?.name ?? 'the schedule'}: a title slide and ${count} slide${count === 1 ? '' : 's'}.`
  }

  async function addReference() {
    const ref = parseReference(newReference)
    if (!ref) {
      setError('That is not a Bible reference, such as John 3:16.')
      return
    }
    await window.api.sermons.addScripture(id, formatReference(ref), 'manual')
    setNewReference('')
    await reload()
  }

  async function remove() {
    if (!window.confirm(`Delete “${sermonTitle(sermon!)}” with its transcript? This cannot be undone.`)) return
    await window.api.sermons.delete(id)
    onDeleted()
  }

  const hasCleaned = sermon.cleanedTranscript.trim() !== ''
  const paragraphs = hasCleaned && showCleaned ? textParagraphs(sermon.cleanedTranscript) : rawParagraphs(sermon.segments)
  const field = (key: keyof typeof draft) => ({
    value: draft[key],
    onFocus: () => (editing.current = true),
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft((d) => ({ ...d, [key]: e.target.value })),
  })
  const check = (key: keyof SermonExportOptions, label: string, disabled = false) => (
    <label className="inline-check">
      <input type="checkbox" checked={options[key]} disabled={disabled} onChange={(e) => setOptions((o) => ({ ...o, [key]: e.target.checked }))} />
      {label}
    </label>
  )

  return (
    <div className="sermon-detail">
      {recording && (
        <p className="sermons-recording-note" role="status">
          <span className="sermons-recording">Recording</span> The transcript grows here as the listener hears it.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {message && <p className="hint">{message}</p>}

      <div className="sermon-fields">
        <label className="field sermon-field-wide">
          <span>Title</span>
          <input className="input" placeholder={UNTITLED_SERMON} maxLength={200} {...field('title')} onBlur={() => void save({ title: draft.title })} />
        </label>
        <label className="field">
          <span>Preacher</span>
          <input className="input" maxLength={120} {...field('preacher')} onBlur={() => void save({ preacher: draft.preacher })} />
        </label>
        <label className="field">
          <span>Date</span>
          <input className="input" type="date" {...field('date')} onBlur={() => void save({ date: draft.date })} />
        </label>
        <label className="field">
          <span>Series</span>
          <input className="input" maxLength={120} {...field('series')} onBlur={() => void save({ series: draft.series })} />
        </label>
        <label className="field sermon-field-wide">
          <span>Notes</span>
          <textarea className="input" rows={3} {...field('notes')} onBlur={() => void save({ notes: draft.notes })} />
        </label>
      </div>
      {sermon.churchName && <p className="hint">Recorded for {sermon.churchName} · {longDate(sermon.date)}</p>}

      <section className="sermon-section">
        <h3>Summary and key points</h3>
        {aiAvailable && can('sermon.ai.cleanup') && (
          <div className="settings-row">
            <AiButton
              feature="sermon.ai.cleanup"
              label={sermon.summary ? 'Generate Notes Again' : 'Generate Notes'}
              busyLabel="Reading the sermon…"
              busy={busy === 'notes'}
              disabledReason={sermon.segments.length === 0 ? 'There is no transcript yet' : busy ? 'Wait for the current task' : null}
              tooltip="A short summary and 5 to 8 key points, from what was said only"
              onClick={() => void runAi('notes')}
            />
            <AiButton
              feature="sermon.ai.cleanup"
              label={hasCleaned ? 'Clean Transcript Again' : 'Clean Transcript'}
              busyLabel="Cleaning the transcript…"
              busy={busy === 'clean'}
              disabledReason={sermon.segments.length === 0 ? 'There is no transcript yet' : busy ? 'Wait for the current task' : null}
              tooltip="Punctuation and paragraphs, filler sounds removed; every word kept. The raw transcript is kept too."
              onClick={() => void runAi('clean')}
            />
          </div>
        )}
        {progress && (
          <div className="settings-row sermon-ai-progress" role="status" aria-live="polite">
            <progress max={progress.total} value={progress.step === 'notes' ? progress.total : progress.done - 1} />
            <span>{progressLabel(progress)}…</span>
            <button type="button" className="button" onClick={() => void window.api.sermons.cancelAi(id)} title="Stop after the part being worked on; what is done is kept">
              <X size={14} aria-hidden="true" /> Cancel
            </button>
          </div>
        )}
        {aiError && (
          <p className="error" role="alert">
            {aiError.message}
          </p>
        )}
        <label className="field">
          <span>Summary</span>
          <textarea className="input" rows={3} {...field('summary')} onBlur={() => void save({ summary: draft.summary })} />
        </label>
        <label className="field">
          <span>
            Key points <small>one per line; each becomes a slide</small>
          </span>
          <textarea className="input" rows={5} {...field('points')} onBlur={() => void save({ keyPoints: draft.points.split('\n').map((p) => p.trim()).filter(Boolean) })} />
        </label>
      </section>

      <section className="sermon-section">
        <h3>Scripture ({sermon.scriptures.length})</h3>
        {sermon.scriptures.length === 0 ? (
          <p className="hint">Scripture the listener hears is listed here. You can add references too.</p>
        ) : (
          <ul className="sermon-items">
            {sermon.scriptures.map((s) => (
              <li key={s.id}>
                <strong>{s.reference}</strong>
                <span className="hint">{s.source === 'manual' ? 'added' : `heard at ${clock(s.atMs)}`}</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${s.reference}`}
                  title="Remove"
                  onClick={() => void run('scripture', async () => {
                    await window.api.sermons.removeScripture(id, s.id)
                    await reload()
                  })}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="settings-row"
          onSubmit={(e) => {
            e.preventDefault()
            void run('scripture', addReference)
          }}
        >
          <input className="input" placeholder="Add a reference, such as Romans 8:28" aria-label="Add a reference" value={newReference} onChange={(e) => setNewReference(e.target.value)} />
          <button type="submit" className="button" disabled={!newReference.trim()}>
            <Plus size={14} aria-hidden="true" /> Add
          </button>
        </form>
      </section>

      <section className="sermon-section">
        <h3>Statements ({sermon.statements.length})</h3>
        {sermon.statements.length === 0 ? (
          <p className="hint">Statements you show or pin while listening are listed here. Pinned ones become slides.</p>
        ) : (
          <ul className="sermon-items">
            {sermon.statements.map((s) => (
              <li key={s.id}>
                <span className="sermon-statement">“{s.text}”</span>
                <span className="hint">{clock(s.atMs)}</span>
                <button
                  type="button"
                  className={`icon-button${s.pinned ? ' active' : ''}`}
                  aria-pressed={s.pinned}
                  aria-label={s.pinned ? 'Unpin' : 'Pin'}
                  title={s.pinned ? 'Pinned: it becomes a slide. Click to unpin.' : 'Pin it, so it becomes a slide'}
                  onClick={() => void run('statement', async () => {
                    await window.api.sermons.setStatementPinned(id, s.id, !s.pinned)
                    await reload()
                  })}
                >
                  {s.pinned ? <Pin size={14} /> : <PinOff size={14} />}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Remove statement"
                  title="Remove"
                  onClick={() => void run('statement', async () => {
                    await window.api.sermons.removeStatement(id, s.id)
                    await reload()
                  })}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sermon-section">
        <div className="sermon-section-head">
          <h3>Transcript</h3>
          {hasCleaned && (
            <div className="segmented" role="radiogroup" aria-label="Transcript version">
              <button role="radio" aria-checked={showCleaned} className={showCleaned ? 'active' : ''} onClick={() => setShowCleaned(true)}>
                Cleaned
              </button>
              <button role="radio" aria-checked={!showCleaned} className={!showCleaned ? 'active' : ''} onClick={() => setShowCleaned(false)}>
                Raw
              </button>
            </div>
          )}
        </div>
        {paragraphs.length === 0 ? (
          <p className="hint">No transcript was saved for this sermon.</p>
        ) : (
          <div className="sermon-transcript">
            {paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        )}
      </section>

      <section className="sermon-section">
        <h3>Export</h3>
        <div className="sermon-export-options">
          {check('summary', 'Summary and key points')}
          {check('scriptures', 'Scripture list')}
          {check('transcript', 'Full transcript')}
          {hasCleaned && check('cleaned', 'Use the cleaned transcript', !options.transcript)}
        </div>
        <div className="settings-row sermon-export-buttons">
          <GatedButton feature="sermon.export.pdf" primary busy={busy !== null} onClick={() => void run('pdf', async () => saved(await window.api.sermons.exportPdf(id, options), 'PDF'))}>
            <Download size={14} aria-hidden="true" /> {busy === 'pdf' ? 'Making the PDF…' : 'PDF'}
          </GatedButton>
          <GatedButton feature="sermon.export.text" busy={busy !== null} onClick={() => void run('txt', async () => saved(await window.api.sermons.exportText(id, 'txt', options), 'Text'))}>
            <FileText size={14} aria-hidden="true" /> Text (.txt)
          </GatedButton>
          <GatedButton feature="sermon.export.text" busy={busy !== null} onClick={() => void run('md', async () => saved(await window.api.sermons.exportText(id, 'md', options), 'Markdown'))}>
            <FileText size={14} aria-hidden="true" /> Markdown (.md)
          </GatedButton>
        </div>
        <p className="hint">Slides: a title slide, then scripture, pinned statements and key points, one idea each, and a closing slide. In the schedule they use the default announcement theme.</p>
        <div className="settings-row sermon-export-buttons">
          <span title={service ? undefined : 'Create or open a service first'}>
            <GatedButton feature="sermon.export.slides" busy={busy !== null || !service} onClick={() => void run('slides', addSlides)}>
              <ListPlus size={14} aria-hidden="true" /> Add Slides to {service?.name ?? 'the Schedule'}
            </GatedButton>
          </span>
          <GatedButton feature="sermon.export.slides" busy={busy !== null} onClick={() => void run('pptx', exportPptx)}>
            <Presentation size={14} aria-hidden="true" /> {busy === 'pptx' && progress ? 'Making key points…' : 'Export as PowerPoint (.pptx)'}
          </GatedButton>
        </div>
      </section>

      <footer className="sermon-danger">
        <button type="button" className="button danger" disabled={recording} title={recording ? 'Stop the listener first' : undefined} onClick={() => void run('delete', remove)}>
          <Trash2 size={14} aria-hidden="true" /> Delete Sermon
        </button>
      </footer>
    </div>
  )
}

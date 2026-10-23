import { AlertTriangle, FilePen, FolderOpen, Loader2, Plus, Trash2, Upload, X } from 'lucide-react'
import { useState } from 'react'
import type { Presentation } from '../../shared/types'
import { droppedPaths, isFileDrag } from '../lib/presentations'
import { useOperatorStore } from '../store'

/** The progress chips of running conversions, and the error of a failed one until dismissed. */
export function PresentationJobs() {
  const jobs = useOperatorStore((s) => s.presentationJobs)
  const dismiss = useOperatorStore((s) => s.dismissPresentationJob)
  if (jobs.length === 0) return null
  return (
    <div className="chips presentation-jobs" aria-live="polite">
      {jobs.map((job) => (
        <span key={job.key} className={`chip progress-chip${job.error ? ' failed' : ''}`} title={job.error ?? job.key}>
          {job.error ? <AlertTriangle size={13} aria-hidden="true" /> : !job.finished && <Loader2 size={13} className="spin" aria-hidden="true" />}
          <span className="progress-chip-text">
            {job.title}: {job.error ?? job.message}
          </span>
          {job.error && (
            <button type="button" aria-label={`Dismiss ${job.title}`} onClick={() => dismiss(job.key)}>
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </span>
      ))}
    </div>
  )
}

const EDITABLE: Presentation['kind'][] = ['pptx', 'ppt']

function PresentationCard({ presentation, onError }: { presentation: Presentation; onError(message: string | null): void }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const selectPresentation = useOperatorStore((s) => s.selectPresentation)
  const addPresentationToSchedule = useOperatorStore((s) => s.addPresentationToSchedule)
  const loadPresentations = useOperatorStore((s) => s.loadPresentations)
  const active = useOperatorStore((s) => s.deckKey === `presentation:${presentation.id}`)
  const hasService = useOperatorStore((s) => s.service !== null)
  const first = presentation.slides[0]

  async function run(action: () => Promise<unknown>) {
    try {
      await action()
      onError(null)
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <li className={`presentation-card${active ? ' active' : ''}`}>
      <button className="presentation-main" title={presentation.sourcePath} onClick={() => selectPresentation(presentation)}>
        {/* The picture's URL changes with each render, so a saved original shows its new first slide. */}
        <span className="presentation-thumb">{first && <img src={first.image} alt="" loading="lazy" />}</span>
        <span className="presentation-info">
          <span className="presentation-title">{presentation.title}</span>
          <span className="hint">
            {presentation.slides.length} slide{presentation.slides.length === 1 ? '' : 's'} · {presentation.kind.toUpperCase()}
          </span>
        </span>
      </button>
      <div className="presentation-actions">
        {EDITABLE.includes(presentation.kind) && (
          <button
            className="icon-button"
            aria-label={`Edit ${presentation.title} in PowerPoint`}
            title="Edit in PowerPoint; saving there updates the slides here"
            onClick={() => run(() => window.api.presentations.openOriginal(presentation.id))}
          >
            <FilePen size={15} />
          </button>
        )}
        <button
          className="icon-button"
          aria-label={`Add ${presentation.title} to the schedule`}
          title="Add to schedule"
          disabled={!hasService}
          onClick={() => run(() => addPresentationToSchedule(presentation))}
        >
          <Plus size={15} />
        </button>
        {confirmingDelete ? (
          <>
            <button className="button danger" onClick={() => run(async () => {
              await window.api.presentations.delete(presentation.id)
              await loadPresentations()
            })}>
              Delete
            </button>
            <button className="button" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button
            className="icon-button"
            aria-label={`Remove ${presentation.title} from the library`}
            title="Remove from the library (the original file stays)"
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </li>
  )
}

/** The Presentations library: PowerPoint files, PDFs and image folders, rendered into slide pictures. */
export function PresentationsPanel() {
  const presentations = useOperatorStore((s) => s.presentations)
  const importPresentations = useOperatorStore((s) => s.importPresentations)
  const [search, setSearch] = useState('')
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function importPaths(paths: string[]) {
    if (paths.length === 0) return
    try {
      setError(null)
      await importPresentations(paths)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const q = search.trim().toLowerCase()
  const shown = presentations.filter((p) => !q || p.title.toLowerCase().includes(q) || p.slides.some((slide) => slide.text.toLowerCase().includes(q)))

  return (
    <section
      className={`panel presentations-panel${dragging ? ' drag-over' : ''}`}
      onDragOver={(e) => {
        if (!isFileDrag(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(e) => {
        if (!isFileDrag(e)) return
        e.preventDefault()
        setDragging(false)
        importPaths(droppedPaths(e))
      }}
    >
      <header className="panel-header">
        <h2>Presentations</h2>
        <div className="panel-header-actions">
          <button className="icon-button" aria-label="Import a folder of images" title="Import a folder of images" onClick={() => window.api.presentations.pick('folder').then(importPaths)}>
            <FolderOpen size={16} />
          </button>
          <button className="button primary" onClick={() => window.api.presentations.pick('files').then(importPaths)}>
            <Upload size={15} aria-hidden="true" /> Import…
          </button>
        </div>
      </header>

      <input className="input" type="search" placeholder="Search title or slide text" value={search} onChange={(e) => setSearch(e.target.value)} />
      <PresentationJobs />
      {error && <p className="error">{error}</p>}

      <ul className="presentation-list">
        {shown.map((presentation) => (
          <PresentationCard key={presentation.id} presentation={presentation} onError={setError} />
        ))}
      </ul>
      {shown.length === 0 && (
        <p className="empty">
          {presentations.length === 0 ? 'Drop PowerPoint files (.pptx, .ppt), PDFs or a folder of images here, or use Import.' : 'Nothing matches.'}
        </p>
      )}
    </section>
  )
}

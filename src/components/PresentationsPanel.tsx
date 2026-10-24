import { AlertTriangle, Columns2, FilePen, FolderOpen, Loader2, Plus, Trash2, Upload, X } from 'lucide-react'
import { useState } from 'react'
import type { Presentation, PresentationMode } from '../../shared/types'
import { droppedPaths, isFileDrag } from '../lib/presentations'
import { usePersistentState } from '../lib/usePersistentState'
import { useOperatorStore } from '../store'
import { NativeSlideEditor } from './NativeSlideEditor'

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
  const livePowerPointOn = useOperatorStore((s) => s.settings.presentationLivePowerPoint)
  const setLiveOptions = useOperatorStore((s) => s.setPresentationLiveOptions)
  const setMode = useOperatorStore((s) => s.setPresentationMode)
  const [switching, setSwitching] = useState(false)
  const [comparing, setComparing] = useState(false)
  const animated = presentation.slides.filter((slide) => slide.animated).length
  const first = presentation.slides[0]
  const native = presentation.mode === 'native'
  const fallbacks = native ? presentation.slides.filter((slide) => !slide.native?.style).length : 0

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
            {native && ' · Native'}
            {!presentation.linked && ' · Detached'}
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
      {presentation.kind === 'pptx' && (
        <div className="presentation-mode">
          <span
            className="segmented"
            role="radiogroup"
            aria-label={`How ${presentation.title} shows`}
          >
            {(['image', 'native'] as PresentationMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={presentation.mode === mode}
                className={presentation.mode === mode ? 'active' : ''}
                disabled={switching}
                title={mode === 'image' ? 'Each slide as the picture PowerPoint draws: the exact look' : 'Slides rebuilt from the file, with motion backgrounds that keep playing between slides'}
                onClick={() => {
                  if (presentation.mode === mode) return
                  setSwitching(true)
                  run(() => setMode(presentation.id, mode)).finally(() => setSwitching(false))
                }}
              >
                {mode === 'image' ? 'Image' : 'Native'}
              </button>
            ))}
          </span>
          {switching && <Loader2 size={13} className="spin" aria-label="Building native slides" />}
          {native && fallbacks > 0 && (
            <span className="hint" title="These slides hold something Native mode cannot draw, so they show their PowerPoint picture">
              <AlertTriangle size={12} aria-hidden="true" /> {fallbacks} as picture
            </span>
          )}
          {native && (
            <button className="icon-button" aria-label={`Compare ${presentation.title} with PowerPoint`} title="Compare with PowerPoint and edit" onClick={() => setComparing(true)}>
              <Columns2 size={15} />
            </button>
          )}
        </div>
      )}
      {comparing && <NativeSlideEditor presentationId={presentation.id} index={0} onClose={() => setComparing(false)} />}
      {livePowerPointOn && EDITABLE.includes(presentation.kind) && animated > 0 && !native && (
        // Live PowerPoint for this presentation; the setting itself is in Settings, Presentations.
        <div className="presentation-live-options">
          <label className="inline-check" title={`${animated} of ${presentation.slides.length} slides have animations or transitions`}>
            <input
              type="checkbox"
              checked={presentation.livePowerPoint}
              onChange={(e) => run(() => setLiveOptions(presentation.id, { livePowerPoint: e.target.checked }))}
            />
            Play animations with PowerPoint
          </label>
          {presentation.livePowerPoint && (
            <label className="inline-check" title="Off: PowerPoint moves on only with the arrow keys or Next">
              <input
                type="checkbox"
                checked={presentation.useTimings}
                onChange={(e) => run(() => setLiveOptions(presentation.id, { useTimings: e.target.checked }))}
              />
              Use slide timings
            </label>
          )}
        </div>
      )}
    </li>
  )
}

/** The Presentations library: PowerPoint files, PDFs and image folders, rendered into slide pictures. */
export function PresentationsPanel() {
  const presentations = useOperatorStore((s) => s.presentations)
  const importPresentations = useOperatorStore((s) => s.importPresentations)
  /** How .pptx files import: Image mode unless Native mode was chosen. */
  const [importMode, setImportMode] = usePersistentState<PresentationMode>(
    'worshipdeck.pptxImportMode',
    'image',
    (v): v is PresentationMode => v === 'image' || v === 'native',
  )
  const [search, setSearch] = useState('')
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function importPaths(paths: string[]) {
    if (paths.length === 0) return
    try {
      setError(null)
      await importPresentations(paths, importMode)
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
          <select
            className="input import-mode"
            aria-label="Import PowerPoint files in"
            title="How PowerPoint .pptx files import; each presentation can be switched later"
            value={importMode}
            onChange={(e) => setImportMode(e.target.value as PresentationMode)}
          >
            <option value="image">Image mode</option>
            <option value="native">Native mode</option>
          </select>
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

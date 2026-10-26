import { useEffect, useState, type DragEvent } from 'react'
import { buildSongSlides } from '../../shared/lyrics'
import { can } from '../../shared/features'
import type { ExportFormat, ImportScan } from '../../shared/types'
import { useOperatorStore } from '../store'
import { UpgradeNote } from './UpgradeNote'

const FORMAT_NAMES = { text: 'Text', openlyrics: 'OpenLyrics', opensong: 'OpenSong' }

interface Props {
  onClose(): void
}

type Stage =
  | { name: 'choose' }
  | { name: 'reading' }
  | { name: 'preview'; scan: ImportScan; selected: boolean[] }
  | { name: 'importing' }
  | { name: 'done'; added: number; skipped: number; unreadable: number }

export function ImportModal({ onClose }: Props) {
  const [stage, setStage] = useState<Stage>({ name: 'choose' })
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const songsChanged = useOperatorStore((s) => s.songsChanged)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function read(scanning: () => Promise<ImportScan | null>) {
    setError(null)
    setStage({ name: 'reading' })
    try {
      const scan = await scanning()
      if (!scan) {
        setStage({ name: 'choose' })
        return
      }
      // Duplicates start unticked, so importing never doubles a song unless asked to.
      setStage({ name: 'preview', scan, selected: scan.songs.map((s) => s.duplicateOf === null) })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStage({ name: 'choose' })
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const paths = [...e.dataTransfer.files].map((file) => window.api.songFiles.pathForFile(file)).filter(Boolean)
    if (paths.length > 0) read(() => window.api.songFiles.scan(paths))
  }

  async function handleImport() {
    if (stage.name !== 'preview') return
    const chosen = stage.scan.songs.filter((_, i) => stage.selected[i]).map((s) => s.song)
    const skipped = stage.scan.songs.length - chosen.length
    const unreadable = stage.scan.problems.length
    setError(null)
    setStage({ name: 'importing' })
    try {
      const added = chosen.length > 0 ? await window.api.songFiles.import(chosen) : 0
      songsChanged()
      setStage({ name: 'done', added, skipped, unreadable })
    } catch (err) {
      // The import is one transaction, so a failure adds nothing; go back to the preview to try again.
      setError(`Nothing was imported: ${err instanceof Error ? err.message : String(err)}`)
      setStage({ ...stage })
    }
  }

  async function handleExportAll(format: ExportFormat) {
    setExportMessage(null)
    setError(null)
    try {
      const result = await window.api.songFiles.export(null, format)
      if (result) setExportMessage(`Exported ${result.written} song${result.written === 1 ? '' : 's'} to ${result.location}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function setSelected(update: (selected: boolean[]) => boolean[]) {
    setStage((current) => (current.name === 'preview' ? { ...current, selected: update(current.selected) } : current))
  }

  const preview = stage.name === 'preview' ? stage : null
  const selectedCount = preview ? preview.selected.filter(Boolean).length : 0

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal import-modal" role="dialog" aria-label="Import songs" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Import songs</h2>

        {(stage.name === 'choose' || stage.name === 'reading') && (
          <>
            {can('import.songs') ? (
              <div
                className={`drop-zone${dragging ? ' over' : ''}`}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes('Files')) return
                  e.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
              >
                {stage.name === 'reading' ? (
                  <p>Reading files…</p>
                ) : (
                  <>
                    <p>Drop song files or a folder here</p>
                    <p className="hint">
                      Text (.txt, first line is the title), OpenLyrics (.xml, as OpenLP exports) or OpenSong
                    </p>
                    <div className="drop-zone-buttons">
                      <button className="button" onClick={() => read(window.api.songFiles.pickFiles)}>
                        Choose files…
                      </button>
                      <button className="button" onClick={() => read(window.api.songFiles.pickFolder)}>
                        Choose folder…
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <UpgradeNote feature="import.songs" />
            )}

            <div className="export-all">
              <span>Export all songs</span>
              <button className="button" onClick={() => handleExportAll('openlyrics')}>
                OpenLyrics XML…
              </button>
              <button className="button" onClick={() => handleExportAll('text')}>
                Text backup…
              </button>
            </div>
            {exportMessage && <p className="hint">{exportMessage}</p>}
          </>
        )}

        {preview && (
          <>
            <p className="hint">
              {preview.scan.songs.length} song{preview.scan.songs.length === 1 ? '' : 's'} found · {selectedCount}{' '}
              selected
              {preview.scan.songs.some((s) => s.duplicateOf) && ' · duplicates are unticked'}
            </p>
            {preview.scan.songs.length > 0 && (
              <div className="import-table-wrap">
                <table className="import-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Select all"
                          checked={selectedCount === preview.selected.length}
                          ref={(el) => {
                            if (el) el.indeterminate = selectedCount > 0 && selectedCount < preview.selected.length
                          }}
                          onChange={(e) => setSelected((s) => s.map(() => e.target.checked))}
                        />
                      </th>
                      <th>Title</th>
                      <th>Author</th>
                      <th>Slides</th>
                      <th>Format</th>
                      <th>File</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.scan.songs.map(({ song, source, format, duplicateOf }, i) => (
                      <tr key={i} className={preview.selected[i] ? '' : 'skipped'}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Import ${song.title}`}
                            checked={preview.selected[i]}
                            onChange={(e) => setSelected((s) => s.map((v, j) => (j === i ? e.target.checked : v)))}
                          />
                        </td>
                        <td>
                          {song.title}
                          {duplicateOf && (
                            <span className="duplicate-flag">
                              {duplicateOf === 'library' ? 'Already in library' : 'Duplicate in this import'}
                            </span>
                          )}
                        </td>
                        <td>{song.author ?? ''}</td>
                        <td>{buildSongSlides(song.lyrics, song.arrangement).length}</td>
                        <td>{FORMAT_NAMES[format]}</td>
                        <td className="import-source" title={source}>
                          {source}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {preview.scan.problems.length > 0 && (
              <details className="import-problems">
                <summary>
                  {preview.scan.problems.length} file{preview.scan.problems.length === 1 ? '' : 's'} could not be
                  read
                </summary>
                <ul>
                  {preview.scan.problems.map((p, i) => (
                    <li key={i}>
                      <strong>{p.source}</strong>: {p.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}

        {stage.name === 'importing' && <p>Importing…</p>}

        {stage.name === 'done' && (
          <p>
            Added {stage.added} song{stage.added === 1 ? '' : 's'}, skipped {stage.skipped}.
            {stage.unreadable > 0 && ` ${stage.unreadable} file${stage.unreadable === 1 ? '' : 's'} could not be read.`}
          </p>
        )}

        {error && <p className="error">{error}</p>}

        <footer className="modal-actions">
          {preview && (
            <button className="button" onClick={() => setStage({ name: 'choose' })}>
              Back
            </button>
          )}
          <button className="button" onClick={onClose}>
            {stage.name === 'done' ? 'Done' : 'Cancel'}
          </button>
          {preview && (
            <button className="button primary" disabled={selectedCount === 0} onClick={handleImport}>
              Import {selectedCount} song{selectedCount === 1 ? '' : 's'}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

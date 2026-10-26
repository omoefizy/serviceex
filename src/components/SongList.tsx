import { ListPlus, Pencil, Plus, Upload } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { SongInput, SongSummary } from '../../shared/types'
import { openSongMenu, setShareDrag } from '../lib/sharing'
import { useOperatorStore } from '../store'
import { AddSongModal } from './AddSongModal'
import { ImportModal } from './ImportModal'

export function SongList() {
  const [search, setSearch] = useState('')
  const [songs, setSongs] = useState<SongSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const selectedId = useOperatorStore((s) => s.selectedSong?.id ?? null)
  const selectSong = useOperatorStore((s) => s.selectSong)
  const service = useOperatorStore((s) => s.service)
  const addToSchedule = useOperatorStore((s) => s.addToSchedule)
  const editSong = useOperatorStore((s) => s.editSong)
  const songsVersion = useOperatorStore((s) => s.songsVersion)

  const refresh = useCallback(async (query: string) => {
    try {
      setSongs(await window.api.songs.list(query))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  // Wait for a short pause in typing before querying the database. Also reloads after the editor saves or deletes.
  useEffect(() => {
    const timer = setTimeout(() => refresh(search), 150)
    return () => clearTimeout(timer)
  }, [search, refresh, songsVersion])

  /** A click shows the song in the grid and preview; a double click also sends its first slide live. */
  async function handleSelect(id: number, goLive = false) {
    const song = await window.api.songs.get(id)
    selectSong(song ?? null)
    if (goLive && song) useOperatorStore.getState().goLive(0)
  }

  async function handleAddToSchedule(id: number) {
    try {
      await addToSchedule('song', id, null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleCreate(input: SongInput) {
    const song = await window.api.songs.create(input)
    setAdding(false)
    await refresh(search)
    selectSong(song)
  }

  return (
    <section className="panel song-list">
      <header className="panel-header">
        <h2>Songs</h2>
        <div className="panel-header-actions">
          <button className="button" onClick={() => setImporting(true)} title="Import or export songs">
            <Upload size={15} aria-hidden="true" /> Import
          </button>
          <button className="button primary" onClick={() => setAdding(true)}>
            <Plus size={15} aria-hidden="true" /> Add song
          </button>
        </div>
      </header>

      <input
        className="input"
        type="search"
        placeholder="Search title, author, tags or lyrics"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {error && <p className="error">{error}</p>}

      <ul className="songs">
        {songs.map((song) => (
          <li key={song.id} className="song-row">
            <button
              className={`song${song.id === selectedId ? ' selected' : ''}`}
              onClick={() => handleSelect(song.id)}
              onDoubleClick={() => handleSelect(song.id, true)}
              title="Click to preview, double-click to go live, right-click to send to another computer"
              draggable
              onDragStart={(e) => setShareDrag(e, { type: 'song', id: song.id })}
              onContextMenu={(e) => openSongMenu(e, song.id)}
            >
              <span className="song-title">{song.title}</span>
              {song.author && <span className="song-author">{song.author}</span>}
            </button>
            <button
              className="icon-button song-action"
              aria-label={`Edit ${song.title}`}
              title="Edit song"
              onClick={() => editSong(song.id)}
            >
              <Pencil size={14} />
            </button>
            <button
              className="icon-button song-action add-to-schedule"
              aria-label={`Add ${song.title} to schedule`}
              title={service ? `Add to ${service.name}` : 'Create a service first'}
              disabled={!service}
              onClick={() => handleAddToSchedule(song.id)}
            >
              <ListPlus size={15} />
            </button>
          </li>
        ))}
        {songs.length === 0 && !error && (
          <li className="empty">{search ? 'No songs match.' : 'No songs yet.'}</li>
        )}
      </ul>

      {adding && <AddSongModal onSave={handleCreate} onCancel={() => setAdding(false)} />}
      {importing && <ImportModal onClose={() => setImporting(false)} />}
    </section>
  )
}

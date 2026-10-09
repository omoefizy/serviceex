import { ipcMain } from 'electron'
import type { SongInput } from '../../shared/types'
import { createSong, deleteSong, getSong, listSongs, updateSong } from '../db/songs'

// Arguments arrive from the renderer, so check their shape before they reach the database.

function assertId(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new TypeError('Song id must be a positive integer')
  }
  return value as number
}

function assertSongInput(value: unknown): SongInput {
  const input = value as Partial<SongInput> | null
  if (
    typeof input !== 'object' ||
    input === null ||
    typeof input.title !== 'string' ||
    input.title.trim() === '' ||
    (input.author !== null && typeof input.author !== 'string') ||
    typeof input.lyrics !== 'string'
  ) {
    throw new TypeError('Song needs a non-empty title, an author (string or null) and lyrics')
  }
  return { title: input.title.trim(), author: input.author, lyrics: input.lyrics }
}

export function registerSongIpc(): void {
  ipcMain.handle('songs:list', (_event, search: unknown) =>
    listSongs(typeof search === 'string' ? search : undefined),
  )

  ipcMain.handle('songs:get', (_event, id: unknown) => getSong(assertId(id)))

  ipcMain.handle('songs:create', (_event, input: unknown) => {
    const { title, author, lyrics } = assertSongInput(input)
    return createSong(title, author, lyrics)
  })

  ipcMain.handle('songs:update', (_event, id: unknown, input: unknown) => {
    const { title, author, lyrics } = assertSongInput(input)
    return updateSong(assertId(id), title, author, lyrics)
  })

  ipcMain.handle('songs:delete', (_event, id: unknown) => deleteSong(assertId(id)))
}

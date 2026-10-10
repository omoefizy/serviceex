import { ipcMain } from 'electron'
import { isArrangement } from '../../shared/lyrics'
import type { SongInput } from '../../shared/types'
import { createSong, deleteSong, getSong, listSongs, updateSong } from '../db/songs'

// Arguments arrive from the renderer, so check their shape before they reach the database.

function assertId(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new TypeError('Song id must be a positive integer')
  }
  return value as number
}

export function assertSongInput(value: unknown): SongInput {
  const input = value as Partial<SongInput> | null
  if (
    typeof input !== 'object' ||
    input === null ||
    typeof input.title !== 'string' ||
    input.title.trim() === '' ||
    (input.author !== null && typeof input.author !== 'string') ||
    (input.copyright !== null && typeof input.copyright !== 'string') ||
    !Array.isArray(input.tags) ||
    !input.tags.every((tag) => typeof tag === 'string') ||
    !isArrangement(input.arrangement) ||
    (input.themeId !== null && !(Number.isInteger(input.themeId) && (input.themeId as number) > 0)) ||
    typeof input.lyrics !== 'string'
  ) {
    throw new TypeError(
      'Song needs a non-empty title, author and copyright (string or null), tags, an arrangement, a theme id (or null) and lyrics',
    )
  }
  return {
    title: input.title.trim(),
    author: input.author,
    copyright: input.copyright,
    tags: input.tags,
    arrangement: { order: input.arrangement.order, linesPerSlide: input.arrangement.linesPerSlide },
    themeId: input.themeId as number | null,
    lyrics: input.lyrics,
  }
}

export function registerSongIpc(): void {
  ipcMain.handle('songs:list', (_event, search: unknown) =>
    listSongs(typeof search === 'string' ? search : undefined),
  )

  ipcMain.handle('songs:get', (_event, id: unknown) => getSong(assertId(id)))

  ipcMain.handle('songs:create', (_event, input: unknown) => createSong(assertSongInput(input)))

  ipcMain.handle('songs:update', (_event, id: unknown, input: unknown) =>
    updateSong(assertId(id), assertSongInput(input)),
  )

  ipcMain.handle('songs:delete', (_event, id: unknown) => deleteSong(assertId(id)))
}

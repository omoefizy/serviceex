import type { Song, SongSummary } from '../../shared/types'
import { db } from './index'

/** Splits lyrics into slide texts on blank lines, dropping empty chunks. */
function splitIntoSlides(lyrics: string): string[] {
  return lyrics
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
}

function replaceSlides(songId: number, lyrics: string): void {
  db.prepare('DELETE FROM slides WHERE song_id = ?').run(songId)
  const insert = db.prepare('INSERT INTO slides (song_id, order_index, text) VALUES (?, ?, ?)')
  splitIntoSlides(lyrics).forEach((text, index) => insert.run(songId, index, text))
}

export function listSongs(search?: string): SongSummary[] {
  const query = search?.trim()
  if (!query) {
    return db
      .prepare('SELECT id, title, author FROM songs ORDER BY title COLLATE NOCASE')
      .all() as SongSummary[]
  }

  const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  return db
    .prepare(
      `SELECT id, title, author FROM songs
       WHERE title LIKE @pattern ESCAPE '\\'
          OR author LIKE @pattern ESCAPE '\\'
          OR lyrics LIKE @pattern ESCAPE '\\'
       ORDER BY title COLLATE NOCASE`,
    )
    .all({ pattern }) as SongSummary[]
}

export function getSong(id: number): Song | undefined {
  return db.prepare('SELECT id, title, author, lyrics FROM songs WHERE id = ?').get(id) as
    | Song
    | undefined
}

export const createSong = db.transaction(
  (title: string, author: string | null, lyrics: string): Song => {
    const result = db
      .prepare('INSERT INTO songs (title, author, lyrics) VALUES (?, ?, ?)')
      .run(title, author, lyrics)
    const id = Number(result.lastInsertRowid)
    replaceSlides(id, lyrics)
    return { id, title, author, lyrics }
  },
)

/** Updates a song and rebuilds its slides. Returns false if the song does not exist. */
export const updateSong = db.transaction(
  (id: number, title: string, author: string | null, lyrics: string): boolean => {
    const result = db
      .prepare('UPDATE songs SET title = ?, author = ?, lyrics = ? WHERE id = ?')
      .run(title, author, lyrics, id)
    if (result.changes === 0) return false
    replaceSlides(id, lyrics)
    return true
  },
)

/** Deletes a song; its slides go with it via ON DELETE CASCADE. Returns false if not found. */
export function deleteSong(id: number): boolean {
  return db.prepare('DELETE FROM songs WHERE id = ?').run(id).changes > 0
}

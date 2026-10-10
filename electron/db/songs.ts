import { buildSongSlides, DEFAULT_ARRANGEMENT, isArrangement } from '../../shared/lyrics'
import type { Song, SongArrangement, SongInput, SongSummary } from '../../shared/types'
import { db } from './index'

interface SongRow {
  id: number
  title: string
  author: string | null
  copyright: string | null
  tags: string | null
  arrangement: string | null
  lyrics: string | null
}

function parseJson(value: string | null): unknown {
  if (value === null) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/** Songs saved before tags and arrangements existed have nulls in those columns. */
function toSong(row: SongRow): Song {
  const tags = parseJson(row.tags)
  const arrangement = parseJson(row.arrangement)
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    copyright: row.copyright,
    tags: Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : [],
    arrangement: isArrangement(arrangement) ? arrangement : DEFAULT_ARRANGEMENT,
    lyrics: row.lyrics ?? '',
  }
}

/** Stores the slides in play order, so the table matches what the slide grid shows. */
function replaceSlides(songId: number, lyrics: string, arrangement: SongArrangement): void {
  db.prepare('DELETE FROM slides WHERE song_id = ?').run(songId)
  const insert = db.prepare('INSERT INTO slides (song_id, order_index, text) VALUES (?, ?, ?)')
  buildSongSlides(lyrics, arrangement).forEach((slide, index) => insert.run(songId, index, slide.text))
}

function songParams(input: SongInput) {
  return {
    title: input.title,
    author: input.author,
    copyright: input.copyright,
    tags: JSON.stringify(input.tags),
    arrangement: JSON.stringify(input.arrangement),
    lyrics: input.lyrics,
  }
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
          OR tags LIKE @pattern ESCAPE '\\'
          OR lyrics LIKE @pattern ESCAPE '\\'
       ORDER BY title COLLATE NOCASE`,
    )
    .all({ pattern }) as SongSummary[]
}

export function getSong(id: number): Song | undefined {
  const row = db
    .prepare('SELECT id, title, author, copyright, tags, arrangement, lyrics FROM songs WHERE id = ?')
    .get(id) as SongRow | undefined
  return row && toSong(row)
}

export const createSong = db.transaction((input: SongInput): Song => {
  const result = db
    .prepare(
      `INSERT INTO songs (title, author, copyright, tags, arrangement, lyrics)
       VALUES (@title, @author, @copyright, @tags, @arrangement, @lyrics)`,
    )
    .run(songParams(input))
  const id = Number(result.lastInsertRowid)
  replaceSlides(id, input.lyrics, input.arrangement)
  return { id, ...input }
})

/** Adds several songs at once: all of them, or none if any fails. Returns how many were added. */
export const createSongs = db.transaction((inputs: SongInput[]): number => {
  inputs.forEach((input) => createSong(input))
  return inputs.length
})

/** Updates a song and rebuilds its slides. Returns false if the song does not exist. */
export const updateSong = db.transaction((id: number, input: SongInput): boolean => {
  const result = db
    .prepare(
      `UPDATE songs SET title = @title, author = @author, copyright = @copyright, tags = @tags,
         arrangement = @arrangement, lyrics = @lyrics
       WHERE id = @id`,
    )
    .run({ ...songParams(input), id })
  if (result.changes === 0) return false
  replaceSlides(id, input.lyrics, input.arrangement)
  return true
})

/** Deletes a song; its slides go with it via ON DELETE CASCADE. Returns false if not found. */
export function deleteSong(id: number): boolean {
  return db.prepare('DELETE FROM songs WHERE id = ?').run(id).changes > 0
}

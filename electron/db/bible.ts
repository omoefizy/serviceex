import type { BibleVersionCode, Verse } from '../../shared/types'
import { db } from './index'

const VERSE_COLUMNS = 'v.book, v.chapter, v.verse, v.text'
const FROM_VERSION = 'FROM verses v JOIN bible_versions b ON b.id = v.version_id WHERE b.code = @version'

export function getVerse(version: BibleVersionCode, book: string, chapter: number, verse: number): Verse | undefined {
  return db
    .prepare(
      `SELECT ${VERSE_COLUMNS} ${FROM_VERSION}
         AND v.book = @book AND v.chapter = @chapter AND v.verse = @verse`,
    )
    .get({ version, book, chapter, verse }) as Verse | undefined
}

export function getRange(
  version: BibleVersionCode,
  book: string,
  chapter: number,
  verseStart: number,
  verseEnd: number,
): Verse[] {
  return db
    .prepare(
      `SELECT ${VERSE_COLUMNS} ${FROM_VERSION}
         AND v.book = @book AND v.chapter = @chapter AND v.verse BETWEEN @verseStart AND @verseEnd
       ORDER BY v.verse`,
    )
    .all({ version, book, chapter, verseStart, verseEnd }) as Verse[]
}

/** Verses containing `query` (case-insensitive for ASCII), in Bible order, capped at 100. */
export function searchText(version: BibleVersionCode, query: string): Verse[] {
  const trimmed = query.trim()
  if (!trimmed) return []
  const pattern = `%${trimmed.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  return db
    .prepare(
      `SELECT ${VERSE_COLUMNS} ${FROM_VERSION}
         AND v.text LIKE @pattern ESCAPE '\\'
       ORDER BY v.id
       LIMIT 100`,
    )
    .all({ version, pattern }) as Verse[]
}

/** Book names in Bible order (the order they were imported in). */
export function listBooks(): string[] {
  return (db.prepare('SELECT book FROM verses GROUP BY book ORDER BY MIN(id)').all() as { book: string }[]).map(
    (row) => row.book,
  )
}

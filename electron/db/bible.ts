import { NEW_TESTAMENT_BOOKS, OLD_TESTAMENT_BOOKS } from '../../shared/parseReference'
import type { BibleVersionCode, Verse, VerseHit, VerseSearchParams, VerseSearchResult } from '../../shared/types'
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

/** Verses per chapter for a book (KJV); index 0 is chapter 1. */
export function bookStructure(book: string): number[] {
  const rows = db
    .prepare(
      `SELECT v.chapter, MAX(v.verse) AS verses ${FROM_VERSION} AND v.book = @book
       GROUP BY v.chapter ORDER BY v.chapter`,
    )
    .all({ version: 'KJV', book }) as { chapter: number; verses: number }[]
  const counts: number[] = []
  for (const row of rows) counts[row.chapter - 1] = row.verses
  return Array.from(counts, (count) => count ?? 0)
}

// ---------- Keyword search ----------

/** Marks the FTS5 highlight() function puts around matched words; control characters never appear in verse text. */
const MATCH_START = '\u0002'
const MATCH_END = '\u0003'

/**
 * Turns what was typed into an FTS5 expression. Every word is quoted, so nothing typed is read as FTS syntax.
 * Unquoted: all words must appear. In double quotes: the exact phrase. Either way, the last word also matches as a
 * prefix unless a space or closing quote shows it is finished. Also returns the phrase, to rank exact matches first.
 */
export function toFtsQuery(input: string): { match: string; phrase: string } | null {
  const trimmed = input.trimStart()
  const quoted = trimmed.startsWith('"')
  const closed = quoted && trimmed.length > 1 && trimmed.trimEnd().endsWith('"')
  const words = trimmed.toLowerCase().match(/[\p{L}\p{N}]+/gu)
  if (!words) return null
  const typingLastWord = !/\s$/.test(input) && !closed
  const phrase = words.join(' ')
  if (quoted) return { match: `"${phrase}"${typingLastWord ? '*' : ''}`, phrase }
  const terms = words.map((word, i) => `"${word}"${typingLastWord && i === words.length - 1 ? '*' : ''}`)
  return { match: terms.join(' '), phrase }
}

function segmentsOf(marked: string): VerseHit['segments'] {
  const segments: VerseHit['segments'] = []
  for (const part of marked.split(MATCH_START)) {
    const [matched, rest] = part.includes(MATCH_END) ? part.split(MATCH_END) : [null, part]
    if (matched) segments.push({ text: matched, match: true })
    if (rest) segments.push({ text: rest, match: false })
  }
  return segments
}

/** Full-text search, ranked with exact phrase matches first, then by relevance (BM25). */
export function searchVerses(params: VerseSearchParams): VerseSearchResult {
  const query = toFtsQuery(params.query)
  if (!query || params.versions.length === 0) return { total: 0, hits: [] }
  const books =
    params.book !== null ? [params.book] : params.testament === 'old' ? OLD_TESTAMENT_BOOKS : params.testament === 'new' ? NEW_TESTAMENT_BOOKS : null
  const where = `
    FROM verses_fts
    JOIN verses v ON v.id = verses_fts.rowid
    JOIN bible_versions b ON b.id = v.version_id
    WHERE verses_fts MATCH @match
      AND b.code IN (SELECT value FROM json_each(@versions))
      ${books ? 'AND v.book IN (SELECT value FROM json_each(@books))' : ''}`
  const values = {
    match: query.match,
    phrase: query.phrase,
    versions: JSON.stringify(params.versions),
    books: JSON.stringify(books ?? []),
    limit: params.limit,
    offset: params.offset,
  }
  try {
    const { total } = db.prepare(`SELECT count(*) AS total ${where}`).get(values) as { total: number }
    const rows = db
      .prepare(
        `SELECT v.id, b.code AS version, v.book, v.chapter, v.verse, v.text,
                highlight(verses_fts, 0, '${MATCH_START}', '${MATCH_END}') AS marked
         ${where}
         ORDER BY instr(lower(v.text), @phrase) > 0 DESC, rank, v.id
         LIMIT @limit OFFSET @offset`,
      )
      .all(values) as (Omit<VerseHit, 'segments'> & { marked: string })[]
    return { total, hits: rows.map(({ marked, ...hit }) => ({ ...hit, segments: segmentsOf(marked) })) }
  } catch (error) {
    // Words are quoted, so this should not happen; an odd input simply finds nothing.
    console.error('Verse search failed', error)
    return { total: 0, hits: [] }
  }
}

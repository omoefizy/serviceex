import { ipcMain } from 'electron'
import { BOOK_NAMES } from '../../shared/parseReference'
import type { BibleVersionCode, Testament, VerseSearchParams } from '../../shared/types'
import { bookStructure, getRange, getVerse, listBooks, matchQuote, searchText, searchVerses } from '../db/bible'

// Arguments arrive from the renderer, so check their shape before they reach the database.

const VERSIONS: BibleVersionCode[] = ['KJV', 'WEB']

function assertVersion(value: unknown): BibleVersionCode {
  if (!VERSIONS.includes(value as BibleVersionCode)) {
    throw new TypeError(`Bible version must be one of ${VERSIONS.join(', ')}`)
  }
  return value as BibleVersionCode
}

function assertBook(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('Book must be a non-empty string')
  return value
}

function assertNumber(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new TypeError(`${name} must be a positive integer`)
  }
  return value as number
}

export function registerBibleIpc(): void {
  ipcMain.handle('bible:getVerse', (_event, version: unknown, book: unknown, chapter: unknown, verse: unknown) =>
    getVerse(assertVersion(version), assertBook(book), assertNumber(chapter, 'Chapter'), assertNumber(verse, 'Verse')),
  )

  ipcMain.handle(
    'bible:getRange',
    (_event, version: unknown, book: unknown, chapter: unknown, verseStart: unknown, verseEnd: unknown) =>
      getRange(
        assertVersion(version),
        assertBook(book),
        assertNumber(chapter, 'Chapter'),
        assertNumber(verseStart, 'First verse'),
        assertNumber(verseEnd, 'Last verse'),
      ),
  )

  ipcMain.handle('bible:searchText', (_event, version: unknown, query: unknown) =>
    searchText(assertVersion(version), typeof query === 'string' ? query : ''),
  )

  ipcMain.handle('bible:listBooks', () => listBooks())

  ipcMain.handle('bible:search', (_event, params: unknown) => searchVerses(assertSearchParams(params)))

  ipcMain.handle('bible:bookStructure', (_event, book: unknown) => bookStructure(assertBook(book)))

  ipcMain.handle('bible:matchQuote', (_event, text: unknown) =>
    typeof text === 'string' && text.length <= 2000 ? matchQuote(text) : [],
  )
}

const TESTAMENTS: Testament[] = ['all', 'old', 'new']

function assertSearchParams(value: unknown): VerseSearchParams {
  const p = value as Partial<VerseSearchParams> | null
  if (typeof p !== 'object' || p === null || typeof p.query !== 'string' || p.query.length > 500) {
    throw new TypeError('Search needs a query of up to 500 characters')
  }
  if (!Array.isArray(p.versions) || !p.versions.every((v) => VERSIONS.includes(v))) throw new TypeError('Unknown Bible version')
  if (!TESTAMENTS.includes(p.testament as Testament)) throw new TypeError('Testament must be all, old or new')
  if (p.book !== null && !BOOK_NAMES.includes(p.book as string)) throw new TypeError('Unknown book')
  const whole = (n: unknown, max: number) => (Number.isInteger(n) && (n as number) >= 0 ? Math.min(n as number, max) : 0)
  return {
    query: p.query,
    versions: [...new Set(p.versions)],
    testament: p.testament as Testament,
    book: p.book as string | null,
    offset: whole(p.offset, 100_000),
    limit: Math.max(1, whole(p.limit, 100)),
  }
}

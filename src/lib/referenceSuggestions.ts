import {
  BOOK_NAMES,
  formatReference,
  parseReference,
  readReferenceInput,
  wholeBookName,
  type ScriptureReference,
} from '../../shared/parseReference'
import { BUNDLED_BIBLE_VERSIONS, type BibleVersionCode } from '../../shared/types'

/** What the Scripture tab and the command palette offer while a reference is typed. */
export type ReferenceSuggestion =
  | { kind: 'book'; label: string; book: string }
  | { kind: 'chapter'; label: string; book: string; chapter: number }
  | { kind: 'wholeChapter'; label: string; ref: ScriptureReference }
  | { kind: 'verse'; label: string; ref: ScriptureReference }
  | { kind: 'reference'; label: string; ref: ScriptureReference }
  /** Searches the words instead, for inputs that are also book names, such as "job" or "mark". */
  | { kind: 'text'; label: string }

/** Verses per chapter, by book: [31, 25, …] means chapter 1 has 31 verses. */
export type BookStructures = Record<string, number[]>

const MAX_SUGGESTIONS = 40

/** The book whose chapter and verse counts the suggestions for this input need, if any. */
export function bookNeeded(query: string): string | null {
  const reading = readReferenceInput(query)
  return reading && reading.stage !== 'book' ? reading.book : null
}

/** True when the input is a keyword search: two characters or more, and neither a book prefix nor a reference. */
export function isKeywordQuery(query: string): boolean {
  return query.trim().length >= 2 && !readReferenceInput(query) && !parseReference(query)
}

/**
 * Book, chapter or verse suggestions for a reference being typed, using real chapter and verse counts from
 * `structures` (fetched with loadBookStructure). Empty for a keyword search.
 */
export function suggestReferences(query: string, structures: BookStructures, limit = MAX_SUGGESTIONS): ReferenceSuggestion[] {
  if (query.trim().length < 2) return []
  const reading = readReferenceInput(query)
  if (reading?.stage === 'book') {
    const books: ReferenceSuggestion[] = reading.books.slice(0, Math.min(12, limit - 1)).map((book) => ({ kind: 'book', label: book, book }))
    return [...books, { kind: 'text', label: `Search verses for “${query.trim()}”` }]
  }
  if (reading?.stage === 'chapter') {
    return (structures[reading.book] ?? [])
      .map((_, i) => i + 1)
      .filter((chapter) => String(chapter).startsWith(reading.chapterPrefix))
      .slice(0, limit)
      .map((chapter) => ({ kind: 'chapter', label: `${reading.book} ${chapter}`, book: reading.book, chapter }))
  }
  if (reading?.stage === 'verse') {
    const count = structures[reading.book]?.[reading.chapter - 1] ?? 0
    const whole: ReferenceSuggestion[] =
      count > 0 && !reading.versePrefix
        ? [
            {
              kind: 'wholeChapter',
              label: `${reading.book} ${reading.chapter} (whole chapter)`,
              ref: { book: reading.book, chapter: reading.chapter, verseStart: null, verseEnd: null },
            },
          ]
        : []
    const verses: ReferenceSuggestion[] = Array.from({ length: count }, (_, i) => i + 1)
      .filter((verse) => String(verse).startsWith(reading.versePrefix))
      .slice(0, limit - whole.length)
      .map((verse) => ({
        kind: 'verse',
        label: `${reading.book} ${reading.chapter}:${verse}`,
        ref: { book: reading.book, chapter: reading.chapter, verseStart: verse, verseEnd: verse },
      }))
    return [...whole, ...verses]
  }
  const parsed = parseReference(query)
  return parsed ? [{ kind: 'reference', label: formatReference(parsed), ref: parsed }] : []
}

/** What the Scripture tab's results list shows for what was typed. */
export type ScriptureQuery =
  | { kind: 'none' }
  /** The start of a book name, or just a book number: one row per book, at its first verse, in Bible order. */
  | { kind: 'books'; books: string[]; words: boolean }
  /** A whole chapter, with the typed verse or range marked; verseStart is null when no verse was typed. */
  | { kind: 'chapter'; ref: ScriptureReference; words: boolean }
  /** Anything else, two characters or more: a keyword search. */
  | { kind: 'text'; query: string }

const inBibleOrder = (books: string[]) => [...books].sort((a, b) => BOOK_NAMES.indexOf(a) - BOOK_NAMES.indexOf(b))

/**
 * Reads the Scripture search box. `words` is set for single words such as "job", "mark" or "number", which are also
 * book names or starts of one, so the list can offer to search the verses for them instead.
 */
export function readScriptureQuery(query: string): ScriptureQuery {
  const trimmed = query.trim()
  if (/^[123]$/.test(trimmed)) return { kind: 'books', books: BOOK_NAMES.filter((book) => book.startsWith(`${trimmed} `)), words: false }
  const words = /^[a-z]{3,}$/i.test(trimmed)
  const reading = readReferenceInput(query)
  const chapterOf = (book: string, chapter: number, verseStart: number | null = null, verseEnd = verseStart): ScriptureQuery => ({
    kind: 'chapter',
    ref: { book, chapter, verseStart, verseEnd },
    words,
  })
  if (reading?.stage === 'book') {
    const book = wholeBookName(query)
    return book ? chapterOf(book, 1) : { kind: 'books', books: inBibleOrder(reading.books), words }
  }
  if (reading?.stage === 'chapter') return chapterOf(reading.book, Number(reading.chapterPrefix || 1))
  if (reading?.stage === 'verse') return chapterOf(reading.book, reading.chapter, reading.versePrefix ? Number(reading.versePrefix) : null)
  const ref = parseReference(query)
  if (ref) return chapterOf(ref.book, ref.chapter, ref.verseStart, ref.verseEnd)
  return trimmed.length >= 2 ? { kind: 'text', query } : { kind: 'none' }
}

const structureCache = new Map<string, Promise<number[]>>()

/** Chapter and verse counts for a book, read from the database once per session. */
export function loadBookStructure(book: string): Promise<number[]> {
  let counts = structureCache.get(book)
  if (!counts) {
    counts = window.api.bible.bookStructure(book)
    counts.catch(() => structureCache.delete(book))
    structureCache.set(book, counts)
  }
  return counts
}

// ---------- Version choice ----------

/** One version, or 'both', which searches every installed version (named when only KJV and WEB existed). */
export type VersionFilter = BibleVersionCode | 'both'

/** The Scripture tab's version choice, kept in localStorage under this key. */
export const SCRIPTURE_VERSION_KEY = 'worshipdeck.scripture.version'

export const isVersionFilter = (v: unknown): v is VersionFilter => typeof v === 'string' && /^(?:both|[A-Z0-9][A-Z0-9-]{0,11})$/.test(v)

/** The version choice as saved by the Scripture tab, for searches made elsewhere such as the command palette. */
export function savedVersionFilter(): VersionFilter {
  try {
    const stored = JSON.parse(localStorage.getItem(SCRIPTURE_VERSION_KEY) ?? 'null')
    return isVersionFilter(stored) ? stored : 'KJV'
  } catch {
    return 'KJV'
  }
}

/** Versions a keyword search covers: one, or every installed version. */
export const searchVersions = (filter: VersionFilter, installed: readonly BibleVersionCode[] = BUNDLED_BIBLE_VERSIONS): BibleVersionCode[] =>
  filter === 'both' ? [...installed] : [filter]

/** References open in one version; with "All" that is the KJV. */
export const referenceVersion = (filter: VersionFilter): BibleVersionCode => (filter === 'both' ? 'KJV' : filter)

import { formatReference, parseReference, readReferenceInput, type ScriptureReference } from '../../shared/parseReference'
import type { BibleVersionCode } from '../../shared/types'

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

export type VersionFilter = BibleVersionCode | 'both'

/** The Scripture tab's version choice, kept in localStorage under this key. */
export const SCRIPTURE_VERSION_KEY = 'worshipdeck.scripture.version'

export const isVersionFilter = (v: unknown): v is VersionFilter => v === 'KJV' || v === 'WEB' || v === 'both'

/** The version choice as saved by the Scripture tab, for searches made elsewhere such as the command palette. */
export function savedVersionFilter(): VersionFilter {
  try {
    const stored = JSON.parse(localStorage.getItem(SCRIPTURE_VERSION_KEY) ?? 'null')
    return isVersionFilter(stored) ? stored : 'KJV'
  } catch {
    return 'KJV'
  }
}

/** Versions a keyword search covers. */
export const searchVersions = (filter: VersionFilter): BibleVersionCode[] => (filter === 'both' ? ['KJV', 'WEB'] : [filter])

/** References open in one version; with "Both" that is the KJV. */
export const referenceVersion = (filter: VersionFilter): BibleVersionCode => (filter === 'both' ? 'KJV' : filter)

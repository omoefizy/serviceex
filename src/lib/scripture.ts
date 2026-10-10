import type { BibleVersionCode, ScripturePayload, Verse } from '../../shared/types'
import { formatReference, type ScriptureReference } from '../../shared/parseReference'
import { useOperatorStore } from '../store'

/** One search result: a verse or passage in one version, with its text from the database. */
export interface ResultItem {
  key: string
  version: BibleVersionCode
  book: string
  chapter: number
  verseStart: number
  verseEnd: number
  verses: Verse[]
  /** Keyword results: the verse text split into matched words and the rest. */
  segments?: { text: string; match: boolean }[]
}

export const itemTitle = (item: ResultItem) =>
  `${formatReference({ book: item.book, chapter: item.chapter, verseStart: item.verseStart, verseEnd: item.verseEnd })} ${item.version}`

const slidesOf = (verses: Verse[], version: BibleVersionCode) =>
  verses.map((v) => ({ text: v.text, caption: `${v.book} ${v.chapter}:${v.verse} ${version}` }))

/** A range needs one chapter of one version: it runs from the first selected verse to the last, gaps filled in. */
export function canMakeRange(items: ResultItem[]): boolean {
  return items.length > 0 && items.every((i) => i.version === items[0].version && i.book === items[0].book && i.chapter === items[0].chapter)
}

/**
 * The selected results as one scripture passage: a sequence keeps each result as given (one slide per verse, in
 * the order shown); a range reads every verse from the first to the last from the database.
 */
export async function passageOf(items: ResultItem[], mode: 'sequence' | 'range'): Promise<ScripturePayload | null> {
  if (items.length === 0) return null
  if (mode === 'range') {
    if (!canMakeRange(items)) return null
    const { version, book, chapter } = items[0]
    const start = Math.min(...items.map((i) => i.verseStart))
    const end = Math.max(...items.map((i) => i.verseEnd))
    return fetchPassage({ book, chapter, verseStart: start, verseEnd: end }, version)
  }
  const titles = items.map(itemTitle)
  return {
    title: titles.length > 3 ? `${titles.slice(0, 2).join('; ')} and ${titles.length - 2} more` : titles.join('; '),
    verses: items.flatMap((item) => slidesOf(item.verses, item.version)),
  }
}

/** Shows a passage in the slide grid and preview. Going live is a separate step (click a slide, Enter, Go Live). */
export function previewPassage(passage: ScripturePayload): void {
  useOperatorStore.getState().selectScripture(passage.title, passage.verses)
}

/** Past the end of the longest chapter (Psalm 119 has 176 verses), so "John 3" loads the whole chapter. */
const LAST_VERSE = 999

/** Reads a passage from the local Bible database. Resolves to null if no verses matched. */
export async function fetchPassage(ref: ScriptureReference, version: BibleVersionCode): Promise<ScripturePayload | null> {
  const verses = await window.api.bible.getRange(version, ref.book, ref.chapter, ref.verseStart ?? 1, ref.verseEnd ?? LAST_VERSE)
  if (verses.length === 0) return null
  return { title: `${formatReference(ref)} ${version}`, verses: slidesOf(verses, version) }
}

/** Looks up a passage and loads it into the slide grid. Resolves to the passage, or null if no verses matched. */
export async function loadScripture(ref: ScriptureReference, version: BibleVersionCode): Promise<ScripturePayload | null> {
  const passage = await fetchPassage(ref, version)
  if (passage) useOperatorStore.getState().selectScripture(passage.title, passage.verses)
  return passage
}

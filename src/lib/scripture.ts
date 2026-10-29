import type { BibleVersionCode, ScriptureGroupPassage, ScripturePayload, ScriptureSlide, Verse } from '../../shared/types'
import { formatReference, type ScriptureReference, type VersePart } from '../../shared/parseReference'
import { naturalSplit, versePartText } from '../../shared/verseParts'
import { useOperatorStore } from '../store'
import { verseCaption } from './slides'

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

/**
 * A result's text as highlight segments: the keyword matches when there are any, otherwise the whole text unmarked,
 * so a row never shows empty when the search could not mark it.
 */
export function resultSegments(item: ResultItem): { text: string; match: boolean }[] {
  if (item.segments?.some((s) => s.text.trim())) return item.segments
  return [{ text: item.verses.map((v) => v.text).join(' '), match: false }]
}

export const itemTitle = (item: ResultItem) =>
  `${formatReference({ book: item.book, chapter: item.chapter, verseStart: item.verseStart, verseEnd: item.verseEnd })} ${item.version}`

const slidesOf = (verses: Verse[], version: BibleVersionCode): ScriptureSlide[] =>
  verses.map((v) => ({ text: v.text, caption: verseCaption(v, version) }))

/** Part `which` of a verse, split at its natural break; the whole verse is kept to move the split later. */
export function versePartSlide(verse: Verse, version: BibleVersionCode, which: VersePart): ScriptureSlide {
  const split = naturalSplit(verse.text)
  return { text: versePartText(verse.text, which, split), caption: verseCaption(verse, version, undefined, which), source: verse.text, part: { which, split } }
}

/** A passage's slides, its first and last verse cut to the parts the reference names ("1:19b-20a"). */
export function passageSlides(verses: Verse[], version: BibleVersionCode, ref: Pick<ScriptureReference, 'verseStart' | 'verseEnd' | 'startPart' | 'endPart'>): ScriptureSlide[] {
  const last = verses.length - 1
  return verses.map((verse, i) => {
    const which = i === 0 && verse.verse === ref.verseStart ? ref.startPart : i === last && verse.verse === ref.verseEnd ? ref.endPart : undefined
    return which ? versePartSlide(verse, version, which) : { text: verse.text, caption: verseCaption(verse, version) }
  })
}

/**
 * Selected results as passages for a Scripture group: neighbouring verses of one chapter and version join into a
 * range ("John 3:16-18"); anything else starts a new passage. In the order given.
 */
export function passagesOf(items: ResultItem[]): ScriptureGroupPassage[] {
  const runs: ResultItem[][] = []
  for (const item of items) {
    const run = runs.at(-1)
    const prev = run?.at(-1)
    if (run && prev && prev.version === item.version && prev.book === item.book && prev.chapter === item.chapter && item.verseStart === prev.verseEnd + 1) run.push(item)
    else runs.push([item])
  }
  return runs.map((run) => {
    const { version, book, chapter } = run[0]
    const ref = { book, chapter, verseStart: run[0].verseStart, verseEnd: run[run.length - 1].verseEnd }
    return { reference: formatReference(ref), version, verses: slidesOf(run.flatMap((i) => i.verses), version) }
  })
}

/** A passage (from a search, a heard card or the slide grid) as one passage of a Scripture group. */
export function groupPassageOf(passage: ScripturePayload, reference: string, version: BibleVersionCode): ScriptureGroupPassage {
  return { reference, version, verses: passage.verses.map((v) => ({ ...v })) }
}

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
  return { title: `${formatReference(ref)} ${version}`, verses: passageSlides(verses, version, ref) }
}

/** Looks up a passage and loads it into the slide grid. Resolves to the passage, or null if no verses matched. */
export async function loadScripture(ref: ScriptureReference, version: BibleVersionCode): Promise<ScripturePayload | null> {
  const passage = await fetchPassage(ref, version)
  if (passage) useOperatorStore.getState().selectScripture(passage.title, passage.verses)
  return passage
}

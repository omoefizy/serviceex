import type { BibleVersionCode, ScripturePayload } from '../../shared/types'
import { formatReference, type ScriptureReference } from './parseReference'
import { useOperatorStore } from '../store'

/** Past the end of the longest chapter (Psalm 119 has 176 verses), so "John 3" loads the whole chapter. */
const LAST_VERSE = 999

/** Looks up a passage and loads it into the slide grid. Resolves to the passage, or null if no verses matched. */
export async function loadScripture(ref: ScriptureReference, version: BibleVersionCode): Promise<ScripturePayload | null> {
  const verses = await window.api.bible.getRange(version, ref.book, ref.chapter, ref.verseStart ?? 1, ref.verseEnd ?? LAST_VERSE)
  if (verses.length === 0) return null
  const passage: ScripturePayload = {
    title: `${formatReference(ref)} ${version}`,
    verses: verses.map((v) => ({ text: v.text, caption: `${v.book} ${v.chapter}:${v.verse} ${version}` })),
  }
  useOperatorStore.getState().selectScripture(passage.title, passage.verses)
  return passage
}

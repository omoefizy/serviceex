// Editing a verse for display: hiding words behind an ellipsis, and a small undo history for the editor. The Bible text
// itself never changes; the edited words are kept on the service item beside the original (see ScriptureSlide).

import type { VersePart } from './parseReference'
import type { ScriptureSlide } from './types'
import { snapSplit, versePartText } from './verseParts'

export const ELLIPSIS = '…'

/** The Bible's words for a scripture slide: its part of the verse, or the whole verse. */
export function originalText(slide: ScriptureSlide): string {
  const source = slide.source ?? slide.text
  return slide.part ? versePartText(source, slide.part.which, slide.part.split) : source
}

/** Edited for display: its words differ from the Bible's. */
export const isEdited = (slide: ScriptureSlide) => slide.edited === true && slide.text !== originalText(slide)

/** Without the edit marks a slide no longer needs: `source` stays only for a part or an edit. */
function tidy(slide: ScriptureSlide): ScriptureSlide {
  const next = { ...slide }
  if (!isEdited(next)) delete next.edited
  if (!next.part && !next.edited) delete next.source
  return next
}

/** The slide showing `text`: marked edited when it differs from the Bible's words, which stay in `source`. */
export function withSlideText(slide: ScriptureSlide, text: string): ScriptureSlide {
  return tidy({ ...slide, source: slide.source ?? slide.text, text, edited: true })
}

/** The slide back to the Bible's words (its part of the verse, for a part). */
export function resetSlide(slide: ScriptureSlide): ScriptureSlide {
  return tidy({ ...slide, text: originalText(slide), edited: false })
}

/** A verse caption ("Ephesians 1:19 KJV") naming part `which` of the verse, or the whole verse for null. */
export const captionWithPart = (caption: string, which: VersePart | null) =>
  caption.replace(/^(.+ \d+:\d+)[ab]?( \S+(?: · \S+)?)$/, `$1${which ?? ''}$2`)

/** A verse slide showing part `which` of the verse, split at `split` (moved to a word start); any edit is replaced. */
export function withPart(slide: ScriptureSlide, which: VersePart, split: number): ScriptureSlide {
  const source = slide.source ?? slide.text
  const at = snapSplit(source, split)
  return tidy({ ...slide, caption: captionWithPart(slide.caption, which), source, part: { which, split: at }, text: versePartText(source, which, at), edited: false })
}

/** A verse slide showing the whole verse again. */
export function withWholeVerse(slide: ScriptureSlide): ScriptureSlide {
  const next = { ...slide, caption: captionWithPart(slide.caption, null), text: slide.source ?? slide.text, edited: false }
  delete next.part
  return tidy(next)
}

/**
 * Replaces the selected words (`start` to `end` in `text`) with "…". The selection grows to whole words, an ellipsis
 * next to it joins it rather than doubling up, and the spacing comes out right whether the words were at the start,
 * in the middle or at the end. Returns the text and where the cursor goes (after the ellipsis); the text unchanged when
 * nothing but spaces was selected.
 */
export function hideSelection(text: string, start: number, end: number): { text: string; cursor: number } {
  let from = Math.max(0, Math.min(start, end))
  let to = Math.min(text.length, Math.max(start, end))
  if (!text.slice(from, to).trim()) return { text, cursor: to }
  // Whole words only; punctuation after the last word stays unless it was selected too.
  while (from > 0 && !/\s/.test(text[from - 1]) && text[from - 1] !== ELLIPSIS) from--
  while (to < text.length && !/[\s,.;:!?…]/.test(text[to])) to++
  const before = text.slice(0, from).replace(/\s+$/, '')
  const after = text.slice(to).replace(/^\s+/, '')
  const joinBefore = before.endsWith(ELLIPSIS)
  const joinAfter = after.startsWith(ELLIPSIS)
  const left = joinBefore ? before.slice(0, -1).replace(/\s+$/, '') : before
  const right = joinAfter ? after.slice(1).replace(/^\s+/, '') : after
  const head = left ? `${left} ${ELLIPSIS}` : ELLIPSIS
  // Punctuation straight after reads better against the ellipsis than after a space: "… ," becomes "…,".
  const tail = right ? (/^[,.;:!?]/.test(right) ? right : ` ${right}`) : ''
  return { text: head + tail, cursor: head.length }
}

/** An undo history of editor states: `past` before `present`, `future` after it (filled by undo, cleared by a new edit). */
export interface History<T> {
  past: T[]
  present: T
  future: T[]
}

const MAX_HISTORY = 100

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] })

/** A new state after an edit; the same history when nothing changed. */
export function record<T>(history: History<T>, next: T, same: (a: T, b: T) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b)): History<T> {
  if (same(history.present, next)) return history
  return { past: [...history.past, history.present].slice(-MAX_HISTORY), present: next, future: [] }
}

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past.at(-1)
  if (previous === undefined) return history
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] }
}

export function redo<T>(history: History<T>): History<T> {
  const [next, ...rest] = history.future
  if (next === undefined) return history
  return { past: [...history.past, history.present], present: next, future: rest }
}

// Verse parts: "Ephesians 1:19a" is the first part of the verse and "19b" the rest. The verse splits at its natural
// break nearest the middle: after a comma, semicolon, colon or dash, or before a joining word such as "and" or "but".
// The split is a character offset into the verse text, so the operator can move it to another word.

import type { VersePart } from './parseReference'

/** Words that start a new clause, so a verse can break before them. */
const CONJUNCTIONS = new Set(['and', 'but', 'for', 'so', 'yet', 'or', 'nor', 'that', 'because', 'which', 'who', 'whom', 'when', 'then', 'therefore', 'though', 'although', 'while', 'whereas', 'lest', 'unless'])

/** A break this far from either end, as a share of the verse, makes a lopsided part: the middle word is used instead. */
const EDGE = 0.2

/** Where each word starts, as offsets into `text`. */
export function wordStarts(text: string): number[] {
  const starts: number[] = []
  for (const match of text.matchAll(/\S+/g)) starts.push(match.index)
  return starts
}

/**
 * The natural breaks in a verse, as the offsets where part b would begin: after a comma, semicolon, colon or dash
 * (`punctuation`), and before a joining word such as "and" (`conjunctions`).
 */
export function naturalBreaks(text: string): { punctuation: number[]; conjunctions: number[] } {
  const inside = (at: number) => at > 0 && at < text.length
  const punctuation: number[] = []
  // At the next word after the mark; a hyphen counts only with spaces around it ("us-ward" is one word).
  for (const match of text.matchAll(/(?:[,;:]|\s[-–—]|[–—])\s*(?=\S)/g)) punctuation.push(match.index + match[0].length)
  const conjunctions = wordStarts(text).filter((start) => {
    const word = /^[A-Za-z]+/.exec(text.slice(start))?.[0].toLowerCase()
    return word !== undefined && CONJUNCTIONS.has(word) && !punctuation.includes(start)
  })
  return { punctuation: punctuation.filter(inside), conjunctions: conjunctions.filter(inside) }
}

/**
 * Where part b begins: the punctuation break nearest the middle of the verse, else the joining word nearest it, else
 * the word start nearest it. Breaks near either end are passed over, so neither part is a word or two. The verse length
 * when it is one word (part b is then empty).
 */
export function naturalSplit(text: string): number {
  const middle = text.length / 2
  const nearest = (offsets: number[]) => offsets.reduce<number | null>((best, at) => (best === null || Math.abs(at - middle) < Math.abs(best - middle) ? at : best), null)
  const inner = (offsets: number[]) => offsets.filter((at) => at >= text.length * EDGE && at <= text.length * (1 - EDGE))
  const { punctuation, conjunctions } = naturalBreaks(text)
  return nearest(inner(punctuation)) ?? nearest(inner(conjunctions)) ?? nearest(wordStarts(text).filter((at) => at > 0)) ?? text.length
}

/** Moves a split to the nearest word start, so a part never cuts a word. */
export function snapSplit(text: string, split: number): number {
  const starts = wordStarts(text).filter((at) => at > 0)
  if (starts.length === 0) return text.length
  return starts.reduce((best, at) => (Math.abs(at - split) < Math.abs(best - split) ? at : best))
}

/** The words of part `which` of a verse split at `split`. */
export function versePartText(text: string, which: VersePart, split: number): string {
  return which === 'a' ? text.slice(0, split).trimEnd() : text.slice(split).trimStart()
}

import type { AnnouncementPayload, BibleVersionCode, Verse } from '../../shared/types'
import { CONTENT_COLORS } from '../styles/contentColors'

/**
 * The caption every scripture slide carries, such as "John 3:16 KJV"; with a second translation on the slide,
 * both versions, such as "John 3:16 KJV · WEB".
 */
export const verseCaption = (verse: Verse, version: BibleVersionCode, second?: BibleVersionCode) =>
  `${verse.book} ${verse.chapter}:${verse.verse} ${version}${second ? ` · ${second}` : ''}`

/** Reads a scripture slide's caption (see verseCaption) back into its verse and versions; null for any other caption. */
export function parseVerseCaption(
  caption: string,
): { book: string; chapter: number; verse: number; version: BibleVersionCode; second?: BibleVersionCode } | null {
  const match = /^(.+) (\d+):(\d+) (\S+)(?: · (\S+))?$/.exec(caption)
  if (!match) return null
  const at = { book: match[1], chapter: Number(match[2]), verse: Number(match[3]), version: match[4] }
  return match[5] ? { ...at, second: match[5] } : at
}

/** Splits text into slide texts on blank lines, dropping empty chunks. Songs use buildSongSlides in shared/lyrics.ts. */
export function splitIntoSlides(lyrics: string): string[] {
  return lyrics
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
}

/** How a line of slide text is drawn: plain, a smaller translation of the line above, or a yellow reference line. */
export interface SlideLine {
  text: string
  kind: 'text' | 'translation' | 'reference'
}

/** The colour of a {reference} line on any theme. */
export const REFERENCE_LINE_COLOR = CONTENT_COLORS.referenceLine

/**
 * Splits slide text into lines. A line wholly in [brackets] under another line is a translation, shown smaller; a
 * line wholly in {braces}, such as {John 3:16}, is a reference, shown in yellow. The marks themselves are not shown.
 */
export function slideLines(text: string): SlideLine[] {
  return text.split('\n').map((line, index) => {
    const trimmed = line.trim()
    if (index > 0 && /^\[.+\]$/.test(trimmed)) return { text: trimmed.slice(1, -1).trim(), kind: 'translation' }
    if (/^\{.+\}$/.test(trimmed)) return { text: trimmed.slice(1, -1).trim(), kind: 'reference' }
    return { text: line, kind: 'text' }
  })
}

/** A quote's one slide: its words in quote marks, with the speaker's name under them (the theme's caption line). */
export function quoteSlide(text: string, speaker: string): { text: string; caption: string } {
  const words = text.trim().replace(/^["“”]+|["“”]+$/g, '').trim()
  return { text: `“${words}”`, caption: speaker.trim() ? `— ${speaker.trim()}` : '' }
}

/** A quote saved for reuse: an announcement marked as a quote, titled by its opening words. */
export function quotePayload(text: string, speaker: string): AnnouncementPayload {
  const words = text.trim().split(/\s+/)
  const title = `Quote: ${words.slice(0, 6).join(' ')}${words.length > 6 ? '…' : ''}`
  return { title, body: text.trim(), quote: { speaker: speaker.trim() } }
}

/**
 * Each blank-line-separated part of the body becomes a slide captioned with the title, after a slide of just the
 * title when `titleSlide` is set. A title alone makes one slide. A quote is one slide (see quoteSlide).
 */
export function announcementSlides({ title, body, titleSlide, quote }: AnnouncementPayload): { text: string; caption: string }[] {
  if (quote) return [quoteSlide(body, quote.speaker)]
  const parts = splitIntoSlides(body).map((text) => ({ text, caption: title }))
  return parts.length === 0 || titleSlide ? [{ text: title, caption: '' }, ...parts] : parts
}

/**
 * The payload with slide `index` (numbered as announcementSlides numbers them) saying `text`: the title slide changes
 * the title, a quote its words, any other slide its part of the body.
 */
export function withAnnouncementSlideText(payload: AnnouncementPayload, index: number, text: string): AnnouncementPayload {
  if (payload.quote) return { ...payload, body: text.trim().replace(/^["“”]+|["“”]+$/g, '').trim() }
  const parts = splitIntoSlides(payload.body)
  const titleFirst = parts.length === 0 || payload.titleSlide === true
  if (titleFirst && index === 0) return { ...payload, title: text.replace(/\s*\n\s*/g, ' ').trim() || payload.title }
  const at = index - (titleFirst ? 1 : 0)
  if (at < 0 || at >= parts.length) return payload
  return { ...payload, body: parts.map((part, i) => (i === at ? text : part)).join('\n\n') }
}

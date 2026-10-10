import type { AnnouncementPayload } from '../../shared/types'

/** Splits text into slide texts on blank lines, dropping empty chunks. Songs use buildSongSlides in shared/lyrics.ts. */
export function splitIntoSlides(lyrics: string): string[] {
  return lyrics
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
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

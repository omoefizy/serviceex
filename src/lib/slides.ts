import type { AnnouncementPayload } from '../../shared/types'

/** Splits text into slide texts on blank lines, dropping empty chunks. Songs use buildSongSlides in shared/lyrics.ts. */
export function splitIntoSlides(lyrics: string): string[] {
  return lyrics
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
}

/** Each blank-line-separated part of the body becomes a slide captioned with the title; a title alone makes one slide. */
export function announcementSlides({ title, body }: AnnouncementPayload): { text: string; caption: string }[] {
  const parts = splitIntoSlides(body)
  return parts.length > 0 ? parts.map((text) => ({ text, caption: title })) : [{ text: title, caption: '' }]
}

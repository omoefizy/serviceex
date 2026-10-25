// How song lyrics become slides. Shared by the main process (the slides table), the slide grid and the song editor,
// so all three always agree.
//
//   [Verse 1]            a line holding only a [label] starts a section
//   Amazing grace        lines of a slide
//   How sweet the sound
//                        a blank line starts a new slide within the section
//   That saved a wretch
//   [Que salvó a un vil]  a [bracketed] line right under a lyric line is its translation, shown smaller, unless it
//                        reads as a section name such as [Chorus]
//
// Text before the first label forms an unlabelled section.

import type { SongArrangement } from './types'

export const DEFAULT_ARRANGEMENT: SongArrangement = { order: [], linesPerSlide: null }

export const LINES_PER_SLIDE_OPTIONS = [2, 3, 4] as const

const LABEL_LINE = /^\s*\[([^\]]+)\]\s*$/

/** Labels that always start a section, even straight under a lyric line. */
const SECTION_NAME =
  /^(?:(?:verse|chorus|pre-?chorus|post-?chorus|refrain|bridge|tag|intro|outro|ending|interlude|instrumental|vamp|hook|coda|turnaround|break)\b.*|(?:v|c|b|pc|t)\s*\d*)$/i

/** A [bracketed] line that translates the lyric line above it: it follows a lyric line and is not a section name. */
const isTranslationLine = (label: RegExpExecArray, previous: string | undefined) =>
  previous !== undefined && previous.trim() !== '' && !LABEL_LINE.test(previous) && !SECTION_NAME.test(label[1].trim())

/** A run of non-blank lines. Line numbers index `lyrics.split('\n')`; `endLine` is exclusive. */
export interface LyricsChunk {
  startLine: number
  endLine: number
  lines: string[]
}

export interface LyricsSection {
  label: string | null
  /** The [label] line, or null for text before the first label. */
  labelLine: number | null
  startLine: number
  /** Exclusive: the next section's label line, or the line count. */
  endLine: number
  chunks: LyricsChunk[]
}

export interface SongSlide {
  text: string
  /** The section the slide came from, or null for unlabelled text. */
  label: string | null
}

export function isArrangement(value: unknown): value is SongArrangement {
  const a = value as Partial<SongArrangement> | null
  return (
    typeof a === 'object' &&
    a !== null &&
    Array.isArray(a.order) &&
    a.order.every((label) => typeof label === 'string') &&
    (a.linesPerSlide === null || LINES_PER_SLIDE_OPTIONS.includes(a.linesPerSlide as 2 | 3 | 4))
  )
}

/** Splits lyrics into sections at [label] lines, and each section into chunks at blank lines. */
export function parseLyrics(lyrics: string): LyricsSection[] {
  const lines = lyrics.replace(/\r\n?/g, '\n').split('\n')
  const sections: LyricsSection[] = []
  let section: LyricsSection | null = null
  let chunk: LyricsChunk | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const bracketed = LABEL_LINE.exec(line)
    const label = bracketed && !isTranslationLine(bracketed, lines[i - 1]) ? bracketed : null
    if (label || line.trim() === '') {
      if (chunk && section) {
        chunk.endLine = i
        section.chunks.push(chunk)
      }
      chunk = null
    }
    if (label) {
      if (section) section.endLine = i
      section = { label: label[1].trim(), labelLine: i, startLine: i, endLine: lines.length, chunks: [] }
      sections.push(section)
      continue
    }
    if (line.trim() === '') continue

    if (!section) {
      section = { label: null, labelLine: null, startLine: 0, endLine: lines.length, chunks: [] }
      sections.push(section)
    }
    chunk ??= { startLine: i, endLine: i + 1, lines: [] }
    chunk.lines.push(line.trim())
  }
  if (chunk && section) {
    chunk.endLine = lines.length
    section.chunks.push(chunk)
  }
  return sections
}

/**
 * Splits lines into as few slides of at most `max` lines as possible, sharing lines out evenly (5 lines at 4 → 3 + 2).
 * A translation line counts with the line above it and stays on its slide.
 */
function splitLines(lines: string[], max: number | null): string[][] {
  const units: string[][] = []
  for (const line of lines) {
    if (units.length > 0 && LABEL_LINE.test(line)) units[units.length - 1].push(line)
    else units.push([line])
  }
  if (max === null || units.length <= max) return [lines]
  const count = Math.ceil(units.length / max)
  const groups: string[][] = []
  let start = 0
  for (let i = 0; i < count; i++) {
    const size = Math.floor(units.length / count) + (i < units.length % count ? 1 : 0)
    groups.push(units.slice(start, start + size).flat())
    start += size
  }
  return groups
}

/** A section's slides, each with the lines of the lyrics it came from (`endLine` exclusive). */
function sectionSlideLines(section: LyricsSection, linesPerSlide: number | null): (SongSlide & { startLine: number; endLine: number })[] {
  return section.chunks.flatMap((chunk) => {
    // A chunk's lines are consecutive in the lyrics, and its slides take them in order.
    let at = chunk.startLine
    return splitLines(chunk.lines, linesPerSlide).map((lines) => {
      const startLine = at
      at += lines.length
      return { text: lines.join('\n'), label: section.label, startLine, endLine: at }
    })
  })
}

function sectionSlides(section: LyricsSection, linesPerSlide: number | null): SongSlide[] {
  return sectionSlideLines(section, linesPerSlide).map(({ text, label }) => ({ text, label }))
}

/** Finds a section by label, ignoring case. The first section wins when a label is used twice. */
export function findSection(sections: LyricsSection[], label: string): LyricsSection | undefined {
  const key = label.trim().toLowerCase()
  return sections.find((section) => section.label?.toLowerCase() === key)
}

/**
 * The slides a song plays, in order. With an arrangement order, sections play in that order (repeats allowed)
 * and labels that match no section are skipped; without one, sections play as written.
 */
export function buildSongSlides(lyrics: string, arrangement: SongArrangement = DEFAULT_ARRANGEMENT): SongSlide[] {
  const sections = parseLyrics(lyrics)
  if (arrangement.order.length === 0) return sections.flatMap((s) => sectionSlides(s, arrangement.linesPerSlide))
  return arrangement.order.flatMap((label) => {
    const section = findSection(sections, label)
    return section ? sectionSlides(section, arrangement.linesPerSlide) : []
  })
}

/**
 * The lyrics with the words of slide `index` (in play order) replaced by `text`, as when a slide is edited in the
 * formatting editor. A slide that plays more than once is the same lines, so every play of it changes.
 */
export function replaceSongSlide(lyrics: string, arrangement: SongArrangement, index: number, text: string): string {
  const sections = parseLyrics(lyrics)
  const played =
    arrangement.order.length === 0
      ? sections
      : arrangement.order.flatMap((label) => {
          const section = findSection(sections, label)
          return section ? [section] : []
        })
  const slide = played.flatMap((section) => sectionSlideLines(section, arrangement.linesPerSlide))[index]
  if (!slide) return lyrics
  const lines = lyrics.replace(/\r\n?/g, '\n').split('\n')
  return [...lines.slice(0, slide.startLine), ...text.replace(/\r\n?/g, '\n').split('\n'), ...lines.slice(slide.endLine)].join('\n')
}

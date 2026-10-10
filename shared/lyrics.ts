// How song lyrics become slides. Shared by the main process (the slides table), the slide grid and the song editor,
// so all three always agree.
//
//   [Verse 1]            a line holding only a [label] starts a section
//   Amazing grace        lines of a slide
//   How sweet the sound
//                        a blank line starts a new slide within the section
//   That saved a wretch
//
// Text before the first label forms an unlabelled section.

import type { SongArrangement } from './types'

export const DEFAULT_ARRANGEMENT: SongArrangement = { order: [], linesPerSlide: null }

export const LINES_PER_SLIDE_OPTIONS = [2, 3, 4] as const

const LABEL_LINE = /^\s*\[([^\]]+)\]\s*$/

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
    const label = LABEL_LINE.exec(line)
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

/** Splits lines into as few slides of at most `max` lines as possible, sharing lines out evenly (5 lines at 4 → 3 + 2). */
function splitLines(lines: string[], max: number | null): string[][] {
  if (max === null || lines.length <= max) return [lines]
  const count = Math.ceil(lines.length / max)
  const groups: string[][] = []
  let start = 0
  for (let i = 0; i < count; i++) {
    const size = Math.floor(lines.length / count) + (i < lines.length % count ? 1 : 0)
    groups.push(lines.slice(start, start + size))
    start += size
  }
  return groups
}

function sectionSlides(section: LyricsSection, linesPerSlide: number | null): SongSlide[] {
  return section.chunks
    .flatMap((chunk) => splitLines(chunk.lines, linesPerSlide))
    .map((lines) => ({ text: lines.join('\n'), label: section.label }))
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

import { parseLyrics, type LyricsSection } from '../../shared/lyrics'

/** The result of a section tool: new lyrics and where to put the cursor, or a reason it could not apply. */
export type ToolResult = { lyrics: string; cursor: number } | { error: string }

/** Lyrics in the editor always use \n, so line numbers from parseLyrics match textarea offsets. */
function lineAt(lyrics: string, position: number): number {
  return lyrics.slice(0, position).split('\n').length - 1
}

function offsetOfLine(lines: string[], line: number): number {
  return lines.slice(0, line).reduce((sum, text) => sum + text.length + 1, 0)
}

function sectionAt(sections: LyricsSection[], line: number): LyricsSection | undefined {
  return sections.find((section) => line >= section.startLine && line < section.endLine)
}

/** Starts a new slide at the cursor by putting a blank line there. */
export function splitSlideAt(lyrics: string, position: number): ToolResult {
  const before = lyrics.slice(0, position).replace(/\s+$/, '')
  const after = lyrics.slice(position).replace(/^\s+/, '')
  if (!before || !after) return { error: 'Put the cursor between two lines of a slide to split it.' }
  return { lyrics: `${before}\n\n${after}`, cursor: before.length + 2 }
}

/** Joins the slide under the cursor with the next slide in the same section by removing the blank lines between. */
export function mergeWithNext(lyrics: string, position: number): ToolResult {
  const lines = lyrics.split('\n')
  const line = lineAt(lyrics, position)
  const section = sectionAt(parseLyrics(lyrics), line)
  // On a blank line, the slide above the cursor is the one to merge.
  let index = -1
  section?.chunks.forEach((chunk, i) => {
    if (chunk.startLine <= line) index = i
  })
  const chunk = section?.chunks[index]
  const next = section?.chunks[index + 1]
  if (!chunk || !next) return { error: 'There is no next slide in this section to merge with.' }

  lines.splice(chunk.endLine, next.startLine - chunk.endLine)
  return { lyrics: lines.join('\n'), cursor: position }
}

/** "Verse 1" → "Verse 2" (or the next free number); "Chorus" → "Chorus 2". */
function nextLabel(label: string, taken: Set<string>): string {
  const numbered = /^(.*?)(\d+)$/.exec(label)
  const base = numbered ? numbered[1] : `${label} `
  let n = numbered ? Number(numbered[2]) + 1 : 2
  while (taken.has(`${base}${n}`.toLowerCase())) n++
  return `${base}${n}`
}

/** Copies the section under the cursor to just after it, under the next free label. */
export function duplicateSection(lyrics: string, position: number): ToolResult {
  const lines = lyrics.split('\n')
  const sections = parseLyrics(lyrics)
  const section = sectionAt(sections, lineAt(lyrics, position))
  if (!section || section.labelLine === null || section.label === null) {
    return { error: 'Put the cursor in a labelled section, such as one under [Verse 1], to duplicate it.' }
  }

  const label = nextLabel(section.label, new Set(sections.map((s) => s.label?.toLowerCase() ?? '')))
  const trimBlank = (block: string[]) => {
    const copy = [...block]
    while (copy.length && copy[0].trim() === '') copy.shift()
    while (copy.length && copy[copy.length - 1].trim() === '') copy.pop()
    return copy
  }
  const head = trimBlank(lines.slice(0, section.endLine))
  const body = trimBlank(lines.slice(section.labelLine + 1, section.endLine))
  const rest = trimBlank(lines.slice(section.endLine))

  const result = [...head, '', `[${label}]`, ...body, ...(rest.length ? ['', ...rest] : [])]
  return { lyrics: result.join('\n'), cursor: offsetOfLine(result, head.length + 1) }
}

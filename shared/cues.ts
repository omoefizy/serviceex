// Cues: a verse, a song, a point, a note or free text sent from one computer to another. A cue waits in the
// receiving computer's tray until someone previews it, adds it to the schedule or dismisses it. It never changes
// what is on the output by itself.

import { cleanPayload } from './sharedService'
import type { CueDraft, CueKind, SharedSongPayload } from './types'

export const CUE_KINDS: readonly { id: CueKind; label: string }[] = [
  { id: 'verse', label: 'Verse' },
  { id: 'song', label: 'Song' },
  { id: 'point', label: 'Point' },
  { id: 'note', label: 'Note' },
  { id: 'text', label: 'Text' },
]

/** The most cues the tray keeps; the oldest go first. */
export const MAX_CUES = 100
const MAX_TEXT = 20_000

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A cue as sent, checked field by field. The text is kept exactly as written, only cut at the length limit. */
export function cleanCue(value: unknown): CueDraft | null {
  if (!isObject(value) || !CUE_KINDS.some((k) => k.id === value.kind)) return null
  const kind = value.kind as CueKind
  const text = typeof value.text === 'string' ? value.text.slice(0, MAX_TEXT) : ''
  // eslint-disable-next-line no-control-regex
  const title = typeof value.title === 'string' ? value.title.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) : ''
  if (!text.trim() && !title) return null
  const cue: CueDraft = { kind, title: title || CUE_KINDS.find((k) => k.id === kind)!.label, text }
  if (kind === 'verse' && Array.isArray(value.verses)) {
    cue.verses = value.verses
      .filter(isObject)
      .slice(0, 200)
      .map((v) => ({ text: typeof v.text === 'string' ? v.text.slice(0, 5000) : '', caption: typeof v.caption === 'string' ? v.caption.slice(0, 300) : '' }))
      .filter((v) => v.text)
  }
  if (kind === 'song' && isObject(value.song)) {
    const song = cleanPayload('song', value.song)
    if (song) cue.song = song as SharedSongPayload
  }
  return cue
}

/** A one line summary for the tray and notifications. */
export function cueSummary(cue: Pick<CueDraft, 'kind' | 'title' | 'text'>): string {
  const label = CUE_KINDS.find((k) => k.id === cue.kind)?.label ?? 'Cue'
  const line = cue.text.split('\n').find((l) => l.trim())?.trim() ?? ''
  return `${label}: ${cue.title && cue.title !== label ? cue.title : line}`.slice(0, 120)
}

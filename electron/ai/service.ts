// AI tasks through the ServiceEx account (POST /ai/run). The server holds the prompts and models for a short list of
// tasks and answers in plain text; the functions here turn that text into the shape each app task returns, so the
// same checks run on it as on a developer key's answer (no changed lyrics, no invented facts, references that exist).

import { sermonDetailsText } from '../../shared/sermons'
import type { AiError, AiResult, AiTask, AiTasks, SermonDetails } from '../../shared/types'
import { isServiceError } from '../service/client'
import { serviceAccount } from '../service/registry'
import { fail } from './client'

/** The tasks the server accepts. */
export type ServiceAiTask = 'cleanLyrics' | 'announcementBuilder' | 'scriptureFallback' | 'cleanTranscriptChunk' | 'sermonNotes'

type Options = Record<string, string | number | boolean>

export interface Route<T extends AiTask> {
  task: ServiceAiTask
  text(input: AiTasks[T]['input']): string
  options?: Options | ((input: AiTasks[T]['input']) => Options)
  /** The server's text as the raw output the app task's check expects. */
  parse(output: string): unknown
}

// ---------- Reading the answers ----------

/** Markdown the model may add: headings, bold, code fences. */
const plain = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/^```[a-z]*\s*$/gim, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim()

const SECTION_WORDS = /^(verse|chorus|pre-?chorus|bridge|tag|intro|outro|refrain|interlude|ending|vamp)(\s+\d+)?$/i

/** Lyrics with section labels on their own lines ("[Verse 1]", or plain "Verse 1"), and the order they come in. */
export function lyricsFromText(output: string): { lyrics: string; order: string[] } {
  const order: string[] = []
  const lines = plain(output)
    .split('\n')
    .map((line) => {
      const bracketed = /^\s*\[([^\]]+)\]\s*$/.exec(line)?.[1]?.trim()
      const bare = line.trim().replace(/:$/, '')
      const label = bracketed ?? (SECTION_WORDS.test(bare) ? bare : null)
      if (!label) return line.replace(/\s+$/, '')
      const name = label.replace(/\b\w/g, (c) => c.toUpperCase())
      order.push(name)
      return `[${name}]`
    })
  return { lyrics: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), order }
}

const stripBullet = (line: string) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()

/** Announcement blocks (a title line, then up to three lines each) as one title and its slides. */
export function announcementFromText(output: string): { title: string; slides: string[] } {
  const blocks = plain(output)
    .split(/\n\s*\n/)
    .map((block) => block.split('\n').map(stripBullet).map((line) => line.replace(/^title:\s*/i, '')).filter(Boolean))
    .filter((block) => block.length > 0)
  const title = blocks[0]?.[0] ?? ''
  const slides = blocks.flatMap((block, i) => {
    // The first block's title line is the deck's title; the app adds a title slide itself.
    const lines = i === 0 ? block.slice(1) : block
    return lines.length ? [lines.join('\n')] : []
  })
  return { title, slides }
}

/** The server's JSON references ({book, chapter, verse_start, verse_end, confidence}) as "John 3:16-18", likeliest first. */
export function referencesFromJson(output: string): { references: string[] } {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start < 0 || end < start) return { references: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(output.slice(start, end + 1))
  } catch {
    return { references: [] }
  }
  const list = (parsed as { references?: unknown }).references
  if (!Array.isArray(list)) return { references: [] }
  const whole = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null)
  return {
    references: list
      .map((r) => r as { book?: unknown; chapter?: unknown; verse_start?: unknown; verse_end?: unknown; confidence?: unknown })
      .filter((r) => typeof r.book === 'string' && whole(r.chapter) !== null)
      .sort((a, b) => (Number(b.confidence) || 0) - (Number(a.confidence) || 0))
      .map((r) => {
        const first = whole(r.verse_start)
        const last = whole(r.verse_end)
        const verses = first ? `:${first}${last && last > first ? `-${last}` : ''}` : ''
        return `${String(r.book).trim()} ${r.chapter}${verses}`
      }),
  }
}

const HEADING = /^([a-z][a-z ]{0,30}):\s*(.*)$/i

/**
 * Sermon notes in plain text as a summary and points. The summary is the text under a "Summary" heading (or the first
 * paragraph that is not a list); the points are the list items under a heading with "point" in it (or every list item).
 */
export function notesFromText(output: string): { summary: string; points: string[] } {
  const lines = plain(output).split('\n')
  const sections: { heading: string; lines: string[] }[] = [{ heading: '', lines: [] }]
  for (const line of lines) {
    const match = HEADING.exec(line.trim())
    if (match && !/^\s*(?:[-*•]|\d+[.)])\s/.test(line)) {
      sections.push({ heading: match[1].toLowerCase(), lines: match[2] ? [match[2]] : [] })
    } else sections[sections.length - 1].lines.push(line)
  }
  const isItem = (line: string) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line)
  const summarySection = sections.find((s) => s.heading.includes('summary'))
  const paragraphs = (summarySection ? summarySection.lines : sections.flatMap((s) => s.lines))
    .join('\n')
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').filter((l) => !isItem(l)).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const pointSection = sections.find((s) => s.heading.includes('point'))
  const points = (pointSection ? pointSection.lines : sections.flatMap((s) => s.lines)).filter(isItem).map(stripBullet).filter(Boolean)
  return { summary: paragraphs[0] ?? '', points }
}

// ---------- Routes ----------

/** The server takes option values of at most this many characters. */
const MAX_OPTION_CHARS = 500

const NOTES_OPTIONS =
  (summaryWords: number, points: number) =>
  ({ sermon }: { sermon?: SermonDetails }): Options => {
    const details = sermonDetailsText(sermon).slice(0, MAX_OPTION_CHARS)
    return {
      format: `Only two parts. A line "Summary:" then one paragraph of at most ${summaryWords} words. Then a line "Points:" then at most ${points} points, one per line, each starting with "- ".`,
      rules:
        'Use only what was said and the sermon details. No scripture references, names, numbers or dates that are not in the text or the details. No title, quotes or other headings.',
      ...(details ? { sermon: details } : {}),
    }
  }

const CLEANING_WORDING = 'Keep every word as spoken, even ones that look misheard. Only add punctuation, capitals and paragraphs, and remove filler sounds.'
/** The second try for a chunk whose first answer changed words. */
const STRICT_CLEANING_WORDING = 'Copy every word exactly, change only punctuation, capitalization and paragraph breaks. Do not fix words that look misheard.'

/** How each app task goes through the server, for the tasks it offers. */
export const SERVICE_ROUTES: { [T in AiTask]?: Route<T> } = {
  cleanLyrics: {
    task: 'cleanLyrics',
    text: ({ lyrics }) => lyrics,
    options: {
      wording: 'Keep every sung word exactly as written, with its spelling. Only remove what is not sung.',
      labels: 'Write each section label on its own line in square brackets, such as [Verse 1] or [Chorus]. Write a repeated section once.',
    },
    parse: lyricsFromText,
  },
  buildAnnouncement: { task: 'announcementBuilder', text: ({ message }) => message, parse: announcementFromText },
  findScriptureReferences: { task: 'scriptureFallback', text: ({ transcript }) => transcript, parse: referencesFromJson },
  cleanTranscript: {
    task: 'cleanTranscriptChunk',
    text: ({ transcript }) => transcript,
    options: ({ strict }) => ({ wording: strict ? STRICT_CLEANING_WORDING : CLEANING_WORDING }),
    parse: (output) => ({ transcript: plain(output) }),
  },
  sermonNotes: { task: 'sermonNotes', text: ({ transcript }) => transcript, options: NOTES_OPTIONS(120, 8), parse: notesFromText },
  summarizePart: { task: 'sermonNotes', text: ({ transcript }) => transcript, options: NOTES_OPTIONS(60, 3), parse: notesFromText },
  sermonNotesFromParts: { task: 'sermonNotes', text: ({ parts }) => parts, options: NOTES_OPTIONS(120, 8), parse: notesFromText },
}

/** A server error as an AI error: the same codes the app already handles, with the sentence for the operator. */
export function aiErrorOf(error: unknown): { ok: false; error: AiError } {
  if (!isServiceError(error)) {
    console.error('AI request through ServiceEx failed', error)
    return fail('unavailable', 'The AI request failed unexpectedly. Try again shortly.')
  }
  const retry = typeof error.details.retry_after_seconds === 'number' ? { retryAfterSeconds: error.details.retry_after_seconds } : {}
  switch (error.code) {
    case 'unauthorized':
    case 'not_configured':
      return fail('no_key', error.code === 'unauthorized' ? 'Sign in to ServiceEx in Settings, Account, to use AI features.' : error.message)
    case 'ai_quota_exceeded':
    case 'license_expired':
    case 'license_revoked':
      return fail('billing', error.message)
    case 'rate_limited':
      return fail('rate_limited', error.message, retry)
    case 'offline':
      return fail('offline', error.message)
    case 'validation_error':
    case 'payload_too_large':
      return fail('bad_request', error.message)
    case 'upstream_error':
      return error.details.reason === 'refusal' ? fail('refused', 'The AI declined this request. Try rewording it.') : fail('unavailable', error.message)
    default:
      return fail('unavailable', error.message)
  }
}

/** Runs one server task; resolves to its text. Updates the allowance shown in Settings. */
export async function runServiceTask(task: ServiceAiTask, text: string, options?: Options): Promise<AiResult<string>> {
  const linked = serviceAccount()
  if (!linked?.account.isSignedIn()) return fail('no_key', 'Sign in to ServiceEx in Settings, Account, to use AI features.')
  try {
    const answer = await linked.client.request<{ output: string; truncated: boolean; allowance_remaining_tokens: number }>('POST', '/ai/run', {
      body: { task, text, ...(options ? { options } : {}) },
    })
    if (typeof answer.allowance_remaining_tokens === 'number') linked.account.setAllowanceRemaining(answer.allowance_remaining_tokens)
    if (answer.truncated) return fail('bad_request', 'The answer was too long to finish. Try a shorter input.')
    return { ok: true, value: answer.output ?? '' }
  } catch (error) {
    return aiErrorOf(error)
  }
}

// Cleaning and notes for a whole sermon. A full transcript is far too long for one request, so it goes in chunks
// (see transcriptChunks), one after another with a short pause between them, each tried again on failure. A chunk
// that still fails does not fail the job: cleaning keeps that chunk's words as spoken, notes leave it out.

import { CHUNK_WORDS, transcriptChunks } from '../../shared/sermons'
import type { AiError, AiResult, AiTask, AiTasks, SermonAiProgress } from '../../shared/types'
import { fail } from '../ai/client'
import { runTask } from '../ai/tasks'

/** The pause between chunks, so a long sermon does not hit the rate limit. */
export const CHUNK_DELAY_MS = 750
/** Tries after the first for each chunk. */
export const CHUNK_RETRIES = 2
/** The wait before the first retry; it doubles for the next. */
const BACKOFF_MS = 2000
/** The longest wait a rate limit may ask for before a retry. */
const MAX_WAIT_MS = 60_000

/** Errors every other try and chunk would hit too (AI off, no key, billing), so the job stops at once. */
const FATAL: AiError['code'][] = ['disabled', 'not_in_plan', 'no_key', 'invalid_key', 'no_encryption', 'billing']

/** How a job is told about Cancel, waits, and reports progress. */
export interface JobControl {
  cancelled(): boolean
  /** Resolves after `ms`, or at once when the job is cancelled. */
  sleep(ms: number): Promise<void>
  progress(step: SermonAiProgress['step'], done: number, total: number): void
}

/** A job's Cancel flag, with waits that end as soon as Cancel is pressed. */
export function jobControl(progress: JobControl['progress']): JobControl & { cancel(): void } {
  let cancelled = false
  const waiting = new Set<() => void>()
  return {
    cancelled: () => cancelled,
    cancel() {
      cancelled = true
      for (const wake of waiting) wake()
    },
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        if (cancelled) return resolve()
        const wake = () => {
          clearTimeout(timer)
          waiting.delete(wake)
          resolve()
        }
        const timer = setTimeout(wake, ms)
        waiting.add(wake)
      }),
    progress,
  }
}

type Failure = { ok: false; error: AiError }

/** One chunk's request, tried again up to CHUNK_RETRIES times: after 2 s, then 4 s, or as long as a rate limit asks. */
async function withRetries<T extends AiTask>(task: T, input: AiTasks[T]['input'], control: JobControl): Promise<AiResult<AiTasks[T]['output']> & { fatal?: boolean }> {
  let last: Failure | null = null
  for (let attempt = 0; attempt <= CHUNK_RETRIES; attempt++) {
    if (last) {
      const asked = last.error.retryAfterSeconds
      await control.sleep(asked ? Math.min(asked * 1000, MAX_WAIT_MS) : BACKOFF_MS * 2 ** (attempt - 1))
      if (control.cancelled()) break
    }
    const answer = await runTask(task, input)
    if (answer.ok) return answer
    last = answer
    console.error(`Sermon AI: ${task} failed (try ${attempt + 1} of ${CHUNK_RETRIES + 1})`, answer.error)
    if (FATAL.includes(answer.error.code)) return { ...answer, fatal: true }
  }
  return last ?? fail('unavailable', 'The AI request was cancelled.')
}

export interface ChunkedOutcome {
  done: number
  total: number
  failedParts: number[]
  cancelled: boolean
  error: AiError | null
}

/**
 * Cleans a raw transcript a chunk at a time. Each answer goes through cleanTranscript's word check against its own
 * chunk; a chunk that fails it, or every try, keeps its words as spoken. After Cancel, or an error every chunk would
 * hit, the chunks not reached are kept as spoken too, so the cleaned transcript never loses words.
 */
export async function cleanInChunks(raw: string, control: JobControl): Promise<ChunkedOutcome & { transcript: string }> {
  const chunks = transcriptChunks(raw)
  const parts: string[] = []
  const outcome: ChunkedOutcome = { done: 0, total: chunks.length, failedParts: [], cancelled: false, error: null }
  for (const [index, chunk] of chunks.entries()) {
    if (outcome.cancelled || (outcome.error && FATAL.includes(outcome.error.code))) {
      parts.push(chunk)
      continue
    }
    if (index > 0) await control.sleep(CHUNK_DELAY_MS)
    if (control.cancelled()) {
      outcome.cancelled = true
      parts.push(chunk)
      continue
    }
    control.progress('clean', index + 1, chunks.length)
    const answer = await withRetries('cleanTranscript', { transcript: chunk }, control)
    if (answer.ok) {
      parts.push(answer.value.transcript)
      outcome.done += 1
    } else {
      parts.push(chunk)
      // A retry cut short by Cancel is not a failure of the chunk.
      if (!control.cancelled()) {
        outcome.failedParts.push(index + 1)
        outcome.error = answer.error
      }
    }
    if (control.cancelled()) outcome.cancelled = true
  }
  return { ...outcome, transcript: parts.join('\n\n') }
}

/** A part's notes as a few lines for the final request. */
const partLines = ({ summary, points }: { summary: string; points: string[] }) => [summary, ...points.map((p) => `- ${p}`)].join('\n')

/**
 * A summary and key points. A short sermon goes in one request. A long one is summarised a chunk at a time first, and
 * the notes are made from those short summaries, so the last request stays small (when even they add up past
 * CHUNK_WORDS, they are summarised again in groups first). A part that fails every try is left out.
 */
export async function notesInChunks(transcript: string, control: JobControl): Promise<ChunkedOutcome & { notes: AiResult<{ summary: string; points: string[] }> | null }> {
  const chunks = transcriptChunks(transcript)
  const outcome: ChunkedOutcome = { done: 0, total: chunks.length, failedParts: [], cancelled: false, error: null }
  if (chunks.length === 1) {
    control.progress('notes', 1, 1)
    const notes = await withRetries('sermonNotes', { transcript: chunks[0] }, control)
    if (notes.ok) outcome.done = 1
    else outcome.error = notes.error
    return { ...outcome, cancelled: control.cancelled(), notes }
  }

  let parts: string[] = []
  for (const [index, chunk] of chunks.entries()) {
    if (index > 0) await control.sleep(CHUNK_DELAY_MS)
    if (control.cancelled()) return { ...outcome, cancelled: true, notes: null }
    control.progress('summarise', index + 1, chunks.length)
    const answer = await withRetries('summarizePart', { transcript: chunk }, control)
    if (answer.ok) {
      parts.push(partLines(answer.value))
      outcome.done += 1
    } else {
      outcome.failedParts.push(index + 1)
      outcome.error = answer.error
      if (answer.fatal) return { ...outcome, notes: answer }
    }
  }
  if (parts.length === 0) return { ...outcome, cancelled: control.cancelled(), notes: outcome.error ? { ok: false, error: outcome.error } : null }

  // A very long sermon: its part summaries are summarised again, a group at a time, until they are short enough.
  while (parts.join('\n\n').split(/\s+/).length > CHUNK_WORDS && parts.length > 1) {
    const groups = transcriptChunks(parts.join('\n\n'), CHUNK_WORDS)
    const shorter: string[] = []
    for (const group of groups) {
      await control.sleep(CHUNK_DELAY_MS)
      if (control.cancelled()) return { ...outcome, cancelled: true, notes: null }
      const answer = await withRetries('summarizePart', { transcript: group }, control)
      if (!answer.ok) return { ...outcome, error: answer.error, notes: answer }
      shorter.push(partLines(answer.value))
    }
    parts = shorter
  }

  await control.sleep(CHUNK_DELAY_MS)
  if (control.cancelled()) return { ...outcome, cancelled: true, notes: null }
  control.progress('notes', chunks.length, chunks.length)
  const notes = await withRetries('sermonNotesFromParts', { parts: parts.join('\n\n') }, control)
  if (!notes.ok) outcome.error = notes.error
  return { ...outcome, cancelled: control.cancelled(), notes }
}

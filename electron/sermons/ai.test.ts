// Cleaning and notes for a long sermon go a chunk at a time, never the whole transcript in one request. The Anthropic
// client is faked as in ../ai/tasks.test; the sermon text is invented.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHUNK_WORDS } from '../../shared/sermons'

const create = vi.fn()
const ready = vi.fn()

vi.mock('../ai/client', () => ({
  fail: (code: string, message: string) => ({ ok: false, error: { code, message } }),
  readyClient: () => ready(),
  toAiError: (error: unknown) => ({ ok: false, error: { code: 'unavailable', message: String(error) } }),
}))
vi.mock('../db/settings', () => ({ getAppSettings: () => ({ aiEnabled: true, aiModel: 'claude-sonnet-5-5' }) }))
vi.mock('../db/bible', () => ({ getVerse: () => null, listBooks: () => [] }))

const { cleanInChunks, jobControl, notesInChunks, CHUNK_RETRIES } = await import('./ai')

// About 8,000 words of invented speech, as speech recognition writes it: lower case, full stops, no digits.
const PHRASES = [
  'the river keeps moving past the old mill and the children wave from the bridge',
  'um we often wait for a perfect morning before we start anything at all',
  'a lantern does not argue with the dark it simply keeps on shining',
  'think about the baker who rises early so the whole street can eat',
  'kindness is a small door that opens into a very large room',
  'when the harvest is late the farmer still walks the field each evening',
]
const SERMON = Array.from({ length: 490 }, (_, i) => `${PHRASES[i % PHRASES.length]} again and again.`).join(' ')
const wordsOf = (text: string) => text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)

/** Which task a request is for, from the first line of its system prompt. */
function taskOf(request: { system: string }) {
  if (request.system.startsWith('You tidy one stretch')) return 'clean'
  if (request.system.startsWith('You are given one part')) return 'part'
  if (request.system.startsWith('You write notes on a long sermon')) return 'final'
  return 'notes'
}
const userText = (request: { messages: { content: string }[] }) => request.messages[0].content
const reply = (value: unknown) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(value) }] })

let inFlight = 0
let mostAtOnce = 0
/** Answers like a model that does the job properly; `override` may answer a request differently. */
function fakeModel(override?: (request: { system: string; messages: { content: string }[] }) => unknown) {
  create.mockImplementation(async (request) => {
    inFlight += 1
    mostAtOnce = Math.max(mostAtOnce, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 1))
    inFlight -= 1
    const custom = override?.(request)
    if (custom) return custom
    const body = userText(request).split('\n\n').slice(1).join('\n\n')
    const sample = wordsOf(body).slice(0, 12).join(' ')
    if (taskOf(request) === 'clean') return reply({ transcript: body.charAt(0).toUpperCase() + body.slice(1) })
    return reply({ summary: `${sample}.`, points: [`${wordsOf(body).slice(3, 10).join(' ')}.`] })
  })
}

const control = () => {
  const job = jobControl(vi.fn())
  const sleep = vi.fn(async () => undefined)
  return Object.assign(job, { sleep, progress: vi.fn() })
}

beforeEach(() => {
  create.mockReset()
  ready.mockReset()
  ready.mockResolvedValue({ ok: true, value: { beta: { messages: { create } } } })
  inFlight = 0
  mostAtOnce = 0
})

describe('the invented sermon', () => {
  it('is about 8,000 words', () => {
    expect(wordsOf(SERMON).length).toBeGreaterThan(7500)
    expect(wordsOf(SERMON).length).toBeLessThan(8500)
  })
})

describe('cleaning in chunks', () => {
  it('sends chunks of at most 1,500 words one after another, never the whole transcript', async () => {
    fakeModel()
    const job = control()
    const result = await cleanInChunks(SERMON, job)

    const requests = create.mock.calls.map(([request]) => request)
    expect(requests.length).toBe(6)
    expect(result).toMatchObject({ done: 6, total: 6, failedParts: [], cancelled: false, error: null })
    for (const [index, request] of requests.entries()) {
      const sent = wordsOf(userText(request).split('\n\n').slice(1).join(' '))
      expect(sent.length).toBeLessThanOrEqual(CHUNK_WORDS)
      // Full chunks are close to the limit; the last one holds what is left.
      if (index < requests.length - 1) expect(sent.length).toBeGreaterThan(1400)
      expect(userText(request).length).toBeLessThan(SERMON.length / 4)
    }
    // One at a time, with a pause between them, and progress for each part.
    expect(mostAtOnce).toBe(1)
    expect(job.sleep).toHaveBeenCalledTimes(5)
    expect(job.progress.mock.calls).toEqual([1, 2, 3, 4, 5, 6].map((n) => ['clean', n, 6]))
    // No overlap and nothing lost: the chunks add up to the transcript.
    expect(wordsOf(result.transcript)).toEqual(wordsOf(SERMON))
    expect(result.transcript.split('\n\n')).toHaveLength(6)
  })

  it('keeps a chunk as spoken when the AI changes its words every time, and goes on with the rest', async () => {
    let third = ''
    fakeModel((request) => {
      if (taskOf(request) !== 'clean') return undefined
      const body = userText(request).split('\n\n').slice(1).join('\n\n')
      if (!third && create.mock.calls.length === 3) third = body
      return body === third ? reply({ transcript: `${body} hallelujah` }) : undefined
    })
    const job = control()
    const result = await cleanInChunks(SERMON, job)
    expect(result).toMatchObject({ done: 5, total: 6, failedParts: [3], cancelled: false })
    expect(result.error?.message).toMatch(/changed the wording/)
    // Three tries for the third chunk, with growing waits.
    expect(create.mock.calls.filter(([request]) => userText(request).endsWith(third))).toHaveLength(CHUNK_RETRIES + 1)
    expect(job.sleep).toHaveBeenCalledWith(2000)
    expect(job.sleep).toHaveBeenCalledWith(4000)
    expect(result.transcript.split('\n\n')[2]).toBe(third)
    expect(wordsOf(result.transcript)).toEqual(wordsOf(SERMON))
  })

  it('stops at once on an error every chunk would hit, keeping the rest as spoken', async () => {
    fakeModel()
    create.mockImplementationOnce(async (request) => {
      // After the first chunk the key is gone, as if it was removed in Settings.
      ready.mockResolvedValue({ ok: false, error: { code: 'no_key', message: 'No Anthropic key is saved.' } })
      const body = userText(request).split('\n\n').slice(1).join('\n\n')
      return reply({ transcript: body })
    })
    const result = await cleanInChunks(SERMON, control())
    expect(result).toMatchObject({ done: 1, total: 6, failedParts: [2], error: { code: 'no_key' } })
    expect(ready).toHaveBeenCalledTimes(2)
    expect(wordsOf(result.transcript)).toEqual(wordsOf(SERMON))
  })

  it('keeps what is done when cancelled', async () => {
    fakeModel()
    const job = control()
    job.progress.mockImplementation((_step: string, done: number) => {
      if (done === 3) job.cancel()
    })
    const result = await cleanInChunks(SERMON, job)
    expect(result).toMatchObject({ done: 3, total: 6, cancelled: true, failedParts: [] })
    expect(create).toHaveBeenCalledTimes(3)
    expect(wordsOf(result.transcript)).toEqual(wordsOf(SERMON))
  })
})

describe('notes in chunks', () => {
  it('summarises each chunk, then makes the notes from the short summaries in one small request', async () => {
    fakeModel((request) =>
      taskOf(request) === 'final'
        ? reply({ summary: 'the river keeps moving and a lantern keeps on shining.', points: ['the river keeps moving.', 'kindness is a small door.', 'the baker rises early.', 'the farmer walks the field.', 'a lantern keeps shining.'] })
        : undefined,
    )
    const job = control()
    const result = await notesInChunks(SERMON, job)

    const requests = create.mock.calls.map(([request]) => request)
    expect(requests.map(taskOf)).toEqual(['part', 'part', 'part', 'part', 'part', 'part', 'final'])
    for (const request of requests) expect(userText(request).length).toBeLessThan(SERMON.length / 4)
    // The last request is made of the part summaries only: a few hundred words at most.
    expect(wordsOf(userText(requests[6])).length).toBeLessThan(300)
    expect(mostAtOnce).toBe(1)
    expect(result.notes).toMatchObject({ ok: true, value: { points: expect.arrayContaining(['kindness is a small door.']) } })
    expect(result).toMatchObject({ done: 6, total: 6, failedParts: [], cancelled: false })
    expect(job.progress.mock.calls.at(-1)).toEqual(['notes', 6, 6])
  })

  it('leaves out a part that fails every try, and says which', async () => {
    fakeModel((request) => {
      if (taskOf(request) === 'part' && userText(request).includes('again and again.') && create.mock.calls.length <= 3) {
        return reply({ summary: 'Pastor Quinlan said this on the 9th.', points: ['Nothing.'] })
      }
      if (taskOf(request) === 'final') return reply({ summary: 'the river keeps moving.', points: ['the river keeps moving.'] })
      return undefined
    })
    const result = await notesInChunks(SERMON, control())
    expect(result.failedParts).toEqual([1])
    expect(result.notes?.ok).toBe(true)
    expect(result.error?.message).toMatch(/not said/)
  })

  it('makes a short sermon in one request', async () => {
    fakeModel((request) => (taskOf(request) === 'notes' ? reply({ summary: 'the river keeps moving.', points: ['the river keeps moving.'] }) : undefined))
    const result = await notesInChunks(PHRASES.join('. '), control())
    expect(create).toHaveBeenCalledTimes(1)
    expect(result.notes?.ok).toBe(true)
  })
})

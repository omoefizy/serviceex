// The pickStatements AI task, with the Anthropic client faked. The transcript is invented.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const create = vi.fn()
const settings = { aiEnabled: true, aiModel: 'claude-sonnet-5-5', statementPicking: true }

vi.mock('./client', () => ({
  fail: (code: string, message: string) => ({ ok: false, error: { code, message } }),
  readyClient: async () => ({ ok: true, value: { beta: { messages: { create } } } }),
  toAiError: (error: unknown) => ({ ok: false, error: { code: 'unavailable', message: String(error) } }),
}))
vi.mock('../db/settings', () => ({ getAppSettings: () => settings }))
vi.mock('../db/bible', () => ({ getVerse: () => null, listBooks: () => [] }))

const { runTask } = await import('./tasks')

const TRANSCRIPT =
  'Let me tell you about the night the power went out at camp. We sat in the dark and sang anyway. ' +
  'Faith is singing before the lights come back on. Nobody knew every word, and that was fine.'

function answer(statements: unknown) {
  create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ statements }) }] })
}

beforeEach(() => {
  create.mockReset()
  settings.statementPicking = true
})

describe('pickStatements', () => {
  it('asks Claude Haiku about only the text it was given', async () => {
    answer([])
    await runTask('pickStatements', { transcript: TRANSCRIPT })
    const request = create.mock.calls[0][0]
    expect(request.model).toBe('claude-haiku-5-5')
    // Haiku has no server-side fallback.
    expect(request.fallbacks).toBeUndefined()
    expect(request.messages).toEqual([{ role: 'user', content: `Transcript:\n\n${TRANSCRIPT}` }])
  })

  it('keeps a verbatim statement and drops a reworded one', async () => {
    answer(['Faith is singing before the lights come back on.', 'Faith means singing before the lights return.'])
    const result = await runTask('pickStatements', { transcript: TRANSCRIPT })
    expect(result).toEqual({ ok: true, value: { statements: ['Faith is singing before the lights come back on.'] } })
  })

  it('returns nothing when every statement was reworded or merged', async () => {
    answer(['We sat in the dark and sang anyway, and nobody knew every word.', 'Faith is singing before the light comes on.'])
    expect(await runTask('pickStatements', { transcript: TRANSCRIPT })).toEqual({ ok: true, value: { statements: [] } })
  })

  it('refuses when statement suggestions are off', async () => {
    settings.statementPicking = false
    const result = await runTask('pickStatements', { transcript: TRANSCRIPT })
    expect(result.ok).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })
})

describe('cleanLyrics', () => {
  const LYRICS = '[Verse 1]\nAmazing grace how sweet the sound'

  it('sends only the plain lyrics, never their formatting, and returns plain lyrics', async () => {
    create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ lyrics: LYRICS, order: ['Verse 1'] }) }] })
    const formatting = { 'Amazing grace how sweet the sound': { paragraphs: [{ spans: [{ text: 'Amazing grace how sweet the sound', bold: true }] }] } }
    const result = await runTask('cleanLyrics', { lyrics: LYRICS, formatting })
    expect(create.mock.calls[0][0].messages).toEqual([{ role: 'user', content: `Clean up these lyrics:\n\n${LYRICS}` }])
    expect(JSON.stringify(create.mock.calls[0][0])).not.toContain('bold')
    expect(result).toEqual({ ok: true, value: { lyrics: LYRICS, order: ['Verse 1'] } })
  })
})

describe('plans', () => {
  it('refuses a task whose feature the plan leaves out, before asking Claude', async () => {
    const { setEntitlements } = await import('../../shared/features')
    setEntitlements({ plan: 'Basic', features: ['ai.statements'] })
    try {
      const result = await runTask('cleanLyrics', { lyrics: 'Amazing grace' })
      expect(result).toEqual({ ok: false, error: { code: 'not_in_plan', message: 'AI lyrics cleaner is not included in the Basic plan. See Settings, Plan.' } })
      expect(create).not.toHaveBeenCalled()
    } finally {
      setEntitlements(null)
    }
  })
})

// The pickStatements AI task, with the Anthropic client faked. The transcript is invented.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const create = vi.fn()
const settings = { aiEnabled: true, aiModel: 'claude-sonnet-5-5', statementPicking: true }

vi.mock('./client', () => ({
  fail: (code: string, message: string, extra = {}) => ({ ok: false, error: { code, message, ...extra } }),
  readyClient: async () => ({ ok: true, value: { beta: { messages: { create } } } }),
  toAiError: (error: unknown) => ({ ok: false, error: { code: 'unavailable', message: String(error) } }),
}))
vi.mock('../db/settings', () => ({ getAppSettings: () => settings }))
vi.mock('../keys', () => ({ keyProvider: () => 'developer_key' }))
vi.mock('../db/bible', () => ({ getVerse: () => null, listBooks: () => [] }))

const { runTask, STRICT_CLEANING, wordingChanges } = await import('./tasks')

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
  it('refuses a task whose feature the plan leaves out, before asking Claude, once plan limits are enforced', async () => {
    const { ENFORCE_ENTITLEMENTS, setEntitlementEnforcement, setEntitlements } = await import('../../shared/features')
    setEntitlements({ plan: 'Basic', features: ['ai.statements'] })
    setEntitlementEnforcement(true)
    try {
      const result = await runTask('cleanLyrics', { lyrics: 'Amazing grace' })
      expect(result).toEqual({ ok: false, error: { code: 'not_in_plan', message: 'AI lyrics cleaner is not included in the Basic plan. See Settings, Account.' } })
      expect(create).not.toHaveBeenCalled()
    } finally {
      setEntitlementEnforcement(ENFORCE_ENTITLEMENTS)
      setEntitlements(null)
    }
  })

  it('runs the task while ENFORCE_ENTITLEMENTS is false, and logs what it would have blocked', async () => {
    const { ENFORCE_ENTITLEMENTS, setEntitlements } = await import('../../shared/features')
    expect(ENFORCE_ENTITLEMENTS).toBe(false)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    setEntitlements({ plan: 'Basic', features: ['ai.statements'] })
    create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ lyrics: 'Amazing grace', order: [] }) }] })
    try {
      const result = await runTask('cleanLyrics', { lyrics: 'Amazing grace' })
      expect(result.ok).toBe(true)
      expect(create).toHaveBeenCalled()
      expect(info).toHaveBeenCalledWith(expect.stringContaining('would block "ai.lyricsCleaner"'))
    } finally {
      info.mockRestore()
      setEntitlements(null)
    }
  })
})

describe('cleanTranscript', () => {
  const RAW = 'um so we were uh talking about the garden gate it it sticks in the rain and you have to lift it a little'

  const reply = (transcript: string) =>
    create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ transcript }) }] })

  it('keeps a version with punctuation and paragraphs that drops only filler', async () => {
    const cleaned = 'So we were talking about the garden gate.\n\nIt sticks in the rain, and you have to lift it a little.'
    reply(cleaned)
    expect(await runTask('cleanTranscript', { transcript: RAW })).toEqual({ ok: true, value: { transcript: cleaned } })
  })

  it('refuses a version that adds or changes words', async () => {
    reply('So we were talking about the old garden gate. It sticks when it rains.')
    const result = await runTask('cleanTranscript', { transcript: RAW })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toMatch(/changed the wording.*“old”/)
  })

  it('refuses a heading line, which lyrics would allow as a section label', async () => {
    reply('[Introduction]\nSo we were talking about the garden gate.')
    expect((await runTask('cleanTranscript', { transcript: RAW })).ok).toBe(false)
  })

  // 60 words of invented speech, so 2 percent allows one small word to differ.
  const LONG =
    'we walked down to the harbour before the sun came up and the boats were still tied at the quay ' +
    'my grandfather said you want see the water before anyone else does he never hurried he stood there ' +
    'and he waited and he watched the light come over the hill and then he turned around and went home for breakfast'

  it('lets one small word differ in a long chunk, and says which words it flagged when more differ', async () => {
    expect(LONG.split(' ')).toHaveLength(60)
    const slip = LONG.replace('you want see', 'you want to see')
    reply(slip)
    expect(await runTask('cleanTranscript', { transcript: LONG })).toEqual({ ok: true, value: { transcript: slip } })

    reply(slip.replace('down to the harbour', 'down the harbour'))
    const result = await runTask('cleanTranscript', { transcript: LONG })
    expect(result).toMatchObject({ ok: false, error: { flagged: ['-to', '+to'] } })
    if (!result.ok) expect(result.error.message).not.toMatch(/try again/i)
  })

  it('refuses any changed content word, name or number, however long the chunk', async () => {
    for (const changed of [
      LONG.replace('grandfather', 'grandad'),
      LONG.replace('harbour', 'Harbourside'),
      LONG.replace('the boats', 'the 3 boats'),
      LONG.replace('he never hurried', 'he never ever hurried'),
      LONG.replace('went home for breakfast', 'went home'),
    ]) {
      reply(changed)
      expect((await runTask('cleanTranscript', { transcript: LONG })).ok).toBe(false)
    }
  })

  it('ignores punctuation, capitals, apostrophes, filler sounds and stammers', () => {
    expect(wordingChanges('um i dont think think its uh over', 'I don\'t think it\'s over.')).toEqual({ rejected: [], small: [], words: 8 })
  })

  it('lets no word change inside a quoted verse', () => {
    const raw = 'and he read for god so loved the world that he gave his only son and then he sat down ' + LONG
    const quoted = 'And he read, “For God so loved world, that he gave his only son.” And then he sat down. ' + LONG
    expect(wordingChanges(raw, quoted).rejected).toEqual(['-the'])
    expect(wordingChanges(raw, quoted.replace('loved world', 'loved the world').replace('he sat down', 'he sat down the')).rejected).toEqual([])
  })

  it('asks for an exact copy on the strict try', async () => {
    reply(RAW)
    await runTask('cleanTranscript', { transcript: RAW, strict: true })
    expect(create.mock.calls[0][0].messages[0].content).toBe(`Transcript (${STRICT_CLEANING}):\n\n${RAW}`)
    expect(STRICT_CLEANING).toBe('copy every word exactly, change only punctuation, capitalization and paragraph breaks')
  })
})

describe('sermonNotes', () => {
  const TRANSCRIPT =
    'This morning we look at the lighthouse keeper. She climbed the stairs every evening, even when no ships came. ' +
    'Faithfulness is mostly unseen. The light mattered most on the nights she felt it mattered least.'

  const reply = (summary: string, points: string[]) =>
    create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ summary, points }) }] })

  it('keeps notes that use only what was said, and the summary within 120 words', async () => {
    reply(`The lighthouse keeper climbed every evening. ${'Faithfulness is mostly unseen. '.repeat(40)}`, ['Faithfulness is mostly unseen.', 'Keep the light on.'])
    const result = await runTask('sermonNotes', { transcript: TRANSCRIPT })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.summary.split(/\s+/).length).toBeLessThanOrEqual(120)
      expect(result.value.points).toEqual(['Faithfulness is mostly unseen.', 'Keep the light on.'])
    }
  })

  it('refuses notes that bring in a name or a number that was not said', async () => {
    reply('A talk on faithfulness.', ['As Captain Reyes said, keep the light on.'])
    expect((await runTask('sermonNotes', { transcript: TRANSCRIPT })).ok).toBe(false)
    reply('A talk on faithfulness.', ['She climbed 300 stairs each evening.'])
    expect((await runTask('sermonNotes', { transcript: TRANSCRIPT })).ok).toBe(false)
  })

  const DETAILS = {
    title: 'Keeping the Light On',
    preacher: 'Pastor Adaeze Okafor',
    series: 'Harbour Lights',
    churchName: 'Grace Chapel Port Harcourt',
    date: '2026-10-31',
    scriptures: ['Matthew 5:14-16', 'Psalms 119:105'],
  }

  it('sends the sermon’s details with the transcript, and never the product name', async () => {
    reply('A talk on faithfulness.', ['Faithfulness is mostly unseen.'])
    await runTask('sermonNotes', { transcript: TRANSCRIPT, sermon: DETAILS })
    const request = create.mock.calls[0][0]
    expect(request.messages[0].content).toBe(
      'Sermon details (from the app, not the speaker):\nTitle: Keeping the Light On\nPreacher: Pastor Adaeze Okafor\nSeries: Harbour Lights\n' +
        'Church: Grace Chapel Port Harcourt\nDate: Saturday, October 31, 2026\nScripture read: Matthew 5:14-16; Psalms 119:105\n\n' +
        `Transcript:\n\n${TRANSCRIPT}`,
    )
    expect(JSON.stringify(request)).not.toMatch(/ServiceEx|WorshipDeck/i)
  })

  it('accepts words and numbers from the sermon’s details', async () => {
    reply(
      'Pastor Adaeze Okafor of Grace Chapel Port Harcourt spoke at Saturday’s service on 31 October 2026, in the Harbour Lights series.',
      ['Matthew 5:15 says to keep the light on.', 'Psalms 119:105 calls the word a lamp.', 'Keeping the Light On means being faithful.'],
    )
    expect(await runTask('sermonNotes', { transcript: TRANSCRIPT, sermon: DETAILS })).toMatchObject({ ok: true })
  })

  it('still refuses names, numbers and places that are in neither the transcript nor the details', async () => {
    for (const point of ['Pastor Okafor met Captain Reyes on the pier.', 'She climbed 300 stairs each evening.', 'John 3:16 shows this.', 'The keeper lived in Lagos.']) {
      reply('A talk on faithfulness.', [point])
      const result = await runTask('sermonNotes', { transcript: TRANSCRIPT, sermon: DETAILS })
      expect(result).toMatchObject({ ok: false, error: { flagged: expect.any(Array) } })
    }
    reply('Faithfulness on Friday.', ['Faithfulness is mostly unseen.'])
    expect(await runTask('sermonNotes', { transcript: TRANSCRIPT, sermon: DETAILS })).toMatchObject({ ok: false, error: { flagged: ['friday'] } })
  })

  it('reads a possessive as the word the speaker said', async () => {
    reply('Plans for Saturday’s outreach.', ['Faithfulness is mostly unseen.'])
    expect(await runTask('sermonNotes', { transcript: `${TRANSCRIPT} We meet again on saturday.` })).toMatchObject({ ok: true })
  })

  it('keeps at most 8 key points', async () => {
    reply('A talk on faithfulness.', Array.from({ length: 12 }, () => 'Faithfulness is mostly unseen.'))
    const result = await runTask('sermonNotes', { transcript: TRANSCRIPT })
    expect(result.ok && result.value.points).toHaveLength(8)
  })
})

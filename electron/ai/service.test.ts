// AI tasks through the ServiceEx account, against a fake server on this computer: each app task goes to its server
// task, the plain text answer is read into the task's shape and gets the same checks as a developer key's answer, and
// the server's errors read as plain sentences. The local Anthropic client is never used. The texts are invented.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const create = vi.fn()
vi.mock('./client', () => ({
  fail: (code: string, message: string, extra = {}) => ({ ok: false, error: { code, message, ...extra } }),
  readyClient: async () => ({ ok: true, value: { beta: { messages: { create } } } }),
  toAiError: (error: unknown) => ({ ok: false, error: { code: 'unavailable', message: String(error) } }),
}))
vi.mock('../db/settings', () => ({ getAppSettings: () => ({ aiEnabled: true, aiModel: 'claude-sonnet-5-5', statementPicking: true, aiScriptureFallback: true }) }))
vi.mock('../keys', () => ({ keyProvider: () => 'service' }))
vi.mock('../db/bible', () => ({
  listBooks: () => ['Psalms', 'John'],
  getVerse: (_v: string, book: string, chapter: number, verse: number) => (book === 'John' && chapter === 3 && verse <= 21) || (book === 'Psalms' && chapter === 23 && verse <= 6) ? { text: '…' } : null,
}))

const { FAKE_CODE, FakeServiceServer } = await import('../service/fakeServer.test-helper')
const { ServiceClient } = await import('../service/client')
const { AccountService } = await import('../service/account')
const { setServiceAccount } = await import('../service/registry')
const { runTask } = await import('./tasks')
const { announcementFromText, lyricsFromText, notesFromText, referencesFromJson } = await import('./service')

const server = new FakeServiceServer()

beforeAll(async () => {
  await server.start()
  let saved: Parameters<InstanceType<typeof ServiceClient>['setSession']>[0] | null = null
  const client = new ServiceClient({
    baseUrl: () => server.url,
    fetch: (url, init) => fetch(url, init),
    store: { load: async () => saved, save: async (s) => void (saved = s), clear: async () => void (saved = null) },
  })
  const account = new AccountService({
    client,
    licenses: { load: async () => null, save: async () => undefined, clear: async () => undefined },
    machineId: async () => 'wd1-media-booth-0001',
    platform: 'windows',
    appVersion: '1.4.0',
    publicKey: () => server.publicKey,
    configured: () => true,
    encryptionAvailable: () => true,
    openExternal: async () => undefined,
    onChange: () => undefined,
  })
  await account.verifyCode(server.email, FAKE_CODE)
  setServiceAccount({ account, client, machineId: async () => 'wd1-media-booth-0001' })
})

afterAll(async () => {
  setServiceAccount(null)
  await server.stop()
})

beforeEach(() => {
  server.requests.length = 0
  server.aiRemaining = 20_000
  server.aiOutputs = {}
  create.mockReset()
})

const runs = () => server.calls('/ai/run')

describe('through the account', () => {
  it('cleans lyrics with the server task, reads the labels and order, and keeps the wording check', async () => {
    server.aiOutputs.cleanLyrics = 'Verse 1\nAmazing grace how sweet the sound\nThat saved a wretch like me\n\nChorus:\nI once was lost'
    const lyrics = 'Amazing grace how sweet the sound\nThat saved a wretch like me\nI once was lost [G] [D]'
    const result = await runTask('cleanLyrics', { lyrics })
    expect(result).toEqual({
      ok: true,
      value: { lyrics: '[Verse 1]\nAmazing grace how sweet the sound\nThat saved a wretch like me\n\n[Chorus]\nI once was lost', order: ['Verse 1', 'Chorus'] },
    })
    expect(runs()[0].body).toMatchObject({ task: 'cleanLyrics', text: lyrics })
    expect(create).not.toHaveBeenCalled()

    // A changed word is refused as with a developer key.
    server.aiOutputs.cleanLyrics = '[Verse 1]\nAmazing grace how sweet the song'
    expect(await runTask('cleanLyrics', { lyrics })).toMatchObject({ ok: false, error: { code: 'bad_request', message: expect.stringMatching(/changed the wording/) } })
  })

  it('finds scripture with scriptureFallback and keeps only passages that exist', async () => {
    server.aiOutputs.scriptureFallback =
      '{"references": [{"book": "Psalm", "chapter": 23, "verse_start": 1, "verse_end": 3, "confidence": 0.6}, {"book": "John", "chapter": 3, "verse_start": 16, "verse_end": null, "confidence": 0.9}, {"book": "John", "chapter": 99, "verse_start": 1, "verse_end": null, "confidence": 0.8}]}'
    const result = await runTask('findScriptureReferences', { transcript: 'for God so loved the world, and the Lord is my shepherd' })
    expect(result).toEqual({ ok: true, value: { references: ['John 3:16', 'Psalms 23:1-3'] } })
    expect(runs()[0].body).toMatchObject({ task: 'scriptureFallback' })
  })

  it('builds announcements, cleans transcript chunks and writes sermon notes with their server tasks', async () => {
    server.aiOutputs.announcementBuilder = 'Youth Camp Sign Up\nCamp runs 14 to 16 November\nSign up at the welcome desk'
    expect(await runTask('buildAnnouncement', { message: 'Youth camp sign up! Camp runs 14 to 16 November. Sign up at the welcome desk.' })).toEqual({
      ok: true,
      value: { title: 'Youth Camp Sign Up', slides: ['Camp runs 14 to 16 November\nSign up at the welcome desk'] },
    })

    server.aiOutputs.cleanTranscriptChunk = 'So we were talking about the garden gate.'
    expect(await runTask('cleanTranscript', { transcript: 'um so we were uh talking about the garden gate' })).toEqual({
      ok: true,
      value: { transcript: 'So we were talking about the garden gate.' },
    })

    server.aiOutputs.sermonNotes = 'Summary:\nThe gate sticks, so lift it gently.\n\nPoints:\n- The gate sticks in the rain\n- Lift it gently'
    expect(await runTask('sermonNotes', { transcript: 'the garden gate sticks in the rain so you lift it gently' })).toEqual({
      ok: true,
      value: { summary: 'The gate sticks, so lift it gently.', points: ['The gate sticks in the rain', 'Lift it gently'] },
    })
    expect(runs().map((r) => r.body.task)).toEqual(['announcementBuilder', 'cleanTranscriptChunk', 'sermonNotes'])
  })

  it('sends the sermon’s details with notes and the exact-copy wording on a strict cleaning try', async () => {
    server.aiOutputs.sermonNotes = 'Summary:\nPastor Ines Moreau spoke on Saturday.\n\nPoints:\n- Lift the gate gently'
    const sermon = { title: '', preacher: 'Pastor Ines Moreau', series: '', churchName: '', date: '2026-10-31', scriptures: [] }
    expect(await runTask('sermonNotes', { transcript: 'lift the gate gently', sermon })).toMatchObject({ ok: true })
    expect(runs()[0].body).toMatchObject({ options: { sermon: 'Preacher: Pastor Ines Moreau\nDate: Saturday, October 31, 2026' } })

    server.aiOutputs.cleanTranscriptChunk = 'And so we pray.'
    await runTask('cleanTranscript', { transcript: 'and so we pray', strict: true })
    expect(runs()[1].body).toMatchObject({ options: { wording: expect.stringMatching(/^Copy every word exactly, change only punctuation, capitalization and paragraph breaks/) } })
  })

    it('says plainly when the monthly allowance is used up, without the server’s text', async () => {
    server.aiRemaining = 0
    const result = await runTask('cleanTranscript', { transcript: 'and so we pray' })
    expect(result).toEqual({ ok: false, error: { code: 'billing', message: expect.stringMatching(/^This month's AI allowance is used up\. It resets on/) } })
    expect(JSON.stringify(result)).not.toMatch(/server says|src\//)
  })

  it('says a task the server does not offer is not available yet, without asking anyone', async () => {
    const result = await runTask('pickStatements', { transcript: 'Faith is singing before the lights come back on.' })
    expect(result).toEqual({ ok: false, error: { code: 'unavailable', message: 'AI sermon statements is not available through the ServiceEx account yet.' } })
    expect(runs()).toHaveLength(0)
    expect(create).not.toHaveBeenCalled()
  })
})

describe('reading the server’s text', () => {
  it('handles the shapes the model may write', () => {
    expect(lyricsFromText('**[Chorus]**\nHallelujah')).toEqual({ lyrics: '[Chorus]\nHallelujah', order: ['Chorus'] })
    expect(announcementFromText('Title: Prayer Night\n\nFriday at 7\n\nBring a friend')).toEqual({ title: 'Prayer Night', slides: ['Friday at 7', 'Bring a friend'] })
    expect(referencesFromJson('```json\n{"references": []}\n```')).toEqual({ references: [] })
    expect(referencesFromJson('no json here')).toEqual({ references: [] })
    expect(notesFromText('A short paragraph about hope.\n\n1. Hope waits\n2. Hope acts')).toEqual({ summary: 'A short paragraph about hope.', points: ['Hope waits', 'Hope acts'] })
  })
})

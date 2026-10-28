// Cloud listening on the account, against a fake ServiceEx server on this computer: the heartbeat every 30 seconds and
// that it stops once listening stops; a fresh Deepgram token for each reconnect; and, when the hours reach zero, the
// cloud stopped and the offline engine taking over from the last cloud line with nothing lost. The sermon lines are
// invented.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpeechPerformance } from '../../shared/types'
import { AutoEngine, type ModeChange } from '../speech/auto'
import type { DeepgramResult } from '../speech/deepgram'
import { EngineEvents } from '../speech/engine'
import { ServiceClient } from './client'
import { FAKE_CODE, FakeServiceServer } from './fakeServer.test-helper'
import { CUT_MESSAGES, startServiceListening, type CloudCut, type ServiceListening } from './listening'

const MACHINE = 'wd1-sanctuary-desk-0001'
const BPS = 32_000
const server = new FakeServiceServer()
let client: ServiceClient
let service: ServiceListening | null

beforeAll(async () => {
  await server.start()
})

afterAll(async () => {
  await server.stop()
})

beforeEach(async () => {
  server.requests.length = 0
  server.balanceSeconds = 2 * 3600
  server.billPerHeartbeat = null
  server.failWith = null
  let saved: Parameters<ServiceClient['setSession']>[0] | null = null
  client = new ServiceClient({
    baseUrl: () => server.url,
    fetch: (url, init) => fetch(url, init),
    store: { load: async () => saved, save: async (s) => void (saved = s), clear: async () => void (saved = null) },
  })
  const signedIn = await client.request<{ access_token: string; refresh_token: string; expires_in: number }>('POST', '/auth/verify', {
    body: { email: server.email, code: FAKE_CODE },
    auth: false,
  })
  await client.setSession({ accessToken: signedIn.access_token, refreshToken: signedIn.refresh_token, expiresAt: Date.now() + 3600_000, email: server.email })
  server.requests.length = 0
  service = null
})

afterEach(async () => {
  vi.useRealTimers()
  await service?.end()
})

const heartbeats = () => server.calls('/heartbeat')

function open(extra: Partial<Parameters<typeof startServiceListening>[0]> = {}) {
  const cuts: CloudCut[] = []
  const balances: number[] = []
  return {
    cuts,
    balances,
    start: async () => {
      service = await startServiceListening({
        client,
        machineId: MACHINE,
        cloudInUse: () => true,
        onBalance: (seconds) => balances.push(seconds),
        onCut: (cut) => cuts.push(cut),
        ...extra,
      })
      return service
    },
  }
}

describe('the heartbeat', () => {
  it('goes every 30 seconds with the seconds the cloud was in use, and stops once listening stops', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let inUse = true
    const session = open({ cloudInUse: () => inUse })
    const s = await session.start()
    expect(server.calls('/listening/sessions')[0].body).toEqual({ machine_id: MACHINE })

    vi.advanceTimersByTime(30_000)
    await vi.waitFor(() => expect(heartbeats()).toHaveLength(1))
    expect(heartbeats()[0].body).toEqual({ elapsed_seconds: 30 })

    // Offline for the next 30 seconds: nothing is reported as cloud time.
    inUse = false
    vi.advanceTimersByTime(30_000)
    await vi.waitFor(() => expect(heartbeats()).toHaveLength(2))
    expect(heartbeats()[1].body).toEqual({ elapsed_seconds: 0 })
    await vi.waitFor(() => expect(session.balances.at(-1)).toBe(7200 - 30))

    await s.end()
    expect(server.calls('/end')).toHaveLength(1)
    expect(server.sessions.get(s.sessionId)?.status).toBe('closed')

    // Long after Stop: no heartbeat, no further end.
    vi.advanceTimersByTime(10 * 60_000)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(heartbeats()).toHaveLength(2)
    await s.end()
    expect(server.calls('/end')).toHaveLength(1)
  })

  it('stops the cloud when the server cannot be reached for longer than it keeps a session open', async () => {
    let clock = Date.now()
    const session = open({ now: () => clock })
    const s = await session.start()
    server.failWith = { status: 503, code: 'offline' }
    clock += 60_000
    await s.beat()
    expect(session.cuts).toEqual([])
    clock += 40_000
    await s.beat()
    expect(session.cuts).toEqual([{ reason: 'lost', message: CUT_MESSAGES.lost }])
  })
})

describe('tokens', () => {
  it('uses the token from the start for the first connection, then asks the token route for each reconnect', async () => {
    const s = await open().start()
    expect(await s.token()).toBe(`dg-first-${s.sessionId}`)
    const again = await s.token()
    expect(again).toMatch(/^dg-again-/)
    expect(server.calls('/token')).toHaveLength(1)
  })

  it('cannot start without hours, and says so plainly', async () => {
    server.balanceSeconds = 0
    await expect(open().start()).rejects.toMatchObject({ code: 'no_credit', message: expect.stringMatching(/no cloud listening hours left.*offline/) })
  })
})

// ---------- Failover at zero credit, with the Auto engine ----------

class FakeCloud extends EngineEvents {
  lastMessageAt = Date.now()
  token: string | null = null
  aborted = false
  private results = new Set<(r: DeepgramResult) => void>()
  constructor(private readonly auth: () => Promise<string>) {
    super()
  }
  async start() {
    this.token = await this.auth()
    this.lastMessageAt = Date.now()
  }
  async stop() {
    this.emitStatus('idle')
  }
  abort() {
    this.aborted = true
  }
  pushAudio() {}
  onResult(listener: (r: DeepgramResult) => void) {
    this.results.add(listener)
    return () => void this.results.delete(listener)
  }
  final(text: string, start: number, end: number) {
    const parts = text.split(' ')
    const step = (end - start) / parts.length
    const words = parts.map((w, i) => ({ text: w, start: start + i * step, end: start + (i + 1) * step }))
    this.lastMessageAt = Date.now()
    for (const l of this.results) l({ isFinal: true, speechFinal: true, start, end, transcript: text, words })
  }
}

class FakeWhisper extends EngineEvents {
  bytes = 0
  running = false
  async start() {
    this.running = true
  }
  async stop() {
    this.running = false
    this.emitStatus('idle')
  }
  pushAudio(chunk: Uint8Array) {
    if (this.running) this.bytes += chunk.byteLength
  }
  continueFrom() {}
  say(text: string) {
    this.emitFinal(text)
  }
  onPerformance(listener: (p: SpeechPerformance) => void) {
    void listener
    return () => undefined
  }
}

describe('when the hours reach zero', () => {
  it('stops cloud listening cleanly and carries on offline from the last cloud line, with a notice and nothing lost', async () => {
    server.balanceSeconds = 600
    server.billPerHeartbeat = 600
    const clouds: FakeCloud[] = []
    const whispers: FakeWhisper[] = []
    const lines: string[] = []
    const modes: ModeChange[] = []
    let auto: AutoEngine | null = null
    const session = open({ cloudInUse: () => auto?.usingCloud ?? false, onCut: (cut) => auto?.cutCloud(cut.message) })
    const s = await session.start()
    auto = new AutoEngine({
      hasCloudKey: () => s.stopped === null,
      createCloud: () => {
        const cloud = new FakeCloud(() => s.token())
        clouds.push(cloud)
        return cloud
      },
      createLocal: () => {
        const whisper = new FakeWhisper()
        whispers.push(whisper)
        return whisper
      },
      localUnavailable: 'no offline model is downloaded',
      isOnline: () => true,
    })
    auto.onFinal((text) => lines.push(text))
    auto.onMode((change) => modes.push(change))
    await auto.start()
    expect(clouds[0].token).toBe(`dg-first-${s.sessionId}`)
    expect(auto.usingCloud).toBe(true)

    // Six seconds of speech; the cloud writes the first four.
    for (let i = 0; i < 60; i++) auto.pushAudio(new Uint8Array(3200))
    clouds[0].final('Grace and peace to you this morning.', 0.5, 4)

    // The heartbeat uses up the last ten minutes: the server says stop, with no credit.
    await s.beat()
    expect(s.stopped).toEqual({ reason: 'no_credit', message: CUT_MESSAGES.no_credit })
    expect(server.sessions.get(s.sessionId)).toMatchObject({ status: 'closed', reason: 'no_credit' })
    expect(session.balances.at(-1)).toBe(0)
    await vi.waitFor(() => expect(whispers[0]?.running).toBe(true))

    // The cloud connection is dropped; the offline engine got the audio from the end of the last cloud line.
    expect(clouds[0].aborted).toBe(true)
    expect(auto.usingCloud).toBe(false)
    expect(whispers[0].bytes / BPS).toBeCloseTo(2, 1)
    expect(modes.at(-1)).toMatchObject({ mode: 'offline', warning: CUT_MESSAGES.no_credit })
    expect(CUT_MESSAGES.no_credit).toMatch(/carries on offline/)

    whispers[0].say('Let us turn to Psalm twenty three.')
    expect(lines).toEqual(['Grace and peace to you this morning.', 'Let us turn to Psalm twenty three.'])

    // The cloud is not tried again this session, and no more heartbeats go.
    await new Promise((resolve) => setTimeout(resolve, 1100))
    expect(clouds).toHaveLength(1)
    const sent = heartbeats().length
    await s.beat()
    expect(heartbeats()).toHaveLength(sent)
    await auto.stop()
  })
})

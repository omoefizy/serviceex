// The Auto engine's switching, with fake cloud and offline engines on a fake clock. The sermon lines are invented.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpeechPerformance } from '../../shared/types'
import { AutoEngine, reconnectDelay, RETRY_MS, STABLE_MS, type AutoOptions, type ModeChange } from './auto'
import type { DeepgramResult } from './deepgram'
import { EngineEvents, speechError } from './engine'

const BPS = 32_000

class FakeCloud extends EngineEvents {
  bytes = 0
  lastMessageAt = 0
  aborted = false
  private resultListeners = new Set<(r: DeepgramResult) => void>()
  constructor(private readonly fails: false | 'network' | 'auth' = false) {
    super()
  }
  async start() {
    if (this.fails) throw speechError(this.fails, this.fails === 'auth' ? 'Deepgram rejected the API key.' : 'unreachable')
    this.lastMessageAt = Date.now()
  }
  async stop() {
    this.emitStatus('idle')
  }
  abort() {
    this.aborted = true
  }
  pushAudio(chunk: Uint8Array) {
    if (!this.aborted) this.bytes += chunk.byteLength
  }
  onResult(listener: (r: DeepgramResult) => void) {
    this.resultListeners.add(listener)
    return () => void this.resultListeners.delete(listener)
  }
  /** Seconds of audio this connection has received. */
  get heard() {
    return this.bytes / BPS
  }
  send(result: Partial<DeepgramResult>) {
    this.lastMessageAt = Date.now()
    const full: DeepgramResult = { isFinal: false, speechFinal: false, start: 0, end: 0, transcript: '', words: [], ...result }
    for (const l of this.resultListeners) l(full)
  }
  /** A final line spread evenly from `start` to `end` (seconds on this connection). */
  final(text: string, start: number, end: number, speechFinal = true) {
    const parts = text.split(' ')
    const step = (end - start) / parts.length
    const words = parts.map((w, i) => ({ text: w, start: start + i * step, end: start + (i + 1) * step }))
    this.send({ isFinal: true, speechFinal, start, end, transcript: text, words })
  }
  drop() {
    this.emitError(speechError('network', 'Lost the connection.'))
    this.emitStatus('error')
  }
}

class FakeLocal extends EngineEvents {
  bytes = 0
  running = false
  context = ''
  /** Said when stopped: the offline engine finishing the audio it has. */
  tail: string | null = null
  async start() {
    this.running = true
  }
  async stop() {
    await new Promise((resolve) => setTimeout(resolve, 500))
    if (this.tail) this.emitFinal(this.tail)
    this.running = false
    this.emitStatus('idle')
  }
  pushAudio(chunk: Uint8Array) {
    if (this.running) this.bytes += chunk.byteLength
  }
  continueFrom(text: string) {
    this.context = text
  }
  onPerformance(listener: (p: SpeechPerformance) => void) {
    void listener
    return () => undefined
  }
  say(text: string) {
    this.emitFinal(text)
  }
  get heard() {
    return this.bytes / BPS
  }
}

let clouds: FakeCloud[]
let locals: FakeLocal[]
let cloudQueue: FakeCloud[]
let online: boolean
let localAvailable: boolean
let lines: string[]
let modes: ModeChange[]
let engine: AutoEngine

function make(extra: Partial<AutoOptions> = {}) {
  engine = new AutoEngine({
    hasCloudKey: () => true,
    createCloud: () => {
      const cloud = cloudQueue.shift() ?? new FakeCloud()
      clouds.push(cloud)
      return cloud
    },
    createLocal: () => {
      if (!localAvailable) return null
      const local = new FakeLocal()
      locals.push(local)
      return local
    },
    localUnavailable: 'no offline model is downloaded',
    isOnline: () => online,
    ...extra,
  })
  engine.onFinal((text) => lines.push(text))
  engine.onMode((change) => modes.push(change))
}

/** Speaks for `seconds`: 100 ms chunks on the fake clock. `every` runs once a second (results that keep a stream alive). */
async function speak(seconds: number, every?: () => void) {
  for (let i = 1; i <= seconds * 10; i++) {
    engine.pushAudio(new Uint8Array(3200))
    await vi.advanceTimersByTimeAsync(100)
    if (every && i % 10 === 0) every()
  }
}

const modeNames = () => modes.map((m) => m.mode)

beforeEach(() => {
  vi.useFakeTimers()
  clouds = []
  locals = []
  cloudQueue = []
  online = true
  localAvailable = true
  lines = []
  modes = []
  make()
})

/** Stops the engine, running the fake clock so the offline engine can finish. */
async function stopEngine() {
  const stopped = engine.stop()
  await vi.advanceTimersByTimeAsync(1000)
  await stopped
}

afterEach(async () => {
  await stopEngine()
  vi.useRealTimers()
})

describe('AutoEngine', () => {
  it('starts on the cloud when there is a key and a connection', async () => {
    await engine.start()
    await speak(2)
    clouds[0].final('Good morning, church.', 0.2, 1.6)
    expect(modeNames()).toEqual(['cloud'])
    expect(lines).toEqual(['Good morning, church.'])
    expect(clouds[0].heard).toBeCloseTo(2)
  })

  it('starts offline when there is no internet', async () => {
    online = false
    await engine.start()
    expect(modeNames()).toEqual(['offline'])
    expect(modes[0].reason).toMatch(/no internet/)
    expect(clouds).toHaveLength(0)
  })

  it('listens offline when cloud listening is not connected, and never tries the cloud', async () => {
    make({ hasCloudKey: () => false, noKeyReason: 'Cloud listening is not connected yet' })
    await engine.start()
    expect(modes).toEqual([{ mode: 'offline', reason: 'Cloud listening is not connected yet, so transcribing offline on this computer.', warning: null }])
    await speak(40)
    locals[0].say('The lantern supper starts at six in the long hall.')
    expect(lines).toEqual(['The lantern supper starts at six in the long hall.'])
    expect(clouds).toHaveLength(0)
  })

  it('says why instead of starting when cloud listening is not connected and no offline model is downloaded', async () => {
    localAvailable = false
    make({ hasCloudKey: () => false, noKeyReason: 'Cloud listening is not connected yet' })
    await expect(engine.start()).rejects.toMatchObject({ message: 'Cloud listening is not connected yet, and no offline model is downloaded.' })
    expect(clouds).toHaveLength(0)
  })

  it('falls back to offline with the audio since the last cloud line, without repeating or losing words', async () => {
    await engine.start()
    await speak(6, () => clouds[0].send({ transcript: 'interim' }))
    clouds[0].final('Good morning, church.', 0.2, 1.6)
    clouds[0].final('Turn with me to Nehemiah chapter two.', 2.0, 4.0)
    clouds[0].drop()
    await vi.advanceTimersByTimeAsync(0)
    // The offline engine was given the 2 seconds after the last cloud line, then the live audio.
    expect(locals[0].heard).toBeCloseTo(2)
    await speak(1)
    expect(locals[0].heard).toBeCloseTo(3)
    expect(locals[0].context).toBe('Turn with me to Nehemiah chapter two.')
    // Its first line overlaps the cloud's last; the repeated words are dropped.
    locals[0].say('Nehemiah chapter two, verse four.')
    expect(lines).toEqual(['Good morning, church.', 'Turn with me to Nehemiah chapter two.', 'verse four.'])
    expect(modeNames()).toEqual(['cloud', 'reconnecting', 'offline'])
    expect(clouds[0].aborted).toBe(true)
  })

  it('treats 8 seconds without results while audio flows as a lost connection', async () => {
    await engine.start()
    await speak(3, () => clouds[0].send({ transcript: '' }))
    await speak(9)
    expect(modeNames()).toEqual(['cloud', 'reconnecting', 'offline'])
    expect(modes[1].reason).toMatch(/no results for 8 seconds/)
  })

  it('does not count silence (no audio) as a failure', async () => {
    await engine.start()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(modeNames()).toEqual(['cloud'])
  })

  it('retries every 15 seconds and returns to the cloud after 20 stable seconds, at a pause, in order', async () => {
    cloudQueue = [new FakeCloud(), new FakeCloud('network')]
    await engine.start()
    await speak(2, () => clouds[0].send({}))
    clouds[0].final('Good morning, church.', 0.2, 1.6)
    clouds[0].drop()
    await vi.advanceTimersByTimeAsync(0)
    locals[0].say('Please be seated.')

    // First retry fails; the second connects in the background.
    await speak(RETRY_MS / 1000, () => undefined)
    expect(clouds).toHaveLength(2)
    expect(modeNames().at(-1)).toBe('offline')
    await speak(RETRY_MS / 1000)
    expect(clouds).toHaveLength(3)
    const back = clouds[2]

    // While it proves itself, its text is not used.
    await speak(STABLE_MS / 1000, () => back.send({ transcript: 'shadow interim' }))
    back.final('This line belongs to the offline engine.', 1, 3, false)
    expect(lines).not.toContain('This line belongs to the offline engine.')
    expect(modeNames().at(-1)).toBe('offline')

    // At the next pause it hands over: the offline engine finishes, then the cloud's words after that moment follow.
    locals[0].tail = 'and that is where we begin.'
    const cut = back.heard
    back.final('where we begin.', cut - 1.5, cut - 0.2, true)
    await vi.advanceTimersByTimeAsync(0)
    // During the offline engine's last half second, a cloud line arrives that straddles the hand-over.
    back.final('begin. Let us pray.', cut - 0.4, cut + 1.2, true)
    expect(lines.at(-1)).toBe('Please be seated.')
    await vi.advanceTimersByTimeAsync(600)
    // "begin." started before the hand-over (the offline engine wrote it); "Let" starts right at it.
    expect(lines.slice(-3)).toEqual(['Please be seated.', 'and that is where we begin.', 'Let us pray.'])
    expect(lines.filter((l) => l.includes('begin')).length).toBe(1)
    expect(modeNames().at(-1)).toBe('cloud')
    expect(modes.at(-1)!.reason).toMatch(/20 seconds of stable connection/)
  })

  it('warns clearly when the cloud drops and no offline model is downloaded, and reconnects with backoff without losing words', async () => {
    localAvailable = false
    cloudQueue = [new FakeCloud(), new FakeCloud('network'), new FakeCloud('network')]
    await engine.start()
    await speak(4, () => clouds[0].send({}))
    clouds[0].final('Our text today is Psalm twenty three.', 0.5, 3.5)
    clouds[0].drop()
    await vi.advanceTimersByTimeAsync(0)
    expect(modeNames()).toEqual(['cloud', 'reconnecting', 'reconnecting'])
    expect(modes.at(-1)!.warning).toMatch(/no offline model is downloaded, so transcription is paused/)
    expect(modes.at(-1)!.reason).toBe(
      'Lost the connection, and no offline model is downloaded. Reconnecting in 1 s; the audio meanwhile is kept, so no words are lost.',
    )

    // Attempts after 1 s and 2 s more fail; the one 4 s after that connects.
    await speak(1)
    expect(clouds).toHaveLength(2)
    expect(modes.at(-1)!.reason).toMatch(/attempt 1 failed \(unreachable\); trying again in 2 s/)
    await speak(2)
    expect(clouds).toHaveLength(3)
    expect(modes.at(-1)!.reason).toMatch(/trying again in 4 s/)
    await speak(4)
    expect(modes.at(-1)).toMatchObject({ mode: 'cloud', warning: null })
    // It was sent everything from the end of the last line: 0.5 s before the drop and the 7 s since.
    expect(clouds[3].heard).toBeCloseTo(7.5, 0)
  })

  it('keeps everything since the last line through a long gap', async () => {
    localAvailable = false
    online = true
    await engine.start()
    await speak(4, () => clouds[0].send({}))
    clouds[0].final('Let us read together.', 1, 3.5)
    clouds[0].drop()
    online = false
    await speak(40)
    online = true
    await speak(10)
    const resumed = clouds.at(-1)!
    expect(clouds).toHaveLength(2)
    expect(resumed.heard).toBeGreaterThan(40)
    expect(modes.at(-1)!.warning).toBeNull()
  })

  it('backs off 1, 2, 4, 8, then every 10 seconds', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000, 10_000, 10_000, 10_000])
  })

  it('in Cloud only, reconnects instead of going offline and continues without repeating words', async () => {
    make({ cloudOnly: true })
    cloudQueue = [new FakeCloud(), new FakeCloud('network')]
    await engine.start()
    expect(modes[0]).toMatchObject({ mode: 'cloud', reason: expect.stringMatching(/Cloud only/) })
    await speak(3, () => clouds[0].send({}))
    clouds[0].final('Welcome to the evening service.', 0.3, 2.5)
    clouds[0].drop()
    await vi.advanceTimersByTimeAsync(0)
    expect(locals).toHaveLength(0)
    expect(modes.at(-1)).toMatchObject({ mode: 'reconnecting', warning: null })
    await speak(1)
    await speak(2)
    expect(modes.at(-1)).toMatchObject({ mode: 'cloud', reason: 'Reconnected to Deepgram.' })
    // From 2.5 s: half a second before the drop and the 3 s since.
    expect(clouds[2].heard).toBeCloseTo(3.5, 0)
    clouds[2].final('the evening service. Please stand.', 0, 2)
    expect(lines).toEqual(['Welcome to the evening service.', 'Please stand.'])
  })

  it('in Cloud only, fails to start when Deepgram cannot be reached', async () => {
    make({ cloudOnly: true })
    cloudQueue = [new FakeCloud('network')]
    await expect(engine.start()).rejects.toMatchObject({ code: 'network', message: 'unreachable' })
  })

  it('in Cloud only, stops with an error when Deepgram rejects the key on reconnecting', async () => {
    make({ cloudOnly: true })
    const statuses: string[] = []
    engine.onStatus((status) => statuses.push(status))
    cloudQueue = [new FakeCloud(), new FakeCloud('auth')]
    await engine.start()
    await speak(1, () => clouds[0].send({}))
    clouds[0].drop()
    await speak(2)
    expect(statuses.at(-1)).toBe('error')
    expect(clouds).toHaveLength(2)
  })

  it('goes offline and stops retrying when Deepgram rejects the key', async () => {
    cloudQueue = [new FakeCloud('auth')]
    await engine.start()
    expect(modes.at(-1)).toMatchObject({ mode: 'offline', reason: expect.stringMatching(/rejected the API key/) })
    await speak(40)
    expect(clouds).toHaveLength(1)
  })

  it('stops cleanly, letting the engine in use finish its last line', async () => {
    online = false
    await engine.start()
    await speak(2)
    locals[0].tail = 'Amen.'
    await stopEngine()
    expect(lines).toEqual(['Amen.'])
  })

  it('cutCloud: in Cloud only too, hands over to offline from the last cloud line and never tries the cloud again', async () => {
    make({ cloudOnly: true })
    await engine.start()
    await speak(5, () => clouds[0].send({}))
    clouds[0].final('The Lord is my shepherd.', 0.5, 3)
    expect(engine.usingCloud).toBe(true)
    engine.cutCloud('Cloud listening hours ran out, so listening carries on offline on this computer.')
    await vi.advanceTimersByTimeAsync(10)
    expect(clouds[0].aborted).toBe(true)
    expect(engine.usingCloud).toBe(false)
    expect(modes.at(-1)).toMatchObject({ mode: 'offline', warning: 'Cloud listening hours ran out, so listening carries on offline on this computer.' })
    // From the end of the last cloud line: two seconds.
    expect(locals[0].heard).toBeCloseTo(2, 1)
    await speak(60)
    expect(clouds).toHaveLength(1)
    locals[0].say('I shall not want.')
    expect(lines).toEqual(['The Lord is my shepherd.', 'I shall not want.'])
  })

  it('cutCloud while already offline keeps listening offline, with the notice, and stops the background retries', async () => {
    await engine.start()
    clouds[0].drop()
    await vi.advanceTimersByTimeAsync(10)
    expect(modeNames().at(-1)).toBe('offline')
    engine.cutCloud('Lost contact with ServiceEx, so listening carries on offline on this computer.')
    expect(modes.at(-1)).toMatchObject({ mode: 'offline', warning: 'Lost contact with ServiceEx, so listening carries on offline on this computer.' })
    await speak(60)
    expect(clouds).toHaveLength(1)
  })

  it('starts offline with a warning when there are no listening hours', async () => {
    make({ hasCloudKey: () => false, noKeyReason: 'There are no cloud listening hours left', noKeyWarning: 'There are no cloud listening hours left. Listening carries on offline.' })
    await engine.start()
    expect(modes).toEqual([
      { mode: 'offline', reason: 'There are no cloud listening hours left, so transcribing offline on this computer.', warning: 'There are no cloud listening hours left. Listening carries on offline.' },
    ])
    expect(clouds).toHaveLength(0)
  })
})

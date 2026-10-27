// The Auto speech engine: Deepgram in the cloud when it can, whisper.cpp on this computer when it cannot.
//
// Every piece of audio is placed on one timeline (seconds since listening started) and the last ten seconds are
// kept. Deepgram's final results say which stretch of audio they cover, so a switch knows exactly where the text
// so far ends:
//  - Cloud lost (closed, an error, or silent for 8 seconds while audio flows): the offline engine starts with the
//    audio from the end of the last final cloud line (at most 10 seconds back), so nothing is said twice or lost.
//  - While offline the cloud is retried every 15 seconds. A new connection is fed live audio but its text is held
//    back; after 20 seconds of stable connection, at the next pause Deepgram reports, the offline engine finishes
//    the audio up to that moment and the cloud's words from that moment on are let through, in order.
//  - When nothing can transcribe (Cloud only, or no offline model), the cloud is reconnected with backoff (1, 2, 4,
//    8, then every 10 seconds) and all audio since the last line is kept (up to 5 minutes) and sent again.
// Partial text is dropped at a switch (it is spoken again by the engine taking over), and the first line after a
// switch has any words repeated from the line before it removed.

import type { SpeechError, SpeechMode, SpeechPerformance } from '../../shared/types'
import type { DeepgramResult } from './deepgram'
import { EngineEvents, isSpeechError, speechError, type SpeechEngine } from './engine'
import { removeOverlap } from './segmenter'

export interface CloudEngine extends SpeechEngine {
  onResult(listener: (result: DeepgramResult) => void): () => void
  readonly lastMessageAt: number
  abort(): void
}

export interface LocalEngine extends SpeechEngine {
  continueFrom(text: string): void
  onPerformance(listener: (performance: SpeechPerformance) => void): () => void
}

export interface AutoOptions {
  hasCloudKey(): boolean
  /** Why there is no cloud key, such as "Cloud listening is not connected yet"; "No Deepgram key is saved" by default. */
  noKeyReason?: string
  /** A new cloud connection, or null when there is no key. */
  createCloud(): CloudEngine | null
  /** A new offline engine, or null when it cannot run (see localUnavailable). */
  createLocal(): LocalEngine | null
  /** Why the offline engine cannot run, such as "no offline model is downloaded". */
  localUnavailable: string
  isOnline(): boolean
  /** Never use the offline engine: reconnect the cloud instead. */
  cloudOnly?: boolean
}

export interface ModeChange {
  mode: SpeechMode
  /** Why, for the status chip's tooltip. */
  reason: string
  /** Something the operator should know, such as transcription being paused; null clears it. */
  warning: string | null
}

const BYTES_PER_SECOND = 32_000
const BUFFER_SECONDS = 10
export const SILENT_CLOUD_MS = 8000
export const RETRY_MS = 15_000
export const STABLE_MS = 20_000
/** Once the new connection is stable, how long to wait for a pause before switching at the next final result anyway. */
const PAUSE_WAIT_MS = 10_000
/** Audio held for the offline engine while it loads its model. */
const PENDING_MAX_SECONDS = 120
/** Audio kept while nothing transcribes, to send once the cloud is back. */
const GAP_MAX_SECONDS = 300

/** How long to wait before reconnect attempt `attempt` (0 first): 1, 2, 4, 8, then 10 seconds. */
export function reconnectDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 10_000)
}

interface Chunk {
  /** Byte offset on the timeline. */
  at: number
  data: Uint8Array
}

interface ActiveCloud {
  kind: 'cloud'
  engine: CloudEngine
  /** Timeline seconds where this connection's audio starts. */
  offset: number
  /** Words before this time belong to the offline engine that handed over; null when none did. */
  cutoff: number | null
  /** Finals waiting while the offline engine finishes, so lines stay in order. */
  held: string[] | null
  detach: () => void
}

interface ActiveLocal {
  kind: 'local'
  engine: LocalEngine
  ready: boolean
  pending: Uint8Array[]
  detach: () => void
}

interface Shadow {
  engine: CloudEngine
  offset: number
  openedAt: number
  armedAt: number | null
  detach: () => void
}

export class AutoEngine extends EngineEvents implements SpeechEngine {
  private active: ActiveCloud | ActiveLocal | null = null
  private shadow: Shadow | null = null
  private received = 0
  private ring: Chunk[] = []
  private lastAudioAt = 0
  /** Timeline seconds where the last final cloud line ended; null when the offline engine wrote the last line. */
  private lastFinalEnd: number | null = 0
  private lastText = ''
  private dedupeNext = false
  private stopped = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private watchdog: ReturnType<typeof setInterval> | null = null
  private modeListeners = new Set<(change: ModeChange) => void>()
  private performanceListeners = new Set<(performance: SpeechPerformance) => void>()
  /** Why the offline engine cannot run, once it has been tried. */
  private localProblem: string
  /** Deepgram refused the key: retrying cannot help, so the cloud is not tried again this session. */
  private keyRejected = false
  /** Why the last cloud connection failed to open. */
  private cloudError: SpeechError | null = null
  /** Timeline seconds where untranscribed audio starts while nothing transcribes; kept until an engine takes over. */
  private gapStart: number | null = null
  /** Reconnect attempts since nothing could transcribe, for the backoff. */
  private attempt = 0
  /** Why nothing transcribes, and the warning shown meanwhile. */
  private pause: { why: string; warning: string | null } | null = null

  constructor(private readonly options: AutoOptions) {
    super()
    this.localProblem = options.localUnavailable
  }

  onMode(listener: (change: ModeChange) => void) {
    this.modeListeners.add(listener)
    return () => void this.modeListeners.delete(listener)
  }

  onPerformance(listener: (performance: SpeechPerformance) => void) {
    this.performanceListeners.add(listener)
    return () => void this.performanceListeners.delete(listener)
  }

  async start(): Promise<void> {
    this.emitStatus('connecting')
    const hasKey = this.options.hasCloudKey()
    const online = this.options.isOnline()
    const cloud = hasKey && online ? this.options.createCloud() : null
    if (cloud && (await this.useCloud(cloud, 0))) {
      this.setMode('cloud', this.options.cloudOnly ? 'Cloud only (Deepgram), as set in Settings.' : 'Transcribing with Deepgram in the cloud.')
    } else if (this.options.cloudOnly) {
      throw this.cloudError ?? speechError('network', online ? 'Could not reach Deepgram.' : 'There is no internet connection.')
    } else {
      const why = !hasKey
        ? (this.options.noKeyReason ?? 'No Deepgram key is saved')
        : !online
          ? 'There is no internet connection'
          : this.keyRejected
            ? 'Deepgram rejected the API key'
            : 'Deepgram could not be reached'
      if (!(await this.useLocal(0, `${why}, so transcribing offline on this computer.`))) {
        if (!hasKey || this.keyRejected) throw speechError('engine', `${why}, and ${this.localProblem}.`)
        this.enterPause(`${why}, and ${this.localProblem}`)
      }
    }
    this.watchdog = setInterval(() => this.check(), 1000)
    this.scheduleRetry()
    this.emitStatus('listening')
  }

  pushAudio(chunk: Uint8Array): void {
    if (this.stopped) return
    const data = chunk.slice()
    this.ring.push({ at: this.received, data })
    this.received += data.byteLength
    // Ten seconds normally; everything since the gap began while nothing transcribes.
    const keepFrom =
      this.gapStart === null
        ? this.received - BUFFER_SECONDS * BYTES_PER_SECOND
        : Math.max(this.gapStart * BYTES_PER_SECOND, this.received - GAP_MAX_SECONDS * BYTES_PER_SECOND)
    while (this.ring.length > 0 && this.ring[0].at + this.ring[0].data.byteLength < keepFrom) {
      this.ring.shift()
    }
    this.lastAudioAt = Date.now()
    const active = this.active
    if (active?.kind === 'cloud') active.engine.pushAudio(data)
    else if (active?.kind === 'local') {
      if (active.ready) active.engine.pushAudio(data)
      else if (active.pending.length < (PENDING_MAX_SECONDS * BYTES_PER_SECOND) / Math.max(1, data.byteLength)) active.pending.push(data)
    }
    this.shadow?.engine.pushAudio(data)
  }

  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.watchdog) clearInterval(this.watchdog)
    this.dropShadow()
    this.emitStatus('stopping')
    const active = this.active
    // Let the engine in use finish what it heard; its last lines still come through.
    await active?.engine.stop().catch(() => undefined)
    if (active?.kind === 'cloud' && active.held) this.releaseHeld(active)
    active?.detach()
    this.active = null
    this.emitStatus('idle')
  }

  /** Ends at once, dropping whatever the engine in use has not written yet. */
  abort(): void {
    if (this.stopped) return
    this.stopped = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.watchdog) clearInterval(this.watchdog)
    this.dropShadow()
    const active = this.active
    this.active = null
    active?.detach()
    if (active?.engine.abort) active.engine.abort()
    else void active?.engine.stop().catch(() => undefined)
    this.emitStatus('idle')
  }

  // ---------- Timeline ----------

  private now(): number {
    return this.received / BYTES_PER_SECOND
  }

  /** The buffered audio from `seconds` on (or from the oldest kept, if that is later). */
  private audioFrom(seconds: number): { from: number; chunks: Uint8Array[] } {
    let byte = Math.max(0, Math.round(seconds * BYTES_PER_SECOND))
    byte -= byte % 2
    const oldest = this.ring[0]?.at ?? this.received
    if (byte < oldest) byte = oldest
    const chunks: Uint8Array[] = []
    for (const c of this.ring) {
      const end = c.at + c.data.byteLength
      if (end <= byte) continue
      chunks.push(c.at >= byte ? c.data : c.data.subarray(byte - c.at))
    }
    return { from: byte / BYTES_PER_SECOND, chunks }
  }

  /** Where the next engine should start reading: where the gap began, the end of the last cloud line, or ten seconds back. */
  private resumePoint(): number {
    return this.gapStart ?? this.lastFinalEnd ?? this.now() - BUFFER_SECONDS
  }

  // ---------- Text out ----------

  private final(text: string) {
    if (this.dedupeNext && this.lastText) text = removeOverlap(this.lastText, text)
    this.dedupeNext = false
    if (!text) return
    this.lastText = text
    this.emitFinal(text)
  }

  private setMode(mode: SpeechMode, reason: string, warning: string | null = null) {
    for (const listener of this.modeListeners) listener({ mode, reason, warning })
  }

  // ---------- Cloud ----------

  /** Connects a cloud engine and makes it the one in use, reading the timeline from `resumeFrom`. */
  private async useCloud(engine: CloudEngine, resumeFrom: number): Promise<boolean> {
    try {
      await engine.start()
    } catch (error) {
      this.cloudError = isSpeechError(error) ? error : speechError('network', String(error))
      if (this.cloudError.code === 'auth') this.keyRejected = true
      return false
    }
    if (this.stopped) {
      engine.abort()
      return false
    }
    const { from, chunks } = this.audioFrom(resumeFrom)
    this.gapStart = null
    const active: ActiveCloud = { kind: 'cloud', engine, offset: from, cutoff: null, held: null, detach: () => undefined }
    active.detach = this.watchCloud(active)
    this.active = active
    for (const chunk of chunks) engine.pushAudio(chunk)
    return true
  }

  private watchCloud(active: ActiveCloud): () => void {
    const offs = [
      active.engine.onResult((result) => this.cloudResult(active, result)),
      active.engine.onError((error) => this.cloudLost(active, error.message)),
      active.engine.onStatus((status) => {
        if (status === 'error' || status === 'idle') this.cloudLost(active, 'The cloud connection closed.')
      }),
    ]
    return () => offs.forEach((off) => off())
  }

  private cloudResult(active: ActiveCloud, result: DeepgramResult) {
    if (this.active !== active) return
    if (!result.isFinal) {
      if (!active.held) this.emitPartial(result.transcript)
      return
    }
    let text = result.transcript
    if (active.cutoff !== null && result.words.length > 0) {
      // Words before the hand-over were the offline engine's to write.
      const kept = result.words.filter((w) => active.offset + w.start >= active.cutoff! - 0.05)
      if (kept.length < result.words.length) text = kept.map((w) => w.text).join(' ')
    }
    this.lastFinalEnd = Math.max(this.lastFinalEnd ?? 0, active.offset + result.end)
    if (!text) {
      if (!active.held) this.emitPartial('')
      return
    }
    if (active.held) active.held.push(text)
    else this.final(text)
  }

  private cloudLost(active: ActiveCloud, why: string) {
    if (this.stopped || this.active !== active) return
    active.detach()
    active.engine.abort()
    this.active = null
    this.emitPartial('')
    this.dedupeNext = true
    // Keep the audio from here until an engine takes over.
    this.gapStart = this.resumePoint()
    if (this.options.cloudOnly) {
      this.enterPause(why.replace(/\.$/, ''))
      return
    }
    this.setMode('reconnecting', `${why} Starting the offline engine.`)
    void this.useLocal(this.gapStart, `${why} Transcribing offline; retrying the cloud every 15 seconds.`).then((ok) => {
      if (!ok && !this.stopped) this.enterPause(`${why.replace(/\.$/, '')}, and ${this.localProblem}`)
      else this.scheduleRetry()
    })
  }

  /** Nothing can transcribe: keep the audio since the last line and reconnect the cloud with backoff. */
  private enterPause(why: string) {
    this.active = null
    if (this.gapStart === null) this.gapStart = this.resumePoint()
    if (this.keyRejected || !this.options.hasCloudKey()) return this.fail(`${why}.`)
    this.attempt = 0
    this.pause = {
      why,
      warning: this.options.cloudOnly
        ? null
        : `${why}, so transcription is paused. It resumes when the cloud is back; download an offline model in Settings to keep going without the internet.`,
    }
    this.setMode('reconnecting', `${why}. Reconnecting in ${reconnectDelay(0) / 1000} s; the audio meanwhile is kept, so no words are lost.`, this.pause.warning)
    this.scheduleRetry()
  }

  /** Nothing can transcribe and retrying cannot help. */
  private fail(message: string) {
    this.active = null
    const error = speechError(this.keyRejected ? 'auth' : 'engine', message)
    // Stopped first, so the last status is the error.
    void this.stop().then(() => {
      this.emitError(error)
      this.emitStatus('error')
    })
  }

  private scheduleRetry() {
    if (this.stopped || this.retryTimer || this.active?.kind === 'cloud' || this.shadow || !this.options.hasCloudKey() || this.keyRejected) return
    // In the background every 15 seconds while offline works; with backoff while nothing transcribes.
    const delay = this.active ? RETRY_MS : reconnectDelay(this.attempt++)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.retryCloud()
    }, delay)
  }

  /** A reconnect attempt failed while nothing transcribes: say so (it shows in the event log) and try again. */
  private retryFailed(problem: string) {
    const pause = this.pause
    if (this.keyRejected) return this.fail('Deepgram rejected the API key.')
    this.scheduleRetry()
    if (pause && !this.active) {
      const next = reconnectDelay(this.attempt - 1) / 1000
      this.setMode('reconnecting', `${pause.why}. Reconnect attempt ${this.attempt - 1} failed (${problem}); trying again in ${next} s.`, pause.warning)
    }
  }

  private async retryCloud() {
    if (this.stopped || this.active?.kind === 'cloud' || this.shadow) return
    const cloud = this.options.isOnline() ? this.options.createCloud() : null
    if (!cloud) {
      // No network yet: try again later.
      if (this.active) this.scheduleRetry()
      else this.retryFailed('no internet connection')
      return
    }
    if (!this.active) {
      // Nothing else is transcribing, so use the cloud straight away, from where the text stopped.
      const resume = this.resumePoint()
      const missed = resume < (this.ring[0]?.at ?? 0) / BYTES_PER_SECOND - 0.05
      if (await this.useCloud(cloud, resume)) {
        this.dedupeNext = true
        this.pause = null
        this.attempt = 0
        this.setMode(
          'cloud',
          this.options.cloudOnly ? 'Reconnected to Deepgram.' : 'The cloud connection is back.',
          missed ? 'Some words were missed while the connection was down.' : null,
        )
      } else this.retryFailed(this.cloudError?.message.replace(/\.$/, '') ?? 'no answer')
      return
    }
    // Offline is working: connect in the background and switch only once the connection has proved stable.
    try {
      await cloud.start()
    } catch (error) {
      if (isSpeechError(error) && error.code === 'auth') this.keyRejected = true
      this.scheduleRetry()
      return
    }
    if (this.stopped || this.active?.kind !== 'local') {
      cloud.abort()
      return
    }
    const shadow: Shadow = { engine: cloud, offset: this.now(), openedAt: Date.now(), armedAt: null, detach: () => undefined }
    const offs = [
      cloud.onResult((result) => this.shadowResult(shadow, result)),
      cloud.onError(() => this.shadowLost(shadow)),
      cloud.onStatus((status) => (status === 'error' || status === 'idle') && this.shadowLost(shadow)),
    ]
    shadow.detach = () => offs.forEach((off) => off())
    this.shadow = shadow
  }

  private shadowResult(shadow: Shadow, result: DeepgramResult) {
    if (this.shadow !== shadow) return
    const now = Date.now()
    if (shadow.armedAt === null && now - shadow.openedAt >= STABLE_MS) shadow.armedAt = now
    if (shadow.armedAt !== null && result.isFinal && (result.speechFinal || now - shadow.armedAt >= PAUSE_WAIT_MS)) {
      void this.handOver(shadow)
    }
  }

  private shadowLost(shadow: Shadow) {
    if (this.shadow !== shadow) return
    this.dropShadow()
    this.scheduleRetry()
  }

  private dropShadow() {
    const shadow = this.shadow
    if (!shadow) return
    this.shadow = null
    shadow.detach()
    shadow.engine.abort()
  }

  /** Offline to cloud, at a pause: the offline engine finishes the audio up to now, the cloud takes the rest. */
  private async handOver(shadow: Shadow) {
    const local = this.active
    if (local?.kind !== 'local') return
    this.shadow = null
    shadow.detach()
    const cloud: ActiveCloud = { kind: 'cloud', engine: shadow.engine, offset: shadow.offset, cutoff: this.now(), held: [], detach: () => undefined }
    cloud.detach = this.watchCloud(cloud)
    this.active = cloud
    await local.engine.stop().catch(() => undefined)
    local.detach()
    this.dedupeNext = true
    this.releaseHeld(cloud)
    this.setMode('cloud', 'Back on Deepgram after 20 seconds of stable connection.')
  }

  private releaseHeld(cloud: ActiveCloud) {
    const held = cloud.held ?? []
    cloud.held = null
    for (const text of held) this.final(text)
  }

  // ---------- Offline ----------

  /** Starts the offline engine reading the timeline from `resumeFrom`. False when it cannot run. */
  private async useLocal(resumeFrom: number, reason: string): Promise<boolean> {
    const engine = this.options.createLocal()
    if (!engine) return false
    const active: ActiveLocal = { kind: 'local', engine, ready: false, pending: this.audioFrom(resumeFrom).chunks, detach: () => undefined }
    engine.continueFrom(this.lastText)
    const offs = [
      engine.onFinal((text) => this.final(text)),
      engine.onPerformance((p) => this.performanceListeners.forEach((l) => l(p))),
      engine.onError((error) => this.localLost(active, error.message)),
      engine.onStatus((status) => status === 'error' && this.localLost(active, 'it stopped')),
    ]
    active.detach = () => offs.forEach((off) => off())
    this.active = active
    try {
      await engine.start()
    } catch (error) {
      active.detach()
      if (this.active === active) this.active = null
      if (this.stopped) return true
      this.localProblem = `the offline engine could not start (${error instanceof Error ? error.message : ((error as { message?: string }).message ?? String(error))})`
      return false
    }
    if (this.stopped || this.active !== active) {
      await engine.stop()
      return true
    }
    active.ready = true
    for (const chunk of active.pending) engine.pushAudio(chunk)
    active.pending = []
    this.lastFinalEnd = null
    this.gapStart = null
    this.pause = null
    this.setMode('offline', reason)
    return true
  }

  private localLost(active: ActiveLocal, why: string) {
    if (this.stopped || this.active !== active) return
    active.detach()
    void active.engine.stop().catch(() => undefined)
    this.dedupeNext = true
    // Nothing else can transcribe without a key; with one, the cloud is reconnected.
    this.enterPause(`The offline engine stopped (${why})`)
  }

  // ---------- Watchdog ----------

  /** Once a second: a cloud stream that has gone quiet while audio flows has failed. */
  private check() {
    const now = Date.now()
    const audioFlowing = now - this.lastAudioAt < 1500
    const active = this.active
    if (active?.kind === 'cloud' && !active.held && audioFlowing && now - active.engine.lastMessageAt > SILENT_CLOUD_MS) {
      this.cloudLost(active, 'Deepgram sent no results for 8 seconds.')
    }
    const shadow = this.shadow
    if (shadow && audioFlowing && now - shadow.engine.lastMessageAt > SILENT_CLOUD_MS) this.shadowLost(shadow)
  }
}

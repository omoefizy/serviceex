// Offline speech-to-text with whisper.cpp. Its whisper-server runs as a child process on 127.0.0.1 with the model
// loaded once; segments cut by the Segmenter are posted to it one at a time as WAV files. The main process only
// buffers audio and waits on HTTP, so it never blocks. Each transcribed segment is emitted as a final result.

import { app } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { SpeechPerformance, WhisperModelId } from '../../shared/types'
import { EngineEvents, speechError, type SpeechEngine } from './engine'
import { cleanTranscript, removeOverlap, Segmenter, toWav, type AudioSegment } from './segmenter'
import { smallerModel } from './whisperModels'

/** electron-builder's ${os} names, matching scripts/fetch-whisper.ts. */
const OS_NAMES: Partial<Record<NodeJS.Platform, string>> = { darwin: 'mac', win32: 'win', linux: 'linux' }
const execFileAsync = promisify(execFile)
const LOAD_TIMEOUT_MS = 120_000
/** Audio measured before the first verdict on speed. */
const MEASURE_AFTER_MS = 15_000
/** Above this the engine is not keeping up; the margin allows for pauses being shorter than processing. */
const KEEPING_UP_BELOW = 0.8
/** Speech waiting this long also counts as falling behind. */
const MAX_BACKLOG_MS = 12_000
const STOP_DRAIN_MS = 20_000

/** Servers still running, stopped however the app ends. */
const children = new Set<ChildProcess>()
const killAll = () => {
  for (const child of children) child.kill('SIGKILL')
  children.clear()
}
process.on('exit', killAll)
app.on('will-quit', killAll)
// Ended from outside (a terminal, a dev server restart, logging out): stop the servers, then quit as usual.
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.once(signal, () => {
    killAll()
    app.quit()
    setTimeout(() => process.exit(0), 2000).unref()
  })
}

/**
 * Process ids of running servers, kept on disk so that a server left behind when the app was killed outright
 * (which no handler can catch) is stopped the next time listening starts.
 */
const pidFile = () => path.join(app.getPath('userData'), 'whisper-server.pids')

async function recordPids(): Promise<void> {
  await writeFile(pidFile(), JSON.stringify([...children].map((c) => c.pid).filter(Boolean))).catch(console.error)
}

/** The name of a running process, or null when there is none with that id. */
async function processName(pid: number): Promise<string | null> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true })
      return stdout.split(',')[0]?.replace(/"/g, '').trim() || null
    }
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'comm='])
    return stdout.trim() || null
  } catch {
    return null
  }
}

/** Stops servers a previous run left behind, checking each id still belongs to whisper-server first. */
async function stopLeftoverServers(): Promise<void> {
  let pids: unknown
  try {
    pids = JSON.parse(await readFile(pidFile(), 'utf8'))
  } catch {
    return
  }
  if (!Array.isArray(pids)) return
  for (const pid of pids) {
    if (!Number.isInteger(pid) || [...children].some((c) => c.pid === pid)) continue
    if ((await processName(pid))?.includes('whisper-server')) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }
  }
}

/** Where whisper-server is: next to the app's resources when packaged, in vendor/ during development. */
export function whisperServerPath(): string | null {
  const name = process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server'
  const folder = app.isPackaged
    ? path.join(process.resourcesPath, 'whisper')
    : path.join(app.getAppPath(), 'vendor', 'whisper', `${OS_NAMES[process.platform]}-${process.arch}`)
  const file = path.join(folder, name)
  return existsSync(file) ? file : null
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      probe.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('No free port'))))
    })
  })
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class WhisperEngine extends EngineEvents implements SpeechEngine {
  private child: ChildProcess | null = null
  private baseUrl = ''
  private segmenter = new Segmenter((segment) => this.enqueue(segment))
  private queue: AudioSegment[] = []
  private working = false
  private running = false
  private stopping = false
  /** The last text emitted, for continuity (prompt) and for removing repeated overlap. */
  private lastText = ''
  private stderrTail: string[] = []
  private measured = { audioMs: 0, processMs: 0, reported: false, lastReportAt: 0 }
  private performanceListeners = new Set<(performance: SpeechPerformance) => void>()

  constructor(
    private readonly binary: string,
    private readonly modelFile: string,
    private readonly model: WhisperModelId,
  ) {
    super()
  }

  /** Carries on from text another engine wrote, for the prompt and for trimming repeated words. */
  continueFrom(text: string) {
    this.lastText = text
  }

  /** How fast it transcribes compared with speech: first after 15 seconds of audio, then every 30 seconds. */
  onPerformance(listener: (performance: SpeechPerformance) => void) {
    this.performanceListeners.add(listener)
    return () => void this.performanceListeners.delete(listener)
  }

  async start(): Promise<void> {
    if (this.child) throw speechError('busy', 'Already listening.')
    this.emitStatus('connecting')
    await stopLeftoverServers()
    const port = await freePort()
    // Half the cores (at least two, at most eight): whisper.cpp gains little from efficiency cores or hyperthreads.
    const threads = Math.min(8, Math.max(2, Math.floor(os.cpus().length / 2)))
    const args = ['-m', this.modelFile, '--host', '127.0.0.1', '--port', String(port), '-t', String(threads), '-l', 'en', '-sns']
    const child = spawn(this.binary, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    this.child = child
    children.add(child)
    void recordPids()
    this.baseUrl = `http://127.0.0.1:${port}`
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (text: string) => {
      this.stderrTail = [...this.stderrTail, ...text.split('\n').filter(Boolean)].slice(-12)
    })
    let exited = false
    child.once('exit', (code) => {
      exited = true
      children.delete(child)
      void recordPids()
      this.child = null
      if (this.running && !this.stopping) {
        this.running = false
        this.emitError(speechError('engine', `The offline engine stopped unexpectedly (exit code ${code}).`))
        this.emitStatus('error')
      }
    })
    child.once('error', (error) => {
      exited = true
      this.stderrTail.push(error.message)
    })

    // Wait until the model has loaded and the server answers.
    const deadline = Date.now() + LOAD_TIMEOUT_MS
    while (Date.now() < deadline && !exited) {
      if (this.stopping) break
      try {
        const health = await fetch(`${this.baseUrl}/health`)
        if (health.ok) break
      } catch {
        // Not listening yet.
      }
      await wait(200)
    }
    if (this.stopping) {
      this.kill()
      this.emitStatus('idle')
      return
    }
    if (exited || Date.now() >= deadline) {
      this.kill()
      this.emitStatus('error')
      const detail = this.stderrTail.find((line) => /error|failed|invalid/i.test(line)) ?? this.stderrTail.at(-1)
      throw speechError('engine', `The offline engine could not start${detail ? `: ${detail.trim()}` : '.'}`)
    }
    this.running = true
    this.emitStatus('listening')
  }

  pushAudio(chunk: Uint8Array): void {
    if (!this.running || this.stopping) return
    // Copy into an aligned buffer: IPC data may start at any byte offset.
    const samples = new Int16Array(chunk.byteLength >> 1)
    new Uint8Array(samples.buffer).set(chunk.subarray(0, samples.byteLength))
    this.segmenter.push(samples)
  }

  async stop(): Promise<void> {
    if (this.stopping) return
    this.stopping = true
    if (!this.running) return
    this.emitStatus('stopping')
    // Transcribe what was still being said, then let the queue finish (within reason).
    this.segmenter.flush()
    const deadline = Date.now() + STOP_DRAIN_MS
    while ((this.working || this.queue.length > 0) && Date.now() < deadline) await wait(100)
    this.running = false
    this.kill()
    this.emitStatus('idle')
  }

  private kill() {
    // SIGKILL rather than SIGTERM: on SIGTERM whisper-server exits through ggml's Metal teardown, which aborts and
    // leaves a crash report. The server keeps nothing worth flushing.
    this.child?.kill('SIGKILL')
    this.child = null
  }

  private enqueue(segment: AudioSegment) {
    this.queue.push(segment)
    // A hint that words are on their way; the final text replaces it.
    this.emitPartial('…')
    if (!this.working) void this.work()
  }

  private async work() {
    this.working = true
    while (this.queue.length > 0 && this.child) {
      const segment = this.queue.shift()!
      const started = performance.now()
      try {
        const text = await this.transcribe(segment)
        if (text) {
          this.lastText = text
          this.emitFinal(text)
        } else if (this.queue.length === 0) {
          this.emitPartial('')
        }
      } catch (error) {
        if (!this.child) break
        this.emitError(speechError('engine', `A segment could not be transcribed: ${error instanceof Error ? error.message : error}`))
      }
      this.measure(segment.durationMs, performance.now() - started)
    }
    this.working = false
  }

  private async transcribe(segment: AudioSegment): Promise<string> {
    const form = new FormData()
    form.append('file', new Blob([toArrayBuffer(segment)], { type: 'audio/wav' }), 'segment.wav')
    form.append('response_format', 'json')
    form.append('temperature', '0.0')
    form.append('temperature_inc', '0.2')
    // The previous sentence helps with continuity, names and punctuation.
    if (this.lastText) form.append('prompt', this.lastText.slice(-200))
    const response = await fetch(`${this.baseUrl}/inference`, { method: 'POST', body: form })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = (await response.json()) as { text?: string; error?: string }
    if (body.error) throw new Error(body.error)
    let text = cleanTranscript(body.text ?? '')
    if (segment.overlapHadSpeech && this.lastText) text = removeOverlap(this.lastText, text)
    return text
  }

  private measure(audioMs: number, processMs: number) {
    const m = this.measured
    m.audioMs += audioMs
    m.processMs += processMs
    const now = Date.now()
    const due = m.reported ? now - m.lastReportAt >= 30_000 : m.audioMs >= MEASURE_AFTER_MS
    if (!due) return
    m.reported = true
    m.lastReportAt = now
    const realTimeFactor = m.processMs / m.audioMs
    const backlogMs = this.queue.reduce((sum, s) => sum + s.durationMs, 0)
    const keepingUp = realTimeFactor < KEEPING_UP_BELOW && backlogMs < MAX_BACKLOG_MS
    const performance: SpeechPerformance = {
      model: this.model,
      realTimeFactor: Math.round(realTimeFactor * 100) / 100,
      keepingUp,
      backlogSeconds: Math.round(backlogMs / 1000),
      suggestion: keepingUp ? null : smallerModel(this.model),
    }
    for (const listener of this.performanceListeners) listener(performance)
  }
}

function toArrayBuffer(segment: AudioSegment): ArrayBuffer {
  const wav = toWav(segment.pcm)
  return wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer
}


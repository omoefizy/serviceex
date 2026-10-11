import { app, ipcMain, net, powerSaveBlocker, systemPreferences, type WebContents } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { SpeechEvent, SpeechKeyStatus, SpeechMode, SpeechPerformance, SpeechResult, WhisperProgress, WhisperStatus } from '../../shared/types'
import { getAppSettings, setAppSettings } from '../db/settings'
import { clearSecret, encryptionAvailable, hasSecret, readSecret, saveSecret } from '../secrets'
import { checkDeepgramKey, DEEPGRAM_MODEL, DeepgramEngine } from '../speech/deepgram'
import { AutoEngine, reconnectDelay } from '../speech/auto'
import { isSpeechError, speechError, type SpeechEngine } from '../speech/engine'
import { WhisperEngine, whisperServerPath } from '../speech/whisper'
import {
  cancelDownload,
  deleteModel,
  downloadModel,
  isDownloaded,
  isWhisperModelId,
  modelInfos,
  modelPath,
  modelsFolder,
  recommendModel,
  WHISPER_MODELS,
} from '../speech/whisperModels'

/** No audio from the window for this long means capture has stopped. Doubled after each restart that brings none. */
const NO_AUDIO_MS = 5000
const NO_AUDIO_MAX_MS = 60_000
/** No transcript for this long while there is sound means the engine has stalled. Doubled after each restart that does not help. */
const NO_TEXT_MS = 30_000
const NO_TEXT_MAX_MS = 5 * 60_000
/** Seconds of sound (not silence) since the last transcript before the engine counts as stalled. */
const SOUND_NEEDED_SECONDS = 15
/** 100 ms of audio with an RMS level above -40 dBFS counts as sound rather than a quiet room. */
const SOUND_RMS = 0.01 * 32_768
/** Audio held while the engine restarts: two minutes of 100 ms chunks. */
const HELD_MAX_CHUNKS = 1200
/** Audio since the last line, given again to an engine that replaces a stalled one: up to a minute. */
const RECENT_MAX_CHUNKS = 600
/** How long a stalled engine gets to finish its last lines before it is replaced anyway. */
const RETIRE_TIMEOUT_MS = 6000

/** One listening session, from Start to Stop. It outlives its engine, which the watchdog may replace. */
interface Session {
  sender: WebContents
  send(message: SpeechEvent): void
  /** A new engine for this session, and the mode to report once it is listening (for single-engine modes). */
  build(session: Session): { engine: SpeechEngine; mode: Extract<SpeechEvent, { type: 'mode' }> | null }
  save: ((line: string) => void) | null
  engine: SpeechEngine | null
  /** The engine being replaced, which may still send its last lines. */
  retiring: SpeechEngine | null
  /** Audio that arrived while the engine restarts, for the new one; null otherwise. */
  held: Uint8Array[] | null
  /** Audio since the last line, which a stalled engine never wrote. */
  recent: Uint8Array[]
  restarting: boolean
  lastAudioAt: number
  lastTextAt: number
  /** Seconds of sound since the last transcript. */
  soundSeconds: number
  /** Restarts in a row that brought back no audio, and no transcript, which lengthen the wait before the next. */
  audioRestarts: number
  textRestarts: number
  mode: SpeechMode | null
  /** The offline engine reports it is falling behind, so slow text is expected. */
  behind: boolean
  /** The microphone track is quiet and the window sends silence in its place; that time does not count as stalled. */
  muted: boolean
  /** When the watchdog last ran, to discount muted time. */
  checkedAt: number
  watchdog: ReturnType<typeof setInterval> | null
  /** Keeps the computer from suspending the app while listening. */
  blocker: number
}

/** The session listening, if any. One at a time. */
let session: Session | null = null

const transcriptsFolder = () => path.join(app.getPath('userData'), 'transcripts')

/** What stops the chosen engine from starting, or null when it is ready. */
/** Why the offline engine cannot run, or null when it can. */
function offlineProblem(): string | null {
  const { whisperModel } = getAppSettings()
  if (!whisperServerPath()) return 'The offline engine is not included in this build.'
  const label = WHISPER_MODELS.find((m) => m.id === whisperModel)?.label ?? whisperModel
  return isDownloaded(whisperModel) ? null : `Download the ${label} model in Settings first.`
}

function notReadyReason(): string | null {
  const { speechEngine } = getAppSettings()
  const hasKey = hasSecret('deepgram-key')
  if (speechEngine === 'deepgram') return hasKey ? null : 'Add a Deepgram API key in Settings first.'
  if (speechEngine === 'whisper') return offlineProblem()
  // Auto needs at least one of the two.
  return hasKey || !offlineProblem() ? null : 'Add a Deepgram API key or download an offline model in Settings first.'
}

function status(): SpeechKeyStatus {
  const reason = notReadyReason()
  return {
    ready: reason === null,
    readyHint: reason,
    hasKey: hasSecret('deepgram-key'),
    encryptionAvailable: encryptionAvailable(),
    transcriptsFolder: transcriptsFolder(),
  }
}

function whisperStatus(): WhisperStatus {
  const recommended = recommendModel()
  return {
    engineInstalled: whisperServerPath() !== null,
    models: modelInfos(),
    recommended: recommended.id,
    recommendedReason: recommended.reason,
    systemSummary: recommended.summary,
    folder: modelsFolder(),
  }
}

const failed = (error: unknown): SpeechResult<never> => ({
  ok: false,
  error: isSpeechError(error) ? error : speechError('engine', error instanceof Error ? error.message : String(error)),
})

/** A file for this session's transcript, such as transcripts/2026-10-11 10-30.txt. Lines are appended in order. */
async function transcriptWriter(): Promise<(line: string) => void> {
  const folder = transcriptsFolder()
  await mkdir(folder, { recursive: true })
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const name = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}.txt`
  const file = path.join(folder, name)
  let chain = Promise.resolve()
  return (line) => {
    chain = chain.then(() => appendFile(file, `${line}\n`)).catch(console.error)
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The RMS level of 16-bit PCM. */
function rms(pcm: Uint8Array): number {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const samples = pcm.byteLength >> 1
  let sum = 0
  for (let i = 0; i < samples; i++) {
    const value = view.getInt16(i * 2, true)
    sum += value * value
  }
  return samples ? Math.sqrt(sum / samples) : 0
}

/** Lets go of the session (its engine is stopped by the caller, or has stopped itself). */
function endSession(s: Session) {
  if (session !== s) return
  session = null
  if (s.watchdog) clearInterval(s.watchdog)
  if (powerSaveBlocker.isStarted(s.blocker)) powerSaveBlocker.stop(s.blocker)
}

async function stopEngine(): Promise<void> {
  const current = session
  if (!current) return
  endSession(current)
  await current.engine?.stop().catch(console.error)
}

/** Forwards an engine's events while it is the session's engine (lines also while it finishes, being replaced). */
function wire(s: Session, engine: SpeechEngine) {
  const current = () => s.engine === engine
  const heard = () => {
    s.lastTextAt = Date.now()
    s.soundSeconds = 0
    s.textRestarts = 0
  }
  engine.onPartial((text) => {
    if (!current() && s.retiring !== engine) return
    // Words, not a placeholder such as the offline engine's "…".
    if (/[\p{L}\p{N}]/u.test(text)) heard()
    s.send({ type: 'partial', text })
  })
  engine.onFinal((text) => {
    if (!current() && s.retiring !== engine) return
    heard()
    s.recent = []
    s.send({ type: 'final', text })
    s.save?.(text)
  })
  engine.onStatus((status) => {
    // While restarting, the chip shows Restarting; the new engine's own steps are not passed on.
    if (!current() || s.restarting) return
    s.send({ type: 'status', status })
    if (status === 'idle' || status === 'error') endSession(s)
  })
  engine.onError((error) => current() && !s.restarting && s.send({ type: 'error', error }))
}

/** Builds the session's engine and starts it; rejects with a SpeechError. */
async function launch(s: Session): Promise<void> {
  const { engine, mode } = s.build(s)
  wire(s, engine)
  s.engine = engine
  await engine.start()
  if (mode) {
    s.mode = mode.mode
    s.send(mode)
  }
}

/**
 * Replaces the engine; audio meanwhile is held for the new one. When audio stopped, the old engine first finishes what
 * it heard. When the old engine stalled, it is dropped unheard and the new one is given the audio since the last line.
 */
async function restart(s: Session, why: string, stalled: boolean): Promise<void> {
  s.restarting = true
  // A stalled engine is replaced on its own; the microphone is opened again only when its audio stopped arriving.
  s.send({ type: 'restarting', reason: why, restartCapture: !stalled })
  const old = s.engine
  s.engine = null
  s.mode = null
  if (stalled) {
    s.held = [...s.recent]
    if (old?.abort) old.abort()
    else void old?.stop().catch(() => undefined)
  } else {
    s.held = []
    s.retiring = old
    if (old) await Promise.race([old.stop().catch(() => undefined), delay(RETIRE_TIMEOUT_MS)])
    s.retiring = null
  }
  for (let attempt = 0; session === s; attempt++) {
    try {
      await launch(s)
      break
    } catch (error) {
      s.engine = null
      const problem = isSpeechError(error) ? error : speechError('engine', error instanceof Error ? error.message : String(error))
      if (problem.code === 'auth' || problem.code === 'no_key') {
        // Trying again cannot help.
        endSession(s)
        s.send({ type: 'error', error: problem })
        s.send({ type: 'status', status: 'error' })
        return
      }
      const wait = reconnectDelay(attempt)
      s.send({
        type: 'restarting',
        reason: `${why} Restart attempt ${attempt + 1} failed (${problem.message.replace(/\.$/, '')}); trying again in ${wait / 1000} s.`,
        restartCapture: false,
      })
      await delay(wait)
    }
  }
  // Stopped meanwhile: stopEngine has stopped the engine. (launch set s.engine, which TypeScript cannot see.)
  const engine = s.engine as SpeechEngine | null
  if (session !== s || !engine) return
  for (const chunk of s.held ?? []) engine.pushAudio(chunk)
  s.held = null
  s.restarting = false
  s.lastAudioAt = s.lastTextAt = Date.now()
  s.soundSeconds = 0
  s.send({ type: 'status', status: 'listening' })
  s.send({ type: 'restarted', reason: why })
}

/** Once a second: restart when the audio has stopped, or when there is sound but no transcript. */
function check(s: Session) {
  const now = Date.now()
  // Time with the track muted is not time without a transcript: move the clock on past it.
  if (s.muted) s.lastTextAt += now - s.checkedAt
  s.checkedAt = now
  if (session !== s || s.restarting || !s.engine) return
  const audioWait = Math.min(NO_AUDIO_MS * 2 ** s.audioRestarts, NO_AUDIO_MAX_MS)
  if (now - s.lastAudioAt > audioWait) {
    s.audioRestarts++
    void restart(s, `No audio arrived from the microphone for ${audioWait / 1000} seconds.`, false)
    return
  }
  // No text is expected while nothing can transcribe (the cloud reconnecting), or while the offline engine catches up.
  const textWait = Math.min(NO_TEXT_MS * 2 ** s.textRestarts, NO_TEXT_MAX_MS)
  if (s.mode !== 'reconnecting' && !s.behind && now - s.lastTextAt > textWait && s.soundSeconds >= SOUND_NEEDED_SECONDS) {
    s.textRestarts++
    void restart(s, `No transcript for ${textWait / 1000} seconds while there was sound.`, true)
  }
}

/** Every handler returns plain data; nothing here ever sends the key back to the renderer. */
export function registerSpeechIpc(): void {
  ipcMain.handle('speech:status', () => status())

  ipcMain.handle('speech:setKey', async (_event, key: unknown): Promise<SpeechResult<SpeechKeyStatus>> => {
    const trimmed = typeof key === 'string' ? key.trim() : ''
    if (!trimmed || /\s/.test(trimmed) || trimmed.length > 500) {
      return { ok: false, error: speechError('invalid_key', 'That does not look like a Deepgram API key.') }
    }
    if (!encryptionAvailable()) return { ok: false, error: speechError('no_encryption', 'This system cannot store the key securely.') }
    await saveSecret('deepgram-key', trimmed)
    return { ok: true, value: status() }
  })

  ipcMain.handle('speech:clearKey', async () => {
    await clearSecret('deepgram-key')
    return status()
  })

  ipcMain.handle('speech:test', async (): Promise<SpeechResult<{ model: string }>> => {
    const key = await readSecret('deepgram-key')
    if (!key) return { ok: false, error: speechError('no_key', 'Add a Deepgram API key first.') }
    const problem = await checkDeepgramKey(key)
    if (problem) return { ok: false, error: problem }
    // Open a real stream and close it again, so the test covers what listening uses.
    const probe = new DeepgramEngine(key)
    try {
      await probe.start()
      await probe.stop()
      return { ok: true, value: { model: DEEPGRAM_MODEL } }
    } catch (error) {
      return failed(error)
    }
  })

  // macOS asks the user once and remembers; Windows can switch microphones off for desktop apps.
  ipcMain.handle('speech:micAccess', async () => {
    if (process.platform === 'darwin') {
      if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return true
      return systemPreferences.askForMediaAccess('microphone')
    }
    if (process.platform === 'win32') return systemPreferences.getMediaAccessStatus('microphone') !== 'denied'
    return true
  })

  ipcMain.handle('speech:start', async (event): Promise<SpeechResult<null>> => {
    // The same window asking again means it reloaded and lost track of the old session; replace it.
    if (session && session.sender === event.sender) await stopEngine()
    if (session) return { ok: false, error: speechError('busy', 'The listener is already running.') }
    const sender = event.sender
    const send = (message: SpeechEvent) => {
      if (!sender.isDestroyed()) sender.send('speech:event', message)
    }

    const { speechEngine, whisperModel } = getAppSettings()
    const problem = notReadyReason()
    if (problem) return { ok: false, error: speechError(speechEngine === 'deepgram' ? 'no_key' : 'engine', problem) }
    const key = await readSecret('deepgram-key')
    if (speechEngine === 'deepgram' && !key) return { ok: false, error: speechError('no_key', 'Add a Deepgram API key in Settings first.') }
    const reportSpeed = (s: Session, performance: SpeechPerformance) => {
      s.behind = !performance.keepingUp
      send({ type: 'performance', performance })
      // Remembered per model, so Settings can show how each one ran on this computer.
      const speeds = getAppSettings().whisperSpeed
      setAppSettings({ whisperSpeed: { ...speeds, [performance.model]: performance.realTimeFactor } })
    }
    const createLocal = () => {
      const binary = whisperServerPath()
      return binary && !offlineProblem() ? new WhisperEngine(binary, modelPath(whisperModel), whisperModel) : null
    }

    const build: Session['build'] = (s) => {
      if (speechEngine === 'whisper') {
        const whisper = createLocal()
        if (!whisper) throw speechError('engine', offlineProblem() ?? 'The offline engine is missing.')
        whisper.onPerformance((p) => s.engine === whisper && reportSpeed(s, p))
        const reason = 'Offline only (whisper.cpp on this computer), as set in Settings.'
        return { engine: whisper, mode: { type: 'mode', mode: 'offline', reason, warning: null } }
      }
      // Auto, or Cloud only: the same supervisor, which reconnects Deepgram (and in Auto falls back to offline).
      const cloudOnly = speechEngine === 'deepgram'
      const auto = new AutoEngine({
        hasCloudKey: () => key !== null,
        createCloud: () => (key ? new DeepgramEngine(key) : null),
        createLocal: cloudOnly ? () => null : createLocal,
        localUnavailable: (offlineProblem() ?? '').toLowerCase().includes('download')
          ? 'no offline model is downloaded'
          : 'the offline engine is not available',
        isOnline: () => net.isOnline(),
        cloudOnly,
      })
      auto.onPerformance((p) => s.engine === auto && reportSpeed(s, p))
      auto.onMode((change) => {
        if (s.engine !== auto) return
        s.mode = change.mode
        send({ type: 'mode', ...change })
      })
      return { engine: auto, mode: null }
    }

    const s: Session = {
      sender,
      send,
      build,
      save: getAppSettings().saveTranscripts ? await transcriptWriter() : null,
      engine: null,
      retiring: null,
      held: null,
      recent: [],
      restarting: false,
      lastAudioAt: Date.now(),
      lastTextAt: Date.now(),
      soundSeconds: 0,
      audioRestarts: 0,
      textRestarts: 0,
      mode: null,
      behind: false,
      muted: false,
      checkedAt: Date.now(),
      watchdog: null,
      blocker: powerSaveBlocker.start('prevent-app-suspension'),
    }
    session = s
    // Stop listening if the window that started it closes or crashes.
    sender.once('destroyed', () => session === s && void stopEngine())
    sender.once('render-process-gone', () => session === s && void stopEngine())
    try {
      await launch(s)
    } catch (error) {
      s.engine = null
      endSession(s)
      return failed(error)
    }
    if (session === s) {
      s.lastAudioAt = s.lastTextAt = Date.now()
      s.watchdog = setInterval(() => check(s), 1000)
    }
    return { ok: true, value: null }
  })

  ipcMain.handle('speech:stop', () => stopEngine())

  ipcMain.handle('whisper:status', () => whisperStatus())

  ipcMain.handle('whisper:download', async (event, id: unknown): Promise<SpeechResult<null>> => {
    if (!isWhisperModelId(id)) return { ok: false, error: speechError('engine', 'Unknown model.') }
    const sender = event.sender
    try {
      await downloadModel(id, (progress: WhisperProgress) => {
        if (!sender.isDestroyed()) sender.send('whisper:progress', progress)
      })
      return { ok: true, value: null }
    } catch (error) {
      return failed(error)
    }
  })

  ipcMain.handle('whisper:cancel', (_event, id: unknown) => {
    if (isWhisperModelId(id)) cancelDownload(id)
  })

  ipcMain.handle('whisper:delete', async (_event, id: unknown): Promise<SpeechResult<null>> => {
    if (!isWhisperModelId(id)) return { ok: false, error: speechError('engine', 'Unknown model.') }
    const { speechEngine, whisperModel } = getAppSettings()
    if (session && speechEngine !== 'deepgram' && whisperModel === id) {
      return { ok: false, error: speechError('busy', 'Stop listening before deleting the model in use.') }
    }
    await deleteModel(id)
    return { ok: true, value: null }
  })

  // Fire and forget, ten times a second. Only the window that started listening may send audio.
  ipcMain.on('speech:micMuted', (event, muted: unknown) => {
    if (session && event.sender === session.sender) session.muted = muted === true
  })

  ipcMain.on('speech:audio', (event, chunk: unknown) => {
    const s = session
    if (!s || event.sender !== s.sender) return
    const data = chunk instanceof Uint8Array ? chunk : chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : null
    if (!data || data.byteLength === 0 || data.byteLength > 64_000) return
    s.lastAudioAt = Date.now()
    s.audioRestarts = 0
    if (rms(data) >= SOUND_RMS) s.soundSeconds += data.byteLength / 32_000
    s.recent.push(data)
    if (s.recent.length > RECENT_MAX_CHUNKS) s.recent.shift()
    if (s.held) {
      s.held.push(data)
      if (s.held.length > HELD_MAX_CHUNKS) s.held.shift()
    } else s.engine?.pushAudio(data)
  })
}

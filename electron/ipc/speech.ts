import { app, ipcMain, net, powerSaveBlocker, systemPreferences, type WebContents } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { SpeechEngineId, SpeechEvent, SpeechKeyStatus, SpeechMode, SpeechPerformance, SpeechResult, WhisperProgress, WhisperStatus } from '../../shared/types'
import { can, CLOUD_NOT_CONNECTED, upgradeNote } from '../../shared/features'
import { appendSegment, finishSermon, isRecording } from '../db/sermons'
import { getAppSettings, setAppSettings } from '../db/settings'
import { DEVELOPER_ONLY, developerMode, hasProviderKey, keyProvider, missingKeyMessage, readProviderKey } from '../keys'
import { clearSecret, encryptionAvailable, hasSecret, saveSecret } from '../secrets'
import { checkDeepgramKey, DEEPGRAM_MODEL, DeepgramEngine } from '../speech/deepgram'
import { AutoEngine, reconnectDelay } from '../speech/auto'
import { isSpeechError, speechError, type SpeechEngine } from '../speech/engine'
import { WhisperEngine, whisperServerPath } from '../speech/whisper'
import { isServiceError } from '../service/client'
import { startServiceListening, type CloudCut, type ServiceListening } from '../service/listening'
import { serviceAccount, signedIn } from '../service/registry'
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
/** The longest recording the transcript test takes: 30 seconds of 16 kHz 16-bit audio. */
const TEST_MAX_BYTES = 30 * 32_000
/** The test sends its recording at four times real time, which both engines accept. */
const TEST_CHUNK_BYTES = 3200
const TEST_CHUNK_GAP_MS = 25
/** Includes loading the offline model. */
const TEST_TIMEOUT_MS = 120_000

/** One listening session, from Start to Stop. It outlives its engine, which the watchdog may replace. */
interface Session {
  sender: WebContents
  send(message: SpeechEvent): void
  /** A new engine for this session, and the mode to report once it is listening (for single-engine modes). */
  build(session: Session): { engine: SpeechEngine; mode: Extract<SpeechEvent, { type: 'mode' }> | null }
  save: ((line: string) => void) | null
  /** The sermon each final line is saved to, as it is heard; null when not recording one. */
  sermonId: number | null
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
  /** The cloud listening session on the ServiceEx account; null with a developer key, offline, or when it could not start. */
  service: ServiceListening | null
  /** Why the cloud may not be used again this session (the hours ran out, say); engines built after it listen offline. */
  cloudCut: CloudCut | null
}

/** The session listening, if any. One at a time. */
let session: Session | null = null
/** A transcript test is running; it and listening do not run together. */
let testRunning = false

const transcriptsFolder = () => path.join(app.getPath('userData'), 'transcripts')

/** Cloud listening goes through the ServiceEx account (always, outside developer builds). */
const serviceMode = () => keyProvider('deepgram') === 'service'

/** The account gives no cloud listening: not signed in. */
const cloudNotConnected = () => serviceMode() && !signedIn()

/**
 * The engine Settings chooses. Cloud only through the account while signed out runs as Auto: it says why and listens
 * offline instead of failing.
 */
function chosenEngine(): SpeechEngineId {
  const { speechEngine } = getAppSettings()
  return speechEngine === 'deepgram' && cloudNotConnected() ? 'auto' : speechEngine
}

/** Why the offline engine cannot run, or null when it can. */
function offlineProblem(): string | null {
  if (!can('listener.offline')) return upgradeNote('listener.offline')
  const { whisperModel } = getAppSettings()
  if (!whisperServerPath()) return 'The offline engine is not included in this build.'
  const label = WHISPER_MODELS.find((m) => m.id === whisperModel)?.label ?? whisperModel
  return isDownloaded(whisperModel) ? null : `Download the ${label} model in Settings first.`
}

/** Why the cloud engine cannot run, or null when it can. */
function cloudProblem(): string | null {
  if (!can('listener.cloud')) return upgradeNote('listener.cloud')
  if (serviceMode()) return signedIn() ? null : CLOUD_NOT_CONNECTED
  return hasProviderKey('deepgram') ? null : missingKeyMessage('deepgram')
}

/** The Deepgram key, when the plan includes the cloud listener and the chosen provider has one. */
const cloudKey = async () => (can('listener.cloud') ? readProviderKey('deepgram') : null)

/** Whether the plan leaves the chosen engine nothing to run. */
function engineNotInPlan(): boolean {
  const speechEngine = chosenEngine()
  if (speechEngine === 'deepgram') return !can('listener.cloud')
  if (speechEngine === 'whisper') return !can('listener.offline')
  return !can('listener.cloud') && !can('listener.offline')
}

/** What stops the chosen engine from starting, or null when it is ready. */
function notReadyReason(): string | null {
  const speechEngine = chosenEngine()
  if (speechEngine === 'deepgram') return cloudProblem()
  if (speechEngine === 'whisper') return offlineProblem()
  // Auto needs at least one of the two; when the plan has only one, its problem is the one to fix.
  const cloud = cloudProblem()
  const offline = offlineProblem()
  if (!cloud || !offline) return null
  if (!can('listener.cloud')) return offline
  if (!can('listener.offline')) return cloud
  // With no key to add, the offline model is the thing to fix.
  if (cloudNotConnected()) return offline
  return 'Add a Deepgram API key or download an offline model in Settings first.'
}

function status(): SpeechKeyStatus {
  const reason = notReadyReason()
  return {
    ready: reason === null,
    readyHint: reason,
    hasKey: hasSecret('deepgram-key'),
    encryptionAvailable: encryptionAvailable(),
    developerMode: developerMode(),
    cloudNotice: chosenEngine() === 'auto' && can('listener.cloud') && cloudNotConnected() ? CLOUD_NOT_CONNECTED : null,
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

/** Why the cloud session could not open, for the mode chip and the warning beneath it. */
function serviceStartProblem(error: unknown): { reason: string; warning: string } {
  if (isServiceError(error) && error.code === 'no_credit') {
    return { reason: 'There are no cloud listening hours left', warning: error.message }
  }
  if (isServiceError(error) && error.code === 'offline') {
    return { reason: 'ServiceEx could not be reached', warning: 'ServiceEx could not be reached, so listening is offline on this computer.' }
  }
  if (!isServiceError(error)) console.error('Cloud listening could not start', error)
  const why = isServiceError(error) ? error.message.replace(/\.$/, '') : 'Cloud listening could not start'
  return { reason: 'Cloud listening could not start', warning: `${why}. Listening is offline on this computer.` }
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

/**
 * Lets go of the session (its engine is stopped by the caller, or has stopped itself), and closes its cloud session.
 * Its sermon is marked saved, unless `finish` is false because the caller does that once the engine has written its
 * last lines.
 */
function endSession(s: Session, finish = true) {
  if (session !== s) return
  session = null
  if (s.watchdog) clearInterval(s.watchdog)
  if (powerSaveBlocker.isStarted(s.blocker)) powerSaveBlocker.stop(s.blocker)
  void endService(s)
  if (finish) finishRecording(s)
}

/** Closes the session's cloud session (once), then reads the hours left again. */
function endService(s: Session): Promise<void> {
  if (!s.service) return Promise.resolve()
  return s.service.end().then(() => serviceAccount()?.account.balanceChanged())
}

/** The cloud may not be used again this session: the engine carries on offline, with the reason shown. */
function cutCloud(s: Session, cut: CloudCut) {
  if (s.cloudCut) return
  s.cloudCut = cut
  if (s.engine instanceof AutoEngine) s.engine.cutCloud(cut.message)
}

/** Marks the session's sermon saved. Lines the engine still sends are saved to it all the same. */
function finishRecording(s: Session) {
  if (s.sermonId === null) return
  try {
    finishSermon(s.sermonId)
  } catch (error) {
    console.error('Could not finish the sermon recording', error)
  }
}

/** Saves a final line to the session's sermon. A database problem is logged; listening carries on. */
function recordLine(s: Session, text: string) {
  if (s.sermonId === null) return
  try {
    appendSegment(s.sermonId, text)
  } catch (error) {
    console.error('Could not save a sermon transcript line', error)
  }
}

async function stopEngine(): Promise<void> {
  const current = session
  if (!current) return
  endSession(current, false)
  await current.engine?.stop().catch(console.error)
  finishRecording(current)
  await endService(current)
}

/** Stops listening as the app quits: the last lines are saved and the cloud session is closed. */
export const stopListening = (): Promise<void> => stopEngine()

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
    recordLine(s, text)
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

/**
 * Transcribes a short recording with the engine Settings chooses (Auto: the cloud when there is a key and a
 * connection, else offline) and returns everything it heard.
 */
async function transcribeTest(pcm: Uint8Array): Promise<SpeechResult<{ text: string; engine: string }>> {
  const problem = notReadyReason()
  if (problem) return { ok: false, error: speechError('engine', problem) }
  const { whisperModel } = getAppSettings()
  const speechEngine = chosenEngine()
  const key = await cloudKey()
  const binary = whisperServerPath()
  // With the account, the test listens offline: a cloud test would need a billed listening session.
  const cloud = !serviceMode() && (speechEngine === 'deepgram' || (speechEngine === 'auto' && key !== null && (net.isOnline() || offlineProblem() !== null)))
  if (serviceMode() && offlineProblem()) {
    return { ok: false, error: speechError('engine', 'Signed in to ServiceEx, the transcript test listens offline. Download an offline model first.') }
  }
  let engine: SpeechEngine
  let name: string
  if (cloud) {
    if (!key) return { ok: false, error: speechError('no_key', missingKeyMessage('deepgram')) }
    engine = new DeepgramEngine(key)
    name = `Deepgram ${DEEPGRAM_MODEL}`
  } else {
    if (!binary) return { ok: false, error: speechError('engine', offlineProblem() ?? 'The offline engine is missing.') }
    engine = new WhisperEngine(binary, modelPath(whisperModel), whisperModel)
    name = `whisper.cpp ${whisperModel}`
  }
  const finals: string[] = []
  let partial = ''
  engine.onFinal((text) => {
    finals.push(text)
    partial = ''
  })
  engine.onPartial((text) => (partial = /[\p{L}\p{N}]/u.test(text) ? text : partial))
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = async () => {
    await engine.start()
    for (let at = 0; at < pcm.byteLength; at += TEST_CHUNK_BYTES) {
      engine.pushAudio(pcm.subarray(at, at + TEST_CHUNK_BYTES))
      await delay(TEST_CHUNK_GAP_MS)
    }
    await engine.stop()
  }
  try {
    await Promise.race([
      run(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(speechError('engine', 'The speech engine took too long to answer.')), TEST_TIMEOUT_MS)
      }),
    ])
  } catch (error) {
    if (engine.abort) engine.abort()
    else void engine.stop().catch(() => undefined)
    return failed(error)
  } finally {
    clearTimeout(timer)
  }
  return { ok: true, value: { text: [...finals, partial].join(' ').replace(/\s+/g, ' ').trim(), engine: name } }
}

/** Every handler returns plain data; nothing here ever sends the key back to the renderer. */
export function registerSpeechIpc(): void {
  ipcMain.handle('speech:status', () => status())

  ipcMain.handle('speech:setKey', async (_event, key: unknown): Promise<SpeechResult<SpeechKeyStatus>> => {
    if (!developerMode()) return { ok: false, error: speechError('no_key', DEVELOPER_ONLY) }
    const trimmed = typeof key === 'string' ? key.trim() : ''
    if (!trimmed || /\s/.test(trimmed) || trimmed.length > 500) {
      return { ok: false, error: speechError('invalid_key', 'That does not look like a Deepgram API key.') }
    }
    if (!encryptionAvailable()) return { ok: false, error: speechError('no_encryption', 'This system cannot store the key securely.') }
    await saveSecret('deepgram-key', trimmed)
    return { ok: true, value: status() }
  })

  ipcMain.handle('speech:clearKey', async () => {
    if (developerMode()) await clearSecret('deepgram-key')
    return status()
  })

  ipcMain.handle('speech:test', async (): Promise<SpeechResult<{ model: string }>> => {
    if (!can('listener.cloud')) return { ok: false, error: speechError('not_in_plan', upgradeNote('listener.cloud')) }
    const key = await readProviderKey('deepgram')
    if (!key) return { ok: false, error: speechError('no_key', missingKeyMessage('deepgram')) }
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

  ipcMain.handle('speech:start', async (event, options: unknown): Promise<SpeechResult<null>> => {
    // The same window asking again means it reloaded and lost track of the old session; replace it.
    if (session && session.sender === event.sender) await stopEngine()
    if (session) return { ok: false, error: speechError('busy', 'The listener is already running.') }
    if (testRunning) return { ok: false, error: speechError('busy', 'A transcript test is running; try again when it finishes.') }
    const sender = event.sender
    const send = (message: SpeechEvent) => {
      if (!sender.isDestroyed()) sender.send('speech:event', message)
    }

    const { whisperModel } = getAppSettings()
    const speechEngine = chosenEngine()
    const problem = notReadyReason()
    if (problem) return { ok: false, error: speechError(engineNotInPlan() ? 'not_in_plan' : speechEngine === 'deepgram' ? 'no_key' : 'engine', problem) }
    const key = await cloudKey()
    if (speechEngine === 'deepgram' && !key && !serviceMode()) return { ok: false, error: speechError('no_key', missingKeyMessage('deepgram')) }
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

    let serviceProblem: { reason: string; warning: string } | null = null
    const build: Session['build'] = (s) => {
      if (speechEngine === 'whisper') {
        const whisper = createLocal()
        if (!whisper) throw speechError('engine', offlineProblem() ?? 'The offline engine is missing.')
        whisper.onPerformance((p) => s.engine === whisper && reportSpeed(s, p))
        const reason = 'Offline only (whisper.cpp on this computer), as set in Settings.'
        return { engine: whisper, mode: { type: 'mode', mode: 'offline', reason, warning: null } }
      }
      // Auto, or Cloud only: the same supervisor, which reconnects Deepgram (and in Auto falls back to offline). With
      // the account, the cloud also gives way to offline when the server stops it (the hours ran out), even in Cloud only.
      const service = s.service
      const viaService = serviceMode()
      const cloudOnly = speechEngine === 'deepgram' && (!viaService || (service !== null && !s.cloudCut))
      const auto = new AutoEngine({
        hasCloudKey: () => (viaService ? service !== null && !s.cloudCut : key !== null),
        noKeyReason: s.cloudCut
          ? 'Cloud listening stopped'
          : (serviceProblem?.reason ?? (cloudNotConnected() ? 'You are not signed in to ServiceEx' : undefined)),
        noKeyWarning: s.cloudCut?.message ?? serviceProblem?.warning,
        createCloud: () => (viaService ? (service && !s.cloudCut ? new DeepgramEngine(() => service.token()) : null) : key ? new DeepgramEngine(key) : null),
        createLocal: cloudOnly && !viaService ? () => null : createLocal,
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

    // Only a sermon the renderer has just started, still recording, takes the lines.
    const requested = (options as { sermonId?: unknown } | null | undefined)?.sermonId
    const sermonId = Number.isInteger(requested) && can('sermon.save') && isRecording(requested as number) ? (requested as number) : null

    const s: Session = {
      sender,
      send,
      build,
      save: getAppSettings().saveTranscripts ? await transcriptWriter() : null,
      sermonId,
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
      service: null,
      cloudCut: null,
    }
    session = s
    // Stop listening if the window that started it closes or crashes.
    sender.once('destroyed', () => session === s && void stopEngine())
    sender.once('render-process-gone', () => session === s && void stopEngine())
    // With the account, open the cloud session first. If it cannot open (no hours left, the server unreachable),
    // listening starts offline and says why.
    const linked = serviceAccount()
    if (speechEngine !== 'whisper' && serviceMode() && can('listener.cloud') && linked?.account.isSignedIn()) {
      try {
        s.service = await startServiceListening({
          client: linked.client,
          machineId: await linked.machineId(),
          cloudInUse: () => s.engine instanceof AutoEngine && s.engine.usingCloud,
          onBalance: (seconds) => linked.account.setBalanceSeconds(seconds),
          onCut: (cut) => cutCloud(s, cut),
        })
      } catch (error) {
        serviceProblem = serviceStartProblem(error)
      }
      if (session !== s) {
        // Stopped while the cloud session opened.
        void s.service?.end()
        return { ok: true, value: null }
      }
    }
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

  ipcMain.handle('speech:transcribeTest', async (_event, pcm: unknown): Promise<SpeechResult<{ text: string; engine: string }>> => {
    // The offline engine runs one server at a time, and a test should not compete with the service.
    if (session) return { ok: false, error: speechError('busy', 'Stop listening before testing the transcript.') }
    if (testRunning) return { ok: false, error: speechError('busy', 'A transcript test is already running.') }
    const data = pcm instanceof Uint8Array ? pcm : null
    if (!data || data.byteLength === 0 || data.byteLength > TEST_MAX_BYTES) {
      return { ok: false, error: speechError('engine', 'Record a test of up to 30 seconds first.') }
    }
    testRunning = true
    try {
      return await transcribeTest(data)
    } finally {
      testRunning = false
    }
  })

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
    const { whisperModel } = getAppSettings()
    if (session && chosenEngine() !== 'deepgram' && whisperModel === id) {
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

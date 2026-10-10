import { app, ipcMain, systemPreferences, type WebContents } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { SpeechEvent, SpeechKeyStatus, SpeechResult } from '../../shared/types'
import { getAppSettings } from '../db/settings'
import { clearSecret, encryptionAvailable, hasSecret, readSecret, saveSecret } from '../secrets'
import { checkDeepgramKey, DEEPGRAM_MODEL, DeepgramEngine } from '../speech/deepgram'
import { isSpeechError, speechError, type SpeechEngine } from '../speech/engine'

/** The engine that is listening, and the window it reports to. One at a time. */
let engine: SpeechEngine | null = null
let owner: WebContents | null = null

const transcriptsFolder = () => path.join(app.getPath('userData'), 'transcripts')

function status(): SpeechKeyStatus {
  return { hasKey: hasSecret('deepgram-key'), encryptionAvailable: encryptionAvailable(), transcriptsFolder: transcriptsFolder() }
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

async function stopEngine(): Promise<void> {
  const current = engine
  engine = null
  owner = null
  await current?.stop().catch(console.error)
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
    if (engine && owner === event.sender) await stopEngine()
    if (engine) return { ok: false, error: speechError('busy', 'The listener is already running.') }
    const key = await readSecret('deepgram-key')
    if (!key) return { ok: false, error: speechError('no_key', 'Add a Deepgram API key in Settings first.') }

    const sender = event.sender
    const send = (message: SpeechEvent) => {
      if (!sender.isDestroyed()) sender.send('speech:event', message)
    }
    const next = new DeepgramEngine(key)
    const save = getAppSettings().saveTranscripts ? await transcriptWriter() : null
    next.onPartial((text) => send({ type: 'partial', text }))
    next.onFinal((text) => {
      send({ type: 'final', text })
      save?.(text)
    })
    next.onStatus((status) => {
      send({ type: 'status', status })
      if ((status === 'idle' || status === 'error') && engine === next) {
        engine = null
        owner = null
      }
    })
    next.onError((error) => send({ type: 'error', error }))
    engine = next
    owner = sender
    // Stop listening if the window that started it closes or crashes.
    sender.once('destroyed', () => engine === next && void stopEngine())
    sender.once('render-process-gone', () => engine === next && void stopEngine())
    try {
      await next.start()
      return { ok: true, value: null }
    } catch (error) {
      if (engine === next) {
        engine = null
        owner = null
      }
      return failed(error)
    }
  })

  ipcMain.handle('speech:stop', () => stopEngine())

  // Fire and forget, ten times a second. Only the window that started listening may send audio.
  ipcMain.on('speech:audio', (event, chunk: unknown) => {
    if (!engine || event.sender !== owner) return
    if (chunk instanceof Uint8Array && chunk.byteLength > 0 && chunk.byteLength <= 64_000) engine.pushAudio(chunk)
    else if (chunk instanceof ArrayBuffer && chunk.byteLength > 0 && chunk.byteLength <= 64_000) engine.pushAudio(new Uint8Array(chunk))
  })
}

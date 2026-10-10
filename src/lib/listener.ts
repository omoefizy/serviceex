// The live sermon listener: microphone in, transcript out. The transcript lives in memory only (this store);
// the main process writes it to a file just when "Save transcripts" is on.

import { create } from 'zustand'
import type { SpeechMode, SpeechPerformance, SpeechStatus } from '../../shared/types'
import { useOperatorStore } from '../store'
import { startMic, type MicCapture } from './mic'
import { detectScripture } from './scriptureDetection'

export type ListenerStatus = SpeechStatus | 'starting'

export interface ListenerLogEntry {
  at: number
  text: string
}

/** Events kept for the panel's debugging log, in memory only. */
const LOG_SIZE = 50

interface ListenerState {
  status: ListenerStatus
  error: string | null
  /** Finished lines, oldest first. */
  finals: string[]
  /** The words still being recognised; replaced as they firm up. */
  partial: string
  level: number
  /** How the offline engine is keeping up in this session; null until measured (and for Deepgram). */
  performance: SpeechPerformance | null
  /** Which engine is transcribing while listening, and why (for the status chip's tooltip). */
  mode: SpeechMode | null
  modeReason: string
  /** Something to show prominently, such as transcription being paused; null when all is well. */
  warning: string | null
  /** The watchdog is restarting the engine and microphone; why, for the chip's tooltip. */
  restarting: string | null
  /** "Restarted" after the watchdog stepped in, until dismissed. */
  notice: string | null
  /** The last 50 events, oldest first. */
  log: ListenerLogEntry[]
  start(): Promise<void>
  stop(): Promise<void>
  clear(): void
  dismissNotice(): void
}

let mic: MicCapture | null = null

function addLog(text: string) {
  useListener.setState((s) => {
    // The same message again (such as a repeated reason) is not worth a new line.
    if (s.log.at(-1)?.text === text) return {}
    return { log: [...s.log, { at: Date.now(), text }].slice(-LOG_SIZE) }
  })
}

const STATUS_LOG: Partial<Record<SpeechStatus, string>> = {
  connecting: 'Connecting to the speech engine.',
  listening: 'Listening.',
  stopping: 'Stopping.',
  idle: 'Stopped.',
  error: 'Stopped with an error.',
}
const MODE_LOG: Record<SpeechMode, string> = { cloud: 'Cloud', offline: 'Offline', reconnecting: 'Reconnecting' }

function releaseMic() {
  mic?.stop()
  mic = null
  useListener.setState({ level: 0 })
}

export const useListener = create<ListenerState>((set, get) => ({
  status: 'idle',
  error: null,
  finals: [],
  partial: '',
  level: 0,
  performance: null,
  mode: null,
  modeReason: '',
  warning: null,
  restarting: null,
  notice: null,
  log: [],

  async start() {
    if (get().status !== 'idle' && get().status !== 'error') return
    set({ status: 'starting', error: null, performance: null, mode: null, modeReason: '', warning: null, restarting: null, notice: null })
    addLog('Start pressed; opening the microphone.')
    // Audio captured before the engine is connected waits here, so the first words are not lost.
    let connected = false
    const waiting: ArrayBuffer[] = []
    try {
      mic = await startMic({
        deviceId: useOperatorStore.getState().settings.micDeviceId,
        onChunk(pcm) {
          if (connected) window.api.speech.pushAudio(pcm)
          else if (waiting.length < 50) waiting.push(pcm)
        },
        onLevel: (level) => set({ level }),
        // The capture recovers by itself; the log says what happened.
        onNotice: (text) => addLog(`Microphone: ${text}`),
      })
    } catch (error) {
      set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      addLog(`Error: ${get().error}`)
      return
    }
    // Stop was pressed while the microphone opened.
    if (get().status !== 'starting') return releaseMic()
    const started = await window.api.speech.start()
    if (!started.ok) {
      releaseMic()
      set({ status: 'error', error: started.error.message })
      addLog(`Error: ${started.error.message}`)
      return
    }
    if (!mic) {
      // Stopped while connecting.
      await window.api.speech.stop()
      return
    }
    connected = true
    for (const pcm of waiting.splice(0)) window.api.speech.pushAudio(pcm)
  },

  async stop() {
    releaseMic()
    if (get().status === 'starting' || get().status === 'listening' || get().status === 'connecting') set({ status: 'stopping' })
    await window.api.speech.stop()
    // The engine reports idle when it has closed; if it never connected there is nothing to wait for.
    if (get().status === 'stopping') set({ status: 'idle' })
  },

  clear() {
    set({ finals: [], partial: '' })
  },

  dismissNotice() {
    set({ notice: null })
  },
}))

window.api?.speech.onEvent((event) => {
  const set = useListener.setState
  switch (event.type) {
    case 'partial':
      set({ partial: event.text })
      break
    case 'final':
      set((s) => ({ finals: [...s.finals, event.text], partial: '' }))
      detectScripture(event.text).catch(console.error)
      break
    case 'status':
      if (useListener.getState().status !== event.status && STATUS_LOG[event.status]) addLog(STATUS_LOG[event.status]!)
      set(event.status === 'idle' || event.status === 'error' ? { status: event.status, partial: '', mode: null, warning: null, restarting: null } : { status: event.status })
      // The engine stopped on its own (an error or a dropped connection): let go of the microphone too.
      if (event.status === 'idle' || event.status === 'error') releaseMic()
      break
    case 'error':
      set({ error: event.error.message })
      addLog(`Error: ${event.error.message}`)
      break
    case 'mode':
      // A switch between engines: words still forming are spoken again by the engine taking over.
      set({ mode: event.mode, modeReason: event.reason, warning: event.warning, partial: '' })
      addLog(`${MODE_LOG[event.mode]}: ${event.reason}`)
      if (event.warning) addLog(`Warning: ${event.warning}`)
      break
    case 'restarting':
      set({ restarting: event.reason, partial: '' })
      addLog(`Restarting: ${event.reason}`)
      if (event.restartCapture) mic?.restart('Restarted by the watchdog.').catch(console.error)
      break
    case 'restarted': {
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      set({ restarting: null, notice: `Restarted at ${time}. ${event.reason}` })
      addLog(`Restarted. ${event.reason}`)
      break
    }
    case 'performance':
      if (useListener.getState().performance?.keepingUp !== event.performance.keepingUp) {
        addLog(event.performance.keepingUp ? 'Offline engine is keeping up.' : 'Offline engine is falling behind.')
      }
      set({ performance: event.performance })
      // The main process saved the measurement in settings; pick it up for the Settings page.
      useOperatorStore.getState().loadSettings().catch(console.error)
      break
  }
})

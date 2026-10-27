// The live sermon listener: microphone in, transcript out. The transcript lives in memory here; when a sermon is
// being recorded the main process saves each final line to it as it is heard (interim words are never saved), and
// this file saves the scripture the listener detects and the statements shown or pinned. The main process also writes
// a text file just when "Save transcripts" is on.

import { create } from 'zustand'
import type { AppSettings, SpeechMode, SpeechPerformance, SpeechStatus } from '../../shared/types'
import { useOperatorStore } from '../store'
import { SignalWatch, startMic, type MicCapture, type MicDevice, type MicDsp, type MicReading, type MicState, type SignalAdvice } from './mic'
import { detectFromPartial, detectScripture, resetDetection, useSuggestions } from './scriptureDetection'
import { collectStatementText } from './statements'

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
  /** Times the system muted the microphone this session (each gap was filled with silence). */
  dropouts: number
  /** The input open now; null before it opens (and while waiting for an unplugged one, the last one open). */
  input: MicDevice | null
  inputState: MicState | null
  /** The last 100 ms of levels; null while silence is sent in place of the input. */
  reading: MicReading | null
  /** What is wrong with the signal, most serious first. */
  advice: SignalAdvice[]
  /** The sermon this session records into, and its title for the panel; null when not recording one. */
  sermon: { id: number; title: string } | null
  /** Starts listening; with a sermon (just created, still recording) its transcript, scripture and statements are saved. */
  start(sermon?: { id: number; title: string }): Promise<void>
  stop(): Promise<void>
  clear(): void
  dismissNotice(): void
}

let mic: MicCapture | null = null
let signal = new SignalWatch()

/** The channel, gain, filter and gate settings, which apply while listening without opening the input again. */
export const dspOf = (s: AppSettings): MicDsp => ({
  channel: s.micChannel,
  gainDb: s.micGainDb,
  highPass: s.micHighPass,
  noiseGate: s.micNoiseGate,
  gateThresholdDb: s.micGateThresholdDb,
})

/** The saved device was found under a new deviceId (another USB port, a restart): remember the new one. */
export function rememberDevice(device: MicDevice) {
  const { settings, updateSettings } = useOperatorStore.getState()
  if (!device.deviceId || settings.micDeviceId === null || settings.micDeviceId === device.deviceId) return
  updateSettings({ micDeviceId: device.deviceId, micDeviceName: device.label }).catch(console.error)
}

const sameAdvice = (a: SignalAdvice[], b: SignalAdvice[]) => a.length === b.length && a.every((x, i) => x.text === b[i].text)

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

/** Marks a sermon saved (the main process does this too when a session ends; once more is harmless). */
function finishSermon(id: number) {
  window.api.sermons.finish(id).catch(console.error)
}

/** The session is over: its sermon is finished and nothing more is saved to it. */
function endRecording() {
  const { sermon } = useListener.getState()
  if (!sermon) return
  useListener.setState({ sermon: null })
  finishSermon(sermon.id)
}

function releaseMic() {
  mic?.stop()
  mic = null
  useListener.setState({ level: 0, inputState: null, reading: null, advice: [] })
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
  dropouts: 0,
  input: null,
  inputState: null,
  reading: null,
  advice: [],
  sermon: null,

  async start(sermon) {
    if (get().status !== 'idle' && get().status !== 'error') {
      // Not started, so the sermon made for this start keeps nothing.
      if (sermon) finishSermon(sermon.id)
      return
    }
    set({
      sermon: sermon ?? null,
      status: 'starting',
      error: null,
      performance: null,
      mode: null,
      modeReason: '',
      warning: null,
      restarting: null,
      notice: null,
      dropouts: 0,
      input: null,
      inputState: null,
      reading: null,
      advice: [],
    })
    signal = new SignalWatch()
    addLog('Start pressed; opening the microphone.')
    // A new session starts without the last one's book and chapter.
    resetDetection()
    // Audio captured before the engine is connected waits here, so the first words are not lost.
    let connected = false
    const waiting: ArrayBuffer[] = []
    const settings = useOperatorStore.getState().settings
    const { micDeviceId, micDeviceName, micProcessing } = settings
    try {
      mic = await startMic({
        deviceId: micDeviceId,
        deviceName: micDeviceName,
        processing: micProcessing,
        dsp: dspOf(settings),
        onChunk(pcm) {
          if (connected) window.api.speech.pushAudio(pcm)
          else if (waiting.length < 50) waiting.push(pcm)
        },
        onLevel: (level) => set({ level }),
        onReading(reading) {
          signal.push(reading)
          const advice = signal.advice(useOperatorStore.getState().settings.micChannel)
          set((s) => ({ reading, advice: sameAdvice(s.advice, advice) ? s.advice : advice }))
        },
        // The capture recovers by itself; the log says what happened.
        onNotice: (text) => addLog(`Microphone: ${text}`),
        onDevice(device) {
          set({ input: device })
          rememberDevice(device)
          const { label, sampleRate, channels, bluetooth } = device
          addLog(
            `Input: ${label} · ${channels} channel${channels === 1 ? '' : 's'} · ${sampleRate} Hz · ${bluetooth ? 'Bluetooth' : 'wired'} · processing ${micProcessing ? 'on' : 'off'}`,
          )
        },
        onState: (inputState) => set({ inputState }),
        onMute(muted, cause) {
          if (muted && cause === 'muted') set((s) => ({ dropouts: s.dropouts + 1 }))
          // The watchdog does not count muted time as the engine failing to transcribe.
          window.api.speech.setMicMuted(muted)
        },
      })
    } catch (error) {
      set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      addLog(`Error: ${get().error}`)
      endRecording()
      return
    }
    // Stop was pressed while the microphone opened.
    if (get().status !== 'starting') {
      endRecording()
      return releaseMic()
    }
    const started = await window.api.speech.start(sermon ? { sermonId: sermon.id } : undefined)
    if (!started.ok) {
      releaseMic()
      set({ status: 'error', error: started.error.message })
      addLog(`Error: ${started.error.message}`)
      endRecording()
      return
    }
    if (sermon) addLog(`Saving to the sermon “${sermon.title}”.`)
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
    endRecording()
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
      // Scripture is looked for in words still forming too, so a card can appear before the line is final.
      detectFromPartial(event.text).catch(console.error)
      break
    case 'final':
      set((s) => ({ finals: [...s.finals, event.text], partial: '' }))
      detectScripture(event.text).catch(console.error)
      collectStatementText(event.text, Date.now(), (message) => addLog(`Statement suggestions: ${message}`))
      break
    case 'status':
      if (useListener.getState().status !== event.status && STATUS_LOG[event.status]) addLog(STATUS_LOG[event.status]!)
      set(event.status === 'idle' || event.status === 'error' ? { status: event.status, partial: '', mode: null, warning: null, restarting: null } : { status: event.status })
      // The engine stopped on its own (an error or a dropped connection): let go of the microphone too.
      if (event.status === 'idle' || event.status === 'error') {
        releaseMic()
        endRecording()
      }
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

// Channel, gain, filter and gate changes in Settings apply at once while listening.
useOperatorStore.subscribe((state, previous) => {
  const next = dspOf(state.settings)
  const before = dspOf(previous.settings)
  if (mic && (Object.keys(next) as (keyof MicDsp)[]).some((key) => next[key] !== before[key])) mic.configure(next)
})

// ---------- Saving to the sermon ----------

/** Scripture cards already saved, by id, so a card is saved once (a fuller reading of it is saved as well). */
const savedCards = new Map<number, string>()

/** Pins a statement to the sermon being recorded, for its slides and exports. */
export function pinStatement(text: string): void {
  const { sermon } = useListener.getState()
  if (sermon) window.api.sermons.addStatement(sermon.id, text, true).catch(console.error)
}

// While a sermon records: each scripture card the listener suggests, and each statement sent to the preview.
useSuggestions.subscribe((state, previous) => {
  const { sermon } = useListener.getState()
  if (!sermon) {
    savedCards.clear()
    return
  }
  for (const suggestion of state.suggestions) {
    if (suggestion.type !== 'scripture' || savedCards.get(suggestion.id) === suggestion.label) continue
    savedCards.set(suggestion.id, suggestion.label)
    window.api.sermons.addScripture(sermon.id, suggestion.label, 'detected').catch(console.error)
  }
  if (state.previewedId !== null && state.previewedId !== previous.previewedId) {
    const shown = state.suggestions.find((s) => s.id === state.previewedId)
    if (shown?.type === 'statement') window.api.sermons.addStatement(sermon.id, shown.text, false).catch(console.error)
  }
})

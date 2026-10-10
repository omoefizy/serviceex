// The live sermon listener: microphone in, transcript out. The transcript lives in memory only (this store);
// the main process writes it to a file just when "Save transcripts" is on.

import { create } from 'zustand'
import type { SpeechMode, SpeechPerformance, SpeechStatus } from '../../shared/types'
import { useOperatorStore } from '../store'
import { startMic, type MicCapture } from './mic'
import { detectScripture } from './scriptureDetection'

export type ListenerStatus = SpeechStatus | 'starting'

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
  start(): Promise<void>
  stop(): Promise<void>
  clear(): void
}

let mic: MicCapture | null = null

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

  async start() {
    if (get().status !== 'idle' && get().status !== 'error') return
    set({ status: 'starting', error: null, performance: null, mode: null, modeReason: '', warning: null })
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
        onEnded() {
          set({ error: 'The microphone stopped. Check it is still connected.' })
          get().stop().catch(console.error)
        },
      })
    } catch (error) {
      set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      return
    }
    // Stop was pressed while the microphone opened.
    if (get().status !== 'starting') return releaseMic()
    const started = await window.api.speech.start()
    if (!started.ok) {
      releaseMic()
      set({ status: 'error', error: started.error.message })
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
      set(event.status === 'idle' ? { status: 'idle', partial: '', mode: null, warning: null } : { status: event.status })
      // The engine stopped on its own (an error or a dropped connection): let go of the microphone too.
      if (event.status === 'idle' || event.status === 'error') releaseMic()
      break
    case 'error':
      set({ error: event.error.message })
      break
    case 'mode':
      // A switch between engines: words still forming are spoken again by the engine taking over.
      set({ mode: event.mode, modeReason: event.reason, warning: event.warning, partial: '' })
      break
    case 'performance':
      set({ performance: event.performance })
      // The main process saved the measurement in settings; pick it up for the Settings page.
      useOperatorStore.getState().loadSettings().catch(console.error)
      break
  }
})

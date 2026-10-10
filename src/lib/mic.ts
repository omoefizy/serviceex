// Microphone capture for the sermon listener and the Settings level meter: getUserMedia into an AudioWorklet that
// hands back 16 kHz mono 16-bit PCM in 100 ms chunks.

const workletUrl = new URL('./pcmWorklet.js', import.meta.url).href

export interface MicCapture {
  stop(): void
  /** Closes the microphone and opens it again, as when it went away; `why` goes to onNotice. */
  restart(why: string): Promise<void>
}

interface MicOptions {
  /** A deviceId from listMicrophones, or null for the system default. */
  deviceId: string | null
  /** Each 100 ms chunk of PCM. */
  onChunk?(pcm: ArrayBuffer): void
  /** Peak level of each chunk, 0 to 1. */
  onLevel?(peak: number): void
  /** Something happened to the microphone that the capture is recovering from, for the operator's event log. */
  onNotice?(text: string): void
}

/** How often to try opening the microphone again while it cannot be opened. */
const REOPEN_RETRY_MS = 2000
/** A track the system keeps muted this long is reopened. */
const MUTED_RESTART_MS = 5000

const DENIED =
  'WorshipDeck is not allowed to use the microphone. On a Mac, turn it on in System Settings > Privacy & Security > Microphone, then try again.'

/** A sentence for the operator from a getUserMedia or permission failure. */
export function micErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return DENIED
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'The chosen microphone was not found. Plug it in, or pick another one in Settings.'
  }
  if (name === 'NotReadableError') return 'The microphone could not be opened. Another app may be using it.'
  return error instanceof Error ? error.message : String(error)
}

interface Opened {
  stream: MediaStream
  context: AudioContext
  close(): void
}

/** Opens a device (null for the system default) into the worklet. Throws getUserMedia's own errors. */
async function open(deviceId: string | null, onData: (data: { pcm: ArrayBuffer; peak: number }) => void): Promise<Opened> {
  const stream = await navigator.mediaDevices.getUserMedia({
    // Echo cancellation would fight the room's PA; the speech engine wants the plain signal.
    audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: 1, echoCancellation: false },
  })
  const context = new AudioContext()
  const close = () => {
    for (const track of stream.getTracks()) track.stop()
    context.close().catch(() => undefined)
  }
  try {
    await context.audioWorklet.addModule(workletUrl)
    const source = context.createMediaStreamSource(stream)
    const chunker = new AudioWorkletNode(context, 'pcm-chunker')
    chunker.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer; peak: number }>) => onData(event.data)
    // Connected through a silent gain so the graph pulls audio through the worklet without playing it.
    const mute = context.createGain()
    mute.gain.value = 0
    source.connect(chunker).connect(mute).connect(context.destination)
    await context.resume()
  } catch (error) {
    close()
    throw error
  }
  return { stream, context, close }
}

const isMissing = (error: unknown) => error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'OverconstrainedError')

/**
 * Captures until stop, recovering by itself: a suspended AudioContext is resumed, and a track that ends (or stays
 * muted) is opened again. If the chosen device was unplugged, the system default is used until it is plugged back in.
 */
export async function startMic({ deviceId, onChunk, onLevel, onNotice }: MicOptions): Promise<MicCapture> {
  if (!(await window.api.speech.micAccess())) throw new Error(DENIED)
  const onData = (data: { pcm: ArrayBuffer; peak: number }) => {
    onChunk?.(data.pcm)
    onLevel?.(data.peak)
  }
  let current: Opened | null
  try {
    current = await open(deviceId, onData)
  } catch (error) {
    throw new Error(micErrorMessage(error))
  }
  let stopped = false
  let reopening: Promise<void> | null = null
  /** On the system default because the chosen device is missing. */
  let onFallback = false

  /** Opens the chosen device, or the default when it is missing. */
  async function openBest(): Promise<Opened> {
    if (!deviceId) return open(null, onData)
    try {
      const opened = await open(deviceId, onData)
      if (onFallback) onNotice?.('Back on the chosen microphone.')
      onFallback = false
      return opened
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    const opened = await open(null, onData)
    if (!onFallback) onNotice?.('The chosen microphone is not connected; using the system default until it is plugged back in.')
    onFallback = true
    return opened
  }

  function restart(why: string): Promise<void> {
    if (stopped) return Promise.resolve()
    reopening ??= (async () => {
      onNotice?.(why)
      const old = current
      current = null
      old?.close()
      while (!stopped) {
        try {
          const opened = await openBest()
          if (stopped) return opened.close()
          current = opened
          watch(opened)
          onNotice?.('The microphone is open again.')
          return
        } catch (error) {
          onNotice?.(`Could not open the microphone: ${micErrorMessage(error)} Trying again in ${REOPEN_RETRY_MS / 1000} s.`)
          await new Promise((resolve) => setTimeout(resolve, REOPEN_RETRY_MS))
        }
      }
    })().finally(() => (reopening = null))
    return reopening
  }

  function watch(opened: Opened) {
    const live = () => !stopped && current === opened
    const track = opened.stream.getAudioTracks()[0]
    let mutedTimer: ReturnType<typeof setTimeout> | undefined
    track?.addEventListener('ended', () => live() && void restart('The microphone stopped (unplugged, or taken by another app).'))
    track?.addEventListener('mute', () => {
      if (!live()) return
      onNotice?.('The system muted the microphone.')
      mutedTimer = setTimeout(() => live() && track.muted && void restart('The microphone stayed muted for 5 seconds.'), MUTED_RESTART_MS)
    })
    track?.addEventListener('unmute', () => {
      clearTimeout(mutedTimer)
      if (live()) onNotice?.('The microphone is sending sound again.')
    })
    opened.context.addEventListener('statechange', () => {
      if (!live()) return
      const state = opened.context.state
      if (state === 'closed') void restart('Audio processing closed unexpectedly.')
      else if (state !== 'running') {
        onNotice?.(`Audio processing was ${state}; resuming it.`)
        opened.context.resume().catch(() => void restart('Audio processing could not be resumed.'))
      }
    })
  }

  // Switch back when the chosen device is plugged in again.
  const deviceChange = () => {
    if (stopped || !onFallback || !deviceId) return
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      if (devices.some((d) => d.kind === 'audioinput' && d.deviceId === deviceId)) void restart('The chosen microphone was plugged back in.')
    }, console.error)
  }
  navigator.mediaDevices.addEventListener('devicechange', deviceChange)
  watch(current)

  return {
    stop() {
      stopped = true
      navigator.mediaDevices.removeEventListener('devicechange', deviceChange)
      current?.close()
      current = null
    },
    restart,
  }
}

/** Audio inputs. Labels are empty until the microphone has been allowed once. */
export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
}

/** A peak level (0 to 1) as a meter fraction over a 60 dB range. */
export function meterFraction(peak: number): number {
  if (peak <= 0) return 0
  return Math.max(0, Math.min(1, (20 * Math.log10(peak) + 60) / 60))
}

// Microphone capture for the sermon listener and the Settings level meter: getUserMedia into an AudioWorklet that
// hands back 16 kHz mono 16-bit PCM in 100 ms chunks.

const workletUrl = new URL('./pcmWorklet.js', import.meta.url).href

export interface MicCapture {
  stop(): void
  /** Closes the microphone and opens it again, as when it went away; `why` goes to onNotice. */
  restart(why: string): Promise<void>
}

/** The device in use, for the listener log. */
export interface MicDevice {
  label: string
  /** The device's own rate (the capture converts to 16 kHz). */
  sampleRate: number
  /** Guessed from the name, which browsers on macOS end with "(Bluetooth)". */
  bluetooth: boolean
}

interface MicOptions {
  /** A deviceId from listMicrophones, or null for the system default. */
  deviceId: string | null
  /** Echo cancellation, noise suppression and automatic gain, for room microphones. Off sends the plain signal. */
  processing?: boolean
  /** Each 100 ms chunk of PCM. */
  onChunk?(pcm: ArrayBuffer): void
  /** Peak level of each chunk, 0 to 1. */
  onLevel?(peak: number): void
  /** Something happened to the microphone that the capture is recovering from, for the operator's event log. */
  onNotice?(text: string): void
  /** Each device opened: at the start, and after the device is opened again. */
  onDevice?(device: MicDevice): void
  /**
   * True when the track goes quiet and silence is sent in its place (`cause` says why: the system muted it, it
   * ended, or the device is being opened again); false when real audio is back.
   */
  onMute?(muted: boolean, cause?: 'muted' | 'ended' | 'reopening'): void
}

/** How often to try opening the microphone again while it cannot be opened. */
const REOPEN_RETRY_MS = 2000
/** A track muted (or ended) this long is opened again; shorter dropouts are bridged with silence. */
const DROPOUT_GRACE_MS = 15_000
/** One 100 ms chunk of 16 kHz 16-bit silence, as the worklet would send. */
const CHUNK_MS = 100
const CHUNK_BYTES = 3200

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
  device: MicDevice
  close(): void
}

/** Opens a device (null for the system default) into the worklet. Throws getUserMedia's own errors. */
async function openDevice(deviceId: string | null, processing: boolean, onData: (data: { pcm: ArrayBuffer; peak: number }) => void): Promise<Opened> {
  const stream = await navigator.mediaDevices.getUserMedia({
    // The speech engine wants the plain signal: echo cancellation fights the room's PA, and the system's processing
    // can mute the track. "Processing for room microphones" in Settings turns it back on.
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      channelCount: 1,
      echoCancellation: processing,
      noiseSuppression: processing,
      autoGainControl: processing,
    },
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
  const track = stream.getAudioTracks()[0]
  const label = track?.label || 'Unknown microphone'
  const device = {
    label,
    sampleRate: track?.getSettings().sampleRate ?? context.sampleRate,
    bluetooth: /bluetooth|airpods|hands-?free|\bbt\b/i.test(label),
  }
  return { stream, context, device, close }
}

const isMissing = (error: unknown) => error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'OverconstrainedError')

/**
 * Captures until stop, recovering by itself: a suspended AudioContext is resumed; while the track is muted or has
 * ended, silence is sent in its place so the engine's stream stays continuous, and only after 15 seconds of that is
 * the device opened again. If the chosen device was unplugged, the system default is used until it is plugged back in.
 */
export async function startMic({ deviceId, processing = false, onChunk, onLevel, onNotice, onDevice, onMute }: MicOptions): Promise<MicCapture> {
  if (!(await window.api.speech.micAccess())) throw new Error(DENIED)
  /** Sends silence every 100 ms while the track gives nothing; null while real audio flows. */
  let silence: ReturnType<typeof setInterval> | null = null
  let droppedAt = 0
  const onData = (data: { pcm: ArrayBuffer; peak: number }) => {
    // A muted track may still deliver (silent) chunks; the stand-in silence replaces them so time is not counted twice.
    if (silence) return
    onChunk?.(data.pcm)
    onLevel?.(data.peak)
  }
  const open = (id: string | null) => openDevice(id, processing, onData)

  /** The track went quiet: fill the gap with silence. */
  function dropout(cause: 'muted' | 'ended' | 'reopening') {
    if (silence) return
    droppedAt = Date.now()
    onLevel?.(0)
    onMute?.(true, cause)
    silence = setInterval(() => onChunk?.(new ArrayBuffer(CHUNK_BYTES)), CHUNK_MS)
  }

  /** Real audio is back. */
  function recovered() {
    if (!silence) return
    clearInterval(silence)
    silence = null
    onMute?.(false)
    onNotice?.(`Sound is back after ${((Date.now() - droppedAt) / 1000).toFixed(1)} s of silence.`)
  }

  let current: Opened | null
  try {
    current = await open(deviceId)
  } catch (error) {
    throw new Error(micErrorMessage(error))
  }
  onDevice?.(current.device)
  let stopped = false
  let reopening: Promise<void> | null = null
  /** On the system default because the chosen device is missing. */
  let onFallback = false

  /** Opens the chosen device, or the default when it is missing. */
  async function openBest(): Promise<Opened> {
    if (!deviceId) return open(null)
    try {
      const opened = await open(deviceId)
      if (onFallback) onNotice?.('Back on the chosen microphone.')
      onFallback = false
      return opened
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    const opened = await open(null)
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
      // Silence keeps the stream going until the device is open again.
      dropout('reopening')
      while (!stopped) {
        try {
          const opened = await openBest()
          if (stopped) return opened.close()
          current = opened
          watch(opened)
          onNotice?.('The microphone is open again.')
          onDevice?.(opened.device)
          recovered()
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
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    /** Bridges the gap with silence, and opens the device again only if it lasts more than 15 seconds. */
    const bridge = (cause: 'muted' | 'ended', what: string) => {
      dropout(cause)
      clearTimeout(graceTimer)
      graceTimer = setTimeout(() => {
        if (live() && (track.muted || track.readyState === 'ended')) void restart(`The microphone ${what} for more than 15 seconds.`)
      }, DROPOUT_GRACE_MS)
    }
    track?.addEventListener('ended', () => {
      if (!live()) return
      onNotice?.('The microphone stopped (unplugged, or taken by another app); sending silence, and opening it again in 15 s.')
      bridge('ended', 'was gone')
    })
    track?.addEventListener('mute', () => {
      if (!live()) return
      onNotice?.('The system muted the microphone; sending silence until it is back.')
      bridge('muted', 'stayed muted')
    })
    track?.addEventListener('unmute', () => {
      clearTimeout(graceTimer)
      if (live()) recovered()
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
      if (silence) clearInterval(silence)
      silence = null
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

// Microphone capture for the sermon listener and the Settings level meter: getUserMedia into an AudioWorklet that
// hands back 16 kHz mono 16-bit PCM in 100 ms chunks.

const workletUrl = new URL('./pcmWorklet.js', import.meta.url).href

export interface MicCapture {
  stop(): void
}

interface MicOptions {
  /** A deviceId from listMicrophones, or null for the system default. */
  deviceId: string | null
  /** Each 100 ms chunk of PCM. */
  onChunk?(pcm: ArrayBuffer): void
  /** Peak level of each chunk, 0 to 1. */
  onLevel?(peak: number): void
  /** The microphone went away (unplugged, or access taken back). */
  onEnded?(): void
}

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

export async function startMic({ deviceId, onChunk, onLevel, onEnded }: MicOptions): Promise<MicCapture> {
  if (!(await window.api.speech.micAccess())) throw new Error(DENIED)
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // Echo cancellation would fight the room's PA; the speech engine wants the plain signal.
      audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: 1, echoCancellation: false },
    })
  } catch (error) {
    throw new Error(micErrorMessage(error))
  }

  const context = new AudioContext()
  const stop = () => {
    for (const track of stream.getTracks()) track.stop()
    context.close().catch(() => undefined)
  }
  try {
    await context.audioWorklet.addModule(workletUrl)
    const source = context.createMediaStreamSource(stream)
    const chunker = new AudioWorkletNode(context, 'pcm-chunker')
    chunker.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer; peak: number }>) => {
      onChunk?.(event.data.pcm)
      onLevel?.(event.data.peak)
    }
    // Connected through a silent gain so the graph pulls audio through the worklet without playing it.
    const mute = context.createGain()
    mute.gain.value = 0
    source.connect(chunker).connect(mute).connect(context.destination)
    await context.resume()
  } catch (error) {
    stop()
    throw error
  }
  stream.getAudioTracks()[0]?.addEventListener('ended', () => onEnded?.())
  return { stop }
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

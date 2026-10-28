// Microphone capture for the sermon listener and the Settings level meter: getUserMedia into an AudioWorklet that
// hands back 16 kHz mono 16-bit PCM in 100 ms chunks, with level readings for the meter.

import type { MicChannel } from '../../shared/types'

const workletUrl = new URL('./pcmWorklet.js', import.meta.url).href

/** What the worklet does to the signal; changed while capturing with MicCapture.configure. */
export interface MicDsp {
  channel: MicChannel
  gainDb: number
  highPass: boolean
  noiseGate: boolean
  gateThresholdDb: number
}

export const DEFAULT_DSP: MicDsp = { channel: 'mono', gainDb: 0, highPass: true, noiseGate: false, gateThresholdDb: -60 }

export interface MicCapture {
  stop(): void
  /** Closes the microphone and opens it again, as when it went away; `why` goes to onNotice. */
  restart(why: string): Promise<void>
  /** Applies new channel, gain, filter and gate settings at once. */
  configure(dsp: MicDsp): void
}

/** The device in use, for the listener log and panel. */
export interface MicDevice {
  deviceId: string
  label: string
  /** The device's own rate (the capture converts to 16 kHz). */
  sampleRate: number
  /** Channels the device delivers. */
  channels: number
  /** Guessed from the name, which browsers on macOS end with "(Bluetooth)". */
  bluetooth: boolean
}

/** One 100 ms chunk's levels, measured after the gain and high-pass and before the gate and limiter. */
export interface MicReading {
  /** 0 to 1, or above 1 when the gain pushes past full scale (the limiter then holds it). */
  peak: number
  rms: number
  /** Clipped on the way in, or the gain took it past full scale. */
  clipped: boolean
  /** The signal was already clipped when it arrived, so lowering the gain here cannot help. */
  sourceClipped: boolean
  /** How far the limiter turned the signal down, in dB. */
  limitingDb: number
  channels: number
  /** RMS of the first two channels and of their difference; null on a mono input. */
  stereo: { left: number; right: number; difference: number } | null
  /** The chosen channel is not on this input, so all its channels are mixed instead. */
  channelMissing: boolean
}

/**
 * open: audio is flowing. muted: the track went quiet and silence is sent in its place. reopening: the device is being
 * opened again. waiting: the chosen device is not connected; it is opened as soon as it is plugged back in.
 */
export type MicState = 'open' | 'muted' | 'reopening' | 'waiting'

interface MicOptions {
  /** A deviceId from listMicrophones, or null for the system default. */
  deviceId: string | null
  /** The chosen device's name, to find it when its deviceId has changed. */
  deviceName?: string | null
  /** Echo cancellation, noise suppression and automatic gain, for room microphones. Off sends the plain signal. */
  processing?: boolean
  dsp?: Partial<MicDsp>
  /** Each 100 ms chunk of PCM. */
  onChunk?(pcm: ArrayBuffer): void
  /** Peak level of each chunk, 0 to 1. */
  onLevel?(peak: number): void
  /** Each chunk's levels; null while silence is sent in place of the input. */
  onReading?(reading: MicReading | null): void
  /** Something happened to the microphone that the capture is recovering from, for the operator's event log. */
  onNotice?(text: string): void
  /** Each device opened: at the start, and after the device is opened again. */
  onDevice?(device: MicDevice): void
  onState?(state: MicState): void
  /**
   * True when the track goes quiet and silence is sent in its place (`cause` says why: the system muted it, it
   * ended, the device is being opened again, or it is unplugged); false when real audio is back.
   */
  onMute?(muted: boolean, cause?: 'muted' | 'ended' | 'reopening' | 'waiting'): void
}

/** How often to try opening the microphone again while it cannot be opened. */
const REOPEN_RETRY_MS = 2000
/** A Bluetooth track muted (or ended) this long is opened again; shorter dropouts are bridged with silence. */
const DROPOUT_GRACE_MS = 15_000
/** A wired device should never be muted by the system; if it is, it is opened again after this long. */
const WIRED_MUTE_GRACE_MS = 2000
/** One 100 ms chunk of 16 kHz 16-bit silence, as the worklet would send. */
const CHUNK_MS = 100
const CHUNK_BYTES = 3200

const DENIED =
  'ServiceEx is not allowed to use the microphone. On a Mac, turn it on in System Settings > Privacy & Security > Microphone, then try again.'

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
  node: AudioWorkletNode
  device: MicDevice
  close(): void
}

/** What the device says it can do, where the browser can tell without opening it. */
export interface MicCapabilities {
  channels: number | null
  sampleRate: number | null
}

export function capabilitiesOf(device: MediaDeviceInfo | undefined): MicCapabilities {
  const caps = (device as InputDeviceInfo | undefined)?.getCapabilities?.()
  return { channels: caps?.channelCount?.max ?? null, sampleRate: caps?.sampleRate?.max ?? null }
}

/** The deviceId to open: the saved one, or the device with the saved name when the id has changed. Null for the default. */
async function findDevice(deviceId: string | null, deviceName: string | null): Promise<string | null> {
  if (!deviceId && !deviceName) return null
  const inputs = await listMicrophones()
  if (deviceId && inputs.some((d) => d.deviceId === deviceId)) return deviceId
  const named = deviceName ? inputs.find((d) => d.label === deviceName) : undefined
  if (named) return named.deviceId
  // Names are empty before the microphone has been allowed; let getUserMedia decide.
  if (deviceId && inputs.every((d) => !d.label)) return deviceId
  throw new DOMException('The chosen microphone is not connected.', 'NotFoundError')
}

/** Opens a device (null for the system default) into the worklet. Throws getUserMedia's own errors. */
async function openDevice(deviceId: string | null, processing: boolean, dsp: MicDsp, onData: (data: { pcm: ArrayBuffer; peak: number; reading: MicReading }) => void): Promise<Opened> {
  const listed = (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === 'audioinput' && d.deviceId === (deviceId ?? 'default'))
  const caps = capabilitiesOf(listed)
  const stream = await navigator.mediaDevices.getUserMedia({
    // The speech engine wants the plain signal: echo cancellation fights the room's PA, and the system's processing
    // can mute the track. "Processing for room microphones" in Settings turns it back on (and with it, mono).
    // Without processing every channel is asked for, so one can be picked from a multichannel interface.
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      channelCount: processing ? 1 : { ideal: caps.channels ?? 2 },
      echoCancellation: processing,
      noiseSuppression: processing,
      autoGainControl: processing,
    },
  })
  const track = stream.getAudioTracks()[0]
  const settings = track?.getSettings() ?? {}
  let context: AudioContext
  try {
    // At the device's own rate, so the browser does not resample it first; the worklet's filter does that properly.
    context = settings.sampleRate ? new AudioContext({ sampleRate: settings.sampleRate }) : new AudioContext()
  } catch {
    context = new AudioContext()
  }
  const close = () => {
    for (const t of stream.getTracks()) t.stop()
    context.close().catch(() => undefined)
  }
  let node: AudioWorkletNode
  let channels = settings.channelCount ?? 1
  try {
    await context.audioWorklet.addModule(workletUrl)
    const source = context.createMediaStreamSource(stream)
    channels = Math.max(1, settings.channelCount ?? source.channelCount)
    node = new AudioWorkletNode(context, 'pcm-chunker', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      // Every channel kept apart, so the worklet can pick one.
      channelCount: Math.min(32, channels),
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
      processorOptions: dsp,
    })
    node.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer; peak: number; reading: MicReading }>) => onData(event.data)
    // Connected through a silent gain so the graph pulls audio through the worklet without playing it.
    const mute = context.createGain()
    mute.gain.value = 0
    source.connect(node).connect(mute).connect(context.destination)
    await context.resume()
  } catch (error) {
    close()
    throw error
  }
  const label = track?.label || 'Unknown microphone'
  const device = {
    deviceId: settings.deviceId ?? deviceId ?? '',
    label,
    sampleRate: settings.sampleRate ?? context.sampleRate,
    channels,
    bluetooth: /bluetooth|airpods|hands-?free|\bbt\b/i.test(label),
  }
  return { stream, context, node, device, close }
}

const isMissing = (error: unknown) => error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'OverconstrainedError')

/**
 * Captures until stop, recovering by itself: a suspended AudioContext is resumed; while the track is muted, has ended
 * or is being opened again, silence is sent in its place so the engine's stream stays continuous. A wired device that
 * ends or disappears is opened again at once (a Bluetooth one gets 15 seconds to come back by itself). If the chosen
 * device is unplugged, the capture waits for it, sending silence, and opens it as soon as it is plugged back in.
 */
export async function startMic(options: MicOptions): Promise<MicCapture> {
  const { deviceId, deviceName = null, processing = false, onChunk, onLevel, onReading, onNotice, onDevice, onState, onMute } = options
  if (!(await window.api.speech.micAccess())) throw new Error(DENIED)
  let dsp: MicDsp = { ...DEFAULT_DSP, ...options.dsp }
  /** Sends silence every 100 ms while the track gives nothing; null while real audio flows. */
  let silence: ReturnType<typeof setInterval> | null = null
  let droppedAt = 0
  const onData = (data: { pcm: ArrayBuffer; peak: number; reading: MicReading }) => {
    // A muted track may still deliver (silent) chunks; the stand-in silence replaces them so time is not counted twice.
    if (silence) return
    onChunk?.(data.pcm)
    onLevel?.(data.peak)
    onReading?.(data.reading)
  }
  const chosen = deviceName ?? 'the chosen input'
  const open = async () => openDevice(await findDevice(deviceId, deviceName), processing, dsp, onData)

  /** The track went quiet: fill the gap with silence. */
  function dropout(cause: 'muted' | 'ended' | 'reopening' | 'waiting') {
    if (silence) return
    droppedAt = Date.now()
    onLevel?.(0)
    onReading?.(null)
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

  let current: Opened | null = null
  let stopped = false
  let reopening: Promise<void> | null = null
  /** Ends the wait between attempts early, when a device is plugged in. */
  let wake: (() => void) | null = null

  function restart(why: string): Promise<void> {
    if (stopped) return Promise.resolve()
    reopening ??= (async () => {
      onNotice?.(why)
      const old = current
      current = null
      old?.close()
      // Silence keeps the stream going until the device is open again.
      dropout('reopening')
      onState?.('reopening')
      let waiting = false
      while (!stopped) {
        try {
          const opened = await open()
          if (stopped) return opened.close()
          current = opened
          watch(opened)
          onNotice?.(waiting ? `${opened.device.label} is connected again.` : 'The microphone is open again.')
          onDevice?.(opened.device)
          recovered()
          onState?.('open')
          return
        } catch (error) {
          if (isMissing(error) && (deviceId || deviceName)) {
            if (!waiting) onNotice?.(`${chosen} is not connected; sending silence and waiting for it to be plugged back in.`)
            waiting = true
            onState?.('waiting')
          } else {
            onNotice?.(`Could not open the microphone: ${micErrorMessage(error)} Trying again in ${REOPEN_RETRY_MS / 1000} s.`)
          }
          await new Promise<void>((resolve) => {
            wake = resolve
            setTimeout(resolve, REOPEN_RETRY_MS)
          })
          wake = null
        }
      }
    })().finally(() => (reopening = null))
    return reopening
  }

  function watch(opened: Opened) {
    const live = () => !stopped && current === opened
    const track = opened.stream.getAudioTracks()[0]
    const wired = !opened.device.bluetooth
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    /** Bridges the gap with silence, and opens the device again only if it lasts longer than `grace`. */
    const bridge = (cause: 'muted' | 'ended', what: string, grace: number) => {
      dropout(cause)
      onState?.('muted')
      clearTimeout(graceTimer)
      graceTimer = setTimeout(() => {
        if (live() && (track.muted || track.readyState === 'ended')) void restart(`The microphone ${what} for more than ${grace / 1000} seconds.`)
      }, grace)
    }
    track?.addEventListener('ended', () => {
      if (!live()) return
      // A wired device does not come back by itself: open it again now (or wait for it, if it was unplugged).
      if (wired) void restart(`${opened.device.label} stopped (unplugged, or taken by another app); opening it again now.`)
      else {
        onNotice?.('The microphone stopped (unplugged, or taken by another app); sending silence, and opening it again in 15 s.')
        bridge('ended', 'was gone', DROPOUT_GRACE_MS)
      }
    })
    track?.addEventListener('mute', () => {
      if (!live()) return
      if (wired) {
        onNotice?.(`The system muted ${opened.device.label}, which a wired input should not do; sending silence until it is back.`)
        bridge('muted', 'stayed muted', WIRED_MUTE_GRACE_MS)
      } else {
        onNotice?.('The system muted the microphone; sending silence until it is back.')
        bridge('muted', 'stayed muted', DROPOUT_GRACE_MS)
      }
    })
    track?.addEventListener('unmute', () => {
      clearTimeout(graceTimer)
      if (!live()) return
      recovered()
      onState?.('open')
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

  // A device was plugged in or out: end a wait at once, or open the device again when the one in use has gone.
  const deviceChange = () => {
    if (stopped) return
    if (wake) return wake()
    const inUse = current
    if (!inUse || !deviceId) return
    listMicrophones().then((inputs) => {
      if (current === inUse && !inputs.some((d) => d.deviceId === inUse.device.deviceId)) {
        void restart(`${inUse.device.label} was unplugged.`)
      }
    }, console.error)
  }
  navigator.mediaDevices.addEventListener('devicechange', deviceChange)

  try {
    current = await open()
  } catch (error) {
    if (!isMissing(error) || (!deviceId && !deviceName)) {
      navigator.mediaDevices.removeEventListener('devicechange', deviceChange)
      throw new Error(micErrorMessage(error))
    }
    // The chosen device is unplugged: start anyway, sending silence until it is connected.
    void restart(`${chosen} is not connected.`)
  }
  if (current) {
    onDevice?.(current.device)
    onState?.('open')
    watch(current)
  }

  return {
    stop() {
      stopped = true
      wake?.()
      if (silence) clearInterval(silence)
      silence = null
      navigator.mediaDevices.removeEventListener('devicechange', deviceChange)
      current?.close()
      current = null
    },
    restart,
    configure(next) {
      dsp = { ...next }
      current?.node.port.postMessage(dsp)
    },
  }
}

/** Audio inputs. Labels are empty until the microphone has been allowed once. */
export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
}

/** The meter's range: -60 dBFS to 0. */
const METER_FLOOR_DB = -60

/** A level (0 to 1) in dBFS; -Infinity for silence. */
export const toDb = (level: number) => (level > 0 ? 20 * Math.log10(level) : -Infinity)

/** A peak level (0 to 1) as a meter fraction over a 60 dB range. */
export function meterFraction(peak: number): number {
  if (peak <= 0) return 0
  return Math.max(0, Math.min(1, (toDb(peak) - METER_FLOOR_DB) / -METER_FLOOR_DB))
}

/** Aim for speech averaging about -18 dBFS, with peaks below -6 dBFS. */
export const TARGET_RMS_DB = -18
export const TARGET_PEAK_DB = -6

export interface SignalAdvice {
  level: 'error' | 'warning' | 'info'
  text: string
}

/** Readings looked back over: five seconds. */
const WATCH_READINGS = 50
/** The last three seconds, for clipping and hot peaks. */
const RECENT_READINGS = 30
/** A channel this quiet (RMS) counts as silent, beside one with speech on it. */
const SILENT_DB = -70
const SOUND_DB = -50

/**
 * Watches the last five seconds of readings and says what is wrong with the signal: clipping, too hot, too quiet, no
 * signal, a mono feed on both sides of a stereo input, or one side silent. Most serious first; empty when all is well.
 */
export class SignalWatch {
  private readings: MicReading[] = []

  push(reading: MicReading | null) {
    if (!reading) return void (this.readings = [])
    this.readings.push(reading)
    if (this.readings.length > WATCH_READINGS) this.readings.shift()
  }

  advice(channel: MicChannel): SignalAdvice[] {
    const all = this.readings
    if (all.length < 10) return []
    const recent = all.slice(-RECENT_READINGS)
    const found: SignalAdvice[] = []
    const peakDb = (list: MicReading[]) => toDb(Math.max(...list.map((r) => r.peak)))

    if (recent.some((r) => r.sourceClipped)) {
      found.push({ level: 'error', text: 'Clipping before it arrives: turn the send down at the desk or interface.' })
    } else if (recent.some((r) => r.clipped)) {
      found.push({ level: 'error', text: 'Clipping: lower the input gain.' })
    } else if (peakDb(recent) > TARGET_PEAK_DB) {
      found.push({ level: 'warning', text: `Peaks above ${TARGET_PEAK_DB} dBFS: lower the input gain a little.` })
    }
    const loudest = peakDb(all)
    if (all.length >= WATCH_READINGS && loudest < -90) {
      found.push({ level: 'error', text: 'No signal: check the cable, the channel chosen, and that the desk is sending.' })
    } else if (all.length >= WATCH_READINGS && loudest < -30) {
      found.push({ level: 'warning', text: 'Too quiet: raise the input gain, or the send from the desk.' })
    }

    const last = all.at(-1)!
    if (last.channelMissing) {
      found.push({ level: 'warning', text: `This input has ${last.channels} channel${last.channels === 1 ? '' : 's'}, so the chosen channel is not on it; mixing all of them.` })
    }
    const stereo = all.map((r) => r.stereo).filter((s): s is NonNullable<MicReading['stereo']> => s !== null)
    const sounding = stereo.filter((s) => toDb(Math.max(s.left, s.right)) > SOUND_DB)
    if (sounding.length >= 10) {
      const leftSilent = sounding.every((s) => toDb(s.left) < SILENT_DB)
      const rightSilent = sounding.every((s) => toDb(s.right) < SILENT_DB)
      const identical = sounding.every((s) => s.difference < Math.max(s.left, s.right) * 0.01)
      if (leftSilent || rightSilent) {
        const silent = leftSilent ? 'left' : 'right'
        const other = leftSilent ? 'Right' : 'Left'
        found.push(
          channel === silent
            ? { level: 'error', text: `The ${silent} channel, the one chosen, is silent: choose ${other}.` }
            : { level: 'warning', text: `The ${silent} channel is silent${channel === 'mono' ? ', which halves the mono mix' : ''}: choose ${other}.` },
        )
      } else if (identical) {
        found.push({ level: 'info', text: 'Left and right are identical: a mono feed on a stereo input. Mono or Left is fine.' })
      }
    }
    return found
  }
}

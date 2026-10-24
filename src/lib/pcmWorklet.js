// Audio thread. Turns the input (any sample rate, any channel count) into 16 kHz mono 16-bit PCM and posts it in
// 100 ms chunks, each with level readings for the meter. Plain JavaScript: it is loaded by audioWorklet.addModule.
// The steps, in order: pick or mix the channel, input gain, 80 Hz high-pass, meter, noise gate, limiter, resample.
// They are exported for the tests; the processor itself is only registered on the audio thread.
/* global sampleRate */

export const TARGET_RATE = 16000
const CHUNK_SAMPLES = TARGET_RATE / 10

/** The limiter keeps peaks at or below -1 dBFS. */
const LIMIT_CEILING = Math.pow(10, -1 / 20)
/** A closed gate lowers the signal by 18 dB rather than muting it, so quiet words still get through. */
const GATE_FLOOR = Math.pow(10, -18 / 20)
/** The gate closes this far below its threshold, so it does not chatter on a level near it. */
const GATE_HYSTERESIS_DB = 4
const GATE_HOLD_SECONDS = 0.15
/** A raw sample this close to full scale means the signal clipped before it arrived. */
const SOURCE_CLIP = 0.999

const dbToGain = (db) => Math.pow(10, db / 20)
/** A one-pole smoothing coefficient for the time constant. */
const smoothing = (seconds, rate) => 1 - Math.exp(-1 / (seconds * rate))

/**
 * Fills `out` with the chosen channel ('left', 'right' or a number from 1), or with the average of all channels for
 * 'mono'. Returns false when the input lacks the chosen channel, in which case all channels are mixed instead.
 */
export function pickChannel(channels, choice, out) {
  const index = choice === 'left' ? 0 : choice === 'right' ? 1 : typeof choice === 'number' ? choice - 1 : -1
  if (index >= 0 && index < channels.length) {
    out.set(channels[index])
    return true
  }
  out.fill(0)
  for (const channel of channels) {
    for (let i = 0; i < out.length; i++) out[i] += channel[i]
  }
  // Averaging (not summing) keeps a mono feed sent on both sides at its own level and cannot clip.
  const scale = 1 / Math.max(1, channels.length)
  for (let i = 0; i < out.length; i++) out[i] *= scale
  return index < 0
}

/** Zeroth-order modified Bessel function, for the Kaiser window. */
function besselI0(x) {
  let sum = 1
  let term = 1
  for (let k = 1; k < 50; k++) {
    term *= (x / (2 * k)) * (x / (2 * k))
    sum += term
    if (term < sum * 1e-12) break
  }
  return sum
}

/**
 * Band-limited sample rate conversion: a Kaiser-windowed sinc filter (about 80 dB of stopband) evaluated at each
 * output sample's fractional position, from a finely sampled table. The passband reaches 45% of the lower rate
 * (7.2 kHz for 16 kHz output), and anything that would fold back into it is removed first.
 */
export class Resampler {
  constructor(inRate, outRate) {
    this.step = inRate / outRate
    this.bypass = inRate === outRate
    if (this.bypass) return
    const lower = Math.min(inRate, outRate)
    /** Cutoff in cycles per input sample. */
    const cutoff = (0.45 * lower) / inRate
    /** From the cutoff to where aliases would land in the passband, in cycles per input sample. */
    const transition = (lower - 2 * 0.45 * lower) / inRate
    const attenuation = 80
    const beta = 0.1102 * (attenuation - 8.7)
    const taps = Math.ceil((attenuation - 7.95) / (2.285 * 2 * Math.PI * transition))
    /** Input samples each side of the output position. */
    this.half = Math.max(2, Math.ceil(taps / 2))
    this.phases = 256
    const span = 2 * this.half * this.phases
    this.table = new Float32Array(span + 2)
    const norm = besselI0(beta)
    for (let i = 0; i <= span; i++) {
      const x = i / this.phases - this.half
      const r = x / this.half
      const window = Math.abs(r) >= 1 ? 0 : besselI0(beta * Math.sqrt(1 - r * r)) / norm
      const arg = 2 * cutoff * x
      const sinc = arg === 0 ? 1 : Math.sin(Math.PI * arg) / (Math.PI * arg)
      this.table[i] = 2 * cutoff * sinc * window
    }
    this.buffer = new Float32Array(4096 + 2 * this.half)
    // Starts with silence on the left, so the first output has its full history.
    this.length = this.half
    this.position = this.half
  }

  /** Calls emit with each output sample the new input completes. */
  process(input, emit) {
    if (this.bypass) {
      for (let i = 0; i < input.length; i++) emit(input[i])
      return
    }
    const half = this.half
    if (this.length + input.length > this.buffer.length) {
      // Drop what no output still needs, then grow if that is not enough.
      const drop = Math.max(0, Math.floor(this.position) - half + 1)
      this.buffer.copyWithin(0, drop, this.length)
      this.length -= drop
      this.position -= drop
      if (this.length + input.length > this.buffer.length) {
        const grown = new Float32Array((this.length + input.length) * 2)
        grown.set(this.buffer.subarray(0, this.length))
        this.buffer = grown
      }
    }
    this.buffer.set(input, this.length)
    this.length += input.length
    const { buffer, table, phases } = this
    while (Math.floor(this.position) + half < this.length) {
      const base = Math.floor(this.position)
      const at = (this.position - base + 2 * half - 1) * phases
      const index = Math.floor(at)
      const frac = at - index
      let sum = 0
      // Taps from base - half + 1 to base + half; each one further right is one input sample (phases entries) nearer.
      for (let j = 0, k = base - half + 1, t = index; j < 2 * half; j++, k++, t -= phases) {
        sum += buffer[k] * (table[t] + (table[t + 1] - table[t]) * frac)
      }
      emit(sum)
      this.position += this.step
    }
  }
}

/** Gain, high-pass, gate and limiter on the mono signal, at the input's own rate. */
export class Cleanup {
  constructor(rate) {
    this.rate = rate
    // Biquad state (transposed direct form II).
    this.z1 = 0
    this.z2 = 0
    // A second-order Butterworth high-pass at 80 Hz (the RBJ cookbook's coefficients).
    const w0 = (2 * Math.PI * 80) / rate
    const alpha = Math.sin(w0) / (2 * Math.SQRT1_2)
    const cos = Math.cos(w0)
    const a0 = 1 + alpha
    this.hp = { b0: (1 + cos) / 2 / a0, b1: -(1 + cos) / a0, b2: (1 + cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 }
    this.gatePower = 0
    this.gateGain = 1
    this.gateHold = 0
    this.gateDetect = smoothing(0.01, rate)
    this.gateOpening = smoothing(0.002, rate)
    this.gateClosing = smoothing(0.2, rate)
    this.limitEnvelope = 0
    this.limitRelease = Math.exp(-1 / (0.1 * rate))
    this.configure({})
  }

  configure({ gainDb = 0, highPass = true, noiseGate = false, gateThresholdDb = -60 }) {
    this.gain = dbToGain(gainDb)
    this.highPass = highPass
    this.noiseGate = noiseGate
    this.gateOpen = Math.pow(10, gateThresholdDb / 10)
    this.gateClose = Math.pow(10, (gateThresholdDb - GATE_HYSTERESIS_DB) / 10)
  }

  /** Processes the block in place, adding to the meter's figures in `stats` (measured before the gate and limiter). */
  process(block, stats) {
    const { hp } = this
    for (let i = 0; i < block.length; i++) {
      let x = block[i] * this.gain
      if (this.highPass) {
        const y = hp.b0 * x + this.z1
        this.z1 = hp.b1 * x - hp.a1 * y + this.z2
        this.z2 = hp.b2 * x - hp.a2 * y
        x = y
      }
      const level = Math.abs(x)
      if (level > stats.peak) stats.peak = level
      stats.sumSquares += x * x
      stats.count++

      if (this.noiseGate) {
        this.gatePower += (x * x - this.gatePower) * this.gateDetect
        if (this.gatePower >= this.gateOpen) this.gateHold = GATE_HOLD_SECONDS * this.rate
        else if (this.gateHold > 0) this.gateHold--
        const open = this.gateHold > 0 || this.gatePower > this.gateClose
        const target = open ? 1 : GATE_FLOOR
        this.gateGain += (target - this.gateGain) * (target > this.gateGain ? this.gateOpening : this.gateClosing)
        x *= this.gateGain
      } else this.gateGain = 1

      // Instant attack, 100 ms release: the output never passes the ceiling.
      const peak = Math.abs(x)
      this.limitEnvelope = peak > this.limitEnvelope ? peak : this.limitEnvelope * this.limitRelease
      if (this.limitEnvelope > LIMIT_CEILING) {
        const reduction = LIMIT_CEILING / this.limitEnvelope
        x *= reduction
        if (reduction < stats.limiting) stats.limiting = reduction
      }
      block[i] = x
    }
  }
}

if (typeof registerProcessor === 'function') {
  const freshStats = () => ({ peak: 0, sumSquares: 0, count: 0, limiting: 1, sourceClipped: false, left: 0, right: 0, difference: 0, stereoCount: 0 })

  class PcmChunker extends AudioWorkletProcessor {
    constructor(options) {
      super()
      const settings = options.processorOptions ?? {}
      this.channel = settings.channel ?? 'mono'
      this.cleanup = new Cleanup(sampleRate)
      this.cleanup.configure(settings)
      this.resampler = new Resampler(sampleRate, TARGET_RATE)
      this.mono = new Float32Array(128)
      this.chunk = new Int16Array(CHUNK_SAMPLES)
      this.filled = 0
      this.stats = freshStats()
      this.channels = 0
      this.channelMissing = false
      this.emit = (value) => this.push(value)
      // Settings changed while capturing: applied at once, without opening the device again.
      this.port.onmessage = (event) => {
        if (event.data.channel !== undefined) this.channel = event.data.channel
        this.cleanup.configure(event.data)
      }
    }

    process(inputs) {
      const channels = inputs[0]
      if (!channels || channels.length === 0) return true
      const frames = channels[0].length
      if (this.mono.length !== frames) this.mono = new Float32Array(frames)
      this.channels = channels.length
      this.channelMissing = !pickChannel(channels, this.channel, this.mono) && this.channel !== 'mono'
      const stats = this.stats
      for (let i = 0; i < frames; i++) {
        if (Math.abs(this.mono[i]) >= SOURCE_CLIP) stats.sourceClipped = true
      }
      // The first two channels compared, to spot a mono feed on both sides or one side silent.
      if (channels.length >= 2) {
        const [left, right] = channels
        for (let i = 0; i < frames; i++) {
          stats.left += left[i] * left[i]
          stats.right += right[i] * right[i]
          stats.difference += (left[i] - right[i]) * (left[i] - right[i])
        }
        stats.stereoCount += frames
      }
      this.cleanup.process(this.mono, stats)
      this.resampler.process(this.mono, this.emit)
      return true
    }

    push(value) {
      const clamped = Math.max(-1, Math.min(1, value))
      this.chunk[this.filled++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
      if (this.filled < CHUNK_SAMPLES) return
      const s = this.stats
      const pcm = this.chunk.buffer
      const root = (sum, count) => (count ? Math.sqrt(sum / count) : 0)
      this.port.postMessage(
        {
          pcm,
          peak: s.peak,
          reading: {
            peak: s.peak,
            rms: root(s.sumSquares, s.count),
            clipped: s.sourceClipped || s.peak >= 1,
            sourceClipped: s.sourceClipped,
            limitingDb: s.limiting < 1 ? -20 * Math.log10(s.limiting) : 0,
            channels: this.channels,
            stereo: s.stereoCount
              ? { left: root(s.left, s.stereoCount), right: root(s.right, s.stereoCount), difference: root(s.difference, s.stereoCount) }
              : null,
            channelMissing: this.channelMissing,
          },
        },
        [pcm],
      )
      this.chunk = new Int16Array(CHUNK_SAMPLES)
      this.filled = 0
      this.stats = freshStats()
    }
  }

  registerProcessor('pcm-chunker', PcmChunker)
}

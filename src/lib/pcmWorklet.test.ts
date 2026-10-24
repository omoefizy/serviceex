import { describe, expect, it } from 'vitest'
import type { MicReading } from './mic'
import { SignalWatch } from './mic'
import { Cleanup, pickChannel, Resampler } from './pcmWorklet.js'

const sine = (frequency: number, rate: number, seconds: number, amplitude = 0.5) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / rate))

/** RMS of the output after the filter has settled, fed in 128-sample blocks as the audio thread does. */
function resampledRms(input: Float32Array, inRate: number) {
  const resampler = new Resampler(inRate, 16000)
  const out: number[] = []
  for (let i = 0; i < input.length; i += 128) resampler.process(input.subarray(i, i + 128), (s) => out.push(s))
  const settled = out.slice(1600)
  return { count: out.length, rms: Math.sqrt(settled.reduce((sum, s) => sum + s * s, 0) / settled.length) }
}

const db = (x: number) => 20 * Math.log10(x)
const fresh = () => ({ peak: 0, sumSquares: 0, count: 0, limiting: 1 })

describe('Resampler', () => {
  for (const rate of [44100, 48000, 96000]) {
    it(`keeps speech and removes what would alias, from ${rate} Hz`, () => {
      const speech = resampledRms(sine(1000, rate, 1), rate)
      // One second in, one second out (less the filter's delay).
      expect(speech.count).toBeGreaterThan(15800)
      expect(speech.count).toBeLessThanOrEqual(16000)
      expect(Math.abs(db(speech.rms / (0.5 / Math.SQRT2)))).toBeLessThan(0.1)
      // 12 kHz would fold back to 4 kHz with a plain decimator.
      expect(db(resampledRms(sine(12000, rate, 1), rate).rms / (0.5 / Math.SQRT2))).toBeLessThan(-70)
    })
  }

  it('passes 16 kHz through unchanged', () => {
    const input = sine(440, 16000, 0.1)
    const out: number[] = []
    new Resampler(16000, 16000).process(input, (s) => out.push(s))
    expect(out).toEqual(Array.from(input))
  })
})

describe('pickChannel', () => {
  const left = Float32Array.of(0.2, 0.4)
  const right = Float32Array.of(0.6, 0)
  const out = new Float32Array(2)

  it('picks a side, a numbered channel, or mixes', () => {
    expect(pickChannel([left, right], 'right', out)).toBe(true)
    expect(Array.from(out)).toEqual([right[0], right[1]])
    expect(pickChannel([left, right], 1, out)).toBe(true)
    expect(Array.from(out)).toEqual([left[0], left[1]])
    expect(pickChannel([left, right], 'mono', out)).toBe(true)
    expect(out[0]).toBeCloseTo(0.4)
    expect(out[1]).toBeCloseTo(0.2)
  })

  it('mixes when the chosen channel is not there', () => {
    expect(pickChannel([left, right], 4, out)).toBe(false)
    expect(out[0]).toBeCloseTo(0.4)
  })
})

describe('Cleanup', () => {
  it('applies gain and never lets the output pass -1 dBFS', () => {
    const cleanup = new Cleanup(48000)
    cleanup.configure({ gainDb: 12, highPass: false })
    const block = sine(1000, 48000, 0.2, 0.5)
    const stats = fresh()
    cleanup.process(block, stats)
    expect(stats.peak).toBeCloseTo(0.5 * 10 ** (12 / 20), 1)
    expect(Math.max(...block.map(Math.abs))).toBeLessThanOrEqual(10 ** (-1 / 20) + 1e-6)
    expect(stats.limiting).toBeLessThan(1)
  })

  it('removes rumble below 80 Hz but keeps speech', () => {
    const level = (frequency: number) => {
      const cleanup = new Cleanup(48000)
      const block = sine(frequency, 48000, 1, 0.1)
      cleanup.process(block, fresh())
      const tail = block.subarray(24000)
      return Math.sqrt(tail.reduce((sum, s) => sum + s * s, 0) / tail.length) / (0.1 / Math.SQRT2)
    }
    expect(db(level(20))).toBeLessThan(-20)
    expect(Math.abs(db(level(1000)))).toBeLessThan(0.1)
  })

  it('lowers, but does not mute, a signal below the gate threshold', () => {
    const cleanup = new Cleanup(48000)
    cleanup.configure({ noiseGate: true, gateThresholdDb: -40, highPass: false })
    const hiss = sine(1000, 48000, 3, 0.001)
    cleanup.process(hiss, fresh())
    const out = Math.max(...hiss.subarray(140000).map(Math.abs))
    expect(db(out / 0.001)).toBeCloseTo(-18, 0)
  })
})

describe('SignalWatch', () => {
  const reading = (over: Partial<MicReading>): MicReading => ({
    peak: 0.2,
    rms: 0.1,
    clipped: false,
    sourceClipped: false,
    limitingDb: 0,
    channels: 2,
    stereo: { left: 0.1, right: 0.1, difference: 0.03 },
    channelMissing: false,
    ...over,
  })
  const adviceFor = (r: MicReading, channel: 'mono' | 'left' | 'right' = 'mono') => {
    const watch = new SignalWatch()
    for (let i = 0; i < 50; i++) watch.push(r)
    return watch.advice(channel).map((a) => a.text)
  }

  it('is quiet about a healthy signal', () => {
    expect(adviceFor(reading({}))).toEqual([])
  })

  it('warns about clipping, too quiet, and a silent or duplicated channel', () => {
    expect(adviceFor(reading({ peak: 1.2, clipped: true }))[0]).toMatch(/lower the input gain/)
    expect(adviceFor(reading({ peak: 0.9, clipped: true, sourceClipped: true }))[0]).toMatch(/at the desk/)
    expect(adviceFor(reading({ peak: 0.01, rms: 0.003, stereo: null }))[0]).toMatch(/Too quiet/)
    expect(adviceFor(reading({ stereo: { left: 0.1, right: 0.1, difference: 0 } }))[0]).toMatch(/identical/)
    expect(adviceFor(reading({ stereo: { left: 0.1, right: 0, difference: 0.1 } }), 'right')[0]).toMatch(/the one chosen, is silent: choose Left/)
  })
})

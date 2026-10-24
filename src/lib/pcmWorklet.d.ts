// Types for the audio-thread module's exports, which the tests use.
import type { MicChannel } from '../../shared/types'

export const TARGET_RATE: number
export function pickChannel(channels: Float32Array[], choice: MicChannel, out: Float32Array): boolean
export class Resampler {
  constructor(inRate: number, outRate: number)
  process(input: Float32Array, emit: (sample: number) => void): void
}
export interface CleanupStats {
  peak: number
  sumSquares: number
  count: number
  limiting: number
}
export class Cleanup {
  constructor(rate: number)
  configure(settings: { gainDb?: number; highPass?: boolean; noiseGate?: boolean; gateThresholdDb?: number }): void
  process(block: Float32Array, stats: CleanupStats): void
}

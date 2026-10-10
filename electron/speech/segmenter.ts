// Cuts a stream of 16 kHz PCM into segments for an engine that transcribes whole pieces of audio (whisper.cpp).
// Voice activity detection is a level gate over an adaptive noise floor: each 100 ms chunk counts as speech when
// it is clearly louder than the room. Segments end at a pause once they hold 3 seconds, or at a longer pause
// sooner, and never run past 6 seconds; a forced cut lands on the quietest moment of the last two seconds.
// Each segment starts with the last 300 ms of the one before, so a word cut at the edge is heard whole once.

export const SAMPLE_RATE = 16_000
const CHUNK_MS = 100
const MIN_MS = 3000
const MAX_MS = 6000
/** A pause this long ends a segment that already holds MIN_MS. */
const PAUSE_MS = 300
/** A pause this long ends a segment of any length, so a short sentence is not held back. */
const LONG_PAUSE_MS = 800
/** Less speech than this in a segment is treated as noise and never transcribed. */
const MIN_SPEECH_MS = 200
const OVERLAP_MS = 300
/** Speech must be this far above the noise floor, and above an absolute floor. */
const SPEECH_ABOVE_FLOOR_DB = 10
const SPEECH_MIN_DB = -55

interface Chunk {
  pcm: Int16Array
  db: number
  speech: boolean
}

export interface AudioSegment {
  pcm: Int16Array
  durationMs: number
  speechMs: number
  /** Milliseconds at the start repeated from the previous segment, and whether they held speech. */
  overlapMs: number
  overlapHadSpeech: boolean
}

function levelDb(pcm: Int16Array): number {
  let sum = 0
  for (const sample of pcm) sum += sample * sample
  const rms = Math.sqrt(sum / Math.max(1, pcm.length)) / 32768
  return rms > 0 ? 20 * Math.log10(rms) : -100
}

export class Segmenter {
  private chunks: Chunk[] = []
  /** How many of the first chunks came from the previous segment. */
  private overlapCount = 0
  private noiseFloor: number | null = null

  constructor(private readonly onSegment: (segment: AudioSegment) => void) {}

  push(pcm: Int16Array): void {
    const db = levelDb(pcm)
    // The floor drops quickly to quieter moments and creeps up slowly, so speech does not drag it up.
    // It starts low, so speech already under way when listening starts is still heard as speech.
    if (this.noiseFloor === null) this.noiseFloor = Math.min(db, -50)
    else if (db < this.noiseFloor) this.noiseFloor += (db - this.noiseFloor) * 0.3
    else this.noiseFloor += (db - this.noiseFloor) * 0.01
    const speech = db > Math.max(this.noiseFloor + SPEECH_ABOVE_FLOOR_DB, SPEECH_MIN_DB)
    this.chunks.push({ pcm, db, speech })

    const speechCount = this.chunks.filter((c) => c.speech).length
    if (speechCount === 0) {
      // Nothing said yet: keep only a short lead-in, not minutes of silence.
      this.chunks = this.chunks.slice(-OVERLAP_MS / CHUNK_MS)
      this.overlapCount = Math.min(this.overlapCount, this.chunks.length)
      return
    }

    const lengthMs = this.chunks.length * CHUNK_MS
    const pauseMs = this.trailingSilence() * CHUNK_MS
    if ((lengthMs >= MIN_MS && pauseMs >= PAUSE_MS) || pauseMs >= LONG_PAUSE_MS) {
      this.cut(this.chunks.length)
    } else if (lengthMs >= MAX_MS) {
      this.cut(this.quietestCut())
    }
  }

  /** Sends what is buffered (when the listener stops). */
  flush(): void {
    if (this.chunks.length > 0) this.cut(this.chunks.length)
    this.chunks = []
    this.overlapCount = 0
  }

  private trailingSilence(): number {
    let count = 0
    for (let i = this.chunks.length - 1; i >= 0 && !this.chunks[i].speech; i--) count++
    return count
  }

  /** Where to cut a segment that reached MAX_MS: after the quietest chunk of the last two seconds. */
  private quietestCut(): number {
    const from = Math.max(this.overlapCount + 1, this.chunks.length - 2000 / CHUNK_MS)
    let best = this.chunks.length - 1
    for (let i = from; i < this.chunks.length; i++) if (this.chunks[i].db <= this.chunks[best].db) best = i
    return best + 1
  }

  private cut(end: number): void {
    const taken = this.chunks.slice(0, end)
    const speechMs = taken.filter((c) => c.speech).length * CHUNK_MS
    const overlap = taken.slice(0, this.overlapCount)
    if (speechMs - overlap.filter((c) => c.speech).length * CHUNK_MS >= MIN_SPEECH_MS) {
      const pcm = new Int16Array(taken.reduce((n, c) => n + c.pcm.length, 0))
      let offset = 0
      for (const c of taken) {
        pcm.set(c.pcm, offset)
        offset += c.pcm.length
      }
      this.onSegment({
        pcm,
        durationMs: Math.round((pcm.length / SAMPLE_RATE) * 1000),
        speechMs,
        overlapMs: overlap.length * CHUNK_MS,
        overlapHadSpeech: overlap.some((c) => c.speech),
      })
    }
    const keep = Math.min(OVERLAP_MS / CHUNK_MS, taken.length)
    this.chunks = [...taken.slice(taken.length - keep), ...this.chunks.slice(end)]
    this.overlapCount = keep
  }
}

/** 16 kHz mono 16-bit PCM as a WAV file. */
export function toWav(pcm: Int16Array): Buffer {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const normalize = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')

/**
 * Drops words at the start of `next` that repeat the end of `previous`, which happens when the overlap carried
 * speech into both segments. Only runs of two or more words count, so a deliberate "Amen. Amen." survives.
 */
export function removeOverlap(previous: string, next: string): string {
  const before = previous.split(/\s+/).filter(Boolean).map(normalize)
  const after = next.split(/\s+/).filter(Boolean)
  const afterNorm = after.map(normalize)
  for (let k = Math.min(6, before.length, after.length); k >= 2; k--) {
    if (before.slice(-k).every((w, i) => w !== '' && w === afterNorm[i])) return after.slice(k).join(' ')
  }
  return next
}

/** Whisper writes non-speech as [BLANK_AUDIO], (music), *applause* and so on; drop those. */
export function cleanTranscript(text: string): string {
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

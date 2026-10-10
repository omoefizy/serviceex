// Audio thread. Turns the microphone (any sample rate, any channel count) into 16 kHz mono 16-bit PCM and posts it
// in 100 ms chunks, each with its peak level for the meter. Plain JavaScript: it is loaded by audioWorklet.addModule.

const TARGET_RATE = 16000
const CHUNK_SAMPLES = TARGET_RATE / 10

class PcmChunker extends AudioWorkletProcessor {
  constructor() {
    super()
    /** Input samples per output sample, such as 3 for 48 kHz. */
    this.step = sampleRate / TARGET_RATE
    this.position = 0
    this.sum = 0
    this.count = 0
    this.chunk = new Int16Array(CHUNK_SAMPLES)
    this.filled = 0
    this.peak = 0
  }

  process(inputs) {
    const channels = inputs[0]
    if (!channels || channels.length === 0) return true
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0
      for (const channel of channels) sample += channel[i]
      // Average the input samples that fall into each output sample: a simple low-pass before dropping the rate.
      this.sum += sample / channels.length
      this.count++
      this.position++
      if (this.position >= this.step) {
        this.position -= this.step
        this.emit(this.sum / this.count)
        this.sum = 0
        this.count = 0
      }
    }
    return true
  }

  emit(value) {
    const clamped = Math.max(-1, Math.min(1, value))
    this.peak = Math.max(this.peak, Math.abs(clamped))
    this.chunk[this.filled++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
    if (this.filled === CHUNK_SAMPLES) {
      const pcm = this.chunk.buffer
      this.port.postMessage({ pcm, peak: this.peak }, [pcm])
      this.chunk = new Int16Array(CHUNK_SAMPLES)
      this.filled = 0
      this.peak = 0
    }
  }
}

registerProcessor('pcm-chunker', PcmChunker)

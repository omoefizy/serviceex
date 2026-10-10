// Deepgram streaming speech-to-text, main process only. The API key is passed in by the caller (decrypted from
// safeStorage) and only ever goes into the Authorization header of requests to api.deepgram.com.

import { net } from 'electron'
import type { SpeechError } from '../../shared/types'
import { EngineEvents, speechError, type SpeechEngine } from './engine'

export const DEEPGRAM_MODEL = 'nova-3'

const LISTEN_URL = 'wss://api.deepgram.com/v1/listen'
const TOKEN_URL = 'https://api.deepgram.com/v1/auth/token'
/** Deepgram closes a stream that gets no audio for about 10 seconds; KeepAlive holds it open through gaps. */
const KEEP_ALIVE_MS = 5000
/** Audio held while the socket opens: 50 chunks of 100 ms. */
const MAX_QUEUED = 50
const CLOSE_TIMEOUT_MS = 5000

interface ResultsMessage {
  type: 'Results'
  is_final?: boolean
  speech_final?: boolean
  start?: number
  duration?: number
  channel?: { alternatives?: { transcript?: string; words?: { word: string; punctuated_word?: string; start: number; end: number }[] }[] }
}

/** One Results message with its timing, in seconds from the start of the audio sent on this connection. */
export interface DeepgramResult {
  isFinal: boolean
  /** Deepgram heard the end of an utterance: a pause. */
  speechFinal: boolean
  start: number
  end: number
  transcript: string
  words: { text: string; start: number; end: number }[]
}

/** Asks Deepgram about the key itself, to tell a rejected key from a network problem. */
export async function checkDeepgramKey(apiKey: string): Promise<SpeechError | null> {
  let response: Response
  try {
    response = await net.fetch(TOKEN_URL, { headers: { Authorization: `Token ${apiKey}` } })
  } catch {
    return speechError('network', 'Could not reach Deepgram. Check the internet connection.')
  }
  if (response.status === 401 || response.status === 403) return speechError('auth', 'Deepgram rejected the API key.')
  if (!response.ok) return speechError('engine', `Deepgram answered with an error (${response.status}).`)
  return null
}

export class DeepgramEngine extends EngineEvents implements SpeechEngine {
  private socket: WebSocket | null = null
  private queue: Uint8Array[] = []
  private keepAlive: ReturnType<typeof setInterval> | null = null
  private lastSentAt = 0
  /** When Deepgram last sent anything; a stream that goes quiet while audio flows has failed. */
  lastMessageAt = 0
  private resultListeners = new Set<(result: DeepgramResult) => void>()
  private stopping = false
  /** Resolves stop() once the session has ended. */
  private closed: (() => void) | null = null

  constructor(private readonly apiKey: string) {
    super()
  }

  /** Every Results message with timings and words, for the Auto engine's hand-overs. */
  onResult(listener: (result: DeepgramResult) => void) {
    this.resultListeners.add(listener)
    return () => void this.resultListeners.delete(listener)
  }

  /** Drops the connection at once, without waiting for the last results (they are no longer wanted). */
  abort(): void {
    this.stopping = true
    this.socket?.close()
  }

  start(): Promise<void> {
    if (this.socket) return Promise.reject(speechError('busy', 'Already listening.'))
    const params = new URLSearchParams({
      model: DEEPGRAM_MODEL,
      language: 'en',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      interim_results: 'true',
      punctuate: 'true',
    })
    this.stopping = false
    this.emitStatus('connecting')
    // The main process has Node's WebSocket, which takes request headers; this project's DOM typings do not know that.
    const init = { headers: { Authorization: `Token ${this.apiKey}` } }
    const socket = new WebSocket(`${LISTEN_URL}?${params}`, init as unknown as string[])
    socket.binaryType = 'arraybuffer'
    this.socket = socket

    return new Promise((resolve, reject) => {
      let opened = false
      let ended = false
      /** Runs once, on whichever of close or error comes first: Node's WebSocket may fire error without close. */
      const end = (code: number | null, reason = '') => {
        if (ended) return
        ended = true
        this.cleanUp()
        if (!opened && this.stopping) {
          // Stopped before it connected.
          this.emitStatus('idle')
          resolve()
        } else if (!opened) {
          // The handshake failed, and the socket does not say why, so ask Deepgram about the key.
          this.emitStatus('error')
          checkDeepgramKey(this.apiKey).then(
            (problem) => reject(problem ?? speechError('engine', 'Deepgram refused the streaming connection.')),
            () => reject(speechError('network', 'Could not reach Deepgram. Check the internet connection.')),
          )
        } else if (this.stopping || code === 1000) {
          this.emitStatus('idle')
        } else {
          const detail = code === null ? 'the connection failed' : `code ${code}${reason ? `: ${reason}` : ''}`
          this.emitError(speechError('network', `Lost the connection to Deepgram (${detail}).`))
          this.emitStatus('error')
        }
        this.closed?.()
      }
      socket.addEventListener('open', () => {
        opened = true
        this.lastMessageAt = Date.now()
        for (const chunk of this.queue) this.send(chunk)
        this.queue = []
        this.keepAlive = setInterval(() => {
          if (Date.now() - this.lastSentAt >= KEEP_ALIVE_MS) this.sendJson({ type: 'KeepAlive' })
        }, KEEP_ALIVE_MS)
        this.emitStatus('listening')
        resolve()
      })
      socket.addEventListener('message', (event) => {
        if (typeof event.data === 'string') this.handleMessage(event.data)
      })
      socket.addEventListener('close', (event) => end(event.code, event.reason))
      socket.addEventListener('error', () => end(null))
    })
  }

  async stop(): Promise<void> {
    const socket = this.socket
    if (!socket || this.stopping) return
    this.stopping = true
    this.emitStatus('stopping')
    if (socket.readyState !== WebSocket.OPEN) {
      socket.close()
      return
    }
    // CloseStream makes Deepgram send the last results, then close.
    const closed = new Promise<void>((resolve) => (this.closed = resolve))
    this.sendJson({ type: 'CloseStream' })
    const timer = setTimeout(() => {
      socket.close()
      // If even that brings no close event, stop waiting.
      setTimeout(() => this.closed?.(), 1000)
    }, CLOSE_TIMEOUT_MS)
    await closed
    clearTimeout(timer)
  }

  pushAudio(chunk: Uint8Array): void {
    const socket = this.socket
    if (!socket || this.stopping) return
    if (socket.readyState === WebSocket.OPEN) this.send(chunk)
    else if (socket.readyState === WebSocket.CONNECTING && this.queue.length < MAX_QUEUED) this.queue.push(chunk)
  }

  private send(chunk: Uint8Array) {
    this.socket?.send(chunk)
    this.lastSentAt = Date.now()
  }

  private sendJson(message: object) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  private handleMessage(raw: string) {
    let message: { type?: string; description?: string }
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }
    this.lastMessageAt = Date.now()
    if (message.type === 'Error') {
      this.emitError(speechError('engine', message.description ?? 'Deepgram reported an error.'))
      return
    }
    if (message.type !== 'Results') return
    const results = message as ResultsMessage
    const best = results.channel?.alternatives?.[0]
    const text = best?.transcript?.trim() ?? ''
    if (this.resultListeners.size > 0) {
      const start = results.start ?? 0
      const result: DeepgramResult = {
        isFinal: !!results.is_final,
        speechFinal: !!results.speech_final,
        start,
        end: start + (results.duration ?? 0),
        transcript: text,
        words: (best?.words ?? []).map((w) => ({ text: w.punctuated_word ?? w.word, start: w.start, end: w.end })),
      }
      for (const listener of this.resultListeners) listener(result)
    }
    if (results.is_final) {
      if (text) this.emitFinal(text)
      else this.emitPartial('')
    } else {
      this.emitPartial(text)
    }
  }

  private cleanUp() {
    if (this.keepAlive) clearInterval(this.keepAlive)
    this.keepAlive = null
    this.queue = []
    this.socket = null
  }
}

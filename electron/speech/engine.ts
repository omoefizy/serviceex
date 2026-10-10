// The interface every speech-to-text engine implements, so a cloud engine and a local one can be swapped without
// touching the IPC or the UI. Engines run in the main process; audio arrives as 16 kHz mono 16-bit PCM.

import type { SpeechError, SpeechStatus } from '../../shared/types'

type Listener<T> = (value: T) => void

export interface SpeechEngine {
  /** Connects and resolves once audio can be sent; rejects with a SpeechError. */
  start(): Promise<void>
  /** Flushes what was heard so far (its last onFinal), then disconnects. */
  stop(): Promise<void>
  /** Ends at once without the last lines, for an engine that has stalled. */
  abort?(): void
  /** 100 ms of 16 kHz mono 16-bit little-endian PCM. */
  pushAudio(chunk: Uint8Array): void
  /** Text that may still change, replacing the previous partial. Each returns an unsubscribe function. */
  onPartial(listener: Listener<string>): () => void
  /** Text that will not change; the partial before it is done. */
  onFinal(listener: Listener<string>): () => void
  onStatus(listener: Listener<SpeechStatus>): () => void
  /** Something went wrong after start; the engine stops itself. */
  onError(listener: Listener<SpeechError>): () => void
}

/** The event half of SpeechEngine, for engines to extend. */
export abstract class EngineEvents {
  private listeners = {
    partial: new Set<Listener<string>>(),
    final: new Set<Listener<string>>(),
    status: new Set<Listener<SpeechStatus>>(),
    error: new Set<Listener<SpeechError>>(),
  }

  onPartial(listener: Listener<string>) {
    return this.add(this.listeners.partial, listener)
  }

  onFinal(listener: Listener<string>) {
    return this.add(this.listeners.final, listener)
  }

  onStatus(listener: Listener<SpeechStatus>) {
    return this.add(this.listeners.status, listener)
  }

  onError(listener: Listener<SpeechError>) {
    return this.add(this.listeners.error, listener)
  }

  protected emitPartial(text: string) {
    for (const listener of this.listeners.partial) listener(text)
  }

  protected emitFinal(text: string) {
    for (const listener of this.listeners.final) listener(text)
  }

  protected emitStatus(status: SpeechStatus) {
    for (const listener of this.listeners.status) listener(status)
  }

  protected emitError(error: SpeechError) {
    for (const listener of this.listeners.error) listener(error)
  }

  private add<T>(set: Set<Listener<T>>, listener: Listener<T>) {
    set.add(listener)
    return () => void set.delete(listener)
  }
}

export const speechError = (code: SpeechError['code'], message: string): SpeechError => ({ code, message })

export function isSpeechError(value: unknown): value is SpeechError {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value
}

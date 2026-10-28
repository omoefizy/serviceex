// One cloud listening session on the ServiceEx account, from Start to Stop. The server opens it and hands out a
// Deepgram token that lasts a minute (only long enough to connect); each reconnect asks for a new one. A heartbeat
// every 30 seconds reports how long the cloud was really in use, and the server bills that against the listening
// hours. When the server says stop (the hours ran out, the 6 hour cap) or cannot be reached for longer than it keeps a
// session open, onCut is called once, so the listener can carry on offline. end() closes the session; after it no
// heartbeat is sent.

import { serviceErrorMessage } from '../../shared/serviceErrors'
import { isServiceError, ServiceError, type ServiceClient } from './client'

export type CutReason = 'no_credit' | 'max_duration' | 'replaced' | 'ended' | 'lost' | 'signed_out'

export interface CloudCut {
  reason: CutReason
  /** For the listener panel: what happened and that listening carries on offline. */
  message: string
}

export const CUT_MESSAGES: Record<CutReason, string> = {
  no_credit: 'Cloud listening hours ran out, so listening carries on offline on this computer. Buy more hours in Plans and Credits.',
  max_duration: 'This cloud session reached its 6 hour limit, so listening carries on offline on this computer.',
  replaced: 'Cloud listening was started again on this computer, so this session carries on offline.',
  ended: 'The cloud listening session was closed, so listening carries on offline on this computer.',
  lost: 'Lost contact with ServiceEx, so listening carries on offline on this computer.',
  signed_out: 'You were signed out of ServiceEx, so listening carries on offline on this computer.',
}

interface DeepgramGrant {
  access_token: string
  expires_in: number
}

interface StartAnswer {
  session_id: string
  deepgram: DeepgramGrant
  balance_seconds: number
  heartbeat_interval_seconds: number
  heartbeat_timeout_seconds: number
}

interface HeartbeatAnswer {
  action: 'continue' | 'stop'
  reason?: string
  balance_seconds: number
}

export interface ListeningOptions {
  client: ServiceClient
  machineId: string
  /** Whether a Deepgram connection is open right now (sampled once a second for the heartbeat). */
  cloudInUse(): boolean
  onBalance(seconds: number): void
  onCut(cut: CloudCut): void
  now?(): number
}

/** A token is used for the first connection only while it has this much life left. */
const TOKEN_MARGIN_MS = 10_000
/** The server accepts at most an hour per heartbeat. */
const MAX_ELAPSED = 3600

const reasonOf = (reason: string | undefined): CutReason =>
  reason === 'no_credit' || reason === 'max_duration' || reason === 'replaced' ? reason : reason === 'timed_out' ? 'lost' : 'ended'

/**
 * Opens a session on the server. Throws a ServiceError: no_credit when there are no hours left, offline when the
 * server (or Deepgram behind it) cannot be reached.
 */
export async function startServiceListening(options: ListeningOptions): Promise<ServiceListening> {
  const answer = await options.client.request<StartAnswer>('POST', '/listening/sessions', { body: { machine_id: options.machineId } })
  options.onBalance(answer.balance_seconds)
  return new ServiceListening(options, answer)
}

export class ServiceListening {
  readonly sessionId: string
  private first: { token: string; until: number } | null
  /** Seconds the cloud was in use since the last heartbeat that got through. */
  private used = 0
  private lastOkAt: number
  private readonly timeoutMs: number
  private sampler: ReturnType<typeof setInterval> | null
  private heartbeat: ReturnType<typeof setInterval> | null
  private beating = false
  private cut: CloudCut | null = null
  private ending: Promise<void> | null = null

  constructor(
    private readonly options: ListeningOptions,
    answer: StartAnswer,
  ) {
    this.sessionId = answer.session_id
    this.first = { token: answer.deepgram.access_token, until: this.now() + answer.deepgram.expires_in * 1000 }
    this.lastOkAt = this.now()
    this.timeoutMs = answer.heartbeat_timeout_seconds * 1000
    this.sampler = setInterval(() => {
      if (this.options.cloudInUse()) this.used += 1
    }, 1000)
    this.heartbeat = setInterval(() => void this.beat(), answer.heartbeat_interval_seconds * 1000)
  }

  private now() {
    return this.options.now?.() ?? Date.now()
  }

  /** Why the cloud was stopped, once it has been. */
  get stopped(): CloudCut | null {
    return this.cut
  }

  /** A Deepgram token for a new connection: the one from the start the first time, then a fresh one each time. */
  async token(): Promise<string> {
    if (this.cut) throw new ServiceError('conflict')
    const first = this.first
    this.first = null
    if (first && first.until - TOKEN_MARGIN_MS > this.now()) return first.token
    try {
      const answer = await this.options.client.request<{ deepgram: DeepgramGrant }>('POST', `/listening/sessions/${this.sessionId}/token`)
      return answer.deepgram.access_token
    } catch (error) {
      // A closed session (or no hours left) will not come back; the network may.
      if (isServiceError(error) && (error.code === 'conflict' || error.code === 'not_found')) this.stop('ended')
      else if (isServiceError(error) && error.code === 'no_credit') this.stop('no_credit')
      else if (isServiceError(error) && error.code === 'unauthorized') this.stop('signed_out')
      throw error
    }
  }

  private takeUsed(): number {
    const seconds = Math.min(MAX_ELAPSED, Math.round(this.used))
    this.used -= seconds
    return seconds
  }

  /** One heartbeat. A failed one keeps its seconds for the next. */
  async beat(): Promise<void> {
    if (this.cut || this.ending || this.beating) return
    this.beating = true
    const elapsed = this.takeUsed()
    try {
      const answer = await this.options.client.request<HeartbeatAnswer>('POST', `/listening/sessions/${this.sessionId}/heartbeat`, {
        body: { elapsed_seconds: elapsed },
      })
      this.lastOkAt = this.now()
      this.options.onBalance(answer.balance_seconds)
      if (answer.action === 'stop') this.stop(reasonOf(answer.reason))
      else if (answer.balance_seconds <= 0) this.stop('no_credit')
    } catch (error) {
      this.used += elapsed
      const code = isServiceError(error) ? error.code : null
      if (code === 'no_credit') this.stop('no_credit')
      else if (code === 'unauthorized') this.stop('signed_out')
      else if (code === 'not_found' || code === 'conflict') this.stop('ended')
      // The server closes a session it has not heard from for this long; past it, the cloud is not paid for.
      else if (this.now() - this.lastOkAt > this.timeoutMs) this.stop('lost')
      else console.error('Listening heartbeat failed; trying again at the next one', isServiceError(error) ? error.code : error)
    } finally {
      this.beating = false
    }
  }

  private clearTimers() {
    if (this.sampler) clearInterval(this.sampler)
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.sampler = this.heartbeat = null
  }

  /** The cloud may not be used any more in this session; the listener goes offline. */
  private stop(reason: CutReason) {
    if (this.cut) return
    this.cut = { reason, message: CUT_MESSAGES[reason] }
    this.clearTimers()
    this.options.onCut(this.cut)
  }

  /** Closes the session with a last heartbeat. Safe to call more than once and after a cut. Never throws. */
  end(): Promise<void> {
    this.ending ??= (async () => {
      this.clearTimers()
      // The server has closed it already, except when it simply could not be reached.
      if (this.cut && this.cut.reason !== 'lost') return
      try {
        const answer = await this.options.client.request<HeartbeatAnswer>('POST', `/listening/sessions/${this.sessionId}/end`, {
          body: { elapsed_seconds: this.takeUsed() },
        })
        this.options.onBalance(answer.balance_seconds)
      } catch (error) {
        // The server closes it on its own once the heartbeats stop.
        console.error('Could not close the cloud listening session', isServiceError(error) ? serviceErrorMessage(error.code) : error)
      }
    })()
    return this.ending
  }
}

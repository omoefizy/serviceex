// Requests to the ServiceEx server, main process only. The access and refresh tokens live in a SessionStore (encrypted
// with safeStorage in the app, see ./session) and never reach the renderer. An access token about to expire is renewed
// first; one the server rejects is renewed once and the request tried again. When the refresh token is rejected too,
// the session is cleared and onSignedOut is called.
//
// Every failure becomes a ServiceError with a code from shared/serviceErrors and a sentence for the operator; the
// server's own message and anything technical go to the log only.

import { isServiceErrorCode, serviceErrorMessage, type ServiceErrorCode } from '../../shared/serviceErrors'

export interface StoredSession {
  accessToken: string
  refreshToken: string
  /** When the access token expires (ms since the epoch). */
  expiresAt: number
  email: string
}

export interface SessionStore {
  load(): Promise<StoredSession | null>
  save(session: StoredSession): Promise<void>
  clear(): Promise<void>
}

export class ServiceError extends Error {
  constructor(
    readonly code: ServiceErrorCode,
    readonly details: Record<string, unknown> = {},
    readonly status: number | null = null,
  ) {
    super(serviceErrorMessage(code, details))
    this.name = 'ServiceError'
  }
}

export const isServiceError = (error: unknown): error is ServiceError => error instanceof ServiceError

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface ClientOptions {
  baseUrl(): string | null
  fetch: FetchLike
  store: SessionStore
  /** Called once the session is gone because the server rejected it. */
  onSignedOut?(): void
  timeoutMs?: number
  now?(): number
}

interface RequestOptions {
  body?: unknown
  query?: Record<string, string | undefined>
  /** Sends the access token; true by default. */
  auth?: boolean
}

/** Renew an access token this long before it expires. */
const REFRESH_EARLY_MS = 60_000
const TIMEOUT_MS = 20_000

export class ServiceClient {
  private session: StoredSession | null | undefined
  private refreshing: Promise<StoredSession> | null = null

  constructor(private readonly options: ClientOptions) {}

  private now() {
    return this.options.now?.() ?? Date.now()
  }

  async currentSession(): Promise<StoredSession | null> {
    if (this.session === undefined) this.session = await this.options.store.load().catch(() => null)
    return this.session
  }

  async signedIn(): Promise<boolean> {
    return (await this.currentSession()) !== null
  }

  /** Keeps the tokens from a sign in. */
  async setSession(session: StoredSession): Promise<void> {
    await this.options.store.save(session)
    this.session = session
  }

  async clearSession(): Promise<void> {
    this.session = null
    await this.options.store.clear().catch((error) => console.error('Could not remove the saved session', error))
  }

  async request<T>(method: 'GET' | 'POST', path: string, options: RequestOptions = {}): Promise<T> {
    const auth = options.auth ?? true
    if (!auth) return this.send<T>(method, path, options, null)
    let session = await this.currentSession()
    if (!session) throw new ServiceError('unauthorized')
    if (session.expiresAt - REFRESH_EARLY_MS <= this.now()) session = await this.refresh(session)
    const used = session.accessToken
    try {
      return await this.send<T>(method, path, options, used)
    } catch (error) {
      if (!isServiceError(error) || error.code !== 'unauthorized') throw error
    }
    // The access token was rejected (revoked, or the clock is off): renew it once and try again. When another request
    // renewed it meanwhile, its new token is used as it is: the old refresh token no longer works.
    const latest = await this.currentSession()
    if (!latest) throw new ServiceError('unauthorized')
    session = latest.accessToken !== used ? latest : await this.refresh(latest)
    return this.send<T>(method, path, options, session.accessToken)
  }

  /** One refresh at a time; requests that need one meanwhile wait for the same answer. */
  private refresh(old: StoredSession): Promise<StoredSession> {
    // Already renewed by a request that finished first.
    if (this.session && this.session.refreshToken !== old.refreshToken) return Promise.resolve(this.session)
    this.refreshing ??= (async () => {
      try {
        const answer = await this.send<{ access_token: string; refresh_token: string; expires_in: number }>(
          'POST',
          '/auth/refresh',
          { body: { refresh_token: old.refreshToken } },
          null,
        )
        const next: StoredSession = {
          accessToken: answer.access_token,
          refreshToken: answer.refresh_token,
          expiresAt: this.now() + answer.expires_in * 1000,
          email: old.email,
        }
        await this.setSession(next)
        return next
      } catch (error) {
        // A rejected refresh token ends the session; a network problem keeps it for later.
        if (isServiceError(error) && (error.code === 'unauthorized' || error.code === 'validation_error')) {
          await this.clearSession()
          this.options.onSignedOut?.()
          throw new ServiceError('unauthorized')
        }
        throw error
      } finally {
        this.refreshing = null
      }
    })()
    return this.refreshing
  }

  private async send<T>(method: string, path: string, options: RequestOptions, accessToken: string | null): Promise<T> {
    const base = this.options.baseUrl()
    if (!base) throw new ServiceError('not_configured')
    const url = new URL(base + path)
    for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined) url.searchParams.set(key, value)
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`

    let response: Response
    try {
      response = await this.options.fetch(url.toString(), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? TIMEOUT_MS),
      })
    } catch (error) {
      console.error(`ServiceEx ${method} ${path} could not be sent`, error instanceof Error ? error.message : error)
      throw new ServiceError('offline')
    }
    if (response.status === 204) return undefined as T
    const text = await response.text().catch(() => '')
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    if (response.ok && json !== null) return json as T
    const error = (json as { error?: { code?: unknown; message?: unknown; details?: unknown } } | null)?.error
    const code: ServiceErrorCode = isServiceErrorCode(error?.code)
      ? error.code
      : response.status === 401
        ? 'unauthorized'
        : response.status === 429
          ? 'rate_limited'
          : response.status === 502 || response.status === 503 || response.status === 504
            ? 'offline'
            : 'unavailable'
    // The server's message is for the log only; the operator sees the sentence for the code.
    console.error(`ServiceEx ${method} ${path} failed`, { status: response.status, code, message: typeof error?.message === 'string' ? error.message : undefined })
    const details = error?.details && typeof error.details === 'object' ? (error.details as Record<string, unknown>) : {}
    throw new ServiceError(code, details, response.status)
  }
}

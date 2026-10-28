// Wakes the ServiceEx server before it is needed: one GET /health when the app starts, and once more when the Account
// or Plans and Credits screen opens if the last answer is over 10 minutes old. A host that sleeps when idle then has
// time to start while the operator is still reading the screen.
//
// The request carries nothing: no token, no account, no machine id, no body. It never blocks, never retries and never
// reports a failure; offline or signed out it simply fails quietly.

/** A server that has slept can take about a minute to start, so the request waits this long. */
export const WARM_UP_TIMEOUT_MS = 70_000
/** The screens warm the server again only when the last answer is older than this. */
export const WARM_UP_STALE_MS = 10 * 60_000

export interface WarmUpOptions {
  baseUrl(): string | null
  fetch?: (url: string, init: RequestInit) => Promise<Response>
  timeoutMs?: number
  now?(): number
}

export interface WarmUp {
  /** Sends the request unless one is already waiting. Resolves once it is answered or has failed; never rejects. */
  ping(): Promise<void>
  /** The same, only when no answer has come in the last 10 minutes. */
  pingIfStale(): Promise<void>
}

export function createWarmUp(options: WarmUpOptions): WarmUp {
  const now = () => options.now?.() ?? Date.now()
  const fetchHealth = options.fetch ?? ((url, init) => fetch(url, init))
  let lastAnswer: number | null = null
  let waiting: Promise<void> | null = null

  async function send(base: string) {
    try {
      const response = await fetchHealth(`${base}/health`, {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(options.timeoutMs ?? WARM_UP_TIMEOUT_MS),
      })
      if (response.ok) lastAnswer = now()
      await response.body?.cancel().catch(() => undefined)
    } catch {
      // Waking the server is only a courtesy; the real request reports its own failure.
    }
  }

  function ping(): Promise<void> {
    if (waiting) return waiting
    const base = options.baseUrl()
    if (!base) return Promise.resolve()
    waiting = send(base).finally(() => (waiting = null))
    return waiting
  }

  return {
    ping,
    pingIfStale: () => (lastAnswer !== null && now() - lastAnswer <= WARM_UP_STALE_MS ? Promise.resolve() : ping()),
  }
}

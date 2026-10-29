// A request to the ServiceEx server (through the main process) that never sits on "Loading…": after SERVER_TIMEOUT_MS
// it gives up with a timeout the screen can offer Retry for, and the screen can tell being offline apart from a
// server that does not answer.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { AccountResult } from '../../shared/account'
import { reportError, type FriendlyError } from './errors'

export const SERVER_TIMEOUT_MS = 20_000

export type RequestState<T> =
  | { status: 'loading' }
  | { status: 'done'; value: T }
  | { status: 'error'; error: FriendlyError }
  /** No answer within SERVER_TIMEOUT_MS. A late answer is ignored; Retry asks again. */
  | { status: 'timeout' }

/** The error a request that took too long fails with; its message is the sentence the operator sees. */
export class ServerTimeoutError extends Error {
  constructor() {
    super(`Could not reach the server. ServiceEx did not answer within ${SERVER_TIMEOUT_MS / 1000} seconds; try again.`)
    this.name = 'ServerTimeoutError'
  }
}

/** Rejects with ServerTimeoutError when `promise` has not settled within SERVER_TIMEOUT_MS. */
export function withServerTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ServerTimeoutError()), SERVER_TIMEOUT_MS)
    promise.then(
      (value) => (clearTimeout(timer), resolve(value)),
      (err: unknown) => (clearTimeout(timer), reject(err)),
    )
  })
}

function subscribeOnline(listener: () => void) {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}

/** Whether the computer has a network connection, as the browser sees it. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  )
}

/**
 * Runs `request` when `enabled` (and again on retry, or when `key` changes) and reports where it got to. An answer
 * that is not ok becomes an error with the server's sentence; a throw becomes a described error.
 */
export function useServerRequest<T>(where: string, request: () => Promise<AccountResult<T>>, { enabled = true, key = '' }: { enabled?: boolean; key?: string | number } = {}) {
  const [state, setState] = useState<RequestState<T>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const requestRef = useRef(request)
  requestRef.current = request
  const online = useOnline()

  useEffect(() => {
    if (!enabled) return
    let settled = false
    setState({ status: 'loading' })
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reportError(where, new Error(`No answer from the server within ${SERVER_TIMEOUT_MS / 1000} seconds`), 'Could not reach the server.')
      setState({ status: 'timeout' })
    }, SERVER_TIMEOUT_MS)
    requestRef.current().then(
      (answer) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (answer?.ok) setState({ status: 'done', value: answer.value })
        else setState({ status: 'error', error: reportError(where, answer?.error ?? new Error('Empty answer')) })
      },
      (err: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        setState({ status: 'error', error: reportError(where, err) })
      },
    )
    return () => {
      settled = true
      clearTimeout(timer)
    }
  }, [where, enabled, key, attempt])

  // Coming back online after a failure tries again by itself.
  const failed = state.status === 'timeout' || state.status === 'error'
  useEffect(() => {
    if (online && failed) setAttempt((a) => a + 1)
    // Only the change to online matters, not every failure while online.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online])

  const retry = useCallback(() => setAttempt((a) => a + 1), [])
  return { state, retry, online }
}

import { CloudOff, RotateCw, WifiOff } from 'lucide-react'
import type { FriendlyError } from '../lib/errors'
import { SERVER_TIMEOUT_MS } from '../lib/useServerRequest'
import { Button, EmptyState } from './ui'

interface Props {
  /** Why there is nothing to show: no network, no answer in time, or an answer that was an error. */
  problem: 'offline' | 'timeout' | FriendlyError
  /** What could not be loaded, for the offline sentence: "Prices", "Your orders". */
  what: string
  onRetry(): void
  compact?: boolean
}

/** In place of something from the ServiceEx server that could not be loaded, with Retry. */
export function ServerProblem({ problem, what, onRetry, compact = true }: Props) {
  const retry = (
    <Button icon={<RotateCw size={15} aria-hidden="true" />} onClick={onRetry}>
      Retry
    </Button>
  )
  if (problem === 'offline') {
    return (
      <EmptyState
        compact={compact}
        icon={<WifiOff size={20} />}
        title="This computer is offline"
        description={`${what} show once it is back on the internet. Everything else in ServiceEx keeps working offline.`}
        action={retry}
      />
    )
  }
  if (problem === 'timeout') {
    return (
      <EmptyState
        compact={compact}
        tone="error"
        icon={<CloudOff size={20} />}
        title="Could not reach the server."
        description={`ServiceEx did not answer within ${SERVER_TIMEOUT_MS / 1000} seconds. Everything offline keeps working.`}
        action={retry}
      />
    )
  }
  return <EmptyState compact={compact} tone="error" icon={<CloudOff size={20} />} title={problem.message} action={retry} details={problem.details ?? undefined} />
}

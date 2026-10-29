// The listener's state in a word, for the transcript drawer, the status bar and the top bar's listening chip.

import type { SpeechMode } from '../../shared/types'
import type { ListenerStatus } from './listener'

const MODE_LABELS: Record<SpeechMode, string> = { cloud: 'Cloud', offline: 'Offline', reconnecting: 'Reconnecting' }

export interface ListenerChip {
  label: string
  /** Which engine, beside Listening. */
  detail?: string
  tone: string
  why: string
}

/**
 * The status chip: Listening (Cloud or Offline), Reconnecting or Restarting while running; Stopped or Error otherwise;
 * with why as its tooltip.
 */
export function chipOf(status: ListenerStatus, mode: SpeechMode | null, reason: string, error: string | null, restarting: string | null): ListenerChip {
  if (restarting && (status === 'listening' || status === 'connecting')) return { label: 'Restarting', tone: 'busy', why: restarting }
  switch (status) {
    case 'listening':
      if (mode === 'reconnecting') return { label: 'Reconnecting', tone: 'reconnecting', why: reason }
      return mode
        ? { label: 'Listening', detail: MODE_LABELS[mode], tone: mode, why: reason }
        : { label: 'Listening', tone: 'cloud', why: 'Listening.' }
    case 'starting':
    case 'connecting':
      return { label: 'Starting', tone: 'busy', why: status === 'starting' ? 'Opening the microphone.' : 'Connecting to the speech engine.' }
    case 'stopping':
      return { label: 'Stopping', tone: 'busy', why: 'Finishing the last words before stopping.' }
    case 'error':
      return { label: 'Error', tone: 'error', why: error ?? 'The listener stopped with an error.' }
    default:
      return { label: 'Stopped', tone: 'stopped', why: 'Not listening. Press Start Listening to begin.' }
  }
}


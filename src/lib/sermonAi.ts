// Words for the Sermons screen's AI jobs: what a running job is doing and what a finished one did.

import type { SermonAiOutcome, SermonAiProgress } from '../../shared/types'

/** What a running clean or notes job is doing, such as "Cleaning part 3 of 12". */
export function progressLabel({ step, done, total }: Pick<SermonAiProgress, 'step' | 'done' | 'total'>): string {
  if (step === 'clean') return `Cleaning part ${done} of ${total}`
  if (step === 'summarise') return `Reading part ${done} of ${total}`
  return 'Writing the summary and key points'
}

/**
 * What a finished job did, for the line under the AI buttons; null when it simply finished. In developer mode it also
 * lists the words the checks flagged in each failed part, to tune the checks.
 */
export function outcomeMessage(
  task: 'clean' | 'notes',
  { done, total, failedParts, cancelled, error, flagged }: Omit<SermonAiOutcome, 'sermon'>,
  developerMode = false,
): string | null {
  const parts = (numbers: number[]) => `${numbers.length === 1 ? 'Part' : 'Parts'} ${numbers.join(', ')}`
  // A check failure is explained by "kept as spoken" or "left out"; any other error says why.
  const reason = error && !error.flagged ? ` (${error.message.replace(/\.$/, '')})` : ''
  const words = developerMode && flagged.length > 0 ? ` Flagged: ${flagged.map(({ part, words }) => `part ${part} (${words.join(', ')})`).join('; ')}.` : ''
  if (task === 'clean') {
    if (cancelled) return `Cancelled after cleaning ${done} of ${total} parts; the rest are kept as spoken.${words}`
    if (failedParts.length === 0) return null
    const kept = failedParts.length === 1 ? '1 part was' : `${failedParts.length} parts were`
    return `Cleaned ${done} of ${total} parts. ${kept} kept exactly as spoken${reason}.${words}`
  }
  if (cancelled) return 'Cancelled. The summary and key points were not changed.'
  return failedParts.length > 0
    ? `${parts(failedParts)} of ${total} could not be read${reason}, so the notes leave ${failedParts.length === 1 ? 'it' : 'them'} out.${words}`
    : null
}

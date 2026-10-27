// Words for the Sermons screen's AI jobs: what a running job is doing and what a finished one did.

import type { SermonAiOutcome, SermonAiProgress } from '../../shared/types'

/** What a running clean or notes job is doing, such as "Cleaning part 3 of 12". */
export function progressLabel({ step, done, total }: Pick<SermonAiProgress, 'step' | 'done' | 'total'>): string {
  if (step === 'clean') return `Cleaning part ${done} of ${total}`
  if (step === 'summarise') return `Reading part ${done} of ${total}`
  return 'Writing the summary and key points'
}

/** What a finished job did, for the line under the AI buttons; null when it simply finished. */
export function outcomeMessage(task: 'clean' | 'notes', { done, total, failedParts, cancelled, error }: Omit<SermonAiOutcome, 'sermon'>): string | null {
  const parts = (numbers: number[]) => `${numbers.length === 1 ? 'Part' : 'Parts'} ${numbers.join(', ')}`
  const reason = error ? ` (${error.message.replace(/\.$/, '')})` : ''
  if (task === 'clean') {
    const notes: string[] = []
    if (cancelled) notes.push(`Cancelled after cleaning ${done} of ${total} parts; the rest are kept as spoken.`)
    if (failedParts.length > 0) notes.push(`${parts(failedParts)} could not be cleaned${reason} and ${failedParts.length === 1 ? 'is' : 'are'} kept as spoken.`)
    return notes.join(' ') || null
  }
  if (cancelled) return 'Cancelled. The summary and key points were not changed.'
  return failedParts.length > 0 ? `${parts(failedParts)} of ${total} could not be read${reason}, so the notes leave ${failedParts.length === 1 ? 'it' : 'them'} out.` : null
}

// What the Sermons screen says after a clean or notes job.
import { describe, expect, it } from 'vitest'
import { outcomeMessage } from './sermonAi'

const guard = { code: 'bad_request' as const, message: 'The AI changed the wording (“to”), so its version was not used.', flagged: ['+to', '-gonna'] }
const outcome = { done: 10, total: 12, failedParts: [3, 7], cancelled: false, error: guard, flagged: [{ part: 3, words: ['+to', '-gonna'] }, { part: 7, words: ['+the'] }] }

describe('outcomeMessage', () => {
  it('says how many parts were cleaned and kept as spoken, without asking to try again', () => {
    expect(outcomeMessage('clean', outcome)).toBe('Cleaned 10 of 12 parts. 2 parts were kept exactly as spoken.')
    expect(outcomeMessage('clean', { ...outcome, done: 11, failedParts: [3], flagged: outcome.flagged.slice(0, 1) })).toBe(
      'Cleaned 11 of 12 parts. 1 part was kept exactly as spoken.',
    )
  })

  it('lists the flagged words in developer mode only', () => {
    expect(outcomeMessage('clean', outcome, true)).toBe(
      'Cleaned 10 of 12 parts. 2 parts were kept exactly as spoken. Flagged: part 3 (+to, -gonna); part 7 (+the).',
    )
  })

  it('still says why when a part failed for another reason', () => {
    const offline = { code: 'offline' as const, message: 'No internet connection.' }
    expect(outcomeMessage('clean', { ...outcome, failedParts: [12], done: 11, error: offline, flagged: [] })).toBe(
      'Cleaned 11 of 12 parts. 1 part was kept exactly as spoken (No internet connection).',
    )
  })

  it('says nothing when every part was cleaned', () => {
    expect(outcomeMessage('clean', { done: 12, total: 12, failedParts: [], cancelled: false, error: null, flagged: [] })).toBeNull()
  })
})

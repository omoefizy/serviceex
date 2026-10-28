// The AI allowance: the one time trial and the monthly allowance add up to the total, and an AI answer's remainder
// comes off the monthly pool first.
import { describe, expect, it } from 'vitest'
import { allowancePercentLeft, allowanceTotalTokens, poolPercentLeft, withRemainingTokens, type AiAllowance } from './account'

const allowance = (trialLeft: number, monthlyLeft: number): AiAllowance => ({
  trial: { tokens: 20_000, remainingTokens: trialLeft },
  monthly: { tokens: 300_000, remainingTokens: monthlyLeft },
  remainingTokens: trialLeft + monthlyLeft,
  resetsAt: '2026-11-01T00:00:00.000Z',
})

describe('the AI allowance', () => {
  it('totals the trial granted and the monthly allowance, so more left than the licence allowance stays under 100 percent', () => {
    const a = allowance(14_200, 300_000)
    expect(a.remainingTokens).toBeGreaterThan(a.monthly.tokens)
    expect(allowanceTotalTokens(a)).toBe(320_000)
    expect(allowancePercentLeft(a)).toBe(98)
    expect(poolPercentLeft(a.trial)).toBe(71)
    expect(poolPercentLeft(a.monthly)).toBe(100)
  })

  it('is 0 percent of a pool that holds nothing', () => {
    expect(poolPercentLeft({ tokens: 0, remainingTokens: 0 })).toBe(0)
    expect(allowancePercentLeft({ ...allowance(0, 0), trial: { tokens: 0, remainingTokens: 0 }, monthly: { tokens: 0, remainingTokens: 0 } })).toBe(0)
  })

  it('takes what an answer used from the monthly pool first, then the trial', () => {
    expect(withRemainingTokens(allowance(14_200, 1_000), 14_700)).toMatchObject({ remainingTokens: 14_700, monthly: { remainingTokens: 500 }, trial: { remainingTokens: 14_200 } })
    expect(withRemainingTokens(allowance(14_200, 1_000), 14_000)).toMatchObject({ remainingTokens: 14_000, monthly: { remainingTokens: 0 }, trial: { remainingTokens: 14_000 } })
  })
})

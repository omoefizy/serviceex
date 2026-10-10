// Statement suggestions from the live transcript: the 30 second picking loop and the tray rules, with the AI
// stubbed. The sermon lines are invented.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiResult } from '../../shared/types'

const ask = vi.fn(async (_task: string, _input: { transcript: string }): Promise<AiResult<{ statements: string[] }>> => ({
  ok: true,
  value: { statements: [] },
}))
vi.stubGlobal('window', { api: { ai: { ask }, media: { getSlideBackgrounds: async () => ({}) } } })

const { useOperatorStore } = await import('../store')
const { useSuggestions, STATEMENT_EXPIRE_MS } = await import('./scriptureDetection')
const { collectStatementText, PICK_INTERVAL_MS } = await import('./statements')

const T0 = 1_000_000
const statements = () => useSuggestions.getState().suggestions.flatMap((s) => (s.type === 'statement' ? [s] : []))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  ask.mockClear()
  useSuggestions.getState().clear()
  useOperatorStore.setState((s) => ({ settings: { ...s.settings, aiEnabled: true, statementPicking: true, quoteSpeakerName: 'Pastor Lee' } }))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('statement picking', () => {
  it('every 30 seconds sends only the new final text, and adds what comes back with the time it was heard', async () => {
    ask.mockResolvedValueOnce({ ok: true, value: { statements: ['Rest is not a reward for finishing.'] } })
    collectStatementText('We tend to treat Sunday like a pit stop.', T0)
    collectStatementText('Rest is not a reward for finishing.', T0 + 4000)
    await vi.advanceTimersByTimeAsync(PICK_INTERVAL_MS - 1)
    expect(ask).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(ask).toHaveBeenCalledWith('pickStatements', {
      transcript: 'We tend to treat Sunday like a pit stop. Rest is not a reward for finishing.',
    })
    expect(statements()).toMatchObject([{ text: 'Rest is not a reward for finishing.', heardAt: T0 + 4000 }])

    // The next run sends only what was said after the last one.
    collectStatementText('It is where the week begins.', T0 + 40_000)
    await vi.advanceTimersByTimeAsync(PICK_INTERVAL_MS)
    expect(ask).toHaveBeenCalledTimes(2)
    expect(ask.mock.calls[1][1]).toEqual({ transcript: 'It is where the week begins.' })
  })

  it('does not ask when it is off, or when AI is off, and keeps no text meanwhile', async () => {
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, statementPicking: false } }))
    collectStatementText('A quiet line nobody should send.', T0)
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, statementPicking: true, aiEnabled: false } }))
    collectStatementText('Another quiet line.', T0 + 1000)
    await vi.advanceTimersByTimeAsync(PICK_INTERVAL_MS * 2)
    expect(ask).not.toHaveBeenCalled()
  })

  it('ignores an answer that is not in the text sent', async () => {
    ask.mockResolvedValueOnce({ ok: true, value: { statements: ['Rest is a gift, not a prize.'] } })
    collectStatementText('Rest is not a reward for finishing.', T0)
    await vi.advanceTimersByTimeAsync(PICK_INTERVAL_MS)
    expect(statements()).toEqual([])
  })
})

describe('statement suggestions in the tray', () => {
  it('never repeats a statement, or one inside another already shown', () => {
    const { addStatement } = useSuggestions.getState()
    expect(addStatement('Small steps still count as walking.', T0)).toBe(true)
    expect(addStatement('small steps, still count as walking', T0 + 1000)).toBe(false)
    expect(addStatement('still count as walking', T0 + 2000)).toBe(false)
    expect(addStatement('Small steps still count as walking with God.', T0 + 3000)).toBe(false)
    expect(statements()).toHaveLength(1)
  })

  it('drops statements after three minutes', () => {
    useSuggestions.getState().addStatement('Small steps still count as walking.', T0)
    useSuggestions.getState().expire(T0 + STATEMENT_EXPIRE_MS - 1)
    expect(statements()).toHaveLength(1)
    useSuggestions.getState().expire(T0 + STATEMENT_EXPIRE_MS)
    expect(statements()).toHaveLength(0)
  })

  it('previews a statement as a quote slide with the default speaker, without touching what is live', () => {
    useSuggestions.getState().addStatement('Small steps still count as walking.', T0)
    const before = useOperatorStore.getState().live
    useSuggestions.getState().preview(statements()[0].id)
    const s = useOperatorStore.getState()
    expect(s.deckType).toBe('quote')
    expect(s.slides).toEqual([{ text: '“Small steps still count as walking.”', caption: '— Pastor Lee' }])
    expect(s.live).toBe(before)
  })

  it('keeps the operator’s edits', () => {
    useSuggestions.getState().addStatement('Small steps still count as walkin.', T0)
    const [s] = statements()
    useSuggestions.getState().editStatement(s.id, 'Small steps still count as walking.')
    expect(statements()[0].text).toBe('Small steps still count as walking.')
  })
})

// Invented sermon lines run through the detection pipeline, with the Bible lookups stubbed.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuoteMatch, Verse } from '../../shared/types'

const getRange = vi.fn(async (_version: string, book: string, chapter: number, start: number, end: number): Promise<Verse[]> => {
  // Every chapter has 30 verses in this stub Bible, except Psalm 23, which has 6.
  const last = Math.min(end, book === 'Psalms' && chapter === 23 ? 6 : 30)
  const verses: Verse[] = []
  for (let verse = start; verse <= last; verse++) verses.push({ book, chapter, verse, text: `Text of ${book} ${chapter}:${verse}.` })
  return verses
})
const matchQuote = vi.fn(async (): Promise<QuoteMatch | null> => null)
vi.stubGlobal('window', { api: { bible: { getRange, matchQuote } } })

const { useOperatorStore } = await import('../store')
const { detectScripture, useSuggestions, DUPLICATE_MS, EXPIRE_MS } = await import('./scriptureDetection')

const labels = () => useSuggestions.getState().suggestions.map((s) => s.label)
const T0 = 1_000_000

beforeEach(async () => {
  // Forget the previous test's last line (with detection off, so it is not read again), then start empty.
  useOperatorStore.setState((s) => ({ settings: { ...s.settings, scriptureDetection: false } }))
  await detectScripture('', 0)
  useSuggestions.getState().clear()
  useOperatorStore.setState((s) => ({ settings: { ...s.settings, scriptureDetection: true, detectionMinConfidence: 0.6 } }))
  matchQuote.mockResolvedValue(null)
})

describe('detectScripture', () => {
  it('suggests a reference named aloud, with its KJV text and the time heard', async () => {
    await detectScripture('Please turn with me to John chapter three verse sixteen.', T0)
    const [s] = useSuggestions.getState().suggestions
    expect(s).toMatchObject({ label: 'John 3:16', kind: 'reference', heardAt: T0, text: 'Text of John 3:16.' })
    expect(getRange).toHaveBeenLastCalledWith('KJV', 'John', 3, 16, 16)
  })

  it('does not repeat a reference within a minute, but does after', async () => {
    await detectScripture('Romans eight twenty eight is our text.', T0)
    await detectScripture('Again, Romans eight twenty eight.', T0 + 30_000)
    expect(labels()).toEqual(['Romans 8:28'])
    await detectScripture('One more time, Romans eight twenty eight.', T0 + DUPLICATE_MS + 1)
    expect(labels()).toEqual(['Romans 8:28', 'Romans 8:28'])
  })

  it('drops suggestions after two minutes', async () => {
    await detectScripture('Turn to Genesis one.', T0)
    useSuggestions.getState().expire(T0 + EXPIRE_MS - 1)
    expect(labels()).toEqual(['Genesis 1'])
    useSuggestions.getState().expire(T0 + EXPIRE_MS)
    expect(labels()).toEqual([])
  })

  it('reads a reference split across two lines, replacing the chapter with the verse', async () => {
    await detectScripture('Turn with me to Philippians chapter four.', T0)
    expect(labels()).toEqual(['Philippians 4'])
    await detectScripture('Verse thirteen.', T0 + 4000)
    expect(labels()).toEqual(['Philippians 4:13'])
  })

  it('skips references below the minimum confidence', async () => {
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, detectionMinConfidence: 0.8 } }))
    await detectScripture('Psalm twenty three is a comfort.', T0)
    await detectScripture('Open to Isaiah chapter forty verse twenty nine.', T0 + 1000)
    expect(labels()).toEqual(['Isaiah 40:29'])
  })

  it('skips verses that do not exist', async () => {
    await detectScripture('Look at Psalm twenty three verse nine.', T0)
    expect(labels()).toEqual([])
  })

  it('suggests a possible quote when no reference is named', async () => {
    matchQuote.mockResolvedValue({ book: 'Proverbs', chapter: 3, verse: 5, version: 'KJV', matched: 13, coverage: 1, confidence: 0.7 })
    await detectScripture('Trust in the Lord with all thine heart and lean not unto thine own understanding.', T0)
    expect(useSuggestions.getState().suggestions[0]).toMatchObject({ label: 'Proverbs 3:5', kind: 'quote', confidence: 0.7 })
  })

  it('does nothing when detection is off', async () => {
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, scriptureDetection: false } }))
    await detectScripture('Turn to John chapter three verse sixteen.', T0)
    expect(labels()).toEqual([])
    expect(matchQuote).not.toHaveBeenCalledWith('Turn to John chapter three verse sixteen.')
  })
})

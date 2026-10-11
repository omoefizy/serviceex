// Invented sermon lines run through the detection pipeline (interim and final results), with the Bible lookups, the
// quote matcher and the AI stubbed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiResult, QuoteMatch, Verse } from '../../shared/types'

const getRange = vi.fn(async (_version: string, book: string, chapter: number, start: number, end: number): Promise<Verse[]> => {
  // Every chapter up to 50 has 30 verses in this stub Bible, except Psalm 23, which has 6.
  if (chapter > 50) return []
  const last = Math.min(end, book === 'Psalms' && chapter === 23 ? 6 : 30)
  const verses: Verse[] = []
  for (let verse = start; verse <= last; verse++) verses.push({ book, chapter, verse, text: `Text of ${book} ${chapter}:${verse}.` })
  return verses
})
const matchQuote = vi.fn<(text: string) => Promise<QuoteMatch[]>>(async () => [])
const ask = vi.fn<(task: string, input: unknown) => Promise<AiResult<{ references: string[] }>>>(async () => ({ ok: true, value: { references: [] } }))
vi.stubGlobal('window', { api: { bible: { getRange, matchQuote }, ai: { ask }, media: { getSlideBackgrounds: async () => ({}) } } })

const { useOperatorStore } = await import('../store')
const { detectFromPartial, detectScripture, resetDetection, useDetectionDebug, useSuggestions, AI_AFTER_MS, DUPLICATE_MS, EXPIRE_MS, STABLE_MS } = await import(
  './scriptureDetection'
)

const T0 = 1_000_000
const scripture = () => useSuggestions.getState().suggestions.flatMap((s) => (s.type === 'scripture' ? [s] : []))
const labels = () => scripture().map((s) => s.label)

beforeEach(() => {
  vi.useFakeTimers()
  resetDetection()
  useSuggestions.getState().clear()
  useOperatorStore.setState((s) => ({
    settings: { ...s.settings, scriptureDetection: true, detectionMinConfidence: 0.6, aiEnabled: true, aiScriptureFallback: false },
  }))
  matchQuote.mockReset()
  matchQuote.mockResolvedValue([])
  ask.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

/** Interim results as a speech engine sends them, `step` ms apart, then time for the last one to settle. */
async function speak(partials: string[], start = T0, step = 100) {
  for (const [i, text] of partials.entries()) {
    await detectFromPartial(text, start + i * step)
    await vi.advanceTimersByTimeAsync(step)
  }
  await vi.advanceTimersByTimeAsync(STABLE_MS)
}

describe('final lines', () => {
  it('suggests a reference named aloud, with its KJV text and the time heard', async () => {
    await detectScripture('Please turn with me to John chapter three verse sixteen.', T0)
    const [s] = scripture()
    expect(s).toMatchObject({ label: 'John 3:16', kind: 'reference', heardAt: T0, text: 'Text of John 3:16.', version: 'KJV' })
    expect(getRange).toHaveBeenLastCalledWith('KJV', 'John', 3, 16, 16)
  })

  it('reads "James chapter two and six" and "first Corinthians thirteen verse four"', async () => {
    await detectScripture('James chapter two and six puts it plainly.', T0)
    await detectScripture('Now turn to first Corinthians thirteen verse four.', T0 + 5000)
    expect(labels()).toEqual(['1 Corinthians 13:4', 'James 2:6'])
  })

  it('does not repeat a reference within a minute, but does after', async () => {
    await detectScripture('Romans eight twenty eight is our text.', T0)
    await detectScripture('Again, Romans eight twenty eight.', T0 + 30_000)
    expect(labels()).toEqual(['Romans 8:28'])
    await detectScripture('One more time, Romans eight twenty eight.', T0 + DUPLICATE_MS + 1)
    expect(labels()).toEqual(['Romans 8:28', 'Romans 8:28'])
  })

  it('does not bring back a reference from earlier words when a later line arrives', async () => {
    await detectScripture('Romans eight twenty eight is our text.', T0)
    useSuggestions.getState().dismiss(scripture()[0].id)
    await detectScripture('Amen.', T0 + DUPLICATE_MS + 5000)
    expect(labels()).toEqual([])
  })

  it('drops suggestions after two minutes', async () => {
    await detectScripture('Turn to Genesis one.', T0)
    useSuggestions.getState().expire(T0 + EXPIRE_MS - 1)
    expect(labels()).toEqual(['Genesis 1'])
    useSuggestions.getState().expire(T0 + EXPIRE_MS)
    expect(labels()).toEqual([])
  })

  it('reads a reference split across two lines, narrowing the chapter card in place', async () => {
    await detectScripture('Turn with me to Philippians chapter four.', T0)
    const [card] = scripture()
    expect(card.label).toBe('Philippians 4')
    await detectScripture('Verse thirteen.', T0 + 4000)
    expect(scripture()).toMatchObject([{ id: card.id, label: 'Philippians 4:13', heardAt: T0 }])
  })

  it('reads a verse alone in the chapter named before it', async () => {
    await detectScripture('Turn to Romans eight.', T0)
    await detectScripture('I want you to see something.', T0 + 3000)
    await detectScripture('Look at verse twenty eight.', T0 + 9000)
    expect(labels()).toEqual(['Romans 8:28'])
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

  it('offers other readings as alternatives, and previews the one chosen without going live', async () => {
    await detectScripture('Turn to Corinthians thirteen verse four.', T0)
    const [card] = scripture()
    expect(card.label).toBe('1 Corinthians 13:4')
    expect(card.alternatives.map((a) => a.label)).toEqual(['2 Corinthians 13:4'])
    const live = useOperatorStore.getState().live
    useSuggestions.getState().preview(card.id, 0)
    expect(useOperatorStore.getState().deckTitle).toBe('2 Corinthians 13:4 KJV')
    expect(useOperatorStore.getState().live).toBe(live)
  })

  it('does nothing when detection is off', async () => {
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, scriptureDetection: false } }))
    await detectScripture('Turn to John chapter three verse sixteen.', T0)
    expect(labels()).toEqual([])
    expect(matchQuote).not.toHaveBeenCalled()
  })
})

describe('bare references in the live tray', () => {
  it('shows "John one five" and "James two six"', async () => {
    await detectScripture('John one five', T0)
    await detectScripture('James two six', T0 + 3000)
    expect(labels()).toEqual(['James 2:6', 'John 1:5'])
    expect(scripture().every((s) => s.confidence >= 0.85)).toBe(true)
  })

  it('shows "John one five" from interim words too', async () => {
    await speak(['John', 'John one', 'John one five'])
    expect(labels()).toEqual(['John 1:5'])
  })

  it('does not show a common name with no numbers after it', async () => {
    await detectScripture('John said he was late.', T0)
    await detectScripture('Mark my words, it will rain.', T0 + 3000)
    expect(labels()).toEqual([])
  })

  it('drops chapters and verses the book does not have', async () => {
    await detectScripture('Job two hundred', T0)
    // Parsed as John 1:90, but the Bible has no such verse.
    await detectScripture('John one ninety', T0 + 3000)
    expect(labels()).toEqual([])
    expect(getRange).toHaveBeenLastCalledWith('KJV', 'John', 1, 90, 90)
  })
})

describe('interim results', () => {
  it('suggests a reference once it is complete and stable, timed from when the words first came', async () => {
    await speak(['turn to', 'turn to Romans', 'turn to Romans eight', 'turn to Romans eight twenty', 'turn to Romans eight twenty eight'])
    expect(labels()).toEqual(['Romans 8:28'])
    // "Romans 8" was there for only 100 ms, and "Romans 8 twenty" was not complete.
    expect(scripture()[0].heardAt).toBe(T0 + 400)
    expect(useDetectionDebug.getState().card).toMatchObject({ label: 'Romans 8:28', stage: 'parser (interim, stable 300 ms)' })
  })

  it('does not add a duplicate when the final line arrives', async () => {
    await speak(['turn to Romans eight twenty eight'])
    await detectScripture('Turn to Romans eight twenty eight.', T0 + 1500)
    expect(labels()).toEqual(['Romans 8:28'])
  })

  it('updates the card when the final line refines it', async () => {
    await speak(['turn to John three sixteen'])
    const [card] = scripture()
    await detectScripture('Turn to John three sixteen to eighteen.', T0 + 2000)
    expect(scripture()).toMatchObject([{ id: card.id, label: 'John 3:16-18' }])
  })

  it('does not suggest a reading the next interim result replaced within 300 ms', async () => {
    await detectFromPartial('turn to John three', T0)
    await vi.advanceTimersByTimeAsync(100)
    await detectFromPartial('turn to John three sixteen', T0 + 100)
    await vi.advanceTimersByTimeAsync(STABLE_MS)
    expect(labels()).toEqual(['John 3:16'])
  })
})

describe('quotes', () => {
  it('suggests a quoted verse with its other candidates and the matched words marked', async () => {
    matchQuote.mockResolvedValue([
      {
        book: 'John', chapter: 1, verse: 5, version: 'WEB', matched: 13, coverage: 1, confidence: 0.78,
        highlight: [{ text: 'The light shines in the darkness, and the darkness hasn’t overcome it.', match: true }],
      },
      { book: 'John', chapter: 8, verse: 12, version: 'WEB', matched: 4, coverage: 0.8, confidence: 0.62, highlight: [] },
    ])
    await detectScripture('the light shines in the darkness and the darkness has not overcome it', T0)
    expect(matchQuote).toHaveBeenCalledWith('the light shines in the darkness and the darkness has not overcome it')
    const [card] = scripture()
    expect(card).toMatchObject({ label: 'John 1:5', kind: 'quote', version: 'WEB' })
    expect(card.highlight?.[0].match).toBe(true)
    expect(card.alternatives.map((a) => a.label)).toEqual(['John 8:12'])
    expect(getRange).toHaveBeenCalledWith('WEB', 'John', 1, 5, 5)
  })

  it('checks interim words for quotes too, at most every 600 ms', async () => {
    await detectFromPartial('remember that the light', T0)
    await detectFromPartial('remember that the light shines', T0 + 200)
    await detectFromPartial('remember that the light shines in darkness', T0 + 700)
    expect(matchQuote).toHaveBeenCalledTimes(2)
  })
})

describe('unrelated talk', () => {
  it('produces no suggestion', async () => {
    const chatter = [
      'Good morning everyone, it is great to see so many of you here.',
      'Coffee is in the hall, and the kids can head to room two and six minutes from now.',
      'We had three sixteen year olds help with the car wash last Saturday.',
      'The band rehearses at eight twenty on Thursday.',
    ]
    for (const [i, line] of chatter.entries()) {
      await speak(line.split(' ').map((_, k, all) => all.slice(0, k + 1).join(' ')), T0 + i * 10_000, 50)
      await detectScripture(line, T0 + i * 10_000 + 5000)
    }
    expect(labels()).toEqual([])
    expect(ask).not.toHaveBeenCalled()
  })
})

describe('AI fallback', () => {
  beforeEach(() => {
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, aiScriptureFallback: true } }))
  })

  it('asks after 8 seconds of scripture-like talk with nothing found, and marks what comes back', async () => {
    ask.mockResolvedValueOnce({ ok: true, value: { references: ['Isaiah 40:29', 'Isaiah 99:1'] } })
    await detectScripture('The Bible says those who wait will find new strength.', T0)
    await detectScripture('They will run and not grow weary.', T0 + 4000)
    expect(ask).not.toHaveBeenCalled()
    await detectScripture('They will walk and not faint.', T0 + AI_AFTER_MS)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask.mock.calls[0]).toEqual([
      'findScriptureReferences',
      { transcript: 'The Bible says those who wait will find new strength. They will run and not grow weary. They will walk and not faint.' },
    ])
    await vi.advanceTimersByTimeAsync(0)
    // Isaiah 99 does not exist in the stub Bible, so only one reading is left.
    expect(scripture()).toMatchObject([{ label: 'Isaiah 40:29', kind: 'ai', alternatives: [] }])
  })

  it('asks at most once every 10 seconds', async () => {
    await detectScripture('It is written that we should not worry.', T0)
    await detectScripture('Scripture says it again and again.', T0 + AI_AFTER_MS)
    await detectScripture('As the apostle wrote, it is written on our hearts.', T0 + AI_AFTER_MS + 1000)
    await detectScripture('The Bible says rest.', T0 + AI_AFTER_MS + 9000)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('does not ask when the parser found the reference', async () => {
    await detectScripture('The Bible says in Romans eight twenty eight that all things work for good.', T0)
    await detectScripture('Hold on to that this week.', T0 + AI_AFTER_MS + 1000)
    expect(ask).not.toHaveBeenCalled()
  })

  it('is off unless AI is on', async () => {
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, aiEnabled: false } }))
    await detectScripture('The Bible says those who wait will find new strength.', T0)
    await detectScripture('They will walk and not faint.', T0 + AI_AFTER_MS + 1000)
    expect(ask).not.toHaveBeenCalled()
  })
})

describe('debug view', () => {
  it('records the segment, each stage and its result', async () => {
    await detectScripture('Some of you came in tired this morning.', T0)
    const { run } = useDetectionDebug.getState()
    expect(run?.segment).toBe('Some of you came in tired this morning.')
    expect(run?.stages.map((s) => s.name)).toEqual(['parser', 'quote'])
    expect(run?.stages[0].result).toBe('no reference')
  })
})

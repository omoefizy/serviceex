// The quotes are verses from the King James Version (public domain) set inside invented sermon sentences.
import { describe, expect, it } from 'vitest'
import { indexForms, quoteWords, scoreQuote, wordKey } from './quoteMatch'

const JOHN_3_16 = 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.'
const PROVERBS_3_5 = 'Trust in the LORD with all thine heart; and lean not unto thine own understanding.'

describe('scoreQuote', () => {
  it('accepts a verse quoted word for word', () => {
    const score = scoreQuote('trust in the Lord with all thine heart and lean not unto thine own understanding', PROVERBS_3_5)
    expect(score.strong).toBe(true)
    expect(score.coverage).toBe(1)
    // Below a reference named with chapter and verse (0.85 and up).
    expect(score.confidence).toBeLessThanOrEqual(0.8)
  })

  it('accepts part of a long verse when most of what was said matches', () => {
    expect(scoreQuote('for God so loved the world that he gave his only begotten son', JOHN_3_16).strong).toBe(true)
  })

  it('allows a few words of the speaker inside the quote', () => {
    expect(scoreQuote('trust in the Lord, friends, with all your heart and lean not on your own understanding', PROVERBS_3_5).strong).toBe(true)
  })

  it('rejects fewer than six matching words', () => {
    expect(scoreQuote('God so loved the world', JOHN_3_16).strong).toBe(false)
  })

  it('rejects talk that only shares common words with a verse', () => {
    expect(scoreQuote('and that is the thing in the world that he should not have', JOHN_3_16).strong).toBe(false)
  })

  it('rejects ordinary sermon talk', () => {
    expect(scoreQuote('so this week I want us to think about how we pray when the news is hard', PROVERBS_3_5).strong).toBe(false)
  })
})

// John 1:5 in the KJV and the World English Bible (both public domain).
const JOHN_1_5_KJV = 'And the light shineth in darkness; and the darkness comprehended it not.'
const JOHN_1_5_WEB = 'The light shines in the darkness, and the darkness hasn’t overcome it.'

describe('normalizing', () => {
  it('reads archaic forms as modern ones', () => {
    expect(['shineth', 'hath', 'doth', 'saith', 'thee', 'thou', 'thy', 'unto', 'ye'].map(wordKey)).toEqual(
      ['shines', 'has', 'does', 'says', 'you', 'you', 'your', 'to', 'you'].map(wordKey),
    )
  })

  it('opens contractions and drops punctuation', () => {
    expect(quoteWords('The darkness hasn’t overcome it.')).toEqual(['the', 'darkness', 'has', 'not', 'overcome', 'it'])
  })

  it('looks a modern word up by its archaic spellings too', () => {
    expect(indexForms('shines')).toContain('shineth')
    expect(indexForms('has')).toContain('hath')
  })
})

describe('rarity and short quotes', () => {
  const rare = (word: string) => (['light', 'shines', 'darkness'].includes(word) ? 0.6 : 0.05)

  it('accepts four distinctive words in order, against either version', () => {
    expect(scoreQuote('the light shines in darkness', JOHN_1_5_KJV, rare).strong).toBe(true)
    expect(scoreQuote('the light shines in darkness', JOHN_1_5_WEB, rare).strong).toBe(true)
  })

  it('needs more words when they are common', () => {
    expect(scoreQuote('the light shines in darkness', JOHN_1_5_WEB, () => 0.1).strong).toBe(false)
  })

  it('marks the matched words in the verse', () => {
    const { highlight } = scoreQuote('the light shines in the darkness and the darkness has not overcome it', JOHN_1_5_WEB, rare)
    expect(highlight.filter((h) => h.match).map((h) => h.text.trim())).toEqual(['The light shines in the darkness, and the darkness hasn’t overcome it.'])
  })
})


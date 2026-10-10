// The quotes are verses from the King James Version (public domain) set inside invented sermon sentences.
import { describe, expect, it } from 'vitest'
import { scoreQuote } from './quoteMatch'

const JOHN_3_16 = 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.'
const PROVERBS_3_5 = 'Trust in the LORD with all thine heart; and lean not unto thine own understanding.'

describe('scoreQuote', () => {
  it('accepts a verse quoted word for word', () => {
    const score = scoreQuote('trust in the Lord with all thine heart and lean not unto thine own understanding', PROVERBS_3_5)
    expect(score.strong).toBe(true)
    expect(score.coverage).toBe(1)
    expect(score.confidence).toBeLessThanOrEqual(0.75)
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

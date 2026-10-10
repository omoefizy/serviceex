// Every transcript here is invented: sermon-style sentences that name scripture, written for these tests.
import { describe, expect, it } from 'vitest'
import { formatReference } from './parseReference'
import { findSpokenReferences, numberWordsToDigits } from './spokenReference'

/** The references found in a transcript, as "John 3:16" strings. */
const refs = (text: string) => findSpokenReferences(text).map((r) => formatReference(r.reference))
const first = (text: string) => findSpokenReferences(text)[0]

describe('numberWordsToDigits', () => {
  it.each([
    ['sixteen', '16'],
    ['twenty three', '23'],
    ['twenty-eight', '28'],
    ['one hundred and nineteen', '119'],
    ['a hundred and fifty', '150'],
    ['eight twenty eight', '8 28'],
    ['three sixteen', '3 16'],
    ['chapter four, verse twelve.', 'chapter 4, verse 12.'],
    ['the one who waits', 'the 1 who waits'],
  ])('%s -> %s', (spoken, digits) => {
    expect(numberWordsToDigits(spoken)).toBe(digits)
  })
})

describe('findSpokenReferences', () => {
  it.each([
    ['Please open with me to John chapter three verse sixteen.', 'John 3:16'],
    ['Paul writes in first Corinthians thirteen verse four that love is patient.', '1 Corinthians 13:4'],
    ['Let us read Psalm twenty three together.', 'Psalms 23'],
    ['We know from Romans eight twenty eight that God works for good.', 'Romans 8:28'],
    ['This morning turn to Genesis one.', 'Genesis 1'],
    ['Our text is Romans 12:2 this week.', 'Romans 12:2'],
    ['Turn to Nehemiah chapter 2, verse 4.', 'Nehemiah 2:4'],
    ['Read Philippians four verses six through seven with me.', 'Philippians 4:6-7'],
    ['In second Timothy three sixteen we see where scripture comes from.', '2 Timothy 3:16'],
    ['Look at Psalm one hundred and nineteen verse one hundred and five.', 'Psalms 119:105'],
    ['Third John verse two is a short prayer.', '3 John 1:2'],
    ['Jude verses twenty four and twenty five close the letter.', 'Jude 1:24-25'],
    ['The book of Revelations chapter twenty one, verse four, promises an end to tears.', 'Revelation 21:4'],
    ['We will be in Song of Solomon two verse four.', 'Song of Songs 2:4'],
    ['Matthew 5 verses 3 to 12 are called the Beatitudes.', 'Matthew 5:3-12'],
  ])('%s', (transcript, expected) => {
    expect(refs(transcript)[0] ?? null).toBe(expected)
  })

  it('splits chapter and verse that a speech engine ran together', () => {
    expect(refs('Later we will also look at Romans 828.')).toEqual(['Romans 8:28'])
    expect(refs('Our memory verse is John 316.')).toEqual(['John 3:16'])
    expect(refs('Genesis 315 is the first promise.')).toEqual(['Genesis 3:15'])
    // A real chapter stays a chapter.
    expect(refs('Psalm 119 is the longest chapter.')).toEqual(['Psalms 119'])
    expect(first('Look at Romans 828.').confidence).toBeLessThan(first('Look at Romans 8 28.').confidence)
  })

  it('rejects chapters a book does not have', () => {
    expect(refs('Jude 30 people came forward.')).toEqual([])
    expect(refs('Philippians chapter nine')).toEqual([])
  })

  it('finds several references in one segment, in order', () => {
    expect(refs('Compare Isaiah fifty three verse five with first Peter two twenty four.')).toEqual([
      'Isaiah 53:5',
      '1 Peter 2:24',
    ])
  })

  it('ignores book names without a chapter after them', () => {
    expect(refs('John said that Mark would come with James and the rest of the team.')).toEqual([])
    expect(refs('The Acts of the apostles is a book about the early church.')).toEqual([])
  })

  it('gives explicit chapter and verse words more confidence than a bare chapter', () => {
    const explicit = first('Turn to John chapter three verse sixteen.')
    const bare = first('Psalm twenty three')
    expect(explicit.confidence).toBeGreaterThan(bare.confidence)
    expect(explicit.confidence).toBeGreaterThanOrEqual(0.9)
    expect(bare.confidence).toBeGreaterThanOrEqual(0.6)
  })

  it('is less sure of book names that are also everyday words', () => {
    const name = first('I spoke with John 3 times last week.')
    const book = first('I spoke about Romans 3 last week.')
    expect(name.confidence).toBeLessThan(0.6)
    expect(book.confidence).toBeGreaterThanOrEqual(0.6)
  })

  it('records what was heard', () => {
    expect(first('Open to John chapter three verse sixteen please.').heard).toBe('john chapter 3 verse 16')
  })
})

import { describe, expect, it } from 'vitest'
import { formatReference, parseBooklessReference, parseReference } from './parseReference'
import { findSpokenReferences } from './spokenReference'
import { naturalBreaks, naturalSplit, snapSplit, versePartText } from './verseParts'

const EPH_1_19 =
  'And what is the exceeding greatness of his power to us-ward who believe, according to the working of his mighty power,'

describe('parseReference with verse parts', () => {
  it.each([
    ['Ephesians 1:19b', { book: 'Ephesians', chapter: 1, verseStart: 19, verseEnd: 19, startPart: 'b', endPart: 'b' }],
    ['eph 1:19a', { book: 'Ephesians', chapter: 1, verseStart: 19, verseEnd: 19, startPart: 'a', endPart: 'a' }],
    ['Ephesians 1:19 b', { book: 'Ephesians', chapter: 1, verseStart: 19, verseEnd: 19, startPart: 'b', endPart: 'b' }],
    ['Ephesians 1:19b to 20a', { book: 'Ephesians', chapter: 1, verseStart: 19, verseEnd: 20, startPart: 'b', endPart: 'a' }],
    ['Ephesians 1:19b-20', { book: 'Ephesians', chapter: 1, verseStart: 19, verseEnd: 20, startPart: 'b' }],
    ['Ephesians 1:18-19a', { book: 'Ephesians', chapter: 1, verseStart: 18, verseEnd: 19, endPart: 'a' }],
    ['John 3:16 through 18', { book: 'John', chapter: 3, verseStart: 16, verseEnd: 18 }],
  ])('%s', (typed, expected) => {
    expect(parseReference(typed)).toStrictEqual(expected)
  })

  it('reads both parts of one verse as the whole verse, and rejects b before a', () => {
    expect(parseReference('Eph 1:19a-19b')).toStrictEqual({ book: 'Ephesians', chapter: 1, verseStart: 19, verseEnd: 19 })
    expect(parseReference('Eph 1:19-19a')).toStrictEqual({ book: 'Ephesians', chapter: 1, verseStart: 19, verseEnd: 19, startPart: 'a', endPart: 'a' })
    expect(parseReference('Eph 1:19b-19a')).toBeNull()
    expect(parseReference('Eph 1:20b-19a')).toBeNull()
  })

  it('leaves references without parts as before', () => {
    expect(parseReference('John 3:16')).toStrictEqual({ book: 'John', chapter: 3, verseStart: 16, verseEnd: 16 })
    expect(parseReference('john 3 16-18')).toStrictEqual({ book: 'John', chapter: 3, verseStart: 16, verseEnd: 18 })
    // A letter that is not a part is not a reference.
    expect(parseReference('John 3:16c')).toBeNull()
  })

  it('displays the reference as requested', () => {
    expect(formatReference(parseReference('ephesians 1:19b')!)).toBe('Ephesians 1:19b')
    expect(formatReference(parseReference('eph 1:19b to 20a')!)).toBe('Ephesians 1:19b-20a')
    expect(formatReference(parseReference('eph 1:18-19a')!)).toBe('Ephesians 1:18-19a')
  })

  it('reads a chapter and verse without a book in the book being read', () => {
    expect(parseBooklessReference('1:19a', 'Ephesians')).toStrictEqual({ book: 'Ephesians', chapter: 1, verseStart: 19, verseEnd: 19, startPart: 'a', endPart: 'a' })
    expect(parseBooklessReference('1:19b to 20a', 'Ephesians')).toMatchObject({ verseStart: 19, verseEnd: 20, startPart: 'b', endPart: 'a' })
    expect(parseBooklessReference('1:19a', null)).toBeNull()
    expect(parseBooklessReference('love', 'Ephesians')).toBeNull()
  })
})

describe('spoken verse parts', () => {
  const spoken = (text: string) => findSpokenReferences(text).map((r) => formatReference(r.reference))

  it('hears "nineteen b"', () => {
    expect(spoken('Turn with me to Ephesians chapter one verse nineteen b.')).toEqual(['Ephesians 1:19b'])
    expect(spoken('Ephesians one nineteen b to twenty a')).toEqual(['Ephesians 1:19b-20a'])
    expect(spoken('Ephesians 1:19b says it plainly')).toEqual(['Ephesians 1:19b'])
  })

  it('takes a spoken "a" as a part only where it cannot be the word', () => {
    expect(spoken('read Ephesians one nineteen a')).toEqual(['Ephesians 1:19a'])
    expect(spoken('Romans eight twenty eight a verse I love')).toEqual(['Romans 8:28'])
  })
})

describe('naturalSplit', () => {
  it('splits at the comma nearest the middle', () => {
    const split = naturalSplit(EPH_1_19)
    expect(versePartText(EPH_1_19, 'a', split)).toBe('And what is the exceeding greatness of his power to us-ward who believe,')
    expect(versePartText(EPH_1_19, 'b', split)).toBe('according to the working of his mighty power,')
  })

  it('splits at a semicolon, colon or dash', () => {
    const semicolon = 'Rejoice in the Lord always; again I will say, rejoice greatly today.'
    expect(versePartText(semicolon, 'b', naturalSplit(semicolon))).toBe('again I will say, rejoice greatly today.')
    const colon = 'The LORD is my shepherd and guide: I shall not want for anything.'
    expect(versePartText(colon, 'b', naturalSplit(colon))).toBe('I shall not want for anything.')
    const dash = 'Every good gift and every perfect gift — it is from above, coming down.'
    expect(versePartText(dash, 'a', naturalSplit(dash))).toBe('Every good gift and every perfect gift —')
  })

  it('prefers punctuation to a joining word nearer the middle', () => {
    // "who" is nearer the middle of Ephesians 1:19 than the comma after "believe".
    expect(versePartText(EPH_1_19, 'b', naturalSplit(EPH_1_19))).toMatch(/^according/)
  })

  it('splits before a joining word when there is no punctuation', () => {
    const text = 'Trust in the LORD with all thine heart and lean not unto thine own understanding'
    expect(versePartText(text, 'b', naturalSplit(text))).toBe('and lean not unto thine own understanding')
  })

  it('splits a verse with no natural break at the middle word', () => {
    const text = 'Jesus wept bitterly over the city of Jerusalem below'
    expect(naturalBreaks(text)).toEqual({ punctuation: [], conjunctions: [] })
    const split = naturalSplit(text)
    expect(versePartText(text, 'a', split)).toBe('Jesus wept bitterly over')
    expect(versePartText(text, 'b', split)).toBe('the city of Jerusalem below')
  })

  it('ignores a break right at the start or end of the verse', () => {
    const text = 'Behold, the virgin shall conceive in her womb a son of promise for all people'
    // The comma after "Behold" is too near the start; "for" sits nearer the middle anyway.
    expect(versePartText(text, 'a', naturalSplit(text))).not.toBe('Behold,')
  })

  it('keeps a one-word verse whole in part a', () => {
    expect(naturalSplit('Rejoice')).toBe('Rejoice'.length)
    expect(versePartText('Rejoice', 'a', naturalSplit('Rejoice'))).toBe('Rejoice')
    expect(versePartText('Rejoice', 'b', naturalSplit('Rejoice'))).toBe('')
  })

  it('snaps a moved split to the nearest word start', () => {
    const text = 'For God so loved the world'
    expect(snapSplit(text, 9)).toBe(text.indexOf('so'))
    expect(snapSplit(text, 0)).toBe(text.indexOf('God'))
    expect(snapSplit(text, 999)).toBe(text.indexOf('world'))
  })
})

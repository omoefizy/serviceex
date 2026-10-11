// Every transcript here is invented: sermon-style sentences that name scripture, written for these tests.
import { describe, expect, it } from 'vitest'
import { formatReference } from './parseReference'
import { CONTEXT_MS, emptyContext, findSpokenReferences, numberWordsToDigits, readTranscript, type ReferenceContext } from './spokenReference'

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

describe('mixed numbers and cue words', () => {
  it.each([
    ['John one five', 'John 1:5'],
    ['James chapter two and six', 'James 2:6'],
    ['turn to first Corinthians thirteen verse four', '1 Corinthians 13:4'],
    ['Look with me at John three sixteen to eighteen.', 'John 3:16-18'],
    ['It is in John three colon sixteen.', 'John 3:16'],
    ['Matthew five from verse three to verse twelve is our passage.', 'Matthew 5:3-12'],
    ['Read Hebrews eleven one with me.', 'Hebrews 11:1'],
    ['Galatians 5 and 22 lists the fruit.', 'Galatians 5:22'],
  ])('%s', (transcript, expected) => {
    expect(refs(transcript)[0] ?? null).toBe(expected)
  })
})

describe('speech to text errors', () => {
  it.each([
    ['Luke two versus ten is the angel speaking.', 'Luke 2:10'],
    ['In 1st John one nine we find forgiveness.', '1 John 1:9'],
    ['I John four eight says it plainly.', '1 John 4:8'],
    ['Paul wrote second Timothy one seven from prison.', '2 Timothy 1:7'],
    ['Revelations three twenty pictures a knock at the door.', 'Revelation 3:20'],
    ['Philippines four thirteen is often quoted.', 'Philippians 4:13'],
    ['Look at Ephesions two eight.', 'Ephesians 2:8'],
    ['Deutoronomy six five is the great command.', 'Deuteronomy 6:5'],
    ['Songs of Songs two four is a picture of love.', 'Song of Songs 2:4'],
  ])('%s', (transcript, expected) => {
    expect(refs(transcript)[0] ?? null).toBe(expected)
  })

  it('is less sure of a near spelling than of the name itself', () => {
    expect(first('Look at Ephesions two eight.').confidence).toBeLessThan(first('Look at Ephesians two eight.').confidence)
  })

  it('does not read everyday words as books', () => {
    expect(refs('The names 3 of us wrote down are on the board.')).toEqual([])
    expect(refs('We played games 2 nights in a row.')).toEqual([])
    // "either" is one letter from "Esther", but a near spelling needs a verse after it.
    expect(refs('Look at either 2 or 3 of the options.')).toEqual([])
  })
})

describe('ambiguous readings', () => {
  it('gives the other numbered book as an alternative when no number was said', () => {
    const found = first('Corinthians thirteen four is read at weddings.')
    expect(formatReference(found.reference)).toBe('1 Corinthians 13:4')
    expect(found.alternatives.map((a) => formatReference(a.reference))).toEqual(['2 Corinthians 13:4'])
    expect(found.alternatives[0].confidence).toBeLessThan(found.confidence)
  })

  it('gives each way to split run-together digits', () => {
    const found = first('Genesis 315 is the first promise.')
    expect(formatReference(found.reference)).toBe('Genesis 3:15')
    expect(found.alternatives.map((a) => formatReference(a.reference))).toEqual(['Genesis 31:5'])
  })

  it('keeps at most three candidates', () => {
    for (const r of findSpokenReferences('Genesis 111 and Psalm 1111 and Corinthians 1')) expect(r.alternatives.length).toBeLessThanOrEqual(2)
  })
})

describe('context', () => {
  const T = 1_000_000
  const read = (text: string, context: ReferenceContext, now = T) => readTranscript(text, context, now)
  const labels = (result: ReturnType<typeof read>) => result.references.map((r) => formatReference(r.reference))

  it('reads "verse twenty eight" in the chapter named before it', () => {
    const before = read('Turn to Romans eight.', emptyContext())
    expect(labels(before)).toEqual(['Romans 8'])
    const after = read('Look at verse twenty eight.', before.context, T + 20_000)
    expect(labels(after)).toEqual(['Romans 8:28'])
    expect(after.references[0].fromContext).toBe(true)
  })

  it('reads "chapter two" alone in the current book', () => {
    const before = read('Turn to John three sixteen.', emptyContext())
    expect(labels(read('Now skip back to chapter two.', before.context, T + 5000))).toEqual(['John 2'])
  })

  it('reads "two and six" after a book named without numbers', () => {
    const before = read('Turn with me to the book of James.', emptyContext())
    expect(before.references).toEqual([])
    expect(labels(read('Two and six is where we start.', before.context, T + 3000))).toEqual(['James 2:6'])
  })

  it('reads a range of verses in the current chapter', () => {
    const before = read('Psalm one hundred and three', emptyContext())
    expect(labels(read('verses two through five', before.context, T + 1000))).toEqual(['Psalms 103:2-5'])
  })

  it('forgets the book and chapter after five minutes', () => {
    const before = read('Turn to Romans eight.', emptyContext())
    expect(read('Look at verse twenty eight.', before.context, T + CONTEXT_MS + 1).references).toEqual([])
  })

  it('needs a context for a verse alone', () => {
    expect(refs('Verse six is short.')).toEqual([])
  })
})

describe('completeness', () => {
  it('is not complete while the words promise more', () => {
    expect(first('Turn to John three verse').complete).toBe(false)
    expect(first('Turn to Psalm twenty').complete).toBe(false)
    expect(first('Turn to John three verse sixteen').complete).toBe(true)
    expect(first('Turn to Psalm twenty three this morning').complete).toBe(true)
  })
})

describe('unrelated talk', () => {
  it('finds nothing in announcements and chatter', () => {
    const chatter = [
      'Good morning everyone, coffee is in the hall and the kids can head to room two and six minutes from now.',
      'We had three sixteen year olds help with the car wash last Saturday.',
      'The youth group meets at seven, and the band rehearses at eight twenty.',
    ]
    for (const line of chatter) expect(refs(line)).toEqual([])
  })
})

describe('confidence of bare references', () => {
  it.each(['John one five', 'James two six', 'Mark four thirty nine'])('"%s" scores at least 0.85, though the name is also a common one', (transcript) => {
    expect(first(transcript).confidence).toBeGreaterThanOrEqual(0.85)
  })

  it('finds nothing after a common name with no numbers right after it', () => {
    for (const line of ['John said he was late.', 'Mark my words, it will rain.', 'Job done, everyone.']) expect(refs(line)).toEqual([])
  })

  it('drops numbers that cannot be a chapter and verse of the book', () => {
    expect(refs('Job two hundred')).toEqual([])
    expect(refs('Mark two hundred')).toEqual([])
  })

  it('is more sure with scripture cue words in the ten words before', () => {
    const plain = first('James two six').confidence
    expect(first('The Bible says, and I love this so much, in James two six').confidence).toBeGreaterThan(plain)
    expect(first('Turn to James two six').confidence).toBeGreaterThan(plain)
  })

  it('is more sure when the book is the current one', () => {
    const T = 1_000_000
    const plain = first('Job one five').confidence
    const before = readTranscript('Open your Bibles to Job one.', emptyContext(), T)
    const inContext = readTranscript('Job one five', before.context, T + 1000).references[0].confidence
    expect(inContext).toBeGreaterThan(plain)
  })
})


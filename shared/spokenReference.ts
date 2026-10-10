// Finds scripture references in spoken text, as a speech engine writes it: "John chapter three verse sixteen",
// "first Corinthians thirteen verse four", "Psalm twenty three", "Romans eight twenty eight", "turn to Genesis one".
// Number words become digits, a spoken book name is found, the numbers after it are read as chapter, verse and
// range, and the result goes through parseReference, which checks the book and normalizes it.

import { BOOK_NAMES, parseReference, type ScriptureReference } from './parseReference'

export interface SpokenReference {
  reference: ScriptureReference
  /** 0 to 1: how sure the reading is, from the cue words around it. */
  confidence: number
  /** The words it was read from, after number words became digits. */
  heard: string
}

// ---------- Number words ----------

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}

/**
 * Number words to digits, keeping separate numbers apart as they are spoken: "twenty three" is 23, "one hundred
 * and nineteen" is 119, but "eight twenty eight" is 8 28 and "three sixteen" is 3 16.
 */
export function numberWordsToDigits(text: string): string {
  // "twenty-eight" is two words.
  const words = text.replace(/([a-z])-(?=[a-z])/gi, '$1 ').split(/\s+/).filter(Boolean)
  const out: string[] = []
  /** The number being read, and what its last word was, to tell whether the next word continues it. */
  const current: { value: number | null; last: 'unit' | 'teen' | 'tens' | 'hundred' | null } = { value: null, last: null }
  const finish = () => {
    if (current.value !== null) out.push(String(current.value))
    current.value = null
    current.last = null
  }
  const start = (n: number) => {
    finish()
    current.value = n
  }
  for (let i = 0; i < words.length; i++) {
    // A word with any punctuation after it, such as "sixteen," at the end of a phrase.
    const parts = /^([a-z]+)([^a-z0-9]*)$/i.exec(words[i])
    const bare = parts?.[1].toLowerCase()
    if (bare !== undefined && bare in UNITS) {
      const n = UNITS[bare]
      // "twenty three" and "hundred nineteen" continue a number; "eight twenty" and "three sixteen" do not.
      if (current.value !== null && ((current.last === 'tens' && n > 0 && n < 10) || current.last === 'hundred')) current.value += n
      else start(n)
      current.last = n < 10 ? 'unit' : 'teen'
    } else if (bare !== undefined && bare in TENS) {
      if (current.value !== null && current.last === 'hundred') current.value += TENS[bare]
      else start(TENS[bare])
      current.last = 'tens'
    } else if (bare === 'hundred') {
      if (current.value !== null && current.last === 'unit') current.value *= 100
      else {
        // "a hundred"
        if (out.at(-1)?.toLowerCase() === 'a') out.pop()
        start(100)
      }
      current.last = 'hundred'
    } else if (bare === 'and' && current.last === 'hundred' && !parts?.[2] && (words[i + 1]?.toLowerCase().replace(/[^a-z]/g, '') ?? '') in { ...UNITS, ...TENS }) {
      // "one hundred and nineteen"
      continue
    } else {
      finish()
      out.push(words[i])
      continue
    }
    if (parts?.[2]) {
      finish()
      out[out.length - 1] += parts[2]
    }
  }
  finish()
  return out.join(' ')
}

// ---------- Books as spoken ----------

/** Spoken names that differ from the stored ones. */
const SPOKEN_NAMES: Record<string, string> = {
  psalm: 'Psalms',
  'song of solomon': 'Song of Songs',
  revelations: 'Revelation',
}

/** "corinthians" -> the numbered books it can start; "john" -> John (and 1-3 John with a number). */
const BOOK_WORDS = new Map<string, { plain: string | null; numbered: boolean }>()
for (const name of BOOK_NAMES) {
  const numbered = /^[123] /.test(name)
  const words = (numbered ? name.slice(2) : name).toLowerCase()
  const entry = BOOK_WORDS.get(words) ?? { plain: null, numbered: false }
  if (numbered) entry.numbered = true
  else entry.plain = name
  BOOK_WORDS.set(words, entry)
}
for (const [spoken, name] of Object.entries(SPOKEN_NAMES)) BOOK_WORDS.set(spoken, { plain: name, numbered: false })
const LONGEST_BOOK = Math.max(...[...BOOK_WORDS.keys()].map((k) => k.split(' ').length))

const BOOK_NUMBERS: Record<string, string> = { '1': '1', '2': '2', '3': '3', first: '1', second: '2', third: '3', '1st': '1', '2nd': '2', '3rd': '3' }

/** Books that are also everyday words or names, so a bare "John 3" is less certain than "Romans 3". */
const COMMON_WORDS = new Set(['John', 'Mark', 'James', 'Job', 'Acts', 'Numbers', 'Judges', 'Jude', 'Ruth', 'Daniel', 'Amos', 'Joel', 'Titus', 'Luke'])

/** Words that often come just before a reference: "turn to", "open your Bibles to", "reading from". */
const LEAD_IN = /\b(turn|turning|open|opening|read|reading|look|looking|found|written|says|see|go|going)\b(\s+\w+){0,4}\s*$/

/** Chapters per book, in BOOK_NAMES order (the Protestant canon, as imported). */
const CHAPTER_COUNTS = [
  50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42, 150, 31, 12, 8, 66, 52, 5, 48, 12, 14, 3, 9, 1, 4, 7,
  3, 3, 3, 2, 14, 4, 28, 16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5, 3, 6, 4, 3, 1, 13, 5, 5, 3, 5, 1, 1, 1, 22,
]
const chaptersIn = (book: string) => CHAPTER_COUNTS[BOOK_NAMES.indexOf(book)] ?? 150
/** Psalm 119 has 176 verses, the most of any chapter. */
const MAX_VERSE = 176

/**
 * A speech engine sometimes writes "eight twenty eight" as "828". When that is too big to be a chapter of the book,
 * read it as chapter and verse, preferring the shorter chapter: "315" in Genesis is 3:15 rather than 31:5.
 */
function splitGlued(book: string, digits: string): { chapter: number; verse: number } | null {
  for (let cut = 1; cut < digits.length; cut++) {
    const chapter = Number(digits.slice(0, cut))
    const verse = Number(digits.slice(cut))
    if (digits[cut] !== '0' && chapter >= 1 && chapter <= chaptersIn(book) && verse >= 1 && verse <= MAX_VERSE) return { chapter, verse }
  }
  return null
}

/** Books with one chapter, cited by verse alone: "Jude verse three" is Jude 1:3. */
const SINGLE_CHAPTER = new Set(['Obadiah', 'Philemon', '2 John', '3 John', 'Jude'])

const RANGE_WORDS = new Set(['through', 'thru', 'to', 'until', 'till', '-', '–', '—'])

// ---------- Finding references ----------

const isNumber = (token: string | undefined) => token !== undefined && /^\d{1,3}$/.test(token)

/**
 * Every reference in a piece of transcript, in the order spoken. Readings that parseReference rejects are left
 * out; whether the chapter and verse exist is for the caller to check against the Bible.
 */
export function findSpokenReferences(text: string): SpokenReference[] {
  const tokens = numberWordsToDigits(text)
    .toLowerCase()
    // "3:16" and "16-18" stay whole; other punctuation becomes a gap.
    .replace(/(\d)\s*([:–—-])\s*(\d)/g, '$1$2$3')
    .replace(/[^a-z0-9:–—\- ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((t) => {
      const colon = /^(\d+):(\d+)(?:[-–—](\d+))?$/.exec(t)
      if (colon) return [colon[1], ':', colon[2], ...(colon[3] ? ['-', colon[3]] : [])]
      const dash = /^(\d+)[-–—](\d+)$/.exec(t)
      return dash ? [dash[1], '-', dash[2]] : [t]
    })

  const found: SpokenReference[] = []
  for (let i = 0; i < tokens.length; i++) {
    const match = readBook(tokens, i)
    if (!match) continue
    const read = readNumbers(tokens, match.end, match.book)
    if (!read) continue
    const verses = read.verseStart === null ? '' : `:${read.verseStart}${read.verseEnd !== read.verseStart ? `-${read.verseEnd}` : ''}`
    const reference = parseReference(`${match.book} ${read.chapter}${verses}`)
    if (!reference) continue

    let confidence = read.glued ? 0.55 : 0.6
    if (read.chapterWord) confidence += 0.15
    if (read.verseCue === 'word' || read.verseCue === 'colon') confidence += 0.2
    else if (read.verseCue === 'bare') confidence += 0.05
    const before = tokens.slice(Math.max(0, match.start - 6), match.start).join(' ')
    const leadIn = LEAD_IN.test(before)
    if (leadIn) confidence += 0.1
    if (COMMON_WORDS.has(reference.book) && !read.chapterWord && read.verseCue !== 'word' && read.verseCue !== 'colon' && !leadIn) {
      confidence -= 0.25
    }
    found.push({
      reference,
      confidence: Math.round(Math.min(0.98, Math.max(0.1, confidence)) * 100) / 100,
      heard: tokens.slice(match.start, read.end).join(' ').replace(/ : /g, ':').replace(/ - /g, '-'),
    })
    i = read.end - 1
  }
  return found
}

/** A book name starting at `i`, with its number word if it has one ("first corinthians"). */
function readBook(tokens: string[], i: number): { book: string; start: number; end: number } | null {
  const number = BOOK_NUMBERS[tokens[i]]
  const nameAt = number ? i + 1 : i
  for (let length = LONGEST_BOOK; length >= 1; length--) {
    const words = tokens.slice(nameAt, nameAt + length).join(' ')
    const entry = BOOK_WORDS.get(words)
    if (!entry) continue
    if (number && entry.numbered) return { book: `${number} ${titleCase(words)}`, start: i, end: nameAt + length }
    // "second John" never means the Gospel, but a number before a book that has none is just a number.
    if (entry.plain && !number) return { book: entry.plain, start: i, end: nameAt + length }
    if (entry.plain && number) return null
    // A numbered book named without its number ("Corinthians 13") cannot be placed.
    return null
  }
  return null
}

const titleCase = (words: string) => words.replace(/\b[a-z]/g, (c) => c.toUpperCase())

interface NumbersRead {
  chapter: number
  verseStart: number | null
  verseEnd: number | null
  chapterWord: boolean
  /** How the verse was marked: the word "verse", a colon, a bare second number, or not at all. */
  verseCue: 'word' | 'colon' | 'bare' | null
  /** Chapter and verse came as one number ("828"). */
  glued?: boolean
  end: number
}

/** "chapter 3 verse 16", "3:16", "8 28", "23", "13 verse 4 through 7" after a book name. */
function readNumbers(tokens: string[], at: number, book: string): NumbersRead | null {
  let i = at
  let chapterWord = false
  if (SINGLE_CHAPTER.has(book) && (tokens[i] === 'verse' || tokens[i] === 'verses') && isNumber(tokens[i + 1])) {
    // Chapter 1 is implied; read the rest as "1 verse N".
    const rest = readNumbers(['1', ...tokens.slice(i)], 0, book)
    return rest && { ...rest, chapterWord: true, end: rest.end - 1 + i }
  }
  if (tokens[i] === 'chapter') {
    chapterWord = true
    i++
  }
  if (!isNumber(tokens[i])) return null
  if (Number(tokens[i]) > chaptersIn(book)) {
    // Not a chapter of this book: either chapter and verse run together, or not a reference at all.
    const glued = !chapterWord && tokens[i + 1] !== ':' ? splitGlued(book, tokens[i]) : null
    if (!glued) return null
    return { chapter: glued.chapter, verseStart: glued.verse, verseEnd: glued.verse, chapterWord, verseCue: 'bare', glued: true, end: i + 1 }
  }
  const chapter = Number(tokens[i++])

  let verseCue: NumbersRead['verseCue'] = null
  let verseStart: number | null = null
  if (tokens[i] === ':' && isNumber(tokens[i + 1])) {
    verseCue = 'colon'
    verseStart = Number(tokens[i + 1])
    i += 2
  } else {
    let j = i
    if (tokens[j] === 'and') j++
    if (tokens[j] === 'verse' || tokens[j] === 'verses') {
      j++
      if (tokens[j] === 'number') j++
      if (isNumber(tokens[j])) {
        verseCue = 'word'
        verseStart = Number(tokens[j])
        i = j + 1
      }
    } else if (isNumber(tokens[i]) && !chapterWord) {
      // "Romans 8 28": a second bare number is the verse. After "chapter 8" a bare number is more likely a count.
      verseCue = 'bare'
      verseStart = Number(tokens[i])
      i++
    }
  }

  let verseEnd = verseStart
  if (verseStart !== null) {
    const rangeWord = tokens[i]
    const isRange = RANGE_WORDS.has(rangeWord) || (rangeWord === 'and' && verseCue === 'word')
    if (isRange && isNumber(tokens[i + 1]) && Number(tokens[i + 1]) > verseStart) {
      verseEnd = Number(tokens[i + 1])
      i += 2
    }
  }
  return { chapter, verseStart, verseEnd, chapterWord, verseCue, end: i }
}

// Finds scripture references in spoken text, as a speech engine writes it: "John chapter three verse sixteen",
// "first Corinthians thirteen verse four", "Psalm twenty three", "Romans eight twenty eight", "James two and six".
// Number words become digits, a spoken book name is found (allowing for common mishearings and small spelling
// slips), the numbers after it are read as chapter, verse and range, and the result goes through parseReference,
// which checks the book and normalizes it. A context of the current book and chapter lets "verse twenty eight" or
// "chapter two" alone resolve. When the words allow several readings, the most likely comes first with up to two
// alternatives.

import { BOOK_NAMES, formatReference, parseReference, type ScriptureReference } from './parseReference'

export interface ReferenceCandidate {
  reference: ScriptureReference
  /** 0 to 1: how sure the reading is, from the cue words around it. */
  confidence: number
}

export interface SpokenReference extends ReferenceCandidate {
  /** The words it was read from, after number words became digits. */
  heard: string
  /** Other readings of the same words, most likely first (at most two): "Corinthians 13" may be 1 or 2 Corinthians. */
  alternatives: ReferenceCandidate[]
  /** False when the words end on something that promises more, such as "John 3 verse" or "Psalm twenty". */
  complete: boolean
  /** Resolved from the current book and chapter ("verse twenty eight" after "Romans eight"). */
  fromContext: boolean
  /** Where it ends, in words as countTokens counts them, to tell new text from text already read. */
  end: number
}

/** The book and chapter the speaker is in, from the last confident reference; forgotten after five minutes. */
export interface ReferenceContext {
  book: string | null
  chapter: number | null
  /** When it was last set, in milliseconds. */
  at: number
}

export const CONTEXT_MS = 5 * 60_000

export const emptyContext = (): ReferenceContext => ({ book: null, chapter: null, at: 0 })

/** The context to read with at `now`: empty once five minutes have passed without a reference. */
export function liveContext(context: ReferenceContext, now: number): ReferenceContext {
  return context.book && now - context.at <= CONTEXT_MS ? context : emptyContext()
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

/**
 * Spoken names, and common mishearings, that differ from the stored ones. A value starting with "#" is the name of a
 * numbered book without its number ("corinthian" -> "# corinthians"): it still needs "first" or "second".
 */
const SPOKEN_NAMES: Record<string, string> = {
  psalm: 'Psalms',
  'song of solomon': 'Song of Songs',
  'songs of songs': 'Song of Songs',
  'song of song': 'Song of Songs',
  revelations: 'Revelation',
  'revelation of john': 'Revelation',
  'acts of the apostles': 'Acts',
  'gospel of matthew': 'Matthew',
  'gospel of mark': 'Mark',
  'gospel of luke': 'Luke',
  'gospel of john': 'John',
  roman: 'Romans',
  romance: 'Romans',
  philippines: 'Philippians',
  philippian: 'Philippians',
  phillipians: 'Philippians',
  galatian: 'Galatians',
  ephesian: 'Ephesians',
  colossian: 'Colossians',
  collisions: 'Colossians',
  hebrew: 'Hebrews',
  proverb: 'Proverbs',
  mathew: 'Matthew',
  matthews: 'Matthew',
  isiah: 'Isaiah',
  ecclesiastics: 'Ecclesiastes',
  lamentation: 'Lamentations',
  zachariah: 'Zechariah',
  zacharias: 'Zechariah',
  habakuk: 'Habakkuk',
  jonas: 'Jonah',
  corinthian: '# corinthians',
  thessalonian: '# thessalonians',
  chronicle: '# chronicles',
  king: '# kings',
}

interface BookWords {
  /** The book these words name on their own, such as "John" for "john". */
  plain: string | null
  /** The words of numbered books they name with "first", "second" or "third" ("corinthians"); null for none. */
  numbered: string | null
}

/** "corinthians" -> the numbered books it can start; "john" -> John (and 1-3 John with a number). */
const BOOK_WORDS = new Map<string, BookWords>()
const entryFor = (words: string) => BOOK_WORDS.get(words) ?? { plain: null, numbered: null }
for (const name of BOOK_NAMES) {
  const numbered = /^[123] /.test(name)
  const words = (numbered ? name.slice(2) : name).toLowerCase()
  const entry = entryFor(words)
  if (numbered) entry.numbered = words
  else entry.plain = name
  BOOK_WORDS.set(words, entry)
}
for (const [spoken, name] of Object.entries(SPOKEN_NAMES)) {
  const entry = entryFor(spoken)
  if (name.startsWith('# ')) entry.numbered = name.slice(2)
  else entry.plain = name
  BOOK_WORDS.set(spoken, entry)
}
const LONGEST_BOOK = Math.max(...[...BOOK_WORDS.keys()].map((k) => k.split(' ').length))

const BOOK_NUMBERS: Record<string, string> = { '1': '1', '2': '2', '3': '3', first: '1', second: '2', third: '3', '1st': '1', '2nd': '2', '3rd': '3' }
/** Roman numerals count only right before a numbered book ("I John"), since "I" is mostly the pronoun. */
const ROMAN_NUMBERS: Record<string, string> = { i: '1', ii: '2', iii: '3' }

/** Books that are also everyday words or names, so a bare "John 3" is less certain than "Romans 3". */
const COMMON_WORDS = new Set(['John', 'Mark', 'James', 'Job', 'Acts', 'Numbers', 'Judges', 'Jude', 'Ruth', 'Daniel', 'Amos', 'Joel', 'Titus', 'Luke'])

/** Words that often come just before a reference: "turn to", "open your Bibles to", "reading from", "in the book of". */
const LEAD_IN = /\b(turn|turning|open|opening|read|reading|look|looking|found|written|says|see|go|going|book|from)\b(\s+\w+){0,4}\s*$/
/** Scripture cues anywhere in the ten words before a reference, which make it more certain. */
const CUES = /\b(turn(ing)? (with me )?to|open(ing)? (your bibles? )?to|the bible says|look(ing)? at|in the book of|read(ing)? from|it is written|scripture says)\b/
const CUE_WORDS = 10

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
 * read it as chapter and verse; every split that fits is a candidate, the shorter chapter first ("315" in Genesis
 * is 3:15, then 31:5).
 */
function splitGlued(book: string, digits: string): { chapter: number; verse: number }[] {
  const splits: { chapter: number; verse: number }[] = []
  for (let cut = 1; cut < digits.length; cut++) {
    const chapter = Number(digits.slice(0, cut))
    const verse = Number(digits.slice(cut))
    if (digits[cut] !== '0' && chapter >= 1 && chapter <= chaptersIn(book) && verse >= 1 && verse <= MAX_VERSE) splits.push({ chapter, verse })
  }
  return splits
}

/** Books with one chapter, cited by verse alone: "Jude verse three" is Jude 1:3. */
const SINGLE_CHAPTER = new Set(['Obadiah', 'Philemon', '2 John', '3 John', 'Jude'])

const RANGE_WORDS = new Set(['through', 'to', 'until', 'till', '-'])
/** Words that promise more when the text ends on them: "John 3 verse", "Romans 8 and". */
const DANGLING = new Set(['chapter', 'verse', 'verses', ':', 'and', 'from', 'number', ...RANGE_WORDS])

// ---------- Fuzzy book names ----------

/** Edit distance with swaps of neighbouring letters counted as one edit. */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/** One-word book names longer than four letters, for fuzzy matching; books that are everyday words are left out. */
const FUZZY_TARGETS = [...BOOK_WORDS.entries()].filter(
  ([words, entry]) => !words.includes(' ') && words.length > 4 && !(entry.plain && COMMON_WORDS.has(entry.plain)) && !SPOKEN_NAMES[words],
)

/** Book words within one edit (names of five to seven letters) or two (eight or more) of `word`, nearest first. */
function fuzzyBooks(word: string): { entry: BookWords; distance: number }[] {
  if (word.length < 4 || /\d/.test(word)) return []
  const found: { entry: BookWords; distance: number }[] = []
  for (const [words, entry] of FUZZY_TARGETS) {
    const allowed = words.length >= 8 ? 2 : 1
    if (Math.abs(words.length - word.length) > allowed) continue
    const distance = editDistance(word, words)
    if (distance > 0 && distance <= allowed) found.push({ entry, distance })
  }
  return found.sort((a, b) => a.distance - b.distance)
}

// ---------- Finding references ----------

const isNumber = (token: string | undefined) => token !== undefined && /^\d{1,3}$/.test(token)

/** Lowercase tokens with number words as digits; "3:16" and "16-18" split into their parts, "versus" read as "verse". */
function tokenize(text: string): string[] {
  return numberWordsToDigits(text)
    .toLowerCase()
    .replace(/(\d)\s*([:–—-])\s*(\d)/g, '$1$2$3')
    .replace(/[^a-z0-9:–—\- ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((t) => {
      const colon = /^(\d+):(\d+)(?:[-–—](\d+))?$/.exec(t)
      if (colon) return [colon[1], ':', colon[2], ...(colon[3] ? ['-', colon[3]] : [])]
      const dash = /^(\d+)[-–—](\d+)$/.exec(t)
      if (dash) return [dash[1], '-', dash[2]]
      if (t === 'verses' || t === 'versus' || t === 'vs' || t === 'vers') return ['verse']
      if (t === 'colon') return [':']
      if (t === 'chapters') return ['chapter']
      if (t === 'thru' || t === 'through') return ['through']
      if (t === '–' || t === '—') return ['-']
      return [t]
    })
}

/** How many words the parser reads in a text (number words such as "twenty three" count once). */
export const countTokens = (text: string) => tokenize(text).length

/**
 * Every reference in a piece of transcript, in the order spoken. Readings that parseReference rejects are left
 * out; whether the chapter and verse exist is for the caller to check against the Bible.
 */
export function findSpokenReferences(text: string, context?: ReferenceContext, now = Date.now()): SpokenReference[] {
  return readTranscript(text, context ?? emptyContext(), now).references
}

/**
 * Reads a piece of transcript with a context, returning what it found and the context after it: confident
 * references set the book and chapter, and a book named with a lead-in ("turn to James") sets the book alone.
 */
export function readTranscript(text: string, context: ReferenceContext, now = Date.now()): { references: SpokenReference[]; context: ReferenceContext } {
  const tokens = tokenize(text)
  let ctx = liveContext(context, now)
  const found: SpokenReference[] = []
  for (let i = 0; i < tokens.length; i++) {
    const before = tokens.slice(Math.max(0, i - 6), i).join(' ')
    const leadIn = LEAD_IN.test(before) || CUES.test(tokens.slice(Math.max(0, i - CUE_WORDS), i).join(' '))
    const book = readBook(tokens, i)
    let reading: Reading | null = null
    if (book) {
      reading = readAfterBook(tokens, book, leadIn, ctx)
      if (!reading && book.exact && (leadIn || !book.options.some((o) => COMMON_WORDS.has(o.book)))) {
        // A book named without numbers ("turn to James"): numbers that follow later can use it.
        if (book.options.length === 1) ctx = { book: book.options[0].book, chapter: null, at: now }
        i = book.end - 1
        continue
      }
    }
    reading ??= readFromContext(tokens, i, ctx)
    if (!reading) continue
    const [top, ...rest] = reading.candidates
    found.push({
      ...top,
      alternatives: rest.slice(0, 2),
      heard: tokens.slice(reading.start, reading.end).join(' ').replace(/ : /g, ':').replace(/ - /g, '-'),
      complete: reading.complete,
      fromContext: reading.fromContext,
      end: reading.end,
    })
    if (top.confidence >= 0.6) ctx = { book: top.reference.book, chapter: top.reference.chapter, at: now }
    i = reading.end - 1
  }
  return { references: found, context: ctx }
}

interface BookRead {
  /** Every book the words may name, with how much less sure each reading is. */
  options: { book: string; penalty: number }[]
  /** Named exactly (not by a near spelling). */
  exact: boolean
  start: number
  end: number
}

/** A book name starting at `i`, with its number word if it has one ("first corinthians"); several when unsure. */
function readBook(tokens: string[], i: number): BookRead | null {
  const roman = ROMAN_NUMBERS[tokens[i]]
  const number = BOOK_NUMBERS[tokens[i]] ?? roman
  const nameAt = number ? i + 1 : i
  for (let length = LONGEST_BOOK; length >= 1; length--) {
    const words = tokens.slice(nameAt, nameAt + length).join(' ')
    const entry = BOOK_WORDS.get(words)
    if (!entry) continue
    const end = nameAt + length
    if (number && entry.numbered) {
      return { options: [{ book: `${number} ${titleCase(entry.numbered)}`, penalty: roman ? 0.1 : 0 }], exact: true, start: i, end }
    }
    // A number before a book that has none is just a number ("2 Romans"); the book is read from the next word.
    if (number) return null
    if (entry.plain) return { options: [{ book: entry.plain, penalty: 0 }], exact: true, start: i, end }
    // A numbered book named without its number ("Corinthians 13"): each numbered book is a candidate.
    if (entry.numbered) {
      const options = BOOK_NAMES.filter((name) => /^[123] /.test(name) && name.slice(2).toLowerCase() === entry.numbered).map((book, k) => ({
        book,
        // The Bible lookup settles most of these (1 Corinthians 5 has no verse 17), so the doubt costs little.
        penalty: 0.1 + k * 0.05,
      }))
      return { options, exact: true, start: i, end }
    }
  }
  // Near spellings of a one-word name: "Philipians", "Ephesions", "Genisis".
  const near = fuzzyBooks(tokens[nameAt] ?? '')
  const options = near.flatMap(({ entry, distance }) => {
    const penalty = 0.05 + distance * 0.05
    if (number && entry.numbered) return [{ book: `${number} ${titleCase(entry.numbered)}`, penalty }]
    if (!number && entry.plain) return [{ book: entry.plain, penalty }]
    return []
  })
  return options.length > 0 ? { options, exact: false, start: i, end: nameAt + 1 } : null
}

const titleCase = (words: string) => words.replace(/\b[a-z]/g, (c) => c.toUpperCase())

interface Reading {
  /** Most likely first. */
  candidates: ReferenceCandidate[]
  start: number
  end: number
  complete: boolean
  fromContext: boolean
}

/** The numbers after a book name, read once per book it may be; null when no number follows. */
/**
 * Scores: a chapter and verse right after the name ("John 1 5", "James 2 and 6") is a reference even when the name
 * is also a common name or word, so it starts at 0.9 (0.85 when the digits ran together); whether that verse exists
 * is for the caller to check. A chapter alone after a common name ("John 3 times") stays doubtful unless cued. Cue
 * words in the ten words before, and the book being the current one, add to it.
 */
function readAfterBook(tokens: string[], book: BookRead, leadIn: boolean, ctx: ReferenceContext): Reading | null {
  const candidates: ReferenceCandidate[] = []
  let end = book.end
  let complete = true
  for (const option of book.options) {
    for (const read of readNumbers(tokens, book.end, option.book)) {
      // A near spelling needs a verse or the word "chapter" too: "either 2 or 3" is not Esther 2.
      if (!book.exact && read.verseStart === null && !read.chapterWord) continue
      const reference = parseReference(`${option.book} ${read.chapter}${verseText(read)}`)
      if (!reference) continue
      let confidence: number
      if (read.verseStart !== null) {
        confidence = read.glued ? 0.85 : 0.9
        if (read.chapterWord || read.verseCue === 'word' || read.verseCue === 'colon') confidence += 0.05
      } else {
        confidence = read.chapterWord ? 0.75 : 0.6
        if (COMMON_WORDS.has(reference.book) && !read.chapterWord && !leadIn) confidence -= 0.25
      }
      if (leadIn) confidence += 0.1
      if (ctx.book === reference.book) confidence += 0.05
      candidates.push({ reference, confidence: round(confidence - option.penalty - read.penalty) })
      if (read.end > end) {
        end = read.end
        complete = read.complete
      }
    }
  }
  if (candidates.length === 0) return null
  return { candidates: rank(candidates), start: book.start, end, complete, fromContext: false }
}

/**
 * "chapter 2" with no book before it reads in the current book; "verse 6" (or "look at verses 6 to 8") in the
 * current chapter; and "2 and 6" or "2 verse 6" right after a book was named without numbers.
 */
function readFromContext(tokens: string[], i: number, ctx: ReferenceContext): Reading | null {
  if (!ctx.book) return null
  const token = tokens[i]
  let reads: NumbersRead[] = []
  let confidence = 0.7
  if (token === 'chapter' && isNumber(tokens[i + 1])) {
    reads = readNumbers(tokens, i, ctx.book)
  } else if (token === 'verse' && isNumber(tokens[i + 1]) && (ctx.chapter !== null || SINGLE_CHAPTER.has(ctx.book))) {
    reads = readNumbers([String(ctx.chapter ?? 1), ...tokens.slice(i)], 0, ctx.book).map((r) => ({ ...r, end: r.end - 1 + i }))
  } else if (ctx.chapter === null && isNumber(token) && ['and', 'verse', ':'].includes(tokens[i + 1] ?? '') && isNumber(tokens[i + 2])) {
    reads = readNumbers(tokens, i, ctx.book)
    confidence = 0.6
  }
  const candidates = reads.flatMap((read) => {
    const reference = parseReference(`${ctx.book} ${read.chapter}${verseText(read)}`)
    return reference ? [{ reference, confidence: round(confidence + (read.verseCue === 'word' ? 0.1 : 0) - read.penalty) }] : []
  })
  if (candidates.length === 0) return null
  return { candidates: rank(candidates), start: i, end: Math.max(...reads.map((r) => r.end)), complete: reads[0].complete, fromContext: true }
}

const round = (confidence: number) => Math.round(Math.min(0.98, Math.max(0.1, confidence)) * 100) / 100

/** Best first, without repeats. */
function rank(candidates: ReferenceCandidate[]): ReferenceCandidate[] {
  const seen = new Set<string>()
  return [...candidates]
    .sort((a, b) => b.confidence - a.confidence)
    .filter((c) => {
      const key = formatReference(c.reference)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

const verseText = (read: NumbersRead) =>
  read.verseStart === null ? '' : `:${read.verseStart}${read.verseEnd !== read.verseStart ? `-${read.verseEnd}` : ''}`

interface NumbersRead {
  chapter: number
  verseStart: number | null
  verseEnd: number | null
  chapterWord: boolean
  /** How the verse was marked: the word "verse", a colon, "and", a bare second number, or not at all. */
  verseCue: 'word' | 'colon' | 'and' | 'bare' | null
  /** Chapter and verse came as one number ("828"). */
  glued?: boolean
  /** Less sure than the cues suggest (a second way to split glued digits). */
  penalty: number
  end: number
  complete: boolean
}

/**
 * "chapter 3 verse 16", "3:16", "3 colon 16", "8 28", "2 and 6", "23", "3 from verse 16 to 18" after a book name.
 * Usually one reading; glued digits may give several.
 */
function readNumbers(tokens: string[], at: number, book: string): NumbersRead[] {
  let i = at
  let chapterWord = false
  if (SINGLE_CHAPTER.has(book) && tokens[i] === 'verse' && isNumber(tokens[i + 1])) {
    // Chapter 1 is implied; read the rest as "1 verse N".
    return readNumbers(['1', ...tokens.slice(i)], 0, book).map((rest) => ({ ...rest, chapterWord: true, end: rest.end - 1 + i }))
  }
  if (tokens[i] === 'chapter') {
    chapterWord = true
    i++
  }
  if (!isNumber(tokens[i])) return []
  if (Number(tokens[i]) > chaptersIn(book)) {
    // Not a chapter of this book: either chapter and verse run together, or not a reference at all.
    if (chapterWord || tokens[i + 1] === ':') return []
    return splitGlued(book, tokens[i]).map((glued, k) => ({
      chapter: glued.chapter,
      verseStart: glued.verse,
      verseEnd: glued.verse,
      chapterWord,
      verseCue: 'bare',
      glued: true,
      penalty: k * 0.15,
      end: i + 1,
      complete: true,
    }))
  }
  const chapter = Number(tokens[i++])

  let verseCue: NumbersRead['verseCue'] = null
  let verseStart: number | null = null
  let j = i
  if (tokens[j] === 'from') j++
  if (tokens[j] === ':' && isNumber(tokens[j + 1])) {
    verseCue = 'colon'
    verseStart = Number(tokens[j + 1])
    i = j + 2
  } else {
    if (tokens[j] === 'and' && tokens[j + 1] === 'verse') j++
    if (tokens[j] === 'verse') {
      j++
      if (tokens[j] === 'number') j++
      if (isNumber(tokens[j])) {
        verseCue = 'word'
        verseStart = Number(tokens[j])
        i = j + 1
      }
    } else if (tokens[j] === 'and' && isNumber(tokens[j + 1])) {
      // "James 2 and 6", "chapter 2 and 6": chapter and verse.
      verseCue = 'and'
      verseStart = Number(tokens[j + 1])
      i = j + 2
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
    const next = tokens[i + 1] === 'verse' ? i + 2 : i + 1
    if (isRange && isNumber(tokens[next]) && Number(tokens[next]) > verseStart) {
      verseEnd = Number(tokens[next])
      i = next + 1
    }
  }
  // Ends on a cue with nothing after it, or on a round number that may continue ("twenty" before "three").
  const last = Number(tokens[i - 1])
  const complete = !(i === tokens.length - 1 && DANGLING.has(tokens[i])) && !(i === tokens.length && last >= 20 && last % 10 === 0)
  return [{ chapter, verseStart, verseEnd, chapterWord, verseCue, penalty: 0, end: i, complete }]
}

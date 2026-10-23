export interface ScriptureReference {
  /** Full book name as stored in the database, such as "1 Corinthians". */
  book: string
  chapter: number
  /** Null when the whole chapter was asked for. */
  verseStart: number | null
  /** Equal to `verseStart` for a single verse; null with `verseStart`. */
  verseEnd: number | null
}

/**
 * Book names in Bible order, matching the names the importer stores, each with its common abbreviations.
 * Numbered books list abbreviations without the number; "1 jn" and "1jn" both become "1jn" before lookup.
 */
const BOOKS: [name: string, aliases: string[]][] = [
  ['Genesis', ['gen', 'ge', 'gn']],
  ['Exodus', ['ex', 'exo', 'exod']],
  ['Leviticus', ['lev', 'le', 'lv']],
  ['Numbers', ['num', 'nu', 'nm', 'nb']],
  ['Deuteronomy', ['deut', 'deu', 'de', 'dt']],
  ['Joshua', ['josh', 'jos', 'jsh']],
  ['Judges', ['judg', 'jdg', 'jg', 'jdgs']],
  ['Ruth', ['rth', 'ru']],
  ['1 Samuel', ['sam', 'sa', 'sm', 'samuel']],
  ['2 Samuel', ['sam', 'sa', 'sm', 'samuel']],
  ['1 Kings', ['kgs', 'ki', 'kin', 'kings']],
  ['2 Kings', ['kgs', 'ki', 'kin', 'kings']],
  ['1 Chronicles', ['chr', 'ch', 'chron', 'chronicles']],
  ['2 Chronicles', ['chr', 'ch', 'chron', 'chronicles']],
  ['Ezra', ['ezr']],
  ['Nehemiah', ['neh', 'ne']],
  ['Esther', ['est', 'esth', 'es']],
  ['Job', ['jb']],
  ['Psalms', ['ps', 'psa', 'psm', 'pss', 'psalm']],
  ['Proverbs', ['prov', 'pro', 'prv', 'pr']],
  ['Ecclesiastes', ['eccl', 'eccle', 'ecc', 'ec', 'qoh']],
  ['Song of Songs', ['song', 'sos', 'so', 'ss', 'songofsolomon', 'canticles', 'cant']],
  ['Isaiah', ['isa', 'is']],
  ['Jeremiah', ['jer', 'je', 'jr']],
  ['Lamentations', ['lam', 'la']],
  ['Ezekiel', ['ezek', 'eze', 'ezk']],
  ['Daniel', ['dan', 'da', 'dn']],
  ['Hosea', ['hos', 'ho']],
  ['Joel', ['jl']],
  ['Amos', ['am']],
  ['Obadiah', ['obad', 'ob']],
  ['Jonah', ['jnh', 'jon']],
  ['Micah', ['mic', 'mc']],
  ['Nahum', ['nah', 'na']],
  ['Habakkuk', ['hab', 'hb']],
  ['Zephaniah', ['zeph', 'zep', 'zp']],
  ['Haggai', ['hag', 'hg']],
  ['Zechariah', ['zech', 'zec', 'zc']],
  ['Malachi', ['mal', 'ml']],
  ['Matthew', ['matt', 'mat', 'mt']],
  ['Mark', ['mrk', 'mar', 'mk', 'mr']],
  ['Luke', ['luk', 'lk']],
  ['John', ['jn', 'jhn', 'joh']],
  ['Acts', ['act', 'ac']],
  ['Romans', ['rom', 'ro', 'rm']],
  ['1 Corinthians', ['cor', 'co', 'corinthians']],
  ['2 Corinthians', ['cor', 'co', 'corinthians']],
  ['Galatians', ['gal', 'ga']],
  ['Ephesians', ['eph', 'ephes']],
  ['Philippians', ['phil', 'php', 'pp']],
  ['Colossians', ['col']],
  ['1 Thessalonians', ['thess', 'thes', 'th', 'thessalonians']],
  ['2 Thessalonians', ['thess', 'thes', 'th', 'thessalonians']],
  ['1 Timothy', ['tim', 'ti', 'timothy']],
  ['2 Timothy', ['tim', 'ti', 'timothy']],
  ['Titus', ['tit']],
  ['Philemon', ['philem', 'phm', 'pm']],
  ['Hebrews', ['heb']],
  ['James', ['jas', 'jm']],
  ['1 Peter', ['pet', 'pe', 'pt', 'peter']],
  ['2 Peter', ['pet', 'pe', 'pt', 'peter']],
  ['1 John', ['jn', 'jhn', 'joh', 'john']],
  ['2 John', ['jn', 'jhn', 'joh', 'john']],
  ['3 John', ['jn', 'jhn', 'joh', 'john']],
  ['Jude', ['jud', 'jd']],
  ['Revelation', ['rev', 're', 'rv', 'revelations']],
]

/** "1 Corinthians" -> "1corinthians" */
const toKey = (name: string) => name.toLowerCase().replace(/\s+/g, '')

const BOOK_KEYS = BOOKS.map(([name]) => ({ name, key: toKey(name) }))

/** Exact lookup from abbreviation or full name, with any book number in front. */
const ALIASES = new Map<string, string>()
for (const [name, aliases] of BOOKS) {
  const number = /^[123] /.test(name) ? name[0] : ''
  ALIASES.set(toKey(name), name)
  for (const alias of aliases) ALIASES.set(number + alias, name)
}

const ORDINALS: Record<string, string> = {
  i: '1', ii: '2', iii: '3', '1st': '1', '2nd': '2', '3rd': '3', first: '1', second: '2', third: '3',
}

function findBook(numberWord: string | undefined, name: string): string | null {
  const key = (numberWord ? (ORDINALS[numberWord] ?? numberWord) : '') + name.replace(/\s+/g, '')
  const exact = ALIASES.get(key)
  if (exact) return exact
  // Otherwise accept any unambiguous start of a full name, such as "phili" or "lament".
  const matches = BOOK_KEYS.filter((book) => book.key.startsWith(key))
  return matches.length === 1 ? matches[0].name : null
}

/**
 * Optional book number ("1", "ii", "first"), book name, chapter, then an optional verse or verse range.
 * The verse may follow a colon, a dot or a space: "jn 3:16", "jn 3.16", "john 3 16-18".
 */
const REFERENCE =
  /^(?:([123])\s*|(i{1,3}|1st|2nd|3rd|first|second|third)\s+)?([a-z][a-z ]*?)\s*(\d+)(?:\s*[:.]\s*|\s+)?(?:(\d+)(?:\s*[-–—]\s*(\d+))?)?$/

/** Turns typed input such as "jn 3:16", "john 3 16-18" or "1 cor 13:4" into a reference, or null. */
export function parseReference(input: string): ScriptureReference | null {
  const normalized = input
    .toLowerCase()
    .replace(/(?<=[a-z])\./g, ' ') // "1 Cor. 13" -> "1 cor  13"
    .replace(/\s+/g, ' ')
    .trim()

  const match = REFERENCE.exec(normalized)
  if (!match) return null
  const [, digit, word, name, chapterText, startText, endText] = match

  const book = findBook(digit ?? word, name.trim())
  const chapter = Number(chapterText)
  if (!book || chapter < 1) return null

  if (startText === undefined) return { book, chapter, verseStart: null, verseEnd: null }
  const verseStart = Number(startText)
  const verseEnd = endText === undefined ? verseStart : Number(endText)
  if (verseStart < 1 || verseEnd < verseStart) return null
  return { book, chapter, verseStart, verseEnd }
}

/** "John 3:16", "John 3:16-18" or "John 3". */
export function formatReference({ book, chapter, verseStart, verseEnd }: ScriptureReference): string {
  if (verseStart === null) return `${book} ${chapter}`
  return verseEnd !== null && verseEnd !== verseStart
    ? `${book} ${chapter}:${verseStart}-${verseEnd}`
    : `${book} ${chapter}:${verseStart}`
}

// ---------- Typing a reference ----------

/** The 66 book names in Bible order. */
export const BOOK_NAMES = BOOKS.map(([name]) => name)

/** Genesis to Malachi; the rest are the New Testament. */
export const OLD_TESTAMENT_BOOKS = BOOK_NAMES.slice(0, 39)
export const NEW_TESTAMENT_BOOKS = BOOK_NAMES.slice(39)

const BOOK_PREFIX = /^(?:([123])\s*|(i{1,3}|first|second|third)\s+)?([a-z][a-z ]*)$/

/**
 * Books whose name or abbreviation starts with what was typed, in Bible order: "jo" gives Joshua, Job, Joel, John,
 * Jonah and then 1-3 John; "1 c" gives 1 Corinthians and 1 Chronicles; "ps" gives Psalms. Needs two characters.
 */
export function bookPrefixMatches(input: string): string[] {
  const text = input.toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trimStart()
  const match = BOOK_PREFIX.exec(text.trimEnd())
  if (!match || text.replace(/\s/g, '').length < 2) return []
  const number = match[1] ?? (match[2] ? ORDINALS[match[2]] : undefined)
  const typed = match[3].replace(/\s+/g, '')

  const unnumbered: string[] = []
  const numbered: string[] = []
  for (const [name, aliases] of BOOKS) {
    const bookNumber = /^[123] /.test(name) ? name[0] : undefined
    if (number && bookNumber !== number) continue
    const base = toKey(bookNumber ? name.slice(2) : name)
    if ([base, ...aliases].some((key) => key.startsWith(typed))) (bookNumber && !number ? numbered : unnumbered).push(name)
  }
  return [...unnumbered, ...numbered]
}

/**
 * The book whose whole name was typed, such as "1 peter", "john" or "job", or a long alias such as "psalm". Null for
 * a start or short abbreviation ("1 pe", "ps", "rev"), which still lists the books it could be.
 */
export function wholeBookName(input: string): string | null {
  const text = input.toLowerCase().replace(/(?<=[a-z])\./g, ' ').replace(/\s+/g, ' ').trim()
  const named = BOOK_PREFIX.exec(text)
  if (!named) return null
  const number = named[1] ?? (named[2] ? ORDINALS[named[2]] : '')
  const name = named[3].replace(/\s+/g, '')
  const book = ALIASES.get(number + name)
  return book && (toKey(book) === number + name || name.length >= 5) ? book : null
}

/** How far a partly typed reference has got, for suggesting what comes next. */
export type ReferenceInput =
  /** A start of a book name: suggest books. */
  | { stage: 'book'; books: string[] }
  /** A book, and maybe the start of a chapter number: suggest chapters starting with `chapterPrefix`. */
  | { stage: 'chapter'; book: string; chapterPrefix: string }
  /** A book and chapter, then ":" or a space, and maybe the start of a verse number: suggest verses. */
  | { stage: 'verse'; book: string; chapter: number; versePrefix: string }
  /** Not a reference being typed (a keyword search), or a range, which only parseReference handles. */
  | null

const PARTIAL = /^(.*?[a-z])\s*(\d+)?(?:(\s*[:.]\s*|\s+)(\d*))?$/

export function readReferenceInput(input: string): ReferenceInput {
  const text = input.toLowerCase().replace(/(?<=[a-z])\./g, ' ').replace(/\s+/g, ' ').trimStart()
  if (text.includes('-')) return null
  const match = PARTIAL.exec(text)
  if (!match) return null
  const [, bookText, chapter, separator, verse] = match
  const named = BOOK_PREFIX.exec(bookText.trim())
  const book = named ? findBook(named[1] ?? named[2], named[3].trim()) : null

  if (chapter === undefined) {
    // "john " (a whole book name and a space) moves on to chapters; otherwise suggest books.
    if (book && text.endsWith(' ') && ALIASES.get(toKey(bookText.trim()).replace(/^(?:first|second|third|i{1,3})/, (w) => ORDINALS[w])) === book) {
      return { stage: 'chapter', book, chapterPrefix: '' }
    }
    const books = bookPrefixMatches(text)
    return books.length > 0 ? { stage: 'book', books } : null
  }
  if (!book) return null
  if (separator === undefined) return { stage: 'chapter', book, chapterPrefix: chapter }
  return { stage: 'verse', book, chapter: Number(chapter), versePrefix: verse ?? '' }
}

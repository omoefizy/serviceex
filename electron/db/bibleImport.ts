// Reads Bible versions the church owns from Zefania XML, OSIS XML or USFM files into verses the database can store.
// Pure functions with no database or file access, so they can be tested on their own.
//
// Books are matched to the 66 the app knows (see BOOK_NAMES); anything else, such as the Apocrypha, is reported and
// left out. Notes, cross references and headings are dropped; only verse text is kept.

import { BOOK_NAMES } from '../../shared/parseReference'

export interface ParsedVerse {
  book: string
  chapter: number
  verse: number
  text: string
}

export interface ParsedBible {
  /** The version's name as the file gives it, if it does. */
  name: string | null
  verses: ParsedVerse[]
  /** Book ids or numbers found in the files that are not among the 66. */
  skippedBooks: string[]
}

/** OSIS book ids in Bible order, matching BOOK_NAMES. */
const OSIS_IDS = [
  'Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1Sam', '2Sam', '1Kgs', '2Kgs', '1Chr', '2Chr', 'Ezra',
  'Neh', 'Esth', 'Job', 'Ps', 'Prov', 'Eccl', 'Song', 'Isa', 'Jer', 'Lam', 'Ezek', 'Dan', 'Hos', 'Joel', 'Amos', 'Obad',
  'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal', 'Matt', 'Mark', 'Luke', 'John', 'Acts', 'Rom', '1Cor',
  '2Cor', 'Gal', 'Eph', 'Phil', 'Col', '1Thess', '2Thess', '1Tim', '2Tim', 'Titus', 'Phlm', 'Heb', 'Jas', '1Pet', '2Pet',
  '1John', '2John', '3John', 'Jude', 'Rev',
]

/** USFM book codes in Bible order, matching BOOK_NAMES. */
const USFM_IDS = [
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST',
  'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM',
  'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL', 'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL',
  '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV',
]

export type BibleFormat = 'zefania' | 'osis' | 'usfm'

/** Tells the format from the content; null when it is none of the three. */
export function detectFormat(content: string): BibleFormat | null {
  const head = content.slice(0, 4000)
  if (/<XMLBIBLE\b/i.test(head)) return 'zefania'
  if (/<osis\b/i.test(head) || /<osisText\b/i.test(head)) return 'osis'
  if (/^\uFEFF?\s*\\id\s+\S+/.test(head)) return 'usfm'
  return null
}

/** Reads one file. Throws when the format is not recognised. */
export function parseBibleFile(content: string): ParsedBible {
  switch (detectFormat(content)) {
    case 'zefania':
      return parseZefania(content)
    case 'osis':
      return parseOsis(content)
    case 'usfm':
      return parseUsfm(content)
    default:
      throw new Error('This is not a Zefania XML, OSIS XML or USFM file')
  }
}

/**
 * Joins the verses of several files (a USFM Bible is often one file per book) in Bible order. Text for the same
 * verse given twice is joined, as when a file splits a verse around a heading.
 */
export function mergeBibles(parts: ParsedBible[]): ParsedBible {
  const byKey = new Map<string, ParsedVerse>()
  for (const verse of parts.flatMap((part) => part.verses)) {
    const key = `${verse.book}|${verse.chapter}|${verse.verse}`
    const existing = byKey.get(key)
    if (existing) existing.text = `${existing.text} ${verse.text}`
    else byKey.set(key, { ...verse })
  }
  const order = (v: ParsedVerse) => BOOK_NAMES.indexOf(v.book)
  const verses = [...byKey.values()].sort((a, b) => order(a) - order(b) || a.chapter - b.chapter || a.verse - b.verse)
  return {
    name: parts.find((part) => part.name)?.name ?? null,
    verses,
    skippedBooks: [...new Set(parts.flatMap((part) => part.skippedBooks))],
  }
}

// ---------- XML ----------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[entity.toLowerCase()] ?? whole
  })
}

function attributes(source: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const match of source.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result[match[1]] = decodeEntities(match[2] ?? match[3] ?? '')
  }
  return result
}

type XmlToken =
  | { type: 'open'; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { type: 'close'; name: string }
  | { type: 'text'; text: string }

/**
 * Walks an XML document as a flat run of tags and text. A tree parser cannot follow OSIS milestone verses, which
 * start in one element and end in another, so both formats are read this way.
 */
function* xmlTokens(xml: string): Generator<XmlToken> {
  const pattern = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
  let last = 0
  for (const match of xml.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) yield { type: 'text', text: decodeEntities(xml.slice(last, index)) }
    last = index + match[0].length
    if (match[1] !== undefined) yield { type: 'text', text: match[1] }
    else if (match[3] === undefined) continue
    else if (match[2] === '/') yield { type: 'close', name: match[3] }
    else yield { type: 'open', name: match[3], attrs: attributes(match[4]), selfClosing: match[5] === '/' }
  }
  if (last < xml.length) yield { type: 'text', text: decodeEntities(xml.slice(last)) }
}

const tidy = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Collects verse text, skipping whatever sits inside the elements in `skip` (notes, headings). */
class VerseCollector {
  verses: ParsedVerse[] = []
  skippedBooks = new Set<string>()
  private current: { book: string; chapter: number; verse: number; parts: string[] } | null = null

  start(book: string | null, bookId: string, chapter: number, verse: number): void {
    this.end()
    if (!book) {
      this.skippedBooks.add(bookId)
      return
    }
    if (chapter > 0 && verse > 0) this.current = { book, chapter, verse, parts: [] }
  }

  add(text: string): void {
    this.current?.parts.push(text)
  }

  /** Words in separate block elements (poetry lines) must not run together. */
  space(): void {
    this.current?.parts.push(' ')
  }

  end(): void {
    const verse = this.current
    this.current = null
    if (!verse) return
    const text = tidy(verse.parts.join(''))
    if (text) this.verses.push({ book: verse.book, chapter: verse.chapter, verse: verse.verse, text })
  }
}

const bookFromNumber = (value: string | undefined) => {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= BOOK_NAMES.length ? BOOK_NAMES[n - 1] : null
}

const firstNumber = (value: string | undefined) => parseInt(value ?? '', 10) || 0

/** Zefania XML: XMLBIBLE > BIBLEBOOK[bnumber] > CHAPTER[cnumber] > VERS[vnumber]. */
export function parseZefania(xml: string): ParsedBible {
  const out = new VerseCollector()
  let name: string | null = null
  let book: string | null = null
  let bookId = ''
  let chapter = 0
  /** Depth inside NOTE and similar elements, whose text is not verse text. */
  let skipping = 0
  for (const token of xmlTokens(xml)) {
    if (token.type === 'text') {
      if (!skipping) out.add(token.text)
      continue
    }
    const tag = token.name.toUpperCase()
    if (token.type === 'open') {
      if (tag === 'XMLBIBLE') name = token.attrs.biblename?.trim() || null
      else if (tag === 'BIBLEBOOK') {
        out.end()
        bookId = token.attrs.bnumber ?? token.attrs.bname ?? '?'
        book = bookFromNumber(token.attrs.bnumber)
        if (!book) out.skippedBooks.add(bookId)
      } else if (tag === 'CHAPTER') {
        out.end()
        chapter = firstNumber(token.attrs.cnumber)
      } else if (tag === 'VERS') {
        if (book) out.start(book, bookId, chapter, firstNumber(token.attrs.vnumber))
        if (token.selfClosing) out.end()
      } else if (tag === 'NOTE' || tag === 'CAPTION' || tag === 'REMARK' || tag === 'XREF') {
        if (!token.selfClosing) skipping++
      } else if (tag === 'BR') out.space()
    } else if (tag === 'VERS') out.end()
    else if (tag === 'NOTE' || tag === 'CAPTION' || tag === 'REMARK' || tag === 'XREF') skipping = Math.max(0, skipping - 1)
  }
  out.end()
  return { name, verses: out.verses, skippedBooks: [...out.skippedBooks] }
}

/** OSIS ids such as "Gen.1.1"; a range such as "Gen.1.1 Gen.1.2" starts at the first. */
function readOsisId(osisId: string | undefined): { bookId: string; chapter: number; verse: number } | null {
  const match = /^([\w]+)\.(\d+)\.(\d+)/.exec(osisId?.trim() ?? '')
  return match ? { bookId: match[1], chapter: Number(match[2]), verse: Number(match[3]) } : null
}

const OSIS_SKIP = new Set(['note', 'title', 'rdg'])
const OSIS_BREAKS = new Set(['l', 'lb', 'lg', 'p', 'br'])

/** OSIS XML, with verses either as containers (<verse osisID>…</verse>) or milestones (<verse sID/>…<verse eID/>). */
export function parseOsis(xml: string): ParsedBible {
  const out = new VerseCollector()
  let name: string | null = null
  /** Inside the header's <work>, whose <title> names the version. */
  let inWork = false
  let skipping = 0
  for (const token of xmlTokens(xml)) {
    if (token.type === 'text') {
      if (inWork && skipping && !name) name = tidy(token.text) || null
      if (!skipping) out.add(token.text)
      continue
    }
    const tag = token.name.replace(/^osis:/, '')
    if (token.type === 'open') {
      if (tag === 'work') inWork = !token.selfClosing
      else if (tag === 'verse') {
        if (token.attrs.eID !== undefined) {
          out.end()
          continue
        }
        const id = readOsisId(token.attrs.osisID ?? token.attrs.sID)
        if (!id) continue
        const index = OSIS_IDS.indexOf(id.bookId)
        out.start(index >= 0 ? BOOK_NAMES[index] : null, id.bookId, id.chapter, id.verse)
        // A self-closing verse without sID is empty.
        if (token.selfClosing && token.attrs.sID === undefined) out.end()
      } else if (tag === 'chapter' && token.attrs.eID !== undefined) out.end()
      else if (OSIS_SKIP.has(tag)) {
        if (!token.selfClosing) skipping++
      } else if (OSIS_BREAKS.has(tag)) out.space()
    } else if (tag === 'work') inWork = false
    else if (tag === 'verse' || tag === 'chapter') out.end()
    else if (OSIS_SKIP.has(tag)) skipping = Math.max(0, skipping - 1)
    else if (OSIS_BREAKS.has(tag)) out.space()
  }
  out.end()
  return { name, verses: out.verses, skippedBooks: [...out.skippedBooks] }
}

// ---------- USFM ----------

/** Markers whose text is a heading, title or other non-verse text, up to the next marker. */
const USFM_SKIP = /^(?:id|ide|h\d?|toc\d*|toca\d*|mt\d*|mte\d*|ms\d*|mr|s\d*|sr|r|d|sp|cl|cd|rem|sts|restore|periph|imt\d*|is\d*|ip|ipi|im|imi|ipq|imq|ipr|iq\d*|ib|ili\d*|iot|io\d*|iex|imte\d*|ie|usfm|lit)$/

/** USFM: \id GEN, \c 1, \v 1 … One book per file. */
export function parseUsfm(usfm: string): ParsedBible {
  const out = new VerseCollector()
  const text = usfm
    .replace(/^\uFEFF/, '')
    // Footnotes, endnotes and cross references, with everything inside them.
    .replace(/\\(f|fe|ef|x|ex)\s[\s\S]*?\\\1\*/g, ' ')
    // Word-level attributes: \w grace|strong="H2580"\w* keeps "grace".
    .replace(/\\\+?w\s+([^\\|]*?)(?:\|[^\\]*?)?\\\+?w\*/g, '$1')
  const book = /^\s*\\id\s+(\S+)/.exec(text)?.[1]?.toUpperCase() ?? '?'
  const bookIndex = USFM_IDS.indexOf(book)
  const bookName = bookIndex >= 0 ? BOOK_NAMES[bookIndex] : null
  if (!bookName) return { name: null, verses: [], skippedBooks: [book] }

  // Character markers come in pairs (\nd Lord\nd*) and take on whatever the paragraph around them is doing.
  const characterMarkers = new Set(Array.from(text.matchAll(/\\\+?([a-z]+\d*)\*/gi), (m) => m[1]))
  let chapter = 0
  /** In a heading or other non-verse paragraph. */
  let skipping = false
  for (const [, raw, following] of text.matchAll(/\\(\+?[a-z]+\d*\*?)([^\\]*)/gi)) {
    const marker = raw.replace(/^\+/, '')
    if (marker.endsWith('*') || characterMarkers.has(marker)) {
      if (!skipping) out.add(following)
    } else if (marker === 'c') {
      out.end()
      chapter = parseInt(following, 10) || chapter
      skipping = false
    } else if (marker === 'v') {
      // "\v 16 For God…", or a verse range such as "\v 3-4", which is stored under its first verse.
      const verse = /^\s*(\d+)\S*\s?([\s\S]*)$/.exec(following)
      out.start(bookName, book, chapter, verse ? Number(verse[1]) : 0)
      out.add(verse?.[2] ?? '')
      skipping = false
    } else if (USFM_SKIP.test(marker)) {
      skipping = true
    } else {
      // Paragraph and poetry markers (\p, \q1, \m …) carry on the verse.
      skipping = false
      out.space()
      out.add(following)
    }
  }
  out.end()
  return { name: null, verses: out.verses, skippedBooks: [...out.skippedBooks] }
}

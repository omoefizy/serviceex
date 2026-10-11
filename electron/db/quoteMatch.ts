// Finds the verses a piece of transcript quotes: the keyword index (BM25) narrows both Bibles to likely verses,
// then shared/quoteMatch scores each by the words said in order, weighting words by how rare they are in the Bible.
// Takes the database as an argument so it can be tested against a small one.

import type Database from 'better-sqlite3'
import { indexForms, MIN_SHORT_QUOTE_WORDS, quoteWords, scoreQuote, STOPWORDS, wordKey } from '../../shared/quoteMatch'
import type { QuoteMatch } from '../../shared/types'

/** The spoken stretch looked at: the last 25 words. */
const WINDOW_WORDS = 25
/** Distinctive words to search the index with. */
const MAX_TERMS = 12
const CANDIDATES = 60
const MAX_RESULTS = 3

interface Frequencies {
  verses: number
  /** Verses holding each indexed word. */
  doc: Map<string, number>
}

/** Word frequencies per database, filled as words are looked up. */
const frequencies = new WeakMap<Database.Database, Frequencies>()

/** How rare a spoken word is, 0 to 1: the share of information its verse count carries (idf over its maximum). */
function rarityIn(db: Database.Database, words: string[]): (word: string) => number {
  let f = frequencies.get(db)
  if (!f) {
    f = { verses: (db.prepare('SELECT count(*) AS n FROM verses').get() as { n: number }).n, doc: new Map() }
    frequencies.set(db, f)
  }
  const missing = [...new Set(words.flatMap(indexForms))].filter((w) => !f.doc.has(w))
  if (missing.length > 0) {
    const rows = db
      .prepare(`SELECT term, doc FROM verses_fts_vocab WHERE term IN (${missing.map(() => '?').join(',')})`)
      .all(...missing) as { term: string; doc: number }[]
    for (const w of missing) f.doc.set(w, 0)
    for (const row of rows) f.doc.set(row.term, row.doc)
  }
  const total = Math.max(2, f.verses)
  return (word) => {
    const doc = indexForms(word).reduce((sum, form) => sum + (f.doc.get(form) ?? 0), 0)
    return Math.max(0, Math.min(1, Math.log(total / Math.max(1, doc)) / Math.log(total)))
  }
}

export function findQuotes(db: Database.Database, text: string): QuoteMatch[] {
  const said = quoteWords(text).slice(-WINDOW_WORDS)
  if (said.length < MIN_SHORT_QUOTE_WORDS) return []
  const spoken = said.join(' ')
  const content = [...new Set(said.filter((w) => w.length >= 3 && !STOPWORDS.has(wordKey(w))))].slice(-MAX_TERMS)
  if (content.length < 2) return []
  // Any of the words, in any spelling the index holds; bm25 ranks verses holding more of the rarer ones first.
  // Each word is quoted, so nothing said is read as FTS syntax.
  const match = [...new Set(content.flatMap(indexForms))].map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ')
  let rows: { book: string; chapter: number; verse: number; text: string; version: string }[]
  try {
    rows = db
      .prepare(
        `SELECT v.book, v.chapter, v.verse, v.text, b.code AS version
         FROM verses_fts
         JOIN verses v ON v.id = verses_fts.rowid
         JOIN bible_versions b ON b.id = v.version_id
         WHERE verses_fts MATCH ?
         ORDER BY bm25(verses_fts)
         LIMIT ${CANDIDATES}`,
      )
      .all(match) as typeof rows
  } catch (error) {
    console.error('Quote search failed', error)
    return []
  }

  const rarity = rarityIn(db, said)
  // The best version of each verse.
  const best = new Map<string, QuoteMatch>()
  for (const row of rows) {
    const score = scoreQuote(spoken, row.text, rarity)
    if (!score.strong) continue
    const key = `${row.book} ${row.chapter}:${row.verse}`
    const found: QuoteMatch = {
      book: row.book,
      chapter: row.chapter,
      verse: row.verse,
      version: row.version as QuoteMatch['version'],
      matched: score.matched,
      coverage: score.coverage,
      confidence: score.confidence,
      highlight: score.highlight,
    }
    const kept = best.get(key)
    if (!kept || better(found, kept)) best.set(key, found)
  }
  return [...best.values()].sort((a, b) => (better(a, b) ? -1 : 1)).slice(0, MAX_RESULTS)
}

const better = (a: QuoteMatch, b: QuoteMatch) =>
  a.confidence !== b.confidence ? a.confidence > b.confidence : a.matched !== b.matched ? a.matched > b.matched : a.coverage > b.coverage

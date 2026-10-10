// Finds the verse a piece of transcript quotes, if any: the keyword index narrows the Bible to likely verses, then
// shared/quoteMatch scores each by the words said in order. Takes the database as an argument so it can be tested
// against a small one.

import type Database from 'better-sqlite3'
import { MIN_QUOTE_WORDS, quoteWords, scoreQuote, STOPWORDS } from '../../shared/quoteMatch'
import type { QuoteMatch } from '../../shared/types'

/** Distinctive words to search the index with. */
const MAX_TERMS = 12
const CANDIDATES = 40

export function findQuote(db: Database.Database, text: string): QuoteMatch | null {
  const said = quoteWords(text)
  if (said.length < MIN_QUOTE_WORDS) return null
  const terms = [...new Set(said.filter((w) => w.length >= 3 && !STOPWORDS.has(w)))].slice(0, MAX_TERMS)
  if (terms.length < 3) return null
  // Any of the words; bm25 ranks verses holding more of the rarer ones first. Each word is quoted, so nothing said
  // is read as FTS syntax.
  const match = terms.map((t) => `"${t}"`).join(' OR ')
  let rows: { book: string; chapter: number; verse: number; text: string; version: string }[]
  try {
    rows = db
      .prepare(
        `SELECT v.book, v.chapter, v.verse, v.text, b.code AS version
         FROM verses_fts
         JOIN verses v ON v.id = verses_fts.rowid
         JOIN bible_versions b ON b.id = v.version_id
         WHERE verses_fts MATCH ?
         ORDER BY rank
         LIMIT ${CANDIDATES}`,
      )
      .all(match) as typeof rows
  } catch (error) {
    console.error('Quote search failed', error)
    return null
  }

  let best: QuoteMatch | null = null
  for (const row of rows) {
    const score = scoreQuote(text, row.text)
    if (!score.strong) continue
    if (!best || score.matched > best.matched || (score.matched === best.matched && score.coverage > best.coverage)) {
      best = {
        book: row.book,
        chapter: row.chapter,
        verse: row.verse,
        version: row.version as QuoteMatch['version'],
        matched: score.matched,
        coverage: score.coverage,
        confidence: score.confidence,
      }
    }
  }
  return best
}

// Decides whether a piece of transcript quotes a verse: the longest run of the verse's words, in order, that the
// speaker said (gaps allowed), compared with the shorter of the two. Only strong matches count: at least six words,
// most of the verse (or most of what was said), and several of them more than "and the of".

/** Words that carry little meaning on their own; KJV forms included. */
export const STOPWORDS = new Set(
  (
    'a an and are as at be but by for from he her him his i in is it its me my not of on or our she so that the their ' +
    'them then there they this thou thee thy to unto up us was we were what which who will with ye you your shall hath ' +
    'have had do did all if no'
  ).split(' '),
)

/** Lowercase words without punctuation; "Lord's" stays one word. */
export function quoteWords(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu) ?? []
}

export const MIN_QUOTE_WORDS = 6
/** Share of the verse (or of the transcript, if shorter) that must be matched in order. */
const MIN_COVERAGE = 0.7
const MIN_CONTENT_WORDS = 3

export interface QuoteScore {
  /** Verse words matched in order. */
  matched: number
  /** Of those, words that are not stopwords. */
  contentMatched: number
  /** matched / the shorter of verse and transcript. */
  coverage: number
  strong: boolean
  /** 0.45 to 0.75: always below an explicitly named reference. */
  confidence: number
}

/** Longest common subsequence of two word lists, returning the matched words of `b`. */
function commonInOrder(a: string[], b: string[]): string[] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const words: string[] = []
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) {
      words.push(b[j])
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) i++
    else j++
  }
  return words
}

export function scoreQuote(spoken: string, verse: string): QuoteScore {
  const said = quoteWords(spoken)
  const verseWords = quoteWords(verse)
  const common = commonInOrder(said, verseWords)
  const matched = common.length
  const contentMatched = common.filter((w) => !STOPWORDS.has(w)).length
  const coverage = matched / Math.max(1, Math.min(said.length, verseWords.length))
  const strong = matched >= MIN_QUOTE_WORDS && coverage >= MIN_COVERAGE && contentMatched >= MIN_CONTENT_WORDS
  const confidence = Math.round((0.45 + 0.3 * Math.min(1, (coverage - MIN_COVERAGE) / (1 - MIN_COVERAGE))) * 100) / 100
  return { matched, contentMatched, coverage: Math.round(coverage * 100) / 100, strong, confidence: strong ? confidence : 0 }
}

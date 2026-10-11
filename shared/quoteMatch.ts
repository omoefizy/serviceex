// Decides whether a piece of transcript quotes a verse. Both sides are normalized the same way (lowercase, no
// punctuation, archaic forms such as "shineth", "hath" and "thou" read as "shines", "has" and "you", contractions
// opened), then the longest run of the verse's words that the speaker said in order (gaps allowed) is scored by
// how much of the spoken stretch and of the verse it covers, with rare words counting for more than common ones.
// Six matching words are needed as a rule; four are enough when they are distinctive.

/** Archaic words and their modern forms. */
const ARCHAIC: Record<string, string> = {
  hath: 'has', doth: 'does', saith: 'says', sayeth: 'says', thee: 'you', thou: 'you', ye: 'you', thy: 'your', thine: 'your',
  unto: 'to', art: 'are', hast: 'have', dost: 'do', didst: 'did', wilt: 'will', shalt: 'shall', canst: 'can', spake: 'spoke',
  shouldest: 'should', wouldest: 'would', mayest: 'may', knowest: 'know', lovest: 'love', seest: 'see',
}

/** Words ending in "eth" that are not verbs. */
const NOT_VERBS = new Set(['beth', 'teeth', 'seth', 'elizabeth', 'elisabeth', 'nazareth', 'japheth', 'shibboleth', 'heth', 'kenneth'])

/**
 * A word's comparison key: archaic forms become modern, then a light fold of endings so "shineth", "shines" and
 * "shine" (or "things" and "thing") share one key. Keys are only compared, never shown.
 */
export function wordKey(word: string): string {
  let w = ARCHAIC[word] ?? word
  if (w.length > 5 && w.endsWith('eth') && !NOT_VERBS.has(w)) w = w.slice(0, -3)
  else if (w.length > 4 && w.endsWith('es') && !w.endsWith('ses')) w = w.slice(0, -2)
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) w = w.slice(0, -1)
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1)
  return w
}

/** Words that carry little meaning on their own, as comparison keys (see wordKey). */
export const STOPWORDS = new Set(
  (
    'a an and are as at be but by for from he her him his i in is it its me my not of on or our she so that the their ' +
    'them then there they this to up us was we were what which who will with you your shall has have had do did all if no ' +
    'one'
  )
    .split(' ')
    .map((w) => wordKey(w)),
)

/** Lowercase words without punctuation, with "n't" opened ("hasn't" -> "has not"); "Lord's" stays one word. */
export function quoteWords(text: string): string[] {
  return (text.toLowerCase().replace(/[‘’ʼ]/g, "'").match(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu) ?? []).flatMap((word) => {
    const not = /^(.+)n't$/.exec(word)
    if (!not) return [word]
    const base = not[1] === 'wo' ? 'will' : not[1] === 'ca' ? 'can' : not[1]
    return [base, 'not']
  })
}

/** How rare a spoken word is in the Bible, 0 (in every verse) to 1 (in one). Without a database, a rough guess. */
export type Rarity = (word: string) => number

const guessRarity: Rarity = (word) => (STOPWORDS.has(wordKey(word)) ? 0.05 : 0.35)

export const MIN_QUOTE_WORDS = 6
/** Fewer words count when they are this distinctive together (summed rarity of the meaningful words matched). */
export const MIN_SHORT_QUOTE_WORDS = 4
const DISTINCTIVE = 1.2
/** Share of the spoken stretch (or of the verse, if shorter) that must be matched in order. */
const MIN_COVERAGE = 0.7
const MIN_SHORT_COVERAGE = 0.8
const MIN_CONTENT_WORDS = 3

export interface QuoteScore {
  /** Verse words matched in order. */
  matched: number
  /** Of those, words that are not stopwords. */
  contentMatched: number
  /** matched / the shorter of the verse and the spoken stretch from the first matched word to the last. */
  coverage: number
  /** Summed rarity of the meaningful words matched. */
  rarity: number
  strong: boolean
  /** 0.45 to 0.8: always below an explicitly named reference. */
  confidence: number
  /** The verse's own words, with the matched ones marked. */
  highlight: { text: string; match: boolean }[]
}

/** Longest common subsequence of two key lists, as index pairs. */
function commonInOrder(a: string[], b: string[]): [number, number][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const pairs: [number, number][] = []
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) i++
    else j++
  }
  return pairs
}

export function scoreQuote(spoken: string, verse: string, rarity: Rarity = guessRarity): QuoteScore {
  const said = quoteWords(spoken)
  const saidKeys = said.map(wordKey)
  // The verse's words as written (for highlighting), and the keys each one gives.
  const tokens = verse.split(/\s+/).filter(Boolean)
  const verseKeys: string[] = []
  const tokenOf: number[] = []
  tokens.forEach((token, t) => quoteWords(token).forEach((word) => (verseKeys.push(wordKey(word)), tokenOf.push(t))))

  const pairs = commonInOrder(saidKeys, verseKeys)
  const matched = pairs.length
  const content = pairs.filter(([i]) => !STOPWORDS.has(saidKeys[i]))
  const contentMatched = content.length
  const weight = Math.round(content.reduce((sum, [i]) => sum + rarity(said[i]), 0) * 100) / 100
  const span = matched === 0 ? 0 : pairs[matched - 1][0] - pairs[0][0] + 1
  const coverage = matched / Math.max(1, Math.min(span, verseKeys.length))
  const verseCoverage = matched / Math.max(1, verseKeys.length)

  const long = matched >= MIN_QUOTE_WORDS && coverage >= MIN_COVERAGE && contentMatched >= MIN_CONTENT_WORDS
  const short = matched >= MIN_SHORT_QUOTE_WORDS && coverage >= MIN_SHORT_COVERAGE && contentMatched >= 2 && weight >= DISTINCTIVE
  const strong = long || short
  const confidence = strong
    ? Math.round(
        (0.45 + 0.15 * Math.min(1, (coverage - MIN_COVERAGE) / (1 - MIN_COVERAGE)) + 0.12 * verseCoverage + 0.08 * Math.min(1, weight / 2.5)) * 100,
      ) / 100
    : 0

  const marked = new Set(pairs.map(([, j]) => tokenOf[j]))
  const highlight: QuoteScore['highlight'] = []
  tokens.forEach((token, t) => {
    const match = marked.has(t)
    const last = highlight.at(-1)
    if (last && last.match === match) last.text += ` ${token}`
    else highlight.push({ text: (highlight.length > 0 ? ' ' : '') + token, match })
  })
  // Keep the spaces outside the marked runs.
  for (let k = 1; k < highlight.length; k++) {
    if (highlight[k].text.startsWith(' ')) {
      highlight[k].text = highlight[k].text.slice(1)
      highlight[k - 1].text += ' '
    }
  }
  return { matched, contentMatched, coverage: Math.round(coverage * 100) / 100, rarity: weight, strong, confidence: Math.min(0.8, confidence), highlight }
}

/**
 * The words to look a spoken word up by in the verse index, which holds the text as written: the word itself, and
 * its archaic forms ("shines" -> "shineth", "has" -> "hath").
 */
export function indexForms(word: string): string[] {
  const forms = new Set([word])
  for (const [old, modern] of Object.entries(ARCHAIC)) if (modern === word) forms.add(old)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
    const stem = word.slice(0, -1)
    forms.add(`${stem.endsWith('e') ? stem.slice(0, -1) : stem}eth`)
    if (word.endsWith('es')) forms.add(`${word.slice(0, -2)}eth`)
  }
  return [...forms]
}

// Statements picked from the sermon transcript. The AI may only point at words that were said: each statement must
// appear in the transcript word for word, as one continuous run (case and punctuation aside), and the transcript's
// own wording is what is kept. Shared by the main process (the AI task's check) and the renderer (when it was heard).

/** At most this many statements per batch of transcript. */
export const MAX_STATEMENTS = 2
/** A statement must be shorter than this many words. */
export const MAX_STATEMENT_WORDS = 20

/** A word compared without case or punctuation: "Grace," matches "grace", and "don't" matches "dont". */
export function wordKey(word: string): string {
  return word.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

interface Token {
  /** The word as written, punctuation included. */
  text: string
  /** Its comparison keys: one, or several for "well-known" (so "well known" matches too). */
  keys: string[]
}

function tokenize(text: string): Token[] {
  return text
    .split(/\s+/)
    .map((word) => ({ text: word, keys: word.split(/[-–—/]+/).map(wordKey).filter(Boolean) }))
    .filter((token) => token.keys.length > 0)
}

/** The comparison keys of a text, in order. */
export function wordKeys(text: string): string[] {
  return tokenize(text).flatMap((token) => token.keys)
}

/**
 * Finds a statement in the transcript as one continuous run of words. Resolves to the transcript's own wording of
 * it (whole words, edge punctuation such as a trailing comma removed) and the index of its first word in
 * wordKeys(transcript), or null when the transcript does not have it word for word.
 */
export function locateStatement(statement: string, transcript: string): { text: string; start: number } | null {
  const needle = wordKeys(statement)
  if (needle.length === 0) return null
  const tokens = tokenize(transcript)
  const keys: string[] = []
  const tokenOf: number[] = []
  tokens.forEach((token, i) => token.keys.forEach((key) => (keys.push(key), tokenOf.push(i))))
  for (let start = 0; start + needle.length <= keys.length; start++) {
    if (!needle.every((key, i) => keys[start + i] === key)) continue
    const words = tokens.slice(tokenOf[start], tokenOf[start + needle.length - 1] + 1).map((token) => token.text)
    const text = words
      .join(' ')
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .replace(/[,;:\-–—]+$/u, '')
    return { text, start }
  }
  return null
}

/**
 * The AI's statements that pass the guard: in the transcript word for word, under 20 words, not repeated, at most
 * two, each in the transcript's wording. Anything reworded, added to, or merged from separate places is dropped.
 */
export function verbatimStatements(candidates: unknown, transcript: string): string[] {
  const kept: string[] = []
  const seen = new Set<string>()
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (typeof candidate !== 'string') continue
    const found = locateStatement(candidate, transcript)
    if (!found) continue
    const keys = wordKeys(found.text)
    if (keys.length >= MAX_STATEMENT_WORDS) continue
    const key = keys.join(' ')
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(found.text)
    if (kept.length === MAX_STATEMENTS) break
  }
  return kept
}

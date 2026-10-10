/** One row of a side-by-side diff. A changed row has text on both sides; removed and added rows on one side only. */
export interface DiffRow {
  kind: 'same' | 'changed' | 'removed' | 'added'
  left: string | null
  right: string | null
}

/** Lines beyond this are compared as one block, to keep the comparison table small. */
const MAX_LINES = 2000

/**
 * Lines matched by longest common subsequence, compared with surrounding spaces trimmed. Removed lines followed
 * by added ones pair up as changed rows, so the two columns stay aligned.
 */
export function diffLines(before: string, after: string): DiffRow[] {
  const a = before.replace(/\r\n?/g, '\n').split('\n').slice(0, MAX_LINES)
  const b = after.replace(/\r\n?/g, '\n').split('\n').slice(0, MAX_LINES)
  const key = (line: string) => line.trim()

  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = key(a[i]) === key(b[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const rows: DiffRow[] = []
  let removed: string[] = []
  let added: string[] = []
  const flush = () => {
    for (let k = 0; k < Math.max(removed.length, added.length); k++) {
      const left = removed[k] ?? null
      const right = added[k] ?? null
      rows.push({ kind: left !== null && right !== null ? 'changed' : left !== null ? 'removed' : 'added', left, right })
    }
    removed = []
    added = []
  }

  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && key(a[i]) === key(b[j])) {
      flush()
      rows.push({ kind: 'same', left: a[i], right: b[j] })
      i++
      j++
    } else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      added.push(b[j++])
    } else {
      removed.push(a[i++])
    }
  }
  flush()
  return rows
}

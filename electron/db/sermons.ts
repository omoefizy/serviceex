// Sermons saved from listening sessions. Each final transcript line is written as it is heard, in its own statement,
// so a crash or a restart loses nothing already said; a sermon still 'recording' at startup is marked saved.

import { today } from '../../shared/license'
import { SERMON_LIMITS } from '../../shared/sermons'
import type { Sermon, SermonInput, SermonPatch, SermonScripture, SermonStatus, SermonSummary } from '../../shared/types'
import { db } from './index'

interface SermonRow {
  id: number
  title: string
  preacher: string
  sermon_date: string
  series: string
  church_name_snapshot: string
  notes: string
  summary: string
  key_points: string
  cleaned_transcript: string
  created_at: string
  updated_at: string
  status: SermonStatus
}

const SUMMARY_COLUMNS = 'id, title, preacher, sermon_date, series, status, created_at, updated_at'

const toSummary = (row: Pick<SermonRow, 'id' | 'title' | 'preacher' | 'sermon_date' | 'series' | 'status' | 'created_at' | 'updated_at'>): SermonSummary => ({
  id: row.id,
  title: row.title,
  preacher: row.preacher,
  date: row.sermon_date,
  series: row.series,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

function parsePoints(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

/** One line of text, trimmed and cut to `max`. */
const line = (value: unknown, max: number) =>
  typeof value === 'string'
    ? value
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .trim()
        .slice(0, max)
    : undefined

/** Text that keeps its line breaks, cut to `max`. */
const block = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim().slice(0, max) : undefined)

const isoDate = (value: unknown) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : undefined)

const cleanPoints = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((p) => line(p, SERMON_LIMITS.point))
        .filter((p): p is string => !!p)
        .slice(0, SERMON_LIMITS.points)
    : undefined

/** Milliseconds since the sermon started recording, for the rows below. */
function elapsedMs(id: number): number {
  const row = db.prepare('SELECT created_at FROM sermons WHERE id = ?').get(id) as { created_at: string } | undefined
  if (!row) throw new Error('Sermon not found')
  return Math.max(0, Date.now() - Date.parse(row.created_at))
}

const touch = (id: number) => db.prepare('UPDATE sermons SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id)

export function listSermons(): SermonSummary[] {
  const rows = db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM sermons ORDER BY sermon_date DESC, created_at DESC`).all() as SermonRow[]
  return rows.map(toSummary)
}

/** Sermons whose title, preacher, series or transcript (raw or cleaned) contains every word of the query. */
export function searchSermons(query: string): SermonSummary[] {
  const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, 10)
  if (terms.length === 0) return listSermons()
  // LIKE with an escape character, so % and _ in the query are matched as typed.
  const like = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const match = `(
    s.title LIKE ? ESCAPE '\\' OR s.preacher LIKE ? ESCAPE '\\' OR s.series LIKE ? ESCAPE '\\' OR s.cleaned_transcript LIKE ? ESCAPE '\\'
    OR EXISTS (SELECT 1 FROM sermon_segments g WHERE g.sermon_id = s.id AND g.text LIKE ? ESCAPE '\\')
  )`
  const sql = `SELECT ${SUMMARY_COLUMNS.split(', ').map((c) => `s.${c}`).join(', ')} FROM sermons s
    WHERE ${terms.map(() => match).join(' AND ')} ORDER BY s.sermon_date DESC, s.created_at DESC`
  const params = terms.flatMap((term) => Array(5).fill(like(term)))
  return (db.prepare(sql).all(...params) as SermonRow[]).map(toSummary)
}

export function getSermon(id: number): Sermon | null {
  const row = db.prepare('SELECT * FROM sermons WHERE id = ?').get(id) as SermonRow | undefined
  if (!row) return null
  const segments = db.prepare('SELECT id, start_ms, text, is_final FROM sermon_segments WHERE sermon_id = ? ORDER BY start_ms, id').all(id) as {
    id: number
    start_ms: number
    text: string
    is_final: number
  }[]
  const scriptures = db.prepare('SELECT id, reference, at_ms, source FROM sermon_scriptures WHERE sermon_id = ? ORDER BY at_ms, id').all(id) as {
    id: number
    reference: string
    at_ms: number
    source: SermonScripture['source']
  }[]
  const statements = db.prepare('SELECT id, text, at_ms, pinned FROM sermon_statements WHERE sermon_id = ? ORDER BY at_ms, id').all(id) as {
    id: number
    text: string
    at_ms: number
    pinned: number
  }[]
  return {
    ...toSummary(row),
    churchName: row.church_name_snapshot,
    notes: row.notes,
    summary: row.summary,
    keyPoints: parsePoints(row.key_points),
    cleanedTranscript: row.cleaned_transcript,
    segments: segments.map((s) => ({ id: s.id, startMs: s.start_ms, text: s.text, isFinal: s.is_final === 1 })),
    scriptures: scriptures.map((s) => ({ id: s.id, reference: s.reference, atMs: s.at_ms, source: s.source })),
    statements: statements.map((s) => ({ id: s.id, text: s.text, atMs: s.at_ms, pinned: s.pinned === 1 })),
  }
}

/** A new sermon in the 'recording' state. `churchName` is kept with it, as Settings had it. */
export function createSermon(input: SermonInput, churchName: string): Sermon {
  const now = new Date().toISOString()
  const { id } = db
    .prepare(
      `INSERT INTO sermons (title, preacher, sermon_date, series, church_name_snapshot, created_at, updated_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'recording') RETURNING id`,
    )
    .get(
      line(input.title, SERMON_LIMITS.title) ?? '',
      line(input.preacher, SERMON_LIMITS.preacher) ?? '',
      isoDate(input.date) ?? today(),
      line(input.series, SERMON_LIMITS.series) ?? '',
      line(churchName, SERMON_LIMITS.title) ?? '',
      now,
      now,
    ) as { id: number }
  return getSermon(id)!
}

export function updateSermon(id: number, patch: SermonPatch): Sermon | null {
  const columns: [string, unknown][] = [
    ['title', line(patch.title, SERMON_LIMITS.title)],
    ['preacher', line(patch.preacher, SERMON_LIMITS.preacher)],
    ['sermon_date', isoDate(patch.date)],
    ['series', line(patch.series, SERMON_LIMITS.series)],
    ['notes', block(patch.notes, SERMON_LIMITS.notes)],
    ['summary', block(patch.summary, SERMON_LIMITS.summary)],
    ['key_points', cleanPoints(patch.keyPoints) && JSON.stringify(cleanPoints(patch.keyPoints))],
  ]
  const set = columns.filter(([, value]) => value !== undefined)
  if (set.length > 0) {
    db.prepare(`UPDATE sermons SET ${set.map(([c]) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(
      ...set.map(([, value]) => value),
      new Date().toISOString(),
      id,
    )
  }
  return getSermon(id)
}

export function setCleanedTranscript(id: number, text: string): void {
  db.prepare('UPDATE sermons SET cleaned_transcript = ?, updated_at = ? WHERE id = ?').run(text, new Date().toISOString(), id)
}

export function deleteSermon(id: number): void {
  db.prepare('DELETE FROM sermons WHERE id = ?').run(id)
}

/** Preachers named before, most recently used first, each as last spelled. */
export function listPreachers(): string[] {
  // With max(), SQLite takes the bare preacher column from the newest row of each group.
  const rows = db
    .prepare("SELECT preacher, max(id) FROM sermons WHERE preacher != '' GROUP BY preacher COLLATE NOCASE ORDER BY max(id) DESC LIMIT 50")
    .all() as { preacher: string }[]
  return rows.map((r) => r.preacher)
}

/** Saves one final transcript line. Empty lines are skipped. */
export function appendSegment(id: number, text: string): void {
  const words = line(text, SERMON_LIMITS.segment)
  if (!words) return
  db.prepare('INSERT INTO sermon_segments (sermon_id, start_ms, text, is_final) VALUES (?, ?, ?, 1)').run(id, elapsedMs(id), words)
}

/** Adds a reference unless the sermon has it already. */
export function addScripture(id: number, reference: string, source: SermonScripture['source']): void {
  const ref = line(reference, 100)
  if (!ref) return
  const have = db.prepare('SELECT 1 FROM sermon_scriptures WHERE sermon_id = ? AND reference = ?').get(id, ref)
  if (have) return
  db.prepare('INSERT INTO sermon_scriptures (sermon_id, reference, at_ms, source) VALUES (?, ?, ?, ?)').run(id, ref, elapsedMs(id), source)
  touch(id)
}

export function removeScripture(id: number, scriptureId: number): void {
  db.prepare('DELETE FROM sermon_scriptures WHERE id = ? AND sermon_id = ?').run(scriptureId, id)
  touch(id)
}

/** Adds a statement once; pinning one already saved marks it pinned. */
export function addStatement(id: number, text: string, pinned: boolean): void {
  const words = line(text, SERMON_LIMITS.point)
  if (!words) return
  const have = db.prepare('SELECT id, pinned FROM sermon_statements WHERE sermon_id = ? AND text = ?').get(id, words) as { id: number; pinned: number } | undefined
  if (have) {
    if (pinned && !have.pinned) db.prepare('UPDATE sermon_statements SET pinned = 1 WHERE id = ?').run(have.id)
    return
  }
  db.prepare('INSERT INTO sermon_statements (sermon_id, text, at_ms, pinned) VALUES (?, ?, ?, ?)').run(id, words, elapsedMs(id), pinned ? 1 : 0)
  touch(id)
}

export function setStatementPinned(id: number, statementId: number, pinned: boolean): void {
  db.prepare('UPDATE sermon_statements SET pinned = ? WHERE id = ? AND sermon_id = ?').run(pinned ? 1 : 0, statementId, id)
  touch(id)
}

export function removeStatement(id: number, statementId: number): void {
  db.prepare('DELETE FROM sermon_statements WHERE id = ? AND sermon_id = ?').run(statementId, id)
  touch(id)
}

/** Marks a recording saved. An untitled sermon with nothing in it (stopped at once, or never started) is removed. */
export function finishSermon(id: number): void {
  db.transaction(() => {
    const row = db.prepare('SELECT title, notes FROM sermons WHERE id = ?').get(id) as { title: string; notes: string } | undefined
    if (!row) return
    const count = (table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table} WHERE sermon_id = ?`).get(id) as { n: number }).n
    const empty = !row.title && !row.notes && count('sermon_segments') === 0 && count('sermon_scriptures') === 0 && count('sermon_statements') === 0
    if (empty) deleteSermon(id)
    else db.prepare("UPDATE sermons SET status = 'saved', updated_at = ? WHERE id = ?").run(new Date().toISOString(), id)
  })()
}

/** At startup: sermons left 'recording' by a crash or a forced quit are finished with what was saved. */
export function recoverRecordings(): number {
  const rows = db.prepare("SELECT id FROM sermons WHERE status = 'recording'").all() as { id: number }[]
  for (const { id } of rows) finishSermon(id)
  return rows.length
}

export const isRecording = (id: number) =>
  (db.prepare('SELECT status FROM sermons WHERE id = ?').get(id) as { status: SermonStatus } | undefined)?.status === 'recording'

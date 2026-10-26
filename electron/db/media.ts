import type { MediaItem } from '../../shared/types'
import { mediaUrl } from '../media'
import { db } from './index'

interface MediaRow {
  id: number
  name: string
  kind: 'image' | 'video'
  file: string
  thumb: string | null
  tags: string
}

function toItem(row: MediaRow): MediaItem {
  let tags: unknown = []
  try {
    tags = JSON.parse(row.tags)
  } catch {
    // Treat unreadable tags as none.
  }
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    url: mediaUrl(row.file),
    thumbUrl: row.thumb ? mediaUrl(row.thumb) : null,
    tags: Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : [],
  }
}

const SELECT = 'SELECT id, name, kind, file, thumb, tags FROM media'

/** Newest first. */
export function listMedia(): MediaItem[] {
  return (db.prepare(`${SELECT} ORDER BY id DESC`).all() as MediaRow[]).map(toItem)
}

export function getMediaRow(id: number): MediaRow | undefined {
  return db.prepare(`${SELECT} WHERE id = ?`).get(id) as MediaRow | undefined
}

export function getMedia(id: number): MediaItem | undefined {
  const row = getMediaRow(id)
  return row && toItem(row)
}

/** `hash` is the SHA-256 of a clip taken from a .pptx, which findMediaByHash looks up. */
export function insertMedia(name: string, kind: 'image' | 'video', file: string, hash: string | null = null): MediaItem {
  const result = db.prepare('INSERT INTO media (name, kind, file, hash) VALUES (?, ?, ?, ?)').run(name, kind, file, hash)
  return getMedia(Number(result.lastInsertRowid)) as MediaItem
}

/** The library item made from a clip with this SHA-256, if it is still there. */
export function findMediaByHash(hash: string): MediaItem | undefined {
  const row = db.prepare(`${SELECT} WHERE hash = ? ORDER BY id LIMIT 1`).get(hash) as MediaRow | undefined
  return row && toItem(row)
}

export function updateMedia(id: number, name: string, tags: string[]): boolean {
  return db.prepare('UPDATE media SET name = ?, tags = ? WHERE id = ?').run(name, JSON.stringify(tags), id).changes > 0
}

/** Records a new thumbnail and returns the file name of the one it replaced, for deleting. */
export function setMediaThumb(id: number, thumb: string): string | null | undefined {
  const row = getMediaRow(id)
  if (!row) return undefined
  db.prepare('UPDATE media SET thumb = ? WHERE id = ?').run(thumb, id)
  return row.thumb
}

/**
 * Deletes a library item. Slide overrides using it go with it (ON DELETE CASCADE); custom themes using it as
 * their background go back to solid black, and their image elements showing it are removed. Returns the row so its
 * files can be deleted.
 */
export const deleteMedia = db.transaction((id: number): MediaRow | undefined => {
  const row = getMediaRow(id)
  if (!row) return undefined
  const url = mediaUrl(row.file)
  const themes = db.prepare("SELECT id, json FROM themes WHERE type = 'custom'").all() as { id: number; json: string }[]
  const update = db.prepare('UPDATE themes SET json = ? WHERE id = ?')
  for (const theme of themes) {
    try {
      const style = JSON.parse(theme.json)
      const elements: unknown[] | undefined = Array.isArray(style?.elements) ? style.elements : undefined
      const kept = elements?.filter((element) => (element as { src?: unknown } | null)?.src !== url)
      const usesBackground = style?.background?.src === url
      if (usesBackground || (elements && kept && kept.length !== elements.length)) {
        update.run(
          JSON.stringify({ ...style, ...(usesBackground ? { background: { kind: 'solid', color: '#000000' } } : {}), ...(kept ? { elements: kept } : {}) }),
          theme.id,
        )
      }
    } catch {
      // A theme that cannot be read cannot be using this item either.
    }
  }
  db.prepare('DELETE FROM media WHERE id = ?').run(id)
  return row
})

/**
 * Points a library item at a new file (a received copy chosen to replace it), keeping its id, tags and slide uses.
 * Custom themes showing the old file are moved to the new one. Returns the old file and thumbnail for deleting.
 */
export const replaceMediaFile = db.transaction((id: number, file: string): { file: string; thumb: string | null } | undefined => {
  const row = getMediaRow(id)
  if (!row) return undefined
  const before = JSON.stringify(mediaUrl(row.file))
  const after = JSON.stringify(mediaUrl(file))
  const themes = db.prepare("SELECT id, json FROM themes WHERE type = 'custom' AND instr(json, ?) > 0").all(before) as { id: number; json: string }[]
  const update = db.prepare('UPDATE themes SET json = ? WHERE id = ?')
  for (const theme of themes) update.run(theme.json.split(before).join(after), theme.id)
  db.prepare('UPDATE media SET file = ?, thumb = NULL WHERE id = ?').run(file, id)
  return { file: row.file, thumb: row.thumb }
})

export function getSlideBackgrounds(deckKey: string): Record<number, MediaItem> {
  const rows = db
    .prepare(
      `SELECT b.slide_index, m.id, m.name, m.kind, m.file, m.thumb, m.tags
       FROM slide_backgrounds b JOIN media m ON m.id = b.media_id
       WHERE b.deck_key = ?`,
    )
    .all(deckKey) as (MediaRow & { slide_index: number })[]
  return Object.fromEntries(rows.map((row) => [row.slide_index, toItem(row)]))
}

export function setSlideBackground(deckKey: string, slideIndex: number, mediaId: number | null): void {
  if (mediaId === null) {
    db.prepare('DELETE FROM slide_backgrounds WHERE deck_key = ? AND slide_index = ?').run(deckKey, slideIndex)
    return
  }
  db.prepare(
    `INSERT INTO slide_backgrounds (deck_key, slide_index, media_id) VALUES (?, ?, ?)
     ON CONFLICT (deck_key, slide_index) DO UPDATE SET media_id = excluded.media_id`,
  ).run(deckKey, slideIndex, mediaId)
}

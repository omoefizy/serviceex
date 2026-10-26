// This computer's library as library sync sees it (see librarySync.ts): every song, theme, font, media file and
// presentation listed by the SHA-256 of its content, and saving what arrives. Songs and themes are written as JSON
// of their content only, so the same song typed on two computers has the same hash. Files are hashed once per
// size and change time. Arriving items are added beside what is here; nothing is replaced or deleted.

import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { extensionOf, safeFileName } from '../../shared/sharing'
import { normalizeTheme } from '../../shared/themes'
import type { LibraryKind } from '../../shared/types'
import { insertMedia, listMedia } from '../db/media'
import { presentationStore } from '../db/presentations'
import { createSong, getSong, listSongs } from '../db/songs'
import { createTheme, listThemes } from '../db/themes'
import { FONT_EXTENSIONS, fontsDir, importFontFiles, listImportedFonts } from '../fonts'
import { assertSongInput } from '../ipc/songs'
import { copyIntoMedia, mediaFilePath } from '../media'
import { sha256File } from './client'
import { freeName, receivedFolder } from './library'
import { sha256Of, type IndexedEntry } from './librarySync'

const PRESENTATION_EXTENSIONS = ['pptx', 'ppt', 'pdf']
const MEDIA_KINDS: Record<string, 'image' | 'video'> = { jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', mp4: 'video', webm: 'video', mov: 'video' }

/** Hashes of files already read, by path, size and change time. */
const hashes = new Map<string, { size: number; mtime: number; sha256: string }>()

async function fileEntry(kind: LibraryKind, name: string, file: string): Promise<IndexedEntry | null> {
  try {
    const info = await stat(file)
    if (!info.isFile()) return null
    let known = hashes.get(file)
    if (!known || known.size !== info.size || known.mtime !== info.mtimeMs) {
      known = { size: info.size, mtime: info.mtimeMs, sha256: await sha256File(file) }
      hashes.set(file, known)
    }
    return { sha256: known.sha256, kind, name, size: info.size, file }
  } catch {
    return null
  }
}

function jsonEntry(kind: LibraryKind, name: string, value: unknown): IndexedEntry {
  const bytes = Buffer.from(JSON.stringify(value))
  return { sha256: sha256Of(bytes), kind, name, size: bytes.length, bytes }
}

/** Everything library sync can share from here. */
export async function libraryIndex(): Promise<IndexedEntry[]> {
  const entries: IndexedEntry[] = []
  for (const summary of listSongs()) {
    const song = getSong(summary.id)
    if (!song) continue
    const { title, author, copyright, tags, arrangement, lyrics, formatting } = song
    entries.push(jsonEntry('song', title, { title, author, copyright, tags, arrangement, lyrics, ...(formatting ? { formatting } : {}) }))
  }
  for (const theme of listThemes()) entries.push(jsonEntry('theme', theme.name, { name: theme.name, style: theme.style }))
  for (const font of await listImportedFonts()) {
    const entry = await fileEntry('font', font.file, path.join(fontsDir(), font.file))
    if (entry) entries.push(entry)
  }
  for (const media of listMedia()) {
    const file = mediaFilePath(media.url)
    const entry = file ? await fileEntry('media', `${safeFileName(media.name)}${path.extname(file).toLowerCase()}`, file) : null
    if (entry) entries.push(entry)
  }
  for (const record of presentationStore.list()) {
    const extension = extensionOf(record.sourcePath)
    if (!PRESENTATION_EXTENSIONS.includes(extension) || !existsSync(record.sourcePath)) continue
    const entry = await fileEntry('presentation', `${safeFileName(record.title)}.${extension}`, record.sourcePath)
    if (entry) entries.push(entry)
  }
  return entries
}

export interface Saved {
  changed: 'songs' | 'themes' | 'media' | 'fonts' | null
  /** A presentation file for the renderer to import into the Presentations library. */
  presentation: string | null
}

/** Adds a fetched entry to the library beside what is here. `file` holds its checked bytes. */
export async function saveEntry(kind: LibraryKind, name: string, file: string): Promise<Saved> {
  switch (kind) {
    case 'song': {
      createSong(assertSongInput(JSON.parse(await readFile(file, 'utf8'))))
      return { changed: 'songs', presentation: null }
    }
    case 'theme': {
      const value = JSON.parse(await readFile(file, 'utf8')) as { name?: unknown; style?: unknown }
      createTheme(typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 120) : 'Theme', normalizeTheme(value.style))
      return { changed: 'themes', presentation: null }
    }
    case 'font': {
      if (!FONT_EXTENSIONS.includes(extensionOf(name))) throw new Error(`${name} is not a font file`)
      // The font importer names the copy after the file it is given.
      const temp = await mkdtemp(path.join(os.tmpdir(), 'serviceex-font-'))
      try {
        const named = path.join(temp, safeFileName(name))
        await copyFile(file, named)
        const { skipped } = await importFontFiles([named])
        if (skipped.length > 0) throw new Error(`${name} is not a font this app can read`)
      } finally {
        await rm(temp, { recursive: true, force: true })
      }
      return { changed: 'fonts', presentation: null }
    }
    case 'media': {
      const mediaKind = MEDIA_KINDS[extensionOf(name)]
      if (!mediaKind) throw new Error(`${name} is not an image or video`)
      const temp = await mkdtemp(path.join(os.tmpdir(), 'serviceex-media-'))
      try {
        const named = path.join(temp, safeFileName(name))
        await copyFile(file, named)
        insertMedia(path.basename(name, path.extname(name)), mediaKind, await copyIntoMedia(named))
      } finally {
        await rm(temp, { recursive: true, force: true })
      }
      return { changed: 'media', presentation: null }
    }
    case 'presentation': {
      if (!PRESENTATION_EXTENSIONS.includes(extensionOf(name))) throw new Error(`${name} is not a presentation`)
      await mkdir(receivedFolder(), { recursive: true })
      const dest = freeName(receivedFolder(), safeFileName(name))
      await copyFile(file, dest)
      return { changed: null, presentation: dest }
    }
  }
}

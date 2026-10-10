import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { ExportFormat, ImportedSong, ImportScan, Song } from '../../shared/types'
import { getSong, listSongs } from '../db/songs'
import { parseText, parseXmlSong, toOpenLyrics, toText } from './formats'

/** Guards against picking a whole drive by mistake. */
const MAX_FILES = 2000
const MAX_FILE_BYTES = 5 * 1024 * 1024

/** OpenSong keeps songs in files with no extension, so those are read and checked for XML too. */
const SONG_EXTENSIONS = new Set(['.txt', '.xml', ''])

interface Candidate {
  file: string
  /** Shown in the preview: the file name, with its folder when it came from one. */
  source: string
}

/** Expands folders one level deep into their song files; hidden files are skipped. */
async function collect(paths: string[], problems: ImportScan['problems']): Promise<Candidate[]> {
  const candidates: Candidate[] = []
  for (const p of paths) {
    try {
      if ((await stat(p)).isDirectory()) {
        const entries = await readdir(p, { withFileTypes: true })
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          if (!entry.isFile() || entry.name.startsWith('.')) continue
          if (!SONG_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
          candidates.push({ file: path.join(p, entry.name), source: `${path.basename(p)}/${entry.name}` })
        }
      } else {
        candidates.push({ file: p, source: path.basename(p) })
      }
    } catch (err) {
      problems.push({ source: path.basename(p), error: err instanceof Error ? err.message : String(err) })
    }
  }
  return candidates
}

async function readSong(candidate: Candidate): Promise<Omit<ImportedSong, 'duplicateOf'>> {
  const { size } = await stat(candidate.file)
  if (size > MAX_FILE_BYTES) throw new Error('File is larger than 5 MB')
  const text = (await readFile(candidate.file, 'utf8')).replace(/^\uFEFF/, '')
  const extension = path.extname(candidate.file).toLowerCase()
  const fallbackTitle = path.basename(candidate.file, extension)

  if (extension === '.txt') return { source: candidate.source, format: 'text', song: parseText(text, fallbackTitle) }
  if (!text.trimStart().startsWith('<')) throw new Error('Not a text, OpenLyrics or OpenSong song')
  return { source: candidate.source, ...parseXmlSong(text, fallbackTitle) }
}

/** Reads and parses song files and folders, flagging titles already in the library or earlier in this import. */
export async function scanSongFiles(paths: string[]): Promise<ImportScan> {
  const problems: ImportScan['problems'] = []
  const candidates = await collect(paths, problems)
  if (candidates.length > MAX_FILES) {
    return { songs: [], problems: [{ source: `${candidates.length} files`, error: `Pick at most ${MAX_FILES} files at a time` }] }
  }

  const key = (title: string) => title.trim().toLowerCase()
  const library = new Set(listSongs().map((song) => key(song.title)))
  const seen = new Set<string>()
  const songs: ImportedSong[] = []

  for (const candidate of candidates) {
    try {
      const found = await readSong(candidate)
      if (!found.song.title) throw new Error('No title found')
      const title = key(found.song.title)
      songs.push({ ...found, duplicateOf: library.has(title) ? 'library' : seen.has(title) ? 'import' : null })
      seen.add(title)
    } catch (err) {
      problems.push({ source: candidate.source, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { songs, problems }
}

/** A file name from a song title, without characters Windows or macOS refuse. */
function fileName(title: string, extension: string, used: Set<string>): string {
  const base =
    [...title]
      .filter((c) => c.charCodeAt(0) >= 32 && !'<>:"/\\|?*'.includes(c))
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'Untitled'
  let name = `${base}${extension}`
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})${extension}`
  used.add(name.toLowerCase())
  return name
}

export function songsForExport(songIds: number[] | null): Song[] {
  const ids = songIds ?? listSongs().map((song) => song.id)
  return ids.map((id) => getSong(id)).filter((song): song is Song => song !== undefined)
}

export const EXPORT_EXTENSIONS: Record<ExportFormat, string> = { openlyrics: '.xml', text: '.txt' }

export function suggestedFileName(song: Song, format: ExportFormat): string {
  return fileName(song.title, EXPORT_EXTENSIONS[format], new Set())
}

function serialize(song: Song, format: ExportFormat): string {
  return format === 'openlyrics' ? toOpenLyrics(song) : toText(song)
}

export async function writeSongFile(song: Song, format: ExportFormat, file: string): Promise<void> {
  await writeFile(file, serialize(song, format), 'utf8')
}

/** Writes one file per song into a folder, never overwriting a file that is already there. */
export async function writeSongFolder(songs: Song[], format: ExportFormat, folder: string): Promise<number> {
  const used = new Set<string>()
  for (const song of songs) {
    let name = fileName(song.title, EXPORT_EXTENSIONS[format], used)
    while (existsSync(path.join(folder, name))) name = fileName(song.title, EXPORT_EXTENSIONS[format], used)
    await writeFile(path.join(folder, name), serialize(song, format), 'utf8')
  }
  return songs.length
}

// The .serviceex package: a whole service (schedule, songs, themes, media, presentations, and the imported fonts the
// themes use) or a few library items
// in one file, for sending over the network or carrying on a USB drive. Nothing here touches Electron.
//
// Layout: the 8 byte magic "SVCEX1\n\0", a 4 byte big-endian manifest length, the manifest as JSON, then each file's
// bytes in the order the manifest lists them. Files are written and read as streams, so large videos never sit in
// memory, and each is checked against its SHA-256 when taken out. Only allowed media types may be inside, under
// names the package chooses; nothing in a package is ever run.

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { open, rm, stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import { shareKindOf } from '../../shared/sharing'
import type { AnnouncementPayload, ScripturePayload, SlideFormats, SongArrangement, ThemeStyle } from '../../shared/types'

const MAGIC = Buffer.from('SVCEX1\n\0', 'latin1')
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024
/** Files inside a package: media/<n>.<ext>, presentations/<n>.<ext> or fonts/<n>.<ext>. */
const FILE_PATH = /^(media|presentations|fonts)\/\d{1,6}\.([a-z0-9]{1,5})$/
const FONT_FILE = /^fonts\/\d{1,6}\.(ttf|otf|woff|woff2)$/
/** Stands in for a media file's wd-media:// URL inside themes and payloads. */
export const PACKAGE_MEDIA_PREFIX = 'serviceex-media:'

export interface PackageSong {
  key: number
  title: string
  author: string | null
  copyright: string | null
  tags: string[]
  arrangement: SongArrangement
  lyrics: string
  formatting?: SlideFormats
  /** A theme key in this package, or null for the default song theme. */
  theme: number | null
  /** Per-slide backgrounds: slide index to media key. */
  backgrounds: Record<string, number>
}

export interface PackageTheme {
  key: number
  name: string
  /** A built-in theme is matched by name on the other computer and carries no style. */
  builtin: boolean
  /** Media URLs inside are PACKAGE_MEDIA_PREFIX + media key. */
  style: ThemeStyle | null
}

export interface PackageMedia {
  key: number
  name: string
  kind: 'image' | 'video'
  /** Its path in the package. */
  file: string
  /** A library background (true), or only a presentation page or theme picture that needs the file (false). */
  library: boolean
}

/** An imported font a theme in the package uses, so the theme looks the same on the other computer. */
export interface PackageFont {
  key: number
  family: string
  /** The font's file name where it was imported, kept when it is imported on the other computer. */
  name: string
  /** Its path in the package. */
  file: string
}

export interface PackagePresentation {
  key: number
  title: string
  /** The original .pptx, .ppt or .pdf in the package. */
  file: string
}

export type PackageItem =
  | { type: 'song'; song: number; backgrounds: Record<string, number> }
  | { type: 'scripture'; payload: ScripturePayload; backgrounds: Record<string, number> }
  | { type: 'announcement'; payload: AnnouncementPayload; backgrounds: Record<string, number> }
  /** Pages are media keys; `presentation` is the original in this package, if it came along. */
  | { type: 'presentation'; title: string; pages: number[]; presentation: number | null; backgrounds: Record<string, number> }

export interface PackageContents {
  service: { name: string; date: string | null; items: PackageItem[] } | null
  songs: PackageSong[]
  themes: PackageTheme[]
  media: PackageMedia[]
  presentations: PackagePresentation[]
  /** Announcements sent on their own, for the receiver's open schedule. */
  announcements: AnnouncementPayload[]
  /** Imported fonts the themes use; missing from packages made before fonts travelled. */
  fonts?: PackageFont[]
}

export interface PackageFile {
  path: string
  size: number
  sha256: string
}

export interface PackageManifest {
  format: 'serviceex'
  version: 1
  createdAt: string
  contents: PackageContents
  files: PackageFile[]
}

export const emptyContents = (): PackageContents => ({ service: null, songs: [], themes: [], media: [], presentations: [], announcements: [], fonts: [] })

/** A path inside a package for a file of this extension. */
export const packagePath = (folder: 'media' | 'presentations' | 'fonts', index: number, extension: string) => `${folder}/${index}.${extension.toLowerCase()}`

function checkFilePath(file: string): void {
  if (FONT_FILE.test(file)) return
  const match = FILE_PATH.exec(file)
  // Only media and presentation types, never another package.
  const kind = match ? shareKindOf(file) : null
  if (!kind || kind === 'package' || kind === 'text' || kind === 'openlyrics') throw new Error(`The package holds a file it may not: ${file}`)
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** Writes a package. `sources` maps each path in the package to the file on disk. */
export async function writePackage(dest: string, contents: PackageContents, sources: Map<string, string>): Promise<void> {
  const files: PackageFile[] = []
  for (const [path, source] of sources) {
    checkFilePath(path)
    files.push({ path, size: (await stat(source)).size, sha256: await hashFile(source) })
  }
  const manifest: PackageManifest = { format: 'serviceex', version: 1, createdAt: new Date().toISOString(), contents, files }
  const json = Buffer.from(JSON.stringify(manifest))
  const length = Buffer.alloc(4)
  length.writeUInt32BE(json.length)
  const out = createWriteStream(dest)
  try {
    await new Promise<void>((resolve, reject) => out.write(Buffer.concat([MAGIC, length, json]), (error) => (error ? reject(error) : resolve())))
    for (const file of files) await pipeline(createReadStream(sources.get(file.path) as string), out, { end: false })
    await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())))
  } catch (error) {
    out.destroy()
    await rm(dest, { force: true })
    throw error
  }
}

export interface OpenedPackage {
  manifest: PackageManifest
  /** Where each file starts in the package. */
  offsets: Map<string, number>
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Reads and checks a package's manifest. Throws when the file is not a package or does not add up. */
export async function readPackage(file: string): Promise<OpenedPackage> {
  const handle = await open(file, 'r')
  try {
    const { size } = await handle.stat()
    const head = Buffer.alloc(12)
    await handle.read(head, 0, 12, 0)
    if (size < 12 || !head.subarray(0, 8).equals(MAGIC)) throw new Error('This is not a ServiceEx package')
    const length = head.readUInt32BE(8)
    if (length > MAX_MANIFEST_BYTES || 12 + length > size) throw new Error('The package is damaged')
    const json = Buffer.alloc(length)
    await handle.read(json, 0, length, 12)
    let manifest: PackageManifest
    try {
      manifest = JSON.parse(json.toString()) as PackageManifest
    } catch {
      throw new Error('The package is damaged')
    }
    if (!isObject(manifest) || manifest.format !== 'serviceex' || manifest.version !== 1 || !Array.isArray(manifest.files) || !isObject(manifest.contents)) {
      throw new Error('This package was made by a newer ServiceEx, or is damaged')
    }
    const c = manifest.contents
    for (const list of ['songs', 'themes', 'media', 'presentations', 'announcements'] as const) {
      if (!Array.isArray(c[list])) throw new Error('The package is damaged')
    }
    if (c.fonts !== undefined && !Array.isArray(c.fonts)) throw new Error('The package is damaged')
    const offsets = new Map<string, number>()
    let at = 12 + length
    for (const entry of manifest.files) {
      if (!isObject(entry) || typeof entry.path !== 'string' || !Number.isSafeInteger(entry.size) || entry.size < 0 || typeof entry.sha256 !== 'string') {
        throw new Error('The package is damaged')
      }
      checkFilePath(entry.path)
      if (offsets.has(entry.path)) throw new Error('The package is damaged')
      offsets.set(entry.path, at)
      at += entry.size
    }
    if (at !== size) throw new Error('The package is incomplete or damaged')
    return { manifest, offsets }
  } finally {
    await handle.close()
  }
}

/** Copies one file out of a package and checks its SHA-256. */
export async function extractFile(file: string, opened: OpenedPackage, path: string, dest: string): Promise<void> {
  const entry = opened.manifest.files.find((f) => f.path === path)
  const start = opened.offsets.get(path)
  if (!entry || start === undefined) throw new Error(`The package has no ${path}`)
  const hash = createHash('sha256')
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk)
      done(null, chunk)
    },
  })
  const source = entry.size === 0 ? Readable.from([]) : createReadStream(file, { start, end: start + entry.size - 1 })
  await pipeline(source, tap, createWriteStream(dest))
  if (hash.digest('hex') !== entry.sha256) {
    await rm(dest, { force: true })
    throw new Error(`${path} in the package is damaged`)
  }
}

/** Replaces strings in a JSON value: used to swap media URLs for package keys and back. */
export function mapStrings<T>(value: T, map: (text: string) => string): T {
  if (typeof value === 'string') return map(value) as T
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, map)) as T
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, map)])) as T
  return value
}

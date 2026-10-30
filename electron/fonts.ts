// Imported fonts: .ttf, .otf, .woff and .woff2 files copied into <userData>/fonts and served to every window as
// wd-media://font/<name>. The family, weight and style come from the file's own name, OS/2 and fvar tables (never the
// file name), so a theme that names the family finds it on any machine the file is imported on.

import { app } from 'electron'
import { readdirSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { brotliDecompressSync, inflateSync } from 'node:zlib'
import type { ImportedFont } from '../shared/types'

export const FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2']
const MAX_FONT_BYTES = 50 * 1024 * 1024

export const fontsDir = () => path.join(app.getPath('userData'), 'fonts')

export const fontUrl = (name: string) => `wd-media://font/${encodeURIComponent(name)}`

/** A plain font file name inside the fonts folder, or null. */
export function fontFileName(name: string): string | null {
  const extension = path.extname(name).slice(1).toLowerCase()
  return name && name === path.basename(name) && !name.startsWith('.') && FONT_EXTENSIONS.includes(extension) ? name : null
}

// ---------- Reading font files ----------

export interface FontInfo {
  family: string
  weight: string
  italic: boolean
}

type Tables = Map<string, Buffer>

/** The tables of a TrueType or OpenType file. */
function sfntTables(data: Buffer): Tables {
  const count = data.readUInt16BE(4)
  const tables: Tables = new Map()
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16
    const offset = data.readUInt32BE(at + 8)
    tables.set(data.toString('latin1', at, at + 4), data.subarray(offset, offset + data.readUInt32BE(at + 12)))
  }
  return tables
}

// The tags a WOFF2 table directory refers to by number (WOFF2 spec, 5.2).
const WOFF2_TAGS = (
  'cmap head hhea hmtx maxp name OS/2 post cvt  fpgm glyf loca prep CFF  VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea ' +
  'vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG  sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar ' +
  'gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill'
)
  .match(/.{4}\s?/g)!
  .map((tag) => tag.slice(0, 4))

/** The tables of a WOFF (1.0) file: each stored as it is, or zlib compressed when that is smaller. */
function woffTables(data: Buffer): Tables {
  const count = data.readUInt16BE(12)
  const tables: Tables = new Map()
  for (let i = 0; i < count; i++) {
    const at = 44 + i * 20
    const offset = data.readUInt32BE(at + 4)
    const compressed = data.readUInt32BE(at + 8)
    const original = data.readUInt32BE(at + 12)
    const stored = data.subarray(offset, offset + compressed)
    if (stored.length !== compressed) throw new Error('The font file is cut short')
    tables.set(data.toString('latin1', at, at + 4), compressed < original ? inflateSync(stored) : stored)
  }
  return tables
}

/**
 * The tables of a WOFF2 file. Only glyf and loca are ever transformed, and only the plain tables (name, OS/2,
 * fvar) are read, so the rest are skipped by length.
 */
function woff2Tables(data: Buffer): Tables {
  if (data.toString('latin1', 4, 8) === 'ttcf') throw new Error('Font collections are not supported')
  const count = data.readUInt16BE(12)
  const compressedLength = data.readUInt32BE(20)
  let at = 48
  const base128 = () => {
    let value = 0
    for (let i = 0; i < 5; i++) {
      const byte = data[at++]
      value = value * 128 + (byte & 0x7f)
      if (!(byte & 0x80)) return value
    }
    throw new Error('Bad WOFF2 table directory')
  }
  const entries: { tag: string; length: number }[] = []
  for (let i = 0; i < count; i++) {
    const flags = data[at++]
    let tag = WOFF2_TAGS[flags & 0x3f]
    if ((flags & 0x3f) === 0x3f) {
      tag = data.toString('latin1', at, at + 4)
      at += 4
    }
    const version = flags >> 6
    const original = base128()
    const transformed = (tag === 'glyf' || tag === 'loca') === (version === 0)
    entries.push({ tag, length: transformed ? base128() : original })
  }
  const stream = brotliDecompressSync(data.subarray(at, at + compressedLength))
  const tables: Tables = new Map()
  let offset = 0
  for (const { tag, length } of entries) {
    tables.set(tag, stream.subarray(offset, offset + length))
    offset += length
  }
  return tables
}

/** A name from the name table: Windows English first, then any Windows or Unicode name, then Macintosh Roman. */
function nameOf(table: Buffer, id: number): string | null {
  const count = table.readUInt16BE(2)
  const strings = table.readUInt16BE(4)
  let best: { score: number; value: string } | null = null
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12
    if (table.readUInt16BE(at + 6) !== id) continue
    const platform = table.readUInt16BE(at)
    const language = table.readUInt16BE(at + 4)
    const length = table.readUInt16BE(at + 8)
    const start = strings + table.readUInt16BE(at + 10)
    const bytes = table.subarray(start, start + length)
    const utf16 = platform === 0 || platform === 3
    const score = platform === 3 ? (language === 0x409 ? 3 : 2) : platform === 0 ? 2 : 1
    if (best && best.score >= score) continue
    const value = utf16 ? Buffer.from(bytes).swap16().toString('utf16le') : bytes.toString('latin1')
    if (value.trim()) best = { score, value: value.trim() }
  }
  return best?.value ?? null
}

/** Reads a font file's family (the typographic family when it has one), weight and style. */
export function readFontInfo(data: Buffer): FontInfo {
  const signature = data.toString('latin1', 0, 4)
  if (signature === 'ttcf') throw new FontError('is a font collection (.ttc), which cannot be imported; import its fonts one by one')
  const sfnt = signature === '\0\x01\0\0' || signature === 'OTTO' || signature === 'true'
  const tables = signature === 'wOF2' ? woff2Tables(data) : signature === 'wOFF' ? woffTables(data) : sfnt ? sfntTables(data) : null
  if (!tables) throw new FontError('is not a TrueType, OpenType, WOFF or WOFF2 font')
  const name = tables.get('name')
  const typographic = name && nameOf(name, 16)
  const legacy = name && nameOf(name, 1)
  if (!typographic && !legacy) throw new FontError('has no family name inside it')

  const os2 = tables.get('OS/2')
  const head = tables.get('head')
  let weight = os2 && os2.length >= 6 ? String(Math.min(1000, Math.max(1, os2.readUInt16BE(4)))) : '400'
  const italic = os2 && os2.length >= 64 ? (os2.readUInt16BE(62) & 1) === 1 : head && head.length >= 46 ? (head.readUInt16BE(44) & 2) === 2 : false

  // A variable font covers its whole weight axis.
  const fvar = tables.get('fvar')
  if (fvar && fvar.length >= 16) {
    const axes = fvar.readUInt16BE(4)
    const count = fvar.readUInt16BE(8)
    const size = fvar.readUInt16BE(10)
    for (let i = 0; i < count; i++) {
      const at = axes + i * size
      if (fvar.toString('latin1', at, at + 4) !== 'wght') continue
      const min = Math.round(fvar.readInt32BE(at + 4) / 65536)
      const max = Math.round(fvar.readInt32BE(at + 12) / 65536)
      if (min >= 1 && max <= 1000 && min < max) weight = `${min} ${max}`
    }
  }
  // Without a typographic family, a weight other than regular and bold is part of the family name ("Name ExtraBold");
  // it comes off when it is the file's own weight, so a family's weights stay one family.
  const family = typographic || withoutWeight(legacy!, Number(weight.split(' ')[0]))
  return { family: family.replace(/["\\]/g, '').slice(0, 200), weight, italic }
}

const WEIGHT_WORDS: [RegExp, number][] = [
  [/\s+(thin|hairline)$/i, 100],
  [/\s+(extra|ultra)[\s-]?light$/i, 200],
  [/\s+light$/i, 300],
  [/\s+(medium)$/i, 500],
  [/\s+(semi|demi)[\s-]?bold$/i, 600],
  [/\s+(extra|ultra)[\s-]?bold$/i, 800],
  [/\s+(black|heavy)$/i, 900],
]

function withoutWeight(family: string, weight: number): string {
  for (const [word, value] of WEIGHT_WORDS) if (value === weight && word.test(family)) return family.replace(word, '')
  return family
}

/** Why a font file cannot be imported, in words for the operator: "<file name> " goes before it. */
export class FontError extends Error {}

/** A plain reason a file could not be imported, after its name. */
function reasonOf(err: unknown): string {
  if (err instanceof FontError) return err.message
  // A table that points past the end of the file, a bad compressed stream and the like.
  return 'is damaged or is not a font this app can read'
}

// ---------- The fonts folder ----------

async function infoOf(name: string): Promise<ImportedFont | null> {
  try {
    const info = readFontInfo(await readFile(path.join(fontsDir(), name)))
    return { file: name, ...info, url: fontUrl(name) }
  } catch {
    return null
  }
}

/** The fonts in the folder that can be read, by family. */
export async function listImportedFonts(): Promise<ImportedFont[]> {
  const names = await readdir(fontsDir()).catch(() => [] as string[])
  const fonts = await Promise.all(names.filter((name) => fontFileName(name)).map(infoOf))
  return fonts.filter((font): font is ImportedFont => font !== null).sort((a, b) => a.family.localeCompare(b.family) || a.file.localeCompare(b.file))
}

/** A file that could not be imported, and why, in plain words. */
export interface SkippedFont {
  file: string
  reason: string
}

/**
 * Copies font files into the folder. A file already there with the same bytes is not copied again; one with the same
 * name and other bytes gets a number. Files that are not fonts it can read are skipped, each with the reason.
 */
export async function importFontFiles(sources: string[]): Promise<{ fonts: ImportedFont[]; skipped: SkippedFont[] }> {
  await mkdir(fontsDir(), { recursive: true })
  const existing = new Set(await readdir(fontsDir()))
  const fonts: ImportedFont[] = []
  const skipped: SkippedFont[] = []
  for (const source of sources) {
    const extension = path.extname(source).toLowerCase()
    try {
      if (!FONT_EXTENSIONS.includes(extension.slice(1))) throw new FontError('is not a font file (TTF, OTF, WOFF or WOFF2)')
      const data = await readFile(source)
      if (data.length > MAX_FONT_BYTES) throw new FontError('is larger than 50 MB')
      const info = readFontInfo(data)
      const base = path.basename(source, path.extname(source)).replace(/[^\w.-]+/g, '-').replace(/^[.-]+/, '').slice(0, 80) || 'font'
      let name = `${base}${extension}`
      for (let n = 2; existing.has(name); n++) {
        if ((await readFile(path.join(fontsDir(), name))).equals(data)) break
        name = `${base}-${n}${extension}`
      }
      if (!existing.has(name)) await copyFile(source, path.join(fontsDir(), name))
      existing.add(name)
      fonts.push({ file: name, ...info, url: fontUrl(name) })
    } catch (err) {
      skipped.push({ file: path.basename(source), reason: reasonOf(err) })
    }
  }
  return { fonts, skipped }
}

/** Removes imported font files from the folder; names that are not font files there are ignored. */
export async function removeFontFiles(names: string[]): Promise<void> {
  for (const name of names) {
    const file = fontFileName(name)
    if (file) await rm(path.join(fontsDir(), file), { force: true })
  }
}

/** The imported font files, by family (lower case), read at once: for packing the fonts a theme uses. */
export function importedFontFilesSync(): Map<string, string[]> {
  const byFamily = new Map<string, string[]>()
  let names: string[] = []
  try {
    names = readdirSync(fontsDir())
  } catch {
    return byFamily
  }
  for (const name of names) {
    if (!fontFileName(name)) continue
    try {
      const info = readFontInfo(readFileSync(path.join(fontsDir(), name)))
      const key = info.family.toLowerCase()
      byFamily.set(key, [...(byFamily.get(key) ?? []), path.join(fontsDir(), name)])
    } catch {
      // A file that cannot be read is not packed.
    }
  }
  return byFamily
}

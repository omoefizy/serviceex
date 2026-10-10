// Reading and writing song files: plain text, OpenLyrics XML (what OpenLP exports) and OpenSong XML.
// Everything here is pure, so files.ts deals with the disk and these functions only see strings.

import { XMLParser } from 'fast-xml-parser'
import { DEFAULT_ARRANGEMENT, LINES_PER_SLIDE_OPTIONS, parseLyrics } from '../../shared/lyrics'
import type { Song, SongArrangement, SongFileFormat, SongInput } from '../../shared/types'

/** A section as the file formats describe it: a label and its slides, each a list of lines. */
interface ParsedSection {
  label: string | null
  slides: string[][]
}

/** Writes sections in the editor's lyrics format: a [label] line, then slides separated by blank lines. */
function sectionsToLyrics(sections: ParsedSection[]): string {
  return sections
    .map((section) => ({ ...section, slides: section.slides.filter((lines) => lines.length > 0) }))
    .filter((section) => section.slides.length > 0)
    .map((section) => {
      const body = section.slides.map((lines) => lines.join('\n')).join('\n\n')
      return section.label ? `[${section.label}]\n${body}` : body
    })
    .join('\n\n')
}

function songInput(fields: Partial<SongInput> & { title: string }): SongInput {
  return {
    title: fields.title.trim(),
    author: fields.author?.trim() || null,
    copyright: fields.copyright?.trim() || null,
    tags: fields.tags ?? [],
    arrangement: fields.arrangement ?? DEFAULT_ARRANGEMENT,
    themeId: null,
    lyrics: fields.lyrics ?? '',
  }
}

// ---------- Plain text ----------

const TEXT_HEADER = /^(author|copyright|tags|order|lines per slide):\s*(.*)$/i

/**
 * The first non-blank line is the title. Header lines straight after it (Author:, Copyright:, Tags:, Order:,
 * Lines per slide:, as written by toText) fill in the other fields; the rest is lyrics, [labels] included.
 */
export function parseText(text: string, fallbackTitle: string): SongInput {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  while (lines.length && lines[0].trim() === '') lines.shift()
  const title = lines.shift()?.trim() || fallbackTitle

  const fields: Partial<SongInput> = {}
  const arrangement: SongArrangement = { ...DEFAULT_ARRANGEMENT }
  for (let header = TEXT_HEADER.exec(lines[0] ?? ''); header; header = TEXT_HEADER.exec(lines[0] ?? '')) {
    lines.shift()
    const [, key, value] = header
    switch (key.toLowerCase()) {
      case 'author':
        fields.author = value
        break
      case 'copyright':
        fields.copyright = value
        break
      case 'tags':
        fields.tags = value.split(',').map((tag) => tag.trim()).filter(Boolean)
        break
      case 'order':
        arrangement.order = value.split(',').map((label) => label.trim()).filter(Boolean)
        break
      case 'lines per slide': {
        const n = Number(value)
        if (LINES_PER_SLIDE_OPTIONS.includes(n as 2 | 3 | 4)) arrangement.linesPerSlide = n as 2 | 3 | 4
        break
      }
    }
  }

  return songInput({ ...fields, title, arrangement, lyrics: lines.join('\n').trim() })
}

/** The plain text backup format, which parseText reads back. */
export function toText(song: Song): string {
  const headers = [
    song.author && `Author: ${song.author}`,
    song.copyright && `Copyright: ${song.copyright}`,
    song.tags.length > 0 && `Tags: ${song.tags.join(', ')}`,
    song.arrangement.order.length > 0 && `Order: ${song.arrangement.order.join(', ')}`,
    song.arrangement.linesPerSlide && `Lines per slide: ${song.arrangement.linesPerSlide}`,
  ].filter(Boolean)
  return `${[song.title, ...headers].join('\n')}\n\n${song.lyrics.replace(/\r\n?/g, '\n').trim()}\n`
}

// ---------- XML helpers ----------

/** fast-xml-parser's preserveOrder shape: { tagName: children, ':@': attributes } or { '#text': text }. */
type XmlNode = Record<string, unknown>

const xmlParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  trimValues: false, // keep the spaces around inline tags in mixed content
  parseTagValue: false, // a title like "1000" stays a string
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: true,
})

function tagOf(node: XmlNode): string | undefined {
  return Object.keys(node).find((key) => key !== ':@' && key !== '#text')
}

/** Local name, so a prefixed tag such as ol:verse still matches "verse". */
function nameOf(node: XmlNode): string | undefined {
  return tagOf(node)?.replace(/^.*:/, '')
}

function childrenOf(node: XmlNode | undefined): XmlNode[] {
  const tag = node && tagOf(node)
  return tag ? (node[tag] as XmlNode[]) : []
}

function attrOf(node: XmlNode, name: string): string | undefined {
  return (node[':@'] as Record<string, string> | undefined)?.[`@_${name}`]
}

function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return childrenOf(node).find((c) => nameOf(c) === name)
}

function childList(node: XmlNode | undefined, name: string): XmlNode[] {
  return childrenOf(node).filter((c) => nameOf(c) === name)
}

/** Text content with <br/> and </line> as line breaks; comments and chords are left out. */
function textOf(node: XmlNode | undefined): string {
  if (!node) return ''
  if ('#text' in node) return String(node['#text'])
  const name = nameOf(node)
  if (name === 'br') return '\n'
  if (name === 'comment' || name === 'chord') return ''
  const text = childrenOf(node).map(textOf).join('')
  return name === 'line' ? `${text}\n` : text
}

/** Splits XML text into lines on the breaks textOf inserted, folding layout whitespace inside each line. */
function xmlLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/** Every XML line break is layout, so fold all whitespace; only explicit <br/> and <line> break lines. */
function lyricLinesOf(node: XmlNode): string[] {
  const parts: string[] = []
  const walk = (n: XmlNode) => {
    if ('#text' in n) parts.push(String(n['#text']).replace(/\s+/g, ' '))
    else if (nameOf(n) === 'br') parts.push('\n')
    else if (nameOf(n) === 'comment' || nameOf(n) === 'chord') return
    else {
      childrenOf(n).forEach(walk)
      if (nameOf(n) === 'line') parts.push('\n')
    }
  }
  childrenOf(node).forEach(walk)
  return xmlLines(parts.join(''))
}

function rootOf(xml: string): XmlNode | undefined {
  const nodes = xmlParser.parse(xml) as XmlNode[]
  return nodes.find((node) => nameOf(node) !== undefined && !tagOf(node)?.startsWith('?'))
}

// ---------- OpenLyrics ----------

const OPENLYRICS_NAMES: Record<string, string> = {
  v: 'Verse',
  c: 'Chorus',
  b: 'Bridge',
  p: 'Pre-Chorus',
  i: 'Intro',
  e: 'Ending',
  o: 'Other',
}

/** "v1" → "Verse 1", "c" → "Chorus", "v1a" → "Verse 1a"; unknown names are kept as they are. */
function openLyricsLabel(name: string): string {
  const match = /^([a-z])(\d*)([a-z]?)$/i.exec(name.trim())
  const base = match && OPENLYRICS_NAMES[match[1].toLowerCase()]
  if (!match || !base) return name.trim()
  const number = `${match[2]}${match[3]}`
  return number ? `${base} ${number}` : base
}

function parseOpenLyrics(root: XmlNode, fallbackTitle: string): SongInput {
  const properties = child(root, 'properties')
  const title = xmlLines(textOf(child(child(properties, 'titles'), 'title'))).join(' ')
  const authors = childList(child(properties, 'authors'), 'author')
    .filter((author) => attrOf(author, 'type') !== 'translation')
    .map((author) => xmlLines(textOf(author)).join(' '))
    .filter(Boolean)
  const themes = childList(child(properties, 'themes'), 'theme')
    .map((theme) => xmlLines(textOf(theme)).join(' '))
    .filter(Boolean)
  const order = textOf(child(properties, 'verseOrder')).split(/\s+/).filter(Boolean).map(openLyricsLabel)

  // Translations repeat a verse name in another language; keep the first of each.
  const seen = new Set<string>()
  const sections: ParsedSection[] = []
  for (const verse of childList(child(root, 'lyrics'), 'verse')) {
    const name = attrOf(verse, 'name') ?? `o${sections.length + 1}`
    if (seen.has(name)) continue
    seen.add(name)
    sections.push({ label: openLyricsLabel(name), slides: childList(verse, 'lines').map(lyricLinesOf) })
  }

  return songInput({
    title: title || fallbackTitle,
    author: authors.join(', '),
    copyright: xmlLines(textOf(child(properties, 'copyright'))).join(' '),
    tags: [...new Set(themes)],
    arrangement: { order, linesPerSlide: null },
    lyrics: sectionsToLyrics(sections),
  })
}

const OPENLYRICS_LETTERS: Record<string, string> = {
  verse: 'v',
  chorus: 'c',
  bridge: 'b',
  'pre-chorus': 'p',
  prechorus: 'p',
  intro: 'i',
  ending: 'e',
  outro: 'e',
  other: 'o',
}

/** "Verse 1" → "v1", "Chorus" → "c", "Pre-Chorus 2" → "p2"; anything else, or a name already used, gets the next free number. */
function openLyricsName(label: string | null, taken: Set<string>): string {
  const match = label ? /^([a-z-]+)\s*(\d*)([a-z]?)$/i.exec(label.trim()) : null
  const known = match ? OPENLYRICS_LETTERS[match[1].toLowerCase()] : undefined
  const letter = known ?? 'o'
  const wanted = match && known ? `${letter}${match[2]}${match[3]}` : ''
  if (wanted && !taken.has(wanted)) return wanted
  let n = 1
  while (taken.has(`${letter}${n}`)) n++
  return `${letter}${n}`
}

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** OpenLyrics 0.9. Each slide becomes a <lines> element; lines per slide has no OpenLyrics equivalent. */
export function toOpenLyrics(song: Song): string {
  const taken = new Set<string>()
  const byLabel = new Map<string, string>()
  const verses = parseLyrics(song.lyrics).map((section) => {
    const name = openLyricsName(section.label, taken)
    taken.add(name)
    const key = section.label?.toLowerCase()
    if (key && !byLabel.has(key)) byLabel.set(key, name)
    const lines = section.chunks.map((chunk) => `      <lines>${chunk.lines.map(escapeXml).join('<br/>')}</lines>`)
    return `    <verse name="${name}">\n${lines.join('\n')}\n    </verse>`
  })
  const order = song.arrangement.order
    .map((label) => byLabel.get(label.trim().toLowerCase()))
    .filter((name) => name !== undefined)

  const properties = [
    `    <titles>\n      <title>${escapeXml(song.title)}</title>\n    </titles>`,
    song.author &&
      `    <authors>\n${song.author
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean)
        .map((a) => `      <author>${escapeXml(a)}</author>`)
        .join('\n')}\n    </authors>`,
    song.copyright && `    <copyright>${escapeXml(song.copyright)}</copyright>`,
    order.length > 0 && `    <verseOrder>${order.join(' ')}</verseOrder>`,
    song.tags.length > 0 &&
      `    <themes>\n${song.tags.map((t) => `      <theme>${escapeXml(t)}</theme>`).join('\n')}\n    </themes>`,
  ].filter(Boolean)

  return `<?xml version="1.0" encoding="UTF-8"?>
<song xmlns="http://openlyrics.info/namespace/2009/song" version="0.9" createdIn="WorshipDeck" modifiedDate="${new Date().toISOString()}">
  <properties>
${properties.join('\n')}
  </properties>
  <lyrics>
${verses.join('\n')}
  </lyrics>
</song>
`
}

// ---------- OpenSong ----------

const OPENSONG_NAMES: Record<string, string> = {
  V: 'Verse',
  C: 'Chorus',
  B: 'Bridge',
  P: 'Pre-Chorus',
  T: 'Tag',
  I: 'Intro',
  E: 'Ending',
}

/** "V1" → "Verse 1", "C" → "Chorus"; unknown codes are kept as they are. */
function openSongLabel(code: string): string {
  const match = /^([A-Za-z])(\d*)$/.exec(code.trim())
  const base = match && OPENSONG_NAMES[match[1].toUpperCase()]
  if (!match || !base) return code.trim()
  return match[2] ? `${base} ${match[2]}` : base
}

/**
 * OpenSong lyrics: [V1] starts a section; lines starting with "." are chords and ";" comments; a leading digit
 * puts the line in that numbered verse ([V] with "1 …" and "2 …" lines holds verses 1 and 2); "||" starts a new
 * slide and "|" breaks a line. Blank lines also start a new slide.
 */
function parseOpenSongLyrics(raw: string): { sections: ParsedSection[]; groups: Map<string, string[]> } {
  const sections = new Map<string, ParsedSection>()
  /** The section keys each [marker] produced: [V] with numbered lines gives V1, V2. */
  const groups = new Map<string, string[]>()
  let marker = ''
  let lastKey: string | null = null

  const sectionFor = (key: string) => {
    let section = sections.get(key)
    if (!section) {
      section = { label: key ? openSongLabel(key) : null, slides: [[]] }
      sections.set(key, section)
      groups.set(marker, [...(groups.get(marker) ?? []), key])
    }
    return section
  }
  const newSlide = (key: string | null) => {
    const section = key !== null ? sections.get(key) : undefined
    if (section && section.slides[section.slides.length - 1].length > 0) section.slides.push([])
  }

  for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
    const label = /^\s*\[([^\]]+)\]\s*$/.exec(line)
    if (label) {
      marker = label[1].trim()
      lastKey = null
      continue
    }
    if (line.startsWith('.') || line.startsWith(';')) continue

    const numbered = /^(\d)(.*)$/.exec(line)
    const key = numbered && !/\d$/.test(marker) ? `${marker}${numbered[1]}` : marker
    const text = (numbered ? numbered[2] : line).replace(/_/g, '')
    if (text.trim() === '') {
      newSlide(numbered ? key : lastKey)
      continue
    }

    const section = sectionFor(key)
    lastKey = key
    const pieces = text.split('||')
    pieces.forEach((piece, i) => {
      if (i > 0) newSlide(key)
      for (const part of piece.split('|')) {
        const clean = part.replace(/\s+/g, ' ').trim()
        if (clean) section.slides[section.slides.length - 1].push(clean)
      }
    })
  }
  return { sections: [...sections.values()], groups }
}

function parseOpenSong(root: XmlNode, fallbackTitle: string): SongInput {
  const field = (name: string) => xmlLines(textOf(child(root, name))).join(' ')
  const { sections, groups } = parseOpenSongLyrics(textOf(child(root, 'lyrics')))

  // A presentation code naming a [marker], such as "V", plays every section that marker produced.
  const order = field('presentation')
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((code) => (groups.get(code) ?? [code]).map(openSongLabel))
  const tags = ['theme', 'alttheme']
    .flatMap((name) => field(name).split(/[;,]/))
    .map((tag) => tag.trim())
    .filter(Boolean)

  return songInput({
    title: field('title') || fallbackTitle,
    author: field('author'),
    copyright: field('copyright'),
    tags: [...new Set(tags)],
    arrangement: { order, linesPerSlide: null },
    lyrics: sectionsToLyrics(sections),
  })
}

// ---------- Detection ----------

/**
 * Parses an XML song file, telling OpenLyrics (a <song> with <properties>) from OpenSong (a <song> with a
 * <lyrics> text element). Throws for anything else.
 */
export function parseXmlSong(xml: string, fallbackTitle: string): { format: SongFileFormat; song: SongInput } {
  let root: XmlNode | undefined
  try {
    root = rootOf(xml.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('Not valid XML')
  }
  if (!root || nameOf(root) !== 'song') throw new Error('Not an OpenLyrics or OpenSong song')
  if (child(root, 'properties')) return { format: 'openlyrics', song: parseOpenLyrics(root, fallbackTitle) }
  if (child(root, 'lyrics')) return { format: 'opensong', song: parseOpenSong(root, fallbackTitle) }
  throw new Error('Not an OpenLyrics or OpenSong song')
}

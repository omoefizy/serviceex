// Sermons: what an export says and how it is laid out, apart from Electron, so it can be tested. Nothing here names a
// church, preacher or role; every name comes from the sermon record or from Settings.

import type { Sermon, SermonDetails, SermonExportOptions, SermonSegment } from './types'

export const UNTITLED_SERMON = 'Untitled sermon'

/** Field limits, checked in the main process. */
export const SERMON_LIMITS = { title: 200, preacher: 120, series: 120, notes: 20_000, summary: 2_000, point: 300, points: 20, segment: 5_000 } as const

/** The longest summary generateNotes keeps, in words. */
export const SUMMARY_MAX_WORDS = 120
export const KEY_POINTS = { min: 5, max: 8 } as const

export const DEFAULT_EXPORT: SermonExportOptions = { summary: true, scriptures: true, transcript: true, cleaned: true }

export const sermonTitle = (sermon: { title: string }) => sermon.title.trim() || UNTITLED_SERMON

/** "2026-10-25" as a long date, such as "Sunday, 25 October 2026", in the computer's language; the ISO date if it is not one. */
export function longDate(iso: string, locale?: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return iso
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

/** The details sent with a sermon's transcript for notes. */
export const sermonDetails = (sermon: Sermon): SermonDetails => ({
  title: sermon.title,
  preacher: sermon.preacher,
  series: sermon.series,
  churchName: sermon.churchName,
  date: sermon.date,
  scriptures: sermon.scriptures.map((s) => s.reference),
})

/** A sermon's details as lines for the AI, such as "Preacher: Ann Lee", with the date in English words; empty when there are none. */
export function sermonDetailsText(sermon: SermonDetails | undefined): string {
  if (!sermon) return ''
  return [
    ['Title', sermon.title],
    ['Preacher', sermon.preacher],
    ['Series', sermon.series],
    ['Church', sermon.churchName],
    ['Date', sermon.date ? longDate(sermon.date, 'en-US') : ''],
    ['Scripture read', sermon.scriptures.join('; ')],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n')
}

/** A pause this long between lines starts a new paragraph of the raw transcript. */
const PARAGRAPH_GAP_MS = 6000
/** Raw paragraphs are cut after this many words even without a pause, so they stay readable. */
const PARAGRAPH_WORDS = 110

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length

/** The raw transcript in paragraphs: final lines joined, broken at pauses and kept to a readable length. */
export function rawParagraphs(segments: Pick<SermonSegment, 'startMs' | 'text' | 'isFinal'>[]): string[] {
  const paragraphs: string[] = []
  let current: string[] = []
  let words = 0
  let lastAt = -Infinity
  for (const segment of segments) {
    const text = segment.text.trim()
    if (!segment.isFinal || !text) continue
    if (current.length > 0 && (segment.startMs - lastAt > PARAGRAPH_GAP_MS || words >= PARAGRAPH_WORDS)) {
      paragraphs.push(current.join(' '))
      current = []
      words = 0
    }
    current.push(text)
    words += wordCount(text)
    lastAt = segment.startMs
  }
  if (current.length > 0) paragraphs.push(current.join(' '))
  return paragraphs
}

/** The raw transcript as one text, lines joined by spaces. */
export const rawTranscript = (segments: Pick<SermonSegment, 'text' | 'isFinal'>[]) =>
  segments
    .filter((s) => s.isFinal && s.text.trim())
    .map((s) => s.text.trim())
    .join(' ')

/** Paragraphs split on blank lines. */
export const textParagraphs = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)

/** The transcript an export shows: the cleaned one when asked for and there is one, else the raw one. */
export function exportParagraphs(sermon: Pick<Sermon, 'segments' | 'cleanedTranscript'>, cleaned: boolean): string[] {
  return cleaned && sermon.cleanedTranscript.trim() ? textParagraphs(sermon.cleanedTranscript) : rawParagraphs(sermon.segments)
}

/** The header block: label and value for each field that has one. The title is separate. */
export function headerFields(sermon: Pick<Sermon, 'preacher' | 'date' | 'series' | 'churchName'>): [string, string][] {
  const fields: [string, string][] = [
    ['Preacher', sermon.preacher.trim()],
    ['Date', sermon.date ? longDate(sermon.date) : ''],
    ['Series', sermon.series.trim()],
    ['Church', sermon.churchName.trim()],
  ]
  return fields.filter(([, value]) => value !== '')
}

/** Unique references in the order first heard. */
export const scriptureList = (sermon: Pick<Sermon, 'scriptures'>) => [...new Set(sermon.scriptures.map((s) => s.reference))]

/** A plain text (.txt) or Markdown (.md) export. */
export function sermonText(sermon: Sermon, format: 'txt' | 'md', options: SermonExportOptions): string {
  const md = format === 'md'
  const title = sermonTitle(sermon)
  const lines: string[] = []
  const heading = (text: string) => {
    lines.push('', md ? `## ${text}` : text.toUpperCase(), '')
  }
  lines.push(md ? `# ${title}` : title)
  if (!md) lines.push('='.repeat(Math.min(title.length, 60)))
  lines.push('')
  for (const [label, value] of headerFields(sermon)) lines.push(md ? `**${label}:** ${value}  ` : `${label}: ${value}`)

  if (options.summary && (sermon.summary.trim() || sermon.keyPoints.length > 0)) {
    if (sermon.summary.trim()) {
      heading('Summary')
      lines.push(sermon.summary.trim())
    }
    if (sermon.keyPoints.length > 0) {
      heading('Key points')
      sermon.keyPoints.forEach((point, i) => lines.push(`${i + 1}. ${point}`))
    }
  }
  const references = scriptureList(sermon)
  if (options.scriptures && references.length > 0) {
    heading('Scripture references')
    for (const reference of references) lines.push(`- ${reference}`)
  }
  if (sermon.notes.trim()) {
    heading('Notes')
    lines.push(sermon.notes.trim())
  }
  const paragraphs = exportParagraphs(sermon, options.cleaned)
  if (options.transcript && paragraphs.length > 0) {
    heading('Transcript')
    lines.push(paragraphs.join('\n\n'))
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

export const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export interface SermonPage {
  /** A data: or file: URL for the church logo; null leaves it out. */
  logoUrl: string | null
  /** A file: URL of the bundled font; null uses the system sans-serif. */
  fontUrl: string | null
}

/**
 * The A4 page the PDF is printed from: church logo and name, the sermon's title and details, scripture, summary and
 * key points, notes, then the transcript in paragraphs. Page numbers and the footer line are added when printing.
 */
export function sermonHtml(sermon: Sermon, options: SermonExportOptions, page: SermonPage): string {
  const e = escapeHtml
  const title = sermonTitle(sermon)
  const details = headerFields(sermon).filter(([label]) => label !== 'Church')
  const references = scriptureList(sermon)
  const paragraphs = exportParagraphs(sermon, options.cleaned)
  const showSummary = options.summary && (sermon.summary.trim() !== '' || sermon.keyPoints.length > 0)
  const font = page.fontUrl ? `@font-face { font-family: 'Sermon Sans'; src: url('${page.fontUrl}') format('woff2'); font-weight: 200 900; }` : ''
  const parts: string[] = []

  if (page.logoUrl || sermon.churchName.trim()) {
    parts.push(
      '<header class="church">',
      page.logoUrl ? `<img class="logo" src="${e(page.logoUrl)}" alt="">` : '',
      sermon.churchName.trim() ? `<div class="church-name">${e(sermon.churchName.trim())}</div>` : '',
      '</header>',
    )
  }
  parts.push(`<h1>${e(title)}</h1>`)
  if (details.length > 0) {
    parts.push('<dl class="details">', ...details.map(([label, value]) => `<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`), '</dl>')
  }
  if (options.scriptures && references.length > 0) {
    parts.push('<section><h2>Scripture references</h2><ul class="references">', ...references.map((r) => `<li>${e(r)}</li>`), '</ul></section>')
  }
  if (showSummary) {
    parts.push('<section>')
    if (sermon.summary.trim()) parts.push('<h2>Summary</h2>', `<p>${e(sermon.summary.trim())}</p>`)
    if (sermon.keyPoints.length > 0) parts.push('<h2>Key points</h2><ol class="points">', ...sermon.keyPoints.map((p) => `<li>${e(p)}</li>`), '</ol>')
    parts.push('</section>')
  }
  if (sermon.notes.trim()) {
    parts.push('<section><h2>Notes</h2>', ...textParagraphs(sermon.notes).map((p) => `<p>${e(p)}</p>`), '</section>')
  }
  if (options.transcript && paragraphs.length > 0) {
    parts.push('<section class="transcript"><h2>Transcript</h2>', ...paragraphs.map((p) => `<p>${e(p)}</p>`), '</section>')
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: file:; font-src file: data:; style-src 'unsafe-inline'">
<title>${e(title)}</title>
<style>
${font}
@page { size: A4; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: ${page.fontUrl ? "'Sermon Sans', " : ''}system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 11pt; line-height: 1.55; color: #1d1d1f; }
.church { display: flex; align-items: center; gap: 12pt; padding-bottom: 10pt; margin-bottom: 18pt; border-bottom: 1px solid #d8d8dc; }
.logo { max-height: 48pt; max-width: 140pt; object-fit: contain; }
.church-name { font-size: 13pt; font-weight: 600; letter-spacing: 0.02em; color: #3a3a3c; }
h1 { font-size: 24pt; line-height: 1.2; font-weight: 700; margin: 0 0 10pt; }
h2 { font-size: 13pt; font-weight: 650; margin: 20pt 0 6pt; color: #3a3a3c; break-after: avoid; }
.details { display: flex; flex-wrap: wrap; gap: 4pt 24pt; margin: 0 0 8pt; }
.details div { display: flex; gap: 6pt; }
.details dt { color: #6e6e73; }
.details dd { margin: 0; font-weight: 600; }
.references { columns: 2; column-gap: 24pt; margin: 0; padding-left: 16pt; }
.points { margin: 0; padding-left: 18pt; }
.points li { margin-bottom: 4pt; }
p { margin: 0 0 8pt; orphans: 3; widows: 3; }
.transcript p { text-align: justify; hyphens: auto; }
</style>
</head>
<body>
${parts.filter(Boolean).join('\n')}
</body>
</html>
`
}

/** The footer printed on every page: the line from Settings on the left, the page number on the right. */
export function sermonFooter(footerLine: string): string {
  return `<div style="width:100%;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:8px;color:#6e6e73;padding:0 19mm;display:flex;justify-content:space-between;gap:12px"><span>${escapeHtml(footerLine.trim())}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`
}

/** A file name for the export, from the date and title, without characters file systems refuse. */
export function exportFileName(sermon: Pick<Sermon, 'title' | 'date'>, extension: string): string {
  const base = `${sermon.date ? `${sermon.date} ` : ''}${sermonTitle(sermon)}`
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return `${base || 'Sermon'}.${extension}`
}

/** A scripture slide's text: the verses, then the reference under them in the reference color. */
export interface SlidePassage {
  reference: string
  /** The verse text, or null when it is too long for one slide or not in the Bible database. */
  text: string | null
}

/** Verse text longer than this goes on the slide as the reference alone, so each slide stays one readable idea. */
export const SLIDE_VERSE_WORDS = 60

/** The words on the last slide, above the church name. */
export const CLOSING_LINE = 'Thank you for joining us'

/** One slide of a sermon deck, the same for the PowerPoint file and the schedule. */
export type DeckSlide =
  | { kind: 'title'; title: string; lines: string[] }
  | { kind: 'scripture'; reference: string; text: string | null }
  | { kind: 'statement'; text: string }
  | { kind: 'point'; text: string }
  | { kind: 'closing'; text: string; lines: string[] }

const oneParagraph = (text: string) => text.replace(/\s*\n\s*/g, ' ').trim()

/**
 * The sermon's slides, one idea each: a title slide (title, preacher, date, church), each scripture reference saved
 * on the sermon (with its words when they fit), each pinned statement, each key point, and a closing slide.
 */
export function sermonDeck(
  sermon: Pick<Sermon, 'title' | 'preacher' | 'date' | 'churchName' | 'keyPoints' | 'statements'>,
  passages: SlidePassage[],
): DeckSlide[] {
  const church = sermon.churchName.trim()
  const slides: DeckSlide[] = [
    { kind: 'title', title: sermonTitle(sermon), lines: [sermon.preacher.trim(), sermon.date ? longDate(sermon.date) : '', church].filter(Boolean) },
  ]
  for (const passage of passages) {
    const words = passage.text ? oneParagraph(passage.text) : ''
    slides.push({ kind: 'scripture', reference: passage.reference, text: words && wordCount(words) <= SLIDE_VERSE_WORDS ? words : null })
  }
  for (const statement of sermon.statements) {
    const text = oneParagraph(statement.text).replace(/^["“”]+|["“”]+$/g, '')
    if (statement.pinned && text) slides.push({ kind: 'statement', text })
  }
  for (const point of sermon.keyPoints) if (point.trim()) slides.push({ kind: 'point', text: oneParagraph(point) })
  slides.push({ kind: 'closing', text: CLOSING_LINE, lines: church ? [church] : [] })
  return slides
}

/** Slides with something from the sermon on them: all but the title and closing slides. */
export const deckContentCount = (deck: DeckSlide[]) => deck.filter((slide) => slide.kind !== 'title' && slide.kind !== 'closing').length

/** How many slides a sermon has beyond its title and closing slides, without looking up verse text. */
export const sermonContentCount = (sermon: Parameters<typeof sermonDeck>[0] & Pick<Sermon, 'scriptures'>) =>
  deckContentCount(sermonDeck(sermon, scriptureList(sermon).map((reference) => ({ reference, text: null }))))

/**
 * The deck as announcement slide texts for the schedule, after the announcement's own title slide. Slides are
 * separated by blank lines; a {line} at the end of a slide shows in the reference color.
 */
export function deckSlideTexts(deck: DeckSlide[]): string[] {
  return deck.flatMap((slide) => {
    switch (slide.kind) {
      case 'title':
        return []
      case 'scripture':
        return [slide.text ? `${slide.text}\n{${slide.reference}}` : slide.reference]
      case 'statement':
        return [`“${slide.text}”`]
      case 'point':
        return [slide.text]
      case 'closing':
        return [[slide.text, ...slide.lines.map((line) => `{${line}}`)].join('\n')]
    }
  })
}

/**
 * The largest font size, in points, from `max` down to `min`, at which `text` fits a box `width` by `height` inches
 * when wrapped at spaces. Widths are estimated for a sans-serif face (with room to spare), so the words never run out
 * of the box even where PowerPoint does not apply its own shrink-to-fit.
 */
export function fitFontSize(text: string, width: number, height: number, max: number, min: number): number {
  const lineCount = (size: number) => {
    const perLine = Math.max(1, Math.floor((width * 72) / (size * 0.56)))
    let lines = 0
    for (const paragraph of text.split('\n')) {
      let used = 0
      lines += 1
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        // A word longer than a line breaks across lines.
        const length = Math.min(word.length, perLine)
        if (used > 0 && used + 1 + length > perLine) {
          lines += 1
          used = length
        } else used += (used > 0 ? 1 : 0) + length
        if (word.length > perLine) lines += Math.ceil(word.length / perLine) - 1
      }
    }
    return lines
  }
  for (let size = max; size > min; size -= 2) if ((lineCount(size) * size * 1.2) / 72 <= height) return size
  return min
}

/** Trims a summary to `max` words, ending at the last full sentence that fits when there is one. */
export function limitWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length <= max) return words.join(' ')
  const cut = words.slice(0, max).join(' ')
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  return end > cut.length / 2 ? cut.slice(0, end + 1) : `${cut}…`
}

/** cleanTranscript and generateNotes send a transcript in chunks of at most this many words, one request each. */
export const CHUNK_WORDS = 1500

/**
 * Splits a transcript into chunks of at most `maxWords` words, without overlap, breaking only at sentence ends. A
 * single sentence longer than that (speech recognition can run on without full stops) is cut between words, so no
 * chunk is ever longer than `maxWords`.
 */
export function transcriptChunks(text: string, maxWords = CHUNK_WORDS): string[] {
  const chunks: string[] = []
  let current: string[] = []
  let count = 0
  const flush = () => {
    if (current.length > 0) chunks.push(current.join(' '))
    current = []
    count = 0
  }
  // A sentence ends at . ! ? or … (and any closing quote or bracket after it) followed by a space.
  for (const sentence of text.trim().split(/(?<=[.!?…]["'”’)\]]*)\s+/)) {
    const words = sentence.split(/\s+/).filter(Boolean)
    if (words.length === 0) continue
    if (count + words.length > maxWords) flush()
    // An overlong sentence: whole chunks of it first; the rest starts the next chunk.
    while (words.length > maxWords) chunks.push(words.splice(0, maxWords).join(' '))
    current.push(words.join(' '))
    count += words.length
  }
  flush()
  return chunks
}

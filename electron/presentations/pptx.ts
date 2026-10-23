// Reads a .pptx directly (a zip of XML parts): slide order, titles, text and speaker notes, and whether each
// slide has animations (p:timing with a main sequence) or a transition (p:transition). Used on every platform,
// whichever engine draws the pictures.

import path from 'node:path'
import { strFromU8, unzipSync } from 'fflate'

export interface PptxSlideInfo {
  title: string
  text: string
  notes: string
  animated: boolean
  /** Hidden in the slide show; PDF exports leave these out. */
  hidden: boolean
}

const decode = (value: string) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&')

/** The text of an XML fragment, one line per paragraph (a:p), empty paragraphs dropped. */
function paragraphs(xml: string): string {
  const lines: string[] = []
  for (const [paragraph] of xml.matchAll(/<a:p[\s>][\s\S]*?<\/a:p>/g)) {
    const line = [...paragraph.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((m) => decode(m[1])).join('')
    if (line.trim()) lines.push(line.trim())
  }
  return lines.join('\n')
}

/** Shapes (p:sp) of a slide or notes page, with their placeholder type when they have one. */
function shapes(xml: string): { type: string | null; xml: string }[] {
  return [...xml.matchAll(/<p:sp[\s>][\s\S]*?<\/p:sp>/g)].map(([shape]) => ({
    type: /<p:ph\b[^>]*\btype="([^"]+)"/.exec(shape)?.[1] ?? (/<p:ph\b/.test(shape) ? 'body' : null),
    xml: shape,
  }))
}

/** Relationship id to target part path, resolved against the part that owns the .rels file. */
function relationships(files: Record<string, Uint8Array>, part: string): Map<string, { type: string; target: string }> {
  const rels = files[path.posix.join(path.posix.dirname(part), '_rels', `${path.posix.basename(part)}.rels`)]
  const map = new Map<string, { type: string; target: string }>()
  if (!rels) return map
  for (const [tag] of strFromU8(rels).matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(tag)?.[1]
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1]
    const type = /\bType="([^"]+)"/.exec(tag)?.[1] ?? ''
    if (id && target) map.set(id, { type, target: path.posix.normalize(path.posix.join(path.posix.dirname(part), decode(target))) })
  }
  return map
}

/** A slide with a main animation sequence holding at least one effect. */
function hasAnimations(slideXml: string): boolean {
  const timing = /<p:timing[\s>][\s\S]*?<\/p:timing>/.exec(slideXml)?.[0]
  if (!timing) return false
  return /nodeType="mainSeq"/.test(timing) && /presetClass="/.test(timing)
}

/** p:transition, plain or inside mc:AlternateContent (newer effects carry a fallback there). */
const hasTransition = (slideXml: string) => /<p:transition[\s>/]/.test(slideXml)

/** The slides of a .pptx in show order (hidden ones included). Throws if the file is not a readable .pptx. */
export function readPptx(bytes: Uint8Array): PptxSlideInfo[] {
  const files = unzipSync(bytes, { filter: (file) => file.name.startsWith('ppt/') && /\.(xml|rels)$/.test(file.name) })
  const presentation = files['ppt/presentation.xml']
  if (!presentation) throw new Error('This file is not a PowerPoint .pptx presentation')
  const rels = relationships(files, 'ppt/presentation.xml')

  return [...strFromU8(presentation).matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].flatMap(([, rId]) => {
    const part = rels.get(rId)?.target
    const slide = part && files[part]
    if (!part || !slide) return []
    const xml = strFromU8(slide)
    const slideShapes = shapes(xml)
    const title = slideShapes.filter((s) => s.type === 'title' || s.type === 'ctrTitle').map((s) => paragraphs(s.xml)).join('\n')
    const text = slideShapes.map((s) => paragraphs(s.xml)).filter(Boolean).join('\n')

    const notesPart = [...relationships(files, part).values()].find((r) => r.type.endsWith('/notesSlide'))?.target
    const notesXml = notesPart && files[notesPart] ? strFromU8(files[notesPart]) : ''
    const notes = shapes(notesXml)
      .filter((s) => s.type === 'body')
      .map((s) => paragraphs(s.xml))
      .filter(Boolean)
      .join('\n')

    const hidden = /<p:sld\b[^>]*\bshow="(?:0|false)"/.test(xml)
    return [{ title, text, notes, animated: hasAnimations(xml) || hasTransition(xml), hidden }]
  })
}

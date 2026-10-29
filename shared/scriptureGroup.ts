// A Scripture group: up to four passages on one slide, each followed by its own reference line ({Ephesians 1:19b KJV},
// drawn in the reference colour; see slideLines). Stacked, or in two columns. The words fit the theme's text box; when
// they would come out too small to read, the group can split into a slide per passage instead.

import { AUTO_FIT_MAX, mainTextElement } from './themes'
import type { ScriptureGroup, ScriptureGroupPassage, ScriptureSlide, ThemeStyle } from './types'

export const MAX_GROUP_PASSAGES = 4

/** Smaller than this (percent of screen height, about 38 pixels at 1080p) is hard to read from the back. */
export const MIN_READABLE_SIZE = 3.5

/** The gap between two columns, in percent of the slide's width. */
export const COLUMN_GAP = 2

/** Average letter width as a share of the font size, for estimating how text wraps. */
const LETTER_WIDTH = 0.5

/** A slide is 16:9; sizes are in percent of its height (cqh). */
const ASPECT = 16 / 9

/** "Ephesians 1:19b KJV". */
export const passageLabel = (passage: ScriptureGroupPassage) => `${passage.reference} ${passage.version}`

/** A passage's words: its verses one after another. */
export const passageWords = (passage: ScriptureGroupPassage) =>
  passage.verses
    .map((verse) => verse.text.trim())
    .filter(Boolean)
    .join(' ')

/** A passage as slide lines: its words, then its reference on a {reference} line. */
export const passageBlock = (passage: ScriptureGroupPassage) => `${passageWords(passage)}\n{${passageLabel(passage)}}`

/** The group's title in the Order of service: "John 3:16 KJV; Romans 5:8 KJV". */
export const groupTitle = (group: ScriptureGroup) => group.passages.slice(0, MAX_GROUP_PASSAGES).map(passageLabel).join('; ')

/** The room the words have in a theme's text box, in percent of the slide's height. */
export interface FitBox {
  width: number
  height: number
  lineHeight: number
  /** The largest size the theme allows. */
  maxSize: number
}

/** The theme's main text box as room for words; null for a theme without one. */
export function fitBoxOf(theme: ThemeStyle): FitBox | null {
  const main = mainTextElement(theme.elements)
  if (!main) return null
  const { box, text } = main
  return {
    width: Math.max(1, box.width * ASPECT - text.padding * 2),
    height: Math.max(1, box.height - text.padding * 2),
    lineHeight: text.lineHeight,
    maxSize: text.sizeMode === 'fixed' ? text.fontSize : (text.maxSize ?? AUTO_FIT_MAX),
  }
}

/** One of two columns side by side in `box`. */
export const columnBox = (box: FitBox): FitBox => ({ ...box, width: Math.max(1, (box.width - COLUMN_GAP * ASPECT) / 2) })

/**
 * About the largest font size (percent of screen height) at which `text` fits `box`, from average letter widths: the
 * slide's auto fit measures the real letters, so this only decides whether the words are getting too small.
 */
export function estimateFontSize(text: string, box: FitBox): number {
  const lines = text.split('\n').map((line) => line.trim().replace(/^\{(.+)\}$/, '$1'))
  const longestWord = Math.max(1, ...lines.flatMap((line) => line.split(/\s+/).map((word) => word.length)))
  const fits = (size: number) => {
    const perLine = box.width / (size * LETTER_WIDTH)
    if (longestWord > perLine) return false
    const count = lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)), 0)
    return count * size * box.lineHeight <= box.height
  }
  let low = 0.5
  let high = box.maxSize
  if (fits(high)) return high
  while (high - low > 0.05) {
    const size = (low + high) / 2
    if (fits(size)) low = size
    else high = size
  }
  return Math.round(low * 100) / 100
}

/** The passages a group shows: the first four. */
const shown = (group: ScriptureGroup) => group.passages.slice(0, MAX_GROUP_PASSAGES)

/** The group on one slide: every passage stacked, or in two columns (the first half left, the rest right). */
export function combinedSlide(group: ScriptureGroup): ScriptureSlide {
  const blocks = shown(group).map(passageBlock)
  if (group.layout === 'columns' && blocks.length > 1) {
    const half = Math.ceil(blocks.length / 2)
    return { text: blocks.slice(0, half).join('\n'), caption: '', column: blocks.slice(half).join('\n') }
  }
  return { text: blocks.join('\n'), caption: '' }
}

/** About the font size a slide's words get in `box`: the smaller column's, for two columns. */
export function slideFontSize(slide: ScriptureSlide, box: FitBox): number {
  if (slide.column === undefined) return estimateFontSize(slide.text, box)
  const half = columnBox(box)
  return Math.min(estimateFontSize(slide.text, half), estimateFontSize(slide.column, half))
}

/** How the group fits on one slide: about the font size, and whether that is too small to read (offer to split). */
export function groupFit(group: ScriptureGroup, box: FitBox | null): { fontSize: number; tooLong: boolean } {
  if (!box) return { fontSize: 0, tooLong: false }
  const fontSize = slideFontSize(combinedSlide(group), box)
  return { fontSize, tooLong: fontSize < MIN_READABLE_SIZE }
}

/**
 * The group's slides: one combined slide, or with `split` a slide per passage. A passage still too long for a slide
 * of its own (with `box` given) gets a slide per verse, each under its verse's reference.
 */
export function groupSlides(group: ScriptureGroup, box: FitBox | null = null): ScriptureSlide[] {
  if (!group.split) return [combinedSlide(group)]
  return shown(group).flatMap((passage): ScriptureSlide[] => {
    const block = passageBlock(passage)
    if (!box || passage.verses.length < 2 || estimateFontSize(block, box) >= MIN_READABLE_SIZE) return [{ text: block, caption: '' }]
    return passage.verses.map((verse) => ({ text: `${verse.text.trim()}\n{${verse.caption}}`, caption: '' }))
  })
}

/** A group as a service item's payload: its slides, ready to show, and the group to edit again. */
export function groupPayload(group: ScriptureGroup, box: FitBox | null = null): { title: string; verses: ScriptureSlide[]; group: ScriptureGroup } {
  const kept = { ...group, passages: shown(group) }
  return { title: groupTitle(kept), verses: groupSlides(kept, box), group: kept }
}

// ---------- Checking what arrives from outside (the renderer, another computer, a package file) ----------

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A scripture slide with its optional fields checked: a part needs the verse it is part of. Null when not a slide. */
export function sanitizeScriptureSlide(value: unknown, maxLength = 20_000): ScriptureSlide | null {
  if (!isRecord(value) || typeof value.text !== 'string' || typeof value.caption !== 'string') return null
  const slide: ScriptureSlide = { text: value.text.slice(0, maxLength), caption: value.caption.slice(0, 300) }
  if (typeof value.source === 'string') slide.source = value.source.slice(0, maxLength)
  const part = value.part
  if (slide.source !== undefined && isRecord(part) && (part.which === 'a' || part.which === 'b') && Number.isInteger(part.split)) {
    slide.part = { which: part.which, split: Math.min(Math.max(part.split as number, 0), slide.source.length) }
  }
  if (value.edited === true && slide.source !== undefined) slide.edited = true
  if (typeof value.column === 'string') slide.column = value.column.slice(0, maxLength)
  return slide
}

/** A Scripture group checked: a layout, one to four passages each with a reference, a version and verses. */
export function sanitizeScriptureGroup(value: unknown): ScriptureGroup | undefined {
  if (!isRecord(value) || (value.layout !== 'stacked' && value.layout !== 'columns') || !Array.isArray(value.passages)) return undefined
  const passages = value.passages.slice(0, MAX_GROUP_PASSAGES).flatMap((passage): ScriptureGroupPassage[] => {
    if (!isRecord(passage) || typeof passage.reference !== 'string' || typeof passage.version !== 'string' || !Array.isArray(passage.verses)) return []
    const verses = passage.verses.slice(0, 500).map((verse) => sanitizeScriptureSlide(verse)).filter((verse) => verse !== null)
    return passage.reference.trim() && verses.length > 0 ? [{ reference: passage.reference.slice(0, 200), version: passage.version.slice(0, 12), verses }] : []
  })
  if (passages.length === 0) return undefined
  return { layout: value.layout, passages, ...(value.split === true ? { split: true } : {}) }
}

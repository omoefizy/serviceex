// Scripture detection from the live transcript. Each final line is read for spoken references
// (shared/spokenReference) and, when it names none, checked for a quoted verse (bible.matchQuote). What is found
// becomes a suggestion in the tray above the slide grid, beside statements the AI picked (see ./statements).
// A suggestion only ever goes to the preview; going live stays the operator's decision.

import { create } from 'zustand'
import type { ScripturePayload } from '../../shared/types'
import { formatReference, type ScriptureReference } from '../../shared/parseReference'
import { findSpokenReferences } from '../../shared/spokenReference'
import { wordKeys } from '../../shared/statements'
import { useOperatorStore } from '../store'
import { fetchPassage, previewPassage } from './scripture'

export const EXPIRE_MS = 2 * 60_000
export const DUPLICATE_MS = 60_000
/** Statements stay a little longer: they are read before being used. */
export const STATEMENT_EXPIRE_MS = 3 * 60_000

export interface ScriptureSuggestion {
  type: 'scripture'
  id: number
  reference: ScriptureReference
  /** "John 3:16" */
  label: string
  /** The KJV text: the verse, or the first verse of a passage followed by an ellipsis. */
  text: string
  passage: ScripturePayload
  heardAt: number
  confidence: number
  /** Named aloud, or recognised from its words. */
  kind: 'reference' | 'quote'
  /** What was said, for the tooltip. */
  heard: string
}

/** A quotable line from the sermon, in the transcript's words; shown as a quote slide. */
export interface StatementSuggestion {
  type: 'statement'
  id: number
  text: string
  heardAt: number
}

export type Suggestion = ScriptureSuggestion | StatementSuggestion

interface SuggestionState {
  /** Newest first. */
  suggestions: Suggestion[]
  /** The suggestion last sent to the preview, highlighted in the tray. */
  previewedId: number | null
  /** Bumped by each new suggestion when the flash alert is on. */
  flashKey: number
  add(suggestion: Omit<ScriptureSuggestion, 'id' | 'type'>): boolean
  /** Adds a statement unless it (or a line containing it, or contained in it) was suggested before. */
  addStatement(text: string, heardAt: number): boolean
  /** Keeps the operator's corrections to a statement. */
  editStatement(id: number, text: string): void
  preview(id: number): void
  dismiss(id: number): void
  /** Drops scripture older than two minutes and statements older than three. */
  expire(now?: number): void
  clear(): void
}

let nextId = 1
let expiryTimer: ReturnType<typeof setInterval> | null = null
/** Every statement suggested since the tray was cleared, as word keys, so none comes back. Memory only. */
let statementsSeen: string[] = []

const isScripture = (s: Suggestion): s is ScriptureSuggestion => s.type === 'scripture'

export const useSuggestions = create<SuggestionState>((set, get) => ({
  suggestions: [],
  previewedId: null,
  flashKey: 0,

  add(suggestion) {
    const now = suggestion.heardAt
    get().expire(now)
    const { suggestions } = get()
    // The same reference again within a minute is the speaker repeating it, not news.
    if (suggestions.some((s) => isScripture(s) && s.label === suggestion.label && now - s.heardAt < DUPLICATE_MS)) return false
    // A verse named after its chapter ("John 3" then "verse 16") replaces the chapter suggestion.
    const refined = (s: Suggestion) =>
      isScripture(s) &&
      s.reference.verseStart === null &&
      suggestion.reference.verseStart !== null &&
      s.reference.book === suggestion.reference.book &&
      s.reference.chapter === suggestion.reference.chapter &&
      now - s.heardAt < DUPLICATE_MS
    set({ suggestions: [{ ...suggestion, type: 'scripture', id: nextId++ }, ...suggestions.filter((s) => !refined(s))] })
    expiryTimer ??= setInterval(() => get().expire(), 5000)
    return true
  },

  addStatement(text, heardAt) {
    get().expire(heardAt)
    const key = ` ${wordKeys(text).join(' ')} `
    if (key.trim() === '') return false
    if (statementsSeen.some((seen) => seen.includes(key) || key.includes(seen))) return false
    statementsSeen.push(key)
    set({ suggestions: [{ type: 'statement', id: nextId++, text: text.trim(), heardAt }, ...get().suggestions] })
    expiryTimer ??= setInterval(() => get().expire(), 5000)
    return true
  },

  editStatement(id, text) {
    set((s) => ({ suggestions: s.suggestions.map((x) => (x.id === id && x.type === 'statement' ? { ...x, text: text.trim() } : x)) }))
  },

  preview(id) {
    const suggestion = get().suggestions.find((s) => s.id === id)
    if (!suggestion) return
    if (isScripture(suggestion)) previewPassage(suggestion.passage)
    else useOperatorStore.getState().selectQuote(suggestion.text, useOperatorStore.getState().settings.quoteSpeakerName)
    set({ previewedId: id })
  },

  dismiss(id) {
    set((s) => ({ suggestions: s.suggestions.filter((x) => x.id !== id) }))
  },

  expire(now = Date.now()) {
    const kept = get().suggestions.filter((s) => now - s.heardAt < (isScripture(s) ? EXPIRE_MS : STATEMENT_EXPIRE_MS))
    if (kept.length !== get().suggestions.length) set({ suggestions: kept })
    if (kept.length === 0 && expiryTimer) {
      clearInterval(expiryTimer)
      expiryTimer = null
    }
  },

  clear() {
    statementsSeen = []
    set({ suggestions: [], previewedId: null })
  },
}))

/** The previous final line, so a reference split across two lines ("turn to John chapter three" / "verse sixteen") is found. */
let previousLine = ''

/** Reads one final line of the transcript for scripture and adds what it finds to the tray. */
export async function detectScripture(line: string, heardAt = Date.now()): Promise<void> {
  const { scriptureDetection, detectionMinConfidence } = useOperatorStore.getState().settings
  const joined = previousLine ? `${previousLine} ${line}` : line
  previousLine = line
  if (!scriptureDetection) return

  const named = findSpokenReferences(joined).filter((r) => r.confidence >= detectionMinConfidence)
  for (const found of named) {
    await suggest(found.reference, found.confidence, 'reference', found.heard, heardAt)
  }
  // Only look for a quote when nothing was named in this line: a verse read right after its reference is already there.
  if (findSpokenReferences(line).length > 0) return
  const quote = await window.api.bible.matchQuote(line)
  if (quote && quote.confidence >= detectionMinConfidence) {
    const reference = { book: quote.book, chapter: quote.chapter, verseStart: quote.verse, verseEnd: quote.verse }
    await suggest(reference, quote.confidence, 'quote', line, heardAt)
  }
}

async function suggest(reference: ScriptureReference, confidence: number, kind: ScriptureSuggestion['kind'], heard: string, heardAt: number) {
  const label = formatReference(reference)
  // Checked before the lookup so a repeated reference costs nothing.
  if (useSuggestions.getState().suggestions.some((s) => isScripture(s) && s.label === label && heardAt - s.heardAt < DUPLICATE_MS)) return
  // The tray shows the KJV wording; a chapter or verse that does not exist finds nothing and is dropped.
  const passage = await fetchPassage(reference, 'KJV')
  if (!passage) return
  const text = passage.verses[0].text + (passage.verses.length > 1 ? ' …' : '')
  const added = useSuggestions.getState().add({ reference, label, text, passage, heardAt, confidence, kind, heard })
  if (added) alertNewSuggestion()
}

export function alertNewSuggestion() {
  const { detectionAlert } = useOperatorStore.getState().settings
  if (detectionAlert === 'flash') useSuggestions.setState((s) => ({ flashKey: s.flashKey + 1 }))
  if (detectionAlert === 'sound') chime()
}

/** A short, quiet two-note chime on the operator's computer. */
function chime() {
  try {
    const context = new AudioContext()
    const gain = context.createGain()
    gain.connect(context.destination)
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.15, context.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.35)
    for (const [frequency, at] of [
      [880, 0],
      [1320, 0.12],
    ]) {
      const tone = context.createOscillator()
      tone.frequency.value = frequency
      tone.connect(gain)
      tone.start(context.currentTime + at)
      tone.stop(context.currentTime + 0.35)
    }
    setTimeout(() => context.close().catch(() => undefined), 600)
  } catch (error) {
    console.error(error)
  }
}

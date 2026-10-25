// Scripture detection from the live transcript, fast enough to follow the speaker. Every interim (partial) result and
// every final line is read through a sliding window of the last 15 words, in stages:
//  1. the spoken reference parser (shared/spokenReference), with the current book and chapter as context;
//  2. the quote matcher (bible.matchQuote: the last 8 to 25 words against the KJV and the WEB), when no reference was named;
//  3. optionally the AI (findScriptureReferences), when scripture-like talk goes 8 seconds with neither finding anything.
// A reference in interim words is suggested once it has been complete and unchanged for 300 ms; a final line is read at
// once. A narrower reading of a recent card (John 3, then verse 16; or 3:16, then 3:16-18) updates it in place.
// Cards appear in the tray above the slide grid, beside statements the AI picked (see ./statements). A suggestion only
// ever goes to the preview; going live stays the operator's decision.

import { create } from 'zustand'
import type { BibleVersionCode, ScripturePayload } from '../../shared/types'
import { formatReference, parseReference, type ScriptureReference } from '../../shared/parseReference'
import { countTokens, emptyContext, readTranscript, type ReferenceCandidate, type ReferenceContext, type SpokenReference } from '../../shared/spokenReference'
import { wordKeys } from '../../shared/statements'
import { selectDefaultTranslation, useOperatorStore } from '../store'
import { fetchPassage, previewPassage } from './scripture'

export const EXPIRE_MS = 2 * 60_000
export const DUPLICATE_MS = 60_000
/** Statements stay a little longer: they are read before being used. */
export const STATEMENT_EXPIRE_MS = 3 * 60_000
/** Interim words must hold a complete reference this long before it is suggested. */
export const STABLE_MS = 300
/** Words the parser reads at a time. */
export const WINDOW_WORDS = 15
/** Words the quote matcher reads at a time (it needs at least four). */
const QUOTE_WINDOW_WORDS = 25
/** Interim words are matched against quotes at most this often. */
export const QUOTE_INTERVAL_MS = 600
/** Scripture-like talk this long without a suggestion asks the AI; at most one request per AI_INTERVAL_MS. */
export const AI_AFTER_MS = 8000
export const AI_INTERVAL_MS = 10_000
/** How much transcript the AI is given. */
const AI_TRANSCRIPT_MS = 25_000
/** AI suggestions are not scored by the app; they count as this sure. */
const AI_CONFIDENCE = 0.65

/** Talk that usually comes with scripture. */
const SCRIPTURE_CUES = /\b(says|said|written|turn to|the bible says|in the book of|scripture|the word of god|the apostle)\b/i

/** One reading of what was heard, looked up in the Bible. */
export interface SuggestionOption {
  reference: ScriptureReference
  /** "John 3:16" */
  label: string
  passage: ScripturePayload
  confidence: number
}

export interface ScriptureSuggestion extends SuggestionOption {
  type: 'scripture'
  id: number
  /** The first verse of the passage (followed by an ellipsis when there are more), in `version`. */
  text: string
  version: BibleVersionCode
  /** For a quote: the verse with the words the speaker said marked. */
  highlight?: { text: string; match: boolean }[]
  /** Up to two other readings of the same words, shown as small chips. */
  alternatives: SuggestionOption[]
  heardAt: number
  /** Named aloud, recognised from its words, or suggested by the AI. */
  kind: 'reference' | 'quote' | 'ai'
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
  /** Adds a card, or narrows a recent one in place; null when it repeats one from the last minute. */
  add(suggestion: Omit<ScriptureSuggestion, 'id' | 'type'>): 'added' | 'updated' | null
  /** Adds a statement unless it (or a line containing it, or contained in it) was suggested before. */
  addStatement(text: string, heardAt: number): boolean
  /** Keeps the operator's corrections to a statement. */
  editStatement(id: number, text: string): void
  /** Sends a card's reading to the preview: the top one, or alternative `option` (0 or 1). */
  preview(id: number, option?: number): void
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

const sameChapter = (a: ScriptureReference, b: ScriptureReference) => a.book === b.book && a.chapter === b.chapter

/** `outer` takes in all of `inner`: the whole chapter, or a range around it. */
function covers(outer: ScriptureReference, inner: ScriptureReference): boolean {
  if (!sameChapter(outer, inner)) return false
  if (outer.verseStart === null) return inner.verseStart === null
  return inner.verseStart !== null && outer.verseStart <= inner.verseStart && outer.verseEnd! >= inner.verseEnd!
}

/** `next` is a narrower or fuller reading of `old`: a verse in a chapter card, or a longer range from its first verse. */
function refines(next: ScriptureReference, old: ScriptureReference): boolean {
  if (!sameChapter(next, old) || formatReference(next) === formatReference(old)) return false
  if (old.verseStart === null) return next.verseStart !== null
  return covers(next, old)
}

export const useSuggestions = create<SuggestionState>((set, get) => ({
  suggestions: [],
  previewedId: null,
  flashKey: 0,

  add(suggestion) {
    const now = suggestion.heardAt
    get().expire(now)
    const recent = get().suggestions.filter((s): s is ScriptureSuggestion => isScripture(s) && now - s.heardAt < DUPLICATE_MS)
    // The same reference again within a minute is the speaker repeating it, not news.
    if (recent.some((s) => s.label === suggestion.label || (covers(s.reference, suggestion.reference) && !refines(suggestion.reference, s.reference)))) return null
    const refined = recent.find((s) => refines(suggestion.reference, s.reference))
    if (refined) {
      // Keep the card, its place and when it was first heard; take the fuller reading.
      const updated: ScriptureSuggestion = { ...refined, ...suggestion, id: refined.id, type: 'scripture', heardAt: refined.heardAt }
      set({ suggestions: get().suggestions.map((s) => (s === refined ? updated : s)) })
      return 'updated'
    }
    set({ suggestions: [{ ...suggestion, type: 'scripture', id: nextId++ }, ...get().suggestions] })
    expiryTimer ??= setInterval(() => get().expire(), 5000)
    return 'added'
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

  preview(id, option) {
    const suggestion = get().suggestions.find((s) => s.id === id)
    if (!suggestion) return
    if (isScripture(suggestion)) {
      const chosen = option === undefined ? suggestion : suggestion.alternatives[option]
      if (!chosen) return
      previewPassage(chosen.passage)
    } else {
      useOperatorStore.getState().selectQuote(suggestion.text, useOperatorStore.getState().settings.quoteSpeakerName)
    }
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

// ---------- Debug view ----------

export interface DetectionStage {
  name: 'parser' | 'quote' | 'ai'
  ms: number
  /** What it found, or why it was skipped. */
  result: string
}

export interface DetectionDebug {
  /** The last pass over the transcript. */
  run: { at: number; source: 'interim' | 'final'; segment: string; stages: DetectionStage[] } | null
  /** The last card made or updated: by which stage, and milliseconds from the words first arriving to the card. */
  card: { label: string; stage: string; latencyMs: number; at: number } | null
}

/** Filled as detection runs, for the listener panel's debug view. Memory only. */
export const useDetectionDebug = create<DetectionDebug>(() => ({ run: null, card: null }))

function recordRun(source: 'interim' | 'final', segment: string, stages: DetectionStage[], at: number) {
  useDetectionDebug.setState({ run: { at, source, segment, stages } })
}

// ---------- The pipeline ----------

/** The book and chapter the speaker is in, from final lines. */
let context: ReferenceContext = emptyContext()
/** Final lines, for the window and the AI. */
let finals: { text: string; at: number }[] = []
/** The interim words now. */
let partial = ''
/** When each label was last suggested (even if dismissed since), so it does not come back within a minute. */
const suggestedAt = new Map<string, number>()
/** Complete references in interim words, waiting to stay put for STABLE_MS; keyed by label. */
const pending = new Map<string, { found: SpokenReference; since: number; timer: ReturnType<typeof setTimeout> }>()
let lastQuoteAt = -Infinity
/** When scripture-like talk began with nothing found since; null when there is none. */
let cueAt: number | null = null
let lastFoundAt = -Infinity
let lastAiAt = -Infinity
let aiBusy = false

/** Forgets the context and what was heard, for a new listening session (the tray keeps its cards). */
export function resetDetection(): void {
  context = emptyContext()
  finals = []
  partial = ''
  suggestedAt.clear()
  for (const p of pending.values()) clearTimeout(p.timer)
  pending.clear()
  lastQuoteAt = -Infinity
  cueAt = null
  lastFoundAt = -Infinity
  lastAiAt = -Infinity
  aiBusy = false
}

const settings = () => useOperatorStore.getState().settings
const clock = () => performance.now()
const elapsed = (from: number) => Math.round((clock() - from) * 10) / 10

/** The last `size` words of the final lines plus `text`; `before` is the part that was already read. */
function windowOf(text: string, size: number): { text: string; before: string } {
  const old = finals.flatMap((f) => f.text.split(/\s+/)).filter(Boolean)
  const fresh = text.split(/\s+/).filter(Boolean)
  const words = [...old, ...fresh].slice(-size)
  const freshCount = Math.min(fresh.length, words.length)
  return { text: words.join(' '), before: words.slice(0, words.length - freshCount).join(' ') }
}

/** References that end in the new words of the window (those in older words were dealt with when they arrived). */
function readWindow(w: { text: string; before: string }, at: number) {
  const result = readTranscript(w.text, context, at)
  const skip = w.before ? countTokens(w.before) : 0
  const found = result.references.filter((r) => r.end > skip && r.confidence >= settings().detectionMinConfidence)
  return { found, context: result.context }
}

const recentlySuggested = (label: string, at: number) => at - (suggestedAt.get(label) ?? -Infinity) < DUPLICATE_MS

/** Interim words: references go to the tray once stable; quotes are checked every 600 ms. */
export async function detectFromPartial(text: string, at = Date.now()): Promise<void> {
  partial = text
  if (!settings().scriptureDetection || !/\w/.test(text)) return
  const stages: DetectionStage[] = []
  const w = windowOf(text, WINDOW_WORDS)
  const started = clock()
  const { found } = readWindow(w, at)
  const present = new Set<string>()
  for (const reference of found) {
    if (!reference.complete) continue
    const label = formatReference(reference.reference)
    present.add(label)
    if (recentlySuggested(label, at) || pending.has(label)) continue
    pending.set(label, { found: reference, since: at, timer: setTimeout(() => void commitPending(label), STABLE_MS) })
  }
  // A reading that is gone from the words (the speaker went on, or the engine corrected itself) is not suggested.
  for (const [label, p] of pending) {
    if (!present.has(label)) {
      clearTimeout(p.timer)
      pending.delete(label)
    }
  }
  stages.push({ name: 'parser', ms: elapsed(started), result: describeFound(found, 'waiting 300 ms for') })
  if (found.length === 0 && at - lastQuoteAt >= QUOTE_INTERVAL_MS) {
    lastQuoteAt = at
    stages.push(await quoteStage(text, at))
  }
  recordRun('interim', w.text, stages, at)
  noteSpeech(text, at)
}

async function commitPending(label: string) {
  const p = pending.get(label)
  if (!p) return
  pending.delete(label)
  await suggestReference(p.found, p.since, 'parser (interim, stable 300 ms)')
}

/** Reads one final line of the transcript and adds what it finds to the tray. */
export async function detectScripture(line: string, heardAt = Date.now()): Promise<void> {
  partial = ''
  const enabled = settings().scriptureDetection
  const w = windowOf(line, WINDOW_WORDS)
  const started = clock()
  const { found, context: after } = enabled ? readWindow(w, heardAt) : { found: [], context }
  context = after
  finals = [...finals, { text: line, at: heardAt }].filter((f, i, all) => heardAt - f.at <= 60_000 || i >= all.length - 3)
  if (!enabled) return
  const stages: DetectionStage[] = [{ name: 'parser', ms: elapsed(started), result: describeFound(found, 'found') }]
  for (const reference of found) {
    const label = formatReference(reference.reference)
    // Heard when the words first showed up in interim results, if they did.
    const waiting = pending.get(label)
    if (waiting) {
      clearTimeout(waiting.timer)
      pending.delete(label)
    }
    await suggestReference(reference, waiting?.since ?? heardAt, 'parser (final)')
  }
  // Only look for a quote when nothing was named: a verse read right after its reference is already there.
  if (found.length === 0) stages.push(await quoteStage('', heardAt))
  recordRun('final', w.text, stages, heardAt)
  noteSpeech(line, heardAt)
}

function describeFound(found: SpokenReference[], verb: string): string {
  if (found.length === 0) return 'no reference'
  return `${verb} ${found
    .map((f) => `${formatReference(f.reference)} (${Math.round(f.confidence * 100)}%${f.fromContext ? ', from context' : ''}${f.complete ? '' : ', incomplete'})`)
    .join(', ')}`
}

/** Looks each reading up; the ones that exist, best first. */
async function lookUp(candidates: ReferenceCandidate[], version: BibleVersionCode): Promise<SuggestionOption[]> {
  const options = await Promise.all(
    candidates.map(async ({ reference, confidence }) => {
      const passage = await fetchPassage(reference, version)
      return passage ? { reference, label: formatReference(reference), passage, confidence } : null
    }),
  )
  return options.filter((o): o is SuggestionOption => o !== null)
}

const firstVerse = (passage: ScripturePayload) => passage.verses[0].text + (passage.verses.length > 1 ? ' …' : '')

async function suggestReference(found: SpokenReference, heardAt: number, stage: string) {
  const label = formatReference(found.reference)
  // Checked before the lookup so a repeated reference costs nothing.
  if (recentlySuggested(label, heardAt)) return
  suggestedAt.set(label, heardAt)
  // The tray shows the default translation's wording; a chapter or verse that does not exist finds nothing and is dropped.
  const version = selectDefaultTranslation(useOperatorStore.getState())
  const [top, ...alternatives] = await lookUp([found, ...found.alternatives], version)
  if (!top) return
  place({ ...top, text: firstVerse(top.passage), version, alternatives, heardAt, kind: 'reference', heard: found.heard }, stage)
}

/** Adds or updates a card, and notes it for the AI fallback and the debug view. */
function place(suggestion: Omit<ScriptureSuggestion, 'id' | 'type'>, stage: string) {
  lastFoundAt = Math.max(lastFoundAt, suggestion.heardAt)
  const outcome = useSuggestions.getState().add(suggestion)
  if (!outcome) return
  if (outcome === 'added') alertNewSuggestion()
  useDetectionDebug.setState({ card: { label: suggestion.label, stage, latencyMs: Math.max(0, Date.now() - suggestion.heardAt), at: Date.now() } })
}

/** The quote matcher over the last 25 words (finals plus `text`). */
async function quoteStage(text: string, at: number): Promise<DetectionStage> {
  const started = clock()
  const w = windowOf(text, QUOTE_WINDOW_WORDS)
  if (w.text.split(' ').length < 4) return { name: 'quote', ms: 0, result: 'skipped: fewer than 4 words' }
  const matches = (await window.api.bible.matchQuote(w.text)).filter((m) => m.confidence >= settings().detectionMinConfidence)
  const ms = elapsed(started)
  if (matches.length === 0) return { name: 'quote', ms, result: 'no quote' }
  const [best] = matches
  const reference = { book: best.book, chapter: best.chapter, verseStart: best.verse, verseEnd: best.verse }
  const label = formatReference(reference)
  const result = `matched ${matches.map((m) => `${m.book} ${m.chapter}:${m.verse} ${m.version} (${Math.round(m.confidence * 100)}%)`).join(', ')}`
  if (recentlySuggested(label, at)) {
    // Already on its way or shown; it still counts as found for the AI fallback.
    lastFoundAt = Math.max(lastFoundAt, at)
    return { name: 'quote', ms, result: `${result}; already suggested` }
  }
  suggestedAt.set(label, at)
  const options = await Promise.all(
    matches.map(async (m): Promise<SuggestionOption | null> => {
      const ref: ScriptureReference = { book: m.book, chapter: m.chapter, verseStart: m.verse, verseEnd: m.verse }
      const passage = await fetchPassage(ref, m.version)
      return passage ? { reference: ref, label: formatReference(ref), passage, confidence: m.confidence } : null
    }),
  )
  const [top, ...alternatives] = options.filter((o): o is SuggestionOption => o !== null)
  if (top) {
    place(
      { ...top, text: firstVerse(top.passage), version: best.version, highlight: best.highlight, alternatives, heardAt: at, kind: 'quote', heard: w.text },
      'quote matcher',
    )
  }
  return { name: 'quote', ms, result }
}

/** Notes scripture-like talk; when it has gone 8 seconds with nothing found, asks the AI (if turned on). */
function noteSpeech(text: string, at: number) {
  const { aiEnabled, aiScriptureFallback } = settings()
  if (!aiEnabled || !aiScriptureFallback) {
    cueAt = null
    return
  }
  if (cueAt !== null && lastFoundAt >= cueAt) cueAt = null
  if (cueAt === null && SCRIPTURE_CUES.test(text) && lastFoundAt < at) cueAt = at
  if (cueAt !== null && at - cueAt >= AI_AFTER_MS && at - lastAiAt >= AI_INTERVAL_MS && !aiBusy) void askAi(at)
}

async function askAi(at: number) {
  lastAiAt = at
  cueAt = null
  aiBusy = true
  const transcript = [...finals.filter((f) => at - f.at <= AI_TRANSCRIPT_MS).map((f) => f.text), partial].join(' ').trim()
  const started = clock()
  let result: string
  try {
    const answer = await window.api.ai.ask('findScriptureReferences', { transcript })
    if (!answer.ok) result = `failed: ${answer.error.message}`
    else {
      const references = answer.value.references.flatMap((r) => {
        const reference = parseReference(r)
        return reference ? [{ reference, confidence: AI_CONFIDENCE }] : []
      })
      result = references.length > 0 ? `suggested ${references.map((r) => formatReference(r.reference)).join(', ')}` : 'nothing found'
      // Checked against the Bible again here; the main process already dropped passages that do not exist.
      const version = selectDefaultTranslation(useOperatorStore.getState())
      const [top, ...alternatives] = await lookUp(references, version)
      if (top && !recentlySuggested(top.label, at)) {
        suggestedAt.set(top.label, at)
        place({ ...top, text: firstVerse(top.passage), version, alternatives, heardAt: at, kind: 'ai', heard: transcript }, 'AI fallback')
      }
    }
  } catch (error) {
    result = `failed: ${error instanceof Error ? error.message : String(error)}`
  } finally {
    aiBusy = false
  }
  useDetectionDebug.setState((s) => ({
    run: { at, source: 'final', segment: transcript, stages: [...(s.run?.stages ?? []), { name: 'ai', ms: elapsed(started), result }] },
  }))
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

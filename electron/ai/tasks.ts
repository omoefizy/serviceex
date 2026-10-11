// AI tasks. The renderer sends a task name and its input; the prompts, output schemas and checks live here,
// so the renderer cannot steer the model with its own instructions.

import { findSection, parseLyrics } from '../../shared/lyrics'
import { formatReference, parseReference } from '../../shared/parseReference'
import { MAX_STATEMENT_WORDS, verbatimStatements } from '../../shared/statements'
import type { AiModel, AiResult, AiTask, AiTasks } from '../../shared/types'
import { getVerse, listBooks } from '../db/bible'
import { getAppSettings } from '../db/settings'
import { fail, readyClient, toAiError } from './client'

/** Longest input accepted per text field; well past a long song or a full bulletin. */
const MAX_INPUT_CHARS = 20_000

/** A check failure the operator should see as is. */
class TaskError extends Error {}

interface TaskDefinition<T extends AiTask> {
  system: string
  /** Checks the input from the renderer. Throws on bad input. */
  parseInput(input: unknown): AiTasks[T]['input']
  prompt(input: AiTasks[T]['input']): string
  /** JSON schema for structured output, so the reply always parses into the task's output shape. */
  schema: Record<string, unknown>
  maxTokens: number
  effort: 'low' | 'medium'
  /** A fixed model for this task; otherwise the one chosen in Settings. */
  model?: AiModel
  /** Checks the parsed reply against the input. Throws TaskError with a message for the operator. */
  check(output: unknown, input: AiTasks[T]['input']): AiTasks[T]['output']
}

function textField(input: unknown, field: string): string {
  const value = (input as Record<string, unknown> | null)?.[field]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${field}`)
  if (value.length > MAX_INPUT_CHARS) throw new Error(`${field} is longer than ${MAX_INPUT_CHARS} characters`)
  return value.trim()
}

const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})

// ---------- Wording guard ----------

/** Lowercase words without punctuation, so "Grace," and "grace" match and curly quotes equal straight ones. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .split(/[\s\-–—/]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}']+/gu, '').replace(/^'+|'+$/g, ''))
    .filter(Boolean)
}

/**
 * Words in the cleaned lyrics that the original does not have (enough of). Dropping words is allowed (chords,
 * page numbers, website text, repeated choruses); adding or changing one is not. Section label lines are skipped.
 */
function addedWords(original: string, cleaned: string): string[] {
  const available = new Map<string, number>()
  for (const word of words(original)) available.set(word, (available.get(word) ?? 0) + 1)
  const added: string[] = []
  for (const line of cleaned.split('\n')) {
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) continue
    for (const word of words(line)) {
      const left = available.get(word) ?? 0
      if (left > 0) available.set(word, left - 1)
      else added.push(word)
    }
  }
  return added
}

// ---------- Fact guard ----------

/**
 * Month and weekday names, plus abbreviations that are not also everyday words ("sat", "sun", "wed", "mar" and
 * "may" are left out for that reason; dates with them still carry numbers, which are checked).
 */
const DATE_WORDS: Record<string, string> = {}
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
for (const name of [...MONTH_NAMES.filter((m) => m !== 'may'), ...DAY_NAMES]) DATE_WORDS[name] = name
for (const [abbreviation, name] of Object.entries({
  jan: 'january', feb: 'february', apr: 'april', jun: 'june', jul: 'july', aug: 'august', sep: 'september',
  sept: 'september', oct: 'october', nov: 'november', dec: 'december', mon: 'monday', tue: 'tuesday',
  tues: 'tuesday', thu: 'thursday', thur: 'thursday', thurs: 'thursday', fri: 'friday',
})) DATE_WORDS[abbreviation] = name

/** "Saturday" and "Sat." name the same day, so date words compare by their full name. */
const dateWordsIn = (text: string) => words(text).flatMap((word) => (DATE_WORDS[word] ? [DATE_WORDS[word]] : []))

/**
 * Details in the slides that the pasted message does not contain: numbers (dates, times, prices, phone
 * numbers), month and weekday names, email addresses and links, and (when `names` is set) capitalised words
 * after the start of a sentence, which are usually names and places. Rewording is allowed; new facts are not.
 */
function inventedFacts(message: string, texts: string[], names: boolean): string[] {
  const lower = message.toLowerCase()
  const numbers = new Set(message.match(/\d+/g) ?? [])
  const dates = new Set(dateWordsIn(message))
  const messageWords = new Set(words(message))
  const invented: string[] = []

  for (const text of texts) {
    for (const number of text.match(/\d+/g) ?? []) if (!numbers.has(number)) invented.push(number)
    for (const date of dateWordsIn(text)) if (!dates.has(date)) invented.push(date)
    for (const contact of text.match(/[\w.+-]+@[\w-]+\.[\w.-]+|(?:https?:\/\/|www\.)\S+/gi) ?? []) {
      if (!lower.includes(contact.toLowerCase().replace(/[.,;:!?)]+$/, ''))) invented.push(contact)
    }
    if (!names) continue
    // Capitalised words after the start of a sentence: "Ask Pastor Sam" flags "Pastor" and "Sam" unless the
    // message mentions them. "I" is always fine.
    for (const sentence of text.split(/(?<=[.!?:])\s+|\n+/)) {
      for (const word of sentence.split(/\s+/).slice(1)) {
        const [key] = words(word)
        if (key && key !== 'i' && /^[^\p{L}]*\p{Lu}/u.test(word) && !messageWords.has(key) && !DATE_WORDS[key]) {
          invented.push(word.replace(/^[^\p{L}]+|[^\p{L}\p{N}]+$/gu, ''))
        }
      }
    }
  }
  return [...new Set(invented)]
}

// ---------- Reference check ----------

/** How the AI is asked to write references, so the app's parser and database can check them. */
const REFERENCE_FORMAT =
  'Write each reference as book, chapter and verses, such as "John 3:16-18", "Psalm 46:1" or "Romans 8:28-39", ' +
  'using English book names. Keep each reference within one chapter. Never quote or paraphrase verse text.'

/**
 * The references that parse and exist in the Bible database (first and last verse, in the KJV), written the
 * app's way ("John 3:16-18") without repeats. Anything else is dropped.
 */
function existingReferences(references: unknown): string[] {
  if (listBooks().length === 0) {
    throw new TaskError('The Bible text is not imported yet. Run "npm run import:bible", then try again.')
  }
  const seen = new Set<string>()
  const kept: string[] = []
  for (const reference of Array.isArray(references) ? references : []) {
    const ref = typeof reference === 'string' ? parseReference(reference) : null
    if (!ref) continue
    const first = ref.verseStart ?? 1
    const last = ref.verseEnd ?? first
    if (!getVerse('KJV', ref.book, ref.chapter, first) || !getVerse('KJV', ref.book, ref.chapter, last)) continue
    const formatted = formatReference(ref)
    if (!seen.has(formatted)) {
      seen.add(formatted)
      kept.push(formatted)
    }
  }
  return kept
}

// ---------- Tasks ----------

const TASKS: { [T in AiTask]: TaskDefinition<T> } = {
  cleanLyrics: {
    system: [
      'You clean up song lyrics that were pasted from websites, PDFs or chord sheets, for a church presentation app.',
      '',
      'Never change the wording. Keep every sung word exactly as written, with its spelling. Do not add, reword,',
      'translate, correct or reorder words within a line. When in doubt, keep the original.',
      '',
      'Remove everything that is not sung: chord symbols and chord lines, page numbers, headers and footers,',
      'song titles and artist lines, copyright and CCLI lines, website text, ads and navigation, and performance',
      'notes such as "x2", "(repeat)" or "Chorus 2x".',
      '',
      'Put each section under a label line in square brackets: [Verse 1], [Verse 2], [Pre-Chorus], [Chorus],',
      '[Bridge], [Tag], [Intro] or [Outro]. Number a kind only when there are several with different words.',
      '',
      'Write each section once. When a chorus or any other section is sung again with the same words, do not',
      'write it again; record each time it is sung in "order" instead.',
      '',
      'Within a section, put a blank line between slides, two to four lines per slide. Break overlong lines at a',
      'natural phrase and join fragments that belong on one line.',
      '',
      '"order" lists the section labels in the order they are sung, repeats included, for example',
      '["Verse 1", "Chorus", "Verse 2", "Chorus", "Bridge", "Chorus"]. Each entry must match a label in the lyrics.',
    ].join('\n'),
    parseInput: (input) => ({ lyrics: textField(input, 'lyrics') }),
    prompt: ({ lyrics }) => `Clean up these lyrics:\n\n${lyrics}`,
    schema: object({ lyrics: { type: 'string' }, order: { type: 'array', items: { type: 'string' } } }),
    maxTokens: 8000,
    // Keeping every word while restructuring is fiddly enough to deserve a little more thought.
    effort: 'medium',
    check: (output, input) => {
      const { lyrics, order } = output as { lyrics?: unknown; order?: unknown }
      if (typeof lyrics !== 'string' || !lyrics.trim()) throw new TaskError('The AI returned no lyrics. Try again.')
      const cleaned = lyrics.replace(/\r\n?/g, '\n').trim()
      const added = addedWords(input.lyrics, cleaned)
      if (added.length > 0) {
        const sample = [...new Set(added)].slice(0, 5).map((w) => `“${w}”`).join(', ')
        throw new TaskError(`The AI changed the wording (${sample}), so its version was not used. Try again.`)
      }
      // Keep only order entries that name a section in the cleaned lyrics.
      const sections = parseLyrics(cleaned)
      const playOrder = Array.isArray(order)
        ? order.filter((label): label is string => typeof label === 'string' && !!findSection(sections, label))
        : []
      return { lyrics: cleaned, order: playOrder }
    },
  },

  suggestScripture: {
    system: [
      'You help a church team find Bible passages by meaning. Given a topic, choose the ten passages that speak to it',
      'most directly, from both Testaments where it fits, most relevant first. Prefer short passages of one to six',
      'verses. Return references only.',
      '',
      REFERENCE_FORMAT,
    ].join('\n'),
    parseInput: (input) => ({ topic: textField(input, 'topic') }),
    prompt: ({ topic }) => `Topic: ${topic}`,
    schema: object({ references: { type: 'array', items: { type: 'string' } } }),
    maxTokens: 1000,
    effort: 'low',
    // Ten are asked for so that eight usually survive the database check.
    check: (output) => {
      const references = existingReferences((output as { references?: unknown }).references).slice(0, 8)
      if (references.length === 0) throw new TaskError('No passages for that topic were found in the Bible text. Try other words.')
      return { references }
    },
  },

  sermonToSlides: {
    system: [
      'You turn a sermon outline into presentation material for a church service.',
      '',
      'Write a short title (at most six words) and the key points: three to eight points, each at most twelve words,',
      'in the order of the outline, written so a congregation can read them on a screen. Keep the preacher\'s',
      'meaning; do not add points, numbers, dates or names that are not in the outline.',
      '',
      'List every Bible reference the outline mentions, in the order it mentions them, including ones written',
      'loosely such as "John 3 verse 16" or "Ps 23". Only references the outline mentions; do not add others.',
      '',
      REFERENCE_FORMAT,
    ].join('\n'),
    parseInput: (input) => ({ outline: textField(input, 'outline') }),
    prompt: ({ outline }) => `Sermon outline:\n\n${outline}`,
    schema: object({
      title: { type: 'string' },
      points: { type: 'array', items: { type: 'string' } },
      references: { type: 'array', items: { type: 'string' } },
    }),
    maxTokens: 3000,
    effort: 'low',
    check: (output, input) => {
      const { title, points, references } = output as { title?: unknown; points?: unknown; references?: unknown }
      const keptPoints = Array.isArray(points)
        ? points.filter((p): p is string => typeof p === 'string').map((p) => p.trim()).filter(Boolean)
        : []
      if (typeof title !== 'string' || !title.trim() || keptPoints.length === 0) {
        throw new TaskError('The AI returned no key points. Try again.')
      }
      // Points may reword the outline but must not bring new numbers, dates or links.
      const invented = inventedFacts(input.outline, [title, ...keptPoints], false)
      if (invented.length > 0) {
        const sample = invented.slice(0, 5).map((w) => `“${w}”`).join(', ')
        throw new TaskError(`The AI added details that are not in the outline (${sample}), so its points were not used. Try again.`)
      }
      // A reference whose chapter or verse numbers are not in the outline was not mentioned there.
      const mentioned = existingReferences(references).filter((reference) => inventedFacts(input.outline, [reference], false).length === 0)
      return { title: title.trim(), points: keptPoints, references: mentioned }
    },
  },

  buildAnnouncement: {
    system: [
      'You turn a church announcement message into presentation slides that people read from across a room.',
      '',
      'Write a title of at most six words. Then split the message into slides with one idea each: what is happening,',
      'when and where, who it is for, how to sign up or give, who to contact. Each slide is at most three short',
      'lines, about 25 words. Leave out greetings, filler and repetition.',
      '',
      'Keep every date, time, place, price, name, link and contact detail exactly as written. Never invent details',
      'that are not in the message. Do not repeat the title as the first slide; the app adds a title slide itself.',
    ].join('\n'),
    parseInput: (input) => ({ message: textField(input, 'message') }),
    prompt: ({ message }) => `Message:\n\n${message}`,
    schema: object({ title: { type: 'string' }, slides: { type: 'array', items: { type: 'string' } } }),
    maxTokens: 3000,
    effort: 'low',
    check: (output, input) => {
      const { title, slides } = output as { title?: unknown; slides?: unknown }
      const kept = Array.isArray(slides)
        ? slides.filter((s): s is string => typeof s === 'string').map((s) => s.trim()).filter(Boolean)
        : []
      if (typeof title !== 'string' || !title.trim() || kept.length === 0) {
        throw new TaskError('The AI returned no slides. Try again.')
      }
      // Titles are usually in Title Case, so only the slides get the name check.
      const invented = [...inventedFacts(input.message, [title], false), ...inventedFacts(input.message, kept, true)]
      if (invented.length > 0) {
        const sample = [...new Set(invented)].slice(0, 5).map((w) => `“${w}”`).join(', ')
        throw new TaskError(`The AI added details that are not in your message (${sample}), so its slides were not used. Try again.`)
      }
      return { title: title.trim(), slides: kept }
    },
  },

  pickStatements: {
    system: [
      'You pick quotable lines from a live sermon transcript for a church presentation app. The transcript comes from',
      'speech recognition, a few sentences at a time.',
      '',
      `Choose at most two short statements, each under ${MAX_STATEMENT_WORDS} words, that stand on their own as a memorable line`,
      'a congregation could read on a screen without the sentences around them. Skip greetings, instructions such as',
      '"turn to" or "please stand", and lines that only make sense in context. When nothing qualifies, return an empty list.',
      '',
      'Copy each statement exactly as it appears in the transcript: one continuous run of words from one place, in the',
      'same order. Never add, remove, reword, correct or merge words, and never join parts from different places. Any',
      'statement that is not in the transcript word for word is thrown away.',
    ].join('\n'),
    parseInput: (input) => {
      if (!getAppSettings().statementPicking) throw new Error('Statement suggestions are turned off in Settings.')
      return { transcript: textField(input, 'transcript') }
    },
    prompt: ({ transcript }) => `Transcript:\n\n${transcript}`,
    schema: object({ statements: { type: 'array', items: { type: 'string' } } }),
    // Room for Haiku's thinking as well as the short answer.
    maxTokens: 2000,
    effort: 'low',
    model: 'claude-haiku-5-5',
    // Only words the speaker said, in their wording; nothing found is a normal answer.
    check: (output, input) => ({ statements: verbatimStatements((output as { statements?: unknown }).statements, input.transcript) }),
  },

  findScriptureReferences: {
    system: [
      'You help a church presentation app follow a live sermon. The transcript comes from speech recognition and may',
      'mishear words. Name the Bible passages the speaker is quoting, paraphrasing or clearly pointing to in it, at most',
      'three, most likely first. Only passages the words themselves point to; when there are none, return an empty list.',
      '',
      REFERENCE_FORMAT,
    ].join('\n'),
    parseInput: (input) => {
      if (!getAppSettings().aiScriptureFallback) throw new Error('AI scripture suggestions are turned off in Settings.')
      return { transcript: textField(input, 'transcript') }
    },
    prompt: ({ transcript }) => `Transcript:\n\n${transcript}`,
    schema: object({ references: { type: 'array', items: { type: 'string' } } }),
    // Room for Haiku's thinking as well as the short answer.
    maxTokens: 2000,
    effort: 'low',
    model: 'claude-haiku-5-5',
    // Only passages that exist in the Bible database; finding none is a normal answer.
    check: (output) => ({ references: existingReferences((output as { references?: unknown }).references).slice(0, 3) }),
  },
}

export const isAiTask = (value: unknown): value is AiTask => typeof value === 'string' && value in TASKS

/** Server-side refusal fallback: Sonnet 5.5 supports the "default" form; Haiku 5.5 has no fallback. */
function fallbackOptions(model: AiModel) {
  return model === 'claude-sonnet-5-5'
    ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
    : {}
}

export async function runTask<T extends AiTask>(task: T, input: unknown): Promise<AiResult<AiTasks[T]['output']>> {
  const definition = TASKS[task] as TaskDefinition<T>
  let parsed: AiTasks[T]['input']
  try {
    parsed = definition.parseInput(input)
  } catch (error) {
    return fail('bad_request', error instanceof Error ? error.message : 'Invalid input')
  }

  const ready = await readyClient()
  if (!ready.ok) return ready
  const model = definition.model ?? getAppSettings().aiModel

  let response
  try {
    response = await ready.value.beta.messages.create({
      model,
      max_tokens: definition.maxTokens,
      ...fallbackOptions(model),
      system: definition.system,
      output_config: { effort: definition.effort, format: { type: 'json_schema', schema: definition.schema } },
      messages: [{ role: 'user', content: definition.prompt(parsed) }],
    })
  } catch (error) {
    return toAiError(error)
  }

  if (response.stop_reason === 'refusal') {
    return fail('refused', 'The AI declined this request. Try rewording it.')
  }
  if (response.stop_reason === 'max_tokens') {
    return fail('bad_request', 'The answer was too long to finish. Try a shorter input.')
  }
  const text = response.content.find((block) => block.type === 'text')
  if (!text || text.type !== 'text') return fail('bad_request', 'The AI returned no answer.')
  try {
    return { ok: true, value: definition.check(JSON.parse(text.text), parsed) }
  } catch (error) {
    return fail('bad_request', error instanceof TaskError ? error.message : 'The AI answer could not be used. Try again.')
  }
}

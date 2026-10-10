// AI tasks. The renderer sends a task name and its input; the prompts, output schemas and checks live here,
// so the renderer cannot steer the model with its own instructions.

import { findSection, parseLyrics } from '../../shared/lyrics'
import type { AiModel, AiResult, AiTask, AiTasks } from '../../shared/types'
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
    system:
      'You help a church team choose Bible readings. Suggest three to six passages that fit the theme, from both ' +
      'Testaments where it fits. Give each reference in a standard form such as "John 3:16-18" or "Psalm 23" ' +
      '(book, chapter, and optionally verses) and a one-sentence reason it fits. Do not quote the verse text.',
    parseInput: (input) => ({ theme: textField(input, 'theme') }),
    prompt: ({ theme }) => `Theme: ${theme}`,
    schema: object({
      suggestions: { type: 'array', items: object({ reference: { type: 'string' }, reason: { type: 'string' } }) },
    }),
    maxTokens: 2000,
    effort: 'low',
    check: (output) => {
      const suggestions = (output as { suggestions?: unknown }).suggestions
      if (!Array.isArray(suggestions)) throw new TaskError('The AI returned no suggestions. Try again.')
      return {
        suggestions: suggestions
          .filter((s): s is { reference: string; reason: string } => typeof s?.reference === 'string' && typeof s?.reason === 'string')
          .slice(0, 6),
      }
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
    check: (output) => {
      const { title, slides } = output as { title?: unknown; slides?: unknown }
      const kept = Array.isArray(slides)
        ? slides.filter((s): s is string => typeof s === 'string').map((s) => s.trim()).filter(Boolean)
        : []
      if (typeof title !== 'string' || !title.trim() || kept.length === 0) {
        throw new TaskError('The AI returned no slides. Try again.')
      }
      return { title: title.trim(), slides: kept }
    },
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
  const model = getAppSettings().aiModel

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

// AI tasks. The renderer sends a task name and its input; the prompts, output schemas and checks live here,
// so the renderer cannot steer the model with its own instructions.

import type { AiModel, AiResult, AiTask, AiTasks } from '../../shared/types'
import { getAppSettings } from '../db/settings'
import { fail, readyClient, toAiError } from './client'

/** Longest input accepted per text field; well past a long song or sermon outline. */
const MAX_INPUT_CHARS = 20_000

interface TaskDefinition<T extends AiTask> {
  system: string
  /** Checks the input from the renderer and builds the user message. Throws on bad input. */
  prompt(input: unknown): string
  /** JSON schema for structured output, so the reply always parses into the task's output shape. */
  schema: Record<string, unknown>
  maxTokens: number
  /** Checks the parsed reply; structured output guarantees the shape, this guards the content. */
  check(output: unknown): AiTasks[T]['output']
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

const TASKS: { [T in AiTask]: TaskDefinition<T> } = {
  formatLyrics: {
    system:
      'You format worship song lyrics for a church presentation app. Put each section under a label line such as ' +
      '[Verse 1], [Pre-Chorus], [Chorus], [Bridge] or [Tag]. Within a section, put a blank line between slides, ' +
      'keeping two to four lines per slide. Keep every word of the lyrics exactly as given: do not rewrite, ' +
      'translate, add or drop lines. Remove chord symbols, section numbers written as text, and stray notes ' +
      'such as "x2" or "repeat". Return only the formatted lyrics.',
    prompt: (input) => `Format these lyrics:\n\n${textField(input, 'lyrics')}`,
    schema: object({ lyrics: { type: 'string' } }),
    maxTokens: 8000,
    check: (output) => {
      const lyrics = (output as { lyrics?: unknown }).lyrics
      if (typeof lyrics !== 'string' || !lyrics.trim()) throw new Error('No lyrics came back')
      return { lyrics: lyrics.trim() }
    },
  },

  suggestScripture: {
    system:
      'You help a church team choose Bible readings. Suggest three to six passages that fit the theme, from both ' +
      'Testaments where it fits. Give each reference in a standard form such as "John 3:16-18" or "Psalm 23" ' +
      '(book, chapter, and optionally verses) and a one-sentence reason it fits. Do not quote the verse text.',
    prompt: (input) => `Theme: ${textField(input, 'theme')}`,
    schema: object({
      suggestions: { type: 'array', items: object({ reference: { type: 'string' }, reason: { type: 'string' } }) },
    }),
    maxTokens: 2000,
    check: (output) => {
      const suggestions = (output as { suggestions?: unknown }).suggestions
      if (!Array.isArray(suggestions)) throw new Error('No suggestions came back')
      return {
        suggestions: suggestions
          .filter((s): s is { reference: string; reason: string } => typeof s?.reference === 'string' && typeof s?.reason === 'string')
          .slice(0, 6),
      }
    },
  },

  writeAnnouncement: {
    system:
      'You write church announcement slides. From the notes, write a short title (at most six words) and slide ' +
      'text: one to three short paragraphs separated by a blank line, each readable from the back of a room. ' +
      'Keep every date, time, place and contact from the notes exactly; do not invent details.',
    prompt: (input) => `Notes:\n\n${textField(input, 'notes')}`,
    schema: object({ title: { type: 'string' }, body: { type: 'string' } }),
    maxTokens: 2000,
    check: (output) => {
      const { title, body } = output as { title?: unknown; body?: unknown }
      if (typeof title !== 'string' || !title.trim() || typeof body !== 'string') throw new Error('No announcement came back')
      return { title: title.trim(), body: body.trim() }
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
  let prompt: string
  try {
    prompt = definition.prompt(input)
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
      // These are short, well-specified jobs, so low effort keeps them quick and cheap.
      output_config: { effort: 'low', format: { type: 'json_schema', schema: definition.schema } },
      messages: [{ role: 'user', content: prompt }],
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
    return { ok: true, value: definition.check(JSON.parse(text.text)) }
  } catch {
    return fail('bad_request', 'The AI answer could not be used. Try again.')
  }
}

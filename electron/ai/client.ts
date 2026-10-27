// The Anthropic client, main process only. The API key is stored encrypted by ../secrets (safeStorage) as
// <userData>/anthropic-key.enc; it is never sent to the renderer, never read from the environment or a plain
// file, and never lives in the repository. Which key is used comes from the provider chosen in Settings (see ../keys);
// outside developer builds that is the ServiceEx account, which is not connected yet, so there is no client.

import Anthropic from '@anthropic-ai/sdk'
import { net } from 'electron'
import type { AiError, AiResult, KeyProvider } from '../../shared/types'
import { getAppSettings } from '../db/settings'
import { keyProvider, missingKeyMessage, readProviderKey } from '../keys'
import { clearSecret, encryptionAvailable, hasSecret, saveSecret } from '../secrets'

export { encryptionAvailable }

/** Cached so requests do not decrypt the key each time; dropped whenever the key or its provider changes. */
let client: Anthropic | null = null
let clientProvider: KeyProvider = 'developer_key'

export function hasApiKey(): boolean {
  return hasSecret('anthropic-key')
}

export async function saveApiKey(key: string): Promise<void> {
  await saveSecret('anthropic-key', key)
  client = null
}

export async function clearApiKey(): Promise<void> {
  await clearSecret('anthropic-key')
  client = null
}

/** The client for the key from the chosen provider, or null when there is none (or it can no longer be decrypted). */
export async function getClient(): Promise<Anthropic | null> {
  const provider = keyProvider('anthropic')
  if (client && clientProvider === provider) return client
  client = null
  const apiKey = await readProviderKey('anthropic')
  if (!apiKey) return null
  clientProvider = provider
  // Pass the key explicitly and switch off the environment fallbacks, so only the saved key is ever used.
  client = new Anthropic({ apiKey, authToken: null, maxRetries: 2, timeout: 60_000 })
  return client
}

export const fail = (code: AiError['code'], message: string, extra: Partial<AiError> = {}): { ok: false; error: AiError } => ({
  ok: false,
  error: { code, message, ...extra },
})

/** Checks AI is on, a key is saved and the machine is online; resolves to the client when ready. */
export async function readyClient(): Promise<AiResult<Anthropic>> {
  if (!getAppSettings().aiEnabled) return fail('disabled', 'AI features are turned off in Settings.')
  if (keyProvider('anthropic') === 'service') return fail('no_key', missingKeyMessage('anthropic'))
  if (!encryptionAvailable()) return fail('no_encryption', 'This system cannot store the API key securely.')
  const ready = await getClient()
  if (!ready) return fail('no_key', missingKeyMessage('anthropic'))
  if (!net.isOnline()) return fail('offline', 'No internet connection. AI features need to reach Anthropic.')
  return { ok: true, value: ready }
}

/** The reason Anthropic gave in an error reply, such as "prompt is too long: 210000 tokens > 200000 maximum". */
function apiReason(error: InstanceType<typeof Anthropic.APIError>): string {
  const body = error.error as { error?: { message?: unknown } } | undefined
  const reason = typeof body?.error?.message === 'string' ? body.error.message : ''
  return reason.trim().replace(/[.\s]+$/, '')
}

/** Turns an SDK error into a message for the operator; most specific classes first. The details go to the log. */
export function toAiError(error: unknown): { ok: false; error: AiError } {
  if (error instanceof Anthropic.APIError) {
    // The status, request id and Anthropic's reason; never the request itself, which holds the transcript.
    console.error('AI request failed', { status: error.status, requestId: error.requestID, name: error.name, reason: apiReason(error) || error.message })
  } else {
    console.error('AI request failed', error)
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return fail('invalid_key', 'Anthropic rejected the API key. Check it in Settings.')
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return fail('invalid_key', 'This API key is not allowed to use that model.')
  }
  if (error instanceof Anthropic.NotFoundError) {
    return fail('invalid_key', 'The chosen model is not available to this API key.')
  }
  if (error instanceof Anthropic.RateLimitError) {
    const retryAfter = Number(error.headers?.get('retry-after'))
    return fail(
      'rate_limited',
      Number.isFinite(retryAfter) && retryAfter > 0
        ? `Too many AI requests. Try again in ${Math.ceil(retryAfter)} second${Math.ceil(retryAfter) === 1 ? '' : 's'}.`
        : 'Too many AI requests. Wait a moment and try again.',
      Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: Math.ceil(retryAfter) } : {},
    )
  }
  if (error instanceof Anthropic.BadRequestError) {
    const reason = apiReason(error)
    if (/too long|too many tokens|context (window|length)|maximum/i.test(reason)) {
      return fail('bad_request', `The text sent to Anthropic was too long for one request (${reason}).`)
    }
    return fail('bad_request', reason ? `Anthropic could not process that request: ${reason}.` : 'Anthropic could not process that request.')
  }
  if (error instanceof Anthropic.APIError && error.status === 413) {
    return fail('bad_request', 'The text sent to Anthropic was too long for one request.')
  }
  if (error instanceof Anthropic.InternalServerError) {
    return fail('unavailable', 'Anthropic is busy or having trouble right now. Try again shortly.')
  }
  // Connection errors extend APIError, so they are checked before the generic status case.
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return fail('offline', 'Anthropic took too long to answer. Check the internet connection and try again.')
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return fail('offline', 'Could not reach Anthropic. Check the internet connection.')
  }
  if (error instanceof Anthropic.APIError) {
    if (error.status === 402) return fail('billing', 'The Anthropic account has a billing problem.')
    const reason = apiReason(error)
    return fail('unavailable', `Anthropic returned an error (${error.status ?? 'unknown'}${reason ? `: ${reason}` : ''}). Try again shortly.`)
  }
  return fail('unavailable', `The AI request failed unexpectedly${error instanceof Error && error.message ? `: ${error.message}` : ''}.`)
}

/** A free check that the key works and can use the chosen model: looks the model up without generating anything. */
export async function testConnection(): Promise<AiResult<{ model: string }>> {
  const ready = await readyClient()
  if (!ready.ok) return ready
  try {
    const model = await ready.value.models.retrieve(getAppSettings().aiModel)
    return { ok: true, value: { model: model.display_name } }
  } catch (error) {
    return toAiError(error)
  }
}

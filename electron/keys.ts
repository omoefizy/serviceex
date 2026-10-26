// Where the AI features and the speech engines get their keys, chosen in Settings. "own" is the operator's key, saved
// encrypted by ./secrets. "plan" is a key included in the plan; that is not available yet, so it gives no key.

import type { KeyProvider } from '../shared/types'
import { getAppSettings } from './db/settings'
import { hasSecret, readSecret, type SecretName } from './secrets'

export type KeyService = 'anthropic' | 'deepgram'

const SECRETS: Record<KeyService, SecretName> = { anthropic: 'anthropic-key', deepgram: 'deepgram-key' }

export function keyProvider(service: KeyService): KeyProvider {
  const settings = getAppSettings()
  return service === 'anthropic' ? settings.aiKeyProvider : settings.speechKeyProvider
}

/** Whether the chosen provider has a key to use. */
export function hasProviderKey(service: KeyService): boolean {
  return keyProvider(service) === 'own' && hasSecret(SECRETS[service])
}

/** The key from the chosen provider, or null when it has none. */
export async function readProviderKey(service: KeyService): Promise<string | null> {
  return keyProvider(service) === 'own' ? readSecret(SECRETS[service]) : null
}

/** Why there is no key, for the operator. */
export function missingKeyMessage(service: KeyService): string {
  if (keyProvider(service) === 'plan') return 'Keys included in a plan are not available yet. Choose "Use my own key" in Settings.'
  return service === 'anthropic' ? 'Add an Anthropic API key in Settings to use AI features.' : 'Add a Deepgram API key in Settings first.'
}

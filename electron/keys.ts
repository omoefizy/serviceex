// Where the AI features and the speech engines get their keys. "developer_key" is a key saved encrypted by ./secrets,
// and is offered only in developer builds (see developerMode). "service" is access through the ServiceEx account; that
// is not connected yet, so it gives no key. Outside developer builds the provider is always "service".

import { app } from 'electron'
import { AI_NOT_CONNECTED, CLOUD_NOT_CONNECTED, type KeyProvider } from '../shared/features'
import { getAppSettings } from './db/settings'
import { hasSecret, readSecret, type SecretName } from './secrets'

export type KeyService = 'anthropic' | 'deepgram'

const SECRETS: Record<KeyService, SecretName> = { anthropic: 'anthropic-key', deepgram: 'deepgram-key' }

/** A developer build: SERVICEEX_DEV=1, or running unpackaged. Only here can keys be saved, shown in Settings and used. */
export function developerMode(): boolean {
  return process.env.SERVICEEX_DEV === '1' || !app.isPackaged
}

export function keyProvider(service: KeyService): KeyProvider {
  if (!developerMode()) return 'service'
  const settings = getAppSettings()
  return service === 'anthropic' ? settings.aiKeyProvider : settings.speechKeyProvider
}

/** Whether the chosen provider has a key to use. */
export function hasProviderKey(service: KeyService): boolean {
  return keyProvider(service) === 'developer_key' && hasSecret(SECRETS[service])
}

/** The key from the chosen provider, or null when it has none. */
export async function readProviderKey(service: KeyService): Promise<string | null> {
  return keyProvider(service) === 'developer_key' ? readSecret(SECRETS[service]) : null
}

/** Why there is no key, for the operator. */
export function missingKeyMessage(service: KeyService): string {
  if (keyProvider(service) === 'service') return service === 'anthropic' ? AI_NOT_CONNECTED : CLOUD_NOT_CONNECTED
  return service === 'anthropic' ? 'Add an Anthropic API key in Settings to use AI features.' : 'Add a Deepgram API key in Settings first.'
}

/** For the key handlers: keys can only be saved, removed or tested in a developer build. */
export const DEVELOPER_ONLY = 'API keys can only be used in a developer build.'

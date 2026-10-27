import { ipcMain } from 'electron'
import type { AiResult, AiStatus } from '../../shared/types'
import { clearApiKey, encryptionAvailable, fail, hasApiKey, saveApiKey, testConnection } from '../ai/client'
import { isAiTask, runTask } from '../ai/tasks'
import { getAppSettings } from '../db/settings'
import { DEVELOPER_ONLY, developerMode } from '../keys'

function status(): AiStatus {
  const { aiEnabled, aiModel } = getAppSettings()
  return { enabled: aiEnabled, model: aiModel, hasKey: hasApiKey(), encryptionAvailable: encryptionAvailable(), developerMode: developerMode() }
}

/** Every handler returns plain data; nothing here ever sends the key back to the renderer. */
export function registerAiIpc(): void {
  ipcMain.handle('ai:status', () => status())

  ipcMain.handle('ai:setKey', async (_event, key: unknown): Promise<AiResult<AiStatus>> => {
    if (!developerMode()) return fail('no_key', DEVELOPER_ONLY)
    const trimmed = typeof key === 'string' ? key.trim() : ''
    if (!trimmed || /\s/.test(trimmed) || trimmed.length > 500) {
      return fail('invalid_key', 'That does not look like an API key.')
    }
    if (!encryptionAvailable()) return fail('no_encryption', 'This system cannot store the API key securely.')
    await saveApiKey(trimmed)
    return { ok: true, value: status() }
  })

  ipcMain.handle('ai:clearKey', async () => {
    if (developerMode()) await clearApiKey()
    return status()
  })

  ipcMain.handle('ai:test', () => testConnection())

  ipcMain.handle('ai:ask', (_event, task: unknown, input: unknown) => {
    if (!isAiTask(task)) return fail('bad_request', 'Unknown AI task.')
    return runTask(task, input)
  })
}

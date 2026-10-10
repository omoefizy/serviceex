import type { AppSettings } from '../../shared/types'
import { db } from './index'

const DEFAULTS: AppSettings = {
  fadeMs: 400,
  outputDisplay: 'auto',
  logoUrl: null,
  appearance: 'system',
  autosaveDrafts: true,
  backupFolder: null,
  backupIntervalMinutes: 0,
  lastBackupAt: null,
  aiEnabled: true,
  aiModel: 'claude-sonnet-5-5',
  autoGoLiveOnNext: false,
}

export const FADE_LIMITS = { min: 0, max: 1500 }

/** Settings rows: each value is JSON under its own key. fadeMs keeps the key it was first saved under. */
const KEYS: Record<keyof AppSettings, string> = {
  fadeMs: 'output.fadeMs',
  outputDisplay: 'output.display',
  logoUrl: 'output.logoUrl',
  appearance: 'ui.appearance',
  autosaveDrafts: 'editor.autosaveDrafts',
  backupFolder: 'backup.folder',
  backupIntervalMinutes: 'backup.intervalMinutes',
  lastBackupAt: 'backup.lastAt',
  aiEnabled: 'ai.enabled',
  aiModel: 'ai.model',
  autoGoLiveOnNext: 'schedule.autoGoLiveOnNext',
}

/** Checks one value, returning undefined for anything unusable so the default applies. */
function clean<K extends keyof AppSettings>(key: K, value: unknown): AppSettings[K] | undefined {
  const v = value as never
  switch (key) {
    case 'fadeMs':
      return typeof value === 'number' && Number.isFinite(value)
        ? (Math.round(Math.min(FADE_LIMITS.max, Math.max(FADE_LIMITS.min, value))) as never)
        : undefined
    case 'outputDisplay':
      return value === 'auto' || value === 'window' || (Number.isInteger(value) && (value as number) >= 0) ? v : undefined
    case 'logoUrl':
      return value === null || (typeof value === 'string' && value.startsWith('wd-media://')) ? v : undefined
    case 'appearance':
      return ['system', 'dark', 'light'].includes(value as string) ? v : undefined
    case 'autosaveDrafts':
    case 'aiEnabled':
    case 'autoGoLiveOnNext':
      return typeof value === 'boolean' ? v : undefined
    case 'aiModel':
      return value === 'claude-sonnet-5-5' || value === 'claude-haiku-5-5' ? v : undefined
    case 'backupFolder':
    case 'lastBackupAt':
      return value === null || (typeof value === 'string' && value !== '') ? v : undefined
    case 'backupIntervalMinutes':
      return [0, 10, 30, 60].includes(value as number) ? v : undefined
    default:
      return undefined
  }
}

export function getAppSettings(): AppSettings {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key NOT LIKE 'theme.%'").all() as { key: string; value: string }[]
  const stored = new Map(rows.map((row) => [row.key, row.value]))
  const settings = { ...DEFAULTS }
  for (const key of Object.keys(KEYS) as (keyof AppSettings)[]) {
    const raw = stored.get(KEYS[key])
    if (raw === undefined) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }
    const value = clean(key, parsed)
    if (value !== undefined) (settings as Record<string, unknown>)[key] = value
  }
  return settings
}

/** Saves the valid fields of `patch` and returns the settings as stored. Invalid fields are ignored. */
export function setAppSettings(patch: Partial<AppSettings>): AppSettings {
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
  db.transaction(() => {
    for (const key of Object.keys(patch) as (keyof AppSettings)[]) {
      if (!(key in KEYS)) continue
      const value = clean(key, patch[key])
      if (value !== undefined) upsert.run(KEYS[key], JSON.stringify(value))
    }
  })()
  return getAppSettings()
}

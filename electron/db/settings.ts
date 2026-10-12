import type { AlertMessage, AlertRepeat, AppSettings, WhisperModelId } from '../../shared/types'
import { db } from './index'

const DEFAULTS: AppSettings = {
  alertMessages: [],
  alertPosition: 'bottom',
  alertSeconds: 10,
  alertKeepOnClear: true,
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
  micDeviceId: null,
  micProcessing: false,
  saveTranscripts: false,
  speechEngine: 'auto',
  whisperModel: 'base.en',
  whisperSpeed: {},
  scriptureDetection: true,
  detectionMinConfidence: 0.6,
  detectionAlert: 'off',
  aiScriptureFallback: false,
  quoteSpeakerName: '',
  statementPicking: false,
}

export const FADE_LIMITS = { min: 0, max: 1500 }

const WHISPER_MODEL_IDS: WhisperModelId[] = ['tiny.en', 'base.en', 'small.en', 'small']

/** Settings rows: each value is JSON under its own key. fadeMs keeps the key it was first saved under. */
const KEYS: Record<keyof AppSettings, string> = {
  alertMessages: 'alerts.messages',
  alertPosition: 'alerts.position',
  alertSeconds: 'alerts.seconds',
  alertKeepOnClear: 'alerts.keepOnClear',
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
  micDeviceId: 'speech.micDeviceId',
  micProcessing: 'speech.micProcessing',
  saveTranscripts: 'speech.saveTranscripts',
  speechEngine: 'speech.engine',
  whisperModel: 'speech.whisperModel',
  whisperSpeed: 'speech.whisperSpeed',
  scriptureDetection: 'detection.enabled',
  detectionMinConfidence: 'detection.minConfidence',
  detectionAlert: 'detection.alert',
  aiScriptureFallback: 'detection.aiFallback',
  quoteSpeakerName: 'quote.speakerName',
  statementPicking: 'detection.statements',
}

const ALERT_REPEATS: AlertRepeat[] = ['once', 'loop', 'hold']
export const ALERT_LIMITS = { messages: 100, text: 300, seconds: [3, 120], every: [5, 3600] } as const

/** Saved alerts with a usable shape; anything else in the list is dropped. */
function cleanAlertMessages(value: unknown): AlertMessage[] | undefined {
  if (!Array.isArray(value)) return undefined
  const messages: AlertMessage[] = []
  for (const item of value.slice(0, ALERT_LIMITS.messages)) {
    const m = item as Partial<AlertMessage> | null
    if (typeof m !== 'object' || m === null || typeof m.id !== 'string' || !m.id || m.id.length > 64) continue
    if (typeof m.text !== 'string' || !m.text.trim() || m.text.length > ALERT_LIMITS.text) continue
    const every = typeof m.everySeconds === 'number' && Number.isFinite(m.everySeconds) ? Math.round(m.everySeconds) : 60
    messages.push({
      id: m.id,
      text: m.text.trim(),
      priority: m.priority === true,
      repeat: ALERT_REPEATS.includes(m.repeat as AlertRepeat) ? (m.repeat as AlertRepeat) : 'once',
      everySeconds: Math.min(ALERT_LIMITS.every[1], Math.max(ALERT_LIMITS.every[0], every)),
    })
  }
  return messages
}

/** Checks one value, returning undefined for anything unusable so the default applies. */
function clean<K extends keyof AppSettings>(key: K, value: unknown): AppSettings[K] | undefined {
  const v = value as never
  switch (key) {
    case 'alertMessages':
      return cleanAlertMessages(value) as never
    case 'alertPosition':
      return value === 'top' || value === 'bottom' ? v : undefined
    case 'alertSeconds':
      return typeof value === 'number' && Number.isFinite(value)
        ? (Math.round(Math.min(ALERT_LIMITS.seconds[1], Math.max(ALERT_LIMITS.seconds[0], value))) as never)
        : undefined
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
    case 'alertKeepOnClear':
    case 'autosaveDrafts':
    case 'aiEnabled':
    case 'autoGoLiveOnNext':
    case 'saveTranscripts':
    case 'micProcessing':
    case 'scriptureDetection':
    case 'statementPicking':
    case 'aiScriptureFallback':
      return typeof value === 'boolean' ? v : undefined
    case 'quoteSpeakerName':
      return typeof value === 'string' && value.length <= 100 ? (value.trim() as never) : undefined
    case 'aiModel':
      return value === 'claude-sonnet-5-5' || value === 'claude-haiku-5-5' ? v : undefined
    case 'backupFolder':
    case 'lastBackupAt':
      return value === null || (typeof value === 'string' && value !== '') ? v : undefined
    case 'micDeviceId':
      return value === null || (typeof value === 'string' && value !== '' && value.length <= 512) ? v : undefined
    case 'detectionMinConfidence':
      return typeof value === 'number' && Number.isFinite(value)
        ? ((Math.round(Math.min(0.95, Math.max(0.3, value)) * 100) / 100) as never)
        : undefined
    case 'detectionAlert':
      return value === 'off' || value === 'sound' || value === 'flash' ? v : undefined
    case 'speechEngine':
      return value === 'auto' || value === 'deepgram' || value === 'whisper' ? v : undefined
    case 'whisperModel':
      return WHISPER_MODEL_IDS.includes(value as WhisperModelId) ? v : undefined
    case 'whisperSpeed': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
      const speeds = Object.entries(value).filter(
        ([id, rtf]) => WHISPER_MODEL_IDS.includes(id as WhisperModelId) && typeof rtf === 'number' && rtf > 0 && rtf < 100,
      )
      return Object.fromEntries(speeds) as never
    }
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

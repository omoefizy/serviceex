import type { AppSettings } from '../../shared/types'
import { db } from './index'

const DEFAULTS: AppSettings = { fadeMs: 400 }

export const FADE_LIMITS = { min: 0, max: 1500 }

export function getAppSettings(): AppSettings {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'output.fadeMs'").get() as { value: string } | undefined
  const fadeMs = Number(row?.value)
  return {
    fadeMs: Number.isFinite(fadeMs) ? Math.min(FADE_LIMITS.max, Math.max(FADE_LIMITS.min, fadeMs)) : DEFAULTS.fadeMs,
  }
}

export function setAppSettings(settings: Partial<AppSettings>): AppSettings {
  if (settings.fadeMs !== undefined) {
    const fadeMs = Math.round(Math.min(FADE_LIMITS.max, Math.max(FADE_LIMITS.min, settings.fadeMs)))
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('output.fadeMs', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    ).run(String(fadeMs))
  }
  return getAppSettings()
}

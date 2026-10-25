import { sanitizeRichFor } from '../../shared/richText'
import { DEFAULT_FONT } from '../../shared/themes'
import type { AlertMessage, AppSettings, LogoAnchor, LogoItem, SavedLowerThirdLine, ScreenMargins, StreamResolution, WhisperModelId } from '../../shared/types'
import { db } from './index'

export const NO_MARGINS: ScreenMargins = { top: 0, right: 0, bottom: 0, left: 0 }

const DEFAULTS: AppSettings = {
  alertMessages: [],
  alertPosition: 'bottom',
  alertSpeed: 14,
  alertFontSize: 5,
  alertTextColor: '#ffffff',
  alertBandColor: '#0a0e1c',
  alertBandOpacity: 0.85,
  alertBandHeight: 9,
  alertLoops: 0,
  alertLayout: 'divider',
  alertKeepOnClear: true,
  fadeMs: 400,
  outputDisplay: 'auto',
  outputBounds: { left: 0, top: 0, width: 1920, height: 1080 },
  screenMargins: NO_MARGINS,
  defaultFont: DEFAULT_FONT,
  previewOutput: true,
  streamDisplay: 'window',
  streamResolution: '1920x1080',
  streamKeyMode: 'chroma',
  streamKeyColor: '#00ff00',
  streamSlideContent: 'full',
  logoItems: [],
  logoLayerVisible: true,
  overlaysOnChurchScreen: false,
  lowerThirdTemplateId: null,
  lowerThirdAnimation: 'slide',
  lowerThirdDurationMs: 500,
  lowerThirdHoldSeconds: 0,
  lowerThirdOverFullSlide: false,
  lowerThirdSavedLines: [],
  lowerThirdPoints: [],
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
  micDeviceName: null,
  micChannel: 'mono',
  micGainDb: 0,
  micHighPass: true,
  micNoiseGate: false,
  micGateThresholdDb: -60,
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
  presentationEngine: 'auto',
  presentationAutoRefreshLive: false,
  presentationLivePowerPoint: false,
}

export const FADE_LIMITS = { min: 0, max: 1500 }

const WHISPER_MODEL_IDS: WhisperModelId[] = ['tiny.en', 'base.en', 'small.en', 'small']

/** Settings rows: each value is JSON under its own key. fadeMs keeps the key it was first saved under. */
const KEYS: Record<keyof AppSettings, string> = {
  alertMessages: 'alerts.messages',
  alertPosition: 'alerts.position',
  alertSpeed: 'alerts.speed',
  alertFontSize: 'alerts.fontSize',
  alertTextColor: 'alerts.textColor',
  alertBandColor: 'alerts.bandColor',
  alertBandOpacity: 'alerts.bandOpacity',
  alertBandHeight: 'alerts.bandHeight',
  alertLoops: 'alerts.loops',
  alertLayout: 'alerts.layout',
  alertKeepOnClear: 'alerts.keepOnClear',
  fadeMs: 'output.fadeMs',
  outputDisplay: 'output.display',
  outputBounds: 'output.bounds',
  screenMargins: 'output.screenMargins',
  defaultFont: 'output.defaultFont',
  previewOutput: 'output.preview',
  streamDisplay: 'stream.display',
  streamResolution: 'stream.resolution',
  streamKeyMode: 'stream.keyMode',
  streamKeyColor: 'stream.keyColor',
  streamSlideContent: 'stream.slideContent',
  logoItems: 'overlays.logos',
  logoLayerVisible: 'overlays.logosVisible',
  overlaysOnChurchScreen: 'overlays.onChurchScreen',
  lowerThirdTemplateId: 'lowerThird.templateId',
  lowerThirdAnimation: 'lowerThird.animation',
  lowerThirdDurationMs: 'lowerThird.durationMs',
  lowerThirdHoldSeconds: 'lowerThird.holdSeconds',
  lowerThirdOverFullSlide: 'lowerThird.overFullSlide',
  lowerThirdSavedLines: 'lowerThird.savedLines',
  lowerThirdPoints: 'lowerThird.points',
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
  micDeviceName: 'speech.micDeviceName',
  micChannel: 'speech.micChannel',
  micGainDb: 'speech.micGainDb',
  micHighPass: 'speech.micHighPass',
  micNoiseGate: 'speech.micNoiseGate',
  micGateThresholdDb: 'speech.micGateThresholdDb',
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
  presentationEngine: 'presentations.engine',
  presentationAutoRefreshLive: 'presentations.autoRefreshLive',
  presentationLivePowerPoint: 'presentations.livePowerPoint',
}

export const ALERT_LIMITS = {
  messages: 100,
  text: 300,
  speed: [3, 40],
  fontSize: [2, 15],
  bandHeight: [4, 25],
  loops: [0, 99],
} as const

/** Input gain and noise gate threshold for the listener's microphone, in dB. */
export const MIC_LIMITS = {
  gainDb: [-24, 12],
  gateThresholdDb: [-80, -30],
} as const

/** A number in [min, max], rounded to `step`; undefined for anything else. */
const ranged = (value: unknown, [min, max]: readonly [number, number], step: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Number((Math.round(Math.min(max, Math.max(min, value)) / step) * step).toFixed(2)) : undefined

/** Saved alerts with a usable shape; anything else in the list is dropped. */
function cleanAlertMessages(value: unknown): AlertMessage[] | undefined {
  if (!Array.isArray(value)) return undefined
  const messages: AlertMessage[] = []
  for (const item of value.slice(0, ALERT_LIMITS.messages)) {
    const m = item as Partial<AlertMessage> | null
    if (typeof m !== 'object' || m === null || typeof m.id !== 'string' || !m.id || m.id.length > 64) continue
    if (typeof m.text !== 'string' || !m.text.trim() || m.text.length > ALERT_LIMITS.text) continue
    const rich = sanitizeRichFor(m.rich, m.text.trim())
    messages.push({ id: m.id, text: m.text.trim(), priority: m.priority === true, ...(rich ? { rich } : {}) })
  }
  return messages
}

export const STREAM_RESOLUTIONS: StreamResolution[] = ['1280x720', '1920x1080', '2560x1440', '3840x2160']

export const LOGO_LIMITS = { items: 20, size: [2, 60], margin: [0, 20] } as const

const LOGO_ANCHORS: LogoAnchor[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'free']

/** Logos with a usable shape and their numbers in range; anything else in the list is dropped. */
export function cleanLogoItems(value: unknown): LogoItem[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items: LogoItem[] = []
  for (const item of value.slice(0, LOGO_LIMITS.items)) {
    const l = item as Partial<LogoItem> | null
    if (typeof l !== 'object' || l === null || typeof l.id !== 'string' || !l.id || l.id.length > 64) continue
    if (typeof l.url !== 'string' || !l.url.startsWith('wd-media://')) continue
    items.push({
      id: l.id,
      name: typeof l.name === 'string' ? l.name.slice(0, 120) : '',
      url: l.url,
      anchor: LOGO_ANCHORS.includes(l.anchor as LogoAnchor) ? (l.anchor as LogoAnchor) : 'top-right',
      x: ranged(l.x, [0, 100], 0.1) ?? 50,
      y: ranged(l.y, [0, 100], 0.1) ?? 50,
      size: ranged(l.size, LOGO_LIMITS.size, 0.5) ?? 12,
      margin: ranged(l.margin, LOGO_LIMITS.margin, 0.5) ?? 0,
      opacity: ranged(l.opacity, [0, 1], 0.05) ?? 1,
      enabled: l.enabled !== false,
    })
  }
  return items
}

export const LOWER_THIRD_LIMITS = { lines: 200, points: 100, text: 300, durationMs: [200, 1000], holdSeconds: [0, 600] } as const

/** Saved lines with a usable shape; anything else in the list is dropped. */
function cleanSavedLines(value: unknown): SavedLowerThirdLine[] | undefined {
  if (!Array.isArray(value)) return undefined
  const lines: SavedLowerThirdLine[] = []
  for (const item of value.slice(0, LOWER_THIRD_LIMITS.lines)) {
    const l = item as Partial<SavedLowerThirdLine> | null
    if (typeof l !== 'object' || l === null || typeof l.id !== 'string' || !l.id || l.id.length > 64) continue
    const headline = typeof l.headline === 'string' ? l.headline.trim().slice(0, LOWER_THIRD_LIMITS.text) : ''
    const body = typeof l.body === 'string' ? l.body.trim().slice(0, LOWER_THIRD_LIMITS.text) : ''
    if (!headline && !body) continue
    const headlineRich = sanitizeRichFor(l.headlineRich, headline)
    const bodyRich = sanitizeRichFor(l.bodyRich, body)
    lines.push({ id: l.id, headline, body, pinned: l.pinned === true, ...(headlineRich ? { headlineRich } : {}), ...(bodyRich ? { bodyRich } : {}) })
  }
  return lines
}

/** Each side 0 to 25 percent of the screen. */
export function cleanScreenMargins(value: unknown): ScreenMargins | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const m = value as Partial<ScreenMargins>
  const side = (v: unknown) => ranged(v, [0, 25], 0.1) ?? 0
  return { top: side(m.top), right: side(m.right), bottom: side(m.bottom), left: side(m.left) }
}

/** A family name or a CSS font stack, without anything that could end the declaration. */
export const cleanDefaultFont = (value: unknown) =>
  typeof value === 'string' && value.trim() !== '' && value.length <= 200 && !/[;{}<>]/.test(value) ? value.trim() : undefined

/** Custom Position: whole screen points, at least 160 × 90. */
function cleanOutputBounds(value: unknown): AppSettings['outputBounds'] | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const b = value as Partial<AppSettings['outputBounds']>
  const whole = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v))) : undefined)
  const left = whole(b.left, -20000, 20000)
  const top = whole(b.top, -20000, 20000)
  const width = whole(b.width, 160, 16000)
  const height = whole(b.height, 90, 16000)
  return left === undefined || top === undefined || width === undefined || height === undefined ? undefined : { left, top, width, height }
}

const hexColor = (value: unknown) => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined)

/** Checks one value, returning undefined for anything unusable so the default applies. */
function clean<K extends keyof AppSettings>(key: K, value: unknown): AppSettings[K] | undefined {
  const v = value as never
  switch (key) {
    case 'alertMessages':
      return cleanAlertMessages(value) as never
    case 'alertPosition':
      return value === 'top' || value === 'bottom' ? v : undefined
    case 'alertSpeed':
      return ranged(value, ALERT_LIMITS.speed, 0.5) as never
    case 'alertFontSize':
      return ranged(value, ALERT_LIMITS.fontSize, 0.1) as never
    case 'alertBandHeight':
      return ranged(value, ALERT_LIMITS.bandHeight, 0.5) as never
    case 'alertBandOpacity':
      return ranged(value, [0, 1], 0.05) as never
    case 'alertLoops':
      return ranged(value, ALERT_LIMITS.loops, 1) as never
    case 'alertTextColor':
    case 'alertBandColor':
    case 'streamKeyColor':
      return hexColor(value) as never
    case 'alertLayout':
      return value === 'divider' || value === 'sequence' ? v : undefined
    case 'fadeMs':
      return typeof value === 'number' && Number.isFinite(value)
        ? (Math.round(Math.min(FADE_LIMITS.max, Math.max(FADE_LIMITS.min, value))) as never)
        : undefined
    case 'outputDisplay':
      return value === 'auto' || value === 'window' || value === 'custom' || (Number.isInteger(value) && (value as number) >= 0) ? v : undefined
    case 'outputBounds':
      return cleanOutputBounds(value) as never
    case 'screenMargins':
      return cleanScreenMargins(value) as never
    case 'defaultFont':
      return cleanDefaultFont(value) as never
    case 'streamDisplay':
      return value === 'window' || (Number.isInteger(value) && (value as number) >= 0) ? v : undefined
    case 'streamResolution':
      return STREAM_RESOLUTIONS.includes(value as StreamResolution) ? v : undefined
    case 'streamKeyMode':
      return value === 'chroma' || value === 'luma' ? v : undefined
    case 'streamSlideContent':
      return value === 'full' || value === 'lowerThird' || value === 'hide' ? v : undefined
    case 'logoItems':
      return cleanLogoItems(value) as never
    case 'lowerThirdTemplateId':
      return value === null || (Number.isInteger(value) && (value as number) > 0) ? v : undefined
    case 'lowerThirdAnimation':
      return value === 'slide' || value === 'fade' || value === 'wipe' ? v : undefined
    case 'lowerThirdDurationMs':
      return ranged(value, LOWER_THIRD_LIMITS.durationMs, 50) as never
    case 'lowerThirdHoldSeconds':
      return ranged(value, LOWER_THIRD_LIMITS.holdSeconds, 1) as never
    case 'lowerThirdSavedLines':
      return cleanSavedLines(value) as never
    case 'lowerThirdPoints':
      return Array.isArray(value)
        ? (value
            .filter((point): point is string => typeof point === 'string' && point.trim() !== '')
            .slice(0, LOWER_THIRD_LIMITS.points)
            .map((point) => point.trim().slice(0, LOWER_THIRD_LIMITS.text)) as never)
        : undefined
    case 'logoUrl':
      return value === null || (typeof value === 'string' && value.startsWith('wd-media://')) ? v : undefined
    case 'appearance':
      return ['system', 'dark', 'light'].includes(value as string) ? v : undefined
    case 'alertKeepOnClear':
    case 'logoLayerVisible':
    case 'overlaysOnChurchScreen':
    case 'lowerThirdOverFullSlide':
    case 'previewOutput':
    case 'autosaveDrafts':
    case 'aiEnabled':
    case 'autoGoLiveOnNext':
    case 'saveTranscripts':
    case 'micProcessing':
    case 'micHighPass':
    case 'micNoiseGate':
    case 'scriptureDetection':
    case 'statementPicking':
    case 'aiScriptureFallback':
    case 'presentationAutoRefreshLive':
    case 'presentationLivePowerPoint':
      return typeof value === 'boolean' ? v : undefined
    case 'presentationEngine':
      return value === 'auto' || value === 'powerpoint' || value === 'libreoffice' ? v : undefined
    case 'quoteSpeakerName':
      return typeof value === 'string' && value.length <= 100 ? (value.trim() as never) : undefined
    case 'aiModel':
      return value === 'claude-sonnet-5-5' || value === 'claude-haiku-5-5' ? v : undefined
    case 'backupFolder':
    case 'lastBackupAt':
      return value === null || (typeof value === 'string' && value !== '') ? v : undefined
    case 'micDeviceId':
    case 'micDeviceName':
      return value === null || (typeof value === 'string' && value !== '' && value.length <= 512) ? v : undefined
    case 'micChannel':
      return value === 'mono' || value === 'left' || value === 'right' || (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 64)
        ? v
        : undefined
    case 'micGainDb':
      return ranged(value, MIC_LIMITS.gainDb, 0.5) as never
    case 'micGateThresholdDb':
      return ranged(value, MIC_LIMITS.gateThresholdDb, 1) as never
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

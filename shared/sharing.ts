// Which files may travel between ServiceEx computers. Both ends check: the sender before it starts, the receiver
// before it takes a single byte. Anything not listed here is refused, and nothing received is ever run.

import type { ShareKind } from './types'

/** Allowed extensions, lower case without the dot, and what each one is. */
export const SHARE_EXTENSIONS: Readonly<Record<string, ShareKind>> = {
  serviceex: 'package',
  pptx: 'presentation',
  ppt: 'presentation',
  pdf: 'presentation',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  mp4: 'video',
  webm: 'video',
  mp3: 'audio',
  wav: 'audio',
  txt: 'text',
  xml: 'openlyrics',
}

export const DEFAULT_SHARE_LIMIT_MB = 2048

/** The extension of a file name, lower case without the dot; empty when it has none. */
export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** What the file is, or null when its type may not be shared. */
export function shareKindOf(name: string): ShareKind | null {
  return Object.prototype.hasOwnProperty.call(SHARE_EXTENSIONS, extensionOf(name)) ? SHARE_EXTENSIONS[extensionOf(name)] : null
}

/** The size limit in bytes for a limit in MB. */
export const limitBytes = (limitMb: number) => Math.round(limitMb * 1024 * 1024)

/** Why a file cannot be shared, or null when it can. */
export function shareProblem(name: string, size: number, limitMb: number): string | null {
  if (!shareKindOf(name)) return `${name || 'That file'} is not a type that can be shared. Allowed: ${Object.keys(SHARE_EXTENSIONS).map((e) => `.${e}`).join(', ')}.`
  if (!Number.isSafeInteger(size) || size < 0) return `${name} has an unreadable size.`
  if (size > limitBytes(limitMb)) return `${name} is ${formatBytes(size)}, over the ${formatBytes(limitBytes(limitMb))} limit.`
  return null
}

/**
 * A name that is safe to show and to save: no folders, no control characters, nothing a file system treats
 * specially, and its extension kept.
 */
export function safeFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(-120)
  return base || 'file'
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

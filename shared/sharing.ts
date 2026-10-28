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

/** The port Sharing listens on when it is free, and the one an address typed without a port is tried on. */
export const DEFAULT_SHARE_PORT = 47820

/** Whether an IPv4 address is on a private or link-local network: 10.x, 172.16-31.x, 192.168.x or 169.254.x. */
export function isPrivateIpv4(address: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address)
  if (!match) return false
  const [a, b, c, d] = match.slice(1).map(Number)
  if ([a, b, c, d].some((n) => n > 255)) return false
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254 && c > 0 && c < 255)
}

/**
 * Checks an address typed to pair with: a private network IPv4 address or a .local name, and a port. Resolves to
 * where to connect, or a sentence saying what is wrong.
 */
export function parseShareAddress(hostInput: string, portInput: string): { host: string; port: number } | { error: string } {
  let host = hostInput.trim().toLowerCase()
  let portText = portInput.trim()
  // "192.168.1.20:47820" in the address field is taken as both.
  const withPort = /^([^:\s]+):(\d+)$/.exec(host)
  if (withPort) {
    host = withPort[1]
    portText = portText && portText !== String(DEFAULT_SHARE_PORT) ? portText : withPort[2]
  }
  host = host.replace(/\.$/, '')
  if (!host) return { error: 'Type the other computer’s IP address, such as 192.168.1.20, or its name ending in .local.' }
  const port = portText ? Number(portText) : DEFAULT_SHARE_PORT
  if (!/^\d+$/.test(portText || '0') || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { error: 'The port is a number from 1 to 65535. ServiceEx uses 47820 unless that was taken.' }
  }
  if (/^[\d.]+$/.test(host)) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.split('.').some((n) => Number(n) > 255)) return { error: `${host} is not a valid IP address.` }
    if (host.startsWith('127.')) return { error: `${host} is this computer. Type the other computer’s address, shown in its Settings, Sharing.` }
    if (!isPrivateIpv4(host)) {
      return { error: `${host} is not a local network address. Only addresses on this network can pair: 10.x.x.x, 172.16 to 172.31.x.x, 192.168.x.x or 169.254.x.x.` }
    }
    return { host, port }
  }
  if (host.includes(':')) return { error: 'IPv6 addresses are not supported here. Type the IPv4 address shown in the other computer’s Settings, Sharing.' }
  const labels = host.split('.')
  if (labels.length < 2 || labels.at(-1) !== 'local' || !labels.every((label) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    return { error: `${host} is not a local network name. Use the IP address, or a name ending in .local, such as sanctuary-booth.local.` }
  }
  return { host, port }
}

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

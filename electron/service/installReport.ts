// Counts this installation once, anonymously: at first launch the app sends POST /v1/telemetry/install with a random
// install id, the operating system, the processor type, the app version and the language. Nothing else: no account,
// no machine id, no name, no files. Settings, Privacy, "Share anonymous install count" turns it off; while off nothing
// is sent, and the install id does not go with a new account either.
//
// The install id is random and kept in the app's data folder. It is not the machine id (see ./machineId) and cannot be
// matched to it. A report that does not get through (offline, server asleep) is tried again at the next launch until
// the server answers.

import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const FILE = 'install-report.json'
const TIMEOUT_MS = 20_000
const ARCHES = ['x64', 'arm64', 'ia32']

interface InstallRecord {
  installId: string
  reported: boolean
}

const isRecord = (value: unknown): value is InstallRecord =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as InstallRecord).installId === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test((value as InstallRecord).installId) &&
  typeof (value as InstallRecord).reported === 'boolean'

async function load(folder: string): Promise<InstallRecord> {
  try {
    const saved: unknown = JSON.parse(await readFile(path.join(folder, FILE), 'utf8'))
    if (isRecord(saved)) return saved
  } catch {
    // Missing or unreadable: this is the first launch, or the file was removed. Either way, start again.
  }
  const record = { installId: randomUUID(), reported: false }
  await save(folder, record)
  return record
}

const save = (folder: string, record: InstallRecord) =>
  writeFile(path.join(folder, FILE), JSON.stringify(record), { mode: 0o600 }).catch((error) => console.error('Could not save the install report', error))

/** The install id to send with a new account, or null while sharing is off. */
export async function installIdForSignup(folder: string, sharing: boolean): Promise<string | null> {
  return sharing ? (await load(folder)).installId : null
}

export interface InstallReportOptions {
  baseUrl(): string | null
  /** The app's data folder, where the install id is kept. */
  folder: string
  /** The Settings toggle, read when the report would be sent. */
  sharing(): boolean
  os: 'windows' | 'macos' | 'linux'
  arch: string
  appVersion: string
  locale: string
  fetch?: (url: string, init: RequestInit) => Promise<Response>
}

export type InstallReportOutcome = 'sent' | 'already_sent' | 'off' | 'not_sent'

/** Sends the install report unless it was sent before or sharing is off. Never rejects. */
export async function reportInstall(options: InstallReportOptions): Promise<InstallReportOutcome> {
  if (!options.sharing()) return 'off'
  const base = options.baseUrl()
  if (!base || !ARCHES.includes(options.arch)) return 'not_sent'
  const record = await load(options.folder)
  if (record.reported) return 'already_sent'
  try {
    const response = await (options.fetch ?? fetch)(`${base}/v1/telemetry/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ install_id: record.installId, os: options.os, arch: options.arch, app_version: options.appVersion, locale: options.locale }),
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    await response.body?.cancel().catch(() => undefined)
    // A refused report (4xx other than rate limiting) would be refused again, so it counts as done too.
    if (!response.ok && (response.status === 429 || response.status >= 500)) return 'not_sent'
  } catch {
    return 'not_sent'
  }
  await save(options.folder, { ...record, reported: true })
  return 'sent'
}

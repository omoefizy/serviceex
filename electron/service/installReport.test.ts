// The anonymous install report: one POST at first launch with a random id and the system, nothing while sharing is
// off, tried again at the next launch when it did not get through, and the same id for a new account.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTempDir, removeTemp } from '../tempDir.test-helper'
import { installIdForSignup, reportInstall, type InstallReportOptions } from './installReport'

let folder: string
let sent: { url: string; body: Record<string, unknown> }[]
let status: number | 'offline'

beforeEach(async () => {
  folder = await makeTempDir('serviceex-install-report-')
  sent = []
  status = 204
})

afterEach(() => removeTemp(folder))

const options = (overrides: Partial<InstallReportOptions> = {}): InstallReportOptions => ({
  baseUrl: () => 'https://api.serviceex.test',
  folder,
  sharing: () => true,
  os: 'windows',
  arch: 'x64',
  appVersion: '1.4.0',
  locale: 'en-NG',
  fetch: async (url, init) => {
    sent.push({ url, body: JSON.parse(String(init.body)) })
    if (status === 'offline') throw new TypeError('fetch failed')
    return new Response(null, { status })
  },
  ...overrides,
})

describe('the install report', () => {
  it('sends a random id, the system, version and language once', async () => {
    expect(await reportInstall(options())).toBe('sent')
    expect(await reportInstall(options())).toBe('already_sent')
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toBe('https://api.serviceex.test/v1/telemetry/install')
    expect(Object.keys(sent[0].body).sort()).toEqual(['app_version', 'arch', 'install_id', 'locale', 'os'])
    expect(sent[0].body).toMatchObject({ os: 'windows', arch: 'x64', app_version: '1.4.0', locale: 'en-NG' })
    expect(sent[0].body.install_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('sends nothing while sharing is off, and makes no id', async () => {
    expect(await reportInstall(options({ sharing: () => false }))).toBe('off')
    expect(await installIdForSignup(folder, false)).toBeNull()
    expect(sent).toHaveLength(0)
    await expect(readFile(path.join(folder, 'install-report.json'), 'utf8')).rejects.toThrow()
  })

  it('tries again at the next launch when offline or the server is down, with the same id', async () => {
    status = 'offline'
    expect(await reportInstall(options())).toBe('not_sent')
    status = 503
    expect(await reportInstall(options())).toBe('not_sent')
    status = 204
    expect(await reportInstall(options())).toBe('sent')
    expect(new Set(sent.map((s) => s.body.install_id)).size).toBe(1)
  })

  it('does not ask again when the server refuses the report', async () => {
    status = 400
    expect(await reportInstall(options())).toBe('sent')
    expect(await reportInstall(options())).toBe('already_sent')
  })

  it('sends nothing without a server address or for an unknown processor', async () => {
    expect(await reportInstall(options({ baseUrl: () => null }))).toBe('not_sent')
    expect(await reportInstall(options({ arch: 'riscv64' }))).toBe('not_sent')
    expect(sent).toHaveLength(0)
  })

  it('gives a new account the same install id, and replaces a damaged file', async () => {
    await reportInstall(options())
    expect(await installIdForSignup(folder, true)).toBe(sent[0].body.install_id)
    await writeFile(path.join(folder, 'install-report.json'), 'not json')
    const fresh = await installIdForSignup(folder, true)
    expect(fresh).not.toBe(sent[0].body.install_id)
    expect(fresh).toMatch(/^[0-9a-f-]{36}$/)
  })
})

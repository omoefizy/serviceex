// A stable id for this computer, for licence seats and the one free listening grant per computer. It is made from the
// operating system's own machine identifier (IOPlatformUUID on macOS, MachineGuid on Windows, /etc/machine-id on
// Linux), hashed with a salt; the identifier itself never leaves this module. When none can be read, a random id
// kept in the app's data folder stands in, so the id is still stable for this installation.

import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MACHINE_ID_SALT } from './config'

/** The id sent to the server: a prefix and 48 hex characters, which the server's machine id check accepts. */
export function hashMachineId(raw: string, salt = MACHINE_ID_SALT): string {
  return `wd1-${createHash('sha256').update(`${salt}\n${raw.trim().toLowerCase()}`).digest('hex').slice(0, 48)}`
}

const run = (file: string, args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile(file, args, { timeout: 5000, windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(String(stdout)))),
  )

/** The operating system's machine identifier, or null when it cannot be read. */
export async function osMachineIdentifier(platform = process.platform): Promise<string | null> {
  try {
    if (platform === 'darwin') {
      const out = await run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])
      return /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out)?.[1] ?? null
    }
    if (platform === 'win32') {
      // The 64 bit view, so a 32 bit process reads the same value.
      const out = await run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'])
      return /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(out)?.[1] ?? null
    }
    for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
      const id = (await readFile(file, 'utf8').catch(() => '')).trim()
      if (id) return id
    }
  } catch (error) {
    console.error('Could not read the machine identifier', error instanceof Error ? error.message : error)
  }
  return null
}

/** A random id made once and kept in `folder`, for computers whose identifier cannot be read. */
async function installationId(folder: string): Promise<string> {
  const file = path.join(folder, 'installation-id')
  const saved = (await readFile(file, 'utf8').catch(() => '')).trim()
  if (/^[0-9a-f-]{36}$/.test(saved)) return saved
  const id = randomUUID()
  await writeFile(file, id, { mode: 0o600 }).catch((error) => console.error('Could not save the installation id', error))
  return id
}

let cached: Promise<string> | null = null

/** This computer's id; worked out once per run. */
export function machineId(dataFolder: string): Promise<string> {
  cached ??= (async () => hashMachineId((await osMachineIdentifier()) ?? `installation:${await installationId(dataFolder)}`))()
  return cached
}

// Automatic database backups into a folder the user picks, with the newest KEEP files kept.

import { mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { db } from './db'
import { getAppSettings, setAppSettings } from './db/settings'

const KEEP = 20
const PREFIX = 'serviceex-backup-'

/** Copies the database into the backup folder (safe while the app is writing) and resolves to the file. */
export async function backupNow(): Promise<string> {
  const { backupFolder } = getAppSettings()
  if (!backupFolder) throw new Error('Choose a backup folder first')
  await mkdir(backupFolder, { recursive: true })
  // 2026-10-10T14-05-09 sorts by time and is a valid file name everywhere.
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
  const file = path.join(backupFolder, `${PREFIX}${stamp}.db`)
  await db.backup(file)
  setAppSettings({ lastBackupAt: new Date().toISOString() })

  const old = (await readdir(backupFolder)).filter((name) => name.startsWith(PREFIX) && name.endsWith('.db')).sort().slice(0, -KEEP)
  await Promise.all(old.map((name) => rm(path.join(backupFolder, name), { force: true })))
  return file
}

/** Checks once a minute whether a backup is due under the current settings. */
export function startBackupSchedule(): void {
  setInterval(() => {
    const { backupFolder, backupIntervalMinutes, lastBackupAt } = getAppSettings()
    if (!backupFolder || backupIntervalMinutes === 0) return
    const last = lastBackupAt ? Date.parse(lastBackupAt) : 0
    if (Date.now() - last >= backupIntervalMinutes * 60_000) backupNow().catch((err) => console.error('Backup failed', err))
  }, 60_000)
}

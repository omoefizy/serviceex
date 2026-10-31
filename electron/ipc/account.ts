// The ServiceEx account's IPC: Settings, Account and the Plans and Credits screen. The session tokens stay in the main
// process; the renderer gets the account state (see shared/account) and plain results.

import { app, BrowserWindow, ipcMain, net, shell } from 'electron'
import type { AccountState } from '../../shared/account'
import { adoptServerKey, licenseKeyId, licensePublicKey, licenseStore } from '../license'
import { encryptionAvailable } from '../secrets'
import { AccountService } from '../service/account'
import { ServiceClient } from '../service/client'
import { apiBaseUrl } from '../service/config'
import { machineId } from '../service/machineId'
import { setServiceAccount } from '../service/registry'
import { safeSessionStore } from '../service/session'
import { createWarmUp } from '../service/warmUp'
import { installIdForSignup, reportInstall } from '../service/installReport'
import { getAppSettings } from '../db/settings'

/** The licence is refreshed this often while the app runs, well inside its 14 days offline. */
const REFRESH_EVERY_MS = 6 * 60 * 60 * 1000

const platform = (): 'windows' | 'macos' | 'linux' => (process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux')

let service: AccountService | null = null

function broadcast(state: AccountState) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('account:changed', state)
  }
}

const thisMachineId = () => machineId(app.getPath('userData'))

export function registerAccountIpc(): void {
  const client = new ServiceClient({
    baseUrl: apiBaseUrl,
    fetch: (url, init) => net.fetch(url, init),
    store: safeSessionStore,
    onSignedOut: () => service?.signedOut(),
  })
  service = new AccountService({
    client,
    licenses: licenseStore(),
    machineId: thisMachineId,
    platform: platform(),
    appVersion: app.getVersion(),
    installId: () => installIdForSignup(app.getPath('userData'), getAppSettings().shareInstallCount),
    publicKey: () => licensePublicKey(),
    keyId: licenseKeyId,
    checkServerKey: (pem) => adoptServerKey(pem),
    configured: () => apiBaseUrl() !== null,
    encryptionAvailable,
    openExternal: (url) => {
      // Only Paystack's own pages are opened from here.
      if (!/^https:\/\/([a-z0-9-]+\.)*paystack\.(com|co)\//i.test(url)) return Promise.reject(new Error('Not a Paystack address'))
      return shell.openExternal(url)
    },
    onChange: broadcast,
  })
  const account = service
  setServiceAccount({ account, client, machineId: thisMachineId })

  // Node's own fetch rather than net.fetch, so not even Electron's user agent (app and system versions) goes with it.
  const warmUp = createWarmUp({ baseUrl: apiBaseUrl })
  void warmUp.ping()
  // Node's fetch for the same reason: the report carries only what reportInstall lists.
  void reportInstall({
    baseUrl: apiBaseUrl,
    folder: app.getPath('userData'),
    sharing: () => getAppSettings().shareInstallCount,
    os: platform(),
    arch: process.arch,
    appVersion: app.getVersion(),
    locale: app.getLocale(),
  })
  ipcMain.on('account:warmUp', () => void warmUp.pingIfStale())

  ipcMain.handle('account:state', () => account.state())
  ipcMain.handle('account:requestCode', (_event, email: unknown) => account.requestCode(email))
  ipcMain.handle('account:verifyCode', (_event, email: unknown, code: unknown) => account.verifyCode(email, code))
  ipcMain.handle('account:signOut', () => account.signOut())
  ipcMain.handle('account:refresh', () => account.refresh())
  ipcMain.handle('account:deactivate', () => account.deactivate())
  ipcMain.handle('account:products', () => account.products())
  ipcMain.handle('account:orders', () => account.orders())
  ipcMain.handle('account:buy', (_event, productId: unknown) => account.buy(productId))

  account.init().catch((error) => console.error('Could not load the account', error))
  setInterval(() => {
    if (account.isSignedIn() && net.isOnline()) void account.refresh()
  }, REFRESH_EVERY_MS)
}

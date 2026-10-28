// The account the app is running with, set once by ../ipc/account. Listening and AI reach it through here, so they
// (and their tests) do not depend on the Electron wiring.

import type { AccountService } from './account'
import type { ServiceClient } from './client'

export interface ServiceAccount {
  account: AccountService
  client: ServiceClient
  machineId(): Promise<string>
}

let current: ServiceAccount | null = null

export function setServiceAccount(next: ServiceAccount | null): void {
  current = next
}

/** The account, or null before it is set up (and in tests that do not set one). */
export const serviceAccount = (): ServiceAccount | null => current

export const signedIn = (): boolean => current?.account.isSignedIn() ?? false

// The ServiceEx account in the renderer: the state the main process broadcasts, and whether the Plans and Credits
// screen is open. One subscription is shared by every component that asks.

import { useSyncExternalStore } from 'react'
import type { AccountState } from '../../shared/account'
import { planChanged } from '../../shared/features'
import { entitlementsOf } from '../../shared/license'

let account: AccountState | null = null
let plansOpen = false
let started = false
const listeners = new Set<() => void>()

const emit = () => listeners.forEach((listener) => listener())

/** Takes the account as the main process reports it. A changed licence waits for the next start (see planChanged). */
function keep(state: AccountState) {
  account = state
  planChanged(entitlementsOf(state.license))
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

function start() {
  if (started) return
  started = true
  window.api.account.onChanged(keep)
  window.api.account.state().then((state) => {
    // A broadcast may have come first; it is newer.
    if (state && !account) keep(state)
  }, console.error)
}

/** Asks the main process for the account again, such as after it did not answer in time. */
export function reloadAccount(): void {
  window.api.account.state().then((state) => {
    if (state) keep(state)
  }, console.error)
}

/** The account as the main process last reported it; null until it has answered. */
export function useAccount(): AccountState | null {
  start()
  return useSyncExternalStore(subscribe, () => account, () => account)
}

/** Keeps a state an action returned, before its broadcast arrives. */
export function setAccountState(state: AccountState): void {
  keep(state)
}

export function usePlansOpen(): boolean {
  return useSyncExternalStore(subscribe, () => plansOpen, () => plansOpen)
}

export function openPlans(open: boolean): void {
  plansOpen = open
  emit()
}

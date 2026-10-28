// The ServiceEx account in the renderer: the state the main process broadcasts, and whether the Plans and Credits
// screen is open. One subscription is shared by every component that asks.

import { useSyncExternalStore } from 'react'
import type { AccountState } from '../../shared/account'

let account: AccountState | null = null
let plansOpen = false
let started = false
const listeners = new Set<() => void>()

const emit = () => listeners.forEach((listener) => listener())

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

function start() {
  if (started) return
  started = true
  window.api.account.onChanged((state) => {
    account = state
    emit()
  })
  window.api.account.state().then((state) => {
    // A broadcast may have come first; it is newer.
    if (state && !account) {
      account = state
      emit()
    }
  }, console.error)
}

/** The account as the main process last reported it; null until it has answered. */
export function useAccount(): AccountState | null {
  start()
  return useSyncExternalStore(subscribe, () => account, () => account)
}

/** Keeps a state an action returned, before its broadcast arrives. */
export function setAccountState(state: AccountState): void {
  account = state
  emit()
}

export function usePlansOpen(): boolean {
  return useSyncExternalStore(subscribe, () => plansOpen, () => plansOpen)
}

export function openPlans(open: boolean): void {
  plansOpen = open
  emit()
}

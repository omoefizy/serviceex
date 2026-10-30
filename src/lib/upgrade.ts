// The upgrade popover's request: which locked feature the operator asked for, and the control they asked from. Any
// locked control, menu or shortcut asks here; the one popover in App answers (see components/Locked).

import { useSyncExternalStore } from 'react'
import { can, canUseTheme, type FeatureKey } from '../../shared/features'

export interface UpgradeRequest {
  feature: FeatureKey
  /** Where the control is on screen, to open beside it; null for a menu command or a shortcut. */
  anchor: { top: number; bottom: number; left: number; right: number } | null
}

let request: UpgradeRequest | null = null
const listeners = new Set<() => void>()

const emit = () => listeners.forEach((listener) => listener())

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** Opens the upgrade popover for a locked feature, beside `from` when it is given. */
export function askUpgrade(feature: FeatureKey, from?: Element | null): void {
  const rect = from?.getBoundingClientRect()
  request = { feature, anchor: rect ? { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right } : null }
  emit()
}

export function closeUpgrade(): void {
  if (!request) return
  request = null
  emit()
}

export const upgradeRequest = (): UpgradeRequest | null => request

export function useUpgradeRequest(): UpgradeRequest | null {
  return useSyncExternalStore(subscribe, upgradeRequest, upgradeRequest)
}

/** An option's text when the plan leaves it out: it stays in the list, marked with a lock. */
export const lockedOption = (feature: FeatureKey, text: string): string => (can(feature) ? text : `🔒 ${text}`)

type PickableTheme = Parameters<typeof canUseTheme>[0] & { id: number }

/** A theme as a picker lists it: one the plan leaves out keeps its place, marked with a lock. */
export const themeLabel = (theme: PickableTheme): string => (canUseTheme(theme) ? theme.name : `🔒 ${theme.name}`)

/**
 * Whether a picker may take theme `id` (null for the default always may). For one the plan leaves out it opens the
 * upgrade popover beside `from` and answers false, so the picker keeps what it had.
 */
export function mayPickTheme(themes: PickableTheme[], id: number | null, from?: Element | null): boolean {
  const theme = id === null ? undefined : themes.find((t) => t.id === id)
  if (!theme || canUseTheme(theme)) return true
  askUpgrade('themes.editor', from)
  return false
}

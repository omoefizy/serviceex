// Requests between the parts of the operator screen that App lays out: the top bar asking for the service picker, the
// listening chip asking for the transcript drawer, a menu asking for one Settings section.

import { useOperatorStore } from '../store'

export const SHOW_SERVICE_PICKER_EVENT = 'serviceex:show-service-picker'
export const TRANSCRIPT_DRAWER_EVENT = 'serviceex:transcript-drawer'

/** Unfolds the Order of service and puts the keyboard on its service picker. */
export function showServicePicker(): void {
  window.dispatchEvent(new Event(SHOW_SERVICE_PICKER_EVENT))
}

/** Opens (true), closes (false) or toggles (undefined) the live transcript drawer. */
export function toggleTranscriptDrawer(open?: boolean): void {
  window.dispatchEvent(new CustomEvent<boolean | undefined>(TRANSCRIPT_DRAWER_EVENT, { detail: open }))
}

export const SETTINGS_PAGE_EVENT = 'serviceex:settings-page'
let pendingPage: string | null = null

/** The Settings page asked for before Settings had rendered; Settings takes it once, on opening. */
export function takeSettingsPage(): string | null {
  const page = pendingPage
  pendingPage = null
  return page
}

/** Opens Settings at the page of the section with this title, putting the keyboard on `focus` there if given. */
export function openSettingsAt(title: string, focus?: string): void {
  pendingPage = title
  useOperatorStore.getState().openSettings(true)
  window.dispatchEvent(new CustomEvent<string>(SETTINGS_PAGE_EVENT, { detail: title }))
  if (focus) requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector<HTMLElement>(focus)?.focus()))
}

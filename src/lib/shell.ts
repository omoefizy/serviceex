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

/** Opens Settings at the section with this title. */
export function openSettingsAt(title: string): void {
  useOperatorStore.getState().openSettings(true)
  // Settings scrolls to the section once it has rendered.
  requestAnimationFrame(() => {
    const section = Array.from(document.querySelectorAll('.settings-section')).find((el) => el.querySelector('h3')?.textContent?.trim() === title)
    section?.scrollIntoView({ block: 'start' })
  })
}

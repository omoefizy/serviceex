import type { OutputMode } from '../../shared/types'

/** Single-key output shortcuts; they work whenever focus is not in a text field. */
export const MODE_KEYS: { mode: OutputMode; key: string; label: string }[] = [
  { mode: 'show', key: 'S', label: 'Show' },
  { mode: 'black', key: 'B', label: 'Black' },
  { mode: 'clear', key: 'C', label: 'Clear' },
  { mode: 'logo', key: 'L', label: 'Logo' },
]

export const IS_MAC = navigator.platform.toLowerCase().includes('mac')

/** The modifier shown in shortcut hints: ⌘ on macOS, Ctrl elsewhere. */
export const MOD = IS_MAC ? '⌘' : 'Ctrl+'

/** True when a key press is meant for a text field or a dialog, not for running the show. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    !!target.closest('.modal, .palette')
  )
}

/** The Lower third card's headline field, focused by Cmd+L (Ctrl+L) and by Send to Lower Third. */
export const LOWER_THIRD_HEADLINE_ID = 'lower-third-headline'

export function focusLowerThirdHeadline(): void {
  // After the menu that asked has closed, so the field keeps the keyboard.
  requestAnimationFrame(focusHeadlineField)
}

function focusHeadlineField(): void {
  const field = document.getElementById(LOWER_THIRD_HEADLINE_ID)
  if (!(field instanceof HTMLInputElement) && !field?.isContentEditable) return
  field.scrollIntoView({ block: 'nearest' })
  field.focus()
  // A formatted field selects its words the way an input's select() does.
  if (field instanceof HTMLInputElement) field.select()
  else window.getSelection()?.selectAllChildren(field)
}

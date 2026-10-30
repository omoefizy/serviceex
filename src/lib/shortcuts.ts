import type { OutputMode } from '../../shared/types'

/** Single-key output shortcuts; they work whenever focus is not in a text field. */
export const MODE_KEYS: { mode: OutputMode; key: string; label: string }[] = [
  { mode: 'show', key: 'S', label: 'Show' },
  { mode: 'black', key: 'B', label: 'Black' },
  { mode: 'clear', key: 'C', label: 'Clear' },
  { mode: 'logo', key: 'L', label: 'Logo' },
]

/** Clear lower third: Shift with Clear's key, so it never clears the slide. */
export const CLEAR_LOWER_THIRD_KEY = 'Shift+C'

export const IS_MAC = navigator.platform.toLowerCase().includes('mac')

/** The modifier shown in shortcut hints: ⌘ on macOS, Ctrl elsewhere. */
export const MOD = IS_MAC ? '⌘' : 'Ctrl+'

/** True when a key press is meant for a text field, a dialog or the designer, not for running the show. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    !!target.closest('.modal, .palette, .designer')
  )
}

/** The headline's text on the Lower thirds workspace's canvas (else its first text), selected by Cmd+L (Ctrl+L). */
export const LOWER_THIRD_HEADLINE_ID = 'lower-third-headline'

export function focusLowerThirdHeadline(): void {
  // Once the workspace has opened, and after any menu that asked has closed, so the text keeps the keyboard.
  requestAnimationFrame(() => requestAnimationFrame(focusHeadlineText))
}

/** Selects the text on the canvas: typing (or Enter) then changes its words in place. */
function focusHeadlineText(): void {
  const frame = document.getElementById(LOWER_THIRD_HEADLINE_ID)
  if (!(frame instanceof HTMLElement)) return
  frame.scrollIntoView({ block: 'nearest' })
  frame.focus()
}

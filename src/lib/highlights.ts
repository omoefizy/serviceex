// The keys for live highlighting (shared/highlights.ts): Esc takes the marks off the live slide, Cmd+H (Ctrl+H)
// turns highlight mode on and off, and 1 to 5 pick a color while it is on.

import { HIGHLIGHT_COLORS, isMarked } from '../../shared/highlights'
import type { HighlightColor } from '../../shared/types'
import { selectMarkTarget, useOperatorStore } from '../store'

/** Picks a color: for the highlighter, or for Color text when that is the brush. */
export function pickHighlightColor(color: HighlightColor): void {
  const st = useOperatorStore.getState()
  st.setHighlightStyle({ color, kind: st.highlightStyle.kind === 'color' ? 'color' : 'highlight' })
}

export function toggleHighlightMode(): void {
  const st = useOperatorStore.getState()
  st.setHighlightMode(!st.highlightMode)
}

/** Handles a key press that is not meant for a text field; true when it was a highlighting key. */
export function highlightKey(e: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): boolean {
  const st = useOperatorStore.getState()
  const mod = e.metaKey || e.ctrlKey
  if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'h') {
    toggleHighlightMode()
    return true
  }
  if (mod || e.altKey || e.shiftKey) return false
  if (e.key === 'Escape') {
    if (!isMarked(selectMarkTarget(st, 'live')?.slide)) return false
    st.clearHighlights('live')
    return true
  }
  const digit = /^(?:Digit|Numpad)([1-5])$/.exec(e.code)
  if (digit && st.highlightMode) {
    pickHighlightColor(HIGHLIGHT_COLORS[Number(digit[1]) - 1].id)
    return true
  }
  return false
}

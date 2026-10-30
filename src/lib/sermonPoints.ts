// The keys of the Lower thirds workspace: 1 to 9 put the first nine sermon points on air, Space the next one, Enter
// the lower third staged on Preview, and Esc (or Shift+C anywhere) clears the lower third. Pure, so it is tested.

export type PointAction = { kind: 'point'; index: number } | { kind: 'next' } | { kind: 'takePreview' } | { kind: 'clear' }

interface Key {
  key: string
  code: string
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  ctrlKey: boolean
}

/**
 * What a key does in the workspace with `count` points, or null to leave it to the rest of the app. Never while
 * typing: the operator types points and live text there.
 */
export function pointShortcut(e: Key, count: number, typing: boolean): PointAction | null {
  if (typing || e.altKey || e.metaKey || e.ctrlKey) return null
  // The digit row and the number pad alike, whatever the keyboard layout prints on them.
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)
  if (digit && !e.shiftKey) {
    const index = Number(digit[1]) - 1
    return index < count ? { kind: 'point', index } : null
  }
  if (e.shiftKey) return null
  if (e.key === ' ' || e.code === 'Space') return count > 0 ? { kind: 'next' } : null
  if (e.key === 'Enter') return { kind: 'takePreview' }
  if (e.key === 'Escape') return { kind: 'clear' }
  return null
}

/** A point's shortcut as shown on its row: 1 to 9 for the first nine, none after. */
export const pointKeyLabel = (index: number): string | null => (index < 9 ? String(index + 1) : null)

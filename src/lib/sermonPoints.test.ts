// The Lower thirds workspace keys: 1 to 9 trigger the first nine points, Space the next, Enter takes the Preview
// lower third live, Esc clears; never while typing or with a modifier, and nothing for points that do not exist.
import { describe, expect, it } from 'vitest'
import { pointKeyLabel, pointShortcut } from './sermonPoints'

const key = (key: string, code: string, mods: Partial<{ shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }> = {}) => ({
  key,
  code,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  ...mods,
})

describe('point shortcuts', () => {
  it('maps 1 to 9, on the digit row or the number pad, to the first nine points', () => {
    expect(pointShortcut(key('1', 'Digit1'), 5, false)).toEqual({ kind: 'point', index: 0 })
    expect(pointShortcut(key('5', 'Digit5'), 5, false)).toEqual({ kind: 'point', index: 4 })
    expect(pointShortcut(key('3', 'Numpad3'), 5, false)).toEqual({ kind: 'point', index: 2 })
    expect(pointShortcut(key('9', 'Digit9'), 12, false)).toEqual({ kind: 'point', index: 8 })
    // By the key's place, so a French keyboard's & on the 1 key is still point 1.
    expect(pointShortcut(key('&', 'Digit1'), 3, false)).toEqual({ kind: 'point', index: 0 })
  })

  it('leaves digits past the last point, and 0, to the rest of the app', () => {
    expect(pointShortcut(key('6', 'Digit6'), 5, false)).toBeNull()
    expect(pointShortcut(key('1', 'Digit1'), 0, false)).toBeNull()
    expect(pointShortcut(key('0', 'Digit0'), 5, false)).toBeNull()
  })

  it('goes to the next point with Space, takes Preview live with Enter and clears with Esc', () => {
    expect(pointShortcut(key(' ', 'Space'), 3, false)).toEqual({ kind: 'next' })
    expect(pointShortcut(key(' ', 'Space'), 0, false)).toBeNull()
    expect(pointShortcut(key('Enter', 'Enter'), 0, false)).toEqual({ kind: 'takePreview' })
    expect(pointShortcut(key('Escape', 'Escape'), 0, false)).toEqual({ kind: 'clear' })
  })

  it('does nothing while typing or with a modifier, so typed points, Cmd+1 and Shift+C keep their meaning', () => {
    expect(pointShortcut(key('1', 'Digit1'), 5, true)).toBeNull()
    expect(pointShortcut(key(' ', 'Space'), 5, true)).toBeNull()
    expect(pointShortcut(key('1', 'Digit1', { metaKey: true }), 5, false)).toBeNull()
    expect(pointShortcut(key('1', 'Digit1', { ctrlKey: true }), 5, false)).toBeNull()
    expect(pointShortcut(key('1', 'Digit1', { altKey: true }), 5, false)).toBeNull()
    expect(pointShortcut(key('!', 'Digit1', { shiftKey: true }), 5, false)).toBeNull()
    expect(pointShortcut(key(' ', 'Space', { shiftKey: true }), 5, false)).toBeNull()
    expect(pointShortcut(key('c', 'KeyC'), 5, false)).toBeNull()
  })

  it('labels the first nine rows with their key', () => {
    expect([0, 8, 9].map(pointKeyLabel)).toEqual(['1', '9', null])
  })
})

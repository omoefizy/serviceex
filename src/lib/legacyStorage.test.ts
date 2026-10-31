import { describe, expect, it } from 'vitest'
import { migrateLegacyStorage } from './legacyStorage'

function memoryStorage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries))
  return {
    map,
    get length() {
      return map.size
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  }
}

describe('migrateLegacyStorage', () => {
  it('copies the old keys to their new names, keeping the old ones', () => {
    const storage = memoryStorage({ 'worshipdeck.slideView': '"list"', 'worshipdeck.songDraft.7': '{"form":{}}', 'designer.panels': '[]' })
    expect(migrateLegacyStorage(storage)).toBe(2)
    expect(storage.getItem('serviceex.slideView')).toBe('"list"')
    expect(storage.getItem('serviceex.songDraft.7')).toBe('{"form":{}}')
    expect(storage.getItem('worshipdeck.slideView')).toBe('"list"')
    expect(storage.getItem('designer.panels')).toBe('[]')
  })

  it('never overwrites a value saved under the new name, and runs again as a no-op', () => {
    const storage = memoryStorage({ 'worshipdeck.slideView': '"list"', 'serviceex.slideView': '"grid"' })
    expect(migrateLegacyStorage(storage)).toBe(0)
    expect(storage.getItem('serviceex.slideView')).toBe('"grid"')
  })

  it('does not throw when storage does', () => {
    const storage = { length: 1, key: () => 'worshipdeck.x', getItem: () => 'v', setItem: () => { throw new Error('QuotaExceededError') } }
    expect(migrateLegacyStorage(storage)).toBe(0)
  })
})

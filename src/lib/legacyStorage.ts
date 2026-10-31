// The window's own settings (layout, the Scripture tab's choices, unsaved song drafts) were kept under "worshipdeck."
// keys before the rename; they are now under "serviceex.". On start each old key is copied to its new name unless that
// already holds a value. The old keys stay, as the old data folder does.

const LEGACY_PREFIX = 'worshipdeck.'
const PREFIX = 'serviceex.'

type KeyStore = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem'>

/** Copies the old keys to their new names. Returns how many were copied; never throws. */
export function migrateLegacyStorage(storage: KeyStore): number {
  let copied = 0
  try {
    const keys: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key?.startsWith(LEGACY_PREFIX)) keys.push(key)
    }
    for (const key of keys) {
      const target = PREFIX + key.slice(LEGACY_PREFIX.length)
      const value = storage.getItem(key)
      if (value === null || storage.getItem(target) !== null) continue
      storage.setItem(target, value)
      copied++
    }
  } catch {
    // Storage unavailable or full: those settings start from their defaults.
  }
  return copied
}

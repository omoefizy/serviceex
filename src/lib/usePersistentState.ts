import { useEffect, useState } from 'react'

/**
 * useState that remembers its value in this window's localStorage, for layout choices such as panel widths.
 * Storage can be unavailable or hold an old shape, so reads fall back to the default and `accept` filters bad values.
 */
export function usePersistentState<T>(key: string, initial: T, accept: (value: unknown) => value is T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? 'null')
      return stored !== null && accept(stored) ? stored : initial
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Layout simply resets next time.
    }
  }, [key, value])

  return [value, setValue] as const
}

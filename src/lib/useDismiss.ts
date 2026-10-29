import { useEffect, type RefObject } from 'react'

/** Closes a popup on Escape or on a click outside `ref`. */
export function useDismiss(open: boolean, ref: RefObject<HTMLElement>, close: () => void) {
  useEffect(() => {
    if (!open) return
    const onEvent = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) close()
    }
    window.addEventListener('mousedown', onEvent)
    window.addEventListener('keydown', onEvent)
    return () => {
      window.removeEventListener('mousedown', onEvent)
      window.removeEventListener('keydown', onEvent)
    }
  }, [open, ref, close])
}

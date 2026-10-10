import { useCallback, useEffect, useState } from 'react'
import type { MediaItem } from '../../shared/types'
import { useOperatorStore } from '../store'
import { ensureThumbnails } from './media'

/** The media library, reloaded whenever any view of it changes it, with missing thumbnails filled in. */
export function useMediaLibrary() {
  const [items, setItems] = useState<MediaItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const mediaVersion = useOperatorStore((s) => s.mediaVersion)
  const mediaChanged = useOperatorStore((s) => s.mediaChanged)

  const replace = useCallback((updated: MediaItem) => {
    setItems((list) => list.map((item) => (item.id === updated.id ? updated : item)))
  }, [])

  useEffect(() => {
    let cancelled = false
    window.api.media.list().then(
      (list) => {
        if (cancelled) return
        setItems(list)
        setError(null)
        ensureThumbnails(list, replace)
      },
      (err) => !cancelled && setError(err instanceof Error ? err.message : String(err)),
    )
    return () => {
      cancelled = true
    }
  }, [mediaVersion, replace])

  /** Shows the file picker; resolves to the items added. */
  const importFiles = useCallback(async () => {
    try {
      const added = await window.api.media.import()
      if (added.length > 0) mediaChanged()
      return added
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return []
    }
  }, [mediaChanged])

  return { items, error, setError, importFiles }
}

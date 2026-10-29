import { useCallback, useEffect, useState } from 'react'
import type { MediaItem } from '../../shared/types'
import { useOperatorStore } from '../store'
import { reportError, type ErrorLike } from './errors'
import { ensureThumbnails } from './media'

/** The media library, reloaded whenever any view of it changes it, with missing thumbnails filled in. */
export function useMediaLibrary() {
  const [items, setItems] = useState<MediaItem[]>([])
  /** False until the first list arrives, so the empty state does not flash. */
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<ErrorLike | null>(null)
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
        setLoaded(true)
        setError(null)
        ensureThumbnails(list, replace)
      },
      (err) => !cancelled && setError(reportError('Media', err)),
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
      setError(reportError('Media', err))
      return []
    }
  }, [mediaChanged])

  return { items, loaded, error, setError, importFiles }
}

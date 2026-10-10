import { useCallback, useEffect, useRef, useState } from 'react'
import type { BibleVersionCode, Testament, VerseHit } from '../../shared/types'

export const PAGE_SIZE = 30

interface Filters {
  versions: BibleVersionCode[]
  testament: Testament
  book: string | null
}

/** Keyword search over the local Bible, 30 verses at a time. A null query clears the results. */
export function useVerseSearch(query: string | null, filters: Filters) {
  const [hits, setHits] = useState<VerseHit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  /** Bumped by every new search, so a slow page for an older query cannot land in the newer results. */
  const generation = useRef(0)
  const key = JSON.stringify([query, filters.versions, filters.testament, filters.book])

  useEffect(() => {
    const run = ++generation.current
    if (!query) {
      setHits([])
      setTotal(0)
      setLoading(false)
      return
    }
    setLoading(true)
    window.api.bible
      .search({ query, ...filters, offset: 0, limit: PAGE_SIZE })
      .then((result) => {
        if (run !== generation.current) return
        setHits(result.hits)
        setTotal(result.total)
      })
      .catch(console.error)
      .finally(() => run === generation.current && setLoading(false))
    // `key` stands for the query and filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const loadMore = useCallback(() => {
    if (!query || loading || hits.length >= total) return
    const run = generation.current
    setLoading(true)
    window.api.bible
      .search({ query, ...filters, offset: hits.length, limit: PAGE_SIZE })
      .then((result) => run === generation.current && setHits((current) => [...current, ...result.hits]))
      .catch(console.error)
      .finally(() => run === generation.current && setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loading, hits.length, total])

  return { hits, total, loading, hasMore: hits.length < total, loadMore }
}

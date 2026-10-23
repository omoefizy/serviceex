import { BookPlus, History, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { BOOK_NAMES, formatReference, NEW_TESTAMENT_BOOKS, OLD_TESTAMENT_BOOKS, parseReference } from '../../shared/parseReference'
import type { AiError, BibleVersion, BibleVersionCode, Testament, Verse } from '../../shared/types'
import { passageOf, previewPassage, type ResultItem } from '../lib/scripture'
import { parseVerseCaption } from '../lib/slides'
import {
  isVersionFilter,
  loadBookStructure,
  readScriptureQuery,
  SCRIPTURE_VERSION_KEY,
  searchVersions,
  type BookStructures,
  type ScriptureQuery,
  type VersionFilter,
} from '../lib/referenceSuggestions'
import { usePersistentState } from '../lib/usePersistentState'
import { useVerseSearch } from '../lib/useVerseSearch'
import { selectLiveSlide, useOperatorStore } from '../store'
import { AiButton } from './AiButton'
import { BibleImportModal } from './BibleImportModal'
import { VerseResults, type VerseResultsHandle } from './VerseResults'

const DEBOUNCE_MS = 60
const MAX_RECENT = 8
/** Past the end of the longest chapter, so a chapter-only reference reads the whole chapter. */
const LAST_VERSE = 999

const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string')

const verseRow = (version: BibleVersionCode, verse: Verse): ResultItem => ({
  key: `${version}:${verse.book}:${verse.chapter}:${verse.verse}`,
  version,
  book: verse.book,
  chapter: verse.chapter,
  verseStart: verse.verse,
  verseEnd: verse.verse,
  verses: [verse],
})

/** The rows for a books or chapter listing: each book's first verse, or every verse of the chapter, once per version. */
async function readListing(view: Extract<ScriptureQuery, { kind: 'books' | 'chapter' }>, versions: BibleVersionCode[]): Promise<ResultItem[]> {
  const read = (version: BibleVersionCode, book: string, chapter: number, from: number, to: number) =>
    window.api.bible.getRange(version, book, chapter, from, to).then((verses) => verses.map((verse) => verseRow(version, verse)))
  if (view.kind === 'books') return (await Promise.all(view.books.flatMap((book) => versions.map((ver) => read(ver, book, 1, 1, 1))))).flat()
  const { book, chapter } = view.ref
  const perVersion = await Promise.all(versions.map((ver) => read(ver, book, chapter, 1, LAST_VERSE)))
  // Verse by verse, each version in turn (the sort is stable).
  return perVersion.flat().sort((a, b) => a.verseStart - b.verseStart)
}

/** One search box, all local: the list below it narrows to books, a chapter or keyword matches with every keystroke. */
export function ScripturePanel() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  /** The input the user chose to search as words, overriding the book or chapter listing. */
  const [forceText, setForceText] = useState<string | null>(null)
  /** The row Up and Down have moved to. */
  const [active, setActive] = useState(0)
  /** True after Up or Down, until the next keystroke: Space then ticks the row instead of typing a space. */
  const [navigating, setNavigating] = useState(false)
  const [version, setVersion] = usePersistentState<VersionFilter>(SCRIPTURE_VERSION_KEY, 'KJV', isVersionFilter)
  const [testament, setTestament] = useState<Testament>('all')
  const [bookFilter, setBookFilter] = useState<string | null>(null)
  const [recent, setRecent] = usePersistentState<string[]>('worshipdeck.scripture.recent', [], isStringList)
  /** Verses per chapter, by book, from the database. */
  const [structure, setStructure] = useState<BookStructures>({})
  /** The rows of the books or chapter listing, and the listing they are for. */
  const [listing, setListing] = useState<{ key: string; items: ResultItem[] }>({ key: '', items: [] })
  /** Installed versions, for the version list. */
  const [installed, setInstalled] = useState<BibleVersion[]>([])
  const [importOpen, setImportOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasBible, setHasBible] = useState<boolean | null>(null)
  /** "Search by meaning": the AI names passages; their text is read here from the database. */
  const [meaning, setMeaning] = useState<{ topic: string; items: ResultItem[] } | null>(null)
  const [meaningBusy, setMeaningBusy] = useState(false)
  const [meaningError, setMeaningError] = useState<AiError | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<VerseResultsHandle>(null)
  /** Enter pressed before the debounced query caught up: open the row once the list for `input` is in. */
  const pending = useRef<{ input: string; live: boolean } | null>(null)
  const liveCaption = useOperatorStore((s) => (s.live.itemType === 'scripture' ? (selectLiveSlide(s)?.caption ?? null) : null))

  const versions = searchVersions(version, installed.map((v) => v.code))

  const loadVersions = useCallback(() => {
    window.api.bible.listVersions().then((list) => {
      setInstalled(list)
      // A version that was removed (or never imported here) falls back to the KJV.
      if (list.length > 0) setVersion((current) => (current === 'both' || list.some((v) => v.code === current) ? current : 'KJV'))
    }, console.error)
  }, [setVersion])

  useEffect(() => {
    window.api.bible.listBooks().then(
      (books) => setHasBible(books.length > 0),
      () => setHasBible(false),
    )
    loadVersions()
  }, [loadVersions])

  // Narrow the list after a short pause in typing.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [input])

  const view = useMemo(() => readScriptureQuery(query), [query])
  const asText = forceText === query && query.trim().length >= 2
  const textMode = !meaning && (asText || view.kind === 'text')
  const listView = !meaning && !textMode && (view.kind === 'books' || view.kind === 'chapter') ? view : null
  const chapter = listView?.kind === 'chapter' ? listView.ref : null
  const listKey = listView ? JSON.stringify([listView.kind === 'books' ? listView.books : [listView.ref.book, listView.ref.chapter], versions]) : ''

  // Chapter and verse counts for the book being read, for the chapter buttons.
  useEffect(() => {
    const book = chapter?.book
    if (!book || structure[book]) return
    loadBookStructure(book).then((counts) => setStructure((current) => ({ ...current, [book]: counts })), console.error)
  }, [chapter?.book, structure])

  // Read the books or chapter listing from the database.
  useEffect(() => {
    if (!listView) return
    let stale = false
    readListing(listView, versions).then(
      (items) => !stale && setListing({ key: listKey, items }),
      (err) => !stale && setError(err instanceof Error ? err.message : String(err)),
    )
    return () => {
      stale = true
    }
    // `listKey` stands for the listing and versions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey])

  const search = useVerseSearch(textMode ? query : null, { versions, testament, book: bookFilter })

  const textItems: ResultItem[] = search.hits.map((hit) => ({
    key: String(hit.id),
    version: hit.version,
    book: hit.book,
    chapter: hit.chapter,
    verseStart: hit.verse,
    verseEnd: hit.verse,
    verses: [hit],
    segments: hit.segments,
  }))
  const items = meaning ? meaning.items : textMode ? textItems : listView ? listing.items : []
  const listReady = listView !== null && listing.key === listKey

  /** In the typed verse or range, such as John 3:16-18. */
  const isMarked = (item: ResultItem) =>
    chapter !== null &&
    chapter.verseStart !== null &&
    item.book === chapter.book &&
    item.chapter === chapter.chapter &&
    item.verseStart >= chapter.verseStart &&
    item.verseStart <= (chapter.verseEnd ?? chapter.verseStart)
  const firstRow = () => Math.max(items.findIndex(isMarked), 0)

  const scrollKey = meaning
    ? `meaning:${meaning.topic}`
    : textMode
      ? `text:${query}`
      : `${listing.key}:${chapter?.verseStart}-${chapter?.verseEnd}`
  const resetKey = meaning
    ? `meaning:${meaning.topic}:${version}`
    : textMode
      ? `text:${query}:${version}:${testament}:${bookFilter}`
      : listing.key

  // A new list, or a new verse typed in the same chapter: start at the verse, or at the top.
  useEffect(() => {
    setActive(firstRow())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey])

  const wordsRow =
    listView?.words && query.trim()
      ? {
          label: <>Search verses for “{query.trim()}”</>,
          onChoose: () => {
            setForceText(input)
            setQuery(input)
            remember(input)
            inputRef.current?.focus()
          },
        }
      : undefined
  const rowCount = items.length + (wordsRow ? 1 : 0)

  // Enter came before the list for what was typed: open its first (or typed) row now that it is in.
  useEffect(() => {
    const waiting = pending.current
    if (!waiting || waiting.input !== query || !listReady) return
    pending.current = null
    choose(firstRow(), waiting.live)
  })

  // The list follows the live verse as Up, Down, Left and Right step it, into the next chapter too.
  useEffect(() => {
    const at = liveCaption ? parseVerseCaption(liveCaption) : null
    if (!at || !chapter || at.book !== chapter.book) return
    if (at.chapter === chapter.chapter) {
      const index = items.findIndex((item) => item.verseStart === at.verse && item.version === at.version)
      if (index >= 0) setActive(index)
    } else if (document.activeElement !== inputRef.current) {
      showText(`${at.book} ${at.chapter}:${at.verse}`)
    }
    // Only a change of live verse moves the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveCaption])

  function remember(text: string) {
    const trimmed = text.trim()
    if (trimmed) setRecent((list) => [trimmed, ...list.filter((r) => r.toLowerCase() !== trimmed.toLowerCase())].slice(0, MAX_RECENT))
  }

  function changeInput(text: string) {
    setInput(text)
    setNavigating(false)
    setError(null)
    setMeaning(null)
    setMeaningError(null)
  }

  /** Puts text in the box and shows its list straight away, without waiting for the debounce. */
  function showText(text: string) {
    changeInput(text)
    setQuery(text)
  }

  function completeBook(book: string) {
    showText(`${book} `)
    inputRef.current?.focus()
  }

  /** Previews the row (with the rest of a typed range), or sends it live. A book row completes the book instead. */
  async function openRow(item: ResultItem, live: boolean) {
    if (listView?.kind === 'books') return completeBook(item.book)
    const range = items.filter((i) => i.version === item.version && isMarked(i))
    const asRange = range.length > 1 && range.includes(item)
    try {
      const passage = await passageOf(asRange ? range : [item], asRange ? 'range' : 'sequence')
      if (!passage) throw new Error('Those verses could not be read from the Bible.')
      previewPassage(passage)
      setError(null)
      remember(meaning ? meaning.topic : textMode ? query : asRange && chapter ? formatReference(chapter) : formatReference(item))
      if (live) {
        useOperatorStore.getState().goLive(asRange ? range.indexOf(item) : 0)
        // Hand the keyboard back to slide navigation, so the arrows step the live verse.
        inputRef.current?.blur()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function choose(index: number, live: boolean) {
    if (wordsRow && index === items.length) return wordsRow.onChoose()
    if (items[index]) openRow(items[index], live)
  }

  /** What Tab fills the box with: the highlighted book, or the full book name of a reference typed short. */
  function completion(): string | null {
    if (listView?.kind === 'books') {
      const book = (listReady ? items[active]?.book : undefined) ?? listView.books[0]
      return book ? `${book} ` : null
    }
    if (chapter && !input.trim().toLowerCase().startsWith(chapter.book.toLowerCase())) {
      return chapter.verseStart === null ? `${chapter.book} ${chapter.chapter}` : formatReference(chapter)
    }
    return null
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const mod = e.metaKey || e.ctrlKey
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !mod && !e.altKey) {
      if (rowCount === 0) return
      e.preventDefault()
      const delta = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => Math.min(Math.max(i + delta, 0), rowCount - 1))
      setNavigating(true)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // Typed faster than the debounce: wait for the list of what is in the box.
      if (input !== query && readScriptureQuery(input).kind !== 'text') {
        pending.current = { input, live: mod }
        setQuery(input)
      } else choose(active, mod)
    } else if (e.key === 'Tab' && !e.shiftKey && !mod) {
      const text = completion()
      if (!text) return
      e.preventDefault()
      showText(text)
    } else if (e.key === 'Escape' && input) {
      e.preventDefault()
      showText('')
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      const list = listRef.current
      if (!list) return
      e.preventDefault()
      list.scrollBy({ top: (e.key === 'PageDown' ? 0.9 : -0.9) * list.clientHeight })
    } else if (e.key === ' ' && navigating && active < items.length) {
      e.preventDefault()
      tableRef.current?.toggle(active)
    }
  }

  /** Sends what was typed to the AI once; it returns references, and the text is read from the database here. */
  async function handleMeaning() {
    const topic = input.trim()
    setMeaningBusy(true)
    setMeaningError(null)
    try {
      const answer = await window.api.ai.ask('suggestScripture', { topic })
      if (!answer.ok) {
        setMeaningError(answer.error)
        return
      }
      const allowed = bookFilter ? [bookFilter] : testament === 'old' ? OLD_TESTAMENT_BOOKS : testament === 'new' ? NEW_TESTAMENT_BOOKS : BOOK_NAMES
      const items: ResultItem[] = []
      for (const text of answer.value.references) {
        const ref = parseReference(text)
        if (!ref || !allowed.includes(ref.book)) continue
        for (const ver of versions) {
          const verses = await window.api.bible.getRange(ver, ref.book, ref.chapter, ref.verseStart ?? 1, ref.verseEnd ?? LAST_VERSE)
          if (verses.length === 0) continue
          items.push({
            key: `${ver}:${text}`,
            version: ver,
            book: ref.book,
            chapter: ref.chapter,
            verseStart: verses[0].verse,
            verseEnd: verses[verses.length - 1].verse,
            verses,
          })
        }
      }
      setMeaning({ topic, items })
      remember(topic)
    } catch (err) {
      setMeaningError({ code: 'unavailable', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setMeaningBusy(false)
    }
  }

  function handleTestamentChange(next: Testament) {
    setTestament(next)
    const allowed = next === 'old' ? OLD_TESTAMENT_BOOKS : next === 'new' ? NEW_TESTAMENT_BOOKS : BOOK_NAMES
    if (bookFilter && !allowed.includes(bookFilter)) setBookFilter(null)
  }

  function heading() {
    if (meaning) {
      return (
        <>
          <strong>{meaning.items.length}</strong> passage{meaning.items.length === 1 ? '' : 's'} about “{meaning.topic}”{' '}
          <span className="hint">· found by AI, text from your Bible</span>
        </>
      )
    }
    if (textMode) {
      if (search.loading && search.hits.length === 0) return <span className="hint">Searching…</span>
      return (
        <>
          <strong>{search.total.toLocaleString()}</strong> verse{search.total === 1 ? '' : 's'} for “{query.trim()}”
          {search.total === 0 && <span className="hint"> · try fewer words, or "quotes" for an exact phrase</span>}
        </>
      )
    }
    if (listView?.kind === 'books') {
      return (
        <>
          <strong>{listView.books.length}</strong> book{listView.books.length === 1 ? '' : 's'} starting with “{query.trim()}”
        </>
      )
    }
    if (!chapter) return null
    const count = new Set(items.map((item) => item.verseStart)).size
    if (listReady && count === 0) {
      const chapters = structure[chapter.book]?.length ?? 0
      return (
        <span className="hint">
          {chapters > 0 && chapter.chapter > chapters
            ? `${chapter.book} has ${chapters} chapter${chapters === 1 ? '' : 's'}.`
            : `${chapter.book} ${chapter.chapter} is not in the ${versions.join(' or ')}.`}
        </span>
      )
    }
    return (
      <>
        <strong>
          {chapter.book} {chapter.chapter}
        </strong>
        , {count} verse{count === 1 ? '' : 's'}
      </>
    )
  }

  const bookChoices = testament === 'old' ? OLD_TESTAMENT_BOOKS : testament === 'new' ? NEW_TESTAMENT_BOOKS : BOOK_NAMES
  const chapterCount = chapter ? (structure[chapter.book]?.length ?? 0) : 0
  const showList = meaning !== null || textMode || listView !== null

  return (
    <section className="panel scripture-panel">
      <header className="panel-header">
        <h2>Scripture</h2>
      </header>

      <form className="scripture-search" onSubmit={(e: FormEvent) => e.preventDefault()}>
        <div className="scripture-search-row">
          <input
            ref={inputRef}
            className="input scripture-input"
            type="search"
            aria-label="Search scripture"
            aria-controls="scripture-list"
            placeholder="john 3:16, ps 23, or words like fear of the lord"
            value={input}
            onChange={(e) => changeInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <AiButton
            label="By meaning"
            busyLabel="Searching…"
            busy={meaningBusy}
            disabledReason={hasBible === false ? 'Import the Bible text first' : input.trim() ? null : 'Type what you are looking for first'}
            tooltip="Ask the AI for passages about this; their text still comes from your local Bible"
            onClick={handleMeaning}
          />
        </div>

        <div className="scripture-filters">
          <select className="input" aria-label="Testament" value={testament} onChange={(e) => handleTestamentChange(e.target.value as Testament)}>
            <option value="all">Whole Bible</option>
            <option value="old">Old Testament</option>
            <option value="new">New Testament</option>
          </select>
          <select className="input" aria-label="Book" value={bookFilter ?? ''} onChange={(e) => setBookFilter(e.target.value || null)}>
            <option value="">All books</option>
            {bookChoices.map((book) => (
              <option key={book} value={book}>
                {book}
              </option>
            ))}
          </select>
        </div>
      </form>

      {hasBible === false && <p className="hint">No Bible text yet. Run "npm run import:bible", then try again.</p>}

      {!input.trim() && recent.length > 0 && (
        <div className="recent-searches">
          <span className="hint">
            <History size={13} aria-hidden="true" /> Recent
          </span>
          <ul className="chips">
            {recent.map((text) => (
              <li key={text}>
                <button
                  type="button"
                  className="chip add"
                  onClick={() => {
                    showText(text)
                    inputRef.current?.focus()
                  }}
                >
                  {text}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="icon-button" aria-label="Clear recent searches" title="Clear recent searches" onClick={() => setRecent([])}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="scripture-body">
        <nav className="version-list" aria-label="Bible versions">
          {[{ code: 'both', name: 'Search every installed version' }, ...installed].map((v) => (
            <button
              key={v.code}
              type="button"
              className={`version-item${version === v.code ? ' active' : ''}`}
              aria-pressed={version === v.code}
              title={v.name}
              onClick={() => setVersion(v.code)}
            >
              {v.code === 'both' ? 'All' : v.code}
            </button>
          ))}
          <button type="button" className="version-item version-import" title="Import a Bible version your church owns" onClick={() => setImportOpen(true)}>
            <BookPlus size={14} aria-hidden="true" />
            <span>Import</span>
          </button>
        </nav>

        <div className="scripture-results">
          {error && <p className="error">{error}</p>}
          {meaningError && (
            <p className="error" role="alert">
              {meaningError.message}
            </p>
          )}

          {chapter && chapterCount > 1 && (
            <div className="chapter-buttons" role="group" aria-label={`${chapter.book} chapters`}>
              {Array.from({ length: chapterCount }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`chapter-button${n === chapter.chapter ? ' active' : ''}`}
                  aria-pressed={n === chapter.chapter}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    showText(`${chapter.book} ${n}`)
                    inputRef.current?.focus()
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          )}

          <div className="scripture-list" id="scripture-list" ref={listRef}>
            {showList && (
              <VerseResults
                ref={tableRef}
                items={items}
                heading={heading()}
                resetKey={resetKey}
                scrollKey={scrollKey}
                active={active}
                onActiveChange={setActive}
                isMarked={isMarked}
                onOpen={openRow}
                footer={wordsRow}
                hasMore={textMode && search.hasMore}
                loading={textMode && search.loading}
                onLoadMore={textMode ? search.loadMore : undefined}
                onUse={() => remember(meaning ? meaning.topic : query)}
              />
            )}
          </div>
        </div>
      </div>

      {importOpen && <BibleImportModal versions={installed} onChanged={loadVersions} onClose={() => setImportOpen(false)} />}
    </section>
  )
}

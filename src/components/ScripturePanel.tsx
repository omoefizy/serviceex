import { BookPlus, History, ListPlus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  BOOK_NAMES,
  formatReference,
  NEW_TESTAMENT_BOOKS,
  OLD_TESTAMENT_BOOKS,
  parseReference,
  type ScriptureReference,
} from '../../shared/parseReference'
import type { AiError, BibleVersion, BibleVersionCode, ScripturePayload, Testament, Verse } from '../../shared/types'
import { loadScripture, type ResultItem } from '../lib/scripture'
import {
  bookNeeded,
  isKeywordQuery,
  isVersionFilter,
  loadBookStructure,
  referenceVersion as referenceVersionOf,
  SCRIPTURE_VERSION_KEY,
  searchVersions,
  suggestReferences,
  type BookStructures,
  type ReferenceSuggestion,
  type VersionFilter,
} from '../lib/referenceSuggestions'
import { usePersistentState } from '../lib/usePersistentState'
import { useVerseSearch } from '../lib/useVerseSearch'
import { useOperatorStore } from '../store'
import { AiButton } from './AiButton'
import { BibleImportModal } from './BibleImportModal'
import { PassageTable } from './PassageTable'
import { VerseResults } from './VerseResults'

const DEBOUNCE_MS = 120
const MAX_RECENT = 8
/** Past the end of the longest chapter, so a chapter-only reference reads the whole chapter. */
const LAST_VERSE = 999

type Suggestion = ReferenceSuggestion

const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string')

/** One search box, all local: references with book, chapter and verse suggestions, or full-text search. */
export function ScripturePanel() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  /** The input the user chose to search as words, overriding reference suggestions. */
  const [forceText, setForceText] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [version, setVersion] = usePersistentState<VersionFilter>(SCRIPTURE_VERSION_KEY, 'KJV', isVersionFilter)
  const [testament, setTestament] = useState<Testament>('all')
  const [bookFilter, setBookFilter] = useState<string | null>(null)
  const [recent, setRecent] = usePersistentState<string[]>('worshipdeck.scripture.recent', [], isStringList)
  /** Verses per chapter, by book, from the database. */
  const [structure, setStructure] = useState<BookStructures>({})
  const [loaded, setLoaded] = useState<ScriptureReference | null>(null)
  /** The passage last loaded into the grid, ready to add to the schedule. */
  const [result, setResult] = useState<ScripturePayload | null>(null)
  /** The rest of the chapter after `result`, and the version both were read in, for the passage table. */
  const [following, setFollowing] = useState<{ version: BibleVersionCode; verses: Verse[] }>({ version: 'KJV', verses: [] })
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
  const service = useOperatorStore((s) => s.service)
  const addToSchedule = useOperatorStore((s) => s.addToSchedule)

  const versions = searchVersions(version, installed.map((v) => v.code))
  const referenceVersion = referenceVersionOf(version)

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

  // Classify after a short pause in typing.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [input])

  const asText = forceText === query
  const textMode = asText ? query.trim().length >= 2 : isKeywordQuery(query)
  const readingBook = asText ? null : bookNeeded(query)

  // Chapter and verse counts for the book being typed.
  useEffect(() => {
    if (!readingBook || structure[readingBook]) return
    loadBookStructure(readingBook).then(
      (counts) => setStructure((current) => ({ ...current, [readingBook]: counts })),
      console.error,
    )
  }, [readingBook, structure])

  const suggestions = useMemo(() => (asText ? [] : suggestReferences(query, structure)), [asText, query, structure])

  const showDropdown = dropdownOpen && suggestions.length > 0 && input === query
  const search = useVerseSearch(textMode ? query : null, { versions, testament, book: bookFilter })

  function remember(text: string) {
    const trimmed = text.trim()
    if (trimmed) setRecent((list) => [trimmed, ...list.filter((r) => r.toLowerCase() !== trimmed.toLowerCase())].slice(0, MAX_RECENT))
  }

  function changeInput(text: string) {
    setInput(text)
    setDropdownOpen(true)
    setActive(-1)
    setError(null)
    setMeaning(null)
    setMeaningError(null)
  }

  async function load(ref: ScriptureReference, ver: BibleVersionCode): Promise<boolean> {
    try {
      const passage = await loadScripture(ref, ver)
      if (!passage) {
        const books = await window.api.bible.listBooks()
        setHasBible(books.length > 0)
        setError(books.length > 0 ? `${formatReference(ref)} is not in the ${ver}.` : null)
        return false
      }
      setLoaded(ref)
      setResult(passage)
      setError(null)
      // The verses after it, to the end of the chapter, so the operator sees what is coming.
      const last = ref.verseEnd ?? ref.verseStart ?? LAST_VERSE
      const next = last >= LAST_VERSE ? [] : await window.api.bible.getRange(ver, ref.book, ref.chapter, last + 1, LAST_VERSE)
      setFollowing({ version: ver, verses: next })
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }

  async function openReference(ref: ScriptureReference) {
    setDropdownOpen(false)
    remember(formatReference(ref))
    // Hand the keyboard back to slide navigation once the verses are in the grid.
    if (await load(ref, referenceVersion)) inputRef.current?.blur()
  }

  function choose(suggestion: Suggestion) {
    switch (suggestion.kind) {
      case 'book':
        changeInput(`${suggestion.book} `)
        break
      case 'chapter':
        changeInput(`${suggestion.book} ${suggestion.chapter}:`)
        break
      case 'text':
        setForceText(input)
        setQuery(input)
        setDropdownOpen(false)
        remember(input)
        break
      default:
        setInput(suggestion.label.replace(' (whole chapter)', ''))
        openReference(suggestion.ref)
    }
    inputRef.current?.focus()
  }

  /** Tab fills the box with the suggestion without opening it. */
  function complete(suggestion: Suggestion) {
    if (suggestion.kind === 'book' || suggestion.kind === 'chapter') choose(suggestion)
    else if (suggestion.kind === 'verse' || suggestion.kind === 'reference') changeInput(suggestion.label)
    else if (suggestion.kind === 'wholeChapter') changeInput(`${suggestion.ref.book} ${suggestion.ref.chapter}`)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const count = showDropdown ? suggestions.length : 0
    if (e.key === 'ArrowDown' && count > 0) {
      e.preventDefault()
      setActive((i) => (i + 1) % count)
    } else if (e.key === 'ArrowUp' && count > 0) {
      e.preventDefault()
      setActive((i) => (i <= 0 ? count - 1 : i - 1))
    } else if (e.key === 'Tab' && count > 0) {
      e.preventDefault()
      complete(suggestions[Math.max(active, 0)])
    } else if (e.key === 'Escape' && showDropdown) {
      e.preventDefault()
      setDropdownOpen(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    // Use the box as typed, not the debounced copy, so a fast Enter is not lost.
    const typed = input
    if (showDropdown && active >= 0) return choose(suggestions[active])
    const ref = forceText === typed ? null : parseReference(typed)
    if (ref) return openReference(ref)
    if (showDropdown && suggestions[0]?.kind === 'book') return choose(suggestions[0])
    if (typed.trim().length >= 2) {
      setQuery(typed)
      setDropdownOpen(false)
      remember(typed)
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
      setDropdownOpen(false)
      remember(topic)
    } catch (err) {
      setMeaningError({ code: 'unavailable', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setMeaningBusy(false)
    }
  }

  async function handleAddToSchedule(passage: ScripturePayload) {
    try {
      await addToSchedule('scripture', null, passage)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function handleVersionChange(next: VersionFilter) {
    setVersion(next)
    if (loaded) load(loaded, referenceVersionOf(next))
  }

  /** A verse from the passage table's following rows, in the grid on its own; the table keeps its place. */
  async function openFollowingVerse(verse: number, live: boolean) {
    if (!loaded) return
    try {
      const passage = await loadScripture({ book: loaded.book, chapter: loaded.chapter, verseStart: verse, verseEnd: verse }, following.version)
      if (passage && live) useOperatorStore.getState().goLive(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function handleTestamentChange(next: Testament) {
    setTestament(next)
    const allowed = next === 'old' ? OLD_TESTAMENT_BOOKS : next === 'new' ? NEW_TESTAMENT_BOOKS : BOOK_NAMES
    if (bookFilter && !allowed.includes(bookFilter)) setBookFilter(null)
  }

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
  const bookChoices = testament === 'old' ? OLD_TESTAMENT_BOOKS : testament === 'new' ? NEW_TESTAMENT_BOOKS : BOOK_NAMES
  const activeId = showDropdown && active >= 0 ? `scripture-suggestion-${active}` : undefined

  return (
    <section className="panel scripture-panel">
      <header className="panel-header">
        <h2>Scripture</h2>
      </header>

      <form className="scripture-search" onSubmit={handleSubmit}>
        <div className="scripture-search-row">
          <div className="scripture-combobox">
            <input
              ref={inputRef}
              className="input"
              type="search"
              role="combobox"
              aria-label="Search scripture"
              aria-expanded={showDropdown}
              aria-controls="scripture-suggestions"
              aria-autocomplete="list"
              aria-activedescendant={activeId}
              placeholder="john 3:16, ps 23, or words like fear of the lord"
              value={input}
              onChange={(e) => changeInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setDropdownOpen(true)}
              onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
            />
            {showDropdown && (
              <ul className="search-suggest" id="scripture-suggestions" role="listbox">
                {suggestions.map((suggestion, index) => (
                  <li
                    key={`${suggestion.kind}-${suggestion.label}`}
                    id={`scripture-suggestion-${index}`}
                    role="option"
                    aria-selected={index === active}
                    className={`search-suggest-item${index === active ? ' active' : ''}${suggestion.kind === 'text' ? ' text' : ''}`}
                    // Keep focus in the input while choosing.
                    onMouseDown={(e) => {
                      e.preventDefault()
                      choose(suggestion)
                    }}
                    onMouseMove={() => setActive(index)}
                  >
                    {suggestion.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
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
                    changeInput(text)
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
              onClick={() => handleVersionChange(v.code)}
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
          {result && (
            <div className="scripture-result">
              <span>{result.title}</span>
              <button
                className="button"
                title={service ? `Add to ${service.name}` : 'Create a service first'}
                disabled={!service}
                onClick={() => handleAddToSchedule(result)}
              >
                <ListPlus size={15} aria-hidden="true" /> Schedule
              </button>
            </div>
          )}
          {error && <p className="error">{error}</p>}
          {meaningError && (
            <p className="error" role="alert">
              {meaningError.message}
            </p>
          )}

          {meaning ? (
            <VerseResults
              items={meaning.items}
              resetKey={`meaning:${meaning.topic}:${version}`}
              heading={
                <>
                  <strong>{meaning.items.length}</strong> passage{meaning.items.length === 1 ? '' : 's'} about “{meaning.topic}”{' '}
                  <span className="hint">· found by AI, text from your Bible</span>
                </>
              }
              onUse={() => remember(meaning.topic)}
            />
          ) : (
            textMode && (
              <VerseResults
                items={textItems}
                resetKey={`text:${query}:${version}:${testament}:${bookFilter}`}
                heading={
                  search.loading && search.hits.length === 0 ? (
                    <span className="hint">Searching…</span>
                  ) : (
                    <>
                      <strong>{search.total.toLocaleString()}</strong> verse{search.total === 1 ? '' : 's'}
                      {search.total === 0 && <span className="hint"> · try fewer words, or "quotes" for an exact phrase</span>}
                    </>
                  )
                }
                hasMore={search.hasMore}
                loading={search.loading}
                onLoadMore={search.loadMore}
                onUse={() => remember(query)}
              />
            )
          )}

          {!meaning && !textMode && result && (
            <PassageTable passage={result} following={following.verses} version={following.version} onOpenVerse={openFollowingVerse} />
          )}
        </div>
      </div>

      {importOpen && <BibleImportModal versions={installed} onChanged={loadVersions} onClose={() => setImportOpen(false)} />}
    </section>
  )
}

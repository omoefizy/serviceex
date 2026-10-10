import { History, ListPlus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  BOOK_NAMES,
  formatReference,
  NEW_TESTAMENT_BOOKS,
  OLD_TESTAMENT_BOOKS,
  parseReference,
  readReferenceInput,
  type ScriptureReference,
} from '../../shared/parseReference'
import type { AiError, BibleVersionCode, ScripturePayload, Testament } from '../../shared/types'
import { loadScripture, type ResultItem } from '../lib/scripture'
import { usePersistentState } from '../lib/usePersistentState'
import { useVerseSearch } from '../lib/useVerseSearch'
import { useOperatorStore } from '../store'
import { AiButton } from './AiButton'
import { VerseResults } from './VerseResults'

type VersionFilter = BibleVersionCode | 'both'

const DEBOUNCE_MS = 120
const MAX_RECENT = 8
const MAX_SUGGESTIONS = 40
/** Past the end of the longest chapter, so a chapter-only reference reads the whole chapter. */
const LAST_VERSE = 999

type Suggestion =
  | { kind: 'book'; label: string; book: string }
  | { kind: 'chapter'; label: string; book: string; chapter: number }
  | { kind: 'wholeChapter'; label: string; ref: ScriptureReference }
  | { kind: 'verse'; label: string; ref: ScriptureReference }
  | { kind: 'reference'; label: string; ref: ScriptureReference }
  /** Searches the words instead, for inputs that are also book names, such as "job" or "mark". */
  | { kind: 'text'; label: string }

const isVersionFilter = (v: unknown): v is VersionFilter => v === 'KJV' || v === 'WEB' || v === 'both'
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string')

/** One search box, all local: references with book, chapter and verse suggestions, or full-text search. */
export function ScripturePanel() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  /** The input the user chose to search as words, overriding reference suggestions. */
  const [forceText, setForceText] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [version, setVersion] = usePersistentState<VersionFilter>('worshipdeck.scripture.version', 'KJV', isVersionFilter)
  const [testament, setTestament] = useState<Testament>('all')
  const [bookFilter, setBookFilter] = useState<string | null>(null)
  const [recent, setRecent] = usePersistentState<string[]>('worshipdeck.scripture.recent', [], isStringList)
  /** Verses per chapter, by book, from the database. */
  const [structure, setStructure] = useState<Record<string, number[]>>({})
  const [loaded, setLoaded] = useState<ScriptureReference | null>(null)
  /** The passage last loaded into the grid, ready to add to the schedule. */
  const [result, setResult] = useState<ScripturePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasBible, setHasBible] = useState<boolean | null>(null)
  /** "Search by meaning": the AI names passages; their text is read here from the database. */
  const [meaning, setMeaning] = useState<{ topic: string; items: ResultItem[] } | null>(null)
  const [meaningBusy, setMeaningBusy] = useState(false)
  const [meaningError, setMeaningError] = useState<AiError | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const service = useOperatorStore((s) => s.service)
  const addToSchedule = useOperatorStore((s) => s.addToSchedule)

  const versions: BibleVersionCode[] = version === 'both' ? ['KJV', 'WEB'] : [version]
  /** References open in one version; with "Both" that is the KJV. */
  const referenceVersion: BibleVersionCode = version === 'both' ? 'KJV' : version

  useEffect(() => {
    window.api.bible.listBooks().then(
      (books) => setHasBible(books.length > 0),
      () => setHasBible(false),
    )
  }, [])

  // Classify after a short pause in typing.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [input])

  const reading = forceText === query ? null : readReferenceInput(query)
  const parsed = forceText === query ? null : parseReference(query)
  const textMode = query.trim().length >= 2 && !reading && !parsed
  const readingBook = reading && reading.stage !== 'book' ? reading.book : null

  // Chapter and verse counts for the book being typed.
  useEffect(() => {
    if (!readingBook || structure[readingBook]) return
    window.api.bible.bookStructure(readingBook).then(
      (counts) => setStructure((current) => ({ ...current, [readingBook]: counts })),
      console.error,
    )
  }, [readingBook, structure])

  const suggestions = useMemo((): Suggestion[] => {
    if (query.trim().length < 2) return []
    if (reading?.stage === 'book') {
      const books: Suggestion[] = reading.books.slice(0, 12).map((book) => ({ kind: 'book', label: book, book }))
      return [...books, { kind: 'text', label: `Search verses for “${query.trim()}”` }]
    }
    if (reading?.stage === 'chapter') {
      const counts = structure[reading.book] ?? []
      return counts
        .map((_, i) => i + 1)
        .filter((chapter) => String(chapter).startsWith(reading.chapterPrefix))
        .slice(0, MAX_SUGGESTIONS)
        .map((chapter) => ({ kind: 'chapter', label: `${reading.book} ${chapter}`, book: reading.book, chapter }))
    }
    if (reading?.stage === 'verse') {
      const count = structure[reading.book]?.[reading.chapter - 1] ?? 0
      const verses: Suggestion[] = Array.from({ length: count }, (_, i) => i + 1)
        .filter((verse) => String(verse).startsWith(reading.versePrefix))
        .slice(0, MAX_SUGGESTIONS)
        .map((verse) => ({
          kind: 'verse',
          label: `${reading.book} ${reading.chapter}:${verse}`,
          ref: { book: reading.book, chapter: reading.chapter, verseStart: verse, verseEnd: verse },
        }))
      if (count === 0 || reading.versePrefix) return verses
      const whole: Suggestion = {
        kind: 'wholeChapter',
        label: `${reading.book} ${reading.chapter} (whole chapter)`,
        ref: { book: reading.book, chapter: reading.chapter, verseStart: null, verseEnd: null },
      }
      return [whole, ...verses]
    }
    if (parsed) return [{ kind: 'reference', label: formatReference(parsed), ref: parsed }]
    return []
  }, [query, reading, parsed, structure])

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
    if (loaded) load(loaded, next === 'both' ? 'KJV' : next)
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
          <select className="input" aria-label="Version" value={version} onChange={(e) => handleVersionChange(e.target.value as VersionFilter)}>
            <option value="KJV">KJV</option>
            <option value="WEB">WEB</option>
            <option value="both">Both</option>
          </select>
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
    </section>
  )
}

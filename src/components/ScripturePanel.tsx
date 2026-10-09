import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { BibleVersionCode, ScripturePayload } from '../../shared/types'
import { formatReference, parseReference, type ScriptureReference } from '../lib/parseReference'
import { useOperatorStore } from '../store'

const VERSIONS: BibleVersionCode[] = ['KJV', 'WEB']

/** Past the end of the longest chapter (Psalm 119 has 176 verses), so "John 3" loads the whole chapter. */
const LAST_VERSE = 999

export function ScripturePanel() {
  const [input, setInput] = useState('')
  const [version, setVersion] = useState<BibleVersionCode>('KJV')
  const [loaded, setLoaded] = useState<ScriptureReference | null>(null)
  /** The passage last loaded into the grid, ready to add to the schedule. */
  const [result, setResult] = useState<ScripturePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasBible, setHasBible] = useState<boolean | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectScripture = useOperatorStore((s) => s.selectScripture)
  const service = useOperatorStore((s) => s.service)
  const addToSchedule = useOperatorStore((s) => s.addToSchedule)
  const reference = parseReference(input)

  useEffect(() => {
    window.api.bible.listBooks().then(
      (books) => setHasBible(books.length > 0),
      () => setHasBible(false),
    )
  }, [])

  async function load(ref: ScriptureReference, ver: BibleVersionCode): Promise<boolean> {
    try {
      const verses = await window.api.bible.getRange(
        ver,
        ref.book,
        ref.chapter,
        ref.verseStart ?? 1,
        ref.verseEnd ?? LAST_VERSE,
      )
      if (verses.length === 0) {
        const books = await window.api.bible.listBooks()
        setHasBible(books.length > 0)
        setError(books.length > 0 ? `${formatReference(ref)} is not in the ${ver}.` : null)
        return false
      }
      const passage: ScripturePayload = {
        title: `${formatReference(ref)} ${ver}`,
        verses: verses.map((v) => ({ text: v.text, caption: `${v.book} ${v.chapter}:${v.verse} ${ver}` })),
      }
      selectScripture(passage.title, passage.verses)
      setLoaded(ref)
      setResult(passage)
      setError(null)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!reference) {
      setError(input.trim() ? `"${input.trim()}" is not a reference I recognise.` : null)
      return
    }
    // Hand the keyboard back to slide navigation once the verses are in the grid.
    if (await load(reference, version)) inputRef.current?.blur()
  }

  async function handleAddToSchedule(passage: ScripturePayload) {
    try {
      await addToSchedule('scripture', null, passage)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function handleVersionChange(next: BibleVersionCode) {
    setVersion(next)
    if (loaded) load(loaded, next)
  }

  let hint: string
  if (hasBible === false) hint = 'No Bible text yet. Run "npm run import:bible", then try again.'
  else if (reference) hint = `${formatReference(reference)} ${version}, press Enter`
  else if (input.trim()) hint = 'Keep typing a reference.'
  else hint = 'Type a reference such as "jn 3:16" or "1 cor 13:4-7", then press Enter.'

  return (
    <section className="panel scripture-panel">
      <header className="panel-header">
        <h2>Scripture</h2>
        <select
          className="input version-select"
          aria-label="Bible version"
          value={version}
          onChange={(e) => handleVersionChange(e.target.value as BibleVersionCode)}
        >
          {VERSIONS.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </header>

      <form onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          className="input"
          type="search"
          placeholder="Reference, e.g. john 3 16-18"
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setError(null)
          }}
        />
      </form>

      <p className="hint">{hint}</p>
      {result && (
        <div className="scripture-result">
          <span>{result.title}</span>
          <button
            className="button"
            title={service ? `Add to ${service.name}` : 'Create a service first'}
            disabled={!service}
            onClick={() => handleAddToSchedule(result)}
          >
            + Schedule
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

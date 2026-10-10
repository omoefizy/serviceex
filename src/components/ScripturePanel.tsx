import { ListPlus } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AiError, BibleVersionCode, ScripturePayload } from '../../shared/types'
import { formatReference, parseReference, type ScriptureReference } from '../../shared/parseReference'
import { fetchPassage, loadScripture } from '../lib/scripture'
import { useOperatorStore } from '../store'
import { AiButton } from './AiButton'

const VERSIONS: BibleVersionCode[] = ['KJV', 'WEB']

export function ScripturePanel() {
  const [input, setInput] = useState('')
  const [version, setVersion] = useState<BibleVersionCode>('KJV')
  const [loaded, setLoaded] = useState<ScriptureReference | null>(null)
  /** The passage last loaded into the grid, ready to add to the schedule. */
  const [result, setResult] = useState<ScripturePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasBible, setHasBible] = useState<boolean | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const service = useOperatorStore((s) => s.service)
  const addToSchedule = useOperatorStore((s) => s.addToSchedule)
  const reference = parseReference(input)
  /** Topic search: what was typed, the references the AI found, and their text from the local Bible. */
  const [topic, setTopic] = useState('')
  const [searching, setSearching] = useState(false)
  const [topicError, setTopicError] = useState<AiError | null>(null)
  const [topicRefs, setTopicRefs] = useState<string[] | null>(null)
  const [topicPassages, setTopicPassages] = useState<Record<string, ScripturePayload | null>>({})

  // The AI only names passages; their wording always comes from the local Bible, in the chosen version.
  useEffect(() => {
    if (!topicRefs) return
    let cancelled = false
    Promise.all(
      topicRefs.map(async (text) => {
        const ref = parseReference(text)
        return [text, ref ? await fetchPassage(ref, version) : null] as const
      }),
    ).then(
      (entries) => !cancelled && setTopicPassages(Object.fromEntries(entries)),
      (err) => console.error(err),
    )
    return () => {
      cancelled = true
    }
  }, [topicRefs, version])

  useEffect(() => {
    window.api.bible.listBooks().then(
      (books) => setHasBible(books.length > 0),
      () => setHasBible(false),
    )
  }, [])

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

  /** Sends the topic once, from the click; references come back already checked against the Bible database. */
  async function handleTopicSearch(e: FormEvent) {
    e.preventDefault()
    if (!topic.trim() || searching) return
    setSearching(true)
    setTopicError(null)
    try {
      const answer = await window.api.ai.ask('suggestScripture', { topic })
      if (answer.ok) setTopicRefs(answer.value.references)
      else setTopicError(answer.error)
    } catch (err) {
      setTopicError({ code: 'unavailable', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setSearching(false)
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
            <ListPlus size={15} aria-hidden="true" /> Schedule
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      <form className="topic-search" onSubmit={handleTopicSearch}>
        <label className="field">
          <span>
            Topic search <small>Search by meaning</small>
          </span>
          <div className="settings-row">
            <input
              className="input"
              type="search"
              placeholder="e.g. verses about fear"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
            <AiButton
              type="submit"
              label="Find"
              busyLabel="Finding…"
              busy={searching}
              disabledReason={hasBible === false ? 'Import the Bible text first' : topic.trim() ? null : 'Type a topic first'}
              tooltip="Find passages about this topic; their text comes from your local Bible"
            />
          </div>
        </label>
        {searching && (
          <p className="hint" role="status">
            Looking for passages…
          </p>
        )}
        {topicError && (
          <p className="error" role="alert">
            {topicError.message}
          </p>
        )}
        {topicRefs && !searching && (
          <ul className="topic-results">
            {topicRefs.map((text) => {
              const passage = topicPassages[text]
              const ref = parseReference(text)
              return (
                <li key={text} className="topic-result">
                  <button type="button" className="topic-result-main" disabled={!ref || !passage} onClick={() => ref && load(ref, version)}>
                    <strong>
                      {text} {version}
                    </strong>
                    <span className="topic-result-text">
                      {passage === undefined ? 'Loading…' : passage ? passage.verses.map((v) => v.text).join(' ') : `Not in the ${version}`}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Add ${text} to schedule`}
                    title={service ? `Add to ${service.name}` : 'Create a service first'}
                    disabled={!service || !passage}
                    onClick={() => passage && handleAddToSchedule(passage)}
                  >
                    <ListPlus size={15} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </form>
    </section>
  )
}

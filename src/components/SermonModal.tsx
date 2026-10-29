import { ListPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { parseReference } from '../../shared/parseReference'
import type { AiError, AiTasks, BibleVersionCode, ScripturePayload } from '../../shared/types'
import { describeError, reportError, type ErrorLike } from '../lib/errors'
import { fetchPassage } from '../lib/scripture'
import { useOperatorStore } from '../store'
import { AiButton } from './AiButton'
import { ErrorNote } from './ui'

const VERSIONS: BibleVersionCode[] = ['KJV', 'WEB']

type Sermon = AiTasks['sermonToSlides']['output']

interface Props {
  onClose(): void
}

/**
 * Paste a sermon outline; the AI picks out key points and the references it mentions (checked against the
 * Bible database). Review them, then add them to the service in one go: the points as an announcement with a
 * title slide, each reference as a scripture item whose text comes from the local Bible.
 */
export function SermonModal({ onClose }: Props) {
  const service = useOperatorStore((s) => s.service)
  const addToSchedule = useOperatorStore((s) => s.addToSchedule)
  const [outline, setOutline] = useState('')
  const [version, setVersion] = useState<BibleVersionCode>('KJV')
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [aiError, setAiError] = useState<AiError | null>(null)
  const [error, setError] = useState<ErrorLike | null>(null)
  const [sermon, setSermon] = useState<Sermon | null>(null)
  /** Which points and references to add; all start ticked. */
  const [pointsOn, setPointsOn] = useState<boolean[]>([])
  const [refsOn, setRefsOn] = useState<boolean[]>([])
  const [passages, setPassages] = useState<Record<string, ScripturePayload | null>>({})

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Verse text for the previews and the scripture items, from the local Bible in the chosen version.
  useEffect(() => {
    if (!sermon) return
    let cancelled = false
    Promise.all(
      sermon.references.map(async (text) => {
        const ref = parseReference(text)
        return [text, ref ? await fetchPassage(ref, version) : null] as const
      }),
    ).then(
      (entries) => !cancelled && setPassages(Object.fromEntries(entries)),
      (err) => console.error(err),
    )
    return () => {
      cancelled = true
    }
  }, [sermon, version])

  /** Sends the outline once, from the click. */
  async function handleFind() {
    setBusy(true)
    setAiError(null)
    try {
      const answer = await window.api.ai.ask('sermonToSlides', { outline })
      if (answer.ok) {
        setSermon(answer.value)
        setPointsOn(answer.value.points.map(() => true))
        setRefsOn(answer.value.references.map(() => true))
      } else {
        setAiError(answer.error)
      }
    } catch (err) {
      setAiError({ code: 'unavailable', message: reportError('Sermon outline', err).message })
    } finally {
      setBusy(false)
    }
  }

  const points = sermon ? sermon.points.filter((_, i) => pointsOn[i]).map((p) => p.trim()).filter(Boolean) : []
  const references = sermon ? sermon.references.filter((_, i) => refsOn[i]) : []
  const itemCount = (points.length > 0 ? 1 : 0) + references.filter((r) => passages[r]).length

  async function handleAdd() {
    if (!sermon) return
    setAdding(true)
    setError(null)
    try {
      if (points.length > 0) {
        await addToSchedule('announcement', null, { title: sermon.title, body: points.join('\n\n'), titleSlide: true })
      }
      for (const reference of references) {
        const passage = passages[reference]
        if (passage) await addToSchedule('scripture', null, passage)
      }
      onClose()
    } catch (err) {
      setError(reportError('Sermon outline', err))
      setAdding(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal sermon-modal" role="dialog" aria-label="Sermon to slides" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Sermon to slides</h2>

        <label className="field">
          <span>
            Sermon outline <small>The AI finds the key points and every Bible reference mentioned</small>
          </span>
          <textarea className="input" rows={6} value={outline} onChange={(e) => setOutline(e.target.value)} autoFocus />
        </label>
        <div className="settings-row">
          <AiButton
            feature="ai.sermonPoints"
            label="Find Points and Verses"
            busyLabel="Reading the outline…"
            busy={busy}
            disabledReason={outline.trim() ? null : 'Paste an outline first'}
            tooltip="Pick out the key points and the Bible references in this outline"
            onClick={handleFind}
          />
          {busy && (
            <span className="hint" role="status">
              This usually takes a few seconds.
            </span>
          )}
        </div>
        <ErrorNote error={aiError && describeError(aiError)} />

        {sermon && (
          <>
            <div className="field">
              <span>
                Key points <small>Added as one announcement, “{sermon.title}”, starting with a title slide</small>
              </span>
              <ul className="sermon-list">
                {sermon.points.map((point, index) => (
                  <li key={index}>
                    <input
                      type="checkbox"
                      aria-label={`Include point ${index + 1}`}
                      checked={pointsOn[index] ?? false}
                      onChange={(e) => setPointsOn((on) => on.map((v, i) => (i === index ? e.target.checked : v)))}
                    />
                    <input
                      className="input"
                      aria-label={`Point ${index + 1}`}
                      value={point}
                      onChange={(e) =>
                        setSermon((current) => current && { ...current, points: current.points.map((p, i) => (i === index ? e.target.value : p)) })
                      }
                    />
                  </li>
                ))}
              </ul>
            </div>

            <div className="field">
              <span className="sermon-refs-head">
                Scripture <small>Each becomes a scripture item; the text comes from your local Bible</small>
                <select className="input version-select" aria-label="Bible version" value={version} onChange={(e) => setVersion(e.target.value as BibleVersionCode)}>
                  {VERSIONS.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </span>
              {sermon.references.length === 0 && <p className="hint">No Bible references were found in the outline.</p>}
              <ul className="sermon-list">
                {sermon.references.map((reference, index) => {
                  const passage = passages[reference]
                  return (
                    <li key={reference}>
                      <input
                        type="checkbox"
                        aria-label={`Include ${reference}`}
                        checked={refsOn[index] ?? false}
                        disabled={passage === null}
                        onChange={(e) => setRefsOn((on) => on.map((v, i) => (i === index ? e.target.checked : v)))}
                      />
                      <div className="sermon-ref">
                        <strong>
                          {reference} {version}
                        </strong>
                        <span className="topic-result-text">
                          {passage === undefined ? 'Loading…' : passage ? passage.verses.map((v) => v.text).join(' ') : `Not in the ${version}`}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          </>
        )}

        <ErrorNote error={error} />

        <footer className="modal-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!sermon || !service || itemCount === 0 || adding}
            title={service ? undefined : 'Create a service first'}
            onClick={handleAdd}
          >
            <ListPlus size={15} aria-hidden="true" />{' '}
            {adding ? 'Adding…' : `Add ${itemCount} item${itemCount === 1 ? '' : 's'} to ${service?.name ?? 'the service'}`}
          </button>
        </footer>
      </div>
    </div>
  )
}

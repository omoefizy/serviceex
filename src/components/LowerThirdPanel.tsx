import { Bookmark, EyeOff, ListPlus, Pin, PinOff, Play, RefreshCw, SkipForward, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'
import { hasFormatting, matching, plainText, richOrPlain, trimRich } from '../../shared/richText'
import type { AppSettings, LowerThirdAnimation, RichText, SavedLowerThirdLine } from '../../shared/types'
import { LOWER_THIRD_HEADLINE_ID, MOD } from '../lib/shortcuts'
import { selectLowerThirdStyle, useOperatorStore, type LowerThirdLine } from '../store'
import { LowerThirdGraphic } from './LowerThird'
import { LowerThirdEditor } from './LowerThirdEditor'
import type { FormatControl } from './FormatToolbar'
import { RichTextEditor } from './RichTextEditor'

const ANIMATIONS: { value: LowerThirdAnimation; label: string }[] = [
  { value: 'slide', label: 'Slide' },
  { value: 'fade', label: 'Fade' },
  { value: 'wipe', label: 'Wipe' },
]

/** A field's formatting as it would show: trimmed with its words, or null. */
const shownRich = (rich: RichText | undefined, text: string) => (rich ? matching(trimRich(rich), text.trim()) : null)

const sameLine = (a: LowerThirdLine, b: LowerThirdLine) =>
  a.headline.trim() === b.headline.trim() &&
  a.body.trim() === b.body.trim() &&
  JSON.stringify([shownRich(a.headlineRich, a.headline), shownRich(a.bodyRich, a.body)]) ===
    JSON.stringify([shownRich(b.headlineRich, b.headline), shownRich(b.bodyRich, b.body)])

/** The template places and aligns the words, so only the marks apply to a lower third. */
const LINE_CONTROLS_OFF: FormatControl[] = ['align', 'justify', 'verticalAlign', 'lineHeight']

/**
 * Types a lower third and puts it on the Stream output. Enter shows it, Esc hides it, Up and Down step through the
 * lines used this service, and Cmd+L (Ctrl+L) jumps here from anywhere. Below: saved lines and a sermon's points.
 */
export function LowerThirdPanel() {
  const settings = useOperatorStore((s) => s.settings)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const live = useOperatorStore((s) => s.live.lowerThird)
  const draft = useOperatorStore((s) => s.lowerThirdDraft)
  const history = useOperatorStore((s) => s.lowerThirdHistory)
  const templates = useOperatorStore((s) => s.lowerThirdTemplates)
  const templateStyle = useOperatorStore(selectLowerThirdStyle)
  const pointIndex = useOperatorStore((s) => s.lowerThirdPointIndex)
  const setDraft = useOperatorStore((s) => s.setLowerThirdDraft)
  const show = useOperatorStore((s) => s.showLowerThird)
  const hide = useOperatorStore((s) => s.hideLowerThird)
  const showPoint = useOperatorStore((s) => s.showLowerThirdPoint)
  const nextPoint = useOperatorStore((s) => s.nextLowerThirdPoint)
  const queuePoints = useOperatorStore((s) => s.queueLowerThirdPoints)
  const [editorOpen, setEditorOpen] = useState(false)
  const [pasted, setPasted] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** Where Up and Down are in the history: -1 is the line being typed, kept in `typed` meanwhile. */
  const historyIndex = useRef(-1)
  const typed = useRef<LowerThirdLine>(draft)

  const empty = !draft.headline.trim() && !draft.body.trim()
  const edited = live !== null && !empty && !sameLine(draft, live)
  const points = settings.lowerThirdPoints
  const saved = [...settings.lowerThirdSavedLines].sort((a, b) => Number(b.pinned) - Number(a.pinned))
  const templateId = templates.some((t) => t.id === settings.lowerThirdTemplateId) ? settings.lowerThirdTemplateId : (templates[0]?.id ?? null)

  const save = (patch: Partial<AppSettings>) => {
    setError(null)
    updateSettings(patch).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }

  function type(patch: Partial<LowerThirdLine>) {
    historyIndex.current = -1
    setDraft(patch)
  }

  function step(delta: number) {
    const next = Math.min(history.length - 1, Math.max(-1, historyIndex.current + delta))
    if (next === historyIndex.current) return
    if (historyIndex.current === -1) typed.current = draft
    historyIndex.current = next
    setDraft(next === -1 ? typed.current : history[next])
  }

  /** A field changed: its words, and its formatting when it has any. */
  const typeField = (field: 'headline' | 'body', rich: RichText) =>
    type({ [field]: plainText(rich), [`${field}Rich`]: hasFormatting(rich) ? rich : undefined })

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Enter') {
      // Enter shows the line; with a lower third up, it (or Ctrl+Enter) updates it in place.
      e.preventDefault()
      historyIndex.current = -1
      show()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      hide()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      step(e.key === 'ArrowUp' ? 1 : -1)
    }
  }

  function saveLine() {
    const headlineRich = shownRich(draft.headlineRich, draft.headline)
    const bodyRich = shownRich(draft.bodyRich, draft.body)
    const line = {
      headline: draft.headline.trim(),
      body: draft.body.trim(),
      ...(headlineRich ? { headlineRich } : {}),
      ...(bodyRich ? { bodyRich } : {}),
    }
    if (settings.lowerThirdSavedLines.some((l) => sameLine(l, line))) return
    save({ lowerThirdSavedLines: [{ id: crypto.randomUUID(), ...line, pinned: false }, ...settings.lowerThirdSavedLines] })
  }

  const changeLine = (id: string, patch: Partial<SavedLowerThirdLine>) =>
    save({ lowerThirdSavedLines: settings.lowerThirdSavedLines.map((l) => (l.id === id ? { ...l, ...patch } : l)) })

  return (
    <section className="panel lower-third-panel" aria-label="Lower third">
      <header className="panel-header">
        <h2>Lower Third</h2>
        <span className={`lower-third-status${live ? ' live' : ''}`}>{live ? 'Live' : 'Off'}</span>
        <select
          className="input lower-third-template"
          aria-label="Template"
          value={templateId ?? ''}
          onChange={(e) => save({ lowerThirdTemplateId: Number(e.target.value) })}
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button type="button" className="icon-button" aria-label="Edit templates" title="Edit templates" onClick={() => setEditorOpen(true)}>
          <SlidersHorizontal size={15} />
        </button>
      </header>

      <RichTextEditor
        id={LOWER_THIRD_HEADLINE_ID}
        placeholder={`Headline (${MOD}L)`}
        ariaLabel="Headline"
        singleLine
        maxLength={300}
        toolbar="focus"
        disabled={LINE_CONTROLS_OFF}
        base={null}
        value={richOrPlain(draft.headlineRich, draft.headline)}
        onChange={(rich) => typeField('headline', rich)}
        onKeyDown={onKeyDown}
      />
      <RichTextEditor
        placeholder="Body"
        ariaLabel="Body"
        singleLine
        maxLength={300}
        toolbar="focus"
        disabled={LINE_CONTROLS_OFF}
        base={null}
        value={richOrPlain(draft.bodyRich, draft.body)}
        onChange={(rich) => typeField('body', rich)}
        onKeyDown={onKeyDown}
      />
      {!empty && (
        <div className="lower-third-preview" aria-label="Live preview">
          <LowerThirdGraphic
            style={templateStyle}
            headline={draft.headline.trim()}
            body={draft.body.trim()}
            headlineRich={shownRich(draft.headlineRich, draft.headline) ?? undefined}
            bodyRich={shownRich(draft.bodyRich, draft.body) ?? undefined}
          />
        </div>
      )}
      <div className="lower-third-actions">
        {edited ? (
          <button type="button" className="button primary" onClick={show} title={`Change the live lower third to this (Enter or ${MOD}Enter)`}>
            <RefreshCw size={14} aria-hidden="true" /> Update
          </button>
        ) : (
          <button type="button" className="button primary" disabled={empty || live !== null} onClick={show} title="Show it on the Stream output (Enter)">
            <Play size={14} aria-hidden="true" /> {live ? 'Showing' : 'Show'}
          </button>
        )}
        <button type="button" className="button" disabled={!live} onClick={hide} title="Take it off (Esc)">
          <EyeOff size={14} aria-hidden="true" /> Hide
        </button>
        <button type="button" className="button" disabled={empty} onClick={saveLine} title="Keep this line in Saved lines">
          <Bookmark size={14} aria-hidden="true" /> Save line
        </button>
      </div>
      {history.length > 0 && <p className="hint">↑ ↓ in a field: the last {history.length} lines used this service.</p>}
      {error && <p className="error">{error}</p>}

      <details className="lower-third-section" open>
        <summary>Saved lines ({saved.length})</summary>
        {saved.length === 0 ? (
          <p className="hint">Type a line and press Save line to keep it here.</p>
        ) : (
          <ul className="lower-third-list">
            {saved.map((line) => (
              <li key={line.id} className={line.pinned ? 'pinned' : ''}>
                <button
                  type="button"
                  className="lower-third-line"
                  title="Put it in the fields; Enter shows it"
                  onClick={() => {
                    type({ headline: line.headline, body: line.body, headlineRich: line.headlineRich, bodyRich: line.bodyRich })
                    document.getElementById(LOWER_THIRD_HEADLINE_ID)?.focus()
                  }}
                >
                  <strong>{line.headline}</strong>
                  {line.body && <span>{line.body}</span>}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={line.pinned ? 'Unpin' : 'Pin to the top'}
                  title={line.pinned ? 'Unpin' : 'Pin to the top'}
                  aria-pressed={line.pinned}
                  onClick={() => changeLine(line.id, { pinned: !line.pinned })}
                >
                  {line.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Remove"
                  title="Remove"
                  onClick={() => save({ lowerThirdSavedLines: settings.lowerThirdSavedLines.filter((l) => l.id !== line.id) })}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>

      <details className="lower-third-section" open={points.length > 0}>
        <summary>Points ({points.length})</summary>
        {points.length > 0 && (
          <>
            <button type="button" className="button primary" disabled={pointIndex >= points.length - 1} onClick={nextPoint}>
              <SkipForward size={14} aria-hidden="true" /> Next Point
              {pointIndex < points.length - 1 && <span className="lower-third-next">{points[pointIndex + 1]}</span>}
            </button>
            <ol className="lower-third-list points">
              {points.map((point, index) => (
                <li key={index} className={index === pointIndex ? 'current' : ''}>
                  <button type="button" className="lower-third-line" title="Show this point" onClick={() => showPoint(index)}>
                    <strong>{point}</strong>
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
        <textarea
          className="input"
          rows={3}
          placeholder="Paste the sermon's points, one per line"
          aria-label="Points to queue"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
        />
        <div className="lower-third-actions">
          <button
            type="button"
            className="button"
            disabled={!pasted.trim()}
            onClick={() => {
              queuePoints(pasted.split(/\r?\n/)).then(() => setPasted(''), (err) => setError(String(err)))
            }}
          >
            <ListPlus size={14} aria-hidden="true" /> Queue points
          </button>
          {points.length > 0 && (
            <button type="button" className="button" onClick={() => queuePoints([]).catch(console.error)}>
              Clear points
            </button>
          )}
        </div>
      </details>

      <details className="lower-third-section">
        <summary>Animation and timing</summary>
        <span className="segmented" role="radiogroup" aria-label="Animation">
          {ANIMATIONS.map((a) => (
            <button
              key={a.value}
              type="button"
              role="radio"
              aria-checked={settings.lowerThirdAnimation === a.value}
              className={settings.lowerThirdAnimation === a.value ? 'active' : ''}
              onClick={() => save({ lowerThirdAnimation: a.value })}
            >
              {a.label}
            </button>
          ))}
        </span>
        <label className="fade-control">
          <span>Duration</span>
          <input
            type="range"
            min={200}
            max={1000}
            step={50}
            value={settings.lowerThirdDurationMs}
            onChange={(e) => save({ lowerThirdDurationMs: Number(e.target.value) })}
          />
          <span className="fade-value">{(settings.lowerThirdDurationMs / 1000).toFixed(2)} s</span>
        </label>
        <div className="lower-third-actions">
          <label className="inline-check">
            <input type="checkbox" checked={settings.lowerThirdHoldSeconds > 0} onChange={(e) => save({ lowerThirdHoldSeconds: e.target.checked ? 10 : 0 })} />
            Hide after
          </label>
          {settings.lowerThirdHoldSeconds > 0 && (
            <label className="alerts-number">
              <input
                className="input"
                type="number"
                min={1}
                max={600}
                value={settings.lowerThirdHoldSeconds}
                onChange={(e) => Number(e.target.value) >= 1 && save({ lowerThirdHoldSeconds: Number(e.target.value) })}
              />
              seconds
            </label>
          )}
        </div>
        <label className="inline-check">
          <input type="checkbox" checked={settings.lowerThirdOverFullSlide} onChange={(e) => save({ lowerThirdOverFullSlide: e.target.checked })} />
          Keep on top of a full screen slide
        </label>
        <p className="hint">Off: the lower third steps aside while a full screen slide is live, and comes back when it clears.</p>
      </details>

      {editorOpen && <LowerThirdEditor onClose={() => setEditorOpen(false)} />}
    </section>
  )
}

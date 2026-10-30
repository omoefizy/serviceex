import { Bookmark, EyeOff, LayoutTemplate, ListPlus, Pin, PinOff, SkipForward, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { can } from '../../shared/features'
import type { AppSettings, LowerThirdAnimation, SavedLowerThirdLine } from '../../shared/types'
import { reportError, type ErrorLike } from '../lib/errors'
import { canSendCues, openCueMenu } from '../lib/sharing'
import { canvasLine, selectLowerThirdDesign, selectSermonPoints, useOperatorStore } from '../store'
import { LowerThirdEditor } from './LowerThirdEditor'
import type { DesignerDocument } from './Designer'
import { DesignsLibrary } from './DesignsLibrary'
import { Locked } from './Locked'
import { ErrorNote } from './ui'

const ANIMATIONS: { value: LowerThirdAnimation; label: string }[] = [
  { value: 'slide', label: 'Slide' },
  { value: 'fade', label: 'Fade' },
  { value: 'wipe', label: 'Wipe' },
]

const sameLine = (a: { headline: string; body: string }, b: { headline: string; body: string }) => a.headline.trim() === b.headline.trim() && a.body.trim() === b.body.trim()

/**
 * The lower third's style and lines, in the Lower thirds workspace's Style popover: the template or design, saved
 * lines and the sermon's points, and the animation. The words themselves are typed on the design's canvas only:
 * Save line keeps what is on it, and a saved line puts its words back on it.
 */
export function LowerThirdPanel() {
  const settings = useOperatorStore((s) => s.settings)
  // The free plan fades in and out, whatever was chosen before.
  const animation = can('effects.animations') ? settings.lowerThirdAnimation : 'fade'
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const live = useOperatorStore((s) => s.live.lowerThird)
  const templates = useOperatorStore((s) => s.lowerThirdTemplates)
  const design = useOperatorStore(selectLowerThirdDesign)
  const designs = useOperatorStore((s) => s.designs).filter((d) => d.style.category === 'lowerThird')
  const pointIndex = useOperatorStore((s) => s.lowerThirdPointIndex)
  const hide = useOperatorStore((s) => s.hideLowerThird)
  const points = useOperatorStore(selectSermonPoints)
  const triggerPoint = useOperatorStore((s) => s.triggerPoint)
  const nextPoint = useOperatorStore((s) => s.nextPoint)
  const openWorkspace = useOperatorStore((s) => s.openLowerThirds)
  const workspaceDesignId = useOperatorStore((s) => s.lowerThirdWorkspaceDesignId)
  const workspaceDesign = useOperatorStore((s) => s.designs.find((d) => d.id === workspaceDesignId))
  const typed = useOperatorStore((s) => s.settings.lowerThirdCanvasText[String(workspaceDesignId)])
  const canvas = workspaceDesign ? canvasLine(workspaceDesign, typed) : null
  const setCanvasText = useOperatorStore((s) => s.setCanvasText)
  const [editorOpen, setEditorOpen] = useState(false)
  /** The Designs library while it is open, and the document it opens straight into, if any. */
  const [library, setLibrary] = useState<{ open: DesignerDocument | null } | null>(null)
  const [error, setError] = useState<ErrorLike | null>(null)

  const empty = !canvas || (!canvas.headline.trim() && !canvas.body.trim())
  const saved = [...settings.lowerThirdSavedLines].sort((a, b) => Number(b.pinned) - Number(a.pinned))
  const templateId = templates.some((t) => t.id === settings.lowerThirdTemplateId) ? settings.lowerThirdTemplateId : (templates[0]?.id ?? null)
  // A design chosen here wins over the template; the picker holds both, as "design:<id>" and "template:<id>".
  const picked = design && settings.lowerThirdDesignId !== null ? `design:${settings.lowerThirdDesignId}` : `template:${templateId ?? ''}`

  const save = (patch: Partial<AppSettings>) => {
    setError(null)
    updateSettings(patch).catch((err) => setError(reportError('Lower third', err)))
  }

  function saveLine() {
    if (!canvas) return
    const line = { headline: canvas.headline.trim(), body: canvas.body.trim() }
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
          aria-label="Template or design"
          value={picked}
          onChange={(e) => {
            const [kind, id] = e.target.value.split(':')
            save(kind === 'design' ? { lowerThirdDesignId: Number(id) } : { lowerThirdTemplateId: Number(id), lowerThirdDesignId: null })
          }}
        >
          <optgroup label="Templates">
            {templates.map((t) => (
              <option key={t.id} value={`template:${t.id}`}>
                {t.name}
              </option>
            ))}
          </optgroup>
          {designs.length > 0 && (
            <optgroup label="Designs">
              {designs.map((d) => (
                <option key={d.id} value={`design:${d.id}`}>
                  {d.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button type="button" className="icon-button" aria-label="Edit templates" title="Edit templates" onClick={() => setEditorOpen(true)}>
          <SlidersHorizontal size={15} />
        </button>
        <button type="button" className="icon-button" aria-label="Designs" title="Designs: the designer and its templates" onClick={() => setLibrary({ open: null })}>
          <LayoutTemplate size={15} />
        </button>
      </header>

      <div className="lower-third-actions">
        <button type="button" className="button" disabled={!live} onClick={hide} title="Take it off, leaving the slide and the idle design (Shift+C anywhere)">
          <EyeOff size={14} aria-hidden="true" /> Hide
        </button>
        <button type="button" className="button" disabled={empty} onClick={saveLine} title="Keep the words on the design's canvas in Saved lines">
          <Bookmark size={14} aria-hidden="true" /> Save line
        </button>
      </div>
      <ErrorNote error={error} />

      <details className="lower-third-section" open>
        <summary>Saved lines ({saved.length})</summary>
        {saved.length === 0 ? (
          <p className="hint">Type on the design and press Save line to keep the words here.</p>
        ) : (
          <ul className="lower-third-list">
            {saved.map((line) => (
              <li key={line.id} className={line.pinned ? 'pinned' : ''}>
                <button
                  type="button"
                  className="lower-third-line"
                  title="Put its words on the selected design"
                  disabled={workspaceDesignId === null}
                  onClick={() => {
                    if (workspaceDesignId === null) return
                    setError(null)
                    setCanvasText(workspaceDesignId, { headline: line.headline, body: line.body }).catch((err) => setError(reportError('Lower third', err)))
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
              {pointIndex < points.length - 1 && <span className="lower-third-next">{points[pointIndex + 1].text}</span>}
            </button>
            <ol className="lower-third-list points">
              {points.map((point, index) => (
                <li key={point.id} className={index === pointIndex ? 'current' : ''}>
                  <button
                    type="button"
                    className="lower-third-line"
                    title={canSendCues() ? 'Show this point; right-click to send it to another computer' : 'Show this point'}
                    onClick={() => triggerPoint(index, 'live')}
                    onContextMenu={(e) => canSendCues() && openCueMenu(e, { kind: 'point', title: 'Point', text: point.text })}
                  >
                    <strong>{point.text}</strong>
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
        <button type="button" className="button" onClick={() => openWorkspace(true)} title="Add, edit and run the sermon's points, saved with the service">
          <ListPlus size={14} aria-hidden="true" /> {points.length > 0 ? 'Edit points' : 'Add points'} in Lower thirds
        </button>
      </details>

      <details className="lower-third-section">
        <summary>Animation and timing</summary>
        <span className="segmented" role="radiogroup" aria-label="Animation">
          {ANIMATIONS.map((a) => (
            <Locked key={a.value} feature={a.value === 'fade' ? 'lowerThirds' : 'effects.animations'}>
              <button
                type="button"
                role="radio"
                aria-checked={animation === a.value}
                className={animation === a.value ? 'active' : ''}
                onClick={() => save({ lowerThirdAnimation: a.value })}
              >
                {a.label}
              </button>
            </Locked>
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
        <p className="hint">The lower third shows on every output, on top of the slide and the idle design. Clear takes it off with the slide.</p>
      </details>

      {editorOpen && (
        <LowerThirdEditor
          onClose={() => setEditorOpen(false)}
          onOpenInDesigner={(doc) => {
            setEditorOpen(false)
            setLibrary({ open: doc })
          }}
        />
      )}
      {library && <DesignsLibrary open={library.open} onClose={() => setLibrary(null)} />}
    </section>
  )
}

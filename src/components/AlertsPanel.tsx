import { EyeOff, Pencil, Play, SkipForward, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { AlertMessage, AlertRepeat } from '../../shared/types'
import { useOperatorStore } from '../store'

const REPEATS: { value: AlertRepeat; label: string }[] = [
  { value: 'once', label: 'Once' },
  { value: 'loop', label: 'Loop' },
  { value: 'hold', label: 'Until hidden' },
]

/** The message being written: a new one (id null) or a saved one being edited. */
interface Draft {
  id: string | null
  text: string
  priority: boolean
  repeat: AlertRepeat
  everySeconds: number
}

const NEW_DRAFT: Draft = { id: null, text: '', priority: false, repeat: 'once', everySeconds: 60 }

const repeatLabel = (m: AlertMessage) => (m.repeat === 'loop' ? `Every ${m.everySeconds} s` : m.repeat === 'hold' ? 'Until hidden' : 'Once')

/**
 * Alerts: saved messages to show in a band over the live output (show, edit, remove), a box to add or show a new
 * one, Next and Hide, and where and how long the band shows.
 */
export function AlertsPanel() {
  const messages = useOperatorStore((s) => s.settings.alertMessages)
  const position = useOperatorStore((s) => s.settings.alertPosition)
  const seconds = useOperatorStore((s) => s.settings.alertSeconds)
  const keepOnClear = useOperatorStore((s) => s.settings.alertKeepOnClear)
  const current = useOperatorStore((s) => s.live.alert)
  const waiting = useOperatorStore((s) => s.alertQueue.length)
  const showAlert = useOperatorStore((s) => s.showAlert)
  const nextAlert = useOperatorStore((s) => s.nextAlert)
  const hideAlert = useOperatorStore((s) => s.hideAlert)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const [draft, setDraft] = useState<Draft>(NEW_DRAFT)
  const [error, setError] = useState<string | null>(null)

  const change = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  function save(patch: Parameters<typeof updateSettings>[0]) {
    setError(null)
    updateSettings(patch).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }

  const messageOf = (d: Draft): AlertMessage => ({
    id: d.id ?? crypto.randomUUID(),
    text: d.text.trim(),
    priority: d.priority,
    repeat: d.repeat,
    everySeconds: d.everySeconds,
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!draft.text.trim()) return
    const message = messageOf(draft)
    save({ alertMessages: draft.id ? messages.map((m) => (m.id === message.id ? message : m)) : [...messages, message] })
    setDraft(NEW_DRAFT)
  }

  function remove(id: string) {
    save({ alertMessages: messages.filter((m) => m.id !== id) })
    if (draft.id === id) setDraft(NEW_DRAFT)
  }

  const status = !current
    ? 'No alert showing'
    : `${current.visible ? 'On screen' : 'Comes back soon'}: ${current.message.text}`

  return (
    <div className="alerts-panel" role="dialog" aria-label="Alerts">
      <p className={`alerts-status${current?.visible ? ' on' : ''}${current?.message.priority ? ' priority' : ''}`}>
        {status}
        {waiting > 0 && <span className="hint"> · {waiting} waiting</span>}
      </p>

      {messages.length === 0 ? (
        <p className="hint">No saved messages yet. Add the ones you use often below.</p>
      ) : (
        <ul className="alerts-list" aria-label="Saved messages">
          {messages.map((m) => (
            <li key={m.id} className={current?.message.id === m.id ? 'current' : ''}>
              <button type="button" className="icon-button" aria-label={`Show “${m.text}”`} title="Show Alert" onClick={() => showAlert(m)}>
                <Play size={14} />
              </button>
              <span className="alerts-text">{m.text}</span>
              {m.priority && <span className="alerts-tag priority">Priority</span>}
              <span className="alerts-tag">{repeatLabel(m)}</span>
              <button type="button" className="icon-button" aria-label={`Edit “${m.text}”`} title="Edit" onClick={() => setDraft({ ...m })}>
                <Pencil size={14} />
              </button>
              <button type="button" className="icon-button" aria-label={`Remove “${m.text}”`} title="Remove" onClick={() => remove(m.id)}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="alerts-editor" onSubmit={handleSubmit}>
        <textarea
          className="input"
          rows={2}
          maxLength={300}
          placeholder="Message, such as: Parents of child 12, please come to the nursery"
          aria-label="Alert message"
          value={draft.text}
          onChange={(e) => change({ text: e.target.value })}
        />
        <div className="alerts-editor-row">
          <button
            type="button"
            className={`button alerts-priority${draft.priority ? ' active' : ''}`}
            aria-pressed={draft.priority}
            title="Shows in a warning color and replaces the alert on screen"
            onClick={() => change({ priority: !draft.priority })}
          >
            Priority
          </button>
          <span className="segmented" role="radiogroup" aria-label="Repeat">
            {REPEATS.map((r) => (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={draft.repeat === r.value}
                className={draft.repeat === r.value ? 'active' : ''}
                onClick={() => change({ repeat: r.value })}
              >
                {r.label}
              </button>
            ))}
          </span>
          {draft.repeat === 'loop' && (
            <label className="alerts-every">
              every
              <input
                className="input"
                type="number"
                min={5}
                max={3600}
                value={draft.everySeconds}
                onChange={(e) => change({ everySeconds: Math.min(3600, Math.max(5, Number(e.target.value) || 5)) })}
              />
              s
            </label>
          )}
        </div>
        <div className="alerts-editor-actions">
          {draft.id && (
            <button type="button" className="button" onClick={() => setDraft(NEW_DRAFT)}>
              Cancel
            </button>
          )}
          <button type="button" className="button" disabled={!draft.text.trim()} onClick={() => showAlert(messageOf(draft))}>
            Show now
          </button>
          <button type="submit" className="button primary" disabled={!draft.text.trim()}>
            {draft.id ? 'Save changes' : 'Add to list'}
          </button>
        </div>
      </form>

      <div className="alerts-controls">
        <button type="button" className="button" onClick={nextAlert} title="The next waiting alert, or the next saved message">
          <SkipForward size={14} aria-hidden="true" /> Next
        </button>
        <button type="button" className="button" disabled={!current} onClick={hideAlert}>
          <EyeOff size={14} aria-hidden="true" /> Hide
        </button>
      </div>

      <div className="alerts-settings">
        <span className="segmented" role="radiogroup" aria-label="Alert position">
          {(['bottom', 'top'] as const).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={position === p} className={position === p ? 'active' : ''} onClick={() => save({ alertPosition: p })}>
              {p === 'bottom' ? 'Bottom' : 'Top'}
            </button>
          ))}
        </span>
        <label className="alerts-every" title="How long a Once or Loop alert stays up each time">
          show for
          <input
            className="input"
            type="number"
            min={3}
            max={120}
            value={seconds}
            onChange={(e) => Number(e.target.value) > 0 && save({ alertSeconds: Number(e.target.value) })}
          />
          s
        </label>
        <label className="inline-check" title="Black always hides the alert">
          <input type="checkbox" checked={keepOnClear} onChange={(e) => save({ alertKeepOnClear: e.target.checked })} />
          Keep during Clear
        </label>
      </div>

      {error && <p className="error">{error}</p>}
    </div>
  )
}

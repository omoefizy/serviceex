import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Play, SkipForward, Square, Trash2 } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { hasFormatting, matching, plainText, richOrPlain, trimRich } from '../../shared/richText'
import type { AlertMessage, AppSettings, RichText } from '../../shared/types'
import { PRIORITY_BAND_COLOR, SPEED_PRESETS } from '../lib/ticker'
import { useOperatorStore } from '../store'
import type { FormatControl } from './FormatToolbar'
import { RichInline } from './RichText'
import { RichTextEditor } from './RichTextEditor'

/** The message being written: a new one (id null) or a saved one being edited. */
interface Draft {
  id: string | null
  text: string
  /** The text formatted, when it has any formatting. */
  rich?: RichText
  priority: boolean
}

const NEW_DRAFT: Draft = { id: null, text: '', priority: false }

/** The ticker is one line placed by its settings, so only the marks apply. */
const TICKER_CONTROLS_OFF: FormatControl[] = ['align', 'justify', 'verticalAlign', 'lineHeight']

const SPEEDS = [
  { label: 'Slow', value: SPEED_PRESETS.slow },
  { label: 'Medium', value: SPEED_PRESETS.medium },
  { label: 'Fast', value: SPEED_PRESETS.fast },
]

function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="alerts-setting" role="group" aria-label={label}>
      <span>{label}</span>
      <div>{children}</div>
    </div>
  )
}

/**
 * The alert ticker: saved messages (play, reorder, edit, remove), a box to add or show a new one, Start and Stop,
 * Next and Hide, and how the band looks and scrolls.
 */
export function AlertsPanel() {
  const settings = useOperatorStore((s) => s.settings)
  const ticker = useOperatorStore((s) => s.live.alert)
  const startAlerts = useOperatorStore((s) => s.startAlerts)
  const interruptAlert = useOperatorStore((s) => s.interruptAlert)
  const nextAlert = useOperatorStore((s) => s.nextAlert)
  const stopAlerts = useOperatorStore((s) => s.stopAlerts)
  const setAlertHidden = useOperatorStore((s) => s.setAlertHidden)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const [draft, setDraft] = useState<Draft>(NEW_DRAFT)
  const [error, setError] = useState<string | null>(null)
  const messages = settings.alertMessages
  /** The messages Start plays in turn; priority ones only ever interrupt. */
  const normal = messages.filter((m) => !m.priority)

  function save(patch: Partial<AppSettings>) {
    setError(null)
    updateSettings(patch).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }

  const messageOf = (d: Draft): AlertMessage => {
    const rich = d.rich ? matching(trimRich(d.rich), d.text.trim()) : null
    return { id: d.id ?? crypto.randomUUID(), text: d.text.trim(), priority: d.priority, ...(rich ? { rich } : {}) }
  }
  const draftRich = draft.rich ? matching(trimRich(draft.rich), draft.text.trim()) : null

  /** A priority message interrupts; a normal one starts the ticker there and carries on through the rest in turn. */
  function play(message: AlertMessage) {
    if (message.priority) return interruptAlert(message)
    const at = normal.findIndex((m) => m.id === message.id)
    startAlerts(at < 0 ? [message] : [...normal.slice(at), ...normal.slice(0, at)])
  }

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

  function move(index: number, delta: number) {
    const list = [...messages]
    const [message] = list.splice(index, 1)
    list.splice(index + delta, 0, message)
    save({ alertMessages: list })
  }

  const status = !ticker
    ? 'Stopped'
    : ticker.priority
      ? `Priority: ${ticker.priority.texts[0]}`
      : `Running ${ticker.normal?.texts.length ?? 0} message${ticker.normal?.texts.length === 1 ? '' : 's'}`

  return (
    <div className="alerts-panel" role="dialog" aria-label="Alerts">
      <p className={`alerts-status${ticker ? ' on' : ''}${ticker?.priority ? ' priority' : ''}`}>
        {status}
        {ticker?.hidden && <span className="hint"> · hidden</span>}
      </p>

      <div className="alerts-controls">
        {ticker ? (
          <button type="button" className="button" onClick={stopAlerts}>
            <Square size={14} aria-hidden="true" /> Stop
          </button>
        ) : (
          <button
            type="button"
            className="button primary"
            disabled={normal.length === 0}
            title={normal.length === 0 ? 'Add a message that is not a priority one first' : 'Scroll the saved messages in turn'}
            onClick={() => startAlerts(normal)}
          >
            <Play size={14} aria-hidden="true" /> Start
          </button>
        )}
        <button type="button" className="button" disabled={!ticker && normal.length === 0} onClick={nextAlert} title="End a priority message, or move on to the next message">
          <SkipForward size={14} aria-hidden="true" /> Next
        </button>
        <button type="button" className="button" disabled={!ticker} aria-pressed={ticker?.hidden ?? false} onClick={() => setAlertHidden(!ticker?.hidden)}>
          {ticker?.hidden ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
          {ticker?.hidden ? ' Show' : ' Hide'}
        </button>
      </div>

      {messages.length === 0 ? (
        <p className="hint">No saved messages yet. Add the ones you use often below.</p>
      ) : (
        <ul className="alerts-list" aria-label="Saved messages">
          {messages.map((m, index) => (
            <li key={m.id}>
              <button
                type="button"
                className="icon-button"
                aria-label={`Play “${m.text}”`}
                title={m.priority ? 'Interrupt with this message' : 'Start the ticker from this message'}
                onClick={() => play(m)}
              >
                <Play size={14} />
              </button>
              <span className="alerts-text">{m.text}</span>
              {m.priority && <span className="alerts-tag priority">Priority</span>}
              <button type="button" className="icon-button" aria-label={`Move “${m.text}” up`} disabled={index === 0} onClick={() => move(index, -1)}>
                <ArrowUp size={14} />
              </button>
              <button type="button" className="icon-button" aria-label={`Move “${m.text}” down`} disabled={index === messages.length - 1} onClick={() => move(index, 1)}>
                <ArrowDown size={14} />
              </button>
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
        <RichTextEditor
          singleLine
          maxLength={300}
          toolbar="focus"
          disabled={TICKER_CONTROLS_OFF}
          placeholder="Message, such as: Parents, please pick up your child"
          ariaLabel="Alert message"
          value={richOrPlain(draft.rich, draft.text)}
          onChange={(rich) => setDraft((d) => ({ ...d, text: plainText(rich), rich: hasFormatting(rich) ? rich : undefined }))}
        />
        {draft.text.trim() && (
          <div
            className="alerts-preview"
            aria-label="Live preview"
            style={{ color: settings.alertTextColor, background: draft.priority ? PRIORITY_BAND_COLOR : settings.alertBandColor }}
          >
            {draftRich ? <RichInline rich={draftRich} /> : draft.text.trim()}
          </div>
        )}
        <div className="alerts-editor-actions">
          <button
            type="button"
            className={`button alerts-priority${draft.priority ? ' active' : ''}`}
            aria-pressed={draft.priority}
            title="Interrupts the ticker in its own color; the other messages carry on afterwards"
            onClick={() => setDraft((d) => ({ ...d, priority: !d.priority }))}
          >
            Priority
          </button>
          <span className="alerts-spacer" />
          {draft.id && (
            <button type="button" className="button" onClick={() => setDraft(NEW_DRAFT)}>
              Cancel
            </button>
          )}
          <button type="button" className="button" disabled={!draft.text.trim()} onClick={() => play(messageOf(draft))}>
            Show now
          </button>
          <button type="submit" className="button primary" disabled={!draft.text.trim()}>
            {draft.id ? 'Save changes' : 'Add to list'}
          </button>
        </div>
      </form>

      <details className="alerts-settings">
        <summary>Ticker settings</summary>
        <Setting label="Position">
          <span className="segmented" role="radiogroup" aria-label="Position">
            {(['bottom', 'top'] as const).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={settings.alertPosition === p} className={settings.alertPosition === p ? 'active' : ''} onClick={() => save({ alertPosition: p })}>
                {p === 'bottom' ? 'Bottom' : 'Top'}
              </button>
            ))}
          </span>
        </Setting>
        <Setting label="Speed">
          <span className="segmented" role="radiogroup" aria-label="Speed presets">
            {SPEEDS.map((speed) => (
              <button
                key={speed.label}
                type="button"
                role="radio"
                aria-checked={settings.alertSpeed === speed.value}
                className={settings.alertSpeed === speed.value ? 'active' : ''}
                onClick={() => save({ alertSpeed: speed.value })}
              >
                {speed.label}
              </button>
            ))}
          </span>
          <input type="range" aria-label="Speed" min={3} max={40} step={0.5} value={settings.alertSpeed} onChange={(e) => save({ alertSpeed: Number(e.target.value) })} />
        </Setting>
        <Setting label="Text">
          <input type="range" aria-label="Font size" min={2} max={15} step={0.1} value={settings.alertFontSize} onChange={(e) => save({ alertFontSize: Number(e.target.value) })} />
          <input type="color" aria-label="Text color" value={settings.alertTextColor} onChange={(e) => save({ alertTextColor: e.target.value })} />
        </Setting>
        <Setting label="Band">
          <input type="color" aria-label="Band color" value={settings.alertBandColor} onChange={(e) => save({ alertBandColor: e.target.value })} />
          <input type="range" aria-label="Band opacity" min={0} max={1} step={0.05} value={settings.alertBandOpacity} onChange={(e) => save({ alertBandOpacity: Number(e.target.value) })} />
          <span className="hint">{Math.round(settings.alertBandOpacity * 100)}%</span>
        </Setting>
        <Setting label="Height">
          <input type="range" aria-label="Band height" min={4} max={25} step={0.5} value={settings.alertBandHeight} onChange={(e) => save({ alertBandHeight: Number(e.target.value) })} />
          <span className="hint">{settings.alertBandHeight}% of screen</span>
        </Setting>
        <Setting label="Loops">
          <label className="inline-check">
            <input type="checkbox" checked={settings.alertLoops === 0} onChange={(e) => save({ alertLoops: e.target.checked ? 0 : 3 })} />
            Until stopped
          </label>
          {settings.alertLoops > 0 && (
            <label className="alerts-number">
              <input
                className="input"
                type="number"
                min={1}
                max={99}
                value={settings.alertLoops}
                onChange={(e) => Number(e.target.value) >= 1 && save({ alertLoops: Number(e.target.value) })}
              />
              times, then hide
            </label>
          )}
        </Setting>
        <Setting label="Messages">
          <span className="segmented" role="radiogroup" aria-label="Messages">
            {(
              [
                ['divider', 'With a divider'],
                ['sequence', 'One after another'],
              ] as const
            ).map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={settings.alertLayout === value} className={settings.alertLayout === value ? 'active' : ''} onClick={() => save({ alertLayout: value })}>
                {label}
              </button>
            ))}
          </span>
        </Setting>
        <label className="inline-check" title="Black always hides the ticker">
          <input type="checkbox" checked={settings.alertKeepOnClear} onChange={(e) => save({ alertKeepOnClear: e.target.checked })} />
          Keep the ticker during Clear Text
        </label>
      </details>

      {error && <p className="error">{error}</p>}
    </div>
  )
}

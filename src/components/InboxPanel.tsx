import { Check, Eye, EyeOff, FileText, Film, Image, Inbox, Music, Package, PackageOpen, Presentation, Settings, X, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { formatBytes } from '../../shared/sharing'
import type { ConflictChoice, InboxConflict, InboxItem, InboxPreview, ShareKind } from '../../shared/types'
import { reportError, type ErrorLike } from '../lib/errors'
import { applyAcceptResult, showError, showMessage, useSharingStore } from '../lib/sharing'
import { useOperatorStore } from '../store'
import { Button, EmptyState, ErrorNote } from './ui'

const KIND_ICONS: Record<ShareKind, LucideIcon> = {
  package: Package,
  presentation: Presentation,
  image: Image,
  video: Film,
  audio: Music,
  text: FileText,
  openlyrics: FileText,
}

const KIND_LABELS: Record<ShareKind, string> = {
  package: 'ServiceEx package',
  presentation: 'Presentation',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  text: 'Text (song)',
  openlyrics: 'OpenLyrics song',
}

/** Where Accept puts each kind, for the button's tooltip. */
const ACCEPT_HINTS: Record<ShareKind, string> = {
  package: 'Adds its songs, themes, media and presentations to the library, and its service to the service list',
  presentation: 'Adds it to Presentations',
  image: 'Adds it to the Media library',
  video: 'Adds it to the Media library',
  audio: 'Saves it in Documents/ServiceEx Received',
  text: 'Adds it to Songs',
  openlyrics: 'Adds it to Songs',
}

const CHOICES: { value: ConflictChoice; label: string }[] = [
  { value: 'replace', label: 'Replace' },
  { value: 'keepBoth', label: 'Keep both' },
  { value: 'skip', label: 'Skip' },
]

function Preview({ preview }: { preview: InboxPreview }) {
  if (preview.contents) {
    const c = preview.contents
    const groups: [string, string[]][] = [
      ['Songs', c.songs],
      ['Themes', c.themes],
      ['Media', c.media],
      ['Presentations', c.presentations],
      ['Announcements', c.announcements],
    ]
    return (
      <div className="inbox-preview">
        {c.service && (
          <>
            <strong>
              {c.service.name}
              {c.service.date ? ` · ${c.service.date}` : ''}
            </strong>
            <ol>
              {c.service.items.map((title, i) => (
                <li key={i}>{title}</li>
              ))}
            </ol>
          </>
        )}
        {groups
          .filter(([, list]) => list.length > 0)
          .map(([label, list]) => (
            <p key={label} className="hint">
              {label}: {list.join(', ')}
            </p>
          ))}
      </div>
    )
  }
  if (preview.kind === 'image' && preview.url) return <img className="inbox-preview-media" src={preview.url} alt="Preview" />
  if (preview.kind === 'video' && preview.url) return <video className="inbox-preview-media" src={preview.url} controls muted preload="metadata" />
  if (preview.kind === 'audio' && preview.url) return <audio className="inbox-preview-audio" src={preview.url} controls preload="metadata" />
  return <pre className="inbox-preview inbox-preview-text">{preview.text ?? 'No preview.'}</pre>
}

/** Replace, Keep both or Skip for each name that is already here. */
function ConflictDialog({ item, conflicts, onDone, onCancel }: { item: InboxItem; conflicts: InboxConflict[]; onDone(choices: Record<string, ConflictChoice>): void; onCancel(): void }) {
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>(() => Object.fromEntries(conflicts.map((c) => [c.key, 'keepBoth'])))
  const setAll = (choice: ConflictChoice) => setChoices(Object.fromEntries(conflicts.map((c) => [c.key, choice])))
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal conflict-dialog" role="dialog" aria-label="Names already in use" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Already here</h2>
        <p>
          {conflicts.length === 1 ? 'Something' : `${conflicts.length} things`} in {item.name} {conflicts.length === 1 ? 'has' : 'have'} the same name as{' '}
          {conflicts.length === 1 ? 'something' : 'things'} you already have.
        </p>
        {conflicts.length > 1 && (
          <div className="settings-row">
            <span className="hint">All:</span>
            {CHOICES.map((c) => (
              <button key={c.value} type="button" className="button" onClick={() => setAll(c.value)}>
                {c.label}
              </button>
            ))}
          </div>
        )}
        <ul className="conflict-list">
          {conflicts.map((conflict) => (
            <li key={conflict.key}>
              <span className="conflict-name">
                <span className="hint">{conflict.what}</span> {conflict.name}
              </span>
              <div className="segmented" role="radiogroup" aria-label={`${conflict.name}`}>
                {CHOICES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    role="radio"
                    aria-checked={choices[conflict.key] === c.value}
                    className={choices[conflict.key] === c.value ? 'active' : ''}
                    onClick={() => setChoices({ ...choices, [conflict.key]: c.value })}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <p className="hint">Replace overwrites yours with the received one. Keep both adds it beside yours. Skip leaves yours as it is.</p>
        <footer className="modal-actions">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="button primary" onClick={() => onDone(choices)}>
            Accept
          </button>
        </footer>
      </div>
    </div>
  )
}

function InboxRow({ item }: { item: InboxItem }) {
  const [preview, setPreview] = useState<InboxPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ErrorLike | null>(null)
  const [conflicts, setConflicts] = useState<InboxConflict[] | null>(null)
  const Icon = KIND_ICONS[item.kind]

  async function togglePreview() {
    if (previewing) {
      setPreviewing(false)
      return
    }
    setPreviewing(true)
    if (preview) return
    try {
      setPreview(await window.api.sharing.preview(item.id))
    } catch (err) {
      setError(reportError('Inbox', err))
    }
  }

  async function accept(choices?: Record<string, ConflictChoice>) {
    setBusy(true)
    setError(null)
    setConflicts(null)
    try {
      // Announcements go into the open schedule; nothing is put in the preview or sent live.
      const serviceId = useOperatorStore.getState().service?.id ?? null
      const result = await window.api.sharing.accept(item.id, { serviceId, choices })
      if (result.status === 'conflicts') {
        setConflicts(result.conflicts)
        return
      }
      await applyAcceptResult(result)
      showMessage(result.message, 'success')
    } catch (err) {
      setError(reportError('Inbox', err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="inbox-item">
      <div className="inbox-item-main">
        <Icon size={18} className="inbox-item-icon" aria-label={KIND_LABELS[item.kind]} />
        <div className="inbox-item-info">
          <span className="inbox-item-name" title={item.name}>
            {item.name}
          </span>
          <span className="hint">
            From {item.senderName} · {formatBytes(item.size)} · {KIND_LABELS[item.kind]} · {new Date(item.receivedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
        </div>
      </div>
      <div className="inbox-item-actions">
        <button type="button" className="button" aria-pressed={previewing} onClick={togglePreview}>
          {previewing ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />} Preview
        </button>
        <button type="button" className="button primary" disabled={busy} title={ACCEPT_HINTS[item.kind]} onClick={() => accept()}>
          <Check size={14} aria-hidden="true" /> {busy ? 'Accepting…' : 'Accept'}
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          title="Delete it without adding it anywhere"
          onClick={() => window.api.sharing.reject(item.id).catch((err) => setError(reportError('Inbox', err)))}
        >
          <X size={14} aria-hidden="true" /> Reject
        </button>
      </div>
      {previewing && preview && <Preview preview={preview} />}
      <ErrorNote error={error} />
      {conflicts && <ConflictDialog item={item} conflicts={conflicts} onDone={(choices) => accept(choices)} onCancel={() => setConflicts(null)} />}
    </li>
  )
}

/** Received items, waiting to be accepted or rejected. Accepting copies into the library; nothing goes live. */
export function InboxPanel() {
  const items = useSharingStore((s) => s.inbox)
  const autoAccept = useOperatorStore((s) => s.settings.sharingAutoAccept)

  async function importPackage() {
    try {
      const item = await window.api.sharing.importPackage()
      if (item) showMessage(`${item.name} is in the Inbox. Preview it, then Accept.`, 'success')
    } catch (err) {
      showError(err, 'Inbox')
    }
  }

  return (
    <div className="alerts-panel inbox-panel" role="dialog" aria-label="Inbox">
      <header className="inbox-header">
        <strong>Inbox</strong>
        {/* An empty Inbox offers this in its empty state instead. */}
        {items.length > 0 && (
          <button type="button" className="button" onClick={importPackage} title="Open a .serviceex file, from a USB drive say">
            <PackageOpen size={14} aria-hidden="true" /> Import package…
          </button>
        )}
      </header>
      {items.length === 0 ? (
        <EmptyState
          compact
          icon={<Inbox size={20} />}
          title="Your Inbox is empty"
          description="Songs, services and media that other ServiceEx computers send you arrive here, to preview before you accept them."
          action={
            <Button variant="primary" icon={<PackageOpen size={15} aria-hidden="true" />} onClick={() => void importPackage()}>
              Import a package
            </Button>
          }
          secondaryAction={
            <Button
              variant="ghost"
              icon={<Settings size={15} aria-hidden="true" />}
              onClick={() => {
                useSharingStore.setState({ inboxOpen: false })
                useOperatorStore.getState().openSettings(true)
              }}
            >
              Sharing settings
            </Button>
          }
        />
      ) : (
        <ul className="inbox-list">
          {items.map((item) => (
            <InboxRow key={item.id} item={item} />
          ))}
        </ul>
      )}
      <p className="hint">
        Received items never go live by themselves.{autoAccept ? ' Items from trusted devices are saved straight into the library.' : ''}
      </p>
    </div>
  )
}

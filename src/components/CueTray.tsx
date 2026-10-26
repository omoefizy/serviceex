import { BellRing, CalendarPlus, Eye, Send, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CUE_KINDS } from '../../shared/cues'
import { hasFeature } from '../../shared/features'
import type { Cue, CueKind } from '../../shared/types'
import { addCueToSchedule, errorText, openCueMenu, previewCue, showMessage, useSharingStore } from '../lib/sharing'

const kindLabel = (kind: CueKind) => CUE_KINDS.find((k) => k.id === kind)?.label ?? 'Cue'

function CueCard({ cue }: { cue: Cue }) {
  const run = (action: () => Promise<unknown>) => action().catch((error) => showMessage(errorText(error), true))
  const dismiss = () => run(async () => useSharingStore.setState({ cues: await window.api.sharing.dismissCue(cue.id) }))
  return (
    <li className="cue-card">
      <div className="cue-card-head">
        <span className={`cue-kind ${cue.kind}`}>{kindLabel(cue.kind)}</span>
        <span className="cue-from">from {cue.fromName}</span>
        <time className="hint" dateTime={cue.receivedAt}>
          {new Date(cue.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </time>
      </div>
      {cue.title && cue.title !== kindLabel(cue.kind) && <strong className="cue-title">{cue.title}</strong>}
      {cue.text && <p className="cue-text">{cue.text}</p>}
      <div className="cue-actions">
        <button type="button" className="button" title="Show it in the preview. It does not go live." onClick={() => run(() => previewCue(cue))}>
          <Eye size={13} aria-hidden="true" /> Preview
        </button>
        <button type="button" className="button" onClick={() => run(() => addCueToSchedule(cue))}>
          <CalendarPlus size={13} aria-hidden="true" /> Add to schedule
        </button>
        <button type="button" className="button" onClick={dismiss}>
          <X size={13} aria-hidden="true" /> Dismiss
        </button>
      </div>
    </li>
  )
}

/** Writes a note or free text and sends it to another computer's tray. */
function CueComposer() {
  const [kind, setKind] = useState<CueKind>('note')
  const [text, setText] = useState('')
  return (
    <form
      className="cue-composer"
      onSubmit={(e) => {
        e.preventDefault()
        const box = (e.nativeEvent as SubmitEvent).submitter?.getBoundingClientRect()
        if (!text.trim() || !box) return
        openCueMenu({ clientX: box.left, clientY: box.bottom + 4, preventDefault() {} }, { kind, title: kindLabel(kind), text })
      }}
    >
      <div className="cue-composer-row">
        <select className="input" aria-label="Kind of cue" value={kind} onChange={(e) => setKind(e.target.value as CueKind)}>
          <option value="note">Note</option>
          <option value="text">Text</option>
          <option value="point">Point</option>
        </select>
        <button type="submit" className="button" disabled={!text.trim()}>
          <Send size={13} aria-hidden="true" /> Send to device…
        </button>
      </div>
      <textarea className="input" rows={2} placeholder="Write a note or text for another computer" value={text} onChange={(e) => setText(e.target.value)} />
    </form>
  )
}

/** The toolbar's cue tray: what other computers sent this one. Nothing here goes live by itself. */
export function CueTray() {
  const cues = useSharingStore((s) => s.cues)
  const open = useSharingStore((s) => s.cueTrayOpen)
  const unseen = useSharingStore((s) => s.unseenCues)
  const flash = useSharingStore((s) => s.cueFlash)
  const enabled = useSharingStore((s) => s.status?.enabled ?? false)
  const [flashing, setFlashing] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!flash) return
    setFlashing(true)
    const timer = setTimeout(() => setFlashing(false), 2400)
    return () => clearTimeout(timer)
  }, [flash])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      const target = e.target as Element
      // The Send to menu opened from the composer sits outside the tray but belongs to it.
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(target) && !target.closest?.('.send-menu')) {
        useSharingStore.setState({ cueTrayOpen: false })
      }
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])

  if (!hasFeature('sharing.send') || (!enabled && cues.length === 0)) return null
  return (
    <div className="alerts-control" ref={ref}>
      <button
        type="button"
        className={`icon-button toolbar-icon${open ? ' active' : ''}${flashing ? ' cue-flash' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Cues, ${cues.length}`}
        title="Cues: verses, songs, points and notes other computers sent here. They never go live by themselves."
        onClick={() => useSharingStore.setState({ cueTrayOpen: !open, unseenCues: 0 })}
      >
        <BellRing size={18} />
        {cues.length > 0 && <span className={`inbox-badge${unseen > 0 ? ' new' : ''}`}>{cues.length}</span>}
      </button>
      {open && (
        <div className="alerts-panel cue-tray" role="dialog" aria-label="Cues">
          <h3>Cues</h3>
          {enabled && <CueComposer />}
          {cues.length === 0 ? (
            <p className="hint">Nothing yet. Other computers can send verses, songs, points and notes here with Send to device.</p>
          ) : (
            <ul className="cue-list">
              {cues.map((cue) => (
                <CueCard key={cue.id} cue={cue} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

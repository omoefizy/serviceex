import { Layers, MoreHorizontal, PanelBottom, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { reportError, type ErrorLike } from '../lib/errors'
import { pinStatement, useListener } from '../lib/listener'
import { chipOf } from '../lib/listenerStatus'
import { groupPassageOf } from '../lib/scripture'
import { useSuggestions, type ScriptureSuggestion, type StatementSuggestion, type Suggestion } from '../lib/scriptureDetection'
import { useCombine } from '../lib/scriptureGroup'
import { askUpgrade } from '../lib/upgrade'
import { Locked, LockIcon } from './Locked'
import { canSendCues, openCueMenu, useSharingStore } from '../lib/sharing'
import { quotePayload } from '../lib/slides'
import { useDismiss } from '../lib/useDismiss'
import { useOperatorStore } from '../store'
import { can } from '../../shared/features'
import { QuickLowerThird } from './QuickLowerThird'
import { QuoteModal } from './QuoteModal'
import { Button, EmptyState, ErrorNote, IconButton } from './ui'

/** A heard verse as a cue: its passage, word for word. */
const verseCue = (s: ScriptureSuggestion) => ({ kind: 'verse' as const, title: s.passage.title, text: s.passage.verses.map((v) => v.text).join('\n'), verses: s.passage.verses })

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })

/** "just now", "20s ago", "3 min ago". */
function agoOf(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return seconds < 5 ? 'just now' : seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)} min ago`
}

/** A row's other actions, in a small menu from its ⋯ button. */
function RowMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, ref, close)
  return (
    <div className="heard-menu-anchor" ref={ref}>
      <IconButton size="sm" label={label} icon={<MoreHorizontal size={16} />} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} />
      {open && (
        <div className="live-menu-list heard-menu" role="menu" aria-label={label}>
          {children(close)}
        </div>
      )}
    </div>
  )
}

/** A menu item that closes the menu once chosen. */
function MenuItem({ close, title, disabled, onClick, children }: { close(): void; title?: string; disabled?: boolean; onClick(e: ReactMouseEvent<HTMLButtonElement>): void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      title={title}
      disabled={disabled}
      onClick={(e) => {
        onClick(e)
        close()
      }}
    >
      {children}
    </button>
  )
}

/**
 * Heard in the sermon: verses heard in the live transcript, and statements the AI picked from it, newest first. Preview
 * puts one in the Preview monitor; Show live puts it in the preview and sends it on screen, as Enter or Send to live
 * would. Verses disappear after two minutes and statements after three, or when dismissed.
 *
 * A slim strip shows the newest two, with See all for the whole list in a popover. With `fullList` (scripture in the
 * grid, or nothing) the whole list also fills the middle column under the strip.
 */
export function SuggestionTray({ fullList }: { fullList: boolean }) {
  const { suggestions, previewedId, flashKey, preview, dismiss, editStatement } = useSuggestions()
  const service = useOperatorStore((s) => s.service)
  const speaker = useOperatorStore((s) => s.settings.quoteSpeakerName)
  const addToSchedule = useOperatorStore((s) => s.addToSchedule)
  const liveDeckKey = useOperatorStore((s) => (s.live.slideIndex !== null ? s.live.deckKey : null))
  const [flashing, setFlashing] = useState(false)
  const [allOpen, setAllOpen] = useState(false)
  const allRef = useRef<HTMLDivElement>(null)
  const closeAll = useCallback(() => setAllOpen(false), [])
  useDismiss(allOpen, allRef, closeAll)
  const [editing, setEditing] = useState<StatementSuggestion | null>(null)
  /** The statement open in the Send as lower third box: in its row of the full list, or under the strip's cards. */
  const [quick, setQuick] = useState<{ id: number; text: string; where: 'row' | 'strip' } | null>(null)
  const canLowerThird = can('lowerThirds')
  /** Statements saved to the schedule this session, so the menu says so. */
  const [scheduled, setScheduled] = useState<Set<number>>(new Set())
  /** Verses added to the schedule this session, so the menu says so. */
  const [ordered, setOrdered] = useState<Set<number>>(new Set())
  /** Statements pinned to the sermon being recorded, so the menu says so. */
  const [pinned, setPinned] = useState<Set<number>>(new Set())
  const recording = useListener((st) => st.sermon)
  const status = useListener((st) => st.status)
  const mode = useListener((st) => st.mode)
  const modeReason = useListener((st) => st.modeReason)
  const listenerError = useListener((st) => st.error)
  const restarting = useListener((st) => st.restarting)
  const listener = chipOf(status, mode, modeReason, listenerError, restarting)
  const listening = status === 'listening'
  const [error, setError] = useState<ErrorLike | null>(null)
  // Re-renders when sharing turns on or off, for Send to device.
  useSharingStore((st) => st.status?.enabled)
  const sendable = canSendCues()
  /** Ticks each second while there are rows, for "20s ago". */
  const [now, setNow] = useState(() => Date.now())
  const showing = suggestions.length > 0

  useEffect(() => {
    if (!showing) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [showing])

  useEffect(() => {
    if (flashKey === 0) return
    setFlashing(true)
    const timer = setTimeout(() => setFlashing(false), 1200)
    return () => clearTimeout(timer)
  }, [flashKey])

  async function schedule(s: StatementSuggestion) {
    setError(null)
    try {
      await addToSchedule('announcement', null, quotePayload(s.text, speaker))
      setScheduled((current) => new Set(current).add(s.id))
    } catch (err) {
      setError(reportError('Suggestions', err))
    }
  }

  async function addVerse(s: ScriptureSuggestion) {
    setError(null)
    try {
      await addToSchedule('scripture', null, s.passage)
      setOrdered((current) => new Set(current).add(s.id))
    } catch (err) {
      setError(reportError('Suggestions', err))
    }
  }

  const tray = useCombine((st) => st.passages)
  const inTray = (s: ScriptureSuggestion) => tray.some((p) => p.reference === s.label && p.version === s.version)

  /** Into the combine tray on the Preview header, to go on one slide with other passages. */
  function addToCombine(s: ScriptureSuggestion) {
    if (!can('scripture.combine')) return askUpgrade('scripture.combine')
    setError(null)
    if (!useCombine.getState().add(groupPassageOf(s.passage, s.label, s.version))) setError('The combine tray holds at most four passages.')
  }

  /** Into the preview, handing the keyboard back to the page so the next Enter sends it live. */
  function toPreview(s: Suggestion, e: ReactMouseEvent<HTMLElement>, option?: number) {
    preview(s.id, option)
    e.currentTarget.blur()
  }

  /** Into the preview and straight on screen, as Send to live does. */
  function showLive(s: Suggestion, e: ReactMouseEvent<HTMLElement>) {
    toPreview(s, e)
    useOperatorStore.getState().goLiveHighlighted()
  }

  /** On screen now: the live item is this card's passage, or one of its other readings. */
  const isLive = (s: Suggestion) =>
    s.type === 'scripture' && liveDeckKey !== null && [s, ...s.alternatives].some((option) => liveDeckKey === `scripture:${option.passage.title}`)

  function actions(s: Suggestion, primary: boolean) {
    if (isLive(s)) return <span className="heard-live-chip">LIVE</span>
    return (
      <>
        <Button size="sm" title="Show it in the Preview monitor; Enter or Send to live then puts it on screen" onClick={(e) => toPreview(s, e)}>
          Preview
        </Button>
        <Button size="sm" variant={primary ? 'primary' : 'secondary'} title="Put it on screen now" onClick={(e) => showLive(s, e)}>
          Show live
        </Button>
      </>
    )
  }

  function scriptureRow(s: ScriptureSuggestion) {
    const live = isLive(s)
    const previewed = s.id === previewedId
    return (
      <li key={s.id} className={`heard-row${previewed ? ' previewed' : ''}${live ? ' live' : ''}${s.kind === 'reference' ? '' : ` ${s.kind}`}`}>
        <div className="heard-ref">
          <strong className="heard-label">{s.label}</strong>
          <span className={`heard-meta${s.confidence >= 0.9 ? ' strong' : ''}`} title={`Heard at ${timeOf(s.heardAt)}`}>
            {Math.round(s.confidence * 100)}% · {agoOf(now - s.heardAt)}
          </span>
          {s.kind === 'quote' && <span className="heard-tag">Possible quote{s.version !== 'KJV' ? ` · ${s.version}` : ''}</span>}
          {s.kind === 'ai' && <span className="heard-tag ai">AI suggested</span>}
        </div>
        <button
          type="button"
          className="heard-text"
          title={`Heard: "${s.heard}" · ${Math.round(s.confidence * 100)}% sure. Click to preview; Enter or Send to live sends it.`}
          onClick={(e) => toPreview(s, e)}
        >
          {s.highlight ? s.highlight.map((part, i) => (part.match ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>)) : s.text}
        </button>
        {actions(s, previewed)}
        <RowMenu label={`More for ${s.label}`}>
          {(close) => (
            <>
              {s.alternatives.map((alt, i) => (
                <MenuItem key={alt.label} close={close} title={`${Math.round(alt.confidence * 100)}% sure: ${alt.passage.verses[0]?.text ?? ''}`} onClick={(e) => toPreview(s, e, i)}>
                  Preview {alt.label} instead
                </MenuItem>
              ))}
              <MenuItem close={close} title="Put it in the tray on the Preview header, to combine on one slide with other passages" disabled={inTray(s)} onClick={() => addToCombine(s)}>
                {inTray(s) ? 'In the combine tray' : 'Add to combine'} <LockIcon feature="scripture.combine" />
              </MenuItem>
              <MenuItem close={close} title={service ? `Add it to ${service.name}` : 'Create or pick a service first'} disabled={!service || ordered.has(s.id)} onClick={() => addVerse(s)}>
                {ordered.has(s.id) ? 'Added to order' : 'Add to order'}
              </MenuItem>
              {sendable && (
                <MenuItem close={close} title="Send to device: a cue in that computer's tray. It does not go live there." onClick={(e) => openCueMenu(e, verseCue(s))}>
                  Send to device
                </MenuItem>
              )}
              <MenuItem close={close} onClick={() => dismiss(s.id)}>
                Dismiss
              </MenuItem>
            </>
          )}
        </RowMenu>
      </li>
    )
  }

  function statementRow(s: StatementSuggestion) {
    const previewed = s.id === previewedId
    return (
      <li key={s.id} className={`heard-row statement${previewed ? ' previewed' : ''}`}>
        <div className="heard-ref">
          <strong className="heard-label">Statement</strong>
          <span className="heard-meta">{timeOf(s.heardAt)}</span>
        </div>
        <button type="button" className="heard-text" title={`Said at ${timeOf(s.heardAt)}, picked by AI from the transcript word for word. Click to preview it as a quote slide.`} onClick={(e) => toPreview(s, e)}>
          “{s.text}”
        </button>
        {actions(s, previewed)}
        <RowMenu label="More for this statement">
          {(close) => (
            <>
              <MenuItem close={close} title="Fix spelling or trim words first" onClick={() => setEditing(s)}>
                Edit
              </MenuItem>
              {canLowerThird && (
                <MenuItem close={close} title="Edit the words, then show them as a lower third in the default design" onClick={() => setQuick({ id: s.id, text: s.text, where: 'row' })}>
                  Send as lower third
                </MenuItem>
              )}
              <MenuItem close={close} title={service ? `Save it to ${service.name} as a quote, to use again` : 'Create or pick a service first'} disabled={!service || scheduled.has(s.id)} onClick={() => schedule(s)}>
                {scheduled.has(s.id) ? 'Added to Schedule' : 'Add to Schedule'}
              </MenuItem>
              {recording && (
                <MenuItem
                  close={close}
                  title={`Pin it to the sermon “${recording.title}”, for its slides and exports`}
                  disabled={pinned.has(s.id)}
                  onClick={() => {
                    pinStatement(s.text)
                    setPinned((ids) => new Set(ids).add(s.id))
                  }}
                >
                  {pinned.has(s.id) ? 'Pinned' : 'Pin to Sermon'}
                </MenuItem>
              )}
              {sendable && (
                <MenuItem close={close} title="Send to device: the exact words as a cue in that computer's tray. It does not go live there." onClick={(e) => openCueMenu(e, { kind: 'text', title: 'Statement', text: s.text })}>
                  Send to device
                </MenuItem>
              )}
              <MenuItem close={close} onClick={() => dismiss(s.id)}>
                Dismiss
              </MenuItem>
            </>
          )}
        </RowMenu>
        {quick?.id === s.id && quick.where === 'row' && <QuickLowerThird className="heard-lower-third" text={quick.text} onClose={() => setQuick(null)} />}
      </li>
    )
  }

  /** A small card in the strip: the reference and its buttons, then the match and one line of the words. */
  function compactCard(s: Suggestion) {
    const previewed = s.id === previewedId
    const scripture = s.type === 'scripture'
    return (
      <li key={s.id} className={`heard-mini${previewed ? ' previewed' : ''}${isLive(s) ? ' live' : ''}${scripture ? '' : ' statement'}`}>
        <div className="heard-mini-top">
          <strong className="heard-label" title={scripture ? s.label : undefined}>
            {scripture ? s.label : 'Statement'}
          </strong>
          {actions(s, previewed)}
          {!scripture && canLowerThird && (
            <IconButton
              size="sm"
              label="Send as lower third"
              tooltip="Send as lower third: edit the words, then show them in the default design"
              icon={<PanelBottom size={14} />}
              pressed={quick?.id === s.id && quick.where === 'strip'}
              onClick={() => setQuick(quick?.id === s.id && quick.where === 'strip' ? null : { id: s.id, text: s.text, where: 'strip' })}
            />
          )}
          {scripture && !isLive(s) && (
            <Locked feature="scripture.combine">
              <IconButton
                size="sm"
                label={inTray(s) ? `${s.label} is in the combine tray` : `Add ${s.label} to combine`}
                tooltip="Add to combine: the tray on the Preview header puts several passages on one slide"
                icon={<Layers size={14} />}
                disabled={inTray(s)}
                onClick={() => addToCombine(s)}
              />
            </Locked>
          )}
        </div>
        <button
          type="button"
          className="heard-mini-text"
          title={scripture ? `Heard: "${s.heard}" · ${Math.round(s.confidence * 100)}% sure. Click to preview.` : `Said at ${timeOf(s.heardAt)}. Click to preview it as a quote slide.`}
          onClick={(e) => toPreview(s, e)}
        >
          {scripture ? (
            <span className={`heard-meta${s.confidence >= 0.9 ? ' strong' : ''}`}>{Math.round(s.confidence * 100)}%</span>
          ) : (
            <span className="heard-meta">{timeOf(s.heardAt)}</span>
          )}
          <span className="heard-mini-words">{scripture ? s.text : `“${s.text}”`}</span>
        </button>
      </li>
    )
  }

  const list = (
    <>
      <ErrorNote error={error} />
      {showing ? (
        <ul className="heard-list">{suggestions.map((s) => (s.type === 'scripture' ? scriptureRow(s) : statementRow(s)))}</ul>
      ) : (
        <EmptyState
          compact
          icon={<Sparkles size={20} />}
          title="Nothing heard yet"
          description={listening ? 'Verses the speaker names or quotes show here, newest first.' : 'Start listening and the verses the speaker names or quotes show here.'}
        />
      )}
    </>
  )

  return (
    <>
      <section className={`heard-strip${flashing ? ' flash' : ''}`} aria-label="Scripture and statements heard in the sermon">
        <header className="heard-strip-head">
          <h2 className="heard-title">Heard in the sermon</h2>
          <span className={`heard-status${listening ? ' on' : ''}`} title={listener.why}>
            <span className="heard-status-dot" aria-hidden="true" />
            {listener.label.toUpperCase()}
          </span>
          <div className="heard-strip-actions">
            <div className="heard-all-anchor" ref={allRef}>
              <Button size="sm" variant="ghost" className="heard-see-all" title="Every verse and statement heard" aria-haspopup="dialog" aria-expanded={allOpen} onClick={() => setAllOpen(!allOpen)}>
                See all{showing ? ` (${suggestions.length})` : ''}
              </Button>
              <div className="heard-all-popover" role="dialog" aria-label="Everything heard in the sermon" hidden={!allOpen}>
                {allOpen && list}
              </div>
            </div>
            <Button size="sm" variant="ghost" className="heard-clear" title="Dismiss every row" disabled={!showing} onClick={() => suggestions.forEach((s) => dismiss(s.id))}>
              Clear all
            </Button>
          </div>
        </header>
        {showing ? (
          <ul className="heard-mini-list">{suggestions.slice(0, 2).map(compactCard)}</ul>
        ) : (
          <p className="heard-strip-empty">
            <Sparkles size={16} aria-hidden="true" />
            {listening ? 'Nothing heard yet. Verses the speaker names or quotes show here.' : 'Start listening and the verses the speaker names or quotes show here.'}
          </p>
        )}
        {quick?.where === 'strip' && <QuickLowerThird key={quick.id} className="heard-lower-third" text={quick.text} onClose={() => setQuick(null)} />}
      </section>
      {fullList && (
        <section className="heard-card operator-main" aria-label="Everything heard in the sermon">
          <header className="heard-head">
            <h2 className="heard-title">All heard</h2>
            <span className="monitor-meta">{showing ? `${suggestions.length} newest first` : 'Nothing yet'}</span>
          </header>
          {list}
        </section>
      )}
      {editing && (
        <QuoteModal
          text={editing.text}
          onCancel={() => setEditing(null)}
          onDone={(text, sentTo) => {
            editStatement(editing.id, text)
            if (sentTo === 'preview') useSuggestions.setState({ previewedId: editing.id })
            else setScheduled((current) => new Set(current).add(editing.id))
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

import {
  AlertTriangle,
  Baseline,
  Bold,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Eraser,
  EyeOff,
  Highlighter,
  LayoutGrid,
  MousePointerClick,
  PanelBottom,
  Presentation,
  RefreshCw,
  SlidersHorizontal,
  Underline,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { HIGHLIGHT_COLORS, HIGHLIGHT_KINDS, isMarked, sentenceAt, slideRich, wordAt, wordsBetween } from '../../shared/highlights'
import { comparePos, type RichPos } from '../../shared/richText'
import type { DualTranslation, HighlightKind, LivePowerPointStatus, OutputState } from '../../shared/types'
import { reportError, type ErrorLike } from '../lib/errors'
import { pickHighlightColor } from '../lib/highlights'
import { MOD, SHOW_LOWER_THIRD_EVENT } from '../lib/shortcuts'
import { parseVerseCaption, slideLines } from '../lib/slides'
import { slideTranslation } from '../lib/translations'
import { useDismiss } from '../lib/useDismiss'
import {
  selectBrowsingLive,
  selectDeckTheme,
  selectLiveSlide,
  selectMarkTarget,
  selectOutputState,
  selectPreviewSlide,
  slideTheme,
  useOperatorStore,
  type DeckSlide,
  type TranslationTarget,
} from '../store'
import { LowerThirdPanel } from './LowerThirdPanel'
import { OutputScreen } from './OutputView'
import { ScriptureQuickAdjust } from './ScriptureDisplay'
import { ThemedSlide } from './ThemedSlide'
import { Button, ErrorNote, IconButton, Panel, Select } from './ui'

/** "Slide 2 of 5" across the corner of a screen, when it shows a slide. */
function SlideBadge({ index, count }: { index: number | null; count: number }) {
  if (index === null || count === 0) return null
  return (
    <span className="screen-badge">
      Slide {index + 1} of {count}
    </span>
  )
}

/** "Slide 3, step 2 of 4" while PowerPoint plays the live slide, when it can tell the step. */
function powerPointText(status: LivePowerPointStatus): string {
  if (status.phase === 'starting') return 'Starting…'
  if (status.slideIndex === null) return 'Waiting'
  const step = status.steps ? `, step ${status.step ?? '?'} of ${status.steps}` : ''
  return `Slide ${status.slideIndex + 1}${step}${status.phase === 'covered' ? ' (under the output)' : ''}`
}

const DUAL_LAYOUTS: { value: DualTranslation['layout']; label: string }[] = [
  { value: 'stacked', label: 'Above and below' },
  { value: 'sideBySide', label: 'Side by side' },
]

/**
 * Version chips under a screen showing scripture: a chip reads the same verses in that translation. Dual puts a
 * second translation on the slide too. Its notes (a missing verse, cleared highlights) are the `note` part, shown over
 * the screen so they are seen while the chips are tucked in the Tools popover.
 */
function TranslationBar({ where, part }: { where: TranslationTarget; part: 'chips' | 'note' }) {
  const slide = useOperatorStore((s) =>
    where === 'live' ? (s.live.itemType === 'scripture' ? selectLiveSlide(s) : null) : s.deckType === 'scripture' ? selectPreviewSlide(s) : null,
  )
  const versions = useOperatorStore((s) => s.bibleVersions)
  const dual = useOperatorStore((s) => s.settings.scriptureDual)
  const note = useOperatorStore((s) => (s.translationNote?.where === where ? s.translationNote : null))
  const switchTranslation = useOperatorStore((s) => s.switchTranslation)
  const setDualTranslation = useOperatorStore((s) => s.setDualTranslation)
  const dismissNote = useOperatorStore((s) => s.dismissTranslationNote)
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const current = slideTranslation(slide)

  // The menu closes on a click outside it.
  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } catch (err) {
      useOperatorStore.setState({ translationNote: { where, text: reportError('Live and Preview', err).message, error: true } })
    } finally {
      setBusy(false)
    }
  }

  const noteLine = note && (
    <p className={`translation-note${note.error ? ' error' : ''}`} role={note.error ? 'alert' : 'status'}>
      {note.error && <AlertTriangle size={13} aria-hidden="true" />}
      <span>{note.text}</span>
      <IconButton size="sm" label="Dismiss" icon={<X size={14} />} onClick={dismissNote} />
    </p>
  )
  if (part === 'note') return noteLine || null
  if (!current || versions.length === 0) return null

  const others = versions.filter((v) => v.code !== current.version)
  const second = current.second ?? (dual.second !== current.version ? dual.second : others[0]?.code)
  const applyDual = (next: DualTranslation) => run(() => setDualTranslation(where, next))

  return (
    <>
      <div className="translation-bar" role="group" aria-label={`${where === 'live' ? 'Live' : 'Preview'} translation`}>
        {versions.map((v, i) => (
          <button
            key={v.code}
            type="button"
            className={`translation-chip${v.code === current.version ? ' active' : ''}${v.code === current.second ? ' second' : ''}`}
            aria-pressed={v.code === current.version}
            title={`${v.name}${i < 9 ? ` (${MOD}${i + 1})` : ''}`}
            disabled={busy}
            onClick={() => v.code !== current.version && run(() => switchTranslation(where, v.code))}
          >
            {v.code}
          </button>
        ))}
        {others.length > 0 && (
          <div className="translation-dual" ref={menuRef}>
            <button
              type="button"
              className={`translation-chip${current.second ? ' active' : ''}`}
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              title="Two translations on one slide"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Columns2 size={12} aria-hidden="true" /> Dual
            </button>
            {menuOpen && (
              <div className="translation-menu" role="dialog" aria-label="Two translations">
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={current.second !== null}
                    disabled={busy || !second}
                    onChange={(e) => second && applyDual({ ...dual, enabled: e.target.checked, second })}
                  />
                  Show two translations
                </label>
                <label className="field">
                  <span>First</span>
                  <select className="input" value={current.version} disabled={busy} onChange={(e) => run(() => switchTranslation(where, e.target.value))}>
                    {versions.map((v) => (
                      <option key={v.code} value={v.code}>
                        {v.code}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Second</span>
                  <select className="input" value={second} disabled={busy} onChange={(e) => applyDual({ ...dual, enabled: true, second: e.target.value })}>
                    {others.map((v) => (
                      <option key={v.code} value={v.code}>
                        {v.code}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="segmented" role="radiogroup" aria-label="Layout">
                  {DUAL_LAYOUTS.map((l) => (
                    <button
                      key={l.value}
                      type="button"
                      role="radio"
                      aria-checked={dual.layout === l.value}
                      className={dual.layout === l.value ? 'active' : ''}
                      disabled={busy}
                      onClick={() => second && applyDual({ ...dual, enabled: current.second !== null, second, layout: l.value })}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}

const KIND_ICONS: Record<HighlightKind, LucideIcon> = { highlight: Highlighter, bold: Bold, underline: Underline, color: Baseline }

/**
 * The live highlighting toolbar over a screen: highlight mode, the brush (a highlighter, bold, underline or a text
 * color), its color, and Clear all. The brush is shared by both screens; Clear all clears this screen's slide.
 */
function HighlightBar({ where }: { where: TranslationTarget }) {
  const mode = useOperatorStore((s) => s.highlightMode)
  const style = useOperatorStore((s) => s.highlightStyle)
  const markable = useOperatorStore((s) => selectMarkTarget(s, where) !== null)
  const marked = useOperatorStore((s) => isMarked(selectMarkTarget(s, where)?.slide))
  const setMode = useOperatorStore((s) => s.setHighlightMode)
  const setStyle = useOperatorStore((s) => s.setHighlightStyle)
  const clear = useOperatorStore((s) => s.clearHighlights)

  return (
    <div className="rt-toolbar highlight-bar" role="toolbar" aria-label={`${where === 'live' ? 'Live' : 'Preview'} highlighting`}>
      <button
        type="button"
        className={`rt-button${mode ? ' on' : ''}`}
        aria-pressed={mode}
        aria-label={`Highlight mode (${MOD}H)`}
        title={`Highlight mode (${MOD}H): click a word to mark it, drag across a phrase, double click a sentence`}
        onClick={() => setMode(!mode)}
      >
        <MousePointerClick size={14} aria-hidden="true" />
      </button>
      <span className="highlight-group" role="radiogroup" aria-label="Brush">
        {HIGHLIGHT_KINDS.map(({ id, label }) => {
          const Icon = KIND_ICONS[id]
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={style.kind === id}
              className={`rt-button${style.kind === id ? ' on' : ''}`}
              aria-label={label}
              title={label}
              onClick={() => setStyle({ kind: id })}
            >
              <Icon size={14} aria-hidden="true" />
            </button>
          )
        })}
      </span>
      <span className="highlight-group" role="radiogroup" aria-label="Color">
        {HIGHLIGHT_COLORS.map((color, i) => (
          <button
            key={color.id}
            type="button"
            role="radio"
            aria-checked={style.color === color.id}
            className={`highlight-swatch${style.color === color.id ? ' on' : ''}`}
            style={{ background: style.kind === 'color' ? color.ink : color.fill }}
            aria-label={color.label}
            title={`${color.label}${mode ? ` (${i + 1})` : ''}`}
            onClick={() => pickHighlightColor(color.id)}
          />
        ))}
      </span>
      <button
        type="button"
        className="rt-button highlight-clear"
        aria-label={where === 'live' ? 'Clear all highlights (Esc)' : 'Clear all highlights'}
        title={where === 'live' ? 'Clear all highlights (Esc)' : 'Clear all highlights'}
        disabled={!markable || !marked}
        onClick={() => clear(where)}
      >
        <Eraser size={14} aria-hidden="true" />
      </button>
      <ScriptureQuickAdjust where={where} />
    </div>
  )
}

/** The place in the slide's words under the pointer: a line of the main text box (see ThemedSlide), and how far into it. */
function positionAt(screen: HTMLElement, x: number, y: number): RichPos | null {
  const line = document.elementFromPoint(x, y)?.closest('.themed-line')
  const box = line?.parentElement
  const caret = document.caretRangeFromPoint(x, y)
  // Reference and translation lines lose their brackets on screen, so only plain lines of words can be marked.
  if (!line || !box?.hasAttribute('data-slide-text') || !screen.contains(box) || !line.classList.contains('text') || !caret) return null
  if (!line.contains(caret.startContainer)) return null
  const before = document.createRange()
  before.setStart(line, 0)
  before.setEnd(caret.startContainer, caret.startOffset)
  return { p: Array.from(box.children).indexOf(line), o: before.toString().length }
}

/**
 * Clicks on a screen in highlight mode: a click marks the word, a drag the words it crosses, a double click the
 * sentence. Each toggles the brush on the screen's slide.
 */
function useWordMarking(where: TranslationTarget) {
  const marking = useOperatorStore((s) => s.highlightMode && selectMarkTarget(s, where) !== null)
  const anchor = useRef<RichPos | null>(null)
  if (!marking) return { marking, handlers: {} }

  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    anchor.current = positionAt(e.currentTarget, e.clientX, e.clientY)
    // A drag marks words; it does not select the page's text.
    e.preventDefault()
  }
  const onMouseUp = (e: ReactMouseEvent<HTMLDivElement>) => {
    const from = anchor.current
    anchor.current = null
    const st = useOperatorStore.getState()
    const target = selectMarkTarget(st, where)
    if (e.button !== 0 || !from || !target) return
    const rich = slideRich(target.slide)
    const to = positionAt(e.currentTarget, e.clientX, e.clientY) ?? from
    const sentence = e.detail >= 2
    const range = sentence ? sentenceAt(rich, to) : comparePos(from, to) === 0 ? wordAt(rich, from) : wordsBetween(rich, from, to)
    if (range) st.markWords(where, range, sentence)
  }
  return { marking, handlers: { onMouseDown, onMouseUp } }
}

/** ON AIR while a slide is on air; otherwise the output mode, or READY. */
function OnAirChip() {
  const mode = useOperatorStore((s) => s.live.mode)
  const onAir = useOperatorStore((s) => s.live.mode === 'show' && s.live.slideIndex !== null)
  if (onAir) {
    return (
      <span className="on-air-chip live" role="status">
        <span className="live-dot" aria-hidden="true" /> ON AIR
      </span>
    )
  }
  return (
    <span className="on-air-chip" role="status">
      {mode === 'show' ? 'READY' : mode.toUpperCase()}
    </span>
  )
}

/** What the screen here draws: the projector's output, or nothing (to save effort on a slow computer). */
const SCREEN_CHOICES = [
  { value: 'output', label: 'Main output' },
  { value: 'off', label: 'Preview off' },
] as const

interface HeaderPopoverProps {
  /** The popover's name, and the button's when it has no text. */
  label: string
  icon: ReactNode
  /** Text on the button; without it the button is an icon. */
  text?: string
  tooltip: string
  open: boolean
  onOpenChange(open: boolean): void
  /** Marks the button, such as while the lower third is on screen. */
  active?: boolean
  className?: string
  children: ReactNode
}

/**
 * A button in a monitor's header and the popover it opens under it. The contents stay mounted while it is shut, so
 * they keep their state (and Cmd+L can reach the lower third headline).
 */
function HeaderPopover({ label, icon, text, tooltip, open, onOpenChange, active = false, className, children }: HeaderPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => onOpenChange(false), [onOpenChange])
  useDismiss(open, ref, close)
  const common = { 'aria-expanded': open, 'aria-haspopup': 'dialog' as const, onClick: () => onOpenChange(!open) }
  return (
    <div className="monitor-popover-anchor" ref={ref}>
      {text ? (
        <Button size="sm" variant="ghost" className={`monitor-header-button${active ? ' active' : ''}`} icon={icon} title={tooltip} {...common}>
          {text}
        </Button>
      ) : (
        <IconButton size="sm" className={`monitor-header-button${active ? ' active' : ''}`} label={label} tooltip={tooltip} icon={icon} {...common} />
      )}
      <div className={`monitor-popover${className ? ` ${className}` : ''}`} role="dialog" aria-label={label} hidden={!open}>
        {children}
      </div>
    </div>
  )
}

/** The 16:9 screen of a monitor card, as large as its box allows; notes over it sit along its bottom. */
function MonitorStage({ where, notes, children }: { where: TranslationTarget; notes?: ReactNode; children: ReactNode }) {
  const marking = useWordMarking(where)
  return (
    <div className="monitor-stage">
      <div className={`preview-screen ${where}${marking.marking ? ' marking' : ''}`} {...marking.handlers}>
        {children}
      </div>
      {notes && <div className="monitor-notes">{notes}</div>}
    </div>
  )
}

/** Preview: the highlighted slide of the item in the grid, with its theme; Send to live (or Enter) puts it on screen. */
export function PreviewMonitor() {
  const previewSlide = useOperatorStore(selectPreviewSlide)
  const deckTheme = useOperatorStore(selectDeckTheme)
  const previewTheme = useMemo(() => slideTheme(deckTheme, previewSlide), [deckTheme, previewSlide])
  const deckTitle = useOperatorStore((s) => s.deckTitle)
  const highlightIndex = useOperatorStore((s) => s.highlightIndex)
  const slideCount = useOperatorStore((s) => s.slides.length)
  const logoUrl = useOperatorStore((s) => s.settings.logoUrl)
  const goLiveHighlighted = useOperatorStore((s) => s.goLiveHighlighted)
  const [toolsOpen, setToolsOpen] = useState(false)

  return (
    <Panel
      className="monitor-card preview-card"
      title="Preview"
      meta={
        <span className="monitor-meta" title={(highlightIndex !== null && deckTitle) || undefined}>
          {previewSlide ? 'Next to go live' : 'Nothing selected'}
        </span>
      }
      actions={
        <HeaderPopover label="Preview tools" tooltip="Highlighting and translations for the preview" icon={<SlidersHorizontal size={16} />} open={toolsOpen} onOpenChange={setToolsOpen}>
          <HighlightBar where="preview" />
          <TranslationBar where="preview" part="chips" />
        </HeaderPopover>
      }
    >
      <MonitorStage where="preview" notes={<TranslationBar where="preview" part="note" />}>
        {previewSlide ? (
          <ThemedSlide theme={previewTheme} text={previewSlide.text} caption={previewSlide.caption} copyright={previewSlide.copyright} rich={previewSlide.rich} logoUrl={logoUrl} />
        ) : (
          <p className="screen-off">Select a slide to preview it here.</p>
        )}
        <SlideBadge index={previewSlide ? highlightIndex : null} count={slideCount} />
      </MonitorStage>
      <Button variant="primary" className="monitor-action" disabled={slideCount === 0 || highlightIndex === null} title="Send the preview live (Enter)" onClick={goLiveHighlighted}>
        Send to live
      </Button>
    </Panel>
  )
}

/**
 * Live: exactly what the projector shows, with Previous and Next. Its tools (highlighting, crossfade, translations,
 * the output drawn here, Go Back) and the lower third open as popovers from the header; PowerPoint's status, Resend and
 * notes show over the screen.
 */
export function LiveMonitor({ lowerThird }: { lowerThird: boolean }) {
  const live = useOperatorStore((s) => s.live)
  const fadeMs = useOperatorStore((s) => s.settings.fadeMs)
  const setFadeMs = useOperatorStore((s) => s.setFadeMs)
  const resendLive = useOperatorStore((s) => s.resendLive)
  const goBack = useOperatorStore((s) => s.goBack)
  const previewOutput = useOperatorStore((s) => s.settings.previewOutput)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  // Exactly what the projector draws; a string compares by value, so the screen redraws only when it changes.
  const outputJson = useOperatorStore((s) => (s.settings.previewOutput ? JSON.stringify(selectOutputState(s)) : null))
  const output = useMemo(() => (outputJson ? (JSON.parse(outputJson) as OutputState) : null), [outputJson])
  const canGoBack = useOperatorStore((s) => s.liveHistory.length > 0)
  const powerPoint = useOperatorStore((s) => s.live.powerPoint && s.settings.presentationLivePowerPoint)
  const powerPointStatus = useOperatorStore((s) => s.livePowerPoint)
  const lowerThirdLive = useOperatorStore((s) => s.live.lowerThird !== null)
  const [dismissedFailure, setDismissedFailure] = useState(0)
  const [error, setError] = useState<ErrorLike | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [lowerThirdOpen, setLowerThirdOpen] = useState(false)

  // Cmd+L and Send to Lower Third open the lower third, to put the keyboard in its headline.
  useEffect(() => {
    if (!lowerThird) return
    const open = () => setLowerThirdOpen(true)
    window.addEventListener(SHOW_LOWER_THIRD_EVENT, open)
    return () => window.removeEventListener(SHOW_LOWER_THIRD_EVENT, open)
  }, [lowerThird])

  async function resend() {
    try {
      await resendLive()
      setError(null)
    } catch (err) {
      setError(reportError('Live and Preview', err))
    }
  }

  const notes = (
    <>
      {powerPoint && (
        // The output shows PowerPoint's own slide show; the screen shows the still slide.
        <p className="powerpoint-status" aria-live="polite">
          <Presentation size={13} aria-hidden="true" /> PowerPoint · {powerPointText(powerPointStatus)}
        </p>
      )}
      {powerPointStatus.phase === 'failed' && powerPointStatus.message && powerPointStatus.failures !== dismissedFailure && (
        <p className="powerpoint-failure" role="alert">
          <AlertTriangle size={13} aria-hidden="true" />
          <span>{powerPointStatus.message}</span>
          <IconButton size="sm" label="Dismiss" icon={<X size={14} />} onClick={() => setDismissedFailure(powerPointStatus.failures)} />
        </p>
      )}
      {live.stale &&
        (live.itemType === 'presentation' ? (
          // The original was saved again; the output keeps the older slides until resent (see Auto refresh live).
          <span className="stale-chip" title="The presentation was saved again after it went live">
            <RefreshCw size={13} aria-hidden="true" /> Updated
            <Button size="sm" variant="ghost" className="stale-chip-action" onClick={resend}>
              Resend
            </Button>
          </span>
        ) : (
          <Button size="sm" className="stale-chip" onClick={resend} title="The live item was edited after it went live" icon={<RefreshCw size={13} aria-hidden="true" />}>
            Live version is older, resend
          </Button>
        ))}
      <TranslationBar where="live" part="note" />
      <ErrorNote error={error} />
    </>
  )

  return (
    <Panel
      className="monitor-card live-card"
      title="Live"
      meta={<OnAirChip />}
      actions={
        <>
          {lowerThird && (
            <HeaderPopover
              label="Lower third"
              text="Lower third"
              tooltip={`The lower third: its text, style, Show and Hide (${MOD}L)`}
              icon={<PanelBottom size={15} aria-hidden="true" />}
              open={lowerThirdOpen}
              onOpenChange={setLowerThirdOpen}
              active={lowerThirdLive}
              className="lower-third-popover"
            >
              <LowerThirdPanel />
            </HeaderPopover>
          )}
          <HeaderPopover label="Live tools" tooltip="Highlighting, crossfade, translations, Go Back" icon={<SlidersHorizontal size={16} />} open={toolsOpen} onOpenChange={setToolsOpen} className="live-tools-popover">
            <HighlightBar where="live" />
            <label className="fade-control">
              <span>Crossfade</span>
              <input type="range" min={0} max={1500} step={100} value={fadeMs} onChange={(e) => setFadeMs(Number(e.target.value)).catch(console.error)} />
              <span className="fade-value">{(fadeMs / 1000).toFixed(1)} s</span>
            </label>
            <TranslationBar where="live" part="chips" />
            <div className="live-tools-row">
              <Select
                size="sm"
                aria-label="Output shown here"
                title={previewOutput ? 'Stop drawing the output here' : 'Show what the output shows'}
                value={previewOutput ? 'output' : 'off'}
                onChange={(e) => updateSettings({ previewOutput: e.target.value === 'output' }).catch(console.error)}
              >
                {SCREEN_CHOICES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
              <Button size="sm" icon={<Undo2 size={15} aria-hidden="true" />} title="Go Back: put the previous live slide back on screen" disabled={!canGoBack} onClick={goBack}>
                Go Back
              </Button>
            </div>
          </HeaderPopover>
        </>
      }
    >
      <MonitorStage where="live" notes={notes}>
        {output ? (
          <OutputScreen state={output} />
        ) : (
          <p className="screen-off">
            <EyeOff size={18} aria-hidden="true" /> The preview is off. Choose Main output in Live tools to draw it here.
          </p>
        )}
        <LivePosition />
      </MonitorStage>
      <Transport />
    </Panel>
  )
}

/** "Verse 2 of 3" in the corner of the live screen, with the output mode when it is not showing. */
function LivePosition() {
  const live = useOperatorStore((s) => s.live)
  if (live.slideIndex === null) return null
  const unit = live.itemType === 'scripture' ? 'Verse' : 'Slide'
  return (
    <span className="screen-badge" title={live.title ?? undefined}>
      {unit} {live.slideIndex + 1} of {live.slides.length}
      {live.mode !== 'show' && ` · ${live.mode.toUpperCase()}`}
    </span>
  )
}

/** Previous and Next for the live item, the same as the Left and Right keys. */
function Transport() {
  const nothingLive = useOperatorStore((s) => s.live.slideIndex === null)
  const scripture = useOperatorStore((s) => s.live.itemType === 'scripture')
  const previousSlide = useOperatorStore((s) => s.previousSlide)
  const nextSlide = useOperatorStore((s) => s.nextSlide)
  return (
    <div className="transport" role="group" aria-label="Live slide">
      <Button className="transport-previous" disabled={nothingLive} icon={<ChevronLeft size={15} aria-hidden="true" />} title="Previous (←)" onClick={previousSlide} aria-keyshortcuts="ArrowLeft">
        Prev
      </Button>
      <Button
        className="transport-next"
        disabled={nothingLive}
        iconEnd={<ChevronRight size={15} aria-hidden="true" />}
        title={`Next${scripture ? ' verse' : ''} (→)`}
        onClick={nextSlide}
        aria-keyshortcuts="ArrowRight"
      >
        Next
      </Button>
    </div>
  )
}

/** "Sermon, then Offering": the next items in the Order of service after the live one. */
export function UpNextMeta() {
  const next = useOperatorStore((s) => {
    const items = s.service?.items ?? []
    const at = items.findIndex((item) => item.id === s.live.scheduleItemId)
    return at === -1 ? '' : items.slice(at + 1, at + 3).map((item) => item.title).join(', then ')
  })
  return next ? <span className="up-next-meta">Up next: {next}</span> : null
}

/** "John 3:17" from a verse caption ("John 3:17 KJV"); a song's section label, or the slide's number. */
function slideName(slide: DeckSlide, index: number): string {
  const verse = slide.caption ? parseVerseCaption(slide.caption) : null
  if (verse) return `${verse.book} ${verse.chapter}:${verse.verse}`
  return slide.label || slide.caption || `Slide ${index + 1}`
}

/** The slides after the live one, one line each: what Next brings on screen. */
function WaitingList() {
  const live = useOperatorStore((s) => s.live)
  const start = live.slideIndex === null ? null : live.slideIndex + 1
  const waiting = start === null ? [] : live.slides.slice(start)
  if (waiting.length === 0) return <p className="queue-note">{start === null ? 'Nothing is live yet.' : 'This is the last slide of the item.'}</p>
  return (
    <ol className="queue-list" aria-label="Waiting to go live">
      {waiting.map((slide, i) => {
        const text = slide.page ? slide.pageText?.split('\n')[0] || 'Presentation page' : slideLines(slide.text).map((line) => line.text).join(' ')
        return (
          <li key={start! + i} className="queue-row" title={text}>
            <span className="queue-ref">{slideName(slide, start! + i)}</span>
            <span className="queue-text">{text}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** The item's slides as small thumbnails, two to a row: click previews one, double-click sends it live. */
function SlideThumbs() {
  const slides = useOperatorStore((s) => s.slides)
  const song = useOperatorStore((s) => s.selectedSong)
  const highlightIndex = useOperatorStore((s) => s.highlightIndex)
  const theme = useOperatorStore(selectDeckTheme)
  const liveIndexHere = useOperatorStore((s) => (selectBrowsingLive(s) ? s.live.slideIndex : null))
  const setHighlight = useOperatorStore((s) => s.setHighlight)
  const goLive = useOperatorStore((s) => s.goLive)
  const slideThemes = useMemo(() => slides.map((slide) => slideTheme(theme, slide)), [slides, theme])
  const listRef = useRef<HTMLDivElement>(null)

  // Keep the preview highlight and the live slide in view as the keys move them. Only the list scrolls: scrollIntoView
  // would also scroll the card (and the column) that clip it.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    for (const index of [highlightIndex, liveIndexHere]) {
      const thumb = index === null ? null : list.querySelector<HTMLElement>(`[data-index="${index}"]`)
      if (!thumb) continue
      // The list is positioned, so offsetTop is from its top.
      const top = thumb.offsetTop
      if (top < list.scrollTop) list.scrollTop = top
      else if (top + thumb.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + thumb.offsetHeight - list.clientHeight
    }
  }, [highlightIndex, liveIndexHere])

  if (slides.length === 0) return <p className="queue-note">{song ? 'This song has no lyrics.' : 'This item has no slides.'}</p>
  return (
    <div className="queue-thumbs" ref={listRef}>
      {slides.map((slide, index) => (
        <button
          key={index}
          type="button"
          data-index={index}
          className={`slide-card queue-thumb${index === liveIndexHere ? ' live' : ''}${index === highlightIndex ? ' preview' : ''}`}
          aria-label={`Slide ${index + 1}${slide.label ? `, ${slide.label}` : ''}${index === liveIndexHere ? ', live' : ''}${index === highlightIndex ? ', in preview' : ''}`}
          title="Click to preview, double-click to go live"
          onClick={() => setHighlight(index)}
          onDoubleClick={() => goLive(index)}
        >
          <ThemedSlide theme={slideThemes[index]} text={slide.text} caption={slide.caption} rich={slide.rich} still />
          <span className="slide-number">{index + 1}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * The card under Live. With a song or presentation in the grid it is Slides: the item's slides as thumbnails. Otherwise
 * it is Queue: the slides of the live item still to come. Its grid button opens every slide, full size, over the finder.
 */
export function QueueCard({ gridOpen, onGridOpenChange }: { gridOpen: boolean; onGridOpenChange(open: boolean): void }) {
  const slidesMode = useOperatorStore((s) => s.deckType === 'song' || s.deckType === 'presentation')
  const slideCount = useOperatorStore((s) => s.slides.length)
  const waiting = useOperatorStore((s) => (s.live.slideIndex === null ? 0 : s.live.slides.length - s.live.slideIndex - 1))
  return (
    <Panel
      className={`queue-card${slidesMode ? ' queue-card--slides' : ''}`}
      title={slidesMode ? 'Slides' : 'Queue'}
      meta={<span className="monitor-meta">{slidesMode ? `${slideCount} slide${slideCount === 1 ? '' : 's'}` : `${waiting} waiting`}</span>}
      actions={
        <IconButton
          size="sm"
          label="All slides"
          tooltip="Every slide of the item, full size, over the finder"
          icon={<LayoutGrid size={16} />}
          aria-expanded={gridOpen}
          aria-controls="slides-drawer"
          pressed={gridOpen}
          onClick={() => onGridOpenChange(!gridOpen)}
        />
      }
    >
      {slidesMode ? <SlideThumbs /> : <WaitingList />}
    </Panel>
  )
}

import {
  AlertTriangle,
  Baseline,
  Bold,
  Columns2,
  Eraser,
  Eye,
  EyeOff,
  Highlighter,
  MousePointerClick,
  Presentation,
  RefreshCw,
  Underline,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { HIGHLIGHT_COLORS, HIGHLIGHT_KINDS, isMarked, sentenceAt, slideRich, wordAt, wordsBetween } from '../../shared/highlights'
import { comparePos, type RichPos } from '../../shared/richText'
import type { DualTranslation, HighlightKind, LivePowerPointStatus, OutputState } from '../../shared/types'
import { reportError, type ErrorLike } from '../lib/errors'
import { pickHighlightColor } from '../lib/highlights'
import { MOD } from '../lib/shortcuts'
import { slideTranslation } from '../lib/translations'
import {
  selectDeckTheme,
  selectLiveSlide,
  selectMarkTarget,
  selectOutputState,
  selectPreviewSlide,
  slideTheme,
  useOperatorStore,
  type TranslationTarget,
} from '../store'
import { OutputScreen } from './OutputView'
import { ScriptureQuickAdjust } from './ScriptureDisplay'
import { ThemedSlide } from './ThemedSlide'
import { ErrorNote } from './ui'

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
 * second translation on the slide too. Notes (a missing verse, cleared highlights) show here as well.
 */
function TranslationBar({ where }: { where: TranslationTarget }) {
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
      <button type="button" className="icon-button" aria-label="Dismiss" onClick={dismissNote}>
        <X size={12} aria-hidden="true" />
      </button>
    </p>
  )
  if (!current || versions.length === 0) return noteLine || null

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
      {noteLine}
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

/**
 * LIVE shows the live snapshot, exactly what the projector shows. PREVIEW shows the highlighted slide of the item
 * in the grid, with its theme; Enter or Go Live sends it.
 */
export function LivePreview() {
  const live = useOperatorStore((s) => s.live)
  const previewSlide = useOperatorStore(selectPreviewSlide)
  const deckTheme = useOperatorStore(selectDeckTheme)
  const previewTheme = useMemo(() => slideTheme(deckTheme, previewSlide), [deckTheme, previewSlide])
  const deckTitle = useOperatorStore((s) => s.deckTitle)
  const highlightIndex = useOperatorStore((s) => s.highlightIndex)
  const slideCount = useOperatorStore((s) => s.slides.length)
  const fadeMs = useOperatorStore((s) => s.settings.fadeMs)
  const logoUrl = useOperatorStore((s) => s.settings.logoUrl)
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
  const liveMarking = useWordMarking('live')
  const previewMarking = useWordMarking('preview')
  const [dismissedFailure, setDismissedFailure] = useState(0)
  const [error, setError] = useState<ErrorLike | null>(null)

  async function resend() {
    try {
      await resendLive()
      setError(null)
    } catch (err) {
      setError(reportError('Live and Preview', err))
    }
  }

  return (
    <section className="panel preview-panel">
      <header className="panel-header">
        <h2>Live</h2>
        <button
          type="button"
          className={`button preview-output-toggle${previewOutput ? ' active' : ''}`}
          aria-pressed={previewOutput}
          onClick={() => updateSettings({ previewOutput: !previewOutput }).catch(console.error)}
          title={previewOutput ? 'Stop drawing the output here' : 'Show what the output shows'}
        >
          {previewOutput ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />} Preview Output
        </button>
        <button type="button" className="button go-back-button" disabled={!canGoBack} onClick={goBack} title="Put the previous live slide back on screen">
          <Undo2 size={14} aria-hidden="true" /> Go Back
        </button>
      </header>
      <HighlightBar where="live" />
      <div className={`preview-screen live${liveMarking.marking ? ' marking' : ''}`} {...liveMarking.handlers}>
        {output ? <OutputScreen state={output} /> : <p className="empty">Preview Output is off</p>}
        <SlideBadge index={live.slideIndex} count={live.slides.length} />
      </div>
      <p className="screen-label">
        {(live.slideIndex !== null && live.title) || 'Nothing live'}
        {live.mode !== 'show' && <span className="screen-mode"> · {live.mode.toUpperCase()}</span>}
      </p>
      <TranslationBar where="live" />
      {powerPoint && (
        // The output shows PowerPoint's own slide show; the screen above shows the still slide.
        <p className="powerpoint-status" aria-live="polite">
          <Presentation size={13} aria-hidden="true" /> PowerPoint · {powerPointText(powerPointStatus)}
        </p>
      )}
      {powerPointStatus.phase === 'failed' && powerPointStatus.message && powerPointStatus.failures !== dismissedFailure && (
        <p className="powerpoint-failure" role="alert">
          <AlertTriangle size={13} aria-hidden="true" />
          <span>{powerPointStatus.message}</span>
          <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setDismissedFailure(powerPointStatus.failures)}>
            <X size={12} aria-hidden="true" />
          </button>
        </p>
      )}
      {live.stale &&
        (live.itemType === 'presentation' ? (
          // The original was saved again; the output keeps the older slides until resent (see Auto refresh live).
          <span className="stale-chip" title="The presentation was saved again after it went live">
            <RefreshCw size={13} aria-hidden="true" /> Updated
            <button type="button" className="stale-chip-action" onClick={resend}>
              Resend
            </button>
          </span>
        ) : (
          <button type="button" className="stale-chip" onClick={resend} title="The live item was edited after it went live">
            <RefreshCw size={13} aria-hidden="true" /> Live version is older, resend
          </button>
        ))}
      <ErrorNote error={error} />

      <label className="fade-control">
        <span>Crossfade</span>
        <input
          type="range"
          min={0}
          max={1500}
          step={100}
          value={fadeMs}
          onChange={(e) => setFadeMs(Number(e.target.value)).catch(console.error)}
        />
        <span className="fade-value">{(fadeMs / 1000).toFixed(1)} s</span>
      </label>

      <h2 className="preview-subheading">Preview</h2>
      <HighlightBar where="preview" />
      <div className={`preview-screen preview${previewMarking.marking ? ' marking' : ''}`} {...previewMarking.handlers}>
        {previewSlide ? (
          <ThemedSlide
            theme={previewTheme}
            text={previewSlide.text}
            caption={previewSlide.caption}
            copyright={previewSlide.copyright}
            rich={previewSlide.rich}
            logoUrl={logoUrl}
          />
        ) : (
          <p className="empty">Select something to preview</p>
        )}
        <SlideBadge index={previewSlide ? highlightIndex : null} count={slideCount} />
      </div>
      <p className="screen-label">{(highlightIndex !== null && deckTitle) || 'Nothing selected'}</p>
      <TranslationBar where="preview" />
    </section>
  )
}

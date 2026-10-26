import {
  Cast,
  Check,
  ChevronDown,
  Eraser,
  EyeOff,
  Image,
  Layers,
  Megaphone,
  Monitor,
  MonitorPlay,
  Palette,
  ScanLine,
  Search,
  Settings,
  Square,
  Tv,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { OutputMode } from '../../shared/types'
import { MOD, MODE_KEYS } from '../lib/shortcuts'
import { selectStreamState, useOperatorStore } from '../store'
import { AlertsPanel } from './AlertsPanel'
import { LayoutMenu } from './LayoutMenu'
import { SharingBar } from './SharingBar'

const MODE_ICONS: Record<OutputMode, LucideIcon> = { show: Monitor, black: Square, clear: Eraser, logo: Image }

/** The Live menu's output modes. Each one toggles: choosing the mode already on screen goes back to Show. */
const LIVE_MENU_MODES: { mode: OutputMode; label: string; key: string }[] = [
  { mode: 'logo', label: 'Logo', key: 'L' },
  { mode: 'black', label: 'Black', key: 'B' },
  { mode: 'clear', label: 'Clear Text', key: 'C' },
]

/** Closes a popup on Escape or on a click outside `ref`. */
function useDismiss(open: boolean, ref: RefObject<HTMLElement>, close: () => void) {
  useEffect(() => {
    if (!open) return
    const onEvent = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) close()
    }
    window.addEventListener('mousedown', onEvent)
    window.addEventListener('keydown', onEvent)
    return () => {
      window.removeEventListener('mousedown', onEvent)
      window.removeEventListener('keydown', onEvent)
    }
  }, [open, ref, close])
}

/** The Alerts button, beside the output modes, and its panel. */
function AlertsButton() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const showing = useOperatorStore((s) => s.live.alert !== null)
  useDismiss(open, ref, () => setOpen(false))

  return (
    <div className="alerts-control" ref={ref}>
      <button
        type="button"
        className={`mode-button mode-alert${showing ? ' active' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={showing ? 'Alerts (the ticker is running)' : 'Alerts'}
        onClick={() => setOpen(!open)}
      >
        <Megaphone size={18} aria-hidden="true" />
        <span>Alerts</span>
      </button>
      {open && <AlertsPanel />}
    </div>
  )
}

/** Shown while the alert ticker runs, whatever the operator is doing, with a one-click Stop. */
function AlertRunningChip() {
  const running = useOperatorStore((s) => s.live.alert !== null)
  const hidden = useOperatorStore((s) => s.live.alert?.hidden === true)
  const stopAlerts = useOperatorStore((s) => s.stopAlerts)
  if (!running) return null
  return (
    <span className="alert-chip" role="status">
      <span className="live-dot" aria-hidden="true" />
      Alert running{hidden ? ' (hidden)' : ''}
      <button type="button" className="alert-chip-stop" onClick={stopAlerts} title="Stop the alert ticker">
        <Square size={11} aria-hidden="true" /> Stop
      </button>
    </span>
  )
}

/** Shown while a lower third is up on the Stream output, with a one-click Hide. */
function LowerThirdChip() {
  const live = useOperatorStore((s) => s.live.lowerThird !== null)
  // Up, but held back while the stream is black or a full screen slide covers it.
  const held = useOperatorStore((s) => {
    if (s.live.lowerThird === null) return null
    const stream = selectStreamState(s)
    return stream.overlays.lowerThird !== null ? null : stream.mode === 'black' ? 'stream is black' : 'behind slide'
  })
  const hide = useOperatorStore((s) => s.hideLowerThird)
  if (!live) return null
  return (
    <span className="alert-chip" role="status">
      <span className="live-dot" aria-hidden="true" />
      Lower third live{held ? ` (${held})` : ''}
      <button type="button" className="alert-chip-stop" onClick={hide} title="Hide the lower third">
        <EyeOff size={11} aria-hidden="true" /> Hide
      </button>
    </span>
  )
}

/** The Live menu: Go Back, the screen modes, whether the projector and Stream windows are open, and the Stream's layers. */
function LiveMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const mode = useOperatorStore((s) => s.live.mode)
  const canGoBack = useOperatorStore((s) => s.liveHistory.length > 0)
  const outputOpen = useOperatorStore((s) => s.outputOpen)
  const setOutputMode = useOperatorStore((s) => s.setOutputMode)
  const goBack = useOperatorStore((s) => s.goBack)
  const toggleOutput = useOperatorStore((s) => s.toggleOutput)
  const streamOpen = useOperatorStore((s) => s.streamOpen)
  const toggleStream = useOperatorStore((s) => s.toggleStream)
  const logoLayerVisible = useOperatorStore((s) => s.settings.logoLayerVisible)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const testPattern = useOperatorStore((s) => s.streamTestPattern)
  const setTestPattern = useOperatorStore((s) => s.setStreamTestPattern)

  useDismiss(open, ref, () => setOpen(false))

  const choose = (action: () => void) => () => {
    action()
    setOpen(false)
  }

  return (
    <div className="live-menu" ref={ref}>
      <button type="button" className="button live-menu-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        Live <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="live-menu-list" role="menu" aria-label="Live">
          <button type="button" role="menuitem" disabled={!canGoBack} onClick={choose(goBack)}>
            <Undo2 size={15} aria-hidden="true" />
            <span>Go Back</span>
          </button>
          <hr />
          {LIVE_MENU_MODES.map(({ mode: m, label, key }) => {
            const Icon = MODE_ICONS[m]
            return (
              <button
                key={m}
                type="button"
                role="menuitemcheckbox"
                aria-checked={mode === m}
                onClick={choose(() => setOutputMode(mode === m ? 'show' : m))}
              >
                <Icon size={15} aria-hidden="true" />
                <span>{label}</span>
                {mode === m && <Check size={14} aria-hidden="true" />}
                <kbd>{key}</kbd>
              </button>
            )
          })}
          <hr />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={outputOpen}
            onClick={choose(() => toggleOutput().catch(console.error))}
          >
            <Tv size={15} aria-hidden="true" />
            <span>Show Live Output</span>
            {outputOpen && <Check size={14} aria-hidden="true" />}
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={streamOpen}
            onClick={choose(() => toggleStream().catch(console.error))}
          >
            <Cast size={15} aria-hidden="true" />
            <span>Show Stream Output</span>
            {streamOpen && <Check size={14} aria-hidden="true" />}
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={logoLayerVisible}
            onClick={choose(() => updateSettings({ logoLayerVisible: !logoLayerVisible }).catch(console.error))}
          >
            <Layers size={15} aria-hidden="true" />
            <span>Logo Layer</span>
            {logoLayerVisible && <Check size={14} aria-hidden="true" />}
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={testPattern} onClick={choose(() => setTestPattern(!testPattern))}>
            <ScanLine size={15} aria-hidden="true" />
            <span>Stream Test Pattern</span>
            {testPattern && <Check size={14} aria-hidden="true" />}
          </button>
        </div>
      )}
    </div>
  )
}

/** Top bar: the service, what the audience sees right now, the output mode buttons and app-wide actions. */
export function Toolbar() {
  const service = useOperatorStore((s) => s.service)
  // Everything here is about the projector, so it reads the live snapshot, not the grid.
  const mode = useOperatorStore((s) => s.live.mode)
  const onAir = useOperatorStore((s) => s.live.mode === 'show' && s.live.slideIndex !== null)
  const liveTitle = useOperatorStore((s) => s.live.title)
  const setOutputMode = useOperatorStore((s) => s.setOutputMode)
  const setPaletteOpen = useOperatorStore((s) => s.setPaletteOpen)
  const themeEditorOpen = useOperatorStore((s) => s.themeEditorOpen)
  const settingsOpen = useOperatorStore((s) => s.settingsOpen)
  const openThemeEditor = useOperatorStore((s) => s.openThemeEditor)
  const openSettings = useOperatorStore((s) => s.openSettings)
  const stageOpen = useOperatorStore((s) => s.stageOpen)
  const toggleStage = useOperatorStore((s) => s.toggleStage)
  const streamPanelOpen = useOperatorStore((s) => s.streamPanelOpen)
  const openStreamPanel = useOperatorStore((s) => s.openStreamPanel)
  const streamOpen = useOperatorStore((s) => s.streamOpen)

  const status = onAir ? 'live' : mode === 'show' ? 'ready' : mode

  return (
    <header className="toolbar">
      <div className="toolbar-service">
        <span className="toolbar-service-name">{service ? service.name : 'No service open'}</span>
        {service?.date && <span className="toolbar-service-date">{service.date}</span>}
      </div>

      <div className={`live-indicator ${status}`} role="status" aria-live="polite">
        <span className="live-dot" aria-hidden="true" />
        <span className="live-label">{status.toUpperCase()}</span>
        {liveTitle && <span className="live-title">{liveTitle}</span>}
      </div>

      <AlertRunningChip />
      <LowerThirdChip />

      <LiveMenu />

      <div className="mode-buttons" role="group" aria-label="Output">
        {MODE_KEYS.map(({ mode: m, key, label }) => {
          const Icon = MODE_ICONS[m]
          return (
            <button
              key={m}
              className={`mode-button mode-${m}${mode === m ? ' active' : ''}`}
              aria-pressed={mode === m}
              title={`${label} (${key})`}
              onClick={() => setOutputMode(m)}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
              <kbd>{key}</kbd>
            </button>
          )
        })}
        <AlertsButton />
      </div>

      <SharingBar />

      <div className="toolbar-actions">
        <LayoutMenu />
        <button className="toolbar-search" onClick={() => setPaletteOpen(true)} title={`Search songs, verses and actions (${MOD}K)`}>
          <Search size={15} aria-hidden="true" />
          <span>Search</span>
          <kbd>{MOD}K</kbd>
        </button>
        <button
          className={`icon-button toolbar-icon${stageOpen ? ' active' : ''}`}
          aria-pressed={stageOpen}
          aria-label="Stage display"
          title={stageOpen ? 'Close the stage display' : 'Open the stage display for the worship leader'}
          onClick={() => toggleStage().catch(console.error)}
        >
          <MonitorPlay size={18} />
        </button>
        <button
          className={`icon-button toolbar-icon${streamPanelOpen ? ' active' : ''}`}
          aria-pressed={streamPanelOpen}
          aria-label="Stream"
          title={streamOpen ? 'Stream output, logos and key (the Stream output is open)' : 'Stream output, logos and key'}
          onClick={() => openStreamPanel(!streamPanelOpen)}
        >
          <Cast size={18} />
          {streamOpen && <span className="toolbar-icon-dot" aria-hidden="true" />}
        </button>
        <button
          className={`icon-button toolbar-icon${themeEditorOpen ? ' active' : ''}`}
          aria-pressed={themeEditorOpen}
          aria-label="Themes"
          title="Themes"
          onClick={() => openThemeEditor(!themeEditorOpen)}
        >
          <Palette size={18} />
        </button>
        <button
          className={`icon-button toolbar-icon${settingsOpen ? ' active' : ''}`}
          aria-pressed={settingsOpen}
          aria-label="Settings"
          title="Settings"
          onClick={() => openSettings(!settingsOpen)}
        >
          <Settings size={18} />
        </button>
      </div>
    </header>
  )
}

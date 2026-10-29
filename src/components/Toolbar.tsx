import {
  BookOpenText,
  Cast,
  Check,
  ChevronDown,
  Ellipsis,
  Eraser,
  EyeOff,
  Image,
  Layers,
  LayoutPanelLeft,
  Megaphone,
  Monitor,
  MonitorPlay,
  Palette,
  ScanLine,
  Search,
  Settings,
  Settings2,
  Square,
  Tv,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { can, hasFeature, upgradeNote } from '../../shared/features'
import { layoutById } from '../../shared/layouts'
import type { OutputMode } from '../../shared/types'
import { switchLayout } from '../lib/layouts'
import { IS_MAC, MOD, MODE_KEYS } from '../lib/shortcuts'
import { useDismiss } from '../lib/useDismiss'
import { selectStreamState, useOperatorStore } from '../store'
import { AlertsPanel } from './AlertsPanel'
import { StatusArea } from './StatusArea'
import { Button, IconButton } from './ui'

const MODE_ICONS: Record<OutputMode, LucideIcon> = { show: Monitor, black: Square, clear: Eraser, logo: Image }

/** The Live menu's output modes. Each one toggles: choosing the mode already on screen goes back to Show. */
const LIVE_MENU_MODES: { mode: OutputMode; label: string; key: string }[] = [
  { mode: 'logo', label: 'Logo', key: 'L' },
  { mode: 'black', label: 'Black', key: 'B' },
  { mode: 'clear', label: 'Clear Text', key: 'C' },
]

/** The Alerts button, beside the output modes, and its panel. */
function AlertsButton() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const showing = useOperatorStore((s) => s.live.alert !== null)
  useDismiss(open, ref, useCallback(() => setOpen(false), []))
  const inPlan = can('alerts')

  return (
    // Disabled buttons show no tooltip, so the plan's note sits on the wrapper.
    <div className="alerts-control" ref={ref} title={inPlan ? undefined : upgradeNote('alerts')}>
      <Button
        size="lg"
        className={`mode-button mode-alert${showing ? ' active' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!inPlan}
        title={!inPlan ? undefined : showing ? 'Alerts (the ticker is running)' : 'Alerts'}
        icon={<Megaphone size={18} aria-hidden="true" />}
        onClick={() => setOpen(!open)}
      >
        <span>Alerts</span>
      </Button>
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
      <button type="button" className="alert-chip-stop ui-hit" onClick={stopAlerts} title="Stop the alert ticker">
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
      <button type="button" className="alert-chip-stop ui-hit" onClick={hide} title="Hide the lower third">
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

  useDismiss(open, ref, useCallback(() => setOpen(false), []))

  const choose = (action: () => void) => () => {
    action()
    setOpen(false)
  }

  return (
    <div className="live-menu" ref={ref}>
      <Button aria-haspopup="menu" aria-expanded={open} iconEnd={<ChevronDown size={14} aria-hidden="true" />} onClick={() => setOpen(!open)}>
        Live
      </Button>
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
            disabled={!streamOpen && !can('multiOutput')}
            title={can('multiOutput') ? undefined : upgradeNote('multiOutput')}
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

/** The More menu's items; `onChoose` closes the menu. */
export function MoreMenuList({ onChoose }: { onChoose(): void }) {
  const layouts = useOperatorStore((s) => s.settings.layouts)
  const activeLayout = useOperatorStore((s) => layoutById(s.settings.layouts, s.settings.activeLayoutId))
  const themeEditorOpen = useOperatorStore((s) => s.themeEditorOpen)
  const openThemeEditor = useOperatorStore((s) => s.openThemeEditor)
  const stageOpen = useOperatorStore((s) => s.stageOpen)
  const toggleStage = useOperatorStore((s) => s.toggleStage)
  const streamPanelOpen = useOperatorStore((s) => s.streamPanelOpen)
  const openStreamPanel = useOperatorStore((s) => s.openStreamPanel)
  const streamOpen = useOperatorStore((s) => s.streamOpen)
  const sermonsOpen = useOperatorStore((s) => s.sermonsOpen)
  const openSermons = useOperatorStore((s) => s.openSermons)

  const choose = (action: () => void) => () => {
    action()
    onChoose()
  }

  return (
    <div className="live-menu-list" role="menu" aria-label="More">
      {hasFeature('sharing.layouts') && (
        <>
          <div className="menu-heading" title={`Which panels this computer shows (${MOD}⌥1 to 9, ${MOD}⇧L for the next)`}>
            <LayoutPanelLeft size={13} aria-hidden="true" /> Layout
          </div>
          {layouts.map((layout, index) => (
            <button
              key={layout.id}
              type="button"
              role="menuitemradio"
              aria-checked={layout.id === activeLayout.id}
              onClick={choose(() => switchLayout(layout.id).catch(console.error))}
            >
              <Check size={14} aria-hidden="true" style={{ visibility: layout.id === activeLayout.id ? 'visible' : 'hidden' }} />
              <span>{layout.name}</span>
              {index < 9 && (
                <kbd>
                  {MOD}⌥{index + 1}
                </kbd>
              )}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={choose(() => {
              useOperatorStore.getState().openSettings(true)
              // Settings scrolls to its Layouts section once it has rendered.
              requestAnimationFrame(() => document.getElementById('settings-layouts')?.scrollIntoView({ block: 'start' }))
            })}
          >
            <Settings2 size={14} aria-hidden="true" />
            <span>Edit layouts…</span>
          </button>
          <hr />
        </>
      )}
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={stageOpen}
        disabled={!stageOpen && !can('stageDisplay')}
        title={can('stageDisplay') ? 'The stage display for the worship leader' : upgradeNote('stageDisplay')}
        onClick={choose(() => toggleStage().catch(console.error))}
      >
        <MonitorPlay size={15} aria-hidden="true" />
        <span>Stage Display</span>
        {stageOpen && <Check size={14} aria-hidden="true" />}
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={streamPanelOpen}
        disabled={!streamPanelOpen && !can('multiOutput')}
        title={can('multiOutput') ? (streamOpen ? 'Stream output, logos and key (the Stream output is open)' : 'Stream output, logos and key') : upgradeNote('multiOutput')}
        onClick={choose(() => openStreamPanel(!streamPanelOpen))}
      >
        <Cast size={15} aria-hidden="true" />
        <span>Stream</span>
        {streamPanelOpen && <Check size={14} aria-hidden="true" />}
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={sermonsOpen}
        title="Sermons: saved listening sessions, their transcripts and exports"
        onClick={choose(() => openSermons(!sermonsOpen))}
      >
        <BookOpenText size={15} aria-hidden="true" />
        <span>Sermons</span>
        {sermonsOpen && <Check size={14} aria-hidden="true" />}
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={themeEditorOpen}
        disabled={!can('themes.editor')}
        title={can('themes.editor') ? undefined : upgradeNote('themes.editor')}
        onClick={choose(() => openThemeEditor(!themeEditorOpen))}
      >
        <Palette size={15} aria-hidden="true" />
        <span>Themes</span>
        {themeEditorOpen && <Check size={14} aria-hidden="true" />}
      </button>
    </div>
  )
}

/**
 * The toolbar's More menu: the layout, and the screens used less often during a service (stage display, Stream,
 * Sermons, Themes). It keeps the toolbar to one row on a 1280 pixel wide laptop.
 */
function MoreMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const activeLayout = useOperatorStore((s) => layoutById(s.settings.layouts, s.settings.activeLayoutId))
  const themeEditorOpen = useOperatorStore((s) => s.themeEditorOpen)
  const stageOpen = useOperatorStore((s) => s.stageOpen)
  const streamPanelOpen = useOperatorStore((s) => s.streamPanelOpen)
  const streamOpen = useOperatorStore((s) => s.streamOpen)
  const sermonsOpen = useOperatorStore((s) => s.sermonsOpen)

  useDismiss(open, ref, useCallback(() => setOpen(false), []))

  // Pressed while a screen it opens is showing, so the operator can tell where it came from.
  const showing = themeEditorOpen || streamPanelOpen || sermonsOpen

  return (
    <div className="live-menu more-menu" ref={ref}>
      <IconButton
        className="toolbar-icon"
        label="More"
        tooltip={`More: layout (${activeLayout.name}), stage display, Stream, Sermons and Themes`}
        icon={<Ellipsis size={18} />}
        pressed={showing}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {(stageOpen || streamOpen) && <span className="toolbar-icon-dot" aria-hidden="true" />}
      </IconButton>
      {open && <MoreMenuList onChoose={() => setOpen(false)} />}
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
  const settingsOpen = useOperatorStore((s) => s.settingsOpen)
  const openSettings = useOperatorStore((s) => s.openSettings)

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
            <Button
              key={m}
              size="lg"
              className={`mode-button mode-${m}${mode === m ? ' active' : ''}`}
              pressed={mode === m}
              title={`${label} (${key})`}
              icon={<Icon size={18} aria-hidden="true" />}
              onClick={() => setOutputMode(m)}
            >
              <span>{label}</span>
              <kbd>{key}</kbd>
            </Button>
          )
        })}
        <AlertsButton />
      </div>

      {/* One row at 1280 pixels: the screens used less often are in More; Settings is always last and in view. */}
      <div className="toolbar-actions">
        <StatusArea />
        <Button
          className="toolbar-search"
          title={`Search songs, verses and actions (${MOD}K)`}
          aria-label="Search"
          icon={<Search size={15} aria-hidden="true" />}
          onClick={() => setPaletteOpen(true)}
        >
          <span className="toolbar-search-label">Search</span>
          <kbd>{MOD}K</kbd>
        </Button>
        <MoreMenu />
        <IconButton
          className="toolbar-icon toolbar-settings"
          label="Settings"
          tooltip={`Settings (${MOD},)`}
          icon={<Settings size={18} />}
          pressed={settingsOpen}
          aria-keyshortcuts={IS_MAC ? 'Meta+,' : 'Control+,'}
          onClick={() => openSettings(!settingsOpen)}
        />
      </div>
    </header>
  )
}

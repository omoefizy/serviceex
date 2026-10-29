import {
  BookOpenText,
  Cast,
  Check,
  CircleHelp,
  Ellipsis,
  EyeOff,
  Image,
  Layers,
  LayoutPanelLeft,
  Megaphone,
  MonitorPlay,
  Palette,
  Plug,
  ScanLine,
  Search,
  Settings,
  Settings2,
  Square,
  Tv,
  Undo2,
  Wifi,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { formatHours } from '../../shared/account'
import { can, hasFeature, upgradeNote } from '../../shared/features'
import { layoutById } from '../../shared/layouts'
import type { OutputMode } from '../../shared/types'
import { useAccount } from '../lib/account'
import { switchLayout } from '../lib/layouts'
import { useListener } from '../lib/listener'
import { chipOf } from '../lib/listenerStatus'
import { openSettingsAt, showServicePicker, toggleTranscriptDrawer } from '../lib/shell'
import { IS_MAC, MOD } from '../lib/shortcuts'
import { useDismiss } from '../lib/useDismiss'
import { selectStreamState, useOperatorStore } from '../store'
import { AlertsPanel } from './AlertsPanel'
import { IconButton, StatusDot, type StatusTone } from './ui'

/** The output group at the right of the top bar, as the B, C and S keys. ON AIR is Show. */
const OUTPUT_MODES: { mode: OutputMode; label: string; key: string }[] = [
  { mode: 'black', label: 'Black', key: 'B' },
  { mode: 'clear', label: 'Clear', key: 'C' },
  { mode: 'show', label: 'On air', key: 'S' },
]

/** The Alerts icon button and its panel. */
function AlertsButton() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const showing = useOperatorStore((s) => s.live.alert !== null)
  useDismiss(open, ref, useCallback(() => setOpen(false), []))
  const inPlan = can('alerts')

  return (
    // Disabled buttons show no tooltip, so the plan's note sits on the wrapper.
    <div className="alerts-control" ref={ref} title={inPlan ? undefined : upgradeNote('alerts')}>
      <IconButton
        size="lg"
        className={`toolbar-icon mode-alert${showing ? ' active' : ''}`}
        label="Alerts"
        tooltip={showing ? 'Alerts (the ticker is running)' : 'Alerts'}
        icon={<Megaphone size={20} />}
        pressed={showing}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!inPlan}
        onClick={() => setOpen(!open)}
      >
        {showing && <span className="toolbar-icon-dot" aria-hidden="true" />}
      </IconButton>
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
  const mode = useOperatorStore((s) => s.live.mode)
  const canGoBack = useOperatorStore((s) => s.liveHistory.length > 0)
  const outputOpen = useOperatorStore((s) => s.outputOpen)
  const setOutputMode = useOperatorStore((s) => s.setOutputMode)
  const goBack = useOperatorStore((s) => s.goBack)
  const toggleOutput = useOperatorStore((s) => s.toggleOutput)
  const toggleStream = useOperatorStore((s) => s.toggleStream)
  const logoLayerVisible = useOperatorStore((s) => s.settings.logoLayerVisible)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const testPattern = useOperatorStore((s) => s.streamTestPattern)
  const setTestPattern = useOperatorStore((s) => s.setStreamTestPattern)

  const choose = (action: () => void) => () => {
    action()
    onChoose()
  }

  return (
    <div className="live-menu-list more-menu-list" role="menu" aria-label="More">
      <div className="menu-heading">
        <Tv size={13} aria-hidden="true" /> Outputs
      </div>
      <button type="button" role="menuitem" disabled={!canGoBack} onClick={choose(goBack)}>
        <Undo2 size={16} aria-hidden="true" />
        <span>Go Back</span>
      </button>
      <button type="button" role="menuitemcheckbox" aria-checked={mode === 'logo'} onClick={choose(() => setOutputMode(mode === 'logo' ? 'show' : 'logo'))}>
        <Image size={16} aria-hidden="true" />
        <span>Logo</span>
        {mode === 'logo' && <Check size={14} aria-hidden="true" />}
        <kbd>L</kbd>
      </button>
      <button type="button" role="menuitemcheckbox" aria-checked={outputOpen} onClick={choose(() => toggleOutput().catch(console.error))}>
        <Tv size={16} aria-hidden="true" />
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
        <Cast size={16} aria-hidden="true" />
        <span>Show Stream Output</span>
        {streamOpen && <Check size={14} aria-hidden="true" />}
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={stageOpen}
        disabled={!stageOpen && !can('stageDisplay')}
        title={can('stageDisplay') ? 'The stage display for the worship leader' : upgradeNote('stageDisplay')}
        onClick={choose(() => toggleStage().catch(console.error))}
      >
        <MonitorPlay size={16} aria-hidden="true" />
        <span>Stage Display</span>
        {stageOpen && <Check size={14} aria-hidden="true" />}
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={logoLayerVisible}
        onClick={choose(() => updateSettings({ logoLayerVisible: !logoLayerVisible }).catch(console.error))}
      >
        <Layers size={16} aria-hidden="true" />
        <span>Logo Layer</span>
        {logoLayerVisible && <Check size={14} aria-hidden="true" />}
      </button>
      <button type="button" role="menuitemcheckbox" aria-checked={testPattern} onClick={choose(() => setTestPattern(!testPattern))}>
        <ScanLine size={16} aria-hidden="true" />
        <span>Stream Test Pattern</span>
        {testPattern && <Check size={14} aria-hidden="true" />}
      </button>
      <hr />
      <div className="menu-heading">
        <LayoutPanelLeft size={13} aria-hidden="true" /> Screens
      </div>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={themeEditorOpen}
        disabled={!can('themes.editor')}
        title={can('themes.editor') ? undefined : upgradeNote('themes.editor')}
        onClick={choose(() => openThemeEditor(!themeEditorOpen))}
      >
        <Palette size={16} aria-hidden="true" />
        <span>Themes</span>
        {themeEditorOpen && <Check size={14} aria-hidden="true" />}
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={streamPanelOpen}
        disabled={!streamPanelOpen && !can('multiOutput')}
        title={can('multiOutput') ? (streamOpen ? 'Studio: Stream output, logos and key (the Stream output is open)' : 'Studio: Stream output, logos and key') : upgradeNote('multiOutput')}
        onClick={choose(() => openStreamPanel(!streamPanelOpen))}
      >
        <Cast size={16} aria-hidden="true" />
        <span>Studio</span>
        {streamPanelOpen && <Check size={14} aria-hidden="true" />}
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={sermonsOpen}
        title="Sermons: saved listening sessions, their transcripts and exports"
        onClick={choose(() => openSermons(!sermonsOpen))}
      >
        <BookOpenText size={16} aria-hidden="true" />
        <span>Sermons</span>
        {sermonsOpen && <Check size={14} aria-hidden="true" />}
      </button>
      {hasFeature('sharing.layouts') && (
        <>
          <hr />
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
            <Settings2 size={16} aria-hidden="true" />
            <span>Edit layouts…</span>
          </button>
        </>
      )}
      <hr />
      <button type="button" role="menuitem" onClick={choose(() => openSettingsAt('Devices'))}>
        <Plug size={16} aria-hidden="true" />
        <span>Devices</span>
      </button>
      <button type="button" role="menuitem" onClick={choose(() => openSettingsAt('Sharing'))}>
        <Wifi size={16} aria-hidden="true" />
        <span>Sharing</span>
      </button>
      <button type="button" role="menuitem" onClick={choose(() => useOperatorStore.getState().setPaletteOpen(true))}>
        <Search size={16} aria-hidden="true" />
        <span>Search</span>
        <kbd>{MOD}K</kbd>
      </button>
      <button type="button" role="menuitem" title="Every action and its shortcut, in the command palette" onClick={choose(() => useOperatorStore.getState().setPaletteOpen(true))}>
        <CircleHelp size={16} aria-hidden="true" />
        <span>Help</span>
      </button>
    </div>
  )
}

/**
 * The top bar's More menu: the outputs (Logo, the output windows, Go Back), Themes, Studio, Sermons, the layout,
 * Devices, Sharing, Search and Help. It keeps the top bar to one row on a 1280 pixel wide laptop.
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
        size="lg"
        tooltip={`More: outputs, Themes, Studio, Sermons, layout (${activeLayout.name}), Devices, Sharing and Help`}
        icon={<Ellipsis size={20} />}
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

/** The ServiceEx mark: a rounded square in the accent with a rising path. */
function LogoMark() {
  return (
    <svg className="brand-mark" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="8" fill="var(--accent)" />
      <path d="M7 19.5h4.5v-4h4.5v-4h4.5" fill="none" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** "Saved just now", "Saved 4 min ago": every change to the service is written to disk as it is made. */
function useSavedText(service: unknown): string {
  const [savedAt, setSavedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => setSavedAt(Date.now()), [service])
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const minutes = Math.floor(Math.max(0, now - savedAt) / 60_000)
  return minutes < 1 ? 'Saved just now' : `Saved ${minutes} min ago`
}

const LISTEN_TONES: Record<string, StatusTone> = { cloud: 'success', offline: 'success', reconnecting: 'warning', busy: 'warning', error: 'error', stopped: 'neutral' }

/** The listener in one chip: whether it is listening, how, and the cloud hours left. Opens the transcript. */
function ListeningChip() {
  const status = useListener((st) => st.status)
  const mode = useListener((st) => st.mode)
  const modeReason = useListener((st) => st.modeReason)
  const error = useListener((st) => st.error)
  const restarting = useListener((st) => st.restarting)
  const speechEngine = useOperatorStore((s) => s.settings.speechEngine)
  const account = useAccount()
  const chip = chipOf(status, mode, modeReason, error, restarting)
  const listening = chip.label === 'Listening'
  const label = listening ? `${chip.detail ?? 'Cloud'} listening` : chip.label === 'Stopped' ? 'Not listening' : chip.label
  const balance = account?.signedIn && speechEngine !== 'whisper' ? account.balance : null
  const left = listening && mode === 'cloud' && balance ? `${formatHours(balance.totalSeconds)} left` : null
  return (
    <button type="button" className="listening-chip" title={`${chip.why} Click for the live transcript.`} onClick={() => toggleTranscriptDrawer()}>
      <StatusDot tone={LISTEN_TONES[chip.tone] ?? 'neutral'} pulse={listening} />
      <span className="listening-chip-label">{label}</span>
      {left && <span className="listening-chip-time">{left}</span>}
    </button>
  )
}

/** Top bar: the brand, the service, the listener, the output group and app-wide actions. Settings is always last. */
export function Toolbar() {
  const service = useOperatorStore((s) => s.service)
  // Everything here is about the projector, so it reads the live snapshot, not the grid.
  const mode = useOperatorStore((s) => s.live.mode)
  const onAir = useOperatorStore((s) => s.live.mode === 'show' && s.live.slideIndex !== null)
  const liveTitle = useOperatorStore((s) => s.live.title)
  const setOutputMode = useOperatorStore((s) => s.setOutputMode)
  const settingsOpen = useOperatorStore((s) => s.settingsOpen)
  const openSettings = useOperatorStore((s) => s.openSettings)
  const saved = useSavedText(service)

  return (
    <header className="toolbar">
      <div className="brand">
        <LogoMark />
        <span className="brand-wordmark">ServiceEx</span>
      </div>
      <span className="toolbar-divider" aria-hidden="true" />
      <button type="button" className="toolbar-service" title="Choose or create a service" onClick={showServicePicker}>
        <span className="toolbar-service-name">{service ? service.name : 'No service open'}</span>
        <span className="toolbar-service-date">{service ? (service.date ? `${service.date} · ${saved}` : saved) : 'Choose or create one'}</span>
      </button>

      <AlertRunningChip />
      <LowerThirdChip />

      <div className="toolbar-actions">
        <ListeningChip />
        <div className="mode-buttons" role="group" aria-label="Output">
          {OUTPUT_MODES.map(({ mode: m, key, label }) => (
            <button
              key={m}
              type="button"
              className={`mode-button mode-${m}${mode === m ? ' active' : ''}${m === 'show' && onAir ? ' on-air' : ''}`}
              aria-pressed={mode === m}
              title={m === 'show' ? `On air: show the live slide (${key})${liveTitle && onAir ? `, now ${liveTitle}` : ''}` : `${label}: the output goes ${label.toLowerCase()} (${key})`}
              aria-keyshortcuts={key}
              onClick={() => setOutputMode(m)}
            >
              {m === 'show' && <span className="live-dot" aria-hidden="true" />}
              {label.toUpperCase()}
            </button>
          ))}
        </div>
        <AlertsButton />
        <MoreMenu />
        <IconButton
          size="lg"
          className="toolbar-icon toolbar-settings"
          label="Settings"
          tooltip={`Settings (${MOD},)`}
          icon={<Settings size={20} />}
          pressed={settingsOpen}
          aria-keyshortcuts={IS_MAC ? 'Meta+,' : 'Control+,'}
          onClick={() => openSettings(!settingsOpen)}
        />
      </div>
    </header>
  )
}

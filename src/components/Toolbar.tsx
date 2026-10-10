import { Eraser, Image, Monitor, MonitorPlay, Palette, Search, Settings, Square, type LucideIcon } from 'lucide-react'
import type { OutputMode } from '../../shared/types'
import { MOD, MODE_KEYS } from '../lib/shortcuts'
import { useOperatorStore } from '../store'

const MODE_ICONS: Record<OutputMode, LucideIcon> = { show: Monitor, black: Square, clear: Eraser, logo: Image }

/** Top bar: the service, what the audience sees right now, the output mode buttons and app-wide actions. */
export function Toolbar() {
  const service = useOperatorStore((s) => s.service)
  const mode = useOperatorStore((s) => s.outputMode)
  const onAir = useOperatorStore((s) => s.outputMode === 'show' && s.liveSlideIndex !== null)
  const deckTitle = useOperatorStore((s) => s.deckTitle)
  const setOutputMode = useOperatorStore((s) => s.setOutputMode)
  const setPaletteOpen = useOperatorStore((s) => s.setPaletteOpen)
  const themeEditorOpen = useOperatorStore((s) => s.themeEditorOpen)
  const settingsOpen = useOperatorStore((s) => s.settingsOpen)
  const openThemeEditor = useOperatorStore((s) => s.openThemeEditor)
  const openSettings = useOperatorStore((s) => s.openSettings)
  const stageOpen = useOperatorStore((s) => s.stageOpen)
  const toggleStage = useOperatorStore((s) => s.toggleStage)

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
        {deckTitle && <span className="live-title">{deckTitle}</span>}
      </div>

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
      </div>

      <div className="toolbar-actions">
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

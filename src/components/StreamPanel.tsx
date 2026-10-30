import { ArrowDown, ArrowUp, Cast, Eye, EyeOff, Plus, ScanLine, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AppSettings, DisplayInfo, LogoAnchor, LogoItem, StreamKeyMode, StreamResolution, StreamState, StreamTestBackground } from '../../shared/types'
import { reportError, type ErrorLike } from '../lib/errors'
import { usePersistentState } from '../lib/usePersistentState'
import { selectStreamState, useOperatorStore } from '../store'
import { StreamScreen } from './StreamView'
import { ErrorNote } from './ui'
import { CONTENT_COLORS } from '../styles/contentColors'

const RESOLUTIONS: { value: StreamResolution; label: string }[] = [
  { value: '1280x720', label: '1280×720 (720p)' },
  { value: '1920x1080', label: '1920×1080 (1080p)' },
  { value: '2560x1440', label: '2560×1440' },
  { value: '3840x2160', label: '3840×2160 (4K)' },
]

const ANCHORS: { value: LogoAnchor; label: string }[] = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'free', label: 'Free position' },
]

const BACKGROUNDS: { value: StreamKeyMode; label: string; hint: string }[] = [
  { value: 'transparent', label: 'Transparent', hint: 'No background at all, for window capture, NDI or a virtual camera.' },
  { value: 'chroma', label: 'Chroma green', hint: 'A solid key color for a chroma key on the ATEM or vision mixer.' },
  { value: 'luma', label: 'Black (luma key)', hint: 'Black behind the graphics, for a luma key.' },
  { value: 'keyFill', label: 'Key and Fill', hint: 'This output is the fill (graphics on black); a second output shows the key, white shapes on black.' },
]

const TEST_BACKGROUNDS: { value: StreamTestBackground; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'checker', label: 'Checkerboard' },
  { value: 'webcam', label: 'Webcam' },
]

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function Slider({ label, value, min, max, step, unit, onChange, disabled }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (value: number) => void
  disabled?: boolean
}) {
  return (
    <label className="stream-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="hint">
        {unit === '%' && max === 1 ? Math.round(value * 100) : value}
        {unit}
      </span>
    </label>
  )
}

/** One logo of the logo layer: on or off, where it sits, its size, margin and opacity. */
function LogoRow({ logo, index, count, onChange, onMove, onRemove }: {
  logo: LogoItem
  index: number
  count: number
  onChange: (patch: Partial<LogoItem>) => void
  onMove: (delta: number) => void
  onRemove: () => void
}) {
  const free = logo.anchor === 'free'
  return (
    <li className={`stream-logo${logo.enabled ? '' : ' off'}`}>
      <div className="stream-logo-head">
        <img className="stream-logo-thumb" src={logo.url} alt="" draggable={false} />
        <span className="stream-logo-name" title={logo.name}>
          {logo.name || 'Logo'}
        </span>
        <label className="inline-check">
          <input type="checkbox" checked={logo.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
          On
        </label>
        <button type="button" className="icon-button" aria-label="Move down (behind)" title="Move behind" disabled={index === 0} onClick={() => onMove(-1)}>
          <ArrowDown size={14} />
        </button>
        <button type="button" className="icon-button" aria-label="Move up (in front)" title="Move in front" disabled={index === count - 1} onClick={() => onMove(1)}>
          <ArrowUp size={14} />
        </button>
        <button type="button" className="icon-button" aria-label={`Remove ${logo.name || 'logo'}`} title="Remove" onClick={onRemove}>
          <Trash2 size={14} />
        </button>
      </div>
      <div className="stream-logo-controls">
        <label className="stream-slider">
          <span>Anchor</span>
          <select className="input" value={logo.anchor} onChange={(e) => onChange({ anchor: e.target.value as LogoAnchor })}>
            {ANCHORS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        {free ? (
          <>
            <Slider label="Across" value={logo.x} min={0} max={100} step={0.5} unit="%" onChange={(x) => onChange({ x })} />
            <Slider label="Down" value={logo.y} min={0} max={100} step={0.5} unit="%" onChange={(y) => onChange({ y })} />
          </>
        ) : (
          <Slider label="Margin" value={logo.margin} min={0} max={20} step={0.5} unit="% of height" onChange={(margin) => onChange({ margin })} />
        )}
        <Slider label="Size" value={logo.size} min={2} max={60} step={0.5} unit="% of height" onChange={(size) => onChange({ size })} />
        <Slider label="Opacity" value={logo.opacity} min={0} max={1} step={0.05} unit="%" onChange={(opacity) => onChange({ opacity })} />
      </div>
    </li>
  )
}

/**
 * The Stream output: a preview with safe area guides, the window and its display, the key, what the live slide does
 * on the stream, and the logo layer.
 */
export function StreamPanel() {
  const settings = useOperatorStore((s) => s.settings)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const openStreamPanel = useOperatorStore((s) => s.openStreamPanel)
  const streamOpen = useOperatorStore((s) => s.streamOpen)
  const toggleStream = useOperatorStore((s) => s.toggleStream)
  const testPattern = useOperatorStore((s) => s.streamTestPattern)
  const setTestPattern = useOperatorStore((s) => s.setStreamTestPattern)
  const testBackground = useOperatorStore((s) => s.streamTestBackground)
  const setTestBackground = useOperatorStore((s) => s.setStreamTestBackground)
  const [webcamError, setWebcamError] = useState<string | null>(null)
  // A string compares by value, so the preview redraws only when the stream changes.
  const streamJson = useOperatorStore((s) => JSON.stringify(selectStreamState(s)))
  const stream = useMemo(() => JSON.parse(streamJson) as StreamState, [streamJson])
  const [guides, setGuides] = usePersistentState('worshipdeck.streamGuides', true, isBoolean)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [error, setError] = useState<ErrorLike | null>(null)

  useEffect(() => {
    window.api.settings.listDisplays().then(setDisplays, console.error)
  }, [])

  const save = (patch: Partial<AppSettings>) => {
    setError(null)
    updateSettings(patch).catch((err) => setError(reportError('Stream', err)))
  }

  const logos = settings.logoItems
  const changeLogo = (id: string, patch: Partial<LogoItem>) => save({ logoItems: logos.map((l) => (l.id === id ? { ...l, ...patch } : l)) })
  const moveLogo = (index: number, delta: number) => {
    const next = [...logos]
    const [moved] = next.splice(index, 1)
    next.splice(index + delta, 0, moved)
    save({ logoItems: next })
  }

  async function addLogo() {
    setError(null)
    try {
      const picked = await window.api.stream.pickLogo()
      if (!picked) return
      const logo: LogoItem = {
        id: crypto.randomUUID(),
        name: picked.name,
        url: picked.url,
        anchor: 'top-right',
        x: 50,
        y: 50,
        size: 12,
        margin: 0,
        opacity: 1,
        enabled: true,
      }
      await updateSettings({ logoItems: [...useOperatorStore.getState().settings.logoItems, logo] })
    } catch (err) {
      setError(reportError('Stream', err))
    }
  }

  const display = displays.find((d) => d.id === settings.streamDisplay)
  const [width, height] = settings.streamResolution.split('x').map(Number)
  const displayPixels = display && { width: Math.round(display.width * display.scaleFactor), height: Math.round(display.height * display.scaleFactor) }
  const mismatch = displayPixels && (displayPixels.width !== width || displayPixels.height !== height)

  return (
    <section className="panel settings-panel stream-panel">
      <header className="panel-header">
        <h2>Stream</h2>
        <button className="icon-button" aria-label="Close the Stream panel" title="Close" onClick={() => openStreamPanel(false)}>
          <X size={18} />
        </button>
      </header>

      <ErrorNote error={error} />

      <div className="stream-preview-frame">
        <StreamScreen
          state={stream}
          guides={guides}
          // A transparent output shows as a checkerboard here, so the preview never looks empty.
          testBackground={testBackground !== 'off' ? testBackground : stream.keyMode === 'transparent' ? 'checker' : 'off'}
          onWebcamError={setWebcamError}
        />
      </div>
      <div className="settings-row">
        <button type="button" className={`button${streamOpen ? ' active' : ''}`} aria-pressed={streamOpen} onClick={() => toggleStream().catch(console.error)}>
          <Cast size={15} aria-hidden="true" /> {streamOpen ? 'Close Stream output' : 'Open Stream output'}
        </button>
        <button
          type="button"
          className={`button${testPattern ? ' active' : ''}`}
          aria-pressed={testPattern}
          title="Fills the Stream output with the key color, a border and corner markers, for lining up the key"
          onClick={() => setTestPattern(!testPattern)}
        >
          <ScanLine size={15} aria-hidden="true" /> Test pattern
        </button>
        <label className="inline-check">
          <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} />
          Safe area guides
        </label>
      </div>
      <p className="hint">The guides show here only: action safe (outer, 5%) and title safe (inner, 10%).</p>
      <div className="settings-row">
        <span className="field-label">Test background</span>
        <span className="segmented" role="radiogroup" aria-label="Test background">
          {TEST_BACKGROUNDS.map((b) => (
            <button
              key={b.value}
              type="button"
              role="radio"
              aria-checked={testBackground === b.value}
              className={testBackground === b.value ? 'active' : ''}
              onClick={() => {
                setWebcamError(null)
                setTestBackground(b.value)
              }}
            >
              {b.label}
            </button>
          ))}
        </span>
      </div>
      <p className="hint">
        Preview only: shows a checkerboard or this computer's webcam where the background would be keyed out, to check the layering on a laptop. The
        Stream output itself is unchanged.
      </p>
      {testBackground === 'webcam' && webcamError && <p className="hint">The webcam could not be opened: {webcamError}</p>}

      <Section title="Output">
        <label className="field">
          <span>Display</span>
          <select
            className="input"
            value={String(settings.streamDisplay)}
            onChange={(e) => save({ streamDisplay: e.target.value === 'window' ? 'window' : Number(e.target.value) })}
          >
            <option value="window">In a window</option>
            {displays.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label} · {Math.round(d.width * d.scaleFactor)}×{Math.round(d.height * d.scaleFactor)}
                {d.primary ? ' (main display)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Resolution</span>
          <select className="input" value={settings.streamResolution} onChange={(e) => save({ streamResolution: e.target.value as StreamResolution })}>
            {RESOLUTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        {mismatch && (
          <p className="hint">
            This display runs at {displayPixels.width}×{displayPixels.height}. Set it to {width}×{height} in the system display settings for a
            pixel-exact feed; until then the stream is scaled to fit.
          </p>
        )}
        <p className="hint">On a display the Stream output opens fullscreen; changing either setting reopens it.</p>
      </Section>

      <Section title="Output type">
        <span className="segmented" role="radiogroup" aria-label="Output type">
          {(
            [
              ['full', 'Full'],
              ['hide', 'Overlay only'],
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={settings.streamSlideContent === value} className={settings.streamSlideContent === value ? 'active' : ''} onClick={() => save({ streamSlideContent: value })}>
              {label}
            </button>
          ))}
        </span>
        <p className="hint">
          Full: every layer, the live slide with its own background. Overlay only: just the idle design, logos and lower thirds, never the slides.
          Clear shows the idle design either way; Black blacks out the whole stream.
        </p>
      </Section>

      <Section title="Background">
        <div className="settings-row">
          <span className="segmented" role="radiogroup" aria-label="Background">
            {BACKGROUNDS.map(({ value, label }) => (
              <button key={value} type="button" role="radio" aria-checked={settings.streamKeyMode === value} className={settings.streamKeyMode === value ? 'active' : ''} onClick={() => save({ streamKeyMode: value })}>
                {label}
              </button>
            ))}
          </span>
          {settings.streamKeyMode === 'chroma' && (
            <>
              <input type="color" aria-label="Key color" value={settings.streamKeyColor} onChange={(e) => save({ streamKeyColor: e.target.value })} />
              <span className="hint">{settings.streamKeyColor.toUpperCase()}</span>
              {settings.streamKeyColor !== CONTENT_COLORS.chromaGreen && (
                <button type="button" className="button" onClick={() => save({ streamKeyColor: CONTENT_COLORS.chromaGreen })}>
                  Reset to green
                </button>
              )}
            </>
          )}
        </div>
        <p className="hint">{BACKGROUNDS.find((b) => b.value === settings.streamKeyMode)?.hint}</p>
        {settings.streamKeyMode === 'transparent' && <p className="hint">Changing to or from Transparent reopens the Stream output.</p>}
        {settings.streamKeyMode === 'keyFill' && (
          <label className="field">
            <span>Key display</span>
            <select
              className="input"
              value={String(settings.streamKeyDisplay)}
              onChange={(e) => save({ streamKeyDisplay: e.target.value === 'window' ? 'window' : Number(e.target.value) })}
            >
              <option value="window">In a window</option>
              {displays.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label} · {Math.round(d.width * d.scaleFactor)}×{Math.round(d.height * d.scaleFactor)}
                  {d.primary ? ' (main display)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {settings.streamKeyMode === 'keyFill' && settings.streamKeyDisplay !== 'window' && settings.streamKeyDisplay === settings.streamDisplay && (
          <p className="hint">The key and the fill are on the same display. Pick a second display for the key.</p>
        )}
      </Section>

      <Section title="Logo layer">
        <div className="settings-row">
          <button
            type="button"
            className={`button${settings.logoLayerVisible ? ' active' : ''}`}
            aria-pressed={settings.logoLayerVisible}
            onClick={() => save({ logoLayerVisible: !settings.logoLayerVisible })}
          >
            {settings.logoLayerVisible ? <Eye size={15} aria-hidden="true" /> : <EyeOff size={15} aria-hidden="true" />}
            {settings.logoLayerVisible ? 'Showing' : 'Hidden'}
          </button>
          <button type="button" className="button" onClick={addLogo}>
            <Plus size={15} aria-hidden="true" /> Add logo…
          </button>
        </div>
        {logos.length === 0 ? (
          <p className="hint">No logos yet. A PNG with transparency works best; it is copied into the app data folder.</p>
        ) : (
          <ul className="stream-logos">
            {logos.map((logo, index) => (
              <LogoRow
                key={logo.id}
                logo={logo}
                index={index}
                count={logos.length}
                onChange={(patch) => changeLogo(logo.id, patch)}
                onMove={(delta) => moveLogo(index, delta)}
                onRemove={() => save({ logoItems: logos.filter((l) => l.id !== logo.id) })}
              />
            ))}
          </ul>
        )}
        <p className="hint">Later logos draw in front. Corner logos sit inside the action safe area, moved in by their margin.</p>
      </Section>

      <Section title="Church screen">
        <label className="inline-check">
          <input type="checkbox" checked={settings.overlaysOnChurchScreen} onChange={(e) => save({ overlaysOnChurchScreen: e.target.checked })} />
          Show the logo layer on the church screen
        </label>
        <p className="hint">Off: the logos go to the Stream output only. Lower thirds and the idle design show on every output.</p>
      </Section>
    </section>
  )
}

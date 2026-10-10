import { FolderOpen, HardDriveDownload, Image, Monitor, Moon, Palette, Save, Sun, SunMoon, Trash2, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { AppSettings, DisplayInfo, OutputDisplay } from '../../shared/types'
import { useOperatorStore } from '../store'
import { ThemeDefaultsForm } from './ThemeEditor'

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h3>
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

const APPEARANCES: { value: AppSettings['appearance']; label: string; icon: ReactNode }[] = [
  { value: 'system', label: 'System', icon: <SunMoon size={15} aria-hidden="true" /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={15} aria-hidden="true" /> },
  { value: 'light', label: 'Light', icon: <Sun size={15} aria-hidden="true" /> },
]

const INTERVALS: { value: AppSettings['backupIntervalMinutes']; label: string }[] = [
  { value: 0, label: 'Off' },
  { value: 10, label: 'Every 10 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
]

export function SettingsPanel() {
  const settings = useOperatorStore((s) => s.settings)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const openSettings = useOperatorStore((s) => s.openSettings)
  const loadSettings = useOperatorStore((s) => s.loadSettings)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.settings.listDisplays().then(setDisplays, console.error)
  }, [])

  async function run(action: () => Promise<unknown>, done?: string) {
    setError(null)
    setMessage(null)
    try {
      await action()
      if (done) setMessage(done)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const setOutputDisplay = (value: string) =>
    run(() => updateSettings({ outputDisplay: (value === 'auto' || value === 'window' ? value : Number(value)) as OutputDisplay }))

  return (
    <section className="panel settings-panel">
      <header className="panel-header">
        <h2>Settings</h2>
        <button className="icon-button" aria-label="Close settings" title="Close" onClick={() => openSettings(false)}>
          <X size={18} />
        </button>
      </header>

      {error && <p className="error">{error}</p>}
      {message && <p className="hint">{message}</p>}

      <Section icon={<SunMoon size={16} aria-hidden="true" />} title="Appearance">
        <div className="segmented" role="radiogroup" aria-label="Appearance">
          {APPEARANCES.map((a) => (
            <button
              key={a.value}
              role="radio"
              aria-checked={settings.appearance === a.value}
              className={settings.appearance === a.value ? 'active' : ''}
              onClick={() => run(() => updateSettings({ appearance: a.value }))}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      </Section>

      <Section icon={<Monitor size={16} aria-hidden="true" />} title="Output">
        <label className="field">
          <span>Output display</span>
          <select className="input" value={String(settings.outputDisplay)} onChange={(e) => setOutputDisplay(e.target.value)}>
            <option value="auto">Automatic (first display that is not the main one)</option>
            <option value="window">In a window</option>
            {displays.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label} · {d.width}×{d.height}
                {d.primary ? ' (main display)' : ''}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">Changing this reopens the output window on the chosen display, fullscreen.</p>
        <label className="fade-control">
          <span>Crossfade</span>
          <input
            type="range"
            min={0}
            max={1500}
            step={100}
            value={settings.fadeMs}
            onChange={(e) => run(() => updateSettings({ fadeMs: Number(e.target.value) }))}
          />
          <span className="fade-value">{(settings.fadeMs / 1000).toFixed(1)} s</span>
        </label>
      </Section>

      <Section icon={<Image size={16} aria-hidden="true" />} title="Logo">
        <div className="settings-logo">
          <div className="settings-logo-preview">
            {settings.logoUrl ? <img src={settings.logoUrl} alt="Current logo" /> : <span className="hint">Placeholder logo</span>}
          </div>
          <div className="settings-row">
            <button
              className="button"
              onClick={() => run(async () => {
                const saved = await window.api.settings.pickLogo()
                if (saved) await loadSettings()
              })}
            >
              <Image size={15} aria-hidden="true" /> Choose image…
            </button>
            {settings.logoUrl && (
              <button className="button" onClick={() => run(() => updateSettings({ logoUrl: null }))}>
                <Trash2 size={15} aria-hidden="true" /> Use placeholder
              </button>
            )}
          </div>
        </div>
        <p className="hint">Shown when you press Logo (L). A transparent PNG works best.</p>
      </Section>

      <Section icon={<Palette size={16} aria-hidden="true" />} title="Default themes">
        <ThemeDefaultsForm />
      </Section>

      <Section icon={<Save size={16} aria-hidden="true" />} title="Autosave and backups">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={settings.autosaveDrafts}
            onChange={(e) => run(() => updateSettings({ autosaveDrafts: e.target.checked }))}
          />
          Autosave song editor drafts
        </label>
        <div className="field">
          <span>Backup folder</span>
          <div className="settings-row">
            <span className="settings-path" title={settings.backupFolder ?? undefined}>
              {settings.backupFolder ?? 'Not set'}
            </span>
            <button
              className="button"
              onClick={() => run(async () => {
                if (await window.api.settings.pickBackupFolder()) await loadSettings()
              })}
            >
              <FolderOpen size={15} aria-hidden="true" /> Choose…
            </button>
          </div>
        </div>
        <label className="field">
          <span>Automatic backups</span>
          <select
            className="input"
            value={settings.backupIntervalMinutes}
            disabled={!settings.backupFolder}
            onChange={(e) => run(() => updateSettings({ backupIntervalMinutes: Number(e.target.value) as AppSettings['backupIntervalMinutes'] }))}
          >
            {INTERVALS.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </select>
        </label>
        <div className="settings-row">
          <button
            className="button"
            disabled={!settings.backupFolder}
            onClick={() => run(async () => {
              const file = await window.api.settings.backupNow()
              await loadSettings()
              setMessage(`Backed up to ${file}`)
            })}
          >
            <HardDriveDownload size={15} aria-hidden="true" /> Back up now
          </button>
          <span className="hint">
            {settings.lastBackupAt ? `Last backup ${new Date(settings.lastBackupAt).toLocaleString()}` : 'No backups yet'} · the
            newest 20 are kept
          </span>
        </div>
      </Section>
    </section>
  )
}

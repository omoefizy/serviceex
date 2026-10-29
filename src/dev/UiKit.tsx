// Dev only: every shared component (src/components/ui) in every state, and the design tokens behind them. Open it at
// #/ui-kit: the Vite dev server's address in a browser, or `location.hash = '#/ui-kit'; location.reload()` in the
// operator window's DevTools. Production builds leave it out (see src/main.tsx).
import { BookOpen, CalendarPlus, Copy, Download, Moon, Plus, Search, Settings, Sun, Trash2, TriangleAlert } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorNote,
  IconButton,
  Input,
  Modal,
  Panel,
  PanelHeader,
  SegmentedControl,
  Select,
  Tabs,
  Skeleton,
  StatusDot,
  Switch,
  Toast,
  ToastStack,
  Toggle,
  type ButtonVariant,
  type ChipTone,
  type ControlSize,
  type StatusTone,
  type ToastTone,
} from '../components/ui'
import './ui-kit.css'

const STATES = [
  { label: 'Default', force: undefined },
  { label: 'Hover', force: 'hover' },
  { label: 'Focus', force: 'focus' },
  { label: 'Active', force: 'active' },
] as const

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger']
const SIZES: ControlSize[] = ['sm', 'md', 'lg', 'xl']
const HEIGHTS: Record<ControlSize, string> = { sm: '32px', md: '36px', lg: '40px', xl: '44px' }
const STATUS_TONES: StatusTone[] = ['success', 'warning', 'error', 'live', 'accent', 'neutral']
const TONES: ChipTone[] = ['neutral', 'accent', 'live', 'success', 'warning', 'error']
const TOAST_TONES: ToastTone[] = ['info', 'success', 'warning', 'error']

const COLOR_GROUPS: { title: string; tokens: string[] }[] = [
  { title: 'Background', tokens: ['--bg-0', '--bg-1', '--bg-2', '--bg-3', '--surface', '--surface-raised'] },
  { title: 'Border', tokens: ['--border-subtle', '--border', '--border-strong'] },
  { title: 'Text', tokens: ['--text-1', '--text-2', '--text-3', '--text-on-fill', '--text-on-warning'] },
  { title: 'Accent', tokens: ['--accent', '--accent-bright', '--accent-hover', '--accent-tint', '--ink'] },
  { title: 'Live', tokens: ['--live-red', '--on-live', '--live-text', '--live-soft'] },
  {
    title: 'Status',
    tokens: ['--success', '--success-soft', '--warning', '--warning-fill', '--warning-soft', '--error', '--error-strong', '--error-soft'],
  },
  { title: 'Output modes', tokens: ['--mode-show', '--mode-black', '--mode-clear', '--mode-logo', '--mode-alert'] },
  { title: 'Other', tokens: ['--ai', '--highlight', '--quote-gold', '--screen-bg', '--screen-fg-muted', '--scrim'] },
]
const TYPE_SCALE = ['--text-xs', '--text-sm', '--text-md', '--text-base', '--text-lg', '--text-title', '--text-xl']
const SPACES = ['--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-8', '--space-10']
const RADII = ['--radius-sm', '--radius-md', '--radius-lg', '--radius-xl', '--radius-full']
const SHADOWS = ['--shadow-1', '--shadow-2', '--shadow-3']
const CONTROLS = ['--control-sm', '--control-md', '--control-lg', '--control-xl']

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="kit-section" id={id} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="kit-section-title">
        {title}
      </h2>
      {children}
    </section>
  )
}

/** A labelled row of examples. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kit-row">
      <span className="kit-row-label">{label}</span>
      <div className="kit-row-items">{children}</div>
    </div>
  )
}

function Swatch({ token }: { token: string }) {
  return (
    <div className="kit-swatch">
      <span className="kit-swatch-color" style={{ background: `var(${token})` }} />
      <code>{token}</code>
    </div>
  )
}

export default function UiKit() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const set = document.documentElement.dataset.theme
    return set === 'light' || set === 'dark' ? set : matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  })
  const [segment, setSegment] = useState<'system' | 'dark' | 'light'>('system')
  const [tab, setTab] = useState<'songs' | 'scripture' | 'media' | 'presentations'>('songs')
  const [toggles, setToggles] = useState({ a: false, b: true })
  const [modal, setModal] = useState(false)
  const [toasts, setToasts] = useState<{ id: number; tone: ToastTone }[]>([])

  function switchTheme(next: 'dark' | 'light') {
    document.documentElement.dataset.theme = next
    setTheme(next)
  }

  return (
    <div className="kit">
      <header className="kit-header">
        <div>
          <h1>UI kit</h1>
          <p className="kit-note">
            Development only. Every shared component in src/components/ui, in every state, built from src/styles/tokens.css. Hover, focus and
            active are forced with <code>data-force</code>; the last example in each row is live.
          </p>
        </div>
        <SegmentedControl
          aria-label="Appearance"
          value={theme}
          options={[
            { value: 'dark', label: 'Dark', icon: <Moon size={15} aria-hidden="true" /> },
            { value: 'light', label: 'Light', icon: <Sun size={15} aria-hidden="true" /> },
          ]}
          onChange={switchTheme}
        />
      </header>

      <nav className="kit-nav" aria-label="Sections">
        {['tokens', 'button', 'icon-button', 'input', 'select', 'toggle', 'tabs', 'card', 'chip', 'modal', 'toast', 'empty-state', 'error-note', 'skeleton', 'panel-header'].map((id) => (
          <a key={id} href={`#/ui-kit`} onClick={(e) => (e.preventDefault(), document.getElementById(id)?.scrollIntoView())}>
            {id}
          </a>
        ))}
      </nav>

      <Section id="tokens" title="Tokens">
        {COLOR_GROUPS.map((group) => (
          <Row key={group.title} label={group.title}>
            {group.tokens.map((token) => (
              <Swatch key={token} token={token} />
            ))}
          </Row>
        ))}
        <Row label="Type">
          {TYPE_SCALE.map((token) => (
            <span key={token} className="kit-type" style={{ fontSize: `var(${token})` }}>
              {token.replace('--text-', '')} Amazing grace
            </span>
          ))}
        </Row>
        <Row label="Spacing">
          {SPACES.map((token) => (
            <div key={token} className="kit-space">
              <span style={{ width: `var(${token})` }} />
              <code>{token}</code>
            </div>
          ))}
        </Row>
        <Row label="Radius">
          {RADII.map((token) => (
            <div key={token} className="kit-box" style={{ borderRadius: `var(${token})` }}>
              <code>{token}</code>
            </div>
          ))}
        </Row>
        <Row label="Shadow">
          {SHADOWS.map((token) => (
            <div key={token} className="kit-box" style={{ boxShadow: `var(${token})` }}>
              <code>{token}</code>
            </div>
          ))}
        </Row>
        <Row label="Control height">
          {CONTROLS.map((token) => (
            <div key={token} className="kit-control" style={{ height: `var(${token})` }}>
              <code>{token}</code>
            </div>
          ))}
        </Row>
      </Section>

      <Section id="button" title="Button">
        {VARIANTS.map((variant) => (
          <Row key={variant} label={variant}>
            {STATES.map((s) => (
              <Button key={s.label} variant={variant} data-force={s.force}>
                {s.label}
              </Button>
            ))}
            <Button variant={variant} disabled>
              Disabled
            </Button>
            <Button variant={variant} icon={<Plus size={15} aria-hidden="true" />}>
              Live
            </Button>
          </Row>
        ))}
        <Row label="Sizes">
          {SIZES.map((size) => (
            <Button key={size} size={size} variant="primary" icon={<Download size={15} aria-hidden="true" />}>
              {size} {HEIGHTS[size]}
            </Button>
          ))}
        </Row>
        <Row label="Pressed and tooltip">
          <Button pressed>Pressed</Button>
          <Button disabled disabledTooltip="Shown on a wrapper, because disabled buttons have no tooltip">
            Disabled with a reason
          </Button>
        </Row>
      </Section>

      <Section id="icon-button" title="IconButton">
        <Row label="States">
          {STATES.map((s) => (
            <IconButton key={s.label} label={`${s.label} settings`} icon={<Settings size={18} />} data-force={s.force} />
          ))}
          <IconButton label="Pressed" icon={<BookOpen size={18} />} pressed />
          <IconButton label="Disabled" icon={<Trash2 size={18} />} disabled disabledTooltip="Not in this plan" />
        </Row>
        <Row label="Sizes">
          {SIZES.map((size) => (
            <IconButton key={size} size={size} label={`Copy (${size})`} icon={<Copy size={size === 'lg' ? 18 : 16} />} />
          ))}
          <span className="kit-note">every size has an invisible 40px hit area</span>
        </Row>
      </Section>

      <Section id="input" title="Input">
        <Row label="States">
          {STATES.map((s) => (
            <Input key={s.label} aria-label={s.label} placeholder={s.label} data-force={s.force} />
          ))}
        </Row>
        <Row label="Other">
          <Input aria-label="Filled" defaultValue="Psalm 23" />
          <Input aria-label="Invalid" defaultValue="Hezekiah 4:2" invalid />
          <Input aria-label="Disabled" placeholder="Disabled" disabled />
          <Input aria-label="Large" placeholder="Large (40px)" size="lg" />
        </Row>
      </Section>

      <Section id="select" title="Select">
        <Row label="States">
          {STATES.map((s) => (
            <Select key={s.label} aria-label={s.label} data-force={s.force} defaultValue="kjv">
              <option value="kjv">{s.label}: KJV</option>
              <option value="web">WEB</option>
            </Select>
          ))}
        </Row>
        <Row label="Other">
          <Select aria-label="Disabled" disabled>
            <option>Disabled</option>
          </Select>
          <Select aria-label="Large" size="lg">
            <option>Large (40px)</option>
          </Select>
        </Row>
      </Section>

      <Section id="toggle" title="Toggle and SegmentedControl">
        <Row label="Toggle">
          <Toggle checked={toggles.a} onChange={(e) => setToggles({ ...toggles, a: e.target.checked })}>
            Off
          </Toggle>
          <Toggle checked={toggles.b} onChange={(e) => setToggles({ ...toggles, b: e.target.checked })}>
            On
          </Toggle>
          <Toggle checked={false} data-force="hover">
            Hover
          </Toggle>
          <Toggle checked data-force="focus">
            Focus
          </Toggle>
          <Toggle checked={false} disabled>
            Disabled off
          </Toggle>
          <Toggle checked disabled>
            Disabled on
          </Toggle>
        </Row>
        <Row label="Segmented">
          <SegmentedControl<typeof segment>
            aria-label="Appearance example"
            value={segment}
            options={[
              { value: 'system', label: 'System' },
              { value: 'dark', label: 'Dark', icon: <Moon size={15} aria-hidden="true" /> },
              { value: 'light', label: 'Light', icon: <Sun size={15} aria-hidden="true" /> },
            ]}
            onChange={setSegment}
          />
          <SegmentedControl
            aria-label="With a disabled option"
            value="cloud"
            options={[
              { value: 'cloud', label: 'Cloud' },
              { value: 'offline', label: 'Offline', disabled: true },
            ]}
            onChange={() => undefined}
          />
        </Row>
      </Section>

      <Section id="tabs" title="Tabs">
        <Tabs<typeof tab>
          aria-label="Library"
          idPrefix="kit-library"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'songs', label: 'Songs' },
            { id: 'scripture', label: 'Scripture' },
            { id: 'media', label: 'Media' },
            { id: 'presentations', label: 'Presentations', disabled: true },
          ]}
        />
        <p id={`kit-library-panel-${tab}`} role="tabpanel" aria-labelledby={`kit-library-tab-${tab}`} className="kit-note">
          The {tab} panel. Arrow keys, Home and End move between tabs; Presentations is disabled.
        </p>
      </Section>

      <Section id="card" title="Card">
        <div className="kit-grid">
          <Card
            title="Output"
            icon={<Settings size={16} aria-hidden="true" />}
            actions={<IconButton label="More" icon={<Copy size={16} />} />}
            footer={
              <>
                <Button>Cancel</Button>
                <Button variant="primary">Save</Button>
              </>
            }
          >
            <Toggle checked>
              Auto go live on schedule next
            </Toggle>
            <p className="kit-note">A card stacks its children with its own gap.</p>
          </Card>
          <Card>
            <p className="kit-note">A card with no header or footer.</p>
          </Card>
        </div>
      </Section>

      <Section id="chip" title="Chip">
        {TONES.map((tone) => (
          <Row key={tone} label={tone}>
            <Chip tone={tone}>Label</Chip>
            <Chip tone={tone} dot>
              With dot
            </Chip>
            <Chip tone={tone} icon={<TriangleAlert size={13} aria-hidden="true" />}>
              With icon
            </Chip>
            <Chip tone={tone} onRemove={() => undefined} removeLabel="Remove filter">
              Removable
            </Chip>
          </Row>
        ))}
        <Row label="Clickable">
          {STATES.map((s) => (
            <Chip key={s.label} onClick={() => undefined} data-force={s.force}>
              {s.label}
            </Chip>
          ))}
          <Chip onClick={() => undefined} pressed>
            Pressed
          </Chip>
          <Chip onClick={() => undefined} disabled>
            Disabled
          </Chip>
        </Row>
      </Section>

      <Section id="modal" title="Modal">
        <Row label="Open">
          <Button variant="primary" onClick={() => setModal(true)}>
            Open a modal
          </Button>
          <span className="kit-note">Escape or the scrim closes it; Tab stays inside; focus goes back to this button.</span>
        </Row>
        {modal && (
          <Modal
            title="New service"
            onClose={() => setModal(false)}
            footer={
              <>
                <Button onClick={() => setModal(false)}>Cancel</Button>
                <Button variant="primary" onClick={() => setModal(false)}>
                  Create
                </Button>
              </>
            }
          >
            <label className="kit-field">
              <span>Name</span>
              <Input placeholder="Sunday morning" />
            </label>
            <label className="kit-field">
              <span>Date</span>
              <Input type="date" />
            </label>
          </Modal>
        )}
      </Section>

      <Section id="toast" title="Toast">
        <div className="kit-stack">
          {TOAST_TONES.map((tone) => (
            <Toast
              key={tone}
              tone={tone}
              title={`${tone[0].toUpperCase()}${tone.slice(1)}`}
              details={tone === 'error' ? 'listen EADDRINUSE: address already in use 0.0.0.0:47800' : undefined}
              onDismiss={() => undefined}
            >
              {tone === 'error' ? 'Another program is already using that network port.' : 'Saved Sunday morning.serviceex to the Desktop.'}
            </Toast>
          ))}
        </div>
        <Row label="Live">
          {TOAST_TONES.map((tone) => (
            <Button key={tone} size="sm" onClick={() => setToasts((t) => [...t, { id: Date.now(), tone }])}>
              Show {tone}
            </Button>
          ))}
        </Row>
        <ToastStack>
          {toasts.map((t) => (
            <Toast key={t.id} tone={t.tone} onDismiss={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
              A {t.tone} message.
            </Toast>
          ))}
        </ToastStack>
      </Section>

      <Section id="empty-state" title="EmptyState">
        <div className="kit-grid">
          <Card>
            <EmptyState
              icon={<CalendarPlus size={20} />}
              title="No service yet"
              description="A service is the run list for one gathering."
              action={
                <Button variant="primary" icon={<Plus size={15} aria-hidden="true" />}>
                  New service
                </Button>
              }
              secondaryAction={<Button variant="ghost">Create a sample service</Button>}
            />
          </Card>
          <Card>
            <EmptyState compact icon={<Search size={20} />} title="No verses found" description="Try fewer words, or quotes for an exact phrase." />
          </Card>
          <Card>
            <EmptyState
              tone="error"
              icon={<TriangleAlert size={20} />}
              title="The Schedule panel stopped working"
              description="Your service, songs and what is on the screen are safe. Reload the panel to carry on."
              action={<Button variant="primary">Reload panel</Button>}
              secondaryAction={<Button>Copy diagnostics</Button>}
              details="TypeError: Cannot read properties of null (reading 'find')"
            />
          </Card>
        </div>
      </Section>

      <Section id="error-note" title="ErrorNote">
        <div className="kit-grid">
          <ErrorNote error="That song is no longer in the library." />
          <ErrorNote
            error={{ message: 'A file ServiceEx needs could not be found. It may have been moved, renamed or deleted.', details: "ENOENT: no such file or directory, open '/Media/loop.mp4'" }}
            action={<Button size="sm">Retry</Button>}
          />
        </div>
      </Section>

      <Section id="skeleton" title="Skeleton">
        <div className="kit-grid">
          <Card>
            <Skeleton rows={4} tall label="Loading prices" />
          </Card>
          <Card>
            <Skeleton rows={3} label="Loading the account" />
          </Card>
        </div>
      </Section>

      <Section id="switch" title="Switch and StatusDot">
        <Row label="Switch">
          <Switch aria-label="Off" checked={false} onCheckedChange={() => undefined} />
          <Switch aria-label="On" checked onCheckedChange={() => undefined} />
          <Switch aria-label="Focus" checked={false} data-force="focus" onCheckedChange={() => undefined} />
          <Switch aria-label="Disabled" checked disabled onCheckedChange={() => undefined} />
        </Row>
        <Row label="StatusDot">
          {STATUS_TONES.map((tone) => (
            <span key={tone} className="kit-note">
              <StatusDot tone={tone} pulse={tone === 'success'} /> {tone}
            </span>
          ))}
        </Row>
      </Section>

      <Section id="panel" title="Panel">
        <Panel title="Order of service" meta="6 items" actions={<Button size="sm">Add</Button>} footer={<Button size="lg">Add song, slide or verse</Button>}>
          <p className="kit-note">A panel: 16px corners, a Bricolage 17px title, the body under it.</p>
        </Panel>
      </Section>

      <Section id="panel-header" title="PanelHeader">
        <div className="kit-panel">
          <PanelHeader title="Schedule" actions={<IconButton label="Hide schedule" icon={<Copy size={16} />} />} />
        </div>
        <div className="kit-panel">
          <PanelHeader
            title="Settings"
            subtitle="Sunday morning · 2 November"
            actions={
              <>
                <Button size="sm">Export</Button>
                <IconButton label="Close" icon={<Trash2 size={16} />} />
              </>
            }
          />
        </div>
      </Section>
    </div>
  )
}

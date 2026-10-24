import { useEffect, useState, type FocusEvent, type ReactNode } from 'react'
import { THEME_CONTENT_TYPES } from '../../shared/themes'
import type { TextCase, Theme, ThemeBackground, ThemeBox, ThemeContentType, ThemeElement, ThemeStyle, ThemeTextElement, ThemeTextProps } from '../../shared/types'
import { selectBaseThemeId, useOperatorStore } from '../store'
import { cssFontFamily } from '../lib/fonts'
import { clampBox } from '../lib/themeLayout'
import { MediaPickerModal } from './MediaGrid'
import { ThemedSlide } from './ThemedSlide'

const SAMPLES = {
  song: {
    label: 'Song',
    text: 'How great is our God\nSing with me, how great is our God\nAnd all will see how great\nHow great is our God',
    caption: '© Example Music · CCLI 1234567',
  },
  scripture: {
    label: 'Scripture',
    text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
    caption: 'John 3:16 KJV',
  },
  long: {
    label: 'Long',
    text: 'Amazing grace! How sweet the sound that saved a wretch like me\nI once was lost, but now am found, was blind, but now I see\n’Twas grace that taught my heart to fear, and grace my fears relieved\nHow precious did that grace appear the hour I first believed',
    caption: '',
  },
}

const CONTENT_LABELS: Record<ThemeContentType, string> = { song: 'Songs', scripture: 'Scripture', announcement: 'Announcements', quote: 'Quotes', lowerThird: 'Lower thirds', logo: 'Logos' }
const WEIGHTS = [300, 400, 500, 600, 700, 800, 900]
const CASES: { value: TextCase; label: string }[] = [
  { value: 'normal', label: 'As typed' },
  { value: 'upper', label: 'UPPERCASE' },
  { value: 'lower', label: 'lowercase' },
]

/** Shown when the system will not list its fonts. */
const FALLBACK_FONTS = [
  'Arial',
  'Avenir Next',
  'Calibri',
  'Georgia',
  'Gill Sans',
  'Helvetica Neue',
  'Montserrat',
  'Open Sans',
  'Palatino',
  'Segoe UI',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
]

let systemFonts: Promise<string[]> | null = null

/** Installed font families, through Chromium's Local Font Access API. Asked once, on first use (it needs a click). */
function loadSystemFonts(): Promise<string[]> {
  systemFonts ??= (async () => {
    const query = (window as Window & { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
    if (!query) return FALLBACK_FONTS
    try {
      const fonts = await query.call(window)
      const families = [...new Set(fonts.map((font) => font.family))].sort((a, b) => a.localeCompare(b))
      return families.length > 0 ? families : FALLBACK_FONTS
    } catch {
      return FALLBACK_FONTS
    }
  })()
  return systemFonts
}

/** "'Helvetica Neue', Inter, sans-serif" → "Helvetica Neue". */
const familyName = (value: string) => value.split(',')[0].replace(/['"]/g, '').trim()

export function FontPicker({ value, onChange, emptyLabel }: { value: string; onChange(value: string): void; emptyLabel?: string }) {
  const [open, setOpen] = useState(false)
  const [fonts, setFonts] = useState<string[] | null>(null)
  const [query, setQuery] = useState('')
  const shown = (fonts ?? []).filter((f) => f.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 300)

  function openList() {
    setOpen(true)
    setQuery('')
    loadSystemFonts().then(setFonts)
  }

  function choose(font: string) {
    onChange(font)
    setOpen(false)
  }

  function handleBlur(e: FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
  }

  return (
    <div className="font-picker" onBlur={handleBlur}>
      <button
        type="button"
        className="input font-picker-value"
        style={{ fontFamily: value ? cssFontFamily(value) : undefined }}
        onClick={() => (open ? setOpen(false) : openList())}
      >
        {value ? familyName(value) : emptyLabel}
      </button>
      {open && (
        <div className="font-picker-menu">
          <input
            className="input"
            placeholder="Search installed fonts"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
              // Allow a family the list does not show, such as a web font name.
              if (e.key === 'Enter' && query.trim()) choose(shown.find((f) => f.toLowerCase() === query.trim().toLowerCase()) ?? query.trim())
            }}
          />
          <ul>
            {emptyLabel !== undefined && (
              <li>
                <button type="button" onClick={() => choose('')}>
                  {emptyLabel}
                </button>
              </li>
            )}
            {fonts === null && <li className="hint">Loading fonts…</li>}
            {shown.map((font) => (
              <li key={font}>
                <button type="button" style={{ fontFamily: cssFontFamily(font) }} onClick={() => choose(font)}>
                  {font}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="theme-row" role="group" aria-label={label}>
      <span>{label}</span>
      <div className="theme-row-controls">{children}</div>
    </div>
  )
}

function NumberInput(props: { value: number; min: number; max: number; step: number; onChange(value: number): void; suffix?: string }) {
  return (
    <span className="number-input">
      <input
        className="input"
        type="number"
        value={Number(props.value.toFixed(3))}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={(e) => e.target.value !== '' && props.onChange(Math.min(props.max, Math.max(props.min, Number(e.target.value))))}
      />
      {props.suffix && <small>{props.suffix}</small>}
    </span>
  )
}

function Range(props: { value: number; min: number; max: number; step: number; onChange(value: number): void; format(value: number): string }) {
  return (
    <>
      <input type="range" value={props.value} min={props.min} max={props.max} step={props.step} onChange={(e) => props.onChange(Number(e.target.value))} />
      <small className="range-value">{props.format(props.value)}</small>
    </>
  )
}

function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange(value: T): void }) {
  return (
    <span className="segmented" role="radiogroup">
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={props.value === option.value}
          className={props.value === option.value ? 'active' : ''}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </span>
  )
}

const Color = ({ value, onChange }: { value: string; onChange(value: string): void }) => (
  <input className="color-input" type="color" value={value} onChange={(e) => onChange(e.target.value)} />
)

function uniqueName(base: string, themes: Theme[]): string {
  const taken = new Set(themes.map((t) => t.name.toLowerCase()))
  let name = base
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`
  return name
}

/** "wd-media://local/1712345-ab12-sunrise.jpg" → "sunrise.jpg" (older files have no "ab12-" part). */
const mediaName = (src: string) => decodeURIComponent(src.split('/').pop() ?? '').replace(/^\d+-([a-z0-9]{4}-)?/, '')

/** The default theme for songs, scripture and announcements; shown in the theme editor and in Settings. */
export function ThemeDefaultsForm() {
  const themes = useOperatorStore((s) => s.themes)
  const defaults = useOperatorStore((s) => s.themeDefaults)
  const loadThemes = useOperatorStore((s) => s.loadThemes)
  const [error, setError] = useState<string | null>(null)

  async function setDefault(type: ThemeContentType, id: number) {
    try {
      await window.api.themes.setDefault(type, id)
      await loadThemes()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="theme-defaults">
      {THEME_CONTENT_TYPES.map((type) => (
        <label key={type} className="field">
          <span>Default for {CONTENT_LABELS[type].toLowerCase()}</span>
          <select className="input" value={defaults?.[type] ?? ''} onChange={(e) => setDefault(type, Number(e.target.value))}>
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      ))}
      {error && <p className="error">{error}</p>}
    </div>
  )
}

export function ThemeEditor() {
  const themes = useOperatorStore((s) => s.themes)
  const initialId = useOperatorStore((s) => s.deckThemeId ?? selectBaseThemeId(s) ?? s.themes[0]?.id ?? null)
  const loadThemes = useOperatorStore((s) => s.loadThemes)
  const openThemeEditor = useOperatorStore((s) => s.openThemeEditor)

  const [selectedId, setSelectedId] = useState<number | null>(initialId)
  const [name, setName] = useState('')
  const [style, setStyle] = useState<ThemeStyle | null>(null)
  const [sample, setSample] = useState<keyof typeof SAMPLES>('song')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Which kind of background the library picker is open for. */
  const [picking, setPicking] = useState<'image' | 'video' | null>(null)

  const selected = themes.find((t) => t.id === selectedId) ?? null
  const dirty = selected !== null && style !== null && (name !== selected.name || JSON.stringify(style) !== JSON.stringify(selected.style))
  const builtin = selected?.type === 'builtin'

  // Load the selected theme into the form when the selection changes (and once the theme list arrives).
  useEffect(() => {
    const theme = themes.find((t) => t.id === selectedId)
    if (!theme && themes.length > 0) {
      setSelectedId(themes[0].id)
      return
    }
    if (theme) {
      setName(theme.name)
      setStyle(theme.style)
      setConfirmingDelete(false)
    }
    // Only on selection changes; reloading the list after a save must not overwrite the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, themes.length > 0])

  async function run(action: () => Promise<void>) {
    setError(null)
    setMessage(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function select(id: number) {
    if (id === selectedId) return
    if (dirty && !window.confirm(`Discard your changes to ${selected?.name}?`)) return
    setSelectedId(id)
  }

  const update = (patch: Partial<ThemeStyle>) => setStyle((s) => s && { ...s, ...patch })

  // The form edits the main text box, and the Reference and Copyright boxes together as the caption line.
  const isCaption = (e: ThemeElement) => e.kind === 'reference' || e.kind === 'copyright'
  const mainText = style?.elements.find((e): e is ThemeTextElement => e.kind === 'text')
  const caption = style?.elements.find((e): e is Extract<ThemeElement, { attached: boolean }> => isCaption(e))
  const updateElements = (match: (e: ThemeElement) => boolean, change: (e: ThemeTextElement) => ThemeTextElement) =>
    setStyle((s) => s && { ...s, elements: s.elements.map((e) => (match(e) && 'text' in e ? change(e) : e)) })
  const updateText = (patch: Partial<ThemeTextProps>) => updateElements((e) => e.kind === 'text', (e) => ({ ...e, text: { ...e.text, ...patch } }))
  const updateCaption = (patch: Partial<ThemeTextProps>) => updateElements(isCaption, (e) => ({ ...e, text: { ...e.text, ...patch } }))
  const setCaptionAttached = (attached: boolean) => updateElements(isCaption, (e) => (e.kind === 'text' ? e : { ...e, attached }))

  /** The text box as margins from each side of the screen. */
  const marginsOf = (b: ThemeBox) => ({ top: b.y, right: 100 - b.x - b.width, bottom: 100 - b.y - b.height, left: b.x })
  function setMargin(side: 'top' | 'right' | 'bottom' | 'left', value: number) {
    updateElements(
      (e) => e.kind === 'text',
      (e) => {
        const m = { ...marginsOf(e.box), [side]: value }
        return { ...e, box: clampBox({ x: m.left, y: m.top, width: 100 - m.left - m.right, height: 100 - m.top - m.bottom }) }
      },
    )
  }

  function setBackgroundKind(kind: ThemeBackground['kind']) {
    if (!style || style.background.kind === kind) return
    const current = style.background
    const color = current.kind === 'solid' || current.kind === 'smoke' ? current.color : current.kind === 'gradient' ? current.from : '#000000'
    if (kind === 'solid') update({ background: { kind, color } })
    else if (kind === 'gradient') update({ background: { kind, from: color, to: '#333333', angle: 160 } })
    else if (kind === 'smoke') update({ background: { kind, color, smoke: '#5a7bc4' } })
    else if (kind === 'none') update({ background: { kind } })
    else setPicking(kind)
  }

  const save = () =>
    run(async () => {
      if (!selected || !style || builtin) return
      if (!(await window.api.themes.update(selected.id, name.trim() || selected.name, style))) throw new Error('This theme no longer exists.')
      await loadThemes()
      // Show what was stored, which may tidy a value, so the form is not left looking unsaved.
      const stored = useOperatorStore.getState().themes.find((t) => t.id === selected.id)
      if (stored) {
        setName(stored.name)
        setStyle(stored.style)
      }
      setMessage('Saved.')
    })

  const saveAsNew = () =>
    run(async () => {
      if (!style) return
      const created = await window.api.themes.create(uniqueName(name.trim() || 'New theme', themes), style)
      await loadThemes()
      setSelectedId(created.id)
      setMessage(`Saved as ${created.name}.`)
    })

  const duplicate = () =>
    run(async () => {
      if (!selected) return
      const created = await window.api.themes.create(uniqueName(`${selected.name} copy`, themes), selected.style)
      await loadThemes()
      setSelectedId(created.id)
    })

  const remove = () =>
    run(async () => {
      if (!selected || builtin) return
      await window.api.themes.delete(selected.id)
      await loadThemes()
      setSelectedId(null)
    })

  return (
    <section className="panel theme-editor">
      <header className="panel-header">
        <h2>Themes</h2>
        <button className="button" onClick={() => openThemeEditor(false)}>
          Close
        </button>
      </header>

      <ThemeDefaultsForm />

      <div className="theme-editor-body">
        <ul className="theme-list">
          {themes.map((t) => (
            <li key={t.id}>
              <button className={`theme-list-item${t.id === selectedId ? ' selected' : ''}`} onClick={() => select(t.id)}>
                <span className="theme-swatch">
                  <ThemedSlide theme={t.style} text="Aa" still />
                </span>
                <span className="theme-list-name">
                  {t.name}
                  {t.type === 'builtin' && <small>Built-in</small>}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {style && selected && (
          <div className="theme-form">
            <div className="theme-preview">
              <ThemedSlide theme={style} text={SAMPLES[sample].text} caption={SAMPLES[sample].caption} />
            </div>
            <Segmented<keyof typeof SAMPLES>
              value={sample}
              options={Object.entries(SAMPLES).map(([value, s]) => ({ value: value as keyof typeof SAMPLES, label: s.label }))}
              onChange={setSample}
            />

            <div className="theme-actions">
              <input className="input" aria-label="Theme name" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="button primary" disabled={builtin || !dirty} onClick={save} title={builtin ? 'Built-in themes cannot be changed' : undefined}>
                Save
              </button>
              <button className="button" onClick={saveAsNew}>
                Save as new
              </button>
              <button className="button" onClick={duplicate}>
                Duplicate
              </button>
              {!builtin &&
                (confirmingDelete ? (
                  <>
                    <button className="button" onClick={() => setConfirmingDelete(false)}>
                      Cancel
                    </button>
                    <button className="button danger" onClick={remove}>
                      Delete theme
                    </button>
                  </>
                ) : (
                  <button className="button" onClick={() => setConfirmingDelete(true)}>
                    Delete
                  </button>
                ))}
            </div>
            {builtin && <p className="hint">Built-in themes cannot be changed. Edit freely, then use Save as new to keep your version.</p>}
            {confirmingDelete && <p className="hint">Songs and defaults using this theme go back to the built-in defaults.</p>}
            {message && <p className="hint">{message}</p>}
            {error && <p className="error">{error}</p>}

            {mainText &&
              (() => {
                const t = mainText.text
                return (
                  <fieldset>
                    <legend>Text</legend>
                    <Row label="Font">
                      <FontPicker value={t.fontFamily} onChange={(fontFamily) => fontFamily && updateText({ fontFamily })} />
                      <select className="input" value={t.fontWeight} onChange={(e) => updateText({ fontWeight: Number(e.target.value) })}>
                        {WEIGHTS.map((w) => (
                          <option key={w} value={w}>
                            {w}
                          </option>
                        ))}
                      </select>
                    </Row>
                    <Row label="Size">
                      <Segmented
                        value={t.sizeMode}
                        options={[
                          { value: 'auto', label: 'Auto fit' },
                          { value: 'fixed', label: 'Fixed' },
                        ]}
                        onChange={(sizeMode) => updateText({ sizeMode })}
                      />
                      {t.sizeMode === 'fixed' && (
                        <NumberInput value={t.fontSize} min={1} max={30} step={0.5} suffix="% of height" onChange={(fontSize) => updateText({ fontSize })} />
                      )}
                    </Row>
                    <Row label="Color">
                      <Color value={t.color} onChange={(color) => updateText({ color })} />
                    </Row>
                    <Row label="Align">
                      <Segmented
                        value={t.align}
                        options={[
                          { value: 'left', label: 'Left' },
                          { value: 'center', label: 'Center' },
                          { value: 'right', label: 'Right' },
                        ]}
                        onChange={(align) => updateText({ align })}
                      />
                      <Segmented
                        value={t.verticalAlign}
                        options={[
                          { value: 'top', label: 'Top' },
                          { value: 'middle', label: 'Middle' },
                          { value: 'bottom', label: 'Bottom' },
                        ]}
                        onChange={(verticalAlign) => updateText({ verticalAlign })}
                      />
                    </Row>
                    <Row label="Line spacing">
                      <Range value={t.lineHeight} min={0.8} max={2.5} step={0.05} format={(v) => v.toFixed(2)} onChange={(lineHeight) => updateText({ lineHeight })} />
                    </Row>
                    <Row label="Case">
                      <select className="input" value={t.textCase} onChange={(e) => updateText({ textCase: e.target.value as TextCase })}>
                        {CASES.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </Row>
                    <Row label="Shadow">
                      <input type="checkbox" checked={t.shadow.enabled} onChange={(e) => updateText({ shadow: { ...t.shadow, enabled: e.target.checked } })} />
                      <Color value={t.shadow.color} onChange={(color) => updateText({ shadow: { ...t.shadow, color } })} />
                      <small>Blur</small>
                      <NumberInput value={t.shadow.blur} min={0} max={1} step={0.02} suffix="em" onChange={(blur) => updateText({ shadow: { ...t.shadow, blur } })} />
                      <small>Offset</small>
                      <NumberInput value={t.shadow.offset} min={0} max={0.5} step={0.01} suffix="em" onChange={(offset) => updateText({ shadow: { ...t.shadow, offset } })} />
                    </Row>
                    <Row label="Outline">
                      <input type="checkbox" checked={t.outline.enabled} onChange={(e) => updateText({ outline: { ...t.outline, enabled: e.target.checked } })} />
                      <Color value={t.outline.color} onChange={(color) => updateText({ outline: { ...t.outline, color } })} />
                      <NumberInput value={t.outline.width} min={0} max={0.2} step={0.005} suffix="em" onChange={(width) => updateText({ outline: { ...t.outline, width } })} />
                    </Row>
                  </fieldset>
                )
              })()}

            {mainText && (
              <fieldset>
                <legend>Safe area</legend>
                <Row label="Margins">
                  {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                    <span key={side} className="margin-input">
                      <small>{side[0].toUpperCase() + side.slice(1)}</small>
                      <NumberInput
                        value={marginsOf(mainText.box)[side]}
                        min={0}
                        max={side === 'top' || side === 'bottom' ? 90 : 45}
                        step={1}
                        suffix="%"
                        onChange={(v) => setMargin(side, v)}
                      />
                    </span>
                  ))}
                </Row>
              </fieldset>
            )}

            <fieldset>
              <legend>Background</legend>
              <Row label="Type">
                <Segmented
                  value={style.background.kind}
                  options={[
                    { value: 'solid', label: 'Solid' },
                    { value: 'gradient', label: 'Gradient' },
                    { value: 'image', label: 'Image' },
                    { value: 'video', label: 'Video' },
                    { value: 'smoke', label: 'Smoke' },
                  ]}
                  onChange={setBackgroundKind}
                />
              </Row>
              {style.background.kind === 'solid' && (
                <Row label="Color">
                  <Color value={style.background.color} onChange={(color) => update({ background: { kind: 'solid', color } })} />
                </Row>
              )}
              {style.background.kind === 'gradient' &&
                (() => {
                  const g = style.background
                  return (
                    <Row label="Gradient">
                      <Color value={g.from} onChange={(from) => update({ background: { ...g, from } })} />
                      <Color value={g.to} onChange={(to) => update({ background: { ...g, to } })} />
                      <Range value={g.angle} min={0} max={360} step={5} format={(v) => `${v}°`} onChange={(angle) => update({ background: { ...g, angle } })} />
                    </Row>
                  )
                })()}
              {style.background.kind === 'smoke' &&
                (() => {
                  const b = style.background
                  return (
                    <Row label="Smoke">
                      <Color value={b.color} onChange={(color) => update({ background: { ...b, color } })} />
                      <Color value={b.smoke} onChange={(smoke) => update({ background: { ...b, smoke } })} />
                    </Row>
                  )
                })()}
              {(style.background.kind === 'image' || style.background.kind === 'video') &&
                (() => {
                  const kind = style.background.kind
                  return (
                    <Row label={kind === 'image' ? 'Image' : 'Video'}>
                      <small className="media-name">{mediaName(style.background.src)}</small>
                      <button type="button" className="button" onClick={() => setPicking(kind)}>
                        Choose from library…
                      </button>
                    </Row>
                  )
                })()}
              <Row label="Darken">
                <Range value={style.overlay} min={0} max={0.9} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(overlay) => update({ overlay })} />
              </Row>
            </fieldset>

            {caption &&
              (() => {
                const c = caption.text
                return (
                  <fieldset>
                    <legend>Reference and copyright line</legend>
                    <Row label="Font">
                      <FontPicker
                        value={c.fontFamily}
                        emptyLabel="Same as text"
                        onChange={(fontFamily) => updateCaption({ fontFamily })}
                      />
                      <select className="input" value={c.fontWeight} onChange={(e) => updateCaption({ fontWeight: Number(e.target.value) })}>
                        {WEIGHTS.map((w) => (
                          <option key={w} value={w}>
                            {w}
                          </option>
                        ))}
                      </select>
                    </Row>
                    <Row label="Size">
                      <NumberInput value={c.fontSize} min={1} max={15} step={0.2} suffix="% of height" onChange={(size) => updateCaption({ fontSize: size })} />
                    </Row>
                    <Row label="Color">
                      <Color value={c.color} onChange={(color) => updateCaption({ color })} />
                      <label className="inline-check">
                        <input type="checkbox" checked={c.italic} onChange={(e) => updateCaption({ italic: e.target.checked })} />
                        Italic
                      </label>
                    </Row>
                    <Row label="Position">
                      <Segmented
                        value={caption.attached ? 'below' : 'box'}
                        options={[
                          { value: 'below', label: 'Under the text' },
                          { value: 'box', label: 'Own box' },
                        ]}
                        onChange={(position) => setCaptionAttached(position === 'below')}
                      />
                    </Row>
                    <Row label="Case">
                      <select className="input" value={c.textCase} onChange={(e) => updateCaption({ textCase: e.target.value as TextCase })}>
                        {CASES.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </Row>
                  </fieldset>
                )
              })()}
          </div>
        )}
      </div>

      {picking && (
        <MediaPickerModal
          kind={picking}
          onPick={(item) => {
            update({ background: item.kind === 'video' ? { kind: 'video', src: item.url } : { kind: 'image', src: item.url } })
            setPicking(null)
          }}
          onCancel={() => setPicking(null)}
        />
      )}
    </section>
  )
}

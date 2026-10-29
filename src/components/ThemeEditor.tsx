import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { replaceThemeFont, themeFonts } from '../../shared/fonts'
import { THEME_CONTENT_TYPES } from '../../shared/themes'
import { themeForContent } from '../../shared/textAreas'
import type { TextAreaContent, Theme, ThemeBackground, ThemeBox, ThemeContentType, ThemeElement, ThemeStyle, ThemeTextElement, ThemeTextProps } from '../../shared/types'
import { reportError, type ErrorLike } from '../lib/errors'
import { selectBaseThemeId, useOperatorStore } from '../store'
import { openSendMenu, setShareDrag } from '../lib/sharing'
import { clampBox } from '../lib/themeLayout'
import { MissingFontChips } from './FontPicker'
import { FormatToolbar, type FormatControl, type FormatPatch, type FormatState } from './FormatToolbar'
import { MediaPickerModal } from './MediaGrid'
import { ErrorNote, SegmentedControl, Select } from './ui'
import { TextAreaFields, TextAreaStage } from './TextAreaEditor'
import { ThemedSlide } from './ThemedSlide'
import { CONTENT_COLORS } from '../styles/contentColors'

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

/** What undo and redo step through in the text area editor. */
type AreaSnapshot = Pick<ThemeStyle, 'textAreas' | 'referencePlacement'>
const UNDO_LIMIT = 100

/** The sample that shows a text area's content in the preview. */
const SAMPLE_FOR: Record<TextAreaContent, keyof typeof SAMPLES> = { scripture: 'scripture', song: 'song' }

const CONTENT_LABELS: Record<ThemeContentType, string> = { song: 'Songs', scripture: 'Scripture', announcement: 'Announcements', quote: 'Quotes', lowerThird: 'Lower thirds', logo: 'Logos' }
const WEIGHTS = [300, 400, 500, 600, 700, 800, 900]

/** A theme's text box has one look for all its words, so the toolbar's per-word controls do not apply. */
const BOX_CONTROLS_OFF: FormatControl[] = ['strike', 'highlight', 'size', 'justify', 'clear']

/** The toolbar's view of a text box's look. */
function boxFormat(t: ThemeTextProps): FormatState {
  return {
    bold: t.fontWeight >= 600,
    italic: t.italic,
    underline: t.underline,
    strike: false,
    color: t.color,
    highlight: null,
    font: t.fontFamily,
    size: null,
    textCase: t.textCase,
    align: t.align,
    verticalAlign: t.verticalAlign,
    lineHeight: t.lineHeight,
  }
}

/** A toolbar change as a change to a text box's look. `emptyFont` is whether the box may have no font of its own. */
function boxPatch(patch: FormatPatch, t: ThemeTextProps, emptyFont: boolean): Partial<ThemeTextProps> {
  const next: Partial<ThemeTextProps> = {}
  if (patch.bold !== undefined) next.fontWeight = patch.bold ? Math.max(700, t.fontWeight) : 400
  if (patch.italic !== undefined) next.italic = patch.italic === true
  if (patch.underline !== undefined) next.underline = patch.underline === true
  if (patch.color) next.color = patch.color
  if (patch.font !== undefined && (patch.font || emptyFont)) next.fontFamily = patch.font ?? ''
  if (patch.textCase !== undefined) next.textCase = patch.textCase ?? 'normal'
  if (patch.align && patch.align !== 'justify') next.align = patch.align
  if (patch.verticalAlign) next.verticalAlign = patch.verticalAlign
  if (typeof patch.lineHeight === 'number') next.lineHeight = patch.lineHeight
  return next
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
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

export function Range(props: { value: number; min: number; max: number; step: number; onChange(value: number): void; format(value: number): string }) {
  return (
    <>
      <input type="range" value={props.value} min={props.min} max={props.max} step={props.step} onChange={(e) => props.onChange(Number(e.target.value))} />
      <small className="range-value">{props.format(props.value)}</small>
    </>
  )
}

/** The theme forms' choice of a few; its Row names the group. */
export function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange(value: T): void }) {
  return <SegmentedControl value={props.value} options={props.options} onChange={props.onChange} />
}

export const Color = ({ value, onChange }: { value: string; onChange(value: string): void }) => (
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
  const [error, setError] = useState<ErrorLike | null>(null)

  async function setDefault(type: ThemeContentType, id: number) {
    try {
      await window.api.themes.setDefault(type, id)
      await loadThemes()
      setError(null)
    } catch (err) {
      setError(reportError('Themes', err))
    }
  }

  return (
    <div className="theme-defaults">
      {THEME_CONTENT_TYPES.map((type) => (
        <label key={type} className="field">
          <span>Default for {CONTENT_LABELS[type].toLowerCase()}</span>
          <Select value={defaults?.[type] ?? ''} onChange={(e) => setDefault(type, Number(e.target.value))}>
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </label>
      ))}
      <ErrorNote error={error} />
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
  const [error, setError] = useState<ErrorLike | null>(null)
  /** Which kind of background the library picker is open for. */
  const [picking, setPicking] = useState<'image' | 'video' | null>(null)
  /** Which text area the rectangle over the preview edits. */
  const [area, setArea] = useState<TextAreaContent>('song')
  const [lockAspect, setLockAspect] = useState(false)
  /** Text area changes to undo and redo, for the theme being edited. */
  const history = useRef<{ past: AreaSnapshot[]; future: AreaSnapshot[] }>({ past: [], future: [] })
  const [, setHistoryVersion] = useState(0)
  const styleRef = useRef(style)
  styleRef.current = style

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
      history.current = { past: [], future: [] }
      setHistoryVersion((v) => v + 1)
      if (theme.style.category === 'scripture' || theme.style.category === 'song') chooseArea(theme.style.category)
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
      setError(reportError('Themes', err))
    }
  }

  function select(id: number) {
    if (id === selectedId) return
    if (dirty && !window.confirm(`Discard your changes to ${selected?.name}?`)) return
    setSelectedId(id)
  }

  const update = (patch: Partial<ThemeStyle>) => setStyle((s) => s && { ...s, ...patch })

  function chooseArea(content: TextAreaContent) {
    setArea(content)
    setSample(SAMPLE_FOR[content])
  }

  const snapshotOf = (s: ThemeStyle): AreaSnapshot => ({ textAreas: s.textAreas, referencePlacement: s.referencePlacement })
  /** Marks where an undo of the next text area change goes back to. */
  function beginAreaChange() {
    const current = styleRef.current
    if (!current) return
    const { past } = history.current
    history.current = { past: [...past.slice(-(UNDO_LIMIT - 1)), snapshotOf(current)], future: [] }
    setHistoryVersion((v) => v + 1)
  }
  function stepHistory(from: 'past' | 'future') {
    const current = styleRef.current
    const { past, future } = history.current
    const source = from === 'past' ? past : future
    const target = source[source.length - 1]
    if (!current || !target) return
    history.current =
      from === 'past' ? { past: past.slice(0, -1), future: [...future, snapshotOf(current)] } : { past: [...past, snapshotOf(current)], future: future.slice(0, -1) }
    setHistoryVersion((v) => v + 1)
    setStyle({ ...current, textAreas: target.textAreas, referencePlacement: target.referencePlacement })
  }
  const setAreaBox = (box: ThemeBox) => setStyle((s) => (s?.textAreas ? { ...s, textAreas: { ...s.textAreas, [area]: box } } : s))
  function setReferencePlacement(referencePlacement: 'inside' | 'below') {
    beginAreaChange()
    update({ referencePlacement })
  }
  /** Cmd+Z undoes a text area change, Shift+Cmd+Z (or Ctrl+Y) redoes it, while the text area editor has focus. */
  function handleAreaKeys(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return
    const key = e.key.toLowerCase()
    if (key === 'z' || key === 'y') {
      e.preventDefault()
      stepHistory(key === 'y' || e.shiftKey ? 'future' : 'past')
    }
  }

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
    const color = current.kind === 'solid' || current.kind === 'smoke' ? current.color : current.kind === 'gradient' ? current.from : CONTENT_COLORS.black
    if (kind === 'solid') update({ background: { kind, color } })
    else if (kind === 'gradient') update({ background: { kind, from: color, to: CONTENT_COLORS.gradientEnd, angle: 160 } })
    else if (kind === 'smoke') update({ background: { kind, color, smoke: CONTENT_COLORS.smoke } })
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
              <button
                className={`theme-list-item${t.id === selectedId ? ' selected' : ''}`}
                onClick={() => select(t.id)}
                // Built-in themes are on every computer already; custom ones can be sent.
                draggable={t.type === 'custom'}
                onDragStart={(e) => setShareDrag(e, { type: 'theme', id: t.id })}
                onContextMenu={t.type === 'custom' ? (e) => openSendMenu(e, [{ type: 'theme', id: t.id }]) : undefined}
              >
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
            {style.textAreas ? (
              (() => {
                const areas = style.textAreas
                const reference = style.elements.find((e) => e.kind === 'reference')
                const placement = style.referencePlacement ?? (reference && 'attached' in reference && reference.attached ? 'inside' : 'own')
                const { past, future } = history.current
                return (
                  <div className="text-area-editor" role="group" aria-label="Text area" onKeyDown={handleAreaKeys}>
                    <div className="text-area-toolbar">
                      <SegmentedControl<TextAreaContent>
                        aria-label="Text area for"
                        value={area}
                        options={[
                          { value: 'scripture', label: 'Scripture' },
                          { value: 'song', label: 'Songs' },
                        ]}
                        onChange={chooseArea}
                      />
                      <span className="hint">Where the words go for {area === 'scripture' ? 'scripture' : 'songs'}</span>
                      <span className="text-area-history">
                        <button type="button" className="button" disabled={past.length === 0} title="Undo (Cmd+Z)" onClick={() => stepHistory('past')}>
                          Undo
                        </button>
                        <button type="button" className="button" disabled={future.length === 0} title="Redo (Shift+Cmd+Z)" onClick={() => stepHistory('future')}>
                          Redo
                        </button>
                      </span>
                    </div>
                    <TextAreaStage area={areas[area]} content={area} lockAspect={lockAspect} onBegin={beginAreaChange} onChange={setAreaBox}>
                      <ThemedSlide theme={themeForContent(style, area)} text={SAMPLES[sample].text} caption={SAMPLES[sample].caption} />
                    </TextAreaStage>
                    <TextAreaFields
                      area={areas[area]}
                      lockAspect={lockAspect}
                      onLockAspect={setLockAspect}
                      onBegin={beginAreaChange}
                      onChange={setAreaBox}
                      onReset={() => {
                        if (!mainText) return
                        beginAreaChange()
                        setAreaBox(mainText.box)
                      }}
                    />
                    {area === 'scripture' && reference && (
                      <Row label="Reference">
                        <SegmentedControl<'inside' | 'below' | 'own'>
                          value={placement}
                          options={[
                            { value: 'inside', label: 'Inside the area' },
                            { value: 'below', label: 'Below the area' },
                          ]}
                          onChange={(value) => value !== 'own' && setReferencePlacement(value)}
                        />
                        {placement === 'own' && <small className="hint">Now in its own box; choose one to tie it to the text area.</small>}
                      </Row>
                    )}
                  </div>
                )
              })()
            ) : (
              <div className="theme-preview">
                <ThemedSlide theme={style} text={SAMPLES[sample].text} caption={SAMPLES[sample].caption} />
              </div>
            )}
            <Segmented<keyof typeof SAMPLES>
              value={sample}
              options={Object.entries(SAMPLES).map(([value, s]) => ({ value: value as keyof typeof SAMPLES, label: s.label }))}
              onChange={(value) => {
                setSample(value)
                // The rectangle edits the area the sample shows.
                setArea(value === 'scripture' ? 'scripture' : 'song')
              }}
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
            <ErrorNote error={error} />
            <MissingFontChips values={themeFonts(style)} onReplace={(from, to) => setStyle((s) => s && replaceThemeFont(s, from, to))} />

            {mainText &&
              (() => {
                const t = mainText.text
                return (
                  <fieldset>
                    <legend>Text</legend>
                    <FormatToolbar state={boxFormat(t)} inherit={false} disabled={BOX_CONTROLS_OFF} onChange={(patch) => updateText(boxPatch(patch, t, false))} />
                    <Row label="Weight">
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
                    <Row label="Line spacing">
                      <Range value={t.lineHeight} min={0.8} max={2.5} step={0.05} format={(v) => v.toFixed(2)} onChange={(lineHeight) => updateText({ lineHeight })} />
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
                <legend>{style.textAreas ? 'Text box for announcements and quotes' : 'Safe area'}</legend>
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
                    <FormatToolbar
                      state={boxFormat(c)}
                      inherit={false}
                      disabled={BOX_CONTROLS_OFF}
                      fontEmptyLabel="Same as text"
                      onChange={(patch) => updateCaption(boxPatch(patch, c, true))}
                    />
                    <Row label="Weight">
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

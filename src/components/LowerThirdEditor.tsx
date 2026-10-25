import { Copy, FilePlus, Image, Save, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { normalizeLowerThirdStyle } from '../../shared/lowerThirds'
import type { LowerThirdBox, LowerThirdStyle, LowerThirdTemplate, LowerThirdTextStyle, TextCase } from '../../shared/types'
import { useOperatorStore } from '../store'
import { LowerThirdGraphic } from './LowerThird'
import { FontPicker, MissingFontChips } from './FontPicker'

const WEIGHTS = [300, 400, 500, 600, 700, 800, 900]
const CASES: { value: TextCase; label: string }[] = [
  { value: 'normal', label: 'As typed' },
  { value: 'upper', label: 'UPPERCASE' },
  { value: 'lower', label: 'lowercase' },
]

/** The parts that can be dragged and resized: the frame on the screen, the others inside the frame. */
type Part = 'frame' | 'headline' | 'body' | 'logo'

const PART_LABELS: Record<Part, string> = { frame: 'Bar', headline: 'Headline', body: 'Body', logo: 'Logo' }

function boxOf(style: LowerThirdStyle, part: Part): LowerThirdBox {
  return part === 'frame' ? style.frame : part === 'logo' ? style.logo.box : style[part].box
}

function withBox(style: LowerThirdStyle, part: Part, box: LowerThirdBox): LowerThirdStyle {
  if (part === 'frame') return { ...style, frame: box }
  if (part === 'logo') return { ...style, logo: { ...style.logo, box } }
  return { ...style, [part]: { ...style[part], box } }
}

/** A part's box in percent of the screen, for drawing its handle over the preview. */
function screenBox(style: LowerThirdStyle, part: Part): LowerThirdBox {
  const box = boxOf(style, part)
  if (part === 'frame') return box
  const { frame } = style
  return {
    x: frame.x + (box.x * frame.width) / 100,
    y: frame.y + (box.y * frame.height) / 100,
    width: (box.width * frame.width) / 100,
    height: (box.height * frame.height) / 100,
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const round = (value: number) => Math.round(value * 10) / 10

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="lt-editor-group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  )
}

function TextFields({ label, field, onChange }: { label: string; field: LowerThirdTextStyle; onChange: (patch: Partial<LowerThirdTextStyle>) => void }) {
  return (
    <Group title={label}>
      <div className="lt-editor-row">
        <FontPicker value={field.fontFamily} onChange={(fontFamily) => fontFamily && onChange({ fontFamily })} />
        <select className="input" aria-label={`${label} weight`} value={field.fontWeight} onChange={(e) => onChange({ fontWeight: Number(e.target.value) })}>
          {WEIGHTS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
        <input type="color" aria-label={`${label} color`} value={field.color} onChange={(e) => onChange({ color: e.target.value })} />
      </div>
      <MissingFontChips values={[field.fontFamily]} onReplace={(_from, fontFamily) => onChange({ fontFamily })} />
      <label className="stream-slider">
        <span>Size</span>
        <input type="range" min={1} max={20} step={0.1} value={field.size} onChange={(e) => onChange({ size: Number(e.target.value) })} />
        <span className="hint">{field.size.toFixed(1)}</span>
      </label>
      <div className="lt-editor-row">
        <select className="input" aria-label={`${label} case`} value={field.textCase} onChange={(e) => onChange({ textCase: e.target.value as TextCase })}>
          {CASES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <label className="inline-check">
          <input type="checkbox" checked={field.italic} onChange={(e) => onChange({ italic: e.target.checked })} />
          Italic
        </label>
        <label className="alerts-number">
          Max lines
          <input className="input" type="number" min={1} max={4} value={field.maxLines} onChange={(e) => onChange({ maxLines: clamp(Number(e.target.value) || 1, 1, 4) })} />
        </label>
      </div>
    </Group>
  )
}

/**
 * Lower third templates: pick one, drag and resize its bar, text boxes and logo over the key color, set colors and
 * fonts, and save. Built-in templates are read only; Save as new or Duplicate makes an editable copy.
 */
export function LowerThirdEditor({ onClose }: { onClose: () => void }) {
  const templates = useOperatorStore((s) => s.lowerThirdTemplates)
  const loadTemplates = useOperatorStore((s) => s.loadLowerThirdTemplates)
  const settings = useOperatorStore((s) => s.settings)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const typed = useOperatorStore((s) => s.lowerThirdDraft)
  const inUse = templates.find((t) => t.id === settings.lowerThirdTemplateId) ?? templates[0]
  const [selectedId, setSelectedId] = useState<number | null>(inUse?.id ?? null)
  const selected = templates.find((t) => t.id === selectedId) ?? null
  const [name, setName] = useState(selected?.name ?? '')
  const [style, setStyle] = useState<LowerThirdStyle | null>(selected?.style ?? null)
  const [sample, setSample] = useState({
    headline: typed.headline.trim() || 'Pastor Sam Example',
    body: typed.body.trim() || 'Lead Pastor · Grace Community Church',
  })
  const [error, setError] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ part: Part; resize: boolean; startX: number; startY: number; start: LowerThirdBox } | null>(null)
  const dirty = selected !== null && style !== null && (name !== selected.name || JSON.stringify(style) !== JSON.stringify(selected.style))
  const custom = selected?.type === 'custom'

  // Pick up the template when another one is chosen or it was saved.
  useEffect(() => {
    if (!selected) return
    setName(selected.name)
    setStyle(selected.style)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the stored template changes
  }, [selected?.id, selected?.name, JSON.stringify(selected?.style)])

  useEffect(() => {
    // Escape in the font list closes just the list.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !drag.current && !(e.target as HTMLElement | null)?.closest?.('.font-picker') && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function run(action: () => Promise<void>) {
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /** A name no template has yet, from `base`. */
  function freeName(base: string): string {
    const names = new Set(templates.map((t) => t.name))
    if (!names.has(base)) return base
    for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`
  }

  const create = (templateName: string, templateStyle: LowerThirdStyle) =>
    run(async () => {
      const created: LowerThirdTemplate = await window.api.lowerThirds.create(freeName(templateName.trim() || 'Lower third'), templateStyle)
      await loadTemplates()
      setSelectedId(created.id)
    })

  const saveChanges = () =>
    run(async () => {
      if (!selected || !style) return
      await window.api.lowerThirds.update(selected.id, name.trim() || selected.name, style)
      await loadTemplates()
    })

  const remove = () =>
    run(async () => {
      if (!selected || !custom) return
      await window.api.lowerThirds.delete(selected.id)
      await loadTemplates()
      setSelectedId(useOperatorStore.getState().lowerThirdTemplates[0]?.id ?? null)
    })

  const update = (patch: Partial<LowerThirdStyle>) => setStyle((s) => s && normalizeLowerThirdStyle({ ...s, ...patch }))
  const updateText = (part: 'headline' | 'body') => (patch: Partial<LowerThirdTextStyle>) => setStyle((s) => s && normalizeLowerThirdStyle({ ...s, [part]: { ...s[part], ...patch } }))

  function startDrag(e: ReactPointerEvent<HTMLElement>, part: Part, resize: boolean) {
    if (!style) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { part, resize, startX: e.clientX, startY: e.clientY, start: boxOf(style, part) }
  }

  function moveDrag(e: ReactPointerEvent<HTMLElement>) {
    const d = drag.current
    const stage = stageRef.current?.getBoundingClientRect()
    if (!d || !stage || !style) return
    // Screen percent, then frame percent for the parts inside the frame.
    let dx = ((e.clientX - d.startX) / stage.width) * 100
    let dy = ((e.clientY - d.startY) / stage.height) * 100
    if (d.part !== 'frame') {
      dx = (dx / style.frame.width) * 100
      dy = (dy / style.frame.height) * 100
    }
    const { x, y, width, height } = d.start
    const box = d.resize
      ? { x, y, width: round(clamp(width + dx, 2, 100 - x)), height: round(clamp(height + dy, 2, 100 - y)) }
      : { x: round(clamp(x + dx, 0, 100 - width)), y: round(clamp(y + dy, 0, 100 - height)), width, height }
    setStyle(withBox(style, d.part, box))
  }

  const endDrag = () => {
    drag.current = null
  }

  const keyColor = settings.streamKeyMode === 'luma' ? '#000000' : settings.streamKeyColor
  const parts: Part[] = style?.logo.enabled ? ['frame', 'logo', 'headline', 'body'] : ['frame', 'headline', 'body']

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal lt-editor" role="dialog" aria-label="Lower third templates" onMouseDown={(e) => e.stopPropagation()}>
        <header className="lt-editor-header">
          <h2>Lower third templates</h2>
          <select className="input" aria-label="Template" value={selectedId ?? ''} onChange={(e) => setSelectedId(Number(e.target.value))}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.type === 'builtin' ? ' (built in)' : ''}
                {t.id === inUse?.id ? ' · in use' : ''}
              </option>
            ))}
          </select>
          <button type="button" className="icon-button" aria-label="Close" title="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        {style && (
          <>
            <div className="lt-editor-stage" ref={stageRef} style={{ background: keyColor }}>
              <div className="overlay-layers">
                <div className="lower-third-layer">
                  <LowerThirdGraphic style={style} headline={sample.headline} body={sample.body} />
                </div>
              </div>
              <div className="lt-handles">
                {parts.map((part) => {
                  const box = screenBox(style, part)
                  return (
                    <div
                      key={part}
                      className={`lt-handle ${part}`}
                      style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%` }}
                      title={`Drag to move the ${PART_LABELS[part].toLowerCase()}`}
                      onPointerDown={(e) => startDrag(e, part, false)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                    >
                      <span className="lt-handle-label">{PART_LABELS[part]}</span>
                      <span
                        className="lt-handle-resize"
                        title="Drag to resize"
                        onPointerDown={(e) => startDrag(e, part, true)}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="lt-editor-row">
              <input className="input" aria-label="Sample headline" value={sample.headline} onChange={(e) => setSample((s) => ({ ...s, headline: e.target.value }))} />
              <input className="input" aria-label="Sample body" value={sample.body} onChange={(e) => setSample((s) => ({ ...s, body: e.target.value }))} />
            </div>
            <p className="hint">Try a long line here: text shrinks to fit its box within its line count, so it never spills off the bar.</p>

            <div className="lt-editor-grid">
              <Group title="Bar">
                <div className="lt-editor-row">
                  <label className="inline-check">
                    <input type="checkbox" checked={style.bar.enabled} onChange={(e) => update({ bar: { ...style.bar, enabled: e.target.checked } })} />
                    Solid bar
                  </label>
                  <input type="color" aria-label="Bar color" value={style.bar.color} onChange={(e) => update({ bar: { ...style.bar, color: e.target.value } })} />
                </div>
                <div className="lt-editor-row">
                  <label className="inline-check">
                    <input type="checkbox" checked={style.accent.enabled} onChange={(e) => update({ accent: { ...style.accent, enabled: e.target.checked } })} />
                    Accent stripe
                  </label>
                  <input type="color" aria-label="Accent color" value={style.accent.color} onChange={(e) => update({ accent: { ...style.accent, color: e.target.value } })} />
                  <select
                    className="input"
                    aria-label="Accent side"
                    value={style.accent.side}
                    onChange={(e) => update({ accent: { ...style.accent, side: e.target.value as LowerThirdStyle['accent']['side'] } })}
                  >
                    <option value="left">Left</option>
                    <option value="top">Top</option>
                    <option value="bottom">Bottom</option>
                  </select>
                </div>
                <label className="stream-slider">
                  <span>Stripe</span>
                  <input type="range" min={0.5} max={30} step={0.5} value={style.accent.size} onChange={(e) => update({ accent: { ...style.accent, size: Number(e.target.value) } })} />
                  <span className="hint">{style.accent.size}%</span>
                </label>
              </Group>

              <Group title="Logo and layout">
                <div className="lt-editor-row">
                  <label className="inline-check">
                    <input type="checkbox" checked={style.logo.enabled} onChange={(e) => update({ logo: { ...style.logo, enabled: e.target.checked } })} />
                    Small logo
                  </label>
                  {style.logo.url && <img className="stream-logo-thumb" src={style.logo.url} alt="" />}
                  <button
                    type="button"
                    className="button"
                    onClick={() =>
                      run(async () => {
                        const picked = await window.api.stream.pickLogo()
                        if (picked) update({ logo: { ...style.logo, enabled: true, url: picked.url } })
                      })
                    }
                  >
                    <Image size={14} aria-hidden="true" /> Choose…
                  </button>
                </div>
                <span className="segmented" role="radiogroup" aria-label="Alignment">
                  {(['left', 'center', 'right'] as const).map((align) => (
                    <button key={align} type="button" role="radio" aria-checked={style.align === align} className={style.align === align ? 'active' : ''} onClick={() => update({ align })}>
                      {align === 'left' ? 'Left' : align === 'center' ? 'Centre' : 'Right'}
                    </button>
                  ))}
                </span>
                <div className="lt-editor-row">
                  <label className="inline-check">
                    <input type="checkbox" checked={style.outline.enabled} onChange={(e) => update({ outline: { ...style.outline, enabled: e.target.checked } })} />
                    Text outline
                  </label>
                  <input type="color" aria-label="Outline color" value={style.outline.color} onChange={(e) => update({ outline: { ...style.outline, color: e.target.value } })} />
                  <input
                    type="range"
                    aria-label="Outline width"
                    min={0.01}
                    max={0.15}
                    step={0.01}
                    value={style.outline.width}
                    onChange={(e) => update({ outline: { ...style.outline, width: Number(e.target.value) } })}
                  />
                </div>
              </Group>

              <TextFields label="Headline" field={style.headline} onChange={updateText('headline')} />
              <TextFields label="Body" field={style.body} onChange={updateText('body')} />
            </div>
          </>
        )}

        {error && <p className="error">{error}</p>}

        <footer className="modal-actions lt-editor-actions">
          <input className="input" aria-label="Template name" value={name} disabled={!custom} onChange={(e) => setName(e.target.value)} />
          {custom && (
            <button type="button" className="button" onClick={remove}>
              <Trash2 size={14} aria-hidden="true" /> Delete
            </button>
          )}
          <button type="button" className="button" disabled={!selected} onClick={() => selected && create(`${selected.name} copy`, selected.style)} title="A copy of the template as saved">
            <Copy size={14} aria-hidden="true" /> Duplicate
          </button>
          <button type="button" className="button" disabled={!style} onClick={() => style && create(custom ? name : `${name} custom`, style)} title="A new template with these changes">
            <FilePlus size={14} aria-hidden="true" /> Save as new
          </button>
          {custom && (
            <button type="button" className="button" disabled={!dirty} onClick={saveChanges}>
              <Save size={14} aria-hidden="true" /> Save
            </button>
          )}
          <button
            type="button"
            className="button primary"
            disabled={!selected || selected.id === inUse?.id}
            onClick={() => selected && run(() => updateSettings({ lowerThirdTemplateId: selected.id }))}
          >
            Use this template
          </button>
        </footer>
        {!custom && dirty && <p className="hint">Built-in templates cannot be changed: Save as new keeps your changes as a new template.</p>}
      </div>
    </div>
  )
}

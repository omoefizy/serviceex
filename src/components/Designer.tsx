import {
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Eye,
  EyeOff,
  FilePlus,
  Image as ImageIcon,
  Lock,
  ListOrdered,
  Minus,
  Play,
  Redo2,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
  Unlock,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { DESIGN_EASINGS, DESIGN_MOTIONS, designTimeline, MOTION_LIMITS, type AnimationPhase } from '../../shared/designAnimation'
import { BRAND, KIND_NAMES, newDesignElement, normalizeDesign } from '../../shared/designs'
import type {
  Design,
  DesignBackground,
  DesignCategory,
  DesignEasing,
  DesignElement,
  DesignElementAnimation,
  DesignElementKind,
  DesignFill,
  DesignLoop,
  DesignMotion,
  DesignMotionStep,
  DesignShadow,
  DesignStyle,
  DesignTextField,
  TextCase,
} from '../../shared/types'
import {
  ASPECT,
  HANDLES,
  commitFrom,
  copiesOf,
  designTargets,
  moveDesignBoxes,
  moveToIndex,
  preview,
  record,
  redo,
  resizeDesignBox,
  rotationToward,
  roundBox,
  startHistory,
  undo,
  type Guide,
  type Handle,
  type History,
} from '../lib/designLayout'
import { reportError, type ErrorLike } from '../lib/errors'
import { MOD } from '../lib/shortcuts'
import { DesignView } from './DesignView'
import { FontPicker, MissingFontChips } from './FontPicker'
import { ErrorNote } from './ui'

/** Arrow keys move by a tenth of a percent of the canvas; with Shift, ten times as far. */
const NUDGE = 0.1
/** How far each paste lands from the last, in percent. */
const PASTE_OFFSET = 2
/** Two presses on text this close together edit it. */
const DOUBLE_CLICK_MS = 400
/** How long Play holds the design on screen between its way in and its way out. */
const PLAY_HOLD_MS = 1500

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900]
const CASES: { value: TextCase; label: string }[] = [
  { value: 'normal', label: 'As typed' },
  { value: 'upper', label: 'UPPERCASE' },
  { value: 'lower', label: 'lowercase' },
]
const FIELD_LABELS: Record<DesignTextField, string> = { headline: 'Headline', body: 'Body', number: 'Number' }
const KIND_ICONS: Record<DesignElementKind, ReactNode> = {
  text: <Type size={14} aria-hidden="true" />,
  rect: <Square size={14} aria-hidden="true" />,
  line: <Minus size={14} aria-hidden="true" />,
  image: <ImageIcon size={14} aria-hidden="true" />,
}

/** Elements copied in any designer, for paste in this one or another design. */
let clipboard: DesignElement[] = []

const newId = () => crypto.randomUUID().slice(0, 8)

/** What the designer opens: a saved design, or an unsaved one (id null) such as a new design or a lower third template. */
export interface DesignerDocument {
  id: number | null
  name: string
  type: Design['type']
  style: DesignStyle
}

type Drag =
  | { kind: 'move'; x: number; y: number; ids: string[]; before: DesignStyle }
  | { kind: 'resize'; x: number; y: number; id: string; handle: Handle; before: DesignStyle }
  | { kind: 'rotate'; id: string; centre: { x: number; y: number }; before: DesignStyle }

// ---------- Inspector fields ----------

function NumberField({ label, value, onChange, step = 0.1, min, max, suffix }: {
  label: string
  value: number
  onChange(value: number): void
  step?: number
  min?: number
  max?: number
  suffix?: string
}) {
  // What is typed is kept while the field has focus, so "-" or "1." can be typed on the way to a number.
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className="designer-number">
      <span>{label}</span>
      <input
        className="input"
        type="number"
        step={step}
        min={min}
        max={max}
        value={draft ?? String(Math.round(value * 100) / 100)}
        onChange={(e) => {
          setDraft(e.target.value)
          const n = parseFloat(e.target.value)
          if (Number.isFinite(n)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)))
        }}
        onBlur={() => setDraft(null)}
      />
      {suffix && <span className="hint">{suffix}</span>}
    </label>
  )
}

function Slider({ label, value, onChange, min, max, step, format }: {
  label: string
  value: number
  onChange(value: number): void
  min: number
  max: number
  step: number
  format?: (value: number) => string
}) {
  return (
    <label className="stream-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="hint">{format ? format(value) : value}</span>
    </label>
  )
}

function Color({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  return <input type="color" aria-label={label} title={label} value={value} onChange={(e) => onChange(e.target.value)} />
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="lt-editor-group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  )
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: ReactNode }[]; onChange(value: T): void }) {
  return (
    <span className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </span>
  )
}

function FillFields({ fill, onChange }: { fill: DesignFill; onChange(fill: DesignFill): void }) {
  return (
    <>
      <div className="lt-editor-row">
        <Segmented
          label="Fill"
          value={fill.kind}
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'gradient', label: 'Gradient' },
          ]}
          onChange={(kind) =>
            onChange(kind === 'solid' ? { kind, color: fill.kind === 'solid' ? fill.color : fill.from } : { kind, from: fill.kind === 'solid' ? fill.color : BRAND.blue, to: BRAND.navy, angle: 90 })
          }
        />
        {fill.kind === 'solid' ? (
          <Color label="Fill colour" value={fill.color} onChange={(color) => onChange({ ...fill, color })} />
        ) : (
          <>
            <Color label="Gradient start" value={fill.from} onChange={(from) => onChange({ ...fill, from })} />
            <Color label="Gradient end" value={fill.to} onChange={(to) => onChange({ ...fill, to })} />
          </>
        )}
      </div>
      {fill.kind === 'gradient' && <Slider label="Angle" min={0} max={360} step={1} value={fill.angle} onChange={(angle) => onChange({ ...fill, angle })} format={(v) => `${v}°`} />}
    </>
  )
}

function ShadowFields({ shadow, onChange }: { shadow: DesignShadow; onChange(shadow: DesignShadow): void }) {
  return (
    <>
      <div className="lt-editor-row">
        <label className="inline-check">
          <input type="checkbox" checked={shadow.enabled} onChange={(e) => onChange({ ...shadow, enabled: e.target.checked })} />
          Shadow
        </label>
        {shadow.enabled && <Color label="Shadow colour" value={shadow.color} onChange={(color) => onChange({ ...shadow, color })} />}
      </div>
      {shadow.enabled && (
        <>
          <Slider label="Strength" min={0} max={1} step={0.05} value={shadow.opacity} onChange={(opacity) => onChange({ ...shadow, opacity })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Blur" min={0} max={6} step={0.1} value={shadow.blur} onChange={(blur) => onChange({ ...shadow, blur })} />
          <div className="designer-fields">
            <NumberField label="X" value={shadow.x} min={-20} max={20} onChange={(x) => onChange({ ...shadow, x })} />
            <NumberField label="Y" value={shadow.y} min={-20} max={20} onChange={(y) => onChange({ ...shadow, y })} />
          </div>
        </>
      )}
    </>
  )
}

function BackgroundFields({ background, onChange, pickImage }: { background: DesignBackground; onChange(background: DesignBackground): void; pickImage(): Promise<string | null> }) {
  return (
    <Section title="Background">
      <select
        className="input"
        aria-label="Background"
        value={background.kind}
        onChange={async (e) => {
          const kind = e.target.value as DesignBackground['kind']
          if (kind === 'transparent') onChange({ kind })
          else if (kind === 'solid') onChange({ kind, color: BRAND.navy })
          else if (kind === 'gradient') onChange({ kind, from: BRAND.blue, to: BRAND.navy, angle: 135 })
          else {
            const src = await pickImage()
            if (src) onChange({ kind, src, fit: 'cover' })
          }
        }}
      >
        <option value="transparent">Transparent (lower third over the picture)</option>
        <option value="solid">Solid colour</option>
        <option value="gradient">Gradient</option>
        <option value="image">Image…</option>
      </select>
      {background.kind === 'solid' && <Color label="Background colour" value={background.color} onChange={(color) => onChange({ ...background, color })} />}
      {background.kind === 'gradient' && (
        <>
          <div className="lt-editor-row">
            <Color label="Gradient start" value={background.from} onChange={(from) => onChange({ ...background, from })} />
            <Color label="Gradient end" value={background.to} onChange={(to) => onChange({ ...background, to })} />
          </div>
          <Slider label="Angle" min={0} max={360} step={1} value={background.angle} onChange={(angle) => onChange({ ...background, angle })} format={(v) => `${v}°`} />
        </>
      )}
      {background.kind === 'image' && (
        <div className="lt-editor-row">
          <Segmented
            label="Image fit"
            value={background.fit}
            options={[
              { value: 'cover', label: 'Fill' },
              { value: 'contain', label: 'Fit' },
            ]}
            onChange={(fit) => onChange({ ...background, fit })}
          />
          <button
            type="button"
            className="button"
            onClick={async () => {
              const src = await pickImage()
              if (src) onChange({ ...background, src })
            }}
          >
            Change…
          </button>
        </div>
      )}
    </Section>
  )
}

const LOOPS: { value: DesignLoop; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'spin', label: 'Spin' },
  { value: 'pulse', label: 'Pulse' },
  { value: 'float', label: 'Float' },
  { value: 'shimmer', label: 'Shimmer' },
  { value: 'glow', label: 'Glow' },
]

const MOTION_LABELS: Record<DesignMotion, string> = {
  none: 'None',
  fade: 'Fade',
  slideLeft: 'Slide from left',
  slideRight: 'Slide from right',
  slideBottom: 'Slide from bottom',
  slideTop: 'Slide from top',
  wipe: 'Wipe',
  scale: 'Scale',
}
/** On the way out a slide goes toward its edge. */
const OUT_LABELS: Partial<Record<DesignMotion, string>> = { slideLeft: 'Slide to left', slideRight: 'Slide to right', slideBottom: 'Slide to bottom', slideTop: 'Slide to top' }
const EASING_LABELS: Record<DesignEasing, string> = { linear: 'Linear', ease: 'Ease', easeIn: 'Ease in', easeOut: 'Ease out', easeInOut: 'Ease in and out', back: 'Overshoot' }

/** One way in or out: the movement, then its timing once it has one. */
function MotionFields({ phase, step, onChange }: { phase: AnimationPhase; step: DesignMotionStep; onChange(step: DesignMotionStep, key: string): void }) {
  const set = <K extends keyof DesignMotionStep>(key: K) => (value: DesignMotionStep[K]) => onChange({ ...step, [key]: value }, key)
  return (
    <>
      <label className="designer-number">
        <span>{phase === 'in' ? 'In' : 'Out'}</span>
        <select className="input" aria-label={phase === 'in' ? 'In animation' : 'Out animation'} value={step.motion} onChange={(e) => set('motion')(e.target.value as DesignMotion)}>
          {DESIGN_MOTIONS.map((m) => (
            <option key={m} value={m}>
              {(phase === 'out' && OUT_LABELS[m]) || MOTION_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      {step.motion !== 'none' && (
        <div className="designer-fields">
          <NumberField label="Time" value={step.durationMs} step={50} min={MOTION_LIMITS.durationMs[0]} max={MOTION_LIMITS.durationMs[1]} onChange={(v) => set('durationMs')(Math.round(v))} suffix="ms" />
          <NumberField label="Delay" value={step.delayMs} step={50} min={0} max={MOTION_LIMITS.delayMs[1]} onChange={(v) => set('delayMs')(Math.round(v))} suffix="ms" />
          <label className="designer-number">
            <span>Easing</span>
            <select className="input" aria-label={`${phase === 'in' ? 'In' : 'Out'} easing`} value={step.easing} onChange={(e) => set('easing')(e.target.value as DesignEasing)}>
              {DESIGN_EASINGS.map((easing) => (
                <option key={easing} value={easing}>
                  {EASING_LABELS[easing]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </>
  )
}

/** The fields for the one selected element: its place, then what its kind has. */
function ElementFields({ element, onChange, pickImage }: { element: DesignElement; onChange(patch: Partial<DesignElement>, key: string): void; pickImage(): Promise<string | null> }) {
  // Each field is its own undo key, so a run of changes to one field undoes as one step.
  const set = <K extends string>(key: K) => (value: unknown) => onChange({ [key]: value } as Partial<DesignElement>, `${element.id}.${key}`)
  const setAnimation = (patch: Partial<DesignElementAnimation>, key: string) =>
    onChange({ animation: { ...element.animation, ...patch } }, `${element.id}.animation.${key}`)
  const setBox = (key: 'x' | 'y' | 'width' | 'height') => (value: number) =>
    onChange({ box: roundBox({ ...element.box, [key]: key === 'width' || key === 'height' ? Math.max(0.5, value) : value }) }, `${element.id}.box.${key}`)

  return (
    <>
      <Section title={KIND_NAMES[element.kind]}>
        <input className="input" aria-label="Layer name" value={element.name} onChange={(e) => set('name')(e.target.value)} />
        <div className="designer-fields">
          <NumberField label="X" value={element.box.x} onChange={setBox('x')} />
          <NumberField label="Y" value={element.box.y} onChange={setBox('y')} />
          <NumberField label="W" value={element.box.width} min={0.5} onChange={setBox('width')} />
          <NumberField label="H" value={element.box.height} min={0.5} onChange={setBox('height')} />
          <NumberField label="Rotate" value={element.rotation} step={1} min={-180} max={180} onChange={set('rotation')} suffix="°" />
        </div>
        <Slider label="Opacity" min={0} max={1} step={0.01} value={element.opacity} onChange={set('opacity')} format={(v) => `${Math.round(v * 100)}%`} />
      </Section>

      <Section title="Animation">
        <MotionFields phase="in" step={element.animation.in} onChange={(step, key) => setAnimation({ in: step }, `in.${key}`)} />
        <MotionFields phase="out" step={element.animation.out} onChange={(step, key) => setAnimation({ out: step }, `out.${key}`)} />
        <NumberField
          label="Order"
          value={element.animation.order}
          step={1}
          min={0}
          max={MOTION_LIMITS.order[1]}
          onChange={(order) => setAnimation({ order: Math.round(order) }, 'order')}
        />
        <p className="hint">Lower orders build first; the next order starts when they are done. On the way out the last in goes first.</p>
      </Section>

      <Section title="On air">
        <label className="designer-number">
          <span>Loop</span>
          <select className="input" aria-label="Loop" value={element.loop} onChange={(e) => set('loop')(e.target.value as DesignLoop)}>
            {LOOPS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-check" title="As part of the idle design, this fades out while a lower third is up, and back when it clears">
          <input type="checkbox" checked={element.hideWithLowerThird} onChange={(e) => set('hideWithLowerThird')(e.target.checked)} />
          Hide while a lower third is live
        </label>
        <p className="hint">Loops run on the outputs once the element is in; Spin on an idle logo turns forever. The hide option applies when this design is the idle design.</p>
      </Section>

      {element.kind === 'text' && (
        <>
          <Section title="Words">
            <textarea className="input designer-words" aria-label="Words" rows={3} value={element.text} onChange={(e) => set('text')(e.target.value)} />
            <label className="designer-number">
              <span>Fill with</span>
              <select className="input" value={element.field ?? ''} onChange={(e) => set('field')((e.target.value || null) as DesignTextField | null)}>
                <option value="">Nothing: always these words</option>
                {(Object.keys(FIELD_LABELS) as DesignTextField[]).map((f) => (
                  <option key={f} value={f}>
                    {FIELD_LABELS[f]} (these words are the sample)
                  </option>
                ))}
              </select>
            </label>
          </Section>
          <Section title="Font">
            <div className="lt-editor-row">
              <FontPicker value={element.fontFamily} onChange={set('fontFamily')} />
              <select className="input" aria-label="Weight" value={element.fontWeight} onChange={(e) => set('fontWeight')(Number(e.target.value))}>
                {WEIGHTS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
              <Color label="Text colour" value={element.color} onChange={set('color')} />
            </div>
            <MissingFontChips values={[element.fontFamily]} onReplace={(_from, fontFamily) => set('fontFamily')(fontFamily)} />
            <Slider label={element.autoFit ? 'Max size' : 'Size'} min={0.5} max={30} step={0.1} value={element.fontSize} onChange={set('fontSize')} format={(v) => v.toFixed(1)} />
            <div className="lt-editor-row">
              <label className="inline-check" title="Shrinks the words until they fit the box">
                <input type="checkbox" checked={element.autoFit} onChange={(e) => set('autoFit')(e.target.checked)} />
                Auto fit
              </label>
              <label className="inline-check">
                <input type="checkbox" checked={element.italic} onChange={(e) => set('italic')(e.target.checked)} />
                Italic
              </label>
              <select className="input" aria-label="Case" value={element.textCase} onChange={(e) => set('textCase')(e.target.value as TextCase)}>
                {CASES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="lt-editor-row">
              <Segmented
                label="Alignment"
                value={element.align}
                options={[
                  { value: 'left', label: 'Left' },
                  { value: 'center', label: 'Centre' },
                  { value: 'right', label: 'Right' },
                ]}
                onChange={set('align')}
              />
              <Segmented
                label="Vertical alignment"
                value={element.verticalAlign}
                options={[
                  { value: 'top', label: 'Top' },
                  { value: 'middle', label: 'Middle' },
                  { value: 'bottom', label: 'Bottom' },
                ]}
                onChange={set('verticalAlign')}
              />
            </div>
            <Slider label="Line height" min={0.6} max={3} step={0.05} value={element.lineHeight} onChange={set('lineHeight')} format={(v) => v.toFixed(2)} />
            <Slider label="Spacing" min={-0.2} max={1} step={0.01} value={element.letterSpacing} onChange={set('letterSpacing')} format={(v) => v.toFixed(2)} />
          </Section>
          <Section title="Effects">
            <ShadowFields shadow={element.shadow} onChange={set('shadow')} />
            <div className="lt-editor-row">
              <label className="inline-check">
                <input type="checkbox" checked={element.outline.enabled} onChange={(e) => set('outline')({ ...element.outline, enabled: e.target.checked })} />
                Outline
              </label>
              {element.outline.enabled && (
                <>
                  <Color label="Outline colour" value={element.outline.color} onChange={(color) => set('outline')({ ...element.outline, color })} />
                  <input type="range" aria-label="Outline width" min={0.01} max={0.3} step={0.01} value={element.outline.width} onChange={(e) => set('outline')({ ...element.outline, width: Number(e.target.value) })} />
                </>
              )}
            </div>
          </Section>
        </>
      )}

      {element.kind === 'rect' && (
        <Section title="Look">
          <FillFields fill={element.fill} onChange={set('fill')} />
          <Slider label="Corners" min={0} max={20} step={0.1} value={element.radius} onChange={set('radius')} format={(v) => v.toFixed(1)} />
          <div className="lt-editor-row">
            <Color label="Border colour" value={element.border.color} onChange={(color) => set('border')({ ...element.border, color })} />
            <input type="range" aria-label="Border width" title="Border width" min={0} max={3} step={0.05} value={element.border.width} onChange={(e) => set('border')({ ...element.border, width: Number(e.target.value) })} />
            <span className="hint">Border {element.border.width.toFixed(2)}</span>
          </div>
          <ShadowFields shadow={element.shadow} onChange={set('shadow')} />
        </Section>
      )}

      {element.kind === 'line' && (
        <Section title="Look">
          <div className="lt-editor-row">
            <Color label="Line colour" value={element.color} onChange={set('color')} />
            <label className="inline-check">
              <input type="checkbox" checked={element.dashed} onChange={(e) => set('dashed')(e.target.checked)} />
              Dashed
            </label>
          </div>
          <Slider label="Thickness" min={0.05} max={5} step={0.05} value={element.thickness} onChange={set('thickness')} format={(v) => v.toFixed(2)} />
        </Section>
      )}

      {element.kind === 'image' && (
        <Section title="Picture">
          <div className="lt-editor-row">
            {element.src && <img className="stream-logo-thumb" src={element.src} alt="" />}
            <button
              type="button"
              className="button"
              onClick={async () => {
                const src = await pickImage()
                if (src) set('src')(src)
              }}
            >
              <ImageIcon size={14} aria-hidden="true" /> {element.src ? 'Change…' : 'Choose…'}
            </button>
            <Segmented
              label="Image fit"
              value={element.fit}
              options={[
                { value: 'contain', label: 'Fit' },
                { value: 'cover', label: 'Fill' },
              ]}
              onChange={set('fit')}
            />
          </div>
          <Slider label="Corners" min={0} max={20} step={0.1} value={element.radius} onChange={set('radius')} format={(v) => v.toFixed(1)} />
        </Section>
      )}
    </>
  )
}

// ---------- The designer ----------

/**
 * The slide designer: a 16:9 canvas of text, rectangles, lines and images. Drag to move, the handles to resize and
 * the round handle to rotate; edges snap to the canvas and the other elements (hold Alt to place freely). Double-click
 * text to edit it in place. Arrow keys nudge, and the usual keys copy, paste, duplicate, delete, undo and redo.
 * Built-in designs are read only: Save as new keeps the changes as a new design.
 */
export function Designer({ document: doc, onClose, onSaved, page = false }: {
  document: DesignerDocument
  onClose(): void
  onSaved?(design: Design): void
  /** Drawn in place as a page of the operator screen (the Lower thirds workspace), not over it as a dialog. */
  page?: boolean
}) {
  const [history, setHistory] = useState<History<DesignStyle>>(() => startHistory(doc.style))
  const [name, setName] = useState(doc.name)
  const [saved, setSaved] = useState({ id: doc.id, type: doc.type, snapshot: doc.id === null ? '' : JSON.stringify([doc.name, doc.style]) })
  const [selected, setSelected] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [guides, setGuides] = useState<Guide[]>([])
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [error, setError] = useState<ErrorLike | null>(null)
  /** Play: the way in, a hold, then the way out; `run` remounts the canvas so each play starts afresh. */
  const [playing, setPlaying] = useState<{ phase: AnimationPhase; run: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const layerDragRef = useRef<string | null>(null)
  const pasteCount = useRef(0)
  const lastPress = useRef<{ id: string; at: number } | null>(null)

  const style = history.present
  const { elements } = style
  const selectedSet = new Set(selected)
  const picked = elements.filter((e) => selectedSet.has(e.id))
  const single = picked.length === 1 ? picked[0] : null
  const custom = saved.type === 'custom' && saved.id !== null
  const dirty = JSON.stringify([name, style]) !== saved.snapshot

  useEffect(() => rootRef.current?.focus(), [])

  // Play steps from the way in to the way out after a hold, then back to editing.
  useEffect(() => {
    if (!playing) return
    const total = designTimeline(style.elements, playing.phase).totalMs
    const timer = setTimeout(
      () => setPlaying((p) => (p === playing ? (p.phase === 'in' ? { phase: 'out', run: p.run + 1 } : null) : p)),
      playing.phase === 'in' ? total + PLAY_HOLD_MS : total + 200,
    )
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- timed from when each phase starts
  }, [playing])

  function play() {
    setEditingId(null)
    setPlaying((p) => (p ? null : { phase: 'in', run: Date.now() }))
  }

  /** Builds the elements one after another, bottom layer first, each fading in. */
  function buildInOrder() {
    setElements(
      elements.map((e, order) => ({
        ...e,
        animation: { ...e.animation, order, in: e.animation.in.motion === 'none' ? { ...e.animation.in, motion: 'fade' } : e.animation.in },
      })),
      'build',
    )
  }

  // Selection only holds elements that still exist (after undo, say).
  useEffect(() => {
    if (selected.some((id) => !elements.some((e) => e.id === id))) setSelected((ids) => ids.filter((id) => elements.some((e) => e.id === id)))
  }, [elements, selected])

  const change = (next: DesignStyle, key: string | null = null) => setHistory((h) => record(h, next, key))
  const setElements = (next: DesignElement[], key: string | null = null) => change({ ...style, elements: next }, key)
  const patchElement = (id: string, patch: Partial<DesignElement>, key: string | null = null) =>
    setElements(elements.map((e) => (e.id === id ? ({ ...e, ...patch } as DesignElement) : e)), key)

  async function run(action: () => Promise<void>) {
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(reportError('Designer', err))
    }
  }

  async function pickImage(): Promise<string | null> {
    let url: string | null = null
    await run(async () => {
      url = (await window.api.stream.pickLogo())?.url ?? null
    })
    return url
  }

  function add(element: DesignElement) {
    setElements([...elements, element])
    setSelected([element.id])
    rootRef.current?.focus()
  }

  async function addImage() {
    const src = await pickImage()
    if (!src) return
    const element = newDesignElement('image', newId())
    // Sized to the picture's shape, 30% of the canvas tall.
    const size = await new Promise<{ w: number; h: number } | null>((resolve) => {
      const img = new window.Image()
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => resolve(null)
      img.src = src
    })
    const height = 30
    const width = size && size.h > 0 ? Math.min(90, (height * (size.w / size.h)) / ASPECT) : element.box.width
    add({ ...element, src, box: roundBox({ x: (100 - width) / 2, y: (100 - height) / 2, width, height }) } as DesignElement)
  }

  const copy = () => {
    if (picked.length === 0) return
    clipboard = picked
    pasteCount.current = 0
  }

  function paste(items = clipboard) {
    if (items.length === 0) return
    pasteCount.current++
    const copies = copiesOf(items, newId, PASTE_OFFSET * pasteCount.current)
    setElements([...elements, ...copies])
    setSelected(copies.map((c) => c.id))
  }

  const duplicate = () => {
    if (picked.length === 0) return
    const copies = copiesOf(picked, newId, PASTE_OFFSET)
    setElements([...elements, ...copies])
    setSelected(copies.map((c) => c.id))
  }

  const remove = () => {
    if (picked.length === 0) return
    setElements(elements.filter((e) => !selectedSet.has(e.id)))
    setSelected([])
  }

  /** Moves the selected element up (toward the front) or down the layers, or all the way. */
  function arrange(where: 'front' | 'forward' | 'backward' | 'back') {
    if (!single) return
    const index = elements.findIndex((e) => e.id === single.id)
    const to = where === 'front' ? elements.length : where === 'back' ? 0 : where === 'forward' ? index + 1 : index - 1
    setElements(moveToIndex(elements, single.id, to))
  }

  function nudge(dx: number, dy: number) {
    const movable = picked.filter((e) => !e.locked)
    if (movable.length === 0) return
    const moved = moveDesignBoxes(movable.map((e) => e.box), dx, dy, null)
    const boxes = new Map(movable.map((e, i) => [e.id, moved.boxes[i]]))
    setElements(elements.map((e) => (boxes.has(e.id) ? { ...e, box: boxes.get(e.id)! } : e)), 'nudge')
  }

  // ---------- Canvas pointer handling ----------

  function delta(e: PointerEvent, from: { x: number; y: number }) {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return { dx: 0, dy: 0 }
    return { dx: ((e.clientX - from.x) / rect.width) * 100, dy: ((e.clientY - from.y) / rect.height) * 100 }
  }

  function startMove(e: PointerEvent, element: DesignElement) {
    if (e.button !== 0) return
    e.stopPropagation()
    // A second press on text soon after the first edits it in place. It is timed here because the pointer capture
    // below sends dblclick to the canvas, and pointerdown carries no click count.
    const last = lastPress.current
    lastPress.current = { id: element.id, at: e.timeStamp }
    if (element.kind === 'text' && !e.shiftKey && last?.id === element.id && e.timeStamp - last.at < DOUBLE_CLICK_MS) {
      lastPress.current = null
      // Keeps the mousedown that follows from taking focus away from the words as they open for editing.
      e.preventDefault()
      setSelected([element.id])
      setEditingId(element.id)
      return
    }
    rootRef.current?.focus()
    let ids: string[]
    if (e.shiftKey) {
      ids = selectedSet.has(element.id) ? selected.filter((id) => id !== element.id) : [...selected, element.id]
      setSelected(ids)
      if (!ids.includes(element.id)) return
    } else {
      ids = selectedSet.has(element.id) ? selected : [element.id]
      if (!selectedSet.has(element.id)) setSelected(ids)
    }
    const movable = ids.filter((id) => elements.some((el) => el.id === id && !el.locked))
    dragRef.current = { kind: 'move', x: e.clientX, y: e.clientY, ids: movable, before: style }
    stageRef.current?.setPointerCapture(e.pointerId)
  }

  function startResize(e: PointerEvent, element: DesignElement, handle: Handle) {
    if (e.button !== 0) return
    e.stopPropagation()
    dragRef.current = { kind: 'resize', x: e.clientX, y: e.clientY, id: element.id, handle, before: style }
    stageRef.current?.setPointerCapture(e.pointerId)
  }

  function startRotate(e: PointerEvent, element: DesignElement) {
    if (e.button !== 0) return
    e.stopPropagation()
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    const centre = {
      x: rect.left + ((element.box.x + element.box.width / 2) / 100) * rect.width,
      y: rect.top + ((element.box.y + element.box.height / 2) / 100) * rect.height,
    }
    dragRef.current = { kind: 'rotate', id: element.id, centre, before: style }
    stageRef.current?.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent) {
    const drag = dragRef.current
    if (!drag) return
    const start = drag.before.elements
    if (drag.kind === 'move') {
      if (drag.ids.length === 0) return
      const ids = new Set(drag.ids)
      const moving = start.filter((el) => ids.has(el.id))
      const { dx, dy } = delta(e, drag)
      const moved = moveDesignBoxes(moving.map((el) => el.box), dx, dy, e.altKey ? null : designTargets(start, ids))
      const boxes = new Map(moving.map((el, i) => [el.id, moved.boxes[i]]))
      setHistory((h) => preview(h, { ...drag.before, elements: start.map((el) => (boxes.has(el.id) ? { ...el, box: boxes.get(el.id)! } : el)) }))
      setGuides(moved.guides)
    } else if (drag.kind === 'resize') {
      const element = start.find((el) => el.id === drag.id)
      if (!element) return
      const { dx, dy } = delta(e, drag)
      const keepRatio = e.shiftKey || (element.kind === 'image' && drag.handle.length === 2)
      const resized = resizeDesignBox(element.box, element.rotation, drag.handle, dx, dy, e.altKey ? null : designTargets(start, new Set([drag.id])), keepRatio)
      setHistory((h) => preview(h, { ...drag.before, elements: start.map((el) => (el.id === drag.id ? { ...el, box: resized.box } : el)) }))
      setGuides(resized.guides)
    } else {
      const rotation = rotationToward(drag.centre, { x: e.clientX, y: e.clientY }, e.shiftKey)
      setHistory((h) => preview(h, { ...drag.before, elements: start.map((el) => (el.id === drag.id ? { ...el, rotation } : el)) }))
    }
  }

  function endDrag() {
    const drag = dragRef.current
    dragRef.current = null
    setGuides([])
    if (drag) setHistory((h) => commitFrom(h, drag.before))
  }

  // ---------- Keys ----------

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    const typing = target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
    const mod = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()
    if (mod && key === 's') {
      e.preventDefault()
      void save(false)
      return
    }
    if (typing) {
      if (e.key === 'Escape') {
        // Leaves the field for the canvas, rather than closing.
        e.stopPropagation()
        rootRef.current?.focus()
      }
      return
    }
    const handled = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    if (mod && key === 'z') {
      handled()
      setHistory((h) => (e.shiftKey ? redo(h) : undo(h)))
    } else if (mod && key === 'y') {
      handled()
      setHistory(redo)
    } else if (mod && key === 'c') {
      handled()
      copy()
    } else if (mod && key === 'x') {
      handled()
      copy()
      remove()
    } else if (mod && key === 'v') {
      handled()
      paste()
    } else if (mod && key === 'd') {
      handled()
      duplicate()
    } else if (mod && key === 'a') {
      handled()
      setSelected(elements.filter((el) => !el.locked && !el.hidden).map((el) => el.id))
    } else if (arrows[e.key] && picked.length > 0) {
      handled()
      const step = e.shiftKey ? NUDGE * 10 : NUDGE
      nudge(arrows[e.key][0] * step, arrows[e.key][1] * step)
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && picked.length > 0) {
      handled()
      remove()
    } else if (e.key === 'Enter' && single?.kind === 'text' && !single.locked) {
      handled()
      setEditingId(single.id)
    } else if (e.key === 'Escape') {
      handled()
      if (selected.length > 0) setSelected([])
      else close()
    }
  }

  // ---------- Saving ----------

  /** A name no design in the library has yet, from `base`. */
  async function freeName(base: string): Promise<string> {
    const names = new Set((await window.api.designs.list()).map((d) => d.name))
    if (!names.has(base)) return base
    for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`
  }

  function save(asNew: boolean) {
    return run(async () => {
      const clean = normalizeDesign(style)
      const trimmed = name.trim() || 'Untitled design'
      if (custom && !asNew) {
        await window.api.designs.update(saved.id!, trimmed, clean)
        setName(trimmed)
        setSaved({ ...saved, snapshot: JSON.stringify([trimmed, style]) })
        onSaved?.({ id: saved.id!, name: trimmed, type: 'custom', style: clean })
        return
      }
      // A copy of a saved design (Save as new, or any save of a built-in one) is named as a copy.
      const created = await window.api.designs.create(await freeName(saved.id !== null ? `${trimmed} copy` : trimmed), clean)
      setName(created.name)
      setSaved({ id: created.id, type: 'custom', snapshot: JSON.stringify([created.name, style]) })
      onSaved?.(created)
    })
  }

  function close() {
    if (dirty && !window.confirm('Close the designer without saving your changes?')) return
    onClose()
  }

  // ---------- Layers ----------

  /** Top layer first, as a layers list reads. */
  const layers = [...elements].reverse()

  function selectLayer(e: MouseEvent, id: string) {
    if (e.shiftKey) setSelected(selectedSet.has(id) ? selected.filter((s) => s !== id) : [...selected, id])
    else setSelected([id])
  }

  function dropLayer(onId: string) {
    const dragged = layerDragRef.current
    layerDragRef.current = null
    setDragOverId(null)
    if (!dragged || dragged === onId) return
    setElements(moveToIndex(elements, dragged, elements.findIndex((e) => e.id === onId)))
  }

  const setCategory = (category: DesignCategory) =>
    change({ ...style, category, background: category === 'lowerThird' ? { kind: 'transparent' } : style.background.kind === 'transparent' ? { kind: 'solid', color: BRAND.navy } : style.background })

  const edit =
    editingId === null
      ? undefined
      : {
          id: editingId,
          onCommit: (text: string) => {
            const element = elements.find((e) => e.id === editingId)
            if (element?.kind === 'text' && element.text !== text) patchElement(editingId, { text })
            setEditingId(null)
            rootRef.current?.focus()
          },
          onCancel: () => {
            setEditingId(null)
            rootRef.current?.focus()
          },
        }

  const designer = (
      <div
        ref={rootRef}
        className={page ? 'designer designer-page' : 'modal designer'}
        role={page ? 'region' : 'dialog'}
        aria-label="Designer"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="designer-header">
          <input className="input designer-name" aria-label="Design name" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="input" aria-label="Kind of design" value={style.category} onChange={(e) => setCategory(e.target.value as DesignCategory)}>
            <option value="lowerThird">Lower third</option>
            <option value="slide">Slide</option>
          </select>
          <div className="designer-tools" role="toolbar" aria-label="Add and edit">
            <button type="button" className="button" onClick={() => add(newDesignElement('text', newId()))} title="Add text">
              <Type size={14} aria-hidden="true" /> Text
            </button>
            <button type="button" className="button" onClick={() => add(newDesignElement('rect', newId()))} title="Add a rectangle">
              <Square size={14} aria-hidden="true" /> Rectangle
            </button>
            <button type="button" className="button" onClick={() => add(newDesignElement('line', newId()))} title="Add a line">
              <Minus size={14} aria-hidden="true" /> Line
            </button>
            <button type="button" className="button" onClick={() => void addImage()} title="Add an image">
              <ImageIcon size={14} aria-hidden="true" /> Image
            </button>
            <span className="designer-tools-gap" />
            <button type="button" className={`button${playing ? ' primary' : ''}`} onClick={play} title="Play the elements' animation in, then out" aria-pressed={playing !== null}>
              <Play size={14} aria-hidden="true" /> {playing ? `Playing ${playing.phase}` : 'Play'}
            </button>
            <button type="button" className="button" onClick={buildInOrder} disabled={elements.length < 2} title="Build the elements one after another, bottom layer first, each fading in unless it has its own way in">
              <ListOrdered size={14} aria-hidden="true" /> Build in order
            </button>
            <span className="designer-tools-gap" />
            <button type="button" className="icon-button" aria-label="Undo" title={`Undo (${MOD}Z)`} disabled={history.past.length === 0} onClick={() => setHistory(undo)}>
              <Undo2 size={15} />
            </button>
            <button type="button" className="icon-button" aria-label="Redo" title={`Redo (${MOD}⇧Z)`} disabled={history.future.length === 0} onClick={() => setHistory(redo)}>
              <Redo2 size={15} />
            </button>
            <button type="button" className="icon-button" aria-label="Copy" title={`Copy (${MOD}C)`} disabled={picked.length === 0} onClick={copy}>
              <Copy size={15} />
            </button>
            <button type="button" className="icon-button" aria-label="Paste" title={`Paste (${MOD}V)`} onClick={() => paste()}>
              <ClipboardPaste size={15} />
            </button>
            <button type="button" className="icon-button" aria-label="Duplicate" title={`Duplicate (${MOD}D)`} disabled={picked.length === 0} onClick={duplicate}>
              <CopyPlus size={15} />
            </button>
            <button type="button" className="icon-button" aria-label="Delete" title="Delete (Delete)" disabled={picked.length === 0} onClick={remove}>
              <Trash2 size={15} />
            </button>
          </div>
          <button type="button" className="icon-button" aria-label="Close" title="Close" onClick={close}>
            <X size={18} />
          </button>
        </header>

        <div className="designer-body">
          <aside className="designer-layers" aria-label="Layers">
            <h3>Layers</h3>
            {layers.length === 0 && <p className="hint">Add text, a rectangle, a line or an image.</p>}
            <ul>
              {layers.map((element) => (
                <li
                  key={element.id}
                  className={`designer-layer${selectedSet.has(element.id) ? ' selected' : ''}${element.hidden ? ' hidden' : ''}${dragOverId === element.id ? ' drop' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    layerDragRef.current = element.id
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={(e) => {
                    if (!layerDragRef.current) return
                    e.preventDefault()
                    setDragOverId(element.id)
                  }}
                  onDragLeave={() => setDragOverId((id) => (id === element.id ? null : id))}
                  onDrop={(e) => {
                    e.preventDefault()
                    dropLayer(element.id)
                  }}
                  onDragEnd={() => {
                    layerDragRef.current = null
                    setDragOverId(null)
                  }}
                  onClick={(e) => selectLayer(e, element.id)}
                >
                  {KIND_ICONS[element.kind]}
                  <span className="designer-layer-name">{element.name}</span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={element.locked ? `Unlock ${element.name}` : `Lock ${element.name}`}
                    title={element.locked ? 'Unlock' : 'Lock'}
                    onClick={(e) => {
                      e.stopPropagation()
                      patchElement(element.id, { locked: !element.locked })
                    }}
                  >
                    {element.locked ? <Lock size={13} /> : <Unlock size={13} className="dim" />}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={element.hidden ? `Show ${element.name}` : `Hide ${element.name}`}
                    title={element.hidden ? 'Show' : 'Hide'}
                    onClick={(e) => {
                      e.stopPropagation()
                      patchElement(element.id, { hidden: !element.hidden })
                    }}
                  >
                    {element.hidden ? <EyeOff size={13} /> : <Eye size={13} className="dim" />}
                  </button>
                </li>
              ))}
            </ul>
            <div className="designer-arrange" role="toolbar" aria-label="Arrange">
              <button type="button" className="icon-button" aria-label="Bring to front" title="Bring to front" disabled={!single} onClick={() => arrange('front')}>
                <ChevronsUp size={14} />
              </button>
              <button type="button" className="icon-button" aria-label="Bring forward" title="Bring forward" disabled={!single} onClick={() => arrange('forward')}>
                <ArrowUp size={14} />
              </button>
              <button type="button" className="icon-button" aria-label="Send backward" title="Send backward" disabled={!single} onClick={() => arrange('backward')}>
                <ArrowDown size={14} />
              </button>
              <button type="button" className="icon-button" aria-label="Send to back" title="Send to back" disabled={!single} onClick={() => arrange('back')}>
                <ChevronsDown size={14} />
              </button>
            </div>
          </aside>

          <main className="designer-stage-area">
            <div
              ref={stageRef}
              className="designer-stage"
              aria-label="Canvas. Arrow keys move the selection; Shift moves it further."
              onPointerDown={(e) => {
                if (e.button !== 0) return
                rootRef.current?.focus()
                setSelected([])
              }}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {playing ? (
                <DesignView key={playing.run} style={style} checker phase={playing.phase} />
              ) : (
                <DesignView style={style} edit={edit} checker placeholders />
              )}
              <div className="designer-frames" hidden={playing !== null}>
                {elements.map((element) => {
                  if (element.hidden || element.locked || element.id === editingId) return null
                  const isSelected = selectedSet.has(element.id)
                  return (
                    <div
                      key={element.id}
                      className={`designer-frame${isSelected ? ' selected' : ''}`}
                      style={{
                        left: `${element.box.x}%`,
                        top: `${element.box.y}%`,
                        width: `${element.box.width}%`,
                        height: `${element.box.height}%`,
                        transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
                      }}
                      title={element.name}
                      onPointerDown={(e) => startMove(e, element)}
                    >
                      {single?.id === element.id && (
                        <>
                          {HANDLES.map((handle) => (
                            <span key={handle} className={`designer-handle ${handle}`} onPointerDown={(e) => startResize(e, element, handle)} />
                          ))}
                          <span className="designer-rotate" title="Drag to rotate (Shift: 15° steps)" onPointerDown={(e) => startRotate(e, element)} />
                        </>
                      )}
                    </div>
                  )
                })}
                {guides.map((guide, index) => (
                  <span key={index} className={`designer-guide ${guide.axis}`} style={guide.axis === 'x' ? { left: `${guide.at}%` } : { top: `${guide.at}%` }} />
                ))}
              </div>
            </div>
            <p className="hint designer-hint">
              Double-click text to edit it. Hold Alt to place without snapping, Shift to keep the shape or rotate in 15° steps.
            </p>
          </main>

          <aside className="designer-inspector" aria-label="Properties">
            {single ? (
              <ElementFields element={single} onChange={(patch, key) => patchElement(single.id, patch, key)} pickImage={pickImage} />
            ) : picked.length > 1 ? (
              <Section title={`${picked.length} selected`}>
                <Slider
                  label="Opacity"
                  min={0}
                  max={1}
                  step={0.01}
                  value={picked[0].opacity}
                  onChange={(opacity) => setElements(elements.map((e) => (selectedSet.has(e.id) ? { ...e, opacity } : e)), 'group.opacity')}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
              </Section>
            ) : (
              <BackgroundFields background={style.background} onChange={(background) => change({ ...style, background }, 'background')} pickImage={pickImage} />
            )}
          </aside>
        </div>

        <ErrorNote error={error} />

        <footer className="modal-actions designer-actions">
          {!custom && saved.type === 'builtin' && <span className="hint">Built-in designs cannot be changed: Save as new keeps your changes.</span>}
          {custom && (
            <button type="button" className="button" onClick={() => void save(true)} title="A new design with these changes">
              <FilePlus size={14} aria-hidden="true" /> Save as new
            </button>
          )}
          <button type="button" className="button primary" disabled={custom && !dirty} onClick={() => void save(false)} title={`${MOD}S`}>
            <Save size={14} aria-hidden="true" /> {custom ? 'Save' : saved.type === 'builtin' ? 'Save as new' : 'Save to Designs'}
          </button>
        </footer>
      </div>
  )
  if (page) return designer
  return createPortal(<div className="modal-backdrop designer-backdrop">{designer}</div>, document.body)
}

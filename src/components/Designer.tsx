import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  CircleHelp,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Eye,
  EyeOff,
  FilePlus,
  FileUp,
  Image as ImageIcon,
  Link2,
  Lock,
  ListOrdered,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Redo2,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
  Unlock,
  WandSparkles,
  X,
} from 'lucide-react'
import { useContext, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { paddingBetween, type DesignLayout } from '../../shared/autoLayout'
import { linkAll, makeStretch, suggestLinks, textBehind } from '../../shared/designLinks'
import { DESIGN_EASINGS, DESIGN_MOTIONS, designTimeline, FREE_MOTIONS, MOTION_LIMITS, type AnimationPhase } from '../../shared/designAnimation'
import { can, canSaveLowerThirdDesign } from '../../shared/features'
import { DESIGN_EFFECTS, EFFECT_DIRECTIONS, EFFECT_LABELS, EFFECT_LIMITS, effectEndMs, newEffect } from '../../shared/designEffects'
import { BRAND, DEFAULT_MAX, KIND_NAMES, newDesignElement, normalizeDesign } from '../../shared/designs'
import type {
  Design,
  DesignBackground,
  DesignCategory,
  DesignEasing,
  DesignEffect,
  DesignEffectDirection,
  DesignEffectKind,
  DesignElement,
  DesignElementAnimation,
  DesignElementKind,
  DesignFill,
  DesignFitToText,
  DesignGrowth,
  DesignInsets,
  DesignLoop,
  DesignMotion,
  DesignMotionStep,
  DesignShadow,
  DesignStyle,
  DesignTextField,
  DesignTextSizing,
  TextCase,
  ThemeBox,
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
  resizedElement,
  rotationToward,
  roundBox,
  startHistory,
  undo,
  withLinked,
  type Guide,
  type Handle,
  type History,
} from '../lib/designLayout'
import { canvasSize, clampPan, clampZoom, panToKeep, readZoomMode, scaleOf, ZOOM_MAX, ZOOM_MIN, zoomKey, type Point, type ZoomMode } from '../lib/designerZoom'
import { canImport, IMPORT_ACCEPT, importDesignFile, importFromTransfer, type DesignImport } from '../lib/designImport'
import { askUpgrade, lockedOption } from '../lib/upgrade'
import { Locked, LockIcon } from './Locked'
import { reportError, type ErrorLike } from '../lib/errors'
import { MOD } from '../lib/shortcuts'
import { usePersistentState } from '../lib/usePersistentState'
import { measureWith, useDesignLayout } from '../lib/textMeasure'
import { DesignView, type InlineEdit } from './DesignView'
import { FontPicker, MissingFontChips } from './FontPicker'
import { DefaultFontContext } from './themedSlideLayers'
import { ErrorNote } from './ui'

/** Arrow keys move by a tenth of a percent of the canvas; with Shift, ten times as far. */
const NUDGE = 0.1
/** How far each paste lands from the last, in percent. */
const PASTE_OFFSET = 2
/** Two presses on text this close together edit it. */
const DOUBLE_CLICK_MS = 400
/** The space around the canvas when it fits, in px. */
const CANVAS_PADDING = 16
/** How far one notch of the scroll wheel zooms. */
const WHEEL_ZOOM = 0.0015

type Backdrop = 'checker' | 'camera'
const isBackdrop = (v: unknown): v is Backdrop => v === 'checker' || v === 'camera'
type Panels = { layers: boolean; inspector: boolean }
const isPanels = (v: unknown): v is Panels => typeof v === 'object' && v !== null && typeof (v as Panels).layers === 'boolean' && typeof (v as Panels).inspector === 'boolean'

/** A design's remembered zoom mode; storage can be unavailable. */
function loadZoom(id: number | null): ZoomMode {
  try {
    return readZoomMode(JSON.parse(localStorage.getItem(zoomKey(id)) ?? 'null'))
  } catch {
    return { mode: 'fit' }
  }
}

/** How long Play holds the design on screen between its way in and its way out. */
const PLAY_HOLD_MS = 1500

/** Play holds the design long enough to see its light effects, up to this long. */
const PLAY_EFFECTS_MAX_MS = 20000

/** How long after Play starts the light effects have each been seen once: to their end, or one pass of a loop. */
function effectsShownMs(elements: DesignElement[]): number {
  const entries = new Map(designTimeline(elements, 'in').entries.map((entry) => [entry.id, entry]))
  let end = 0
  for (const element of elements) {
    if (element.hidden) continue
    const entry = entries.get(element.id)
    const inAt = entry ? entry.startMs + entry.durationMs : 0
    for (const effect of element.effects) {
      const finite = effectEndMs(effect)
      end = Math.max(end, inAt + (Number.isFinite(finite) ? finite : effect.delayMs + (effect.durationMs + effect.gapMs) / effect.speed) + 300)
    }
  }
  return Math.min(end, PLAY_EFFECTS_MAX_MS)
}

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900]
const CASES: { value: TextCase; label: string }[] = [
  { value: 'normal', label: 'As typed' },
  { value: 'upper', label: 'UPPERCASE' },
  { value: 'lower', label: 'lowercase' },
]
const FIELD_LABELS: Record<DesignTextField, string> = { headline: 'Headline', body: 'Body', number: 'Number' }
const SIZINGS: { value: DesignTextSizing; label: string; hint: string }[] = [
  { value: 'fixed', label: 'Fixed', hint: 'The box keeps its size and the words keep theirs' },
  { value: 'autoWidth', label: 'Auto width', hint: 'The box grows with the words, then wraps at the maximum width' },
  { value: 'autoHeight', label: 'Auto height', hint: 'The words wrap in the box, which grows taller' },
  { value: 'shrink', label: 'Shrink to fit', hint: 'The box keeps its size and the words get smaller to fit' },
]
const GROWTH_LABELS: Record<DesignGrowth, string> = { right: 'Grow right', left: 'Grow left', down: 'Grow down', up: 'Grow up', center: 'Grow from centre' }
const AXES_LABELS: Record<DesignFitToText['axes'], string> = { both: 'Width and height', width: 'Width only', height: 'Height only' }
/** A new 9 slice starts with a fifth of each side fixed. */
const NEW_SLICE: DesignInsets = { top: 20, right: 20, bottom: 20, left: 20 }
const SIDES = ['top', 'right', 'bottom', 'left'] as const
const SIDE_LABELS = { top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left' } as const
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
  /** Opened from Import design: its warnings, shown with the offer to make its backgrounds stretch. */
  imported?: string[]
}

type Drag =
  | { kind: 'move'; x: number; y: number; ids: string[]; before: DesignStyle }
  /** `boxes` are where the layout drew everything when the drag began. */
  | { kind: 'resize'; x: number; y: number; id: string; handle: Handle; before: DesignStyle; boxes: Map<string, ThemeBox> }
  | { kind: 'rotate'; id: string; centre: { x: number; y: number }; before: DesignStyle }
  /** A 9 slice guide of a picture, dragged within its frame. */
  | { kind: 'slice'; id: string; side: keyof DesignInsets; frame: DOMRect; before: DesignStyle }

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

const DIRECTION_LABELS: Record<DesignEffectDirection, string> = { forward: 'Forward', reverse: 'Reverse', alternate: 'Back and forth' }

/** One light effect's settings: its timing, its light, then the settings its kind has. */
function EffectFields({ effect, onChange, onRemove }: { effect: DesignEffect; onChange(effect: DesignEffect, key: string): void; onRemove(): void }) {
  const set = <K extends keyof DesignEffect>(key: K) => (value: DesignEffect[K]) => onChange({ ...effect, [key]: value }, key)
  const L = EFFECT_LIMITS
  const { kind } = effect
  const travels = kind === 'lightSweep' || kind === 'scanLine' || kind === 'lightning'
  return (
    <div className="designer-effect" aria-label={EFFECT_LABELS[kind]} role="group">
      <div className="designer-effect-head">
        <strong>{EFFECT_LABELS[kind]}</strong>
        <button type="button" className="icon-button" aria-label={`Remove ${EFFECT_LABELS[kind]}`} title="Remove this effect" onClick={onRemove}>
          <Trash2 size={13} />
        </button>
      </div>
      <div className="designer-fields">
        <NumberField label="Time" value={effect.durationMs} step={100} min={L.durationMs[0]} max={L.durationMs[1]} onChange={(v) => set('durationMs')(Math.round(v))} suffix="ms" />
        <NumberField label="Speed" value={effect.speed} step={0.25} min={L.speed[0]} max={L.speed[1]} onChange={set('speed')} suffix="×" />
        <NumberField label="Delay" value={effect.delayMs} step={100} min={0} max={L.delayMs[1]} onChange={(v) => set('delayMs')(Math.round(v))} suffix="ms" />
        <NumberField label="Gap" value={effect.gapMs} step={100} min={0} max={L.gapMs[1]} onChange={(v) => set('gapMs')(Math.round(v))} suffix="ms" />
      </div>
      <div className="designer-fields">
        <label className="inline-check" title="Plays until the element goes; off, it plays the number of times set">
          <input type="checkbox" checked={effect.repeat === 0} onChange={(e) => set('repeat')(e.target.checked ? 0 : 1)} />
          Loop
        </label>
        {effect.repeat > 0 && <NumberField label="Times" value={effect.repeat} step={1} min={1} max={L.repeat[1]} onChange={(v) => set('repeat')(Math.max(1, Math.round(v)))} />}
        <label className="designer-number">
          <span>Easing</span>
          <select className="input" aria-label="Effect easing" value={effect.easing} onChange={(e) => set('easing')(e.target.value as DesignEasing)}>
            {DESIGN_EASINGS.map((easing) => (
              <option key={easing} value={easing}>
                {EASING_LABELS[easing]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="designer-fields">
        <Color label="Effect colour" value={effect.color} onChange={set('color')} />
        <Slider label="Intensity" min={0} max={1} step={0.05} value={effect.intensity} onChange={set('intensity')} format={(v) => `${Math.round(v * 100)}%`} />
      </div>
      {(travels || kind === 'borderChase') && (
        <div className="designer-fields">
          {(kind === 'lightSweep' || kind === 'scanLine') && <NumberField label="Angle" value={effect.angle} step={5} min={L.angle[0]} max={L.angle[1]} onChange={(v) => set('angle')(Math.round(v))} suffix="°" />}
          <NumberField
            label={kind === 'borderChase' ? 'Length' : kind === 'lightning' ? 'Spread' : 'Width'}
            value={effect.width}
            step={1}
            min={L.width[0]}
            max={L.width[1]}
            onChange={(v) => set('width')(Math.round(v))}
            suffix="%"
          />
          {kind === 'borderChase' && <NumberField label="Thickness" value={effect.thickness} step={0.05} min={L.thickness[0]} max={L.thickness[1]} onChange={set('thickness')} />}
          <label className="designer-number">
            <span>Direction</span>
            <select className="input" aria-label="Effect direction" value={effect.direction} onChange={(e) => set('direction')(e.target.value as DesignEffectDirection)}>
              {EFFECT_DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {DIRECTION_LABELS[d]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {(kind === 'lightning' || kind === 'flicker' || kind === 'glowPulse') && (
        <div className="designer-fields">
          {kind !== 'glowPulse' && <Slider label="Flicker" min={0} max={1} step={0.05} value={effect.flicker} onChange={set('flicker')} format={(v) => `${Math.round(v * 100)}%`} />}
          {kind !== 'glowPulse' && (
            <NumberField label="Seed" value={effect.seed} step={1} min={L.seed[0]} max={L.seed[1]} onChange={(v) => set('seed')(Math.round(v))} />
          )}
          {kind !== 'flicker' && <NumberField label="Glow" value={effect.glow} step={0.1} min={L.glow[0]} max={L.glow[1]} onChange={set('glow')} />}
        </div>
      )}
    </div>
  )
}

/** The element's light effects, in the order they draw, and Add effect. Play shows them; they run on air. */
function EffectsFields({ effects, onChange }: { effects: DesignEffect[]; onChange(effects: DesignEffect[], key: string): void }) {
  const add = (kind: DesignEffectKind) => {
    const used = new Set(effects.map((e) => e.id))
    let n = effects.length + 1
    while (used.has(`fx${n}`)) n++
    onChange([...effects, newEffect(kind, `fx${n}`)], 'add')
  }
  return (
    <Section title="Effects">
      {effects.map((effect) => (
        <EffectFields
          key={effect.id}
          effect={effect}
          onChange={(changed, key) => onChange(effects.map((e) => (e.id === effect.id ? changed : e)), `${effect.id}.${key}`)}
          onRemove={() => onChange(effects.filter((e) => e.id !== effect.id), `${effect.id}.remove`)}
        />
      ))}
      {effects.length < EFFECT_LIMITS.count && (
        <label className="designer-number">
          <span>
            Add effect <LockIcon feature="effects.animations" />
          </span>
          <select
            className="input"
            aria-label="Add effect"
            value=""
            onChange={(e) => {
              if (!e.target.value) return
              if (!can('effects.animations')) return askUpgrade('effects.animations', e.currentTarget)
              add(e.target.value as DesignEffectKind)
            }}
          >
            <option value="" disabled>
              Choose…
            </option>
            {DESIGN_EFFECTS.map((kind) => (
              <option key={kind} value={kind}>
                {lockedOption('effects.animations', EFFECT_LABELS[kind])}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="hint">Light inside the element's shape once it is in. Play previews them; they run on the outputs.</p>
    </Section>
  )
}

/** One way in or out: the movement, then its timing once it has one. */
function MotionFields({ phase, step, onChange }: { phase: AnimationPhase; step: DesignMotionStep; onChange(step: DesignMotionStep, key: string): void }) {
  const set = <K extends keyof DesignMotionStep>(key: K) => (value: DesignMotionStep[K]) => onChange({ ...step, [key]: value }, key)
  return (
    <>
      <label className="designer-number">
        <span>{phase === 'in' ? 'In' : 'Out'}</span>
        <select
          className="input"
          aria-label={phase === 'in' ? 'In animation' : 'Out animation'}
          value={step.motion}
          onChange={(e) => {
            const motion = e.target.value as DesignMotion
            if (!FREE_MOTIONS.includes(motion) && !can('effects.animations')) return askUpgrade('effects.animations', e.currentTarget)
            set('motion')(motion)
          }}
        >
          {DESIGN_MOTIONS.map((m) => (
            <option key={m} value={m}>
              {FREE_MOTIONS.includes(m) ? (phase === 'out' && OUT_LABELS[m]) || MOTION_LABELS[m] : lockedOption('effects.animations', (phase === 'out' && OUT_LABELS[m]) || MOTION_LABELS[m])}
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

/** Pins: where the element stays when stretching text makes the lower third larger or smaller. */
function PinFields({ element, onChange }: { element: DesignElement; onChange(patch: Partial<DesignElement>, key: string): void }) {
  const { constraints } = element
  return (
    <Section title="Pin">
      <div className="designer-fields">
        <label className="designer-number">
          <span>Across</span>
          <select
            className="input"
            aria-label="Pin across"
            value={constraints.horizontal}
            onChange={(e) => onChange({ constraints: { ...constraints, horizontal: e.target.value as typeof constraints.horizontal } }, 'pin.h')}
          >
            <option value="left">Left</option>
            <option value="right">Right</option>
            <option value="center">Centre</option>
            <option value="scale">Scale</option>
          </select>
        </label>
        <label className="designer-number">
          <span>Down</span>
          <select
            className="input"
            aria-label="Pin down"
            value={constraints.vertical}
            onChange={(e) => onChange({ constraints: { ...constraints, vertical: e.target.value as typeof constraints.vertical } }, 'pin.v')}
          >
            <option value="top">Top</option>
            <option value="bottom">Bottom</option>
            <option value="center">Centre</option>
            <option value="scale">Scale</option>
          </select>
        </label>
      </div>
      <p className="hint">When text stretches the lower third, this stays at that edge of it, in its middle, or keeps its share (Scale).</p>
    </Section>
  )
}

/** How a text element's box follows its words, and Make this stretch when shapes sit behind it. */
function SizeFields({ element, elements, overflow, onChange, onStretch }: {
  element: Extract<DesignElement, { kind: 'text' }>
  elements: DesignElement[]
  overflow: boolean
  onChange(patch: Partial<DesignElement>, key: string): void
  onStretch(textId: string, shapeIds: string[]): void
}) {
  const auto = element.sizing === 'autoWidth' || element.sizing === 'autoHeight'
  const backgrounds = elements.filter((e) => e.fitToText?.textId === element.id)
  const behind = elements.filter((e) => (e.kind === 'rect' || e.kind === 'image') && !e.fitToText && !e.hidden && textBehind(e, elements)?.id === element.id)
  return (
    <Section title="Size">
      <label className="designer-number">
        <span>Box</span>
        <select
          className="input"
          aria-label="Text box size"
          title={SIZINGS.find((o) => o.value === element.sizing)?.hint}
          value={element.sizing}
          onChange={(e) => {
            const sizing = e.target.value as DesignTextSizing
            // A box set to stretch grows from where it is, up to the edge of the screen.
            const maxWidth = sizing === 'autoWidth' ? Math.max(element.box.width, Math.min(DEFAULT_MAX.width, 100 - element.box.x)) : element.maxWidth
            onChange({ sizing, maxWidth }, 'sizing')
          }}
        >
          {SIZINGS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {auto && (
        <>
          <div className="designer-fields">
            <NumberField label="Max W" value={element.maxWidth} min={1} max={300} onChange={(maxWidth) => onChange({ maxWidth }, 'maxWidth')} />
            <NumberField label="Max H" value={element.maxHeight} min={1} max={300} onChange={(maxHeight) => onChange({ maxHeight }, 'maxHeight')} />
          </div>
          <label className="inline-check" title="Past the maximum size the words wrap, then get smaller">
            <input type="checkbox" checked={element.autoFit} onChange={(e) => onChange({ autoFit: e.target.checked }, 'autoFit')} />
            Then shrink to fit
          </label>
        </>
      )}
      {overflow && (
        <p className="designer-overflow" role="status">
          <AlertTriangle size={13} aria-hidden="true" /> The sample words need more room than the maximum size.
        </p>
      )}
      {backgrounds.length > 0 && <p className="hint">Stretches: {backgrounds.map((b) => b.name).join(', ')}</p>}
      {behind.length > 0 && (
        <button type="button" className="button" title={`Auto width, with ${behind.map((b) => b.name).join(' and ')} fitted to the words`} onClick={() => onStretch(element.id, behind.map((b) => b.id))}>
          <WandSparkles size={14} aria-hidden="true" /> Make this stretch
        </button>
      )}
    </Section>
  )
}

/** A shape or picture sized to a text element, as its background. */
function FitFields({ element, elements, layout, onChange, onStretch }: {
  element: DesignElement
  elements: DesignElement[]
  layout: DesignLayout
  onChange(patch: Partial<DesignElement>, key: string): void
  onStretch(textId: string, shapeIds: string[]): void
}) {
  const fit = element.fitToText
  const texts = elements.filter((e): e is Extract<DesignElement, { kind: 'text' }> => e.kind === 'text')
  const target = texts.find((t) => t.id === fit?.textId)
  const suggestion = fit ? null : textBehind(element, elements)
  const setFit = (patch: Partial<DesignFitToText>, key: string) => fit && onChange({ fitToText: { ...fit, ...patch } }, `fit.${key}`)
  return (
    <Section title="Fit to text">
      <select
        className="input"
        aria-label="Fit to text"
        value={fit?.textId ?? ''}
        onChange={(e) => {
          const textId = e.target.value
          const text = layout.boxes.get(textId)
          const box = layout.boxes.get(element.id) ?? element.box
          // Linking keeps it where it is: the padding is the room it has around the text now.
          onChange(
            { fitToText: textId && text ? { textId, padding: paddingBetween(box, text), minWidth: 0, maxWidth: 0, anchor: 'right', axes: 'both' } : null },
            'fit',
          )
        }}
      >
        <option value="">Not fitted to text</option>
        {texts.map((t) => (
          <option key={t.id} value={t.id}>
            Fit to “{t.name}”
          </option>
        ))}
      </select>
      {fit && (
        <>
          <div className="designer-fields">
            {SIDES.map((side) => (
              <NumberField key={side} label={SIDE_LABELS[side]} value={fit.padding[side]} min={0} max={100} onChange={(v) => setFit({ padding: { ...fit.padding, [side]: v } }, `padding.${side}`)} />
            ))}
            <NumberField label="Min W" value={fit.minWidth} min={0} max={300} onChange={(minWidth) => setFit({ minWidth }, 'minWidth')} />
            <NumberField label="Max W" value={fit.maxWidth} min={0} max={300} onChange={(maxWidth) => setFit({ maxWidth }, 'maxWidth')} suffix={fit.maxWidth === 0 ? 'none' : undefined} />
          </div>
          <div className="lt-editor-row">
            <select className="input" aria-label="Grows" value={fit.anchor} onChange={(e) => setFit({ anchor: e.target.value as DesignGrowth }, 'anchor')}>
              {(Object.keys(GROWTH_LABELS) as DesignGrowth[]).map((g) => (
                <option key={g} value={g}>
                  {GROWTH_LABELS[g]}
                </option>
              ))}
            </select>
            <select className="input" aria-label="Follows" value={fit.axes} onChange={(e) => setFit({ axes: e.target.value as DesignFitToText['axes'] }, 'axes')}>
              {(Object.keys(AXES_LABELS) as DesignFitToText['axes'][]).map((a) => (
                <option key={a} value={a}>
                  {AXES_LABELS[a]}
                </option>
              ))}
            </select>
          </div>
          {target && (target.sizing === 'fixed' || target.sizing === 'shrink') && (
            <p className="hint">“{target.name}” keeps its size, so this does too. Set its Size to Auto width to stretch with the words.</p>
          )}
        </>
      )}
      {suggestion && (
        <button type="button" className="button" title={`Fit this to “${suggestion.name}” and make it Auto width`} onClick={() => onStretch(suggestion.id, [element.id])}>
          <WandSparkles size={14} aria-hidden="true" /> Make this stretch with “{suggestion.name}”
        </button>
      )}
    </Section>
  )
}

/** The fields for the one selected element: its place, then what its kind has. */
function ElementFields({ element, elements, layout, onChange, onStretch, pickImage }: {
  element: DesignElement
  elements: DesignElement[]
  layout: DesignLayout
  onChange(patch: Partial<DesignElement>, key: string): void
  onStretch(textId: string, shapeIds: string[]): void
  pickImage(): Promise<string | null>
}) {
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

      {element.kind === 'text' ? (
        <SizeFields element={element} elements={elements} overflow={layout.overflow.has(element.id)} onChange={(patch, key) => onChange(patch, `${element.id}.${key}`)} onStretch={onStretch} />
      ) : (
        <FitFields element={element} elements={elements} layout={layout} onChange={(patch, key) => onChange(patch, `${element.id}.${key}`)} onStretch={onStretch} />
      )}
      <PinFields element={element} onChange={(patch, key) => onChange(patch, `${element.id}.${key}`)} />

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

      <EffectsFields effects={element.effects} onChange={(effects, key) => onChange({ effects }, `${element.id}.effects.${key}`)} />

      <Section title="On air">
        <label className="designer-number">
          <span>Loop</span>
          <select
            className="input"
            aria-label="Loop"
            value={element.loop}
            onChange={(e) => {
              const loop = e.target.value as DesignLoop
              if (loop !== 'none' && !can('effects.animations')) return askUpgrade('effects.animations', e.currentTarget)
              set('loop')(loop)
            }}
          >
            {LOOPS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.value === 'none' ? l.label : lockedOption('effects.animations', l.label)}
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
            <Slider
              label={element.sizing === 'shrink' || (element.sizing !== 'fixed' && element.autoFit) ? 'Max size' : 'Size'}
              min={0.5}
              max={30}
              step={0.1}
              value={element.fontSize}
              onChange={set('fontSize')}
              format={(v) => v.toFixed(1)}
            />
            <div className="lt-editor-row">
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
          <label className="inline-check" title="The corners and edges keep their size when the picture stretches; drag the guides on the canvas">
            <input type="checkbox" checked={element.slice !== null} onChange={(e) => set('slice')(e.target.checked ? NEW_SLICE : null)} />9 slice
          </label>
          {element.slice && (
            <div className="designer-fields">
              {SIDES.map((side) => (
                <NumberField
                  key={side}
                  label={SIDE_LABELS[side]}
                  value={element.slice![side]}
                  min={0}
                  max={49}
                  suffix="%"
                  onChange={(v) => onChange({ slice: { ...element.slice!, [side]: v } }, `${element.id}.slice.${side}`)}
                />
              ))}
            </div>
          )}
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
  /** The text being typed into on the canvas, and the letter that started it when typing began on a selected text. */
  const [editing, setEditing] = useState<{ id: string; initial?: string } | null>(null)
  const editingId = editing?.id ?? null
  const setEditingId = (id: string | null) => setEditing(id === null ? null : { id })
  /** The words as they are being typed, so what is fitted to them stretches live. */
  const [liveText, setLiveText] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [fileOver, setFileOver] = useState(false)
  /** After an import: its warnings, and the backgrounds it can link to their text. */
  const [imported, setImported] = useState<{ warnings: string[]; links: number } | null>(() =>
    doc.imported ? { warnings: doc.imported, links: suggestLinks(doc.style.elements).length } : null,
  )
  const fileRef = useRef<HTMLInputElement>(null)
  const pasteWaiting = useRef(false)
  const defaultFont = useContext(DefaultFontContext)
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
  /** The canvas area, its size less the padding, and the zoom: Fit, or a set zoom with the canvas panned. */
  const viewportRef = useRef<HTMLElement>(null)
  const [area, setArea] = useState({ width: 0, height: 0 })
  const [zoomMode, setZoomMode] = useState<ZoomMode>(() => loadZoom(doc.id))
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const [backdrop, setBackdrop] = usePersistentState<Backdrop>('designer.backdrop', 'checker', isBackdrop)
  const [panels, setPanels] = usePersistentState<Panels>('designer.panels', { layers: true, inspector: true }, isPanels)
  /** Space held, so dragging pans; `panned` is whether it did, as a space alone on a selected text starts typing. */
  const space = useRef({ held: false, panned: false })
  const [spaceHeld, setSpaceHeld] = useState(false)
  const panDrag = useRef<{ x: number; y: number; from: Point } | null>(null)
  const [panning, setPanning] = useState(false)
  /** Whether the last press was on empty canvas, where a double-click fits it. */
  const emptyPress = useRef(false)

  const style = history.present
  const { elements } = style
  // While typing, the canvas shows the words so far, laid out as they will be.
  const shown = editingId !== null && liveText !== null ? { ...style, elements: elements.map((e) => (e.id === editingId && e.kind === 'text' ? { ...e, text: liveText } : e)) } : style
  const layout = useDesignLayout(shown)
  const boxOf = (e: DesignElement) => layout.boxes.get(e.id) ?? e.box
  const selectedSet = new Set(selected)
  const picked = elements.filter((e) => selectedSet.has(e.id))
  const single = picked.length === 1 ? picked[0] : null
  const custom = saved.type === 'custom' && saved.id !== null
  const dirty = JSON.stringify([name, style]) !== saved.snapshot

  useEffect(() => rootRef.current?.focus(), [])

  // ---------- Zoom and pan ----------

  const scale = scaleOf(zoomMode, area)
  const canvas = canvasSize(scale)
  const shownPan = zoomMode.mode === 'fit' ? { x: 0, y: 0 } : clampPan(pan, canvas, area)
  /** The latest scale and pan, for wheel events that come faster than renders. */
  const view = useRef({ scale, pan: shownPan })
  view.current = { scale, pan: shownPan }

  // The canvas refits as the window changes size and as the side panels open and close.
  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => setArea({ width: Math.max(0, el.clientWidth - 2 * CANVAS_PADDING), height: Math.max(0, el.clientHeight - 2 * CANVAS_PADDING) })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Each design opens at the zoom it was left at.
  useEffect(() => {
    try {
      localStorage.setItem(zoomKey(saved.id), JSON.stringify(zoomMode))
    } catch {
      // It opens at Fit next time.
    }
  }, [saved.id, zoomMode])

  /** Zooms to `zoom`, keeping the point `at` (from the area's centre) where it is. */
  function zoomTo(zoom: number, at: Point = { x: 0, y: 0 }) {
    const to = clampZoom(zoom)
    const next = clampPan(panToKeep(view.current.pan, at, view.current.scale, to), canvasSize(to), area)
    view.current = { scale: to, pan: next }
    setPan(next)
    setZoomMode({ mode: 'zoom', zoom: to })
  }

  function fit() {
    setPan({ x: 0, y: 0 })
    setZoomMode({ mode: 'fit' })
  }

  // The wheel zooms around the pointer. It is listened to directly, as React's wheel listener cannot prevent scrolling.
  const onWheel = useRef<(e: WheelEvent) => void>(() => undefined)
  onWheel.current = (e) => {
    const el = viewportRef.current
    if (!el || e.deltaY === 0) return
    e.preventDefault()
    const rect = el.getBoundingClientRect()
    const at = { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 }
    zoomTo(view.current.scale * Math.exp(-e.deltaY * WHEEL_ZOOM * (e.deltaMode === 1 ? 16 : 1)), at)
  }
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const listener = (e: WheelEvent) => onWheel.current(e)
    el.addEventListener('wheel', listener, { passive: false })
    return () => el.removeEventListener('wheel', listener)
  }, [])

  // Space let go while the window is in the background never arrives.
  useEffect(() => {
    const reset = () => {
      space.current = { held: false, panned: false }
      setSpaceHeld(false)
    }
    window.addEventListener('blur', reset)
    return () => window.removeEventListener('blur', reset)
  }, [])

  function onKeyUp(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== ' ' || !space.current.held) return
    const { panned } = space.current
    space.current = { held: false, panned: false }
    setSpaceHeld(false)
    if (!panned && single?.kind === 'text' && !single.locked && editing === null) setEditing({ id: single.id, initial: ' ' })
  }

  /** Space and drag pans, from Fit too, which then holds its scale. Presses on the canvas go no further. */
  function startPan(e: PointerEvent<HTMLElement>) {
    emptyPress.current = false
    if (!space.current.held || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    space.current.panned = true
    if (zoomMode.mode === 'fit') setZoomMode({ mode: 'zoom', zoom: scale })
    panDrag.current = { x: e.clientX, y: e.clientY, from: shownPan }
    setPanning(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function movePan(e: PointerEvent) {
    const drag = panDrag.current
    if (!drag) return
    setPan(clampPan({ x: drag.from.x + e.clientX - drag.x, y: drag.from.y + e.clientY - drag.y }, canvas, area))
  }

  function endPan() {
    if (!panDrag.current) return
    panDrag.current = null
    setPanning(false)
  }

  // Play steps from the way in to the way out after a hold, then back to editing.
  useEffect(() => {
    if (!playing) return
    const total = designTimeline(style.elements, playing.phase).totalMs
    const timer = setTimeout(
      () => setPlaying((p) => (p === playing ? (p.phase === 'in' ? { phase: 'out', run: p.run + 1 } : null) : p)),
      playing.phase === 'in' ? Math.max(total + PLAY_HOLD_MS, effectsShownMs(style.elements)) : total + 200,
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

  /** Adds what an import brought on top, selected, and offers to link its backgrounds to their text. */
  function addImported(result: DesignImport) {
    // Ids already in the design get new ones (from the latest design: the import may have taken a while).
    const used = new Set(history.present.elements.map((e) => e.id))
    const fixed = result.elements.map((e) => (used.has(e.id) ? { ...e, id: newId() } : e))
    setHistory((h) => record(h, { ...h.present, elements: [...h.present.elements, ...fixed.filter((e) => !h.present.elements.some((p) => p.id === e.id))] }))
    setSelected(fixed.filter((e) => !e.hidden).map((e) => e.id))
    setImported({ warnings: result.warnings, links: suggestLinks(fixed).length })
    rootRef.current?.focus()
  }

  function importFiles(files: File[]) {
    if (!can('designs.figmaImport')) return askUpgrade('designs.figmaImport')
    const usable = files.filter(canImport)
    if (usable.length === 0) {
      setError(reportError('Designer', new Error('Import design takes SVG, PNG, JPEG and WebP files.')))
      return
    }
    void run(async () => {
      const results = await Promise.all(usable.map(importDesignFile))
      addImported({ elements: results.flatMap((r) => r.elements), warnings: results.flatMap((r) => r.warnings) })
    })
  }

  /** Links every background the last import brought to the text on it, so each stretches with its words. */
  function linkImported() {
    setElements(linkAll(elements, measureWith(defaultFont)), 'link')
    setImported((note) => note && { ...note, links: 0 })
  }

  const stretch = (textId: string, shapeIds: string[]) => setElements(makeStretch(elements, textId, shapeIds, measureWith(defaultFont)), 'stretch')

  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
    pasteWaiting.current = false
    e.preventDefault()
    const fromClipboard = importFromTransfer(e.clipboardData)
    if (fromClipboard && !can('designs.figmaImport')) return askUpgrade('designs.figmaImport')
    if (fromClipboard) void run(async () => addImported(await fromClipboard()))
    else paste()
  }

  const isFileDrag = (e: DragEvent) => e.dataTransfer.types.includes('Files')

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
    const movable = withLinked(elements, ids)
    dragRef.current = { kind: 'move', x: e.clientX, y: e.clientY, ids: movable, before: style }
    setDragging(true)
    stageRef.current?.setPointerCapture(e.pointerId)
  }

  function startResize(e: PointerEvent, element: DesignElement, handle: Handle) {
    if (e.button !== 0) return
    e.stopPropagation()
    dragRef.current = { kind: 'resize', x: e.clientX, y: e.clientY, id: element.id, handle, before: style, boxes: layout.boxes }
    setDragging(true)
    stageRef.current?.setPointerCapture(e.pointerId)
  }

  function startRotate(e: PointerEvent, element: DesignElement) {
    if (e.button !== 0) return
    e.stopPropagation()
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    const box = boxOf(element)
    const centre = {
      x: rect.left + ((box.x + box.width / 2) / 100) * rect.width,
      y: rect.top + ((box.y + box.height / 2) / 100) * rect.height,
    }
    dragRef.current = { kind: 'rotate', id: element.id, centre, before: style }
    stageRef.current?.setPointerCapture(e.pointerId)
  }

  function startSlice(e: PointerEvent, element: DesignElement, side: keyof DesignInsets) {
    if (e.button !== 0) return
    e.stopPropagation()
    const frame = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect()
    if (!frame) return
    dragRef.current = { kind: 'slice', id: element.id, side, frame, before: style }
    setDragging(true)
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
      const keepRatio = e.shiftKey || (element.kind === 'image' && !element.slice && drag.handle.length === 2)
      // From where the layout drew it, snapping to where it drew the others.
      const drawn = start.map((el) => ({ ...el, box: drag.boxes.get(el.id) ?? el.box }))
      const from = drag.boxes.get(element.id) ?? element.box
      const resized = resizeDesignBox(from, element.rotation, drag.handle, dx, dy, e.altKey ? null : designTargets(drawn, new Set([drag.id])), keepRatio)
      const changed = resizedElement(element, resized.box, drag.handle, drag.boxes)
      setHistory((h) => preview(h, { ...drag.before, elements: start.map((el) => (el.id === drag.id ? changed : el)) }))
      setGuides(resized.guides)
    } else if (drag.kind === 'slice') {
      const element = start.find((el) => el.id === drag.id)
      if (element?.kind !== 'image' || !element.slice) return
      const { frame, side } = drag
      // The guide's distance in from its side, in percent of the picture, short of the middle.
      const across = side === 'left' || side === 'right'
      const at = across ? (e.clientX - frame.left) / frame.width : (e.clientY - frame.top) / frame.height
      const inset = Math.round(Math.max(0, Math.min(49, (side === 'left' || side === 'top' ? at : 1 - at) * 100)) * 10) / 10
      setHistory((h) => preview(h, { ...drag.before, elements: start.map((el) => (el.id === drag.id ? { ...element, slice: { ...element.slice!, [side]: inset } } : el)) }))
    } else {
      const rotation = rotationToward(drag.centre, { x: e.clientX, y: e.clientY }, e.shiftKey)
      setHistory((h) => preview(h, { ...drag.before, elements: start.map((el) => (el.id === drag.id ? { ...el, rotation } : el)) }))
    }
  }

  function endDrag() {
    const drag = dragRef.current
    dragRef.current = null
    setDragging(false)
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
      // The paste event that follows brings an SVG or a picture from the clipboard; without one, the elements copied.
      e.stopPropagation()
      pasteWaiting.current = true
      setTimeout(() => {
        if (!pasteWaiting.current) return
        pasteWaiting.current = false
        paste()
      }, 60)
    } else if (mod && key === 'd') {
      handled()
      duplicate()
    } else if (mod && key === 'a') {
      handled()
      setSelected(elements.filter((el) => !el.locked && !el.hidden).map((el) => el.id))
    } else if (e.key === ' ' && !mod && !e.altKey && target.tagName !== 'BUTTON') {
      // Held, a drag pans the canvas; let go without one on a selected text, it starts typing with the space.
      handled()
      if (!e.repeat) {
        space.current = { held: true, panned: false }
        setSpaceHeld(true)
      }
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
    } else if (single?.kind === 'text' && !single.locked && !mod && !e.altKey && e.key.length === 1) {
      // Typing on a selected text starts editing it with that letter.
      handled()
      setEditing({ id: single.id, initial: e.key })
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
      // A new lower third design past the free plan's one asks for the plan instead; the design stays open, unsaved.
      if (clean.category === 'lowerThird') {
        const saved = (await window.api.designs.list()).filter((d) => d.type === 'custom' && d.style.category === 'lowerThird').length
        if (!canSaveLowerThirdDesign(saved)) return askUpgrade('lowerThirds.designs')
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

  const commitText = (id: string, text: string) => {
    const element = elements.find((e) => e.id === id)
    if (element?.kind === 'text' && element.text !== text) patchElement(id, { text })
  }
  const stopEditing = () => {
    setEditing(null)
    setLiveText(null)
    rootRef.current?.focus()
  }
  const edit: InlineEdit | undefined =
    editing === null
      ? undefined
      : {
          id: editing.id,
          initial: editing.initial,
          onInput: setLiveText,
          onCommit: (text) => {
            commitText(editing.id, text)
            stopEditing()
          },
          onCancel: stopEditing,
          onTab: (text, back) => {
            commitText(editing.id, text)
            // On to the next text on the canvas (Shift: the one before), bottom layer first, round again at the end.
            const texts = elements.filter((e) => e.kind === 'text' && !e.hidden && !e.locked)
            const at = texts.findIndex((e) => e.id === editing.id)
            const next = texts[(at + (back ? -1 : 1) + texts.length) % texts.length]
            setLiveText(null)
            if (!next) return stopEditing()
            setSelected([next.id])
            setEditing({ id: next.id })
          },
        }

  const transparent = style.background.kind === 'transparent'
  const designer = (
    <div
      ref={rootRef}
      className="designer"
      role={page ? 'region' : 'dialog'}
      aria-label="Designer"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onPaste={onPaste}
    >
      <header className="designer-header">
        <button
          type="button"
          className="icon-button"
          aria-label={panels.layers ? 'Hide layers' : 'Show layers'}
          title={panels.layers ? 'Hide layers' : 'Show layers'}
          aria-pressed={panels.layers}
          onClick={() => setPanels((p) => ({ ...p, layers: !p.layers }))}
        >
          {panels.layers ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
        <input className="input designer-name" aria-label="Design name" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="input" aria-label="Kind of design" value={style.category} onChange={(e) => setCategory(e.target.value as DesignCategory)}>
          <option value="lowerThird">Lower third</option>
          <option value="slide">Slide</option>
        </select>
        <span className="designer-header-gap">
          {!custom && saved.type === 'builtin' && <span className="hint">Built-in designs cannot be changed: Save as new keeps your changes.</span>}
        </span>
        {custom && (
          <button type="button" className="button" onClick={() => void save(true)} title="A new design with these changes">
            <FilePlus size={14} aria-hidden="true" /> Save as new
          </button>
        )}
        <button type="button" className="button primary" disabled={custom && !dirty} onClick={() => void save(false)} title={`${MOD}S`}>
          <Save size={14} aria-hidden="true" /> {custom ? 'Save' : saved.type === 'builtin' ? 'Save as new' : 'Save to Designs'}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={panels.inspector ? 'Hide properties' : 'Show properties'}
          title={panels.inspector ? 'Hide properties' : 'Show properties'}
          aria-pressed={panels.inspector}
          onClick={() => setPanels((p) => ({ ...p, inspector: !p.inspector }))}
        >
          {panels.inspector ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
        <button type="button" className="icon-button" aria-label="Close" title="Close" onClick={close}>
          <X size={18} />
        </button>
      </header>

      <div className={`designer-body${panels.layers ? '' : ' no-layers'}${panels.inspector ? '' : ' no-inspector'}`}>
        {panels.layers && (
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
        )}

        <main
          ref={viewportRef}
          className={`designer-stage-area${spaceHeld ? ' space' : ''}${panning ? ' panning' : ''}`}
          onPointerDownCapture={startPan}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) emptyPress.current = true
          }}
          onPointerMove={movePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onDoubleClick={(e) => {
            if (emptyPress.current && (e.target === e.currentTarget || stageRef.current?.contains(e.target as Node))) fit()
          }}
        >
          <div
            ref={stageRef}
            className={`designer-stage${dragging ? ' dragging' : ''}${fileOver ? ' file-over' : ''}${backdrop === 'camera' ? ' camera' : ''}`}
            style={{
              left: CANVAS_PADDING + (area.width - canvas.width) / 2 + shownPan.x,
              top: CANVAS_PADDING + (area.height - canvas.height) / 2 + shownPan.y,
              width: canvas.width,
              height: canvas.height,
            }}
            aria-label="Canvas. Arrow keys move the selection; Shift moves it further. Type on a selected text to change its words."
            onDragOver={(e) => {
              if (!isFileDrag(e)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
              setFileOver(true)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFileOver(false)
            }}
            onDrop={(e) => {
              if (!isFileDrag(e)) return
              e.preventDefault()
              setFileOver(false)
              importFiles([...e.dataTransfer.files])
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              emptyPress.current = true
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
              <DesignView style={shown} edit={edit} checker placeholders warnings />
            )}
            <div className="designer-frames" hidden={playing !== null}>
              {elements.map((element) => {
                if (element.hidden || element.locked || element.id === editingId) return null
                const isSelected = selectedSet.has(element.id)
                const box = boxOf(element)
                return (
                  <div
                    key={element.id}
                    className={`designer-frame${isSelected ? ' selected' : ''}${element.fitToText ? ' fitted' : ''}`}
                    style={{
                      left: `${box.x}%`,
                      top: `${box.y}%`,
                      width: `${box.width}%`,
                      height: `${box.height}%`,
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
                        {element.kind === 'image' &&
                          element.slice &&
                          SIDES.map((side) => (
                            <span
                              key={side}
                              className={`designer-slice ${side}`}
                              style={{ [side]: `${element.slice![side]}%` }}
                              title={`9 slice: drag to set how much of the ${side} keeps its size`}
                              onPointerDown={(e) => startSlice(e, element, side)}
                            />
                          ))}
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

          <div className="designer-tools designer-float" role="toolbar" aria-label="Add and edit">
            <button type="button" className="button" onClick={() => add(newDesignElement('text', newId()))} title="Add text" aria-label="Text">
              <Type size={14} aria-hidden="true" /> <span className="designer-tool-label">Text</span>
            </button>
            <button type="button" className="button" onClick={() => add(newDesignElement('rect', newId()))} title="Add a rectangle" aria-label="Rectangle">
              <Square size={14} aria-hidden="true" /> <span className="designer-tool-label">Rectangle</span>
            </button>
            <button type="button" className="button" onClick={() => add(newDesignElement('line', newId()))} title="Add a line" aria-label="Line">
              <Minus size={14} aria-hidden="true" /> <span className="designer-tool-label">Line</span>
            </button>
            <button type="button" className="button" onClick={() => void addImage()} title="Add an image" aria-label="Image">
              <ImageIcon size={14} aria-hidden="true" /> <span className="designer-tool-label">Image</span>
            </button>
            <Locked feature="designs.figmaImport">
              <button type="button" className="button" aria-label="Import" onClick={() => fileRef.current?.click()} title={`Import design: an SVG (from Figma, Illustrator or Inkscape) or a PNG. You can also drop one on the canvas, or paste Figma's Copy as SVG with ${MOD}V`}>
                <FileUp size={14} aria-hidden="true" /> <span className="designer-tool-label">Import</span>
              </button>
            </Locked>
            <input
              ref={fileRef}
              type="file"
              accept={IMPORT_ACCEPT}
              multiple
              hidden
              onChange={(e) => {
                const files = [...(e.target.files ?? [])]
                e.target.value = ''
                if (files.length > 0) importFiles(files)
              }}
            />
            <span className="designer-tools-gap" />
            <button type="button" className={`button${playing ? ' primary' : ''}`} onClick={play} title="Play the elements' animation in, then out" aria-label={playing ? `Playing ${playing.phase}` : 'Play'} aria-pressed={playing !== null}>
              <Play size={14} aria-hidden="true" /> <span className="designer-tool-label">{playing ? `Playing ${playing.phase}` : 'Play'}</span>
            </button>
            <button type="button" className="button" onClick={buildInOrder} disabled={elements.length < 2} aria-label="Build in order" title="Build the elements one after another, bottom layer first, each fading in unless it has its own way in">
              <ListOrdered size={14} aria-hidden="true" /> <span className="designer-tool-label">Build in order</span>
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

          <div className="designer-notes">
            <ErrorNote error={error} />
            {imported && (
              <div className="designer-import-note" role="status">
                <span>
                  Imported.
                  {imported.links > 0 && ` ${imported.links === 1 ? 'A background sits' : `${imported.links} backgrounds sit`} behind text and can stretch with it.`}
                  {imported.warnings.map((w) => (
                    <span key={w} className="designer-import-warning">
                      <AlertTriangle size={12} aria-hidden="true" /> {w}
                    </span>
                  ))}
                </span>
                {imported.links > 0 && (
                  <button type="button" className="button primary" onClick={linkImported} title="Fit each background to the text on it and make that text Auto width; the design looks the same until the words change">
                    <Link2 size={14} aria-hidden="true" /> Make them stretch
                  </button>
                )}
                <button type="button" className="icon-button" aria-label="Dismiss" title="Dismiss" onClick={() => setImported(null)}>
                  <X size={14} />
                </button>
              </div>
            )}
          </div>

          <div className="designer-zoom designer-float" role="toolbar" aria-label="Zoom">
            <button type="button" className={`button${zoomMode.mode === 'fit' ? ' primary' : ''}`} aria-pressed={zoomMode.mode === 'fit'} title="Fit the canvas to the window (double-click empty canvas)" onClick={fit}>
              Fit
            </button>
            <button type="button" className="button" title="The output's size, 1920 by 1080" onClick={() => zoomTo(1)}>
              100%
            </button>
            <button type="button" className="button" onClick={() => zoomTo(2)}>
              200%
            </button>
            <input
              type="range"
              aria-label="Zoom"
              title="Zoom (scroll wheel); hold Space and drag to pan"
              min={Math.log2(ZOOM_MIN)}
              max={Math.log2(ZOOM_MAX)}
              step={0.01}
              value={Math.log2(Math.max(ZOOM_MIN, scale))}
              onChange={(e) => zoomTo(2 ** Number(e.target.value))}
            />
            <span className="designer-zoom-value">{Math.round(scale * 100)}%</span>
            {transparent && (
              <Segmented<Backdrop>
                label="Behind the design"
                value={backdrop}
                options={[
                  { value: 'checker', label: 'Checker' },
                  { value: 'camera', label: 'Camera' },
                ]}
                onChange={setBackdrop}
              />
            )}
            <span
              className="designer-help"
              role="img"
              aria-label="Canvas tips"
              title="Click text and type, or double-click it, to change the words: Enter keeps them, Esc cancels, Tab goes to the next text. Hold Alt to place without snapping, Shift to keep the shape or rotate in 15° steps. Drop or paste an SVG or PNG to import it. Scroll to zoom, hold Space and drag to pan, double-click empty canvas to fit."
            >
              <CircleHelp size={15} aria-hidden="true" />
            </span>
          </div>
        </main>

        {panels.inspector && (
          <aside className="designer-inspector" aria-label="Properties">
            {single ? (
              <ElementFields
                element={single}
                elements={elements}
                layout={layout}
                onChange={(patch, key) => patchElement(single.id, patch, key)}
                onStretch={stretch}
                pickImage={pickImage}
              />
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
        )}
      </div>
    </div>
  )
  // A page of the workspace or a dialog, it takes the whole window either way.
  return createPortal(<div className="designer-window">{designer}</div>, document.body)
}

// Designs: free layouts of text, rectangles, lines and images on a 16:9 canvas, for lower thirds and slides. The
// defaults, the built-in templates, validation and turning a lower third template into a design. Shared by the main
// process (database) and the renderer (the designer and the design renderer), like shared/lowerThirds.ts.

import { DESIGN_EASINGS, DESIGN_MOTIONS, MOTION_LIMITS, NO_ANIMATION } from './designAnimation'
import { migrateFontName } from './fonts'
import { fieldsOf, flag, hex, number, oneOf, text, TEXT_CASES } from './themes'
import type {
  DesignBackground,
  DesignCategory,
  DesignConstraints,
  DesignElement,
  DesignElementAnimation,
  DesignElementKind,
  DesignFill,
  DesignFitToText,
  DesignGrowth,
  DesignInsets,
  DesignLoop,
  DesignMotionStep,
  DesignShadow,
  DesignStyle,
  DesignTextField,
  DesignTextSizing,
  LowerThirdBox,
  LowerThirdStyle,
  ThemeBox,
} from './types'

// The ServiceEx brand: the accent blue (--accent in tokens.css), its bright form, and navy.
export const BRAND = {
  blue: '#0087cb',
  bright: '#00afef',
  navy: '#0b1f44',
  deep: '#0a0f1e',
  mist: '#cfe9f7',
  white: '#ffffff',
} as const

const FONT = 'Montserrat'

export const DESIGN_CATEGORIES: DesignCategory[] = ['lowerThird', 'slide']
export const DESIGN_FIELDS: DesignTextField[] = ['headline', 'body', 'number']
export const DESIGN_LOOPS: DesignLoop[] = ['none', 'pulse', 'float', 'glow', 'spin', 'shimmer']

export const NO_SHADOW: DesignShadow = { enabled: false, color: '#000000', opacity: 0.35, blur: 1.2, x: 0, y: 0.3 }
const SOFT_SHADOW: DesignShadow = { ...NO_SHADOW, enabled: true }

export const TEXT_SIZINGS: DesignTextSizing[] = ['fixed', 'autoWidth', 'autoHeight', 'shrink']
export const GROWTHS: DesignGrowth[] = ['right', 'left', 'down', 'up', 'center']
/** Where elements stay by default: as they were, at the lower third's top left. */
export const PINNED: DesignConstraints = { horizontal: 'left', vertical: 'top' }
export const NO_INSETS: DesignInsets = { top: 0, right: 0, bottom: 0, left: 0 }
/** How large stretching text grows by default, in percent of the canvas. */
export const DEFAULT_MAX = { width: 90, height: 40 } as const

export const KIND_NAMES: Record<DesignElementKind, string> = { text: 'Text', rect: 'Rectangle', line: 'Line', image: 'Image' }

type Text = Extract<DesignElement, { kind: 'text' }>
type Rect = Extract<DesignElement, { kind: 'rect' }>
type Line = Extract<DesignElement, { kind: 'line' }>
type Picture = Extract<DesignElement, { kind: 'image' }>

const base = (id: string, name: string, box: ThemeBox) => ({
  id,
  name,
  box,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  hideWithLowerThird: false,
  loop: 'none' as DesignLoop,
  animation: NO_ANIMATION,
  constraints: PINNED,
  fitToText: null,
})

export const textElement = (id: string, name: string, box: ThemeBox, overrides: Partial<Text> = {}): Text => ({
  ...base(id, name, box),
  kind: 'text',
  text: 'Text',
  field: null,
  fontFamily: FONT,
  fontWeight: 600,
  italic: false,
  fontSize: 4,
  // Auto fit on its own was Shrink to fit; off, the words keep their size.
  sizing: overrides.autoFit === false ? 'fixed' : 'shrink',
  autoFit: true,
  maxWidth: DEFAULT_MAX.width,
  maxHeight: DEFAULT_MAX.height,
  color: BRAND.white,
  align: 'left',
  verticalAlign: 'middle',
  lineHeight: 1.15,
  letterSpacing: 0,
  textCase: 'normal',
  shadow: NO_SHADOW,
  outline: { enabled: false, color: '#000000', width: 0.05 },
  ...overrides,
})

export const rectElement = (id: string, name: string, box: ThemeBox, overrides: Partial<Rect> = {}): Rect => ({
  ...base(id, name, box),
  kind: 'rect',
  fill: { kind: 'solid', color: BRAND.navy },
  radius: 0,
  border: { width: 0, color: BRAND.white },
  shadow: NO_SHADOW,
  ...overrides,
})

export const lineElement = (id: string, name: string, box: ThemeBox, overrides: Partial<Line> = {}): Line => ({
  ...base(id, name, box),
  kind: 'line',
  color: BRAND.bright,
  thickness: 0.4,
  dashed: false,
  ...overrides,
})

export const imageElement = (id: string, name: string, box: ThemeBox, overrides: Partial<Picture> = {}): Picture => ({
  ...base(id, name, box),
  kind: 'image',
  src: null,
  fit: 'contain',
  radius: 0,
  slice: null,
  ...overrides,
})

/** A new element of `kind` in the middle of the canvas, as the designer's Add buttons make it. */
export function newDesignElement(kind: DesignElementKind, id: string, name = KIND_NAMES[kind]): DesignElement {
  switch (kind) {
    case 'text':
      return textElement(id, name, { x: 30, y: 44, width: 40, height: 12 }, { text: 'Double-click to edit' })
    case 'rect':
      return rectElement(id, name, { x: 35, y: 40, width: 30, height: 20 }, { radius: 1 })
    case 'line':
      return lineElement(id, name, { x: 35, y: 49, width: 30, height: 2 })
    case 'image':
      return imageElement(id, name, { x: 40, y: 36, width: 20, height: 28 })
  }
}

export const EMPTY_DESIGN: Record<DesignCategory, DesignStyle> = {
  lowerThird: { category: 'lowerThird', background: { kind: 'transparent' }, elements: [] },
  slide: { category: 'slide', background: { kind: 'solid', color: BRAND.navy }, elements: [] },
}

const lowerThird = (elements: DesignElement[]): DesignStyle => ({ category: 'lowerThird', background: { kind: 'transparent' }, elements })

/** A square tile on the 16:9 canvas: `height` percent of the height is this much of the width. */
const square = (height: number) => Math.round(((height * 9) / 16) * 1000) / 1000

/** Seeded into the database on every start, so changes here reach existing installs. Names are their identity. */
export const BUILTIN_DESIGNS: { name: string; style: DesignStyle }[] = [
  {
    // A navy name plate with a blue accent edge, and the title on a blue tab under it.
    name: 'Name Bar',
    style: lowerThird([
      rectElement('bar', 'Name bar', { x: 5, y: 72, width: 40, height: 10 }, { shadow: SOFT_SHADOW }),
      rectElement('accent', 'Accent', { x: 5, y: 72, width: 0.9, height: 10 }, { fill: { kind: 'solid', color: BRAND.blue } }),
      textElement('name', 'Name', { x: 7, y: 72, width: 36, height: 10 }, { text: 'Pastor Sam Example', field: 'headline', fontSize: 4.8, fontWeight: 700 }),
      rectElement('tab', 'Title tab', { x: 5, y: 82, width: 30, height: 5.5 }, { fill: { kind: 'solid', color: BRAND.blue } }),
      textElement('title', 'Title', { x: 7, y: 82, width: 26, height: 5.5 }, {
        text: 'Lead Pastor',
        field: 'body',
        fontSize: 2.4,
        textCase: 'upper',
        letterSpacing: 0.08,
      }),
    ]),
  },
  {
    // One line on a navy bar with a blue edge.
    name: 'Simple Bar',
    style: lowerThird([
      rectElement('bar', 'Bar', { x: 5, y: 78, width: 50, height: 8 }),
      rectElement('accent', 'Accent', { x: 5, y: 78, width: 0.8, height: 8 }, { fill: { kind: 'solid', color: BRAND.blue } }),
      textElement('text', 'Text', { x: 7, y: 78, width: 46, height: 8 }, { text: 'Welcome to church', field: 'headline', fontSize: 3.6 }),
    ]),
  },
  {
    // A blue to navy card with a large title, a short rule and a subtitle.
    name: 'Title with Subtitle',
    style: lowerThird([
      rectElement('card', 'Card', { x: 5, y: 70, width: 48, height: 18 }, {
        fill: { kind: 'gradient', from: BRAND.blue, to: BRAND.navy, angle: 90 },
        radius: 1.2,
        shadow: SOFT_SHADOW,
      }),
      textElement('title', 'Title', { x: 8, y: 71.5, width: 42, height: 8 }, {
        text: 'Sunday Celebration',
        field: 'headline',
        fontSize: 5,
        fontWeight: 800,
        verticalAlign: 'bottom',
      }),
      lineElement('rule', 'Rule', { x: 8, y: 79.5, width: 10, height: 1 }, { color: BRAND.bright }),
      textElement('subtitle', 'Subtitle', { x: 8, y: 81, width: 42, height: 5.5 }, {
        text: 'Join us live every week at 10am',
        field: 'body',
        fontSize: 2.8,
        fontWeight: 500,
        color: BRAND.mist,
        verticalAlign: 'top',
      }),
    ]),
  },
  {
    // A blue number tile beside the point on a navy bar.
    name: 'Point with Number',
    style: lowerThird([
      rectElement('tile', 'Number tile', { x: 5, y: 74, width: square(14), height: 14 }, { fill: { kind: 'solid', color: BRAND.blue }, radius: 0.8 }),
      textElement('number', 'Number', { x: 5, y: 74, width: square(14), height: 14 }, {
        text: '1',
        field: 'number',
        fontSize: 9,
        fontWeight: 800,
        align: 'center',
      }),
      rectElement('bar', 'Point bar', { x: 13.5, y: 74, width: 52, height: 14 }, { radius: 0.8, shadow: SOFT_SHADOW }),
      textElement('point', 'Point', { x: 15.5, y: 74, width: 48, height: 14 }, { text: "Grace is God's gift, not our wages", field: 'headline', fontSize: 4 }),
    ]),
  },
  {
    // A quote on a navy card, with a large bright quote mark and the speaker under it.
    name: 'Quote',
    style: lowerThird([
      rectElement('card', 'Card', { x: 10, y: 64, width: 80, height: 26 }, { radius: 1.5, opacity: 0.92, shadow: SOFT_SHADOW }),
      textElement('mark', 'Quote mark', { x: 11.5, y: 62, width: 6, height: 14 }, {
        text: '“',
        fontFamily: 'Playfair Display',
        fontSize: 14,
        fontWeight: 800,
        color: BRAND.bright,
        autoFit: false,
        verticalAlign: 'top',
      }),
      textElement('quote', 'Quote', { x: 18, y: 67, width: 68, height: 15 }, {
        text: "Faith is taking the first step even when you don't see the whole staircase.",
        field: 'headline',
        fontSize: 3.6,
        fontWeight: 500,
        italic: true,
      }),
      textElement('speaker', 'Speaker', { x: 18, y: 82.5, width: 68, height: 5 }, {
        text: 'Martin Luther King Jr.',
        field: 'body',
        fontSize: 2.4,
        color: BRAND.bright,
        align: 'right',
      }),
    ]),
  },
  {
    // Edge to edge along the bottom under a blue rule, two centred lines inside the title safe area.
    name: 'Full Width Bar',
    style: lowerThird([
      rectElement('bar', 'Bar', { x: 0, y: 80, width: 100, height: 12 }, { fill: { kind: 'gradient', from: BRAND.navy, to: BRAND.deep, angle: 90 } }),
      lineElement('rule', 'Top rule', { x: 0, y: 79.5, width: 100, height: 1 }, { color: BRAND.blue, thickness: 0.6 }),
      textElement('headline', 'Headline', { x: 10, y: 80.5, width: 80, height: 6.5 }, {
        text: 'Welcome to our service',
        field: 'headline',
        fontSize: 3.8,
        fontWeight: 700,
        align: 'center',
      }),
      textElement('body', 'Body', { x: 10, y: 86.5, width: 80, height: 4.5 }, {
        text: 'Find us online at example.church',
        field: 'body',
        fontSize: 2.4,
        fontWeight: 500,
        color: BRAND.mist,
        align: 'center',
      }),
    ]),
  },
]

/** The words a text element shows: its field's value when one is given, else its own words (the sample). */
export function shownText(element: Text, fields?: Partial<Record<DesignTextField, string>>): string {
  const value = element.field ? fields?.[element.field] : undefined
  return value ?? element.text
}

// ---------- From a lower third template ----------

/** A lower third template as a design, with `sample` as the words of its headline and body. */
export function designFromLowerThird(style: LowerThirdStyle, sample: { headline: string; body: string }): DesignStyle {
  const f = style.frame
  const inFrame = (b: LowerThirdBox): ThemeBox => ({
    x: f.x + (b.x * f.width) / 100,
    y: f.y + (b.y * f.height) / 100,
    width: (b.width * f.width) / 100,
    height: (b.height * f.height) / 100,
  })
  const elements: DesignElement[] = []
  if (style.bar.enabled) elements.push(rectElement('bar', 'Bar', { ...f }, { fill: { kind: 'solid', color: style.bar.color } }))
  if (style.accent.enabled) {
    const { side, size, color } = style.accent
    const box =
      side === 'left'
        ? { x: f.x, y: f.y, width: (size * f.width) / 100, height: f.height }
        : { x: f.x, y: side === 'top' ? f.y : f.y + f.height - (size * f.height) / 100, width: f.width, height: (size * f.height) / 100 }
    elements.push(rectElement('accent', 'Accent', box, { fill: { kind: 'solid', color } }))
  }
  if (style.logo.enabled && style.logo.url) elements.push(imageElement('logo', 'Logo', inFrame(style.logo.box), { src: style.logo.url }))
  for (const field of ['headline', 'body'] as const) {
    const t = style[field]
    elements.push(
      textElement(field, field === 'headline' ? 'Headline' : 'Body', inFrame(t.box), {
        text: sample[field],
        field,
        fontFamily: t.fontFamily,
        fontWeight: t.fontWeight,
        italic: t.italic,
        fontSize: t.size,
        color: t.color,
        textCase: t.textCase,
        align: style.align,
        outline: { ...style.outline },
      }),
    )
  }
  return lowerThird(elements)
}

// ---------- Validation ----------
// Designs come from the database, the renderer and older versions of this file, so every field is checked.

const media = (value: unknown): string | null => (typeof value === 'string' && value.startsWith('wd-media://') ? value : null)

function normalizeBox(value: unknown, fallback: ThemeBox): ThemeBox {
  const v = fieldsOf(value)
  return {
    x: number(v.x, fallback.x, -100, 200),
    y: number(v.y, fallback.y, -100, 200),
    width: number(v.width, fallback.width, 0.2, 300),
    height: number(v.height, fallback.height, 0.2, 300),
  }
}

function normalizeShadow(value: unknown): DesignShadow {
  const v = fieldsOf(value)
  const d = NO_SHADOW
  return {
    enabled: flag(v.enabled, d.enabled),
    color: hex(v.color, d.color),
    opacity: number(v.opacity, d.opacity, 0, 1),
    blur: number(v.blur, d.blur, 0, 20),
    x: number(v.x, d.x, -20, 20),
    y: number(v.y, d.y, -20, 20),
  }
}

function normalizeFill(value: unknown, fallback: DesignFill): DesignFill {
  const v = fieldsOf(value)
  if (v.kind === 'gradient') return { kind: 'gradient', from: hex(v.from, BRAND.blue), to: hex(v.to, BRAND.navy), angle: number(v.angle, 90, -360, 360) }
  if (v.kind === 'solid') return { kind: 'solid', color: hex(v.color, BRAND.navy) }
  return fallback
}

function normalizeBackground(value: unknown, category: DesignCategory): DesignBackground {
  const v = fieldsOf(value)
  switch (v.kind) {
    case 'transparent':
      return { kind: 'transparent' }
    case 'solid':
      return { kind: 'solid', color: hex(v.color, BRAND.navy) }
    case 'gradient':
      return { kind: 'gradient', from: hex(v.from, BRAND.blue), to: hex(v.to, BRAND.navy), angle: number(v.angle, 135, -360, 360) }
    case 'image': {
      const src = media(v.src)
      if (src) return { kind: 'image', src, fit: oneOf(v.fit, ['cover', 'contain'], 'cover') }
    }
  }
  return EMPTY_DESIGN[category].background
}

function normalizeInsets(value: unknown, max: number): DesignInsets {
  const v = fieldsOf(value)
  return { top: number(v.top, 0, 0, max), right: number(v.right, 0, 0, max), bottom: number(v.bottom, 0, 0, max), left: number(v.left, 0, 0, max) }
}

function normalizeFit(value: unknown): DesignFitToText | null {
  if (value === null || typeof value !== 'object') return null
  const v = fieldsOf(value)
  const textId = text(v.textId, '').slice(0, 64)
  if (!textId) return null
  return {
    textId,
    padding: normalizeInsets(v.padding, 100),
    minWidth: number(v.minWidth, 0, 0, 300),
    maxWidth: number(v.maxWidth, 0, 0, 300),
    anchor: oneOf(v.anchor, GROWTHS, 'right'),
    axes: oneOf(v.axes, ['both', 'width', 'height'], 'both'),
  }
}

function normalizeConstraints(value: unknown): DesignConstraints {
  const v = fieldsOf(value)
  return {
    horizontal: oneOf(v.horizontal, ['left', 'right', 'center', 'scale'], PINNED.horizontal),
    vertical: oneOf(v.vertical, ['top', 'bottom', 'center', 'scale'], PINNED.vertical),
  }
}

function normalizeStep(value: unknown, fallback: DesignMotionStep): DesignMotionStep {
  const v = fieldsOf(value)
  return {
    motion: oneOf(v.motion, DESIGN_MOTIONS, fallback.motion),
    durationMs: Math.round(number(v.durationMs, fallback.durationMs, ...MOTION_LIMITS.durationMs)),
    delayMs: Math.round(number(v.delayMs, fallback.delayMs, ...MOTION_LIMITS.delayMs)),
    easing: oneOf(v.easing, DESIGN_EASINGS, fallback.easing),
  }
}

function normalizeAnimation(value: unknown): DesignElementAnimation {
  const v = fieldsOf(value)
  return {
    in: normalizeStep(v.in, NO_ANIMATION.in),
    out: normalizeStep(v.out, NO_ANIMATION.out),
    order: Math.round(number(v.order, 0, ...MOTION_LIMITS.order)),
  }
}

function normalizeElement(value: unknown): DesignElement | null {
  const v = fieldsOf(value)
  const kind = oneOf<DesignElementKind | ''>(v.kind, ['text', 'rect', 'line', 'image'], '')
  if (!kind) return null
  const d = newDesignElement(kind, '')
  const common = {
    id: text(v.id, '').slice(0, 64),
    name: text(v.name, d.name).slice(0, 100),
    box: normalizeBox(v.box, d.box),
    rotation: number(v.rotation, 0, -180, 180),
    opacity: number(v.opacity, 1, 0, 1),
    locked: flag(v.locked, false),
    hidden: flag(v.hidden, false),
    hideWithLowerThird: flag(v.hideWithLowerThird, false),
    loop: oneOf(v.loop, DESIGN_LOOPS, 'none'),
    animation: normalizeAnimation(v.animation),
    constraints: normalizeConstraints(v.constraints),
    // Only shapes and pictures follow a text element.
    fitToText: kind === 'text' ? null : normalizeFit(v.fitToText),
  }
  switch (d.kind) {
    case 'text': {
      const outline = fieldsOf(v.outline)
      const autoFit = flag(v.autoFit, d.autoFit)
      return {
        ...d,
        ...common,
        text: text(v.text, d.text).slice(0, 2000),
        field: v.field === null ? null : oneOf<DesignTextField | ''>(v.field, DESIGN_FIELDS, '') || null,
        fontFamily: migrateFontName(text(v.fontFamily, d.fontFamily)),
        fontWeight: Math.round(number(v.fontWeight, d.fontWeight, 100, 900) / 100) * 100,
        italic: flag(v.italic, d.italic),
        fontSize: number(v.fontSize, d.fontSize, 0.5, 60),
        // Designs from before sizing had only auto fit: on was Shrink to fit, off kept the words' size.
        sizing: oneOf(v.sizing, TEXT_SIZINGS, autoFit ? 'shrink' : 'fixed'),
        autoFit,
        maxWidth: number(v.maxWidth, d.maxWidth, 1, 300),
        maxHeight: number(v.maxHeight, d.maxHeight, 1, 300),
        color: hex(v.color, d.color),
        align: oneOf(v.align, ['left', 'center', 'right'], d.align),
        verticalAlign: oneOf(v.verticalAlign, ['top', 'middle', 'bottom'], d.verticalAlign),
        lineHeight: number(v.lineHeight, d.lineHeight, 0.6, 3),
        letterSpacing: number(v.letterSpacing, d.letterSpacing, -0.2, 1),
        textCase: oneOf(v.textCase, TEXT_CASES, d.textCase),
        shadow: normalizeShadow(v.shadow),
        outline: { enabled: flag(outline.enabled, false), color: hex(outline.color, '#000000'), width: number(outline.width, 0.05, 0.01, 0.3) },
      }
    }
    case 'rect': {
      const border = fieldsOf(v.border)
      return {
        ...d,
        ...common,
        fill: normalizeFill(v.fill, d.fill),
        radius: number(v.radius, d.radius, 0, 50),
        border: { width: number(border.width, 0, 0, 10), color: hex(border.color, d.border.color) },
        shadow: normalizeShadow(v.shadow),
      }
    }
    case 'line':
      return { ...d, ...common, color: hex(v.color, d.color), thickness: number(v.thickness, d.thickness, 0.05, 20), dashed: flag(v.dashed, false) }
    case 'image':
      return {
        ...d,
        ...common,
        src: media(v.src),
        fit: oneOf(v.fit, ['contain', 'cover'], d.fit),
        radius: number(v.radius, 0, 0, 50),
        slice: v.slice && typeof v.slice === 'object' ? normalizeInsets(v.slice, 49) : null,
      }
  }
}

export function normalizeDesign(value: unknown): DesignStyle {
  const v = fieldsOf(value)
  const category = oneOf(v.category, DESIGN_CATEGORIES, 'lowerThird')
  const used = new Set<string>()
  const elements: DesignElement[] = []
  for (const item of Array.isArray(v.elements) ? v.elements.slice(0, 200) : []) {
    const element = normalizeElement(item)
    if (!element) continue
    // Every element needs its own id: the designer selects by it.
    let id = element.id || element.kind
    for (let n = 2; used.has(id); n++) id = `${element.id || element.kind}-${n}`
    used.add(id)
    elements.push({ ...element, id })
  }
  return { category, background: normalizeBackground(v.background, category), elements }
}

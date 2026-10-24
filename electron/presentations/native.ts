// Native mode: rebuilds the slides of a .pptx as themes (see PresentationMode), so they draw through the same
// pipeline as songs and scripture. Each slide's background, text boxes (paragraphs and runs with their font, size,
// color, weight, alignment, spacing, shadow and outline), pictures and solid rectangles become theme elements in
// percent of the screen. A video or animated GIF covering most of the slide becomes its motion background.
//
// Anything Native mode cannot draw faithfully (SmartArt, charts, tables, WordArt effects, shapes other than solid
// rectangles, rotation, cropping) makes that slide show its Image mode picture instead, with a warning saying why,
// so nothing goes missing without a word. Reading needs no PowerPoint: the .pptx is a zip of XML parts.

import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { XMLParser } from 'fast-xml-parser'
import JSZip from 'jszip'
import type { NativeSlide, ThemeBackground, ThemeBox, ThemeElement, ThemeStyle, ThemeTextParagraph, ThemeTextProps, ThemeTextRun } from '../../shared/types'
import { convertToMp4, needsConversion } from './ffmpeg'

/** A media covering at least this share of the slide is its background. */
export const BACKGROUND_COVERAGE = 0.8
/** The screen the slides are fitted onto, letterboxed when their shape differs. */
const SCREEN_ASPECT = 16 / 9
const EMU_PER_POINT = 12700
const MAX_ELEMENTS = 50
/** Image sources inside a draft until the pictures are stored. */
const PART_PREFIX = 'pptx-part:'
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']

// ---------- XML helpers ----------

/** fast-xml-parser's preserveOrder shape: { tagName: children, ':@': attributes } or { '#text': text }. */
type XmlNode = Record<string, unknown>

const xmlParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  trimValues: false, // the spaces in a:t between runs matter
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: true,
})

function tagOf(node: XmlNode): string | undefined {
  return Object.keys(node).find((key) => key !== ':@' && key !== '#text')
}

/** Local name: p:sp and a:p are matched as "sp" and "p". */
function nameOf(node: XmlNode): string | undefined {
  return tagOf(node)?.replace(/^.*:/, '')
}

function childrenOf(node: XmlNode | undefined): XmlNode[] {
  const tag = node && tagOf(node)
  return tag && Array.isArray(node[tag]) ? (node[tag] as XmlNode[]).filter((c) => tagOf(c) !== undefined) : []
}

function attr(node: XmlNode | undefined, name: string): string | undefined {
  return (node?.[':@'] as Record<string, string> | undefined)?.[`@_${name}`]
}

function numberAttr(node: XmlNode | undefined, name: string): number | undefined {
  const value = attr(node, name)
  return value === undefined || value === '' || !Number.isFinite(Number(value)) ? undefined : Number(value)
}

/** The first child by local name, following a path of names. */
function child(node: XmlNode | undefined, ...names: string[]): XmlNode | undefined {
  let current = node
  for (const name of names) current = childrenOf(current).find((c) => nameOf(c) === name)
  return current
}

function childList(node: XmlNode | undefined, name: string): XmlNode[] {
  return childrenOf(node).filter((c) => nameOf(c) === name)
}

function textOf(node: XmlNode | undefined): string {
  if (!node) return ''
  const tag = tagOf(node)
  const content = tag ? (node[tag] as XmlNode[]) : []
  return Array.isArray(content) ? content.map((c) => ('#text' in c ? String(c['#text']) : '')).join('') : ''
}

function rootOf(xml: string): XmlNode | undefined {
  return (xmlParser.parse(xml) as XmlNode[]).find((node) => tagOf(node) !== undefined && !tagOf(node)?.startsWith('?'))
}

// ---------- Package parts ----------

interface Relationship {
  type: string
  /** A part path in the zip, or for an external link, the target as written. */
  target: string
  external: boolean
}

interface Part {
  path: string
  root: XmlNode
  rels: Map<string, Relationship>
}

async function readPart(zip: JSZip, partPath: string): Promise<Part | null> {
  const file = zip.file(partPath)
  if (!file) return null
  const root = rootOf(await file.async('string'))
  if (!root) return null
  const rels = new Map<string, Relationship>()
  const relsFile = zip.file(path.posix.join(path.posix.dirname(partPath), '_rels', `${path.posix.basename(partPath)}.rels`))
  if (relsFile) {
    for (const rel of childList(rootOf(await relsFile.async('string')), 'Relationship')) {
      const id = attr(rel, 'Id')
      const target = attr(rel, 'Target')
      if (!id || !target) continue
      const external = attr(rel, 'TargetMode') === 'External'
      rels.set(id, {
        type: attr(rel, 'Type') ?? '',
        target: external ? target : path.posix.normalize(target.startsWith('/') ? target.slice(1) : path.posix.join(path.posix.dirname(partPath), target)),
        external,
      })
    }
  }
  return { path: partPath, root, rels }
}

const relOfType = (part: Part, suffix: string) => [...part.rels.values()].find((rel) => rel.type.endsWith(suffix))

// ---------- Colors ----------

interface ThemeInfo {
  colors: Record<string, string>
  majorFont: string
  minorFont: string
  fillStyles: XmlNode[]
  backgroundFillStyles: XmlNode[]
}

interface ColorContext {
  theme: ThemeInfo
  /** The master's color map: bg1 → lt1 and so on. */
  colorMap: Record<string, string>
  /** What phClr means inside a style reference. */
  placeholderColor?: Color
}

interface Color {
  hex: string
  alpha: number
}

const PRESET_COLORS: Record<string, string> = {
  black: '000000',
  white: 'ffffff',
  red: 'ff0000',
  green: '008000',
  blue: '0000ff',
  yellow: 'ffff00',
  gray: '808080',
  grey: '808080',
  orange: 'ffa500',
  purple: '800080',
}

const COLOR_TAGS = ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr']

function toRgb(hex: string): [number, number, number] {
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}

const toHex = (rgb: number[]) => `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`

function rgbToHsl([r, g, b]: number[]): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
  return [h / 6, s, l]
}

function hslToRgb([h, s, l]: number[]): number[] {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (u < 1 / 6) return p + (q - p) * 6 * u
    if (u < 1 / 2) return q
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6
    return p
  }
  return [channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255]
}

/** A color element (a:srgbClr, a:schemeClr...) with its modifiers applied. */
function colorElement(node: XmlNode, ctx: ColorContext): Color | null {
  const name = nameOf(node)
  let hex: string | undefined
  let alpha = 1
  if (name === 'srgbClr') hex = attr(node, 'val')
  else if (name === 'sysClr') hex = attr(node, 'lastClr')
  else if (name === 'prstClr') hex = PRESET_COLORS[attr(node, 'val') ?? '']
  else if (name === 'schemeClr') {
    const val = attr(node, 'val') ?? ''
    if (val === 'phClr') {
      if (!ctx.placeholderColor) return null
      hex = ctx.placeholderColor.hex.slice(1)
      alpha = ctx.placeholderColor.alpha
    } else hex = ctx.theme.colors[ctx.colorMap[val] ?? val]
  } else if (name === 'scrgbClr') {
    hex = toHex(['r', 'g', 'b'].map((c) => ((numberAttr(node, c) ?? 0) / 100000) * 255)).slice(1)
  } else if (name === 'hslClr') {
    hex = toHex(hslToRgb([(numberAttr(node, 'hue') ?? 0) / 21600000, (numberAttr(node, 'sat') ?? 0) / 100000, (numberAttr(node, 'lum') ?? 0) / 100000])).slice(1)
  }
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return null
  let rgb: number[] = toRgb(hex.toLowerCase())
  let lumMod = 1
  let lumOff = 0
  for (const mod of childrenOf(node)) {
    const val = (numberAttr(mod, 'val') ?? 100000) / 100000
    switch (nameOf(mod)) {
      case 'alpha':
        alpha = val
        break
      case 'lumMod':
        lumMod = val
        break
      case 'lumOff':
        lumOff = val
        break
      case 'tint':
        rgb = rgb.map((c) => c + (255 - c) * (1 - val))
        break
      case 'shade':
        rgb = rgb.map((c) => c * val)
        break
    }
  }
  if (lumMod !== 1 || lumOff !== 0) {
    const [h, s, l] = rgbToHsl(rgb)
    rgb = hslToRgb([h, s, Math.min(1, Math.max(0, l * lumMod + lumOff))])
  }
  return { hex: toHex(rgb), alpha }
}

/** The color inside a container such as a:solidFill or a:fontRef. */
function colorIn(container: XmlNode | undefined, ctx: ColorContext): Color | null {
  const node = childrenOf(container).find((c) => COLOR_TAGS.includes(nameOf(c) ?? ''))
  return node ? colorElement(node, ctx) : null
}

// ---------- Fills ----------

type Fill =
  | { kind: 'none' }
  | { kind: 'solid'; color: Color }
  | { kind: 'gradient'; from: string; to: string; angle: number }
  | { kind: 'image'; part: string }
  | { kind: 'other'; what: string }

const FILL_TAGS = ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill']

/** The fill a properties element (spPr, bgPr) sets, or undefined when it sets none. */
function fillOf(container: XmlNode | undefined, ctx: ColorContext, part: Part): Fill | undefined {
  const node = childrenOf(container).find((c) => FILL_TAGS.includes(nameOf(c) ?? ''))
  return node && fillNode(node, ctx, part)
}

function fillNode(node: XmlNode, ctx: ColorContext, part: Part): Fill {
  switch (nameOf(node)) {
    case 'solidFill': {
      const color = colorIn(node, ctx)
      return color ? { kind: 'solid', color } : { kind: 'none' }
    }
    case 'gradFill': {
      const stops = childList(child(node, 'gsLst'), 'gs')
        .map((gs) => ({ pos: numberAttr(gs, 'pos') ?? 0, color: colorIn(gs, ctx) }))
        .filter((s): s is { pos: number; color: Color } => s.color !== null)
        .sort((a, b) => a.pos - b.pos)
      if (stops.length === 0) return { kind: 'none' }
      // PowerPoint's 0° runs left to right, which is CSS's 90°.
      const angle = ((numberAttr(child(node, 'lin'), 'ang') ?? 5400000) / 60000 + 90) % 360
      return { kind: 'gradient', from: stops[0].color.hex, to: stops[stops.length - 1].color.hex, angle }
    }
    case 'blipFill': {
      const id = attr(child(node, 'blip'), 'r:embed')
      const rel = id ? part.rels.get(id) : undefined
      return rel && !rel.external ? { kind: 'image', part: rel.target } : { kind: 'other', what: 'linked pictures' }
    }
    case 'pattFill':
      return { kind: 'other', what: 'pattern fills' }
    default:
      return { kind: 'none' }
  }
}

/** A theme fill style a style reference (fillRef, bgRef) points at, drawn with the reference's color. */
function styleFill(ref: XmlNode | undefined, ctx: ColorContext, part: Part, list: 'fill' | 'background'): Fill | undefined {
  const idx = numberAttr(ref, 'idx')
  if (!ref || !idx) return undefined
  const placeholderColor = colorIn(ref, ctx) ?? undefined
  const styles = list === 'background' && idx >= 1001 ? ctx.theme.backgroundFillStyles : ctx.theme.fillStyles
  const node = styles[(idx >= 1001 ? idx - 1001 : idx - 1) as number]
  if (!node) return placeholderColor ? { kind: 'solid', color: placeholderColor } : undefined
  return fillNode(node, { ...ctx, placeholderColor }, part)
}

// ---------- The deck ----------

interface Screen {
  /** The 16:9 screen in slide units (EMU), with the slide's top-left corner at x, y inside it. */
  x: number
  y: number
  width: number
  height: number
  slideWidth: number
  slideHeight: number
}

interface Master {
  part: Part
  theme: ThemeInfo
  colorMap: Record<string, string>
}

interface Context {
  zip: JSZip
  screen: Screen
  defaultTextStyle: XmlNode | undefined
  master: Master
  layout: Part
  slide: Part
  ctx: ColorContext
  /** The slide's number among the visible slides, for warnings. */
  slideNumber: number
  /** The original's folder, for clips it links to. */
  sourceDir: string
}

async function readTheme(zip: JSZip, part: Part | null): Promise<ThemeInfo> {
  const themePart = part && relOfType(part, '/theme')
  const root = themePart ? (await readPart(zip, themePart.target))?.root : undefined
  const elements = child(root, 'themeElements')
  const colors: Record<string, string> = {}
  for (const entry of childrenOf(child(elements, 'clrScheme'))) {
    const node = childrenOf(entry)[0]
    const hex = node && (nameOf(node) === 'sysClr' ? attr(node, 'lastClr') : attr(node, 'val'))
    if (hex && /^[0-9a-f]{6}$/i.test(hex)) colors[nameOf(entry) as string] = hex.toLowerCase()
  }
  const font = (kind: string) => attr(child(elements, 'fontScheme', kind, 'latin'), 'typeface') ?? ''
  const formats = child(elements, 'fmtScheme')
  return {
    colors,
    majorFont: font('majorFont'),
    minorFont: font('minorFont'),
    fillStyles: childrenOf(child(formats, 'fillStyleLst')),
    backgroundFillStyles: childrenOf(child(formats, 'bgFillStyleLst')),
  }
}

function fitScreen(slideWidth: number, slideHeight: number): Screen {
  const width = Math.max(slideWidth, slideHeight * SCREEN_ASPECT)
  const height = width / SCREEN_ASPECT
  return { x: (width - slideWidth) / 2, y: (height - slideHeight) / 2, width, height, slideWidth, slideHeight }
}

/** A box in slide units, before it is placed on the screen. */
interface Rect {
  x: number
  y: number
  cx: number
  cy: number
}

/** A group's mapping of its children's coordinates onto the slide. */
type Transform = (rect: Rect) => Rect

const identity: Transform = (rect) => rect

function rectOf(xfrm: XmlNode | undefined): Rect | null {
  const off = child(xfrm, 'off')
  const ext = child(xfrm, 'ext')
  if (!off || !ext) return null
  return { x: numberAttr(off, 'x') ?? 0, y: numberAttr(off, 'y') ?? 0, cx: numberAttr(ext, 'cx') ?? 0, cy: numberAttr(ext, 'cy') ?? 0 }
}

/** The box on the screen in percent, clipped to it; null when nothing of it shows. */
function screenBox(rect: Rect, screen: Screen): ThemeBox | null {
  const left = Math.max(0, ((screen.x + rect.x) / screen.width) * 100)
  const top = Math.max(0, ((screen.y + rect.y) / screen.height) * 100)
  const right = Math.min(100, ((screen.x + rect.x + rect.cx) / screen.width) * 100)
  const bottom = Math.min(100, ((screen.y + rect.y + rect.cy) / screen.height) * 100)
  if (right - left < 0.05 || bottom - top < 0.05) return null
  const round = (n: number) => Math.round(n * 1000) / 1000
  return { x: round(left), y: round(top), width: round(right - left), height: round(bottom - top) }
}

/** How much of the slide a rectangle covers, 0 to 1. */
function coverage(rect: Rect, screen: Screen): number {
  const width = Math.max(0, Math.min(rect.x + rect.cx, screen.slideWidth) - Math.max(rect.x, 0))
  const height = Math.max(0, Math.min(rect.y + rect.cy, screen.slideHeight) - Math.max(rect.y, 0))
  return (width * height) / (screen.slideWidth * screen.slideHeight)
}

/** Points to percent of screen height. */
const pointsToScreen = (points: number, screen: Screen) => ((points * EMU_PER_POINT) / screen.height) * 100

const rotated = (xfrm: XmlNode | undefined) => (numberAttr(xfrm, 'rot') ?? 0) % 21600000 !== 0

// ---------- Text ----------

type Placeholder = { type: string; idx: string | undefined }

function placeholderOf(shape: XmlNode): Placeholder | null {
  const nv = childrenOf(shape).find((c) => /^nv\w*Pr$/.test(nameOf(c) ?? ''))
  const ph = child(nv, 'nvPr', 'ph')
  return ph ? { type: attr(ph, 'type') ?? 'obj', idx: attr(ph, 'idx') } : null
}

const MASTER_TYPES: Record<string, string> = { ctrTitle: 'title', subTitle: 'body', obj: 'body' }

/** The layout's or master's shape a slide placeholder inherits from: by index, then by type. */
function findPlaceholder(part: Part, ph: Placeholder, master: boolean): XmlNode | undefined {
  const shapes = childrenOf(child(part.root, 'cSld', 'spTree')).filter((c) => nameOf(c) === 'sp')
  const withPh = shapes.map((shape) => ({ shape, ph: placeholderOf(shape) })).filter((s) => s.ph)
  if (master) {
    const type = MASTER_TYPES[ph.type] ?? ph.type
    return (withPh.find((s) => (MASTER_TYPES[s.ph!.type] ?? s.ph!.type) === type) ?? withPh.find((s) => s.ph!.type === 'body'))?.shape
  }
  return (
    (ph.idx !== undefined ? withPh.find((s) => s.ph!.idx === ph.idx) : undefined) ??
    withPh.find((s) => s.ph!.type === ph.type) ??
    (ph.type === 'obj' ? withPh.find((s) => s.ph!.type === 'body') : undefined)
  )?.shape
}

/** The master text style a placeholder starts from. */
function masterStyle(master: Master, ph: Placeholder | null): XmlNode | undefined {
  if (!ph) return undefined
  const styles = child(master.part.root, 'txStyles')
  if (ph.type === 'title' || ph.type === 'ctrTitle') return child(styles, 'titleStyle')
  if (['body', 'subTitle', 'obj'].includes(ph.type)) return child(styles, 'bodyStyle')
  return child(styles, 'otherStyle')
}

/** One link in the inheritance chain of a paragraph: a level's pPr, from most to least specific. */
type Level = XmlNode | undefined

interface TextChain {
  /** List styles to read a level from, most specific first: the shape's, the layout's, the master's, the defaults. */
  lists: (XmlNode | undefined)[]
  /** bodyPr from the shape, then its layout and master placeholders. */
  bodies: (XmlNode | undefined)[]
  /** The shape style's font reference (p:style/a:fontRef). */
  fontRef: XmlNode | undefined
}

/** The first value a getter finds along the chain. */
function first<T>(nodes: (XmlNode | undefined)[], get: (node: XmlNode) => T | undefined): T | undefined {
  return firstAt(nodes, get)?.value
}

/** The first value a getter finds along the chain, with where it was found. */
function firstAt<T>(nodes: (XmlNode | undefined)[], get: (node: XmlNode) => T | undefined): { value: T; index: number } | undefined {
  for (const [index, node] of nodes.entries()) {
    if (!node) continue
    const value = get(node)
    if (value !== undefined) return { value, index }
  }
  return undefined
}

/**
 * In a run's chain (the run, its paragraph, the shape's list style, then inherited styles), the shape style's font
 * reference outranks everything from the shape's list style on.
 */
const OWN_PROPS = 3

interface RunLook {
  points: number
  font: string
  color: Color
  bold: boolean
  italic: boolean
  underline: boolean
  caps: boolean
  shadow: XmlNode | undefined
  outline: XmlNode | undefined
}

const ALIGNMENTS: Record<string, 'left' | 'center' | 'right'> = { l: 'left', ctr: 'center', r: 'right', just: 'left', dist: 'center' }
const WORDART_EFFECTS = ['glow', 'reflection', 'innerShdw', 'prstShdw', 'softEdge']

interface TextResult {
  element: ThemeElement
  /** Why the box cannot be drawn natively. */
  unsupported: string[]
}

/**
 * A text box: paragraphs and runs with their look resolved through the shape, its layout and master placeholders,
 * the master's text styles and the presentation defaults.
 */
function textBox(c: Context, id: string, txBody: XmlNode, chain: TextChain, rect: Rect, shapeShadow: XmlNode | undefined): TextResult | null {
  const unsupported: string[] = []
  const bodyPr = chain.bodies[0]
  const warp = attr(child(bodyPr, 'prstTxWarp'), 'prst')
  if (warp && warp !== 'textNoShape') unsupported.push('WordArt effects')
  if (child(bodyPr, 'scene3d') || child(bodyPr, 'sp3d')) unsupported.push('WordArt effects')
  const vert = first(chain.bodies, (b) => attr(b, 'vert'))
  if (vert && vert !== 'horz') unsupported.push('vertical text')

  const autofit = child(bodyPr, 'normAutofit')
  const fontScale = (numberAttr(autofit, 'fontScale') ?? 100000) / 100000
  const spacingReduction = (numberAttr(autofit, 'lnSpcReduction') ?? 0) / 100000
  const textColor = c.master.theme.colors[c.master.colorMap.tx1 ?? 'dk1']
  const refColor = colorIn(chain.fontRef, c.ctx)
  const refFont = chain.fontRef ? (attr(chain.fontRef, 'idx') === 'major' ? '+mj-lt' : '+mn-lt') : undefined

  const look = (levels: Level[], rPr: XmlNode | undefined): RunLook => {
    const props = [rPr, ...levels.map((level) => child(level, 'defRPr'))]
    const fill = (node: XmlNode) => childrenOf(node).find((n) => ['solidFill', 'gradFill', 'blipFill', 'pattFill', 'noFill'].includes(nameOf(n) ?? ''))
    const found = firstAt(props, fill)
    if (found && ['gradFill', 'blipFill', 'pattFill'].includes(nameOf(found.value) ?? '')) unsupported.push('WordArt effects')
    const effects = first(props, (n) => child(n, 'effectLst'))
    if (childrenOf(effects).some((e) => WORDART_EFFECTS.includes(nameOf(e) ?? ''))) unsupported.push('WordArt effects')
    const face = firstAt(props, (n) => attr(child(n, 'latin'), 'typeface'))
    let typeface = (face && (face.index < OWN_PROPS || !refFont) ? face.value : refFont) ?? '+mn-lt'
    if (typeface.startsWith('+mj')) typeface = c.master.theme.majorFont
    else if (typeface.startsWith('+mn')) typeface = c.master.theme.minorFont
    const ownColor = found && nameOf(found.value) === 'solidFill' ? colorIn(found.value, c.ctx) : null
    const color =
      (found && found.index < OWN_PROPS ? ownColor : null) ?? refColor ?? ownColor ?? { hex: textColor ? `#${textColor}` : '#000000', alpha: 1 }
    const flagOf = (name: string) => first(props, (n) => (attr(n, name) === undefined ? undefined : attr(n, name) === '1' || attr(n, name) === 'true'))
    const ln = first(props, (n) => child(n, 'ln'))
    return {
      points: ((first(props, (n) => numberAttr(n, 'sz')) ?? 1800) / 100) * fontScale,
      font: typeface,
      color,
      bold: flagOf('b') ?? false,
      italic: flagOf('i') ?? false,
      underline: (first(props, (n) => attr(n, 'u')) ?? 'none') !== 'none',
      caps: first(props, (n) => attr(n, 'cap')) === 'all',
      shadow: child(effects, 'outerShdw'),
      outline: ln && child(ln, 'solidFill') ? ln : undefined,
    }
  }

  const paragraphs: { paragraph: ThemeTextParagraph; looks: RunLook[]; lineSpacing: XmlNode | undefined; points: number }[] = []
  let number = 0
  for (const p of childList(txBody, 'p')) {
    const pPr = child(p, 'pPr')
    const lvl = `lvl${(numberAttr(pPr, 'lvl') ?? 0) + 1}pPr`
    const levels: Level[] = [pPr, ...chain.lists.map((list) => child(list, lvl))]
    const runs: ThemeTextRun[] = []
    const looks: RunLook[] = []
    for (const node of childrenOf(p)) {
      const name = nameOf(node)
      if (name === 'r' || name === 'fld') {
        const runLook = look(levels, child(node, 'rPr'))
        const text = textOf(child(node, 't'))
        runs.push({ text: runLook.caps ? text.toUpperCase() : text, fontFamily: runLook.font || undefined, fontSize: pointsToScreen(runLook.points, c.screen), color: runLook.color.hex, bold: runLook.bold, italic: runLook.italic, underline: runLook.underline })
        looks.push(runLook)
      } else if (name === 'br' && runs.length > 0) {
        runs[runs.length - 1].text += '\n'
      }
    }
    const endLook = look(levels, child(p, 'endParaRPr'))
    const hasText = runs.some((run) => run.text.trim())
    const bullet = first(levels, (level) => {
      if (child(level, 'buNone')) return ''
      const char = attr(child(level, 'buChar'), 'char')
      if (char !== undefined) return char
      if (child(level, 'buAutoNum')) return '#'
      return undefined
    })
    number = bullet === '#' ? number + 1 : 0
    const paragraph: ThemeTextParagraph = {
      runs: hasText ? runs : [],
      align: ALIGNMENTS[first(levels, (level) => attr(level, 'algn')) ?? 'l'] ?? 'left',
    }
    if (hasText && bullet) paragraph.bullet = bullet === '#' ? `${number}.` : bullet
    paragraphs.push({ paragraph, looks: hasText ? looks : [endLook], lineSpacing: first(levels, (level) => child(level, 'lnSpc')), points: (looks[0] ?? endLook).points })
  }
  if (!paragraphs.some((p) => p.paragraph.runs.length > 0)) return null

  const firstLook = paragraphs.flatMap((p) => p.looks)[0]
  const basePoints = firstLook.points
  const fontSize = Math.min(30, Math.max(1, pointsToScreen(basePoints, c.screen)))
  for (const p of paragraphs) {
    const pct = numberAttr(child(p.lineSpacing, 'spcPct'), 'val')
    const pts = numberAttr(child(p.lineSpacing, 'spcPts'), 'val')
    // PowerPoint's single spacing is about 1.2 times the font size.
    if (pct !== undefined) p.paragraph.lineHeight = Math.max(0.5, 1.2 * (pct / 100000 - spacingReduction))
    else if (pts !== undefined) p.paragraph.lineHeight = Math.max(0.5, pts / 100 / p.points)
    else if (spacingReduction) p.paragraph.lineHeight = Math.max(0.5, 1.2 * (1 - spacingReduction))
  }

  const em = (emu: number) => emu / EMU_PER_POINT / basePoints
  const shadowNode = firstLook.shadow ?? shapeShadow
  const shadowColor = shadowNode ? colorIn(shadowNode, c.ctx) : null
  const outlineColor = firstLook.outline ? colorIn(child(firstLook.outline, 'solidFill'), c.ctx) : null

  // The insets: the smallest is the padding, the rest moves the box edges in.
  const insets = ['lIns', 'tIns', 'rIns', 'bIns'].map((name, i) => first(chain.bodies, (b) => numberAttr(b, name)) ?? (i % 2 === 0 ? 91440 : 45720))
  const padding = Math.min(...insets)
  const inner: Rect = { x: rect.x + insets[0] - padding, y: rect.y + insets[1] - padding, cx: rect.cx - insets[0] - insets[2] + 2 * padding, cy: rect.cy - insets[1] - insets[3] + 2 * padding }
  const box = screenBox(inner, c.screen)
  if (!box) return null
  const anchor = first(chain.bodies, (b) => attr(b, 'anchor')) ?? 't'

  const text: ThemeTextProps = {
    fontFamily: firstLook.font,
    fontWeight: firstLook.bold ? 700 : 400,
    italic: firstLook.italic,
    underline: false,
    sizeMode: 'fixed',
    fontSize,
    color: firstLook.color.hex,
    textCase: 'normal',
    align: paragraphs[0].paragraph.align ?? 'left',
    verticalAlign: anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top',
    lineHeight: paragraphs[0].paragraph.lineHeight ?? 1.2,
    shadow: shadowColor
      ? {
          enabled: true,
          color: shadowColor.hex,
          blur: Math.min(1, em(numberAttr(shadowNode, 'blurRad') ?? 0)),
          offset: Math.min(0.5, em(numberAttr(shadowNode, 'dist') ?? 0) / Math.SQRT2),
        }
      : { enabled: false, color: '#000000', blur: 0, offset: 0 },
    outline: outlineColor
      ? { enabled: true, color: outlineColor.hex, width: Math.min(0.2, em(numberAttr(firstLook.outline, 'w') ?? 12700) / 2) }
      : { enabled: false, color: '#000000', width: 0 },
    padding: (padding / c.screen.height) * 100,
  }
  // Runs keep their sizes in screen percent; the box's own size is the base they are drawn relative to.
  for (const p of paragraphs) for (const run of p.paragraph.runs) run.fontSize = Math.min(30, Math.max(0.5, run.fontSize ?? fontSize))
  return { element: { id, kind: 'text', box, locked: false, text, paragraphs: paragraphs.map((p) => p.paragraph) }, unsupported }
}

// ---------- Shape trees ----------

/** A clip in a draft: a part of the .pptx, or a file a slide links to. */
export interface MediaRef {
  part?: string
  file?: string
  /** For messages, such as "clip.wmv". */
  name: string
}

/** A video of a draft slide, stored by resolveNativeMedia. */
export interface DraftVideo {
  /** 'background', or the id of the video element it plays in. */
  target: string
  media: MediaRef
  /** The frame PowerPoint shows before it plays (a part), used when the clip cannot play. */
  poster: string | null
}

/** A slide read from the .pptx, its pictures and clips not stored yet. */
export interface DraftSlide {
  /** Its number among the visible slides, from 1, as the slide grid counts. */
  number: number
  /** Null when it shows its picture instead (see `warnings`). Image sources are parts until stored. */
  style: ThemeStyle | null
  /** Shown instead when the background clip cannot play. */
  fallbackBackground: ThemeBackground
  videos: DraftVideo[]
  warnings: string[]
}

interface Builder {
  elements: ThemeElement[]
  videos: DraftVideo[]
  unsupported: Set<string>
  warnings: string[]
  ids: Set<string>
  /** A clip or animated GIF filling the slide, and how many elements were under it (it covers them). */
  motion: { background: ThemeBackground; video: DraftVideo | null; covered: number } | null
}

function uniqueId(builder: Builder, base: string): string {
  let id = base
  for (let n = 2; builder.ids.has(id); n++) id = `${base}-${n}`
  builder.ids.add(id)
  return id
}

const isAnimatedGif = (bytes: Uint8Array) => {
  // More than one graphic control extension means more than one frame.
  let frames = 0
  for (let i = 0; i + 2 < bytes.length && frames < 2; i++) if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) frames++
  return frames > 1
}

interface Walk {
  c: Context
  part: Part
  /** Prefix for element ids, so the same master shape has the same id on every slide. */
  scope: string
  transform: Transform
  /** Slide shapes inherit from layout and master placeholders; layout and master draw only non-placeholder shapes. */
  isSlide: boolean
  builder: Builder
}

async function walkTree(walk: Walk, tree: XmlNode | undefined): Promise<void> {
  for (const node of childrenOf(tree)) {
    switch (nameOf(node)) {
      case 'sp':
        await shape(walk, node)
        break
      case 'pic':
        await picture(walk, node)
        break
      case 'grpSp': {
        const xfrm = child(node, 'grpSpPr', 'xfrm')
        if (rotated(xfrm) || attr(xfrm, 'flipH') === '1' || attr(xfrm, 'flipV') === '1') {
          walk.builder.unsupported.add('rotated or flipped groups')
          break
        }
        const outer = rectOf(xfrm)
        const chOff = child(xfrm, 'chOff')
        const chExt = child(xfrm, 'chExt')
        const parent = walk.transform
        const ch = { x: numberAttr(chOff, 'x') ?? 0, y: numberAttr(chOff, 'y') ?? 0, cx: numberAttr(chExt, 'cx') ?? 0, cy: numberAttr(chExt, 'cy') ?? 0 }
        const transform: Transform =
          outer && ch.cx > 0 && ch.cy > 0
            ? (rect) => {
                const sx = outer.cx / ch.cx
                const sy = outer.cy / ch.cy
                return parent({ x: outer.x + (rect.x - ch.x) * sx, y: outer.y + (rect.y - ch.y) * sy, cx: rect.cx * sx, cy: rect.cy * sy })
              }
            : parent
        await walkTree({ ...walk, transform }, node)
        break
      }
      case 'graphicFrame': {
        const uri = attr(child(node, 'graphic', 'graphicData'), 'uri') ?? ''
        walk.builder.unsupported.add(/chart/i.test(uri) ? 'charts' : /diagram/i.test(uri) ? 'SmartArt' : /table/i.test(uri) ? 'tables' : 'embedded objects')
        break
      }
      case 'cxnSp':
        walk.builder.unsupported.add('lines and connectors')
        break
      case 'contentPart':
        walk.builder.unsupported.add('ink drawings')
        break
      case 'AlternateContent': {
        // Newer content with an older equivalent PowerPoint wrote for readers like this one.
        const fallback = child(node, 'Fallback')
        if (fallback) await walkTree(walk, fallback)
        else walk.builder.unsupported.add('content from a newer PowerPoint')
        break
      }
    }
  }
}

async function shape(walk: Walk, node: XmlNode): Promise<void> {
  const { c, builder } = walk
  const nv = child(node, 'nvSpPr')
  if (attr(child(nv, 'cNvPr'), 'hidden') === '1') return
  const ph = placeholderOf(node)
  if (ph && !walk.isSlide) return
  const layoutShape = ph ? findPlaceholder(c.layout, ph, false) : undefined
  const masterShape = ph ? findPlaceholder(c.master.part, ph, true) : undefined
  const spPr = child(node, 'spPr')
  const xfrm = child(spPr, 'xfrm') ?? child(layoutShape, 'spPr', 'xfrm') ?? child(masterShape, 'spPr', 'xfrm')
  const local = rectOf(xfrm)
  if (!local) return
  const rect = walk.transform(local)
  const txBody = child(node, 'txBody')
  const hasText = childList(txBody, 'p').some((p) => childrenOf(p).some((r) => ['r', 'fld'].includes(nameOf(r) ?? '') && textOf(child(r, 't')).trim()))

  const style = child(node, 'style')
  const fill = fillOf(spPr, c.ctx, walk.part) ?? styleFill(child(style, 'fillRef'), c.ctx, walk.part, 'fill') ?? { kind: 'none' }
  const ln = child(spPr, 'ln')
  const lineFill = ln ? childrenOf(ln).find((n) => FILL_TAGS.includes(nameOf(n) ?? '')) : undefined
  const hasLine = lineFill ? nameOf(lineFill) !== 'noFill' : (numberAttr(child(style, 'lnRef'), 'idx') ?? 0) > 0
  const visible = fill.kind !== 'none' || hasLine
  if (!visible && !hasText) return

  if (rotated(xfrm)) builder.unsupported.add('rotated shapes')
  const geometry = child(spPr, 'prstGeom') ? attr(child(spPr, 'prstGeom'), 'prst') : child(spPr, 'custGeom') ? 'custom' : 'rect'
  if (visible && geometry !== 'rect') builder.unsupported.add('shapes other than rectangles')
  if (hasLine) builder.unsupported.add('shape outlines')
  if (fill.kind === 'gradient' || fill.kind === 'image') builder.unsupported.add('gradient or picture fills on shapes')
  if (fill.kind === 'other') builder.unsupported.add(fill.what)

  const cNvId = attr(child(nv, 'cNvPr'), 'id') ?? '0'
  if (fill.kind === 'solid') {
    const box = screenBox(rect, c.screen)
    if (box) builder.elements.push({ id: uniqueId(builder, `${walk.scope}-${cNvId}-shape`), kind: 'shape', box, locked: false, color: fill.color.hex, opacity: fill.color.alpha })
  }
  if (!hasText || !txBody) return

  const listOf = (shapeNode: XmlNode | undefined) => child(shapeNode, 'txBody', 'lstStyle')
  const chain: TextChain = {
    lists: [child(txBody, 'lstStyle'), listOf(layoutShape), listOf(masterShape), masterStyle(c.master, ph), c.defaultTextStyle],
    bodies: [child(txBody, 'bodyPr'), child(layoutShape, 'txBody', 'bodyPr'), child(masterShape, 'txBody', 'bodyPr')],
    fontRef: child(style, 'fontRef'),
  }
  // A text box with no fill casts its shape shadow from the letters.
  const shapeShadow = fill.kind === 'none' ? child(spPr, 'effectLst', 'outerShdw') : undefined
  const result = textBox(c, uniqueId(builder, `${walk.scope}-${cNvId}`), txBody, chain, rect, shapeShadow)
  if (!result) return
  for (const reason of result.unsupported) builder.unsupported.add(reason)
  builder.elements.push(result.element)
}

async function picture(walk: Walk, node: XmlNode): Promise<void> {
  const { c, builder } = walk
  const nvPicPr = child(node, 'nvPicPr')
  if (attr(child(nvPicPr, 'cNvPr'), 'hidden') === '1') return
  if (placeholderOf(node) && !walk.isSlide) return
  const spPr = child(node, 'spPr')
  const xfrm = child(spPr, 'xfrm')
  const local = rectOf(xfrm)
  if (!local) return
  const rect = walk.transform(local)
  const nvPr = child(nvPicPr, 'nvPr')
  const blipId = attr(child(node, 'blipFill', 'blip'), 'r:embed')
  const blipRel = blipId ? walk.part.rels.get(blipId) : undefined
  const poster = blipRel && !blipRel.external ? blipRel.target : null
  const cNvId = attr(child(nvPicPr, 'cNvPr'), 'id') ?? '0'

  if (child(nvPr, 'audioFile') || child(nvPr, 'wavAudioFile')) {
    builder.warnings.push(`Slide ${walk.c.slideNumber}: its sound does not play in Native mode`)
    return
  }

  if (rotated(xfrm)) builder.unsupported.add('rotated pictures')
  const geometry = attr(child(spPr, 'prstGeom'), 'prst') ?? (child(spPr, 'custGeom') ? 'custom' : 'rect')
  if (geometry !== 'rect') builder.unsupported.add('pictures in shapes')
  const crop = child(node, 'blipFill', 'srcRect')
  if (['l', 't', 'r', 'b'].some((side) => (numberAttr(crop, side) ?? 0) !== 0)) builder.unsupported.add('cropped pictures')

  // A clip: embedded (p14:media) or linked (a:videoFile, a:quickTimeFile).
  const embedId = attr(child(nvPr, 'extLst', 'ext', 'media'), 'r:embed')
  const linkId = attr(child(nvPr, 'videoFile') ?? child(nvPr, 'quickTimeFile'), 'r:link')
  const mediaRel = (embedId && walk.part.rels.get(embedId)) || (linkId && walk.part.rels.get(linkId)) || undefined
  let media: MediaRef | null = null
  if (mediaRel) {
    if (!mediaRel.external) media = { part: mediaRel.target, name: path.posix.basename(mediaRel.target) }
    else {
      const target = mediaRel.target
      const file = target.startsWith('file:') ? fileURLToPath(target) : path.resolve(c.sourceDir, target)
      media = { file, name: path.basename(file) }
    }
  }

  const extension = poster ? path.posix.extname(poster).slice(1).toLowerCase() : ''
  const animatedGif = !media && poster !== null && extension === 'gif' && isAnimatedGif(await c.zip.file(poster)!.async('uint8array'))
  const fills = coverage(rect, c.screen) >= BACKGROUND_COVERAGE

  if ((media || animatedGif) && fills && !builder.motion) {
    if (media) {
      const video: DraftVideo = { target: 'background', media, poster }
      builder.motion = { background: { kind: 'video', src: '' }, video, covered: builder.elements.length }
    } else {
      builder.motion = { background: { kind: 'image', src: `${PART_PREFIX}${poster}`, fit: fitFor(c.screen) }, video: null, covered: builder.elements.length }
    }
    return
  }
  const box = screenBox(rect, c.screen)
  if (!box) return
  if (media) {
    const id = uniqueId(builder, `${walk.scope}-${cNvId}-video`)
    builder.videos.push({ target: id, media, poster })
    builder.elements.push({ id, kind: 'video', box, locked: false, src: '', fit: 'cover', opacity: 1 })
    return
  }
  if (!poster) {
    builder.unsupported.add('linked pictures')
    return
  }
  if (!IMAGE_EXTENSIONS.includes(extension)) {
    builder.unsupported.add(`${extension.toUpperCase() || 'unknown'} pictures`)
    return
  }
  builder.elements.push({ id: uniqueId(builder, `${walk.scope}-${cNvId}-image`), kind: 'image', box, locked: false, src: `${PART_PREFIX}${poster}`, fit: 'cover', opacity: 1 })
}

/** Cover fills a 16:9 screen with a 16:9 slide; other shapes keep the whole picture, letterboxed. */
const fitFor = (screen: Screen): 'cover' | 'contain' => (Math.abs(screen.slideWidth / screen.slideHeight - SCREEN_ASPECT) < 0.02 ? 'cover' : 'contain')

function backgroundOf(c: Context, parts: Part[]): { background: ThemeBackground } | { unsupported: string } {
  for (const part of parts) {
    const bg = child(part.root, 'cSld', 'bg')
    if (!bg) continue
    const bgPr = child(bg, 'bgPr')
    const fill = bgPr ? fillOf(bgPr, c.ctx, part) : styleFill(child(bg, 'bgRef'), c.ctx, part, 'background')
    if (!fill) continue
    switch (fill.kind) {
      case 'solid':
        return { background: { kind: 'solid', color: fill.color.hex } }
      case 'gradient':
        return { background: { kind: 'gradient', from: fill.from, to: fill.to, angle: Math.round(fill.angle) } }
      case 'image':
        return { background: { kind: 'image', src: `${PART_PREFIX}${fill.part}`, fit: fitFor(c.screen) } }
      case 'other':
        return { unsupported: `${fill.what} as the background` }
      case 'none':
        continue
    }
  }
  const white = c.master.theme.colors[c.master.colorMap.bg1 ?? 'lt1'] ?? 'ffffff'
  return { background: { kind: 'solid', color: `#${white}` } }
}

async function buildSlide(c: Context): Promise<DraftSlide> {
  const builder: Builder = { elements: [], videos: [], unsupported: new Set(), warnings: [], ids: new Set(), motion: null }
  const showMaster = (part: Part) => attr(part.root, 'showMasterSp') !== '0' && attr(part.root, 'showMasterSp') !== 'false'
  const layoutName = path.posix.basename(c.layout.path, '.xml')
  if (showMaster(c.slide) && showMaster(c.layout)) {
    await walkTree({ c, part: c.master.part, scope: 'master', transform: identity, isSlide: false, builder }, child(c.master.part.root, 'cSld', 'spTree'))
  }
  if (showMaster(c.slide)) await walkTree({ c, part: c.layout, scope: layoutName, transform: identity, isSlide: false, builder }, child(c.layout.root, 'cSld', 'spTree'))
  await walkTree({ c, part: c.slide, scope: 'slide', transform: identity, isSlide: true, builder }, child(c.slide.root, 'cSld', 'spTree'))

  const background = backgroundOf(c, [c.slide, c.layout, c.master.part])
  if ('unsupported' in background) builder.unsupported.add(background.unsupported)
  const themeBackground: ThemeBackground = 'background' in background ? background.background : { kind: 'solid', color: '#000000' }
  let elements = builder.elements
  let videos = builder.videos
  if (builder.motion) {
    // The clip covered what was under it.
    const covered = new Set(elements.slice(0, builder.motion.covered).map((e) => e.id))
    elements = elements.slice(builder.motion.covered)
    videos = [...(builder.motion.video ? [builder.motion.video] : []), ...videos.filter((v) => !covered.has(v.target))]
  }
  if (elements.length > MAX_ELEMENTS) builder.unsupported.add(`more than ${MAX_ELEMENTS} shapes`)

  if (builder.unsupported.size > 0) {
    const reasons = [...builder.unsupported]
    const list = reasons.length > 1 ? `${reasons.slice(0, -1).join(', ')} and ${reasons[reasons.length - 1]}` : reasons[0]
    return {
      number: c.slideNumber,
      style: null,
      fallbackBackground: themeBackground,
      videos: [],
      warnings: [`Slide ${c.slideNumber} shows its PowerPoint picture: Native mode cannot draw its ${list}`, ...builder.warnings],
    }
  }
  return {
    number: c.slideNumber,
    style: { category: 'presentation', background: builder.motion?.background ?? themeBackground, overlay: 0, keyTransparent: false, elements },
    fallbackBackground: themeBackground,
    videos,
    warnings: builder.warnings,
  }
}

/** A .pptx read for Native mode: its visible slides as drafts, and the zip to take their pictures and clips from. */
export interface NativeDeck {
  slides: DraftSlide[]
  /** A part's bytes, or null when it is missing. */
  part(name: string): Promise<Uint8Array | null>
}

/**
 * Reads a .pptx into draft native slides, its visible slides only (in show order, as the slide pictures are).
 * `sourcePath` is where the original is, for clips it links to rather than embeds. Throws if it is not a .pptx.
 */
export async function readNativeSlides(bytes: Uint8Array, sourcePath: string): Promise<NativeDeck> {
  const zip = await JSZip.loadAsync(bytes)
  const presentation = await readPart(zip, 'ppt/presentation.xml')
  if (!presentation) throw new Error('This file is not a PowerPoint .pptx presentation')
  const size = child(presentation.root, 'sldSz')
  const screen = fitScreen(numberAttr(size, 'cx') ?? 9144000, numberAttr(size, 'cy') ?? 5143500)
  const defaultTextStyle = child(presentation.root, 'defaultTextStyle')
  const masters = new Map<string, Master>()
  const layouts = new Map<string, Part | null>()
  const slides: DraftSlide[] = []

  for (const sldId of childList(child(presentation.root, 'sldIdLst'), 'sldId')) {
    const rel = presentation.rels.get(attr(sldId, 'r:id') ?? '')
    const slide = rel ? await readPart(zip, rel.target) : null
    if (!slide) continue
    if (attr(slide.root, 'show') === '0' || attr(slide.root, 'show') === 'false') continue
    const layoutPath = relOfType(slide, '/slideLayout')?.target
    if (!layoutPath) continue
    if (!layouts.has(layoutPath)) layouts.set(layoutPath, await readPart(zip, layoutPath))
    const layout = layouts.get(layoutPath)
    const masterPath = layout && relOfType(layout, '/slideMaster')?.target
    if (!layout || !masterPath) continue
    if (!masters.has(masterPath)) {
      const part = await readPart(zip, masterPath)
      if (!part) continue
      const map = child(part.root, 'clrMap')
      const colorMap: Record<string, string> = {}
      for (const key of ['bg1', 'tx1', 'bg2', 'tx2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']) colorMap[key] = attr(map, key) ?? key
      masters.set(masterPath, { part, theme: await readTheme(zip, part), colorMap })
    }
    const master = masters.get(masterPath)!
    const c: Context = {
      zip,
      screen,
      defaultTextStyle,
      master,
      layout,
      slide,
      ctx: { theme: master.theme, colorMap: master.colorMap },
      slideNumber: slides.length + 1,
      sourceDir: path.dirname(sourcePath),
    }
    slides.push(await buildSlide(c))
  }
  return {
    slides,
    part: async (name) => (zip.file(name) ? zip.file(name)!.async('uint8array') : null),
  }
}

// ---------- Storing the pictures and clips ----------

/** Where Native mode keeps what it takes out of a .pptx. */
export interface NativeMediaStore {
  /** Stores a picture of the deck (a logo, a background); the same bytes give the same URL. */
  image(bytes: Uint8Array, extension: string): Promise<string>
  /** The media library video already made from a clip with this SHA-256, or null. */
  findVideo(hash: string): string | null
  /** Adds a playable clip to the media library under the original clip's SHA-256. Resolves to its URL. */
  addVideo(hash: string, file: string, name: string): Promise<string>
}

export interface ResolveOptions {
  store: NativeMediaStore
  /** ffmpeg, for clips that cannot play as they are; null when it is not installed. */
  ffmpeg: string | null
  /** A scratch folder for clips being checked or converted; removed afterwards. */
  workDir: string
  /** The presentation's title, for naming its clips in the media library. */
  title: string
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/**
 * Stores the drafts' pictures and clips and gives the slides their URLs. A clip goes into the media library once
 * (by its hash), converted first when it cannot play; one that cannot be made playable leaves a warning with its
 * slide number, and the slide shows the clip's first frame (or its own background) instead.
 */
export async function resolveNativeMedia(deck: NativeDeck, { store, ffmpeg, workDir, title }: ResolveOptions): Promise<NativeSlide[]> {
  const images = new Map<string, Promise<string | null>>()
  const clips = new Map<string, Promise<{ url: string } | { error: string }>>()
  await mkdir(workDir, { recursive: true })

  const image = (part: string) => {
    if (!images.has(part)) {
      images.set(
        part,
        deck.part(part).then((bytes) => (bytes ? store.image(bytes, path.posix.extname(part).slice(1).toLowerCase()) : null)),
      )
    }
    return images.get(part)!
  }

  const clip = async (media: MediaRef, number: number): Promise<{ url: string } | { error: string }> => {
    let bytes: Uint8Array | null
    try {
      bytes = media.part ? await deck.part(media.part) : new Uint8Array(await readFile(media.file!))
    } catch {
      bytes = null
    }
    if (!bytes) return { error: `Slide ${number}: the video ${media.name} is missing${media.file ? ` (it is linked from ${media.file})` : ''}` }
    const hash = sha256(bytes)
    if (!clips.has(hash)) {
      clips.set(
        hash,
        (async () => {
          const known = store.findVideo(hash)
          if (known) return { url: known }
          const extension = path.extname(media.name).toLowerCase() || '.mp4'
          const original = path.join(workDir, `${hash}${extension}`)
          await writeFile(original, bytes)
          let playable = original
          if (await needsConversion(original, ffmpeg)) {
            const kind = extension.slice(1).toUpperCase()
            if (!ffmpeg) return { error: `Slide ${number}: the video ${media.name} (${kind}) cannot play in ServiceEx. Install ffmpeg to convert it; until then the slide shows its first frame.` }
            playable = path.join(workDir, `${hash}.mp4`)
            try {
              await convertToMp4(ffmpeg, original, playable)
            } catch (error) {
              return { error: `Slide ${number}: the video ${media.name} (${kind}) could not be converted: ${error instanceof Error ? error.message : String(error)}` }
            }
          }
          const name = `${title} · ${path.basename(media.name, path.extname(media.name))}`
          return { url: await store.addVideo(hash, playable, name) }
        })(),
      )
    }
    return clips.get(hash)!
  }

  try {
    const slides: NativeSlide[] = []
    for (const draft of deck.slides) {
      const warnings = [...draft.warnings]
      if (!draft.style) {
        slides.push({ style: null, warnings, useImage: false })
        continue
      }
      const style: ThemeStyle = structuredClone(draft.style)
      const imageBackground = async (background: ThemeBackground): Promise<ThemeBackground> => {
        if (background.kind !== 'image' || !background.src.startsWith(PART_PREFIX)) return background
        const src = await image(background.src.slice(PART_PREFIX.length))
        return src ? { ...background, src } : { kind: 'solid', color: '#000000' }
      }
      style.background = await imageBackground(style.background)
      const elements: ThemeElement[] = []
      for (const element of style.elements) {
        if (element.kind === 'image' && element.src?.startsWith(PART_PREFIX)) {
          const src = await image(element.src.slice(PART_PREFIX.length))
          if (src) elements.push({ ...element, src })
          else warnings.push(`Slide ${draft.number}: a picture is missing from the file`)
        } else if (element.kind === 'video') {
          const video = draft.videos.find((v) => v.target === element.id)
          const result = video ? await clip(video.media, draft.number) : { error: `Slide ${draft.number}: a video is missing` }
          if ('url' in result) elements.push({ ...element, src: result.url })
          else {
            warnings.push(result.error)
            const poster = video?.poster ? await image(video.poster) : null
            if (poster) elements.push({ id: element.id, kind: 'image', box: element.box, locked: false, src: poster, fit: element.fit, opacity: element.opacity })
          }
        } else elements.push(element)
      }
      style.elements = elements
      const backgroundVideo = draft.videos.find((v) => v.target === 'background')
      if (backgroundVideo) {
        const result = await clip(backgroundVideo.media, draft.number)
        if ('url' in result) style.background = { kind: 'video', src: result.url }
        else {
          warnings.push(result.error)
          const poster = backgroundVideo.poster ? await image(backgroundVideo.poster) : null
          style.background = poster ? { kind: 'image', src: poster, fit: 'cover' } : await imageBackground(draft.fallbackBackground)
        }
      }
      slides.push({ style, warnings, useImage: false })
    }
    return slides
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

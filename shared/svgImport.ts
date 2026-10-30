// Import design: an SVG (as Figma, Illustrator or Inkscape export it) as editable design elements. Rectangles, rounded
// rectangles and circles become rectangles with their fill, gradient, stroke, opacity and drop shadow; text becomes
// real text with its font, size, weight, colour and alignment; pictures become image elements; anything else (paths,
// polygons, masks) becomes one picture per run of shapes, so it looks the same. Layer names come from the file's ids.
// Pure: the pictures come back as assets for the renderer to store (src "asset:<index>" until then).

import { XMLBuilder, XMLParser } from 'fast-xml-parser'
import { BRAND, imageElement, lineElement, NO_SHADOW, rectElement, textElement } from './designs'
import type { DesignElement, DesignFill, DesignShadow, ThemeBox } from './types'

/** A picture the import found: a data URL's bytes in base64, or an SVG of the shapes it could not turn into elements. */
export interface ImportAsset {
  extension: 'png' | 'jpg' | 'webp' | 'gif' | 'svg'
  /** Base64 for a bitmap; the SVG's text for svg. */
  data: string
}

export interface ImportedDesign {
  elements: DesignElement[]
  assets: ImportAsset[]
  /** Fonts the text asks for, for the renderer to check are installed. */
  fonts: string[]
  warnings: string[]
}

/** The canvas the designs are drawn on, in pixels: Figma frames for a 1080p screen map one to one. */
const CANVAS = { width: 1920, height: 1080 }

// ---------- Transforms ----------

/** An affine transform [a, b, c, d, e, f], as SVG's matrix(). */
type Matrix = [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]

const apply = (m: Matrix, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] })

const numbers = (value: string) => (value.match(/-?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) ?? []).map(Number)

/** Parses an SVG transform list. */
export function parseTransform(value: string | undefined): Matrix {
  let m = IDENTITY
  for (const [, name, args] of (value ?? '').matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const n = numbers(args)
    let t: Matrix = IDENTITY
    if (name === 'matrix' && n.length === 6) t = n as Matrix
    else if (name === 'translate') t = [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0]
    else if (name === 'scale') t = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0]
    else if (name === 'rotate') {
      const r = ((n[0] ?? 0) * Math.PI) / 180
      const [cx, cy] = [n[1] ?? 0, n[2] ?? 0]
      t = multiply(multiply([1, 0, 0, 1, cx, cy], [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]), [1, 0, 0, 1, -cx, -cy])
    } else if (name === 'skewX') t = [1, 0, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 1, 0, 0]
    else if (name === 'skewY') t = [1, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]
    m = multiply(m, t)
  }
  return m
}

// ---------- Colours and styles ----------

const NAMED: Record<string, string> = { white: '#ffffff', black: '#000000', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080', transparent: 'none' }

/** A colour as #rrggbb and its alpha, or null for none (or one this cannot read, such as currentColor). */
export function parseColor(value: string | undefined): { hex: string; alpha: number } | null {
  if (!value) return null
  const v = value.trim().toLowerCase()
  if (v === 'none' || NAMED[v] === 'none') return null
  if (NAMED[v]) return { hex: NAMED[v], alpha: 1 }
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v)
  if (short) return { hex: `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`, alpha: 1 }
  const long = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v)
  if (long) return { hex: `#${long[1]}`, alpha: long[2] ? parseInt(long[2], 16) / 255 : 1 }
  const rgb = /^rgba?\(([^)]*)\)$/.exec(v)
  if (rgb) {
    const [r, g, b, a = 1] = numbers(rgb[1])
    const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
    return { hex: `#${hex(r)}${hex(g)}${hex(b)}`, alpha: a }
  }
  return null
}

type Attrs = Record<string, string>
type XmlNode = Record<string, unknown> & { ':@'?: Attrs }

/** The node's tag and its children, from the parser's ordered form. */
function tagOf(node: XmlNode): { tag: string; children: XmlNode[] } | null {
  const tag = Object.keys(node).find((k) => k !== ':@')
  if (!tag || tag === '#text') return null
  return { tag: tag.replace(/^svg:/, ''), children: (node[tag] as XmlNode[]) ?? [] }
}

/** Attributes with the inline style folded in (style wins, as in a browser). */
function attrsOf(node: XmlNode): Attrs {
  const attrs: Attrs = { ...(node[':@'] ?? {}) }
  for (const part of (attrs.style ?? '').split(';')) {
    const at = part.indexOf(':')
    if (at > 0) attrs[part.slice(0, at).trim()] = part.slice(at + 1).trim()
  }
  return attrs
}

const textOf = (children: XmlNode[]): string => children.map((c) => (typeof c['#text'] !== 'undefined' ? String(c['#text']) : '')).join('')

const num = (value: string | undefined, fallback = 0) => {
  const n = parseFloat(value ?? '')
  return Number.isFinite(n) ? n : fallback
}

const opacityOf = (value: string | undefined) => Math.max(0, Math.min(1, num(value, 1)))

/** `url(#id)`'s id. */
const refOf = (value: string | undefined) => /^url\(\s*['"]?#([^'")]+)['"]?\s*\)$/.exec(value?.trim() ?? '')?.[1] ?? null

/** A layer's name from the file: Figma writes it as the id, Illustrator as data-name, Inkscape as its label. */
function layerName(attrs: Attrs, fallback: string): string {
  const raw = attrs['data-name'] ?? attrs['inkscape:label'] ?? attrs.id
  if (!raw) return fallback
  const name = raw.includes(' ') ? raw : raw.replace(/_/g, ' ')
  return name.trim().slice(0, 100) || fallback
}

// ---------- Paths' extent ----------

/** The points a path passes through and its control points: a box around them holds the whole path. */
export function pathPoints(d: string): { x: number; y: number }[] {
  const tokens = d.match(/[a-df-z]|-?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) ?? []
  const points: { x: number; y: number }[] = []
  let i = 0
  let command = ''
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  const next = () => Number(tokens[i++])
  const counts: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 }
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i])) command = tokens[i++]
    const lower = command.toLowerCase()
    const relative = command !== command.toUpperCase()
    if (lower === 'z') {
      x = startX
      y = startY
      if (i < tokens.length && !/[a-z]/i.test(tokens[i])) i++
      continue
    }
    if (!counts[lower] || i + counts[lower] > tokens.length) break
    const ox = relative ? x : 0
    const oy = relative ? y : 0
    if (lower === 'h') x = next() + (relative ? x : 0)
    else if (lower === 'v') y = next() + (relative ? y : 0)
    else if (lower === 'a') {
      const [rx, ry] = [Math.abs(next()), Math.abs(next())]
      i += 3
      const [nx, ny] = [next() + ox, next() + oy]
      // An arc can bulge out past its ends by up to its radii.
      points.push({ x: Math.min(x, nx) - rx, y: Math.min(y, ny) - ry }, { x: Math.max(x, nx) + rx, y: Math.max(y, ny) + ry })
      x = nx
      y = ny
    } else {
      const pairs = counts[lower] / 2
      for (let p = 0; p < pairs; p++) {
        const px = next() + ox
        const py = next() + oy
        points.push({ x: px, y: py })
        if (p === pairs - 1) {
          x = px
          y = py
        }
      }
      if (lower === 'm') {
        startX = x
        startY = y
        // More pairs after a move are lines.
        command = relative ? 'l' : 'L'
      }
    }
    points.push({ x, y })
  }
  return points
}

/** The points that bound a shape, in its own coordinates; null for one this cannot measure. */
function shapePoints(tag: string, a: Attrs): { x: number; y: number }[] | null {
  switch (tag) {
    case 'path':
      return pathPoints(a.d ?? '')
    case 'polygon':
    case 'polyline': {
      const n = numbers(a.points ?? '')
      return n.flatMap((_, k) => (k % 2 === 0 && k + 1 < n.length ? [{ x: n[k], y: n[k + 1] }] : []))
    }
    case 'circle':
    case 'ellipse': {
      const [cx, cy] = [num(a.cx), num(a.cy)]
      const rx = num(a.rx, num(a.r))
      const ry = num(a.ry, num(a.r))
      return [{ x: cx - rx, y: cy - ry }, { x: cx + rx, y: cy + ry }]
    }
    case 'rect':
    case 'image':
    case 'use':
    case 'foreignObject': {
      const [x, y, w, h] = [num(a.x), num(a.y), num(a.width), num(a.height)]
      return w > 0 && h > 0 ? [{ x, y }, { x: x + w, y: y + h }] : null
    }
    case 'line':
      return [{ x: num(a.x1), y: num(a.y1) }, { x: num(a.x2), y: num(a.y2) }]
  }
  return null
}

// ---------- The import ----------

interface Context {
  matrix: Matrix
  opacity: number
  /** Inherited presentation attributes, such as a group's fill. */
  inherited: Attrs
  /** A group around just this element: Figma names the layer and puts its shadow there. */
  wrapper?: { name?: string; filter?: string }
}

const INHERITED = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'letter-spacing']
const SKIPPED = new Set(['defs', 'title', 'desc', 'metadata', 'style', 'clipPath', 'mask', 'filter', 'linearGradient', 'radialGradient', 'pattern', 'symbol', 'marker', '?xml', 'sodipodi:namedview'])

/**
 * Converts an SVG's text to design elements on the 16:9 canvas. A 16:9 file fills the canvas; another (a lower third
 * frame on its own) is placed at 1080p pixel size, in from the left and above the bottom. A full frame background
 * rectangle is kept but hidden, so the lower third stays over the picture.
 */
export function importSvg(source: string): ImportedDesign {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', preserveOrder: true, trimValues: false, processEntities: true })
  const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '', preserveOrder: true, suppressEmptyNode: true })
  const tree = parser.parse(source) as XmlNode[]
  const svgNode = tree.find((n) => tagOf(n)?.tag === 'svg')
  if (!svgNode) throw new Error('This is not an SVG file.')
  const svg = tagOf(svgNode)!
  const root = attrsOf(svgNode)
  const viewBox = numbers(root.viewBox ?? root.viewbox ?? '')
  const frame =
    viewBox.length === 4 ? { x: viewBox[0], y: viewBox[1], width: viewBox[2], height: viewBox[3] } : { x: 0, y: 0, width: num(root.width, CANVAS.width), height: num(root.height, CANVAS.height) }
  if (frame.width <= 0 || frame.height <= 0) throw new Error('The SVG has no size.')

  // Where the file's pixels go on the canvas, in percent.
  const fullFrame = Math.abs(frame.width / frame.height - 16 / 9) < 0.02
  const scale = fullFrame ? CANVAS.width / frame.width : Math.min(1, (CANVAS.width * 0.9) / frame.width, (CANVAS.height * 0.9) / frame.height)
  const offset = fullFrame ? { x: 0, y: 0 } : { x: CANVAS.width * 0.05, y: CANVAS.height * 0.9 - frame.height * scale }
  const toCanvas = (p: { x: number; y: number }) => ({
    x: ((offset.x + (p.x - frame.x) * scale) / CANVAS.width) * 100,
    y: ((offset.y + (p.y - frame.y) * scale) / CANVAS.height) * 100,
  })
  /** A length in file pixels as percent of the canvas height, the unit of sizes in a design. */
  const height = (px: number, m: Matrix) => ((px * scale * Math.hypot(m[2], m[3])) / CANVAS.height) * 100

  // Everything with an id, for gradients, patterns, filters and uses.
  const byId = new Map<string, XmlNode>()
  const index = (nodes: XmlNode[]) => {
    for (const n of nodes) {
      const t = tagOf(n)
      if (!t) continue
      const id = n[':@']?.id
      if (id) byId.set(id, n)
      index(t.children)
    }
  }
  index(svg.children)
  const defs = svg.children.filter((n) => tagOf(n)?.tag === 'defs')

  const elements: DesignElement[] = []
  const assets: ImportAsset[] = []
  const fonts = new Set<string>()
  const warnings = new Set<string>()
  const ids = new Set<string>()
  const newId = (base: string) => {
    const clean = base.replace(/[^\w-]+/g, '-').slice(0, 40) || 'layer'
    let id = clean
    for (let n = 2; ids.has(id); n++) id = `${clean}-${n}`
    ids.add(id)
    return id
  }

  // ---- Shapes this cannot make editable, gathered into one picture per run ----
  let run: { nodes: XmlNode[]; points: { x: number; y: number }[]; name: string } | null = null
  const flush = () => {
    const current = run
    run = null
    if (!current || current.points.length === 0) return
    const xs = current.points.map((p) => p.x)
    const ys = current.points.map((p) => p.y)
    const [minX, minY, maxX, maxY] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    const [w, h] = [Math.max(1, maxX - minX), Math.max(1, maxY - minY)]
    const body = builder.build([...defs, ...current.nodes]) as string
    assets.push({
      extension: 'svg',
      data: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${minX} ${minY} ${w} ${h}" width="${w}" height="${h}">${body}</svg>`,
    })
    const a = toCanvas({ x: minX, y: minY })
    const b = toCanvas({ x: maxX, y: maxY })
    elements.push(imageElement(newId(current.name), current.name, { x: a.x, y: a.y, width: Math.max(0.2, b.x - a.x), height: Math.max(0.2, b.y - a.y) }, { src: `asset:${assets.length - 1}`, fit: 'cover' }))
  }
  /** Adds a shape (or a masked group, with its points given) to the picture being gathered. */
  const addToRun = (tag: string, node: XmlNode, a: Attrs, ctx: Context, given?: { x: number; y: number }[]) => {
    const own = given ? null : shapePoints(tag, a)
    if (!given && !own) {
      warnings.add(`A ${tag} could not be measured and was left out.`)
      return
    }
    const stroke = parseColor(a.stroke) ? num(a['stroke-width'], 1) / 2 : 0
    const placed = given ?? own!.map((p) => apply(ctx.matrix, p.x, p.y))
    const xs = placed.map((p) => p.x)
    const ys = placed.map((p) => p.y)
    const grown = [
      { x: Math.min(...xs) - stroke, y: Math.min(...ys) - stroke },
      { x: Math.max(...xs) + stroke, y: Math.max(...ys) + stroke },
    ]
    // Drawn as it was: in the file's coordinates, with what it inherits.
    const wrapper: XmlNode = { g: [node], ':@': { transform: `matrix(${ctx.matrix.join(' ')})`, opacity: String(ctx.opacity), ...ctx.inherited } }
    if (!run) run = { nodes: [], points: [], name: layerName(a, 'Vector') }
    run.nodes.push(wrapper)
    run.points.push(...grown)
  }

  // ---- Fills, gradients and shadows ----
  function fillOf(a: Attrs, warnAbout: string): { fill: DesignFill; alpha: number; image: string | null } | null {
    const ref = refOf(a.fill)
    if (ref) {
      const node = byId.get(ref)
      const t = node && tagOf(node)
      if (t?.tag === 'linearGradient' || t?.tag === 'radialGradient') {
        const stops = t.children.filter((c) => tagOf(c)?.tag === 'stop').map((c) => attrsOf(c))
        const first = parseColor(stops[0]?.['stop-color']) ?? { hex: BRAND.navy, alpha: 1 }
        const last = parseColor(stops[stops.length - 1]?.['stop-color']) ?? first
        if (t.tag === 'radialGradient') {
          warnings.add(`A radial gradient on ${warnAbout} is shown as its centre colour.`)
          return { fill: { kind: 'solid', color: first.hex }, alpha: 1, image: null }
        }
        const g = attrsOf(node!)
        const m = parseTransform(g.gradientTransform)
        const p1 = apply(m, num(g.x1, 0), num(g.y1, 0))
        const p2 = apply(m, num(g.x2, 1), num(g.y2, 0))
        // CSS angles start at the top and turn clockwise.
        const angle = Math.round(((Math.atan2(p2.x - p1.x, -(p2.y - p1.y)) * 180) / Math.PI + 360) % 360)
        if (stops.length > 2) warnings.add(`A gradient on ${warnAbout} has more than two colours; it keeps the first and last.`)
        return { fill: { kind: 'gradient', from: first.hex, to: last.hex, angle }, alpha: Math.max(first.alpha, last.alpha), image: null }
      }
      if (t?.tag === 'pattern') {
        // Figma fills a rectangle with a picture through a pattern that uses an image.
        const image = findImage(t.children)
        if (image) return { fill: { kind: 'solid', color: BRAND.navy }, alpha: 1, image }
      }
      return null
    }
    const color = parseColor(a.fill ?? '#000000')
    if (!color) return null
    return { fill: { kind: 'solid', color: color.hex }, alpha: color.alpha * opacityOf(a['fill-opacity']), image: null }
  }

  function findImage(children: XmlNode[]): string | null {
    for (const c of children) {
      const t = tagOf(c)
      if (!t) continue
      const a = attrsOf(c)
      if (t.tag === 'image') return a.href ?? a['xlink:href'] ?? null
      if (t.tag === 'use') {
        const target = byId.get((a.href ?? a['xlink:href'] ?? '').replace(/^#/, ''))
        if (target && tagOf(target)?.tag === 'image') return attrsOf(target).href ?? attrsOf(target)['xlink:href'] ?? null
      }
      const inner = findImage(t.children)
      if (inner) return inner
    }
    return null
  }

  function shadowOf(a: Attrs, m: Matrix): DesignShadow {
    const ref = refOf(a.filter)
    const node = ref ? byId.get(ref) : undefined
    const t = node && tagOf(node)
    if (!t) return NO_SHADOW
    const parts = t.children.map((c) => ({ tag: tagOf(c)?.tag, a: attrsOf(c) }))
    const offset = parts.find((p) => p.tag === 'feOffset')
    const blur = parts.find((p) => p.tag === 'feGaussianBlur')
    const drop = parts.find((p) => p.tag === 'feDropShadow')
    if (!offset && !drop) {
      warnings.add('An effect other than a drop shadow was left out.')
      return NO_SHADOW
    }
    // Figma's colour matrix ends in the shadow's colour and alpha: "0 0 0 0 r  0 0 0 0 g  0 0 0 0 b  0 0 0 a 0".
    const matrix = parts.filter((p) => p.tag === 'feColorMatrix' && p.a.type !== 'alpha' && (!p.a.in || p.a.in === 'hardAlpha')).at(-1)
    const values = numbers(matrix?.a.values ?? '')
    const flood = parseColor(drop?.a['flood-color'] ?? parts.find((p) => p.tag === 'feFlood')?.a['flood-color'])
    const hex = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0')
    const color = values.length === 20 ? `#${hex(values[4])}${hex(values[9])}${hex(values[14])}` : (flood?.hex ?? '#000000')
    const opacity = values.length === 20 ? values[18] : opacityOf(drop?.a['flood-opacity'] ?? parts.find((p) => p.tag === 'feFlood')?.a['flood-opacity'])
    const dx = num(drop?.a.dx ?? offset?.a.dx)
    const dy = num(drop?.a.dy ?? offset?.a.dy)
    const deviation = num(drop?.a.stdDeviation ?? blur?.a.stdDeviation)
    return { enabled: true, color, opacity: Math.max(0, Math.min(1, opacity)), blur: Math.min(20, height(deviation * 2, m)), x: Math.max(-20, Math.min(20, height(dx, m))), y: Math.max(-20, Math.min(20, height(dy, m))) }
  }

  /** A rectangle's box on the canvas and its rotation, from its corners under the transform. */
  function boxOf(x: number, y: number, w: number, h: number, m: Matrix): { box: ThemeBox; rotation: number } {
    const centre = toCanvas(apply(m, x + w / 2, y + h / 2))
    const sx = Math.hypot(m[0], m[1])
    const sy = Math.hypot(m[2], m[3])
    const width = ((w * sx * scale) / CANVAS.width) * 100
    const tall = ((h * sy * scale) / CANVAS.height) * 100
    const rotation = Math.round((Math.atan2(m[1], m[0]) * 180) / Math.PI * 10) / 10
    return { box: { x: centre.x - width / 2, y: centre.y - tall / 2, width, height: tall }, rotation }
  }

  function addImage(href: string | null, a: Attrs, box: ThemeBox, rotation: number, opacity: number, name: string) {
    const data = /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,(.*)$/s.exec(href ?? '')
    if (!data) {
      warnings.add(`The picture "${name}" is linked, not inside the file, so it was left out.`)
      return
    }
    const type = data[1] === 'jpeg' ? 'jpg' : data[1] === 'svg+xml' ? 'svg' : (data[1] as ImportAsset['extension'])
    assets.push({ extension: type, data: type === 'svg' ? decodeBase64(data[2]) : data[2].replace(/\s+/g, '') })
    const preserve = a.preserveAspectRatio ?? ''
    elements.push(imageElement(newId(name), name, box, { src: `asset:${assets.length - 1}`, fit: preserve.includes('slice') ? 'cover' : preserve === 'none' ? 'cover' : 'contain', rotation, opacity }))
  }

  function addText(children: XmlNode[], a: Attrs, ctx: Context) {
    // Each line is a tspan with its own position; text straight inside the element is one line.
    const lines: { x: number; y: number; text: string }[] = []
    const baseX = num(a.x)
    const baseY = num(a.y)
    const own = textOf(children).trim()
    if (own) lines.push({ x: baseX, y: baseY, text: own })
    for (const c of children) {
      if (tagOf(c)?.tag !== 'tspan') continue
      const t = attrsOf(c)
      const words = textOf(tagOf(c)!.children)
      const x = num(t.x, lines.at(-1)?.x ?? baseX)
      const y = num(t.y, lines.at(-1)?.y ?? baseY)
      // A tspan on the same line continues it (Figma splits runs of a style).
      const last = lines.at(-1)
      if (last && Math.abs(last.y - y) < 0.5 && t.x === undefined) last.text += words
      else lines.push({ x, y, text: words })
    }
    const words = lines.map((l) => l.text.replace(/\s+$/, '')).join('\n')
    if (!words.trim()) return
    const m = ctx.matrix
    const sizePx = num(a['font-size'], 16)
    const fontSize = height(sizePx, m)
    const family = (a['font-family'] ?? '').split(',')[0].replace(/["']/g, '').trim()
    if (family) fonts.add(family)
    const weightValue = a['font-weight'] ?? '400'
    const fontWeight = weightValue === 'bold' ? 700 : weightValue === 'normal' ? 400 : Math.round(num(weightValue, 400) / 100) * 100
    const color = parseColor(a.fill ?? '#000000')
    const anchor = a['text-anchor'] ?? 'start'
    const align = anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left'
    const spacingValue = a['letter-spacing'] ?? '0'
    const letterSpacing = spacingValue.endsWith('em') ? num(spacingValue) : num(spacingValue) / sizePx
    const lineHeight = lines.length > 1 ? Math.max(0.6, Math.min(3, (lines[1].y - lines[0].y) / sizePx)) : 1.2
    // The box from the first baseline: the ascent above it, a line height for each line. Its width is a guess that
    // Auto width measures properly when it is drawn.
    const longest = Math.max(...lines.map((l) => l.text.length))
    const widthPx = Math.max(sizePx, longest * sizePx * 0.55)
    const leftPx = align === 'center' ? lines[0].x - widthPx / 2 : align === 'right' ? lines[0].x - widthPx : lines[0].x
    const topPx = lines[0].y - sizePx * (0.8 + (lineHeight - 1) / 2)
    const { box, rotation } = boxOf(leftPx, topPx, widthPx, sizePx * lineHeight * lines.length, m)
    const name = layerName(a, words.split('\n')[0].slice(0, 40))
    elements.push(
      textElement(newId(name), name, box, {
        text: words,
        fontFamily: family,
        fontWeight: Math.max(100, Math.min(900, fontWeight)),
        italic: a['font-style'] === 'italic',
        fontSize: Math.max(0.5, Math.min(60, fontSize)),
        color: color?.hex ?? BRAND.white,
        align,
        verticalAlign: 'top',
        lineHeight,
        letterSpacing: Math.max(-0.2, Math.min(1, letterSpacing)),
        sizing: 'autoWidth',
        autoFit: true,
        maxWidth: Math.max(box.width, Math.min(95, 100 - box.x)),
        maxHeight: Math.max(box.height, 40),
        rotation,
        opacity: ctx.opacity * opacityOf(a.opacity) * (color?.alpha ?? 1),
      }),
    )
  }

  function walk(nodes: XmlNode[], ctx: Context) {
    for (const node of nodes) {
      const t = tagOf(node)
      if (!t || SKIPPED.has(t.tag)) continue
      const own = attrsOf(node)
      if (own.display === 'none' || own.visibility === 'hidden') continue
      // What the element inherits, under its own attributes.
      const a: Attrs = { ...ctx.inherited, ...own }
      const m = multiply(ctx.matrix, parseTransform(own.transform))
      const opacity = ctx.opacity * opacityOf(own.opacity)
      if (t.tag === 'g' || t.tag === 'svg' || t.tag === 'a' || t.tag === 'switch') {
        if (refOf(own.mask)) {
          // A mask cannot be edited as elements, so the group is one picture.
          const points = boundsOfGroup(t.children, m)
          if (points) addToRun('g', node, own, ctx, points)
          continue
        }
        const inherited = { ...ctx.inherited }
        for (const key of INHERITED) if (own[key] !== undefined) inherited[key] = own[key]
        const drawn = t.children.filter((c) => {
          const tag = tagOf(c)?.tag
          return tag !== undefined && !SKIPPED.has(tag)
        })
        const named = own['data-name'] ?? own['inkscape:label'] ?? own.id
        const wrapper = drawn.length === 1 ? { name: named ? layerName(own, '') : ctx.wrapper?.name, filter: own.filter ?? ctx.wrapper?.filter } : undefined
        walk(t.children, { matrix: m, opacity, inherited, wrapper })
        continue
      }
      const fallbackName = t.tag === 'rect' ? 'Rectangle' : t.tag === 'text' ? 'Text' : t.tag === 'image' ? 'Image' : 'Shape'
      const name = layerName(own, ctx.wrapper?.name || fallbackName)
      if (ctx.wrapper?.filter && !own.filter) own.filter = ctx.wrapper.filter
      if (t.tag === 'rect' || t.tag === 'circle') {
        const isCircle = t.tag === 'circle'
        const r = num(a.r)
        const [x, y, w, h] = isCircle ? [num(a.cx) - r, num(a.cy) - r, r * 2, r * 2] : [num(a.x), num(a.y), num(a.width), num(a.height)]
        if (w <= 0 || h <= 0) continue
        const fill = fillOf(a, name)
        const stroke = parseColor(a.stroke)
        const { box, rotation } = boxOf(x, y, w, h, m)
        if (fill?.image) {
          flush()
          addImage(fill.image, a, box, rotation, opacity, name)
          continue
        }
        // A rectangle with no fill (only a stroke), or one this cannot fill, stays a picture.
        if (!fill || (!isCircle && Math.abs(num(a.rx, num(a.ry)) - num(a.ry, num(a.rx))) > 0.5)) {
          addToRun(t.tag, node, a, { ...ctx, matrix: m, opacity })
          continue
        }
        flush()
        // A full screen frame's own background, under everything: kept, hidden, so the lower third stays transparent.
        const frameBackground = fullFrame && elements.length === 0 && box.x <= 0.1 && box.y <= 0.1 && box.width >= 99.8 && box.height >= 99.8
        const radiusPx = isCircle ? r : num(a.rx, num(a.ry))
        elements.push(
          rectElement(newId(name), frameBackground ? 'Frame background' : name, box, {
            fill: fill.fill,
            radius: Math.min(50, height(radiusPx, m)),
            border: stroke ? { width: Math.min(10, height(num(a['stroke-width'], 1), m)), color: stroke.hex } : { width: 0, color: BRAND.white },
            shadow: shadowOf(own, m),
            rotation,
            opacity: opacity * fill.alpha,
            hidden: frameBackground,
          }),
        )
        if (frameBackground) warnings.add('The frame’s background was kept but hidden, so the lower third shows over the picture.')
        continue
      }
      if (t.tag === 'text') {
        flush()
        addText(t.children, ctx.wrapper?.name && !own.id ? { ...a, id: ctx.wrapper.name } : a, { matrix: m, opacity, inherited: ctx.inherited })
        continue
      }
      if (t.tag === 'image') {
        flush()
        const { box, rotation } = boxOf(num(a.x), num(a.y), num(a.width), num(a.height), m)
        addImage(a.href ?? a['xlink:href'] ?? null, a, box, rotation, opacity, name)
        continue
      }
      if (t.tag === 'line' && parseColor(a.stroke) && !a['stroke-dasharray']?.includes(',')) {
        flush()
        const p1 = toCanvas(apply(m, num(a.x1), num(a.y1)))
        const p2 = toCanvas(apply(m, num(a.x2), num(a.y2)))
        // Lengths across the 16:9 canvas in units of its height.
        const dx = ((p2.x - p1.x) * 16) / 9
        const dy = p2.y - p1.y
        const length = Math.hypot(dx, dy)
        const thickness = Math.max(0.05, height(num(a['stroke-width'], 1), m))
        const centre = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
        const width = (length * 9) / 16
        elements.push(
          lineElement(newId(name), name, { x: centre.x - width / 2, y: centre.y - thickness, width, height: thickness * 2 }, {
            color: parseColor(a.stroke)!.hex,
            thickness,
            dashed: !!a['stroke-dasharray'] && a['stroke-dasharray'] !== 'none',
            rotation: Math.round(((Math.atan2(dy, dx) * 180) / Math.PI) * 10) / 10,
            opacity: opacity * opacityOf(a['stroke-opacity']),
          }),
        )
        continue
      }
      addToRun(t.tag, node, a, { ...ctx, matrix: m, opacity })
    }
  }

  function boundsOfGroup(nodes: XmlNode[], m: Matrix): { x: number; y: number }[] | null {
    const all: { x: number; y: number }[] = []
    for (const node of nodes) {
      const t = tagOf(node)
      if (!t || SKIPPED.has(t.tag)) continue
      const a = attrsOf(node)
      const inner = multiply(m, parseTransform(a.transform))
      if (t.tag === 'g') all.push(...(boundsOfGroup(t.children, inner) ?? []))
      else all.push(...(shapePoints(t.tag, a) ?? []).map((p) => apply(inner, p.x, p.y)))
    }
    return all.length > 0 ? all : null
  }

  walk(svg.children, { matrix: IDENTITY, opacity: 1, inherited: {} })
  flush()
  if (elements.length === 0) throw new Error('Nothing in this SVG could be imported.')
  return { elements: bindFields(elements), assets, fonts: [...fonts], warnings: [...warnings] }
}

/**
 * Binds the imported text to the lower third's fields, so it can be typed into: the largest text is the headline, the
 * next the body, and a number on its own the point's number.
 */
export function bindFields(elements: DesignElement[]): DesignElement[] {
  const texts = elements.filter((e): e is Extract<DesignElement, { kind: 'text' }> => e.kind === 'text' && !e.hidden)
  const number = texts.find((t) => /^\d{1,3}\.?$/.test(t.text.trim()))
  const rest = texts.filter((t) => t !== number).sort((a, b) => b.fontSize - a.fontSize)
  const fields = new Map<string, 'headline' | 'body' | 'number'>()
  if (number) fields.set(number.id, 'number')
  if (rest[0]) fields.set(rest[0].id, 'headline')
  if (rest[1]) fields.set(rest[1].id, 'body')
  return elements.map((e) => (e.kind === 'text' && fields.has(e.id) ? { ...e, field: fields.get(e.id)! } : e))
}

function decodeBase64(data: string): string {
  if (typeof atob === 'function') return new TextDecoder().decode(Uint8Array.from(atob(data.replace(/\s+/g, '')), (c) => c.charCodeAt(0)))
  return Buffer.from(data, 'base64').toString('utf8')
}

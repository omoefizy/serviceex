// Dev only: launches the app with Playwright and saves a screenshot of every main screen and state to docs/ui-audit/,
// with the style measurements behind docs/ui-audit/REPORT.md. Not shipped; docs/ui-audit/ is not committed.
//
//   node scripts/ui-audit.ts             every screen and state
//   node scripts/ui-audit.ts --compare   only the operator screen, Settings and the welcome, beside the design
//
// Both save the operator screen, Settings and the first run welcome at each size to docs/ui-audit/compare/, each beside
// a picture of its approved design (docs/design/*.reference.html, drawn at the same size) and an index.html that shows
// the pairs side by side.
//
// It also checks the layout of every screen at each size: it exits with an error, listing what failed (also saved to
// layout.json), when the page is taller or wider than the window (document scrollHeight over innerHeight, scrollWidth
// over innerWidth), the toolbar wraps to a second row, or a control lies outside the window or is cut off by the panel
// it sits in.
//
// It also checks the states each screen is in (states.json): no developer text such as a stack trace on screen, no toast
// in the live red, and it lists any bare "Loading…" line or one line "No … yet" left instead of an empty state.
//
// It builds the main process, serves the renderer with Vite (so it can reach the app's stores to set up states such as
// device chips), and runs the app on a fresh, temporary data folder with invented sample data. Your own library and
// settings are never opened. Runs with Node's built-in TypeScript support (Node 22.18 or later).

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import { _electron, chromium, type ElectronApplication, type Page } from 'playwright'
import { build, createServer } from 'vite'
import react from '@vitejs/plugin-react'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'docs', 'ui-audit')
const COMPARE = path.join(OUT, 'compare')
/** Only the screens compared with the design, for a quick run while matching it. */
const COMPARE_ONLY = process.argv.includes('--compare')
/**
 * The approved designs, by the name of the screen they are compared with. The operator screen is Main2 (drawn at 1366
 * by 768), which replaced the operator layout of Main.reference.html.
 */
const REFERENCES = { main: 'Main2.reference.html', settings: 'Settings.reference.html', welcome: 'Welcome.reference.html' } as const
type CompareScreen = keyof typeof REFERENCES
/** Common church laptops (1280 by 720 and 1366 by 768) and a full HD screen. */
const SIZES = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const

// ---------- Invented sample data ----------

/** A lower third as Figma exports it as SVG, with its text kept as text, for Import design. */
const AUDIT_SVG = `<svg width="1920" height="1080" viewBox="0 0 1920 1080" fill="none" xmlns="http://www.w3.org/2000/svg">
<g id="Name_bar"><rect x="96" y="778" width="560" height="108" rx="12" fill="url(#paint0)"/></g>
<rect id="Accent" x="96" y="778" width="12" height="108" fill="#00AFEF"/>
<text id="Name" fill="white" font-family="Montserrat" font-size="54" font-weight="bold"><tspan x="134" y="851">Pastor Sam</tspan></text>
<defs><linearGradient id="paint0" x1="96" y1="832" x2="656" y2="832" gradientUnits="userSpaceOnUse"><stop stop-color="#0087CB"/><stop offset="1" stop-color="#0B1F44"/></linearGradient></defs>
</svg>`

const SONGS = [
  {
    title: 'Morning Light Rising',
    author: 'Sample Writer',
    copyright: '© 2024 Example Music · CCLI 0000001',
    tags: ['opener', 'upbeat'],
    lyrics: `[Verse 1]
Morning light is rising on the hills
Every quiet heart is waking still
Open up the windows of the soul
Let the day begin and make us whole

[Chorus]
Rise, rise, the dawn is calling
Sing, sing, the night is falling away
Rise, rise, our voices joining
Into a brand new day

[Verse 2]
Footsteps on the path we haven't known
Lanterns for the road we walk alone
Gather every voice and every song
Carry us together, carry us along`,
  },
  {
    title: 'Harbor of Grace',
    author: 'Example Collective',
    copyright: '© 2023 Placeholder Songs · CCLI 0000002',
    tags: ['reflective'],
    lyrics: `[Verse 1]
When the waves are high and the wind is strong
There's a harbor where the weary belong

[Chorus]
Harbor of grace, harbor of peace
Here every storm will cease

[Bridge]
Anchor my heart, anchor my heart
Never to drift apart`,
  },
  {
    title: 'Every Valley Sings',
    author: 'A. Placeholder',
    copyright: '© 2022 Demo Publishing · CCLI 0000003',
    tags: ['upbeat'],
    lyrics: `[Verse 1]
Every valley sings, every mountain bows
Every river runs to the sea somehow

[Chorus]
Sing out, sing out, let the whole earth ring
Every valley sings`,
  },
  {
    title: 'Kindled Flame',
    author: 'Sample Writer',
    copyright: '© 2025 Example Music · CCLI 0000004',
    tags: ['response'],
    lyrics: `[Verse 1]
A kindled flame, a steady glow
A light that only grows

[Chorus]
Burn on, burn on in me`,
  },
  {
    title: 'Wide Open Doors',
    author: 'Test Choir',
    copyright: null,
    tags: [],
    lyrics: `[Verse 1]
Wide open doors and a table laid
Room for the ones who were once afraid

[Chorus]
Come in, come in, there's a place for you`,
  },
  {
    title: 'Still Waters Hymn',
    author: 'Traditional (sample)',
    copyright: null,
    tags: ['hymn', 'reflective'],
    lyrics: `[Verse 1]
Beside the still and quiet stream
My soul is led to rest

[Verse 2]
Through shaded vale and open field
My every step is blessed`,
  },
]

const MEDIA = [
  { name: 'Dawn Gradient', from: [255, 166, 77], to: [120, 48, 160] },
  { name: 'Ocean Blue', from: [12, 52, 110], to: [40, 170, 200] },
  { name: 'Warm Amber', from: [140, 60, 10], to: [250, 200, 90] },
  { name: 'Forest Mist', from: [20, 60, 40], to: [150, 190, 160] },
  { name: 'Violet Dusk', from: [40, 20, 70], to: [200, 120, 200] },
  { name: 'Slate Texture', from: [40, 44, 52], to: [110, 118, 130] },
] as const

/** A minimal PNG encoder for the sample backgrounds: a diagonal gradient with a soft circle. */
function gradientPng(width: number, height: number, from: readonly number[], to: readonly number[]): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  let o = 0
  for (let y = 0; y < height; y++) {
    raw[o++] = 0
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2
      const glow = Math.max(0, 1 - Math.hypot(x - width * 0.7, y - height * 0.35) / (height * 0.6)) * 40
      for (let c = 0; c < 3; c++) raw[o++] = Math.min(255, Math.round(from[c] + (to[c] - from[c]) * t + glow))
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------- Style measurements, run in the page ----------

type Counts = Record<string, number>

interface Metrics {
  viewport: { width: number; height: number }
  fontFamilies: Counts
  fontSizes: Counts
  fontWeights: Counts
  textColors: Counts
  backgroundColors: Counts
  borderColors: Counts
  radii: Counts
  spacing: Counts
  shadows: Counts
  iconSizes: Counts
  iconStrokes: Counts
  buttonStyles: Counts
  inputStyles: Counts
  inlineStyleProps: Counts
  inlineStyled: number
  /** Drawn size, and the hit area when that is larger. */
  smallTargets: { label: string; className: string; width: number; height: number; hit?: string }[]
  lowContrast: { text: string; className: string; color: string; background: string; ratio: number; fontSize: string; disabled: boolean }[]
  clippedText: { text: string; className: string; ellipsis: boolean }[]
  offscreen: { text: string; className: string; right: number; bottom: number }[]
  pageScrolls: { horizontal: boolean; vertical: boolean }
}

/** Measures every visible element. Slide previews and the output are the operator's content, so they are left out. */
function collectMetrics(): Metrics {
  const CONTENT = '.output-frame, .output, .theme-canvas, .lt-text-box, .themed-box, .themed-element, .themed-bg, .slide-text, .logo-placeholder'
  const INTERACTIVE =
    'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=menuitem], [role=checkbox], [role=switch], [role=option], [tabindex]:not([tabindex="-1"])'
  type Rgba = { r: number; g: number; b: number; a: number }
  /** sRGB from linear light, 0 to 255. */
  const encode = (v: number) => 255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055))
  /** Computed colors come as rgb(), or as color(srgb …), oklab() or oklch() when a token mixes or derives them. */
  const parse = (value: string): Rgba | null => {
    const m = /(rgba?|color|oklab|oklch)\(([^)]+)\)/.exec(value)
    if (!m) return null
    const [main, alpha] = m[2].split('/')
    const parts = main.trim().split(/[\s,]+/).filter(Boolean)
    const a = alpha !== undefined ? Number(alpha.trim()) : m[1] === 'rgba' && parts[3] !== undefined ? Number(parts[3]) : 1
    if (m[1] === 'rgb' || m[1] === 'rgba') return { r: Number(parts[0]), g: Number(parts[1]), b: Number(parts[2]), a }
    if (m[1] === 'color') {
      if (parts[0] !== 'srgb') return null
      return { r: Number(parts[1]) * 255, g: Number(parts[2]) * 255, b: Number(parts[3]) * 255, a }
    }
    const n = parts.map((p) => (p.endsWith('%') ? Number(p.slice(0, -1)) / 100 : Number(p)))
    const [L, A, B] = m[1] === 'oklab' ? n : [n[0], n[1] * Math.cos((n[2] * Math.PI) / 180), n[1] * Math.sin((n[2] * Math.PI) / 180)]
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
    const mm = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
    const ss = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
    return {
      r: encode(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * ss),
      g: encode(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * ss),
      b: encode(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * ss),
      a,
    }
  }
  const hex = (c: Rgba) =>
    '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') + (c.a < 1 ? ` @${Math.round(c.a * 100) / 100}` : '')
  const over = (top: Rgba, base: Rgba): Rgba => ({
    r: top.r * top.a + base.r * (1 - top.a),
    g: top.g * top.a + base.g * (1 - top.a),
    b: top.b * top.a + base.b * (1 - top.a),
    a: 1,
  })
  const luminance = (c: Rgba) => {
    const ch = (v: number) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b)
  }
  const contrast = (a: Rgba, b: Rgba) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  const add = (counts: Counts, key: string) => (counts[key] = (counts[key] ?? 0) + 1)
  const label = (el: Element) =>
    (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]')
  }
  /** The color behind an element, or null over a gradient or picture. */
  const backdrop = (el: Element): Rgba | null => {
    const layers: Rgba[] = []
    for (let n: Element | null = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.backgroundImage !== 'none') return null
      const c = parse(cs.backgroundColor)
      if (c && c.a > 0) {
        layers.push(c)
        if (c.a >= 1) break
      }
    }
    return layers.reverse().reduce<Rgba>((base, layer) => over(layer, base), { r: 255, g: 255, b: 255, a: 1 })
  }
  /** What can be clicked: the box, grown by an invisible ::before hit area and by the input's <label>s. */
  const hitBox = (el: Element) => {
    const r = el.getBoundingClientRect()
    let width = r.width
    let height = r.height
    const before = getComputedStyle(el, '::before')
    if (before.content !== 'none' && before.position === 'absolute') {
      width = Math.max(width, parseFloat(before.width) || 0)
      height = Math.max(height, parseFloat(before.height) || 0)
    }
    for (const labelEl of Array.from((el as HTMLInputElement).labels ?? [])) {
      const box = labelEl.getBoundingClientRect()
      width = Math.max(width, box.width)
      height = Math.max(height, box.height)
    }
    return { width, height }
  }
  const opacityOf = (el: Element) => {
    let o = 1
    for (let n: Element | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity)
    return o
  }

  const m: Metrics = {
    viewport: { width: innerWidth, height: innerHeight },
    fontFamilies: {},
    fontSizes: {},
    fontWeights: {},
    textColors: {},
    backgroundColors: {},
    borderColors: {},
    radii: {},
    spacing: {},
    shadows: {},
    iconSizes: {},
    iconStrokes: {},
    buttonStyles: {},
    inputStyles: {},
    inlineStyleProps: {},
    inlineStyled: 0,
    smallTargets: [],
    lowContrast: [],
    clippedText: [],
    offscreen: [],
    pageScrolls: {
      horizontal: document.documentElement.scrollWidth > innerWidth,
      vertical: document.documentElement.scrollHeight > innerHeight,
    },
  }

  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    if (!visible(el) || el.closest(CONTENT)) continue
    const cs = getComputedStyle(el)
    const cls = typeof el.className === 'string' ? el.className : (el.getAttribute('class') ?? '')

    if (el instanceof SVGSVGElement) {
      const r = el.getBoundingClientRect()
      add(m.iconSizes, `${Math.round(r.width)}x${Math.round(r.height)}`)
      add(m.iconStrokes, el.getAttribute('stroke-width') ?? cs.strokeWidth)
      continue
    }
    if (el.closest('svg')) continue

    const bg = parse(cs.backgroundColor)
    if (bg && bg.a > 0) add(m.backgroundColors, hex(bg))
    for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
      const width = cs.getPropertyValue(`border-${side.toLowerCase()}-width`)
      const style = cs.getPropertyValue(`border-${side.toLowerCase()}-style`)
      const color = parse(cs.getPropertyValue(`border-${side.toLowerCase()}-color`))
      if (width !== '0px' && style !== 'none' && color && color.a > 0) add(m.borderColors, hex(color))
    }
    if (cs.borderRadius !== '0px') add(m.radii, cs.borderRadius)
    if (cs.boxShadow !== 'none') add(m.shadows, cs.boxShadow)
    for (const prop of ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'row-gap', 'column-gap']) {
      const v = cs.getPropertyValue(prop)
      if (v && v !== '0px' && v !== 'normal' && v !== 'auto') add(m.spacing, v)
    }

    const styleAttr = el.getAttribute('style')
    if (styleAttr) {
      m.inlineStyled++
      for (const decl of styleAttr.split(';')) {
        const prop = decl.split(':')[0].trim()
        if (prop) add(m.inlineStyleProps, prop)
      }
    }

    if (el.matches('button, .button, .icon-button, [role=button]')) {
      add(m.buttonStyles, `${cls.split(' ').slice(0, 2).join('.') || el.tagName.toLowerCase()} | h${Math.round(el.getBoundingClientRect().height)} | pad ${cs.padding} | r ${cs.borderRadius} | bg ${bg ? hex(bg) : 'none'} | ${cs.fontSize}/${cs.fontWeight}`)
    }
    if (el.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]), select, textarea')) {
      add(m.inputStyles, `${el.tagName.toLowerCase()}.${cls.split(' ')[0] || '(none)'} | h${Math.round(el.getBoundingClientRect().height)} | pad ${cs.padding} | r ${cs.borderRadius} | bg ${bg ? hex(bg) : 'none'} | ${cs.fontSize}`)
    }

    if (el.matches(INTERACTIVE)) {
      const r = el.getBoundingClientRect()
      const hit = hitBox(el)
      if (hit.width < 32 || hit.height < 32) {
        m.smallTargets.push({
          label: label(el),
          className: `${el.tagName.toLowerCase()}${cls ? '.' + cls.split(' ').join('.') : ''}`,
          width: Math.round(r.width),
          height: Math.round(r.height),
          ...(hit.width > r.width || hit.height > r.height ? { hit: `${Math.round(hit.width)}x${Math.round(hit.height)}` } : {}),
        })
      }
    }

    const ownText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim())
    const isField = el.matches('input, textarea, select')
    if (!ownText && !isField) continue

    add(m.fontFamilies, cs.fontFamily)
    add(m.fontSizes, cs.fontSize)
    add(m.fontWeights, cs.fontWeight)
    const fg = parse(cs.color)
    const behind = backdrop(el)
    if (fg) add(m.textColors, hex(fg))
    if (fg && behind && ownText) {
      const opacity = opacityOf(el) * fg.a
      const seen = over({ ...fg, a: opacity }, behind)
      const ratio = contrast(seen, behind)
      const size = parseFloat(cs.fontSize)
      const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700)
      if (ratio < (large ? 3 : 4.5)) {
        m.lowContrast.push({
          text: label(el),
          className: cls,
          color: hex(fg) + (opacity < 1 ? ` (x${Math.round(opacity * 100) / 100} opacity)` : ''),
          background: hex(behind),
          ratio: Math.round(ratio * 100) / 100,
          fontSize: cs.fontSize,
          disabled: !!el.closest(':disabled, [aria-disabled=true]'),
        })
      }
    }

    const r = el.getBoundingClientRect()
    if (ownText && (cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 1) {
      m.clippedText.push({ text: label(el), className: cls, ellipsis: cs.textOverflow === 'ellipsis' })
    }
    if (ownText && (r.right > innerWidth + 1 || r.bottom > innerHeight + 1)) {
      let scrolled = false
      for (let n = el.parentElement; n; n = n.parentElement) {
        const ps = getComputedStyle(n)
        if (/(auto|scroll)/.test(ps.overflowX + ps.overflowY)) scrolled = true
      }
      if (!scrolled) m.offscreen.push({ text: label(el), className: cls, right: Math.round(r.right), bottom: Math.round(r.bottom) })
    }
  }
  return m
}

// ---------- Layout check, run in the page ----------

interface LayoutProblem {
  kind: 'page-overflow' | 'toolbar-wraps' | 'outside-window' | 'cut-off' | 'covers-monitors'
  what: string
  detail: string
}

/**
 * Whether the screen fits the window: nothing scrolls the page sideways, the toolbar is one row, and every visible
 * control is inside the window and not cut off by a panel. A control scrolled out of sight in a list that scrolls up
 * and down is fine; one cut off sideways is not, as nobody scrolls sideways to find a button.
 */
function checkLayout(): LayoutProblem[] {
  const CONTENT = '.output-frame, .output, .theme-canvas, .lt-text-box, .themed-box, .themed-element, .themed-bg, .slide-text, .logo-placeholder'
  const INTERACTIVE =
    'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=menuitem], [role=checkbox], [role=switch], [role=option], [role=separator][tabindex]'
  const problems: LayoutProblem[] = []
  const describe = (el: Element) => {
    const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
    const text = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)
    return `${el.tagName.toLowerCase()}${cls}${text ? ` "${text}"` : ''}`
  }
  const px = (n: number) => Math.round(n)

  // The page is exactly the window: it never scrolls, either way, even with its scrollbars hidden.
  const doc = document.documentElement
  // What sticks out: the lowest boxes below the window that no ancestor clips.
  const sticking = () =>
    Array.from(document.body.querySelectorAll('*'))
      .filter((el) => {
        const r = el.getBoundingClientRect()
        if (r.height === 0 || r.bottom + scrollY <= innerHeight + 1) return false
        for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) if (getComputedStyle(n).overflowY !== 'visible') return false
        return true
      })
      .slice(0, 3)
      .map((el) => `${describe(el).slice(0, 50)} to ${px(el.getBoundingClientRect().bottom + scrollY)} px`)
      .join('; ')
  if (doc.scrollHeight > innerHeight) problems.push({ kind: 'page-overflow', what: 'document', detail: `scrollHeight ${doc.scrollHeight} px in a ${innerHeight} px window: ${sticking()}` })
  if (doc.scrollWidth > innerWidth) problems.push({ kind: 'page-overflow', what: 'document', detail: `scrollWidth ${doc.scrollWidth} px in a ${innerWidth} px window` })
  for (const el of [document.documentElement, document.body, document.getElementById('root'), document.querySelector('.app'), document.querySelector('.operator'), document.querySelector('.toolbar')]) {
    if (el && el.scrollWidth > el.clientWidth + 1) problems.push({ kind: 'page-overflow', what: describe(el).slice(0, 40), detail: `${el.scrollWidth} px of content in ${el.clientWidth} px` })
  }
  for (const el of [document.body, document.getElementById('root'), document.querySelector('.app'), document.querySelector('.operator:not([hidden])'), document.querySelector('.settings-page')]) {
    if (el && el.scrollHeight > el.clientHeight + 1) problems.push({ kind: 'page-overflow', what: describe(el).slice(0, 40), detail: `${el.scrollHeight} px of content in ${el.clientHeight} px tall` })
  }
  // The transcript and the list of everything heard open in the middle column: neither covers Live or Preview.
  const monitors = document.querySelector('.operator-right')?.getBoundingClientRect()
  for (const el of Array.from(document.querySelectorAll('.transcript-dock, .heard-all-popover'))) {
    if (!monitors || el.closest('[hidden]')) continue
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.right > monitors.left + 1 && r.left < monitors.right - 1 && r.bottom > monitors.top + 1 && r.top < monitors.bottom - 1) {
      problems.push({ kind: 'covers-monitors', what: describe(el).slice(0, 40), detail: `right edge at ${px(r.right)} px, the monitors start at ${px(monitors.left)} px` })
    }
  }
  const toolbar = document.querySelector('.toolbar')
  if (toolbar && toolbar.getBoundingClientRect().height > 64) problems.push({ kind: 'toolbar-wraps', what: 'header.toolbar', detail: `${px(toolbar.getBoundingClientRect().height)} px tall` })

  for (const el of Array.from(document.body.querySelectorAll(INTERACTIVE))) {
    if (el.closest(CONTENT) || el.closest('[hidden]')) continue
    const r = el.getBoundingClientRect()
    // Visually hidden inputs (a styled checkbox, a file input behind a button) are 1 px or less.
    if (r.width <= 1 || r.height <= 1) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue

    // The boxes that clip it: its ancestors that are not visible-overflow, following the containing blocks, so an
    // absolutely placed popup is not counted as clipped by a static ancestor it escapes. A box that scrolls up and down
    // can bring any of its contents into view, so above it only the scrolling box's own top and bottom need to fit.
    let top = r.top
    let bottom = r.bottom
    let cut: string | null = null
    let needPositioned = cs.position === 'absolute'
    if (cs.position !== 'fixed') {
      for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
        const ns = getComputedStyle(n)
        if (needPositioned && ns.position === 'static' && ns.transform === 'none') continue
        needPositioned = ns.position === 'absolute'
        const box = n.getBoundingClientRect()
        if (ns.overflowX !== 'visible' && (r.left < box.left - 1 || r.right > box.right + 1)) {
          cut = `${px(r.left)} to ${px(r.right)} px, outside ${describe(n).slice(0, 40)} (${px(box.left)} to ${px(box.right)} px)`
          break
        }
        if (/(auto|scroll)/.test(ns.overflowY)) {
          top = Math.max(box.top, Math.min(top, box.bottom))
          bottom = Math.min(box.bottom, Math.max(bottom, box.top))
        } else if (/(hidden|clip)/.test(ns.overflowY) && (top < box.top - 1 || bottom > box.bottom + 1)) {
          cut = `top ${px(top)} to ${px(bottom)} px, outside ${describe(n).slice(0, 40)} (${px(box.top)} to ${px(box.bottom)} px)`
          break
        }
        if (ns.position === 'fixed') break
      }
    }
    // A panel column that does not clip can still be painted over by the next one, so a control must also stay inside
    // its own column of the operator screen.
    const column = cs.position === 'fixed' ? null : Array.from(document.querySelectorAll('.operator > :not(.layout-slot), .operator > .layout-slot > *')).find((c) => c.contains(el))
    const own = column?.getBoundingClientRect()
    if (!cut && own && !el.closest('.live-menu-list, .status-popover, .modal, .modal-backdrop, [role=menu], [role=dialog]') && (r.left < own.left - 1 || r.right > own.right + 1)) {
      cut = `${px(r.left)} to ${px(r.right)} px, past its column ${describe(column!).slice(0, 40)} (${px(own.left)} to ${px(own.right)} px)`
    }
    if (r.left < -1 || r.right > innerWidth + 1) problems.push({ kind: 'outside-window', what: describe(el), detail: `${px(r.left)} to ${px(r.right)} px in a ${innerWidth} px window` })
    else if (cut) problems.push({ kind: 'cut-off', what: describe(el), detail: cut })
    else if (top < -1 || bottom > innerHeight + 1) problems.push({ kind: 'outside-window', what: describe(el), detail: `${px(top)} to ${px(bottom)} px in a ${innerHeight} px window` })
  }
  return problems
}

// ---------- Static scan of the stylesheet and components ----------

interface StateReport {
  /** Visible text written for developers: a stack trace, "Cannot read properties of …", an IPC wrapper. */
  developerText: string[]
  /** A visible line that is only "Loading…": it should be a skeleton, and never last. */
  loadingText: string[]
  /** Toasts drawn in a live red, which is reserved for on air. */
  toastsInLiveRed: string[]
  /** The old one line empty states (`.empty`) still showing, instead of an EmptyState. */
  bareEmptyLines: string[]
  emptyStates: { title: string; actions: string[] }[]
  errorNotes: { text: string; hasDetails: boolean }[]
  toasts: { tone: string; text: string }[]
}

/** What state the screen is in, and whether that state is finished. Runs in the page. */
function checkStates(): StateReport {
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0 && !el.closest('[hidden], .ui-details-text, .visually-hidden')
  }
  const DEV = [/Cannot (read|set) propert/i, /is not a function/, /is not defined/, /Error invoking remote method/, /Minified React error/, /^\s*at .+:\d+:\d+/m, /\b(TypeError|ReferenceError|SyntaxError|RangeError):/, /reactjs\.org/]
  const texts: string[] = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim()
    if (text && node.parentElement && visible(node.parentElement)) texts.push(text)
  }
  const ownText = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  const rgb = (value: string) => {
    const probe = document.createElement('span')
    probe.style.color = value
    document.body.appendChild(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }
  const root = getComputedStyle(document.documentElement)
  const liveReds = new Set(['--live', '--live-strong', '--live-text'].map((t) => rgb(root.getPropertyValue(t).trim())))
  const toastEls = [...document.querySelectorAll('.ui-toast')].filter(visible)
  return {
    developerText: [...new Set(texts.filter((t) => DEV.some((re) => re.test(t))))],
    loadingText: [...new Set(texts.filter((t) => /^Loading(…|\.\.\.)$/.test(t)))],
    toastsInLiveRed: toastEls
      .filter((el) => {
        const cs = getComputedStyle(el)
        const icon = el.querySelector('svg')
        return liveReds.has(cs.borderLeftColor) || (icon !== null && liveReds.has(getComputedStyle(icon).color))
      })
      .map(ownText),
    bareEmptyLines: [...document.querySelectorAll('.empty')].filter(visible).map(ownText),
    emptyStates: [...document.querySelectorAll('.ui-empty')].filter(visible).map((el) => ({
      title: ownText(el.querySelector('.ui-empty-title') ?? el),
      actions: [...el.querySelectorAll('.ui-empty-actions button')].map(ownText),
    })),
    errorNotes: [...document.querySelectorAll('.ui-error-note')].filter(visible).map((el) => ({ text: ownText(el.querySelector('.ui-error-note-text') ?? el), hasDetails: el.querySelector('.ui-details') !== null })),
    toasts: toastEls.map((el) => ({ tone: [...el.classList].find((c) => c.startsWith('ui-toast--'))?.slice(10) ?? 'info', text: ownText(el) })),
  }
}

function staticScan() {
  // The tokens live in src/styles/tokens.css; everything else (the app's stylesheet and the shared components') is
  // checked for colors written out instead of taken from a token.
  const rootBlock = readFileSync(path.join(ROOT, 'src', 'styles', 'tokens.css'), 'utf8')
  const body = ['src/index.css', 'src/components/ui/ui.css'].map((f) => readFileSync(path.join(ROOT, f), 'utf8')).join('\n')
  const css = rootBlock + '\n' + body
  const componentDir = path.join(ROOT, 'src', 'components')
  const components = [componentDir, path.join(componentDir, 'ui')].flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => ({ file: path.relative(componentDir, path.join(dir, f)), text: readFileSync(path.join(dir, f), 'utf8') })),
  )
  const count = (text: string, re: RegExp) => {
    const counts: Counts = {}
    for (const match of text.matchAll(re)) counts[match[1] ?? match[0]] = (counts[match[1] ?? match[0]] ?? 0) + 1
    return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]))
  }

  // The class names on <button> elements, and whether the stylesheet gives each a hover, focus and disabled look.
  const buttonClasses = new Set<string>()
  for (const { text } of components) {
    for (const match of text.matchAll(/<button[^>]*?className=(?:"([^"]+)"|\{`([^`]+)`\})/gs)) {
      const names = (match[1] ?? match[2]).replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter((n) => /^[a-z][a-z0-9-]*$/.test(n))
      if (names[0]) buttonClasses.add(names[0])
    }
  }
  const has = (cls: string, state: string) => new RegExp(`\\.${cls}(?![\\w-])[^{,]*:${state}`).test(css)
  const buttonStates = [...buttonClasses].sort().map((cls) => ({
    class: cls,
    hover: has(cls, 'hover'),
    focus: has(cls, 'focus') || has(cls, 'focus-visible'),
    disabled: has(cls, 'disabled'),
  }))

  return {
    cssLines: body.split('\n').length,
    rootTokens: count(rootBlock, /(--[a-z0-9-]+):/g),
    hexColorsOutsideTokens: count(body.replace(/\/\*[\s\S]*?\*\//g, ''), /(#[0-9a-fA-F]{3,8})\b/g),
    rgbaOutsideTokens: count(body.replace(/\/\*[\s\S]*?\*\//g, ''), /(rgba?\([^)]*\))/g),
    varUses: count(body, /var\((--[a-z0-9-]+)\)/g),
    fontSizeDeclarations: count(css, /font-size:\s*([^;]+);/g),
    fontShorthands: count(css, /\bfont:\s*([^;]+);/g),
    fontFamilies: count(css, /font-family:\s*([^;]+);/g),
    radiusDeclarations: count(css, /border-radius:\s*([^;]+);/g),
    rawPxSpacing: count(css, /(?:padding|margin|gap)(?:-[a-z]+)?:\s*([^;]*\d+px[^;]*);/g),
    boxShadows: count(css, /box-shadow:\s*([^;]+);/g),
    transitions: count(css, /transition:\s*([^;]+);/g),
    globalFocusRules: css.match(/^[^{}\n]*:focus(?:-visible)?[^{}\n]*\{/gm)?.filter((r) => !r.trim().startsWith('.')) ?? [],
    focusVisibleRules: (css.match(/:focus-visible/g) ?? []).length,
    focusRules: (css.match(/:focus(?!-)/g) ?? []).length,
    hoverRules: (css.match(/:hover/g) ?? []).length,
    disabledRules: (css.match(/:disabled/g) ?? []).length,
    outlineNone: (css.match(/outline:\s*(none|0)\b/g) ?? []).length,
    inlineStylesPerComponent: Object.fromEntries(
      components
        .map(({ file, text }) => [file, (text.match(/style=\{\{/g) ?? []).length] as const)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1]),
    ),
    hexInComponents: Object.fromEntries(
      components
        .map(({ file, text }) => [file, [...new Set(text.match(/['"`]#[0-9a-fA-F]{3,8}\b/g)?.map((h) => h.slice(1)) ?? [])]] as const)
        .filter(([, list]) => list.length > 0),
    ),
    buttonStates,
    /** Rules for toasts, errors and warnings that use a live red token: there should be none. */
    liveRedInStatusRules: [...body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, selector, rules]) => /toast|error|warning|duplicate-flag|import-problems/.test(selector) && /var\(--live/.test(rules))
      .map(([, selector]) => selector.trim()),
  }
}

// ---------- Driving the app ----------

interface Hooks {
  store: { getState(): Record<string, (...args: unknown[]) => unknown> & Record<string, unknown>; setState(patch: object): void }
  sharing: { setState(patch: object): void }
  account: { openPlans(open: boolean): void; setAccountState(state: object): void }
  features: { FEATURE_KEYS: string[] }
  suggestions: { getState(): { add(s: object): unknown; clear(): void } }
}
type AuditWindow = Window & { __audit: Hooks }

/** Reaches the app's own stores through the Vite dev server: the same module URLs the app imported. */
async function installHooks(page: Page) {
  await page.waitForSelector('.toolbar')
  await page.evaluate(async () => {
    const load = (url: string) => import(/* @vite-ignore */ url)
    const [store, sharing, account, features, detection] = await Promise.all([
      load('/src/store.ts'),
      load('/src/lib/sharing.ts'),
      load('/src/lib/account.ts'),
      load('/shared/features.ts'),
      load('/src/lib/scriptureDetection.ts'),
    ])
    ;(window as unknown as AuditWindow).__audit = { store: store.useOperatorStore, sharing: sharing.useSharingStore, account, features, suggestions: detection.useSuggestions }
  })
}

/** Closes every centre screen, modal and popup. */
async function resetScreens(page: Page) {
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    const { store, sharing, account } = (window as unknown as AuditWindow).__audit
    const s = store.getState()
    s.editSong(null)
    s.openThemeEditor(false)
    s.openSettings(false)
    s.openStreamPanel(false)
    s.openSermons(false)
    s.setPaletteOpen(false)
    account.openPlans(false)
    sharing.setState({ inboxOpen: false })
  })
}

async function settle(page: Page, ms = 500) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(ms)
  // Clicking something outside the window scrolls the whole app sideways; shoot it as it opens.
  await page.evaluate(() => {
    for (const el of [document.documentElement, document.body, document.getElementById('root'), document.querySelector('.app')]) if (el) el.scrollLeft = 0
  })
}

async function libraryTab(page: Page, name: string) {
  await page.locator('.finder').getByRole('tab', { name, exact: true }).click()
}

const metrics: Record<string, Metrics> = {}
const layout: Record<string, LayoutProblem[]> = {}
const states: Record<string, StateReport> = {}
const shots: string[] = []

async function shot(page: Page, name: string) {
  await settle(page)
  const file = `${name}.png`
  await page.screenshot({ path: path.join(OUT, file) })
  metrics[name] = await page.evaluate(collectMetrics)
  layout[name] = await page.evaluate(checkLayout)
  states[name] = await page.evaluate(checkStates)
  shots.push(file)
  const failed = layout[name].length
  const unfinished = states[name].developerText.length + states[name].toastsInLiveRed.length
  console.log(`  ${file}${failed ? `  (${failed} layout problem${failed === 1 ? '' : 's'})` : ''}${unfinished ? `  (${unfinished} state problem${unfinished === 1 ? '' : 's'})` : ''}`)
}

/** Sizes the operator window's content; falls back to emulating the viewport when the screen is smaller. */
async function setSize(app: ElectronApplication, page: Page, size: { width: number; height: number }) {
  await app.evaluate(({ BrowserWindow }, { width, height }) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('#/'))
    win?.setContentSize(width, height)
  }, size)
  await page.waitForTimeout(300)
  const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  if (actual.width !== size.width || actual.height !== size.height) await page.setViewportSize(size)
}

const today = new Date().toISOString().slice(0, 10)

/** The screens shot for the comparison, in the order of the index page. */
const compared: { screen: CompareScreen; width: number; height: number }[] = []

/** Shoots a screen for the comparison, with the usual measurements and layout check. */
async function compareShot(page: Page, screen: CompareScreen, size: { width: number; height: number }) {
  mkdirSync(COMPARE, { recursive: true })
  await shot(page, `compare/${screen}@${size.width}`)
  compared.push({ screen, ...size })
}

/**
 * Each approved design at each size, saved beside the app's picture as <screen>@<width>.reference.png. The designs are
 * drawn at one size (1366 by 768, or 1440 by 900); their root is stretched to the window so they show what the design
 * does at that size.
 */
async function captureReferences() {
  mkdirSync(COMPARE, { recursive: true })
  const browser = await chromium.launch()
  try {
    for (const [screen, file] of Object.entries(REFERENCES)) {
      for (const size of SIZES) {
        const page = await browser.newPage({ viewport: size, colorScheme: 'dark' })
        await page.goto(pathToFileURL(path.join(ROOT, 'docs', 'design', file)).href, { waitUntil: 'networkidle' }).catch(() => undefined)
        await page.addStyleTag({ content: 'body > div:first-of-type { width: 100vw !important; height: 100vh !important; }' })
        await page.evaluate(() => document.fonts.ready)
        await page.screenshot({ path: path.join(COMPARE, `${screen}@${size.width}.reference.png`) })
        await page.close()
      }
    }
  } finally {
    await browser.close()
  }
  console.log(`  ${Object.keys(REFERENCES).length * SIZES.length} reference pictures in ${path.relative(ROOT, COMPARE)}/`)
}

/**
 * The operator screen as Main2.reference.html shows it: John 3:16 to 18 live at verse 16, three verses heard in the
 * sermon (Romans 8:1 just now and in the preview, Psalm 23:4 20 seconds ago, John 3:16 a minute ago and live), the
 * Scripture tab open at John 3. Then Settings at its listening page.
 */
async function compareScreens(page: Page, serviceId: number, size: { width: number; height: number }) {
  // The chapter first, so the list follows the verse as it goes live.
  await libraryTab(page, 'Scripture')
  await page.getByLabel('Search scripture').fill('john 3')
  await page.waitForTimeout(400)
  await page.getByLabel('Search scripture').blur()
  await page.evaluate(async (id) => {
    const { store, suggestions } = (window as unknown as AuditWindow).__audit
    type Passage = { title: string; verses: { text: string; caption: string }[] }
    const st = store.getState() as unknown as { openService(id: number): Promise<void>; selectScripture(title: string, slides: Passage['verses']): void; goLive(i: number): void }
    await st.openService(id)
    const books = await window.api.bible.listBooks()
    const john = books.find((b) => /^john$/i.test(b)) ?? books[42]
    const read = async (book: string, chapter: number, from: number, to: number): Promise<Passage> => {
      const verses = await window.api.bible.getRange('KJV', book, chapter, from, to)
      const label = `${book} ${chapter}:${from}${to > from ? `-${to}` : ''}`
      return { title: `${label} KJV`, verses: verses.map((v) => ({ text: v.text, caption: `${v.book} ${v.chapter}:${v.verse} KJV` })) }
    }
    const live = await read(john, 3, 16, 18)
    st.selectScripture(live.title, live.verses)
    st.goLive(0)
    const now = Date.now()
    const heard = [
      { book: john, chapter: 3, verse: 16, confidence: 0.97, ago: 60_000 },
      { book: books.find((b) => /^psalm/i.test(b)) ?? books[18], chapter: 23, verse: 4, confidence: 0.61, ago: 20_000 },
      { book: books.find((b) => /^romans/i.test(b)) ?? books[44], chapter: 8, verse: 1, confidence: 0.94, ago: 0 },
    ]
    suggestions.getState().clear()
    for (const h of heard) {
      // John 3:16 is heard as the live passage, so its row shows LIVE.
      const passage = h.verse === 16 ? live : await read(h.book, h.chapter, h.verse, h.verse)
      const label = `${h.book} ${h.chapter}:${h.verse}`
      suggestions.getState().add({
        reference: { book: h.book, chapter: h.chapter, verseStart: h.verse, verseEnd: h.verse },
        label,
        passage,
        confidence: h.confidence,
        text: passage.verses[0]?.text ?? '',
        version: 'KJV',
        alternatives: [],
        heardAt: now - h.ago,
        kind: 'reference',
        heard: label,
      })
    }
    const newest = (suggestions.getState() as unknown as { suggestions: { id: number }[]; preview(id: number): void })
    newest.preview(newest.suggestions[0].id)
  }, serviceId)
  await page.waitForTimeout(400)
  await compareShot(page, 'main', size)
  if (!COMPARE_ONLY) {
    await page.locator('.heard-strip').getByRole('button', { name: /^See all/ }).click()
    await shot(page, `12-heard-see-all@${size.width}`)
    await page.keyboard.press('Escape')
  }
  await page.getByLabel('Search scripture').fill('')
  await page.evaluate(() => (window as unknown as AuditWindow).__audit.suggestions.getState().clear())

  await page.evaluate(() => (window as unknown as AuditWindow).__audit.store.getState().openSettings(true))
  const listening = page.locator('.settings-nav-item', { hasText: 'Sermon listener' })
  if (await listening.count()) await listening.first().click()
  await compareShot(page, 'settings', size)
  await resetScreens(page)
}

/** compare/index.html: each screen beside its design, at each size. */
function writeCompareIndex() {
  const rows = compared
    .map(
      ({ screen, width, height }) => `<section><h2>${screen} at ${width} by ${height}</h2><div class="pair">
<figure><img src="${screen}@${width}.png" alt="The app"><figcaption>App</figcaption></figure>
<figure><img src="${screen}@${width}.reference.png" alt="The design"><figcaption>Design</figcaption></figure></div></section>`,
    )
    .join('\n')
  writeFileSync(
    path.join(COMPARE, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>App beside the design</title>
<style>body{margin:24px;background:#111;color:#eee;font:14px system-ui}h2{font-size:15px;text-transform:capitalize}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0}img{width:100%;border:1px solid #333}figcaption{color:#999;margin-top:4px}</style>
${rows}`,
  )
}

/**
 * The dev UI kit: a picture only. It shows disabled and forced states on purpose, so it stays out of the counts. It needs
 * nothing from Electron, so a plain browser page shows it. It runs first, on its own dev server: once the main process is
 * built, NODE_ENV is production and the kit route is left out.
 */
async function captureUiKit() {
  const server = await createServer({ root: ROOT, configFile: false, plugins: [react()], logLevel: 'warn', server: { port: 5298 } })
  await server.listen()
  const browser = await chromium.launch()
  try {
    const kit = await browser.newPage({ viewport: SIZES[0], colorScheme: 'dark' })
    kit.on('pageerror', (error) => console.warn('  UI kit:', error.message))
    await kit.goto(`${server.resolvedUrls!.local[0]}#/ui-kit`)
    await kit.waitForSelector('.kit')
    await settle(kit, 800)
    await kit.screenshot({ path: path.join(OUT, '50-ui-kit.png'), fullPage: true })
    shots.push('50-ui-kit.png')
    console.log('  50-ui-kit.png')
  } catch (error) {
    console.warn('  The UI kit could not be captured:', error instanceof Error ? error.message.split('\n')[0] : error)
  } finally {
    await browser.close()
    await server.close()
  }
}

async function main() {
  // Last run's pictures and measurements go; the report, which is committed, stays.
  mkdirSync(OUT, { recursive: true })
  for (const file of readdirSync(OUT)) if (file !== 'REPORT.md') rmSync(path.join(OUT, file), { recursive: true, force: true })
  if (!COMPARE_ONLY) await captureUiKit()
  console.log('The approved designs:')
  await captureReferences()

  // An empty server address means the build talks to no server; account screens show their offline states.
  delete process.env.SERVICEEX_API_URL
  console.log('Building the main process…')
  await build({ root: ROOT, configFile: path.join(ROOT, 'vite.config.ts'), logLevel: 'warn' })

  const server = await createServer({ root: ROOT, configFile: false, plugins: [react()], logLevel: 'warn', server: { port: 5299 } })
  await server.listen()
  const url = server.resolvedUrls!.local[0]

  const userData = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'serviceex-ui-audit-')))
  const mediaDir = path.join(userData, 'sample-media')
  mkdirSync(mediaDir)
  const mediaFiles = MEDIA.map(({ name, from, to }) => {
    const file = path.join(mediaDir, `${name}.png`)
    writeFileSync(file, gradientPng(960, 540, from, to))
    return file
  })

  console.log(`Launching on a fresh data folder: ${userData}`)
  const app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: ROOT,
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  })
  try {
    const dataPath = await app.evaluate(({ app }) => app.getPath('userData'))
    if (path.resolve(dataPath) !== path.resolve(userData)) throw new Error(`The app is using ${dataPath}, not the temporary folder`)

    // The operator and output windows open together; the operator's is the one without a #/ route.
    let page: Page | undefined
    for (const deadline = Date.now() + 60_000; !page && Date.now() < deadline; await new Promise((r) => setTimeout(r, 250))) {
      page = app.windows().find((w) => w.url().startsWith('http') && !w.url().includes('#/'))
    }
    if (!page) throw new Error('The operator window did not open')
    // A step that cannot happen fails after 30 seconds instead of waiting forever.
    page.setDefaultTimeout(30_000)
    await page.waitForSelector('.toolbar', { timeout: 60_000 })
    // The output opens full screen on a second display by default; keep it a window, and the look predictable.
    await page.evaluate(() => window.api.settings.set({ outputDisplay: 'window', appearance: 'dark' }))
    await page.reload()
    await installHooks(page)

    console.log('First run, no data:')
    // The welcome shows once, until a choice is made; it is shot at each size, then dismissed.
    await page.waitForSelector('.welcome', { timeout: 10_000 }).catch(() => console.warn('  The first run welcome did not show'))
    for (const size of SIZES) {
      await setSize(app, page, size)
      if (await page.locator('.welcome').count()) {
        if (!COMPARE_ONLY) await shot(page, `00-welcome@${size.width}`)
        await compareShot(page, 'welcome', size)
      }
    }
    if (await page.locator('.welcome').count()) await page.getByRole('button', { name: 'Continue without an account' }).click()
    for (const size of SIZES) {
      if (COMPARE_ONLY) break
      await setSize(app, page, size)
      await shot(page, `01-first-run@${size.width}`)
      await libraryTab(page, 'Media')
      await shot(page, `01-first-run-media@${size.width}`)
      await libraryTab(page, 'Songs')
    }

    // Sample data, through the app's own IPC.
    await app.evaluate(({ dialog }, files) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: files })) as typeof dialog.showOpenDialog
    }, mediaFiles)
    const seeded = await page.evaluate(
      async ({ songs, date }) => {
        const songIds: number[] = []
        for (const song of songs) songIds.push((await window.api.songs.create({ ...song, themeId: null, arrangement: { order: [], linesPerSlide: null } })).id)
        await window.api.media.import()
        const books = await window.api.bible.listBooks()
        const psalms = books.find((b) => /^psalm/i.test(b)) ?? books[18]
        const verses = await window.api.bible.getRange('KJV', psalms, 23, 1, 3)
        const service = await window.api.services.create('Sunday Gathering', date)
        await window.api.services.addItem(service.id, 'announcement', null, { title: 'Welcome', body: 'Welcome to the Sunday Gathering\n\nCoffee and lunch in the hall after the service', titleSlide: true })
        await window.api.services.addItem(service.id, 'song', songIds[0], null)
        await window.api.services.addItem(service.id, 'song', songIds[1], null)
        await window.api.services.addItem(service.id, 'scripture', null, {
          title: `${psalms} 23:1-3 KJV`,
          verses: verses.map((v) => ({ text: v.text, caption: `${v.book} ${v.chapter}:${v.verse} KJV` })),
        })
        await window.api.services.addItem(service.id, 'song', songIds[2], null)
        await window.api.services.addItem(service.id, 'announcement', null, { title: 'Youth night', body: 'Youth night is Friday at 7pm\n\nBring a friend', titleSlide: true })
        const midweek = await window.api.services.create('Midweek Prayer', date)
        return { songIds, serviceId: service.id, emptyServiceId: midweek.id }
      },
      { songs: SONGS, date: today },
    )

    for (const size of SIZES) {
      const at = `@${size.width}`
      console.log(`At ${size.width} by ${size.height}:`)
      await page.reload()
      await installHooks(page)
      await setSize(app, page, size)

      if (COMPARE_ONLY) {
        await compareScreens(page, seeded.serviceId, size)
        continue
      }

      await libraryTab(page, 'Songs')
      await shot(page, `02-main-empty${at}`)

      await page.locator('.song-list').getByText(SONGS[0].title, { exact: true }).first().click()
      await shot(page, `03-song-list-selected${at}`)

      await page.getByRole('button', { name: 'Add song', exact: true }).click()
      await shot(page, `04-add-song-modal${at}`)
      await resetScreens(page)

      await page.evaluate((id) => (window as unknown as AuditWindow).__audit.store.getState().editSong(id), seeded.songIds[0])
      await shot(page, `05-song-editor${at}`)
      await resetScreens(page)

      await libraryTab(page, 'Scripture')
      await page.getByLabel('Search scripture').fill('john 3:16')
      await shot(page, `06-scripture-reference${at}`)
      await page.getByLabel('Search scripture').fill('shepherd')
      await page.waitForTimeout(800)
      await shot(page, `07-scripture-word-search${at}`)
      await page.getByLabel('Search scripture').fill('Hezekiah 4:2')
      await shot(page, `08-error-scripture-not-found${at}`)
      await page.getByLabel('Search scripture').fill('xylophone zebra')
      await page.waitForTimeout(800)
      await shot(page, `08-scripture-no-results${at}`)
      await page.getByLabel('Search scripture').fill('')

      await libraryTab(page, 'Media')
      await shot(page, `09-media-library${at}`)
      await libraryTab(page, 'Slides')
      await shot(page, `10-presentations-empty${at}`)
      await libraryTab(page, 'Songs')

      await page.evaluate((id) => (window as unknown as AuditWindow).__audit.store.getState().openService(id), seeded.serviceId)
      await page.evaluate(async () => {
        const s = (window as unknown as AuditWindow).__audit.store.getState() as unknown as { service: { items: unknown[] }; loadItem(item: unknown): Promise<boolean> }
        await s.loadItem(s.service.items[1])
      })
      await shot(page, `11-main-service-loaded${at}`)

      await page.evaluate(() => (window as unknown as AuditWindow).__audit.store.getState().goLive(1))
      await shot(page, `12-main-live${at}`)

      // The right column: the Queue under Preview with Recently shown, and Clear lower third on Live's header while
      // one is on air. Then the Lower thirds workspace with its style popover, and the transcript docked in the middle
      // column (it must not cover Live or Preview).
      // A design that stretches: a bar fitted to the name, a logo tab pinned to the bar's end. A short name is staged on
      // Preview and a long one is live; the bar must hug each.
      await page.evaluate(async () => {
        const st = (window as unknown as AuditWindow).__audit.store.getState() as unknown as {
          loadDesigns(): Promise<void>
          previewLowerThirdLine(line: unknown): void
          showLowerThirdLine(line: unknown): void
        }
        const api = (window as unknown as { api: { designs: { create(name: string, style: unknown): Promise<{ id: number }> } } }).api
        const pad = { top: 0, right: 2, bottom: 0, left: 2 }
        const design = await api.designs.create(`Audit stretch ${Date.now()}`, {
          category: 'lowerThird',
          background: { kind: 'transparent' },
          elements: [
            { kind: 'rect', id: 'bar', name: 'Bar', box: { x: 5, y: 76, width: 24, height: 9 }, fill: { kind: 'solid', color: '#0b1f44' }, radius: 0.8, fitToText: { textId: 'name', padding: pad, minWidth: 10, maxWidth: 0, anchor: 'right', axes: 'both' } },
            { kind: 'rect', id: 'tab', name: 'Tab', box: { x: 29, y: 76, width: 5.06, height: 9 }, fill: { kind: 'solid', color: '#0087cb' }, constraints: { horizontal: 'right', vertical: 'top' } },
            { kind: 'text', id: 'name', name: 'Name', box: { x: 7, y: 76, width: 20, height: 9 }, text: 'Pastor Sam', field: 'headline', fontSize: 4.5, fontWeight: 700, sizing: 'autoWidth', maxWidth: 70, autoFit: true },
          ],
        })
        await st.loadDesigns()
        st.previewLowerThirdLine({ headline: 'Sam', body: '', designId: design.id })
        st.showLowerThirdLine({ headline: 'Pastor Samuel Alexander Example-Longname', body: '', designId: design.id })
      })
      await page.waitForTimeout(900)
      await shot(page, `12-queue-recently-shown${at}`)
      await page.locator('.live-card').getByRole('button', { name: 'Clear lower third' }).click()
      await page.evaluate(() => (window as unknown as AuditWindow).__audit.store.getState().openLowerThirds(true))
      await shot(page, `12-lower-thirds-workspace${at}`)
      await page.locator('.ltw-head').getByRole('button', { name: /Style and saved lines/ }).click()
      await shot(page, `12-lower-third-style${at}`)
      await page.keyboard.press('Escape')
      // Import design: a Figma style SVG opens in the designer with the offer to make its bar stretch; then typing on
      // the selected name changes it in place and the bar follows.
      await page.locator('.ltw-library input[type=file]').setInputFiles({ name: 'Name bar.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(AUDIT_SVG) })
      await page.locator('.designer-import-note').waitFor()
      await shot(page, `12-designer-imported${at}`)
      await page.getByRole('button', { name: 'Make them stretch' }).click()
      await page.locator('.designer-layer', { hasText: 'Name' }).first().click()
      await page.locator('.designer').press('P')
      await page.keyboard.type('astor Samuel Alexander Example')
      await shot(page, `12-designer-typing-stretch${at}`)
      await page.keyboard.press('Enter')
      await shot(page, `12-designer-stretch-inspector${at}`)
      page.once('dialog', (dialog) => void dialog.accept())
      await page.locator('.designer').getByRole('button', { name: 'Close' }).click()
      // Typing on the workspace's canvas: click the name, type, Enter; the words stay on that design's canvas.
      await page.locator('.ltw-frame').first().click()
      await page.keyboard.type('Guest Speaker')
      await shot(page, `12-workspace-typing${at}`)
      await page.keyboard.press('Enter')
      const typed = await page.evaluate(() => {
        const st = (window as unknown as AuditWindow).__audit.store.getState()
        return Object.values(st.settings.lowerThirdCanvasText[String(st.lowerThirdWorkspaceDesignId)] ?? {})
      })
      if (!typed.includes('Guest Speaker')) throw new Error(`Typing on the lower third canvas gave ${JSON.stringify(typed)}`)
      await page.evaluate(() => (window as unknown as AuditWindow).__audit.store.getState().updateSettings({ lowerThirdCanvasText: {} }))
      await page.evaluate(() => (window as unknown as AuditWindow).__audit.store.getState().openLowerThirds(false))
      if (await page.locator('.statusbar').getByRole('button', { name: 'Transcript' }).count()) {
        await page.locator('.statusbar').getByRole('button', { name: 'Transcript' }).click()
        await shot(page, `12-transcript-docked${at}`)
        await page.getByRole('button', { name: 'Close the transcript' }).click()
      }

      await page.evaluate(() => (window as unknown as AuditWindow).__audit.store.getState().setOutputMode('black'))
      await shot(page, `13-main-live-black${at}`)
      await page.evaluate(() => (window as unknown as AuditWindow).__audit.store.getState().setOutputMode('show'))

      // A service with nothing in it yet, then the seeded one again with its slide still live.
      await page.evaluate((id) => (window as unknown as AuditWindow).__audit.store.getState().openService(id), seeded.emptyServiceId)
      await shot(page, `13-schedule-empty${at}`)
      await page.evaluate((id) => (window as unknown as AuditWindow).__audit.store.getState().openService(id), seeded.serviceId)

      // The Schedule folded to its rail, and back.
      await page.getByRole('button', { name: 'Hide the schedule' }).click()
      await shot(page, `14-schedule-rail${at}`)
      await page.getByRole('button', { name: 'Show the schedule' }).click()

      // The service picker opens from the top bar's service button.
      await page.locator('.toolbar-service').click()
      await shot(page, `14-schedule-service-picker${at}`)
      await page.locator('.schedule-picker').getByRole('button', { name: 'New service' }).click()
      await shot(page, `14-schedule-new-service-modal${at}`)
      await resetScreens(page)

      await page.evaluate(() => (window as unknown as AuditWindow).__audit.store.getState().openThemeEditor(true))
      await shot(page, `15-theme-editor${at}`)
      await resetScreens(page)

      await page.evaluate(() => (window as unknown as AuditWindow).__audit.store.getState().openSettings(true))
      await shot(page, `16-settings-top${at}`)
      await resetScreens(page)

      await page.evaluate(() => (window as unknown as AuditWindow).__audit.account.openPlans(true))
      await shot(page, `17-plans-and-credits${at}`)
      await resetScreens(page)

      await page.evaluate(() => (window as unknown as AuditWindow).__audit.store.getState().openSermons(true))
      await shot(page, `18-sermons${at}`)
      await resetScreens(page)

      await page.evaluate(() => (window as unknown as AuditWindow).__audit.store.getState().openStreamPanel(true))
      await shot(page, `19-stream${at}`)
      await resetScreens(page)

      // There is no Help screen; the command palette is the nearest thing to one.
      await page.evaluate(() => (window as unknown as AuditWindow).__audit.store.getState().setPaletteOpen(true))
      await shot(page, `20-help-command-palette${at}`)
      await page.keyboard.type('the')
      await shot(page, `21-command-palette-results${at}`)
      await resetScreens(page)

      // The toolbar's More menu: layouts and the screens used less often.
      await page.getByRole('button', { name: 'More', exact: true }).click()
      await shot(page, `21-more-menu${at}`)
      await page.keyboard.press('Escape')

      // Device chips, transfers and the Inbox, with invented computers. Sharing itself stays off, so nothing is
      // advertised on the network.
      await page.evaluate(() => {
        const { store, sharing } = (window as unknown as AuditWindow).__audit
        store.setState({ settings: { ...(store.getState().settings as object), sharingEnabled: true, sharingDeviceChips: true } })
        const now = new Date().toISOString()
        sharing.setState({
          status: { enabled: true, deviceId: 'audit-self', deviceName: 'Sanctuary Booth', port: 47800, addresses: ['192.0.2.10'], error: null, publicNetworks: [], firewallCommand: null },
          peers: [
            { id: 'p1', name: 'Stage Laptop', online: true, paired: true, trusted: true, disconnected: false, liveTitle: 'Morning Light Rising', hosting: null },
            { id: 'p2', name: 'Youth Room', online: true, paired: true, trusted: false, disconnected: false, liveTitle: null, hosting: { id: 's1', name: 'Youth Night' } },
            { id: 'p3', name: 'Office iMac', online: false, paired: true, trusted: false, disconnected: false, liveTitle: null, hosting: null },
            { id: 'p4', name: 'Guest Laptop', online: true, paired: false, trusted: false, disconnected: false, liveTitle: null, hosting: null },
          ],
          inbox: [
            { id: 'i1', senderId: 'p1', senderName: 'Stage Laptop', name: 'Harbor of Grace.xml', size: 4200, kind: 'openlyrics', receivedAt: now },
            { id: 'i2', senderId: 'p2', senderName: 'Youth Room', name: 'Youth Night.serviceex', size: 2_400_000, kind: 'package', receivedAt: now },
            { id: 'i3', senderId: 'p1', senderName: 'Stage Laptop', name: 'Announcement loop.mp4', size: 48_000_000, kind: 'video', receivedAt: now },
          ],
          transfers: [{ id: 't1', peerId: 'p1', peerName: 'Stage Laptop', name: 'Sermon slides.pptx', sent: 3_100_000, size: 7_800_000, state: 'sending' }],
          incoming: [{ id: 'p2-t9', senderId: 'p2', senderName: 'Youth Room', name: 'Worship loop.mov', size: 90_000_000, received: 22_000_000, state: 'receiving' }],
          unseen: 2,
        })
      })
      await shot(page, `22-device-chips${at}`)
      // Device chips and transfers are in the toolbar's status popover.
      if (await page.locator('.status-button').count()) {
        await page.locator('.status-button').click()
        await shot(page, `22-status-popover${at}`)
        await page.keyboard.press('Escape')
      }
      await page.locator('[aria-label^="Inbox,"]').click()
      await shot(page, `23-inbox-open${at}`)
      await page.evaluate(() => (window as unknown as AuditWindow).__audit.sharing.setState({ inbox: [], inboxOpen: true, unseen: 0 }))
      await shot(page, `23-inbox-empty${at}`)
      await resetScreens(page)

      // Toasts, one of each tone: none of them in the live red.
      const toasts = [
        { tone: 'success', text: 'Sent to Stage Laptop.', details: null },
        { tone: 'warning', text: 'Stage Laptop declined Sermon slides.pptx.', details: null },
        { tone: 'error', text: 'Another program is already using that network port. Close it, or choose another port in Settings, Sharing.', details: 'listen EADDRINUSE: address already in use 0.0.0.0:47800' },
      ]
      for (const toast of toasts) {
        await page.evaluate((message) => (window as unknown as AuditWindow).__audit.sharing.setState({ message }), toast)
        await shot(page, `32-toast-${toast.tone}${at}`)
      }
      await page.evaluate(() => (window as unknown as AuditWindow).__audit.sharing.setState({ message: null }))

      // Account: as this build shows it (no server address), signed out, then signed in, all invented.
      await page.evaluate(() => (window as unknown as AuditWindow).__audit.store.getState().openSettings(true))
      await shot(page, `24-account-unconfigured${at}`)
      const signedOut = {
        configured: true,
        encryptionAvailable: true,
        signedIn: false,
        email: null,
        license: { state: 'none', plan: 'Free', productId: null, licenseId: null, seats: null, seatsUsed: null, updatesUntil: null, updatesExpired: false, issuedAt: null, offlineValidUntil: null, features: [], message: null },
        balance: null,
        allowance: null,
        checkout: null,
        notice: null,
      }
      await page.evaluate((state) => (window as unknown as AuditWindow).__audit.account.setAccountState(state), signedOut)
      await shot(page, `25-account-signed-out${at}`)
      await page.evaluate((base) => {
        const { account, features } = (window as unknown as AuditWindow).__audit
        account.setAccountState({
          ...base,
          signedIn: true,
          email: 'operator@example.org',
          license: { ...base.license, state: 'active', plan: 'Pro', productId: 'pro_license', licenseId: 'LIC-SAMPLE-0001', seats: 3, seatsUsed: 1, updatesUntil: '2027-10-29', issuedAt: '2026-10-01T00:00:00Z', offlineValidUntil: '2026-11-12T00:00:00Z', features: features.FEATURE_KEYS },
          balance: { totalSeconds: 9 * 3600, nearestExpiry: { expiresAt: '2027-01-31T00:00:00Z', seconds: 4 * 3600 }, updatedAt: new Date().toISOString() },
          allowance: { trial: { tokens: 200_000, remainingTokens: 150_000 }, monthly: { tokens: 1_000_000, remainingTokens: 620_000 }, remainingTokens: 770_000, resetsAt: '2026-12-01T00:00:00Z' },
        })
      }, signedOut)
      await shot(page, `26-account-signed-in${at}`)
      await page.evaluate(() => (window as unknown as AuditWindow).__audit.account.openPlans(true))
      await shot(page, `27-plans-signed-in${at}`)
      await resetScreens(page)

      // Offline: the renderer is told the network went away; nothing about the server changes.
      const setOnline = (online: boolean) =>
        page.evaluate((value) => {
          Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value })
          window.dispatchEvent(new Event(value ? 'online' : 'offline'))
        }, online)
      await setOnline(false)
      await page.evaluate(() => (window as unknown as AuditWindow).__audit.store.getState().openSettings(true))
      await shot(page, `26-account-offline${at}`)
      await resetScreens(page)
      await page.evaluate(() => (window as unknown as AuditWindow).__audit.account.openPlans(true))
      await shot(page, `27-plans-offline${at}`)
      await resetScreens(page)
      await setOnline(true)

      if (size.width === 1280) {
        // A server that never answers: the skeleton first, then after 20 seconds the timeout with Retry. Uses
        // Electron's handler map (not public API); skipped when it is not there.
        const stalled = await app.evaluate(({ ipcMain }) => {
          const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, unknown> })._invokeHandlers
          if (!handlers?.has('account:products')) return false
          ;(globalThis as Record<string, unknown>).__auditProducts = handlers.get('account:products')
          handlers.set('account:products', () => new Promise(() => undefined))
          return true
        })
        if (stalled) {
          await page.evaluate(() => (window as unknown as AuditWindow).__audit.account.openPlans(true))
          await shot(page, `27-plans-loading${at}`)
          await page.waitForTimeout(20_500)
          await shot(page, `27-plans-timeout${at}`)
          await resetScreens(page)
          await app.evaluate(({ ipcMain }) => {
            const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, unknown> })._invokeHandlers
            handlers.set('account:products', (globalThis as Record<string, unknown>).__auditProducts)
          })
        } else console.warn('  The Plans timeout could not be staged; skipped')
      }

      // Light appearance, for comparison.
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
      await shot(page, `28-main-live-light${at}`)
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))

      // Errors: a song deleted while open, and a panel that fails to draw (the schedule given a broken service).
      await page.evaluate(() => (window as unknown as AuditWindow).__audit.store.getState().editSong(999_999))
      await shot(page, `29-error-song-missing${at}`)
      await resetScreens(page)
      await page.evaluate(() => {
        const { store } = (window as unknown as AuditWindow).__audit
        store.setState({ service: { ...(store.getState().service as object), items: null } })
      })
      await shot(page, `30-error-panel-crashed${at}`)

      await page.reload()
      await installHooks(page)
      await compareScreens(page, seeded.serviceId, size)

      if (size.width === 1280) {
        // Every Settings page, at the smaller size: each nav item opens one section.
        await page.reload()
        await installHooks(page)
        await page.evaluate(() => (window as unknown as AuditWindow).__audit.store.getState().openSettings(true))
        await settle(page)
        metrics[`31-settings-full${at}`] = await page.evaluate(collectMetrics)
        // A page taller than the viewport cannot be captured in Electron, so the window is made tall for these.
        await page.setViewportSize({ width: size.width, height: 2600 })
        const items = page.locator('.settings-nav-item')
        const total = await items.count()
        for (let i = 0; i < total; i++) {
          const title = ((await items.nth(i).textContent()) ?? `page-${i}`).trim()
          await items.nth(i).click()
          await settle(page, 300)
          const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
          const file = `31-settings-${String(i + 1).padStart(2, '0')}-${slug}.png`
          await page.locator('.settings-column').screenshot({ path: path.join(OUT, file) })
          shots.push(file)
          console.log(`  ${file}`)
        }
        await page.setViewportSize(size)
      }
    }

    // The output and stage windows, with a slide live.
    console.log('Output windows:')
    await page.reload()
    await installHooks(page)
    await page.evaluate(async (id) => {
      const s = (window as unknown as AuditWindow).__audit.store.getState() as unknown as {
        openService(id: number): Promise<void>
        service: { items: unknown[] }
        loadItem(item: unknown): Promise<boolean>
      }
      await s.openService(id)
      const st = (window as unknown as AuditWindow).__audit.store.getState() as unknown as typeof s
      await st.loadItem(st.service.items[3])
      ;(window as unknown as AuditWindow).__audit.store.getState().goLive(0)
    }, seeded.serviceId)
    await settle(page, 1200)
    const output = app.windows().find((w) => w.url().includes('#/output'))
    if (output) {
      await output.screenshot({ path: path.join(OUT, '40-output-scripture.png') })
      shots.push('40-output-scripture.png')
      await page.evaluate(async () => {
        const s = (window as unknown as AuditWindow).__audit.store.getState() as unknown as { service: { items: unknown[] }; loadItem(item: unknown): Promise<boolean>; goLive(i: number): void }
        await s.loadItem(s.service.items[1])
        ;(window as unknown as AuditWindow).__audit.store.getState().goLive(1)
      })
      await settle(page, 1200)
      await output.screenshot({ path: path.join(OUT, '41-output-song.png') })
      shots.push('41-output-song.png')
    } else console.warn('  The output window was not found')
    await page.evaluate(() => window.api.stage.open())
    await settle(page, 1500)
    const stage = app.windows().find((w) => w.url().includes('#/stage'))
    if (stage) {
      await stage.screenshot({ path: path.join(OUT, '42-stage-display.png') })
      shots.push('42-stage-display.png')
    }

    writeCompareIndex()
    writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify({ shots, screens: metrics, totals: totals(metrics) }, null, 2))
    writeFileSync(path.join(OUT, 'static.json'), JSON.stringify(staticScan(), null, 2))
    writeFileSync(path.join(OUT, 'layout.json'), JSON.stringify(layout, null, 2))
    writeFileSync(path.join(OUT, 'states.json'), JSON.stringify(states, null, 2))
    console.log(`Saved ${shots.length} screenshots and the measurements to ${path.relative(ROOT, OUT)}/`)

    const failing = Object.entries(layout).filter(([, problems]) => problems.length > 0)
    if (failing.length > 0) {
      console.error(`\nLayout check failed on ${failing.length} of ${Object.keys(layout).length} screens:`)
      for (const [name, problems] of failing) {
        console.error(`  ${name}`)
        for (const p of problems) console.error(`    ${p.kind}: ${p.what}: ${p.detail}`)
      }
      process.exitCode = 1
    } else console.log(`Layout check passed on all ${Object.keys(layout).length} screens at ${SIZES.map((s) => `${s.width}x${s.height}`).join(', ')}.`)

    const unfinished = Object.entries(states).filter(([, st]) => st.developerText.length > 0 || st.toastsInLiveRed.length > 0)
    const lingering = Object.entries(states).filter(([, st]) => st.loadingText.length > 0 || st.bareEmptyLines.length > 0)
    for (const [name, st] of lingering) console.warn(`  Note, ${name}: ${[...st.loadingText, ...st.bareEmptyLines.map((t) => `bare empty line "${t}"`)].join('; ')}`)
    if (unfinished.length > 0) {
      console.error(`\nState check failed on ${unfinished.length} of ${Object.keys(states).length} screens:`)
      for (const [name, st] of unfinished) {
        console.error(`  ${name}`)
        for (const t of st.developerText) console.error(`    developer text: ${t.slice(0, 120)}`)
        for (const t of st.toastsInLiveRed) console.error(`    toast in live red: ${t.slice(0, 120)}`)
      }
      process.exitCode = 1
    } else console.log(`State check passed on all ${Object.keys(states).length} screens: no developer text, no toast in live red.`)
  } finally {
    await app.close().catch(() => undefined)
    await server.close()
    rmSync(userData, { recursive: true, force: true })
  }
}

/** Every screen's counts added up, with near duplicate colors grouped. */
function totals(screens: Record<string, Metrics>) {
  const keys = ['fontFamilies', 'fontSizes', 'fontWeights', 'textColors', 'backgroundColors', 'borderColors', 'radii', 'spacing', 'shadows', 'iconSizes', 'iconStrokes', 'buttonStyles', 'inputStyles', 'inlineStyleProps'] as const
  const sum = Object.fromEntries(keys.map((k) => [k, {} as Counts])) as Record<(typeof keys)[number], Counts>
  for (const m of Object.values(screens)) for (const k of keys) for (const [v, n] of Object.entries(m[k])) sum[k][v] = (sum[k][v] ?? 0) + n
  const sorted = Object.fromEntries(keys.map((k) => [k, Object.fromEntries(Object.entries(sum[k]).sort((a, b) => b[1] - a[1]))]))
  const unique = <T,>(list: T[], key: (t: T) => string) => [...new Map(list.map((t) => [key(t), t])).values()]
  const all = Object.values(screens)
  const smallTargets = unique(all.flatMap((m) => m.smallTargets), (t) => `${t.className}|${t.label}`)
  const lowContrast = unique(all.flatMap((m) => m.lowContrast), (t) => `${t.className}|${t.color}|${t.background}`)
  const heightsOf = (styles: Counts, match: (key: string) => boolean) =>
    [...new Set(Object.keys(styles).filter(match).map((k) => Number(/\| h(\d+) \|/.exec(k)?.[1])))].sort((a, b) => a - b)
  const headline = {
    renderedColors: new Set([...Object.keys(sum.textColors), ...Object.keys(sum.backgroundColors), ...Object.keys(sum.borderColors)]).size,
    textColors: Object.keys(sum.textColors).length,
    backgroundColors: Object.keys(sum.backgroundColors).length,
    borderColors: Object.keys(sum.borderColors).length,
    buttonStyleCombos: Object.keys(sum.buttonStyles).length,
    /** Heights of the controls that are buttons by design (not cards, slides or list rows that happen to be buttons). */
    controlButtonHeights: heightsOf(sum.buttonStyles, (k) => /^(ui-(icon-)?button|button\.(button|icon-button|primary))\b/.test(k)),
    legacyButtonHeights: heightsOf(sum.buttonStyles, (k) => /^button\.(button|icon-button)\b/.test(k)),
    inputHeights: heightsOf(sum.inputStyles, (k) => !/^textarea/.test(k)),
    smallTargets: smallTargets.length,
    lowContrast: lowContrast.length,
    lowContrastEnabled: lowContrast.filter((t) => !t.disabled).length,
  }
  return {
    headline,
    ...sorted,
    distinct: Object.fromEntries(keys.map((k) => [k, Object.keys(sum[k]).length])),
    nearDuplicateColors: nearDuplicates([...new Set([...Object.keys(sum.textColors), ...Object.keys(sum.backgroundColors), ...Object.keys(sum.borderColors)])]),
    smallTargets,
    lowContrast,
    clippedText: unique(all.flatMap((m) => m.clippedText), (t) => `${t.className}|${t.text}`),
    offscreen: Object.fromEntries(Object.entries(screens).filter(([, m]) => m.offscreen.length > 0).map(([name, m]) => [name, m.offscreen])),
    pageScrolls: Object.fromEntries(Object.entries(screens).filter(([, m]) => m.pageScrolls.horizontal || m.pageScrolls.vertical).map(([name, m]) => [name, m.pageScrolls])),
    inlineStyled: Object.fromEntries(Object.entries(screens).map(([name, m]) => [name, m.inlineStyled])),
  }
}

/** Opaque colors within a small CIE76 distance of each other, which are probably meant to be one color. */
function nearDuplicates(colors: string[]) {
  const lab = (h: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92))
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
    const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047)
    const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722)
    const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883)
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
  }
  const solid = colors.filter((c) => /^#[0-9a-f]{6}$/.test(c))
  const groups: string[][] = []
  const used = new Set<string>()
  for (const a of solid) {
    if (used.has(a)) continue
    const group = solid.filter((b) => !used.has(b) && Math.hypot(...lab(a).map((v, i) => v - lab(b)[i])) < 6)
    if (group.length > 1) {
      group.forEach((c) => used.add(c))
      groups.push(group)
    }
  }
  return groups
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

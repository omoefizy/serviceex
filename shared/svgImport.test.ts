import { describe, expect, it } from 'vitest'
import { normalizeDesign } from './designs'
import { suggestLinks } from './designLinks'
import { importSvg, parseColor, parseTransform, pathPoints } from './svgImport'

/** A lower third as Figma exports a 1920 by 1080 frame, with text kept as text. */
const FIGMA = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1920" height="1080" viewBox="0 0 1920 1080" fill="none" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<g clip-path="url(#clip0)">
<rect width="1920" height="1080" fill="white"/>
<g id="Name_bar" filter="url(#filter0_d)">
<rect x="96" y="778" width="768" height="108" rx="12" fill="url(#paint0_linear)"/>
</g>
<rect id="Accent" x="96" y="778" width="12" height="108" fill="#00AFEF" fill-opacity="0.5"/>
<text id="Name" fill="white" xml:space="preserve" style="white-space: pre" font-family="Montserrat" font-size="54" font-weight="bold" letter-spacing="-0.02em"><tspan x="134" y="851.4">Pastor Sam Example</tspan></text>
<text id="Title" fill="#CFE9F7" font-family="Comic Unknown" font-size="27" text-anchor="end"><tspan x="840" y="920">Lead Pastor</tspan></text>
<path id="Swoosh" d="M1700 900 C 1750 850, 1800 950, 1850 900 L 1850 960 Z" fill="#0087CB"/>
<polygon points="1600,900 1650,960 1550,960" fill="#0087CB"/>
<rect id="Logo" x="900" y="778" width="108" height="108" fill="url(#pattern0)"/>
</g>
<defs>
<filter id="filter0_d" x="92" y="778" width="776" height="116" filterUnits="userSpaceOnUse">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
<feOffset dy="4"/>
<feGaussianBlur stdDeviation="2"/>
<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"/>
</filter>
<pattern id="pattern0" patternContentUnits="objectBoundingBox" width="1" height="1"><use xlink:href="#image0" transform="scale(0.01)"/></pattern>
<linearGradient id="paint0_linear" x1="96" y1="832" x2="864" y2="832" gradientUnits="userSpaceOnUse">
<stop stop-color="#0087CB"/>
<stop offset="1" stop-color="#0B1F44"/>
</linearGradient>
<clipPath id="clip0"><rect width="1920" height="1080" fill="white"/></clipPath>
<image id="image0" width="100" height="100" xlink:href="data:image/png;base64,iVBORw0KGgo="/>
</defs>
</svg>`

describe('importing an SVG', () => {
  const result = importSvg(FIGMA)
  const byName = (name: string) => result.elements.find((e) => e.name === name)!

  it('keeps the layer names and the order of the layers', () => {
    expect(result.elements.map((e) => `${e.kind}:${e.name}`)).toEqual([
      'rect:Frame background',
      'rect:Name bar',
      'rect:Accent',
      'text:Name',
      'text:Title',
      'image:Swoosh',
      'image:Logo',
    ])
  })

  it('hides a full screen frame background so the lower third stays over the picture', () => {
    expect(byName('Frame background').hidden).toBe(true)
  })

  it('turns rounded rectangles into rectangles with their gradient, corners and shadow', () => {
    const bar = byName('Name bar')
    expect(bar.kind).toBe('rect')
    if (bar.kind !== 'rect') return
    expect(bar.box).toEqual({ x: 5, y: 72.03703703703704, width: 40, height: 10 })
    expect(bar.fill).toEqual({ kind: 'gradient', from: '#0087cb', to: '#0b1f44', angle: 90 })
    expect(bar.radius).toBeCloseTo(1.111, 2)
    expect(bar.shadow).toMatchObject({ enabled: true, color: '#000000', opacity: 0.25 })
    expect(bar.shadow.y).toBeCloseTo(0.37, 2)
  })

  it('keeps fill opacity as the element’s opacity', () => {
    const accent = byName('Accent')
    expect(accent.opacity).toBe(0.5)
    expect(accent.kind === 'rect' && accent.fill).toEqual({ kind: 'solid', color: '#00afef' })
  })

  it('imports text as real text with its font, size, weight, colour and alignment', () => {
    const name = byName('Name')
    expect(name).toMatchObject({ kind: 'text', text: 'Pastor Sam Example', fontFamily: 'Montserrat', fontWeight: 700, color: '#ffffff', align: 'left', letterSpacing: -0.02, sizing: 'autoWidth' })
    expect(name.kind === 'text' && name.fontSize).toBeCloseTo(5, 5)
    expect(name.box.x).toBeCloseTo(6.98, 2)
    const title = byName('Title')
    expect(title).toMatchObject({ align: 'right', color: '#cfe9f7', fontWeight: 400 })
    // Its right edge is where the text ended in the file.
    expect(title.box.x + title.box.width).toBeCloseTo(43.75, 2)
    expect(result.fonts).toEqual(['Montserrat', 'Comic Unknown'])
  })

  it('binds the largest text to the headline and the next to the body', () => {
    expect(byName('Name')).toMatchObject({ field: 'headline' })
    expect(byName('Title')).toMatchObject({ field: 'body' })
  })

  it('gathers a run of paths into one picture, cropped to them, and fills from a pattern as pictures', () => {
    const swoosh = byName('Swoosh')
    expect(swoosh.kind === 'image' && swoosh.src).toBe('asset:0')
    expect(swoosh.box.x).toBeCloseTo((1550 / 1920) * 100, 3)
    expect(swoosh.box.width).toBeCloseTo((300 / 1920) * 100, 3)
    expect(result.assets[0].extension).toBe('svg')
    expect(result.assets[0].data).toContain('viewBox="1550 850 300 110"')
    expect(result.assets[0].data).toContain('<polygon')
    expect(result.assets[1]).toEqual({ extension: 'png', data: 'iVBORw0KGgo=' })
    expect(byName('Logo')).toMatchObject({ kind: 'image', src: 'asset:1' })
  })

  it('offers to link the bar to the name on it', () => {
    expect(suggestLinks(result.elements)).toContainEqual({ shapeId: byName('Name bar').id, textId: byName('Name').id })
  })

  it('makes elements that survive the design checks once the pictures are stored', () => {
    const stored = result.elements.map((e) => (e.kind === 'image' ? { ...e, src: 'wd-media://local/a.png' } : e))
    expect(normalizeDesign({ category: 'lowerThird', elements: stored }).elements).toHaveLength(result.elements.length)
  })

  it('places a frame that is not 16:9 at 1080p size above the bottom of the screen', () => {
    const small = importSvg('<svg viewBox="0 0 800 200" xmlns="http://www.w3.org/2000/svg"><rect id="Bar" width="800" height="200" fill="#123456"/></svg>')
    expect(small.elements[0]).toMatchObject({ name: 'Bar', hidden: false })
    expect(small.elements[0].box.x).toBe(5)
    expect(small.elements[0].box.y + small.elements[0].box.height).toBeCloseTo(90, 5)
    expect(small.elements[0].box.width).toBeCloseTo((800 / 1920) * 100, 5)
  })

  it('refuses what is not an SVG', () => {
    expect(() => importSvg('<html></html>')).toThrow(/not an SVG/)
  })
})

describe('SVG pieces', () => {
  it('reads colours', () => {
    expect(parseColor('#FFF')).toEqual({ hex: '#ffffff', alpha: 1 })
    expect(parseColor('rgba(0, 135, 203, 0.5)')).toEqual({ hex: '#0087cb', alpha: 0.5 })
    expect(parseColor('none')).toBeNull()
  })

  it('reads transforms', () => {
    expect(parseTransform('translate(10 20) scale(2)')).toEqual([2, 0, 0, 2, 10, 20])
    const turned = parseTransform('rotate(90)')
    expect(turned.map((n) => Math.round(n))).toEqual([0, 1, -1, 0, 0, 0])
  })

  it('finds the extent of a path with relative commands', () => {
    const points = pathPoints('m10 10 h20 v5 l-5 5z')
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([10, 30, 10, 20])
  })
})

// The Lower thirds workspace's canvas is the only place a lower third's words are typed: what is on it is what Preview
// and Show live send, exactly, after switching designs and back, closing and reopening the workspace, and a restart
// (the words are kept in Settings). A sermon point fills the canvas only when picked.
import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_DESIGN, rectElement, textElement } from '../shared/designs'
import type { AppSettings, Design, OutputState } from '../shared/types'

let outputListener: ((state: OutputState) => void) | undefined
/** Settings as the main process keeps them, so a restart can read them back. */
let saved: Partial<AppSettings> = {}

vi.stubGlobal('window', {
  screen: { width: 1920, height: 1080 },
  innerWidth: 1920,
  innerHeight: 1080,
  addEventListener() {},
  removeEventListener() {},
  setTimeout,
  clearTimeout,
  api: {
    media: { getSlideBackgrounds: async () => ({}) },
    services: { list: async () => [] },
    settings: { set: async (patch: Partial<AppSettings>) => ((saved = { ...saved, ...patch }), saved) },
    output: { onState: (fn: (state: OutputState) => void) => ((outputListener = fn), () => (outputListener = undefined)) },
  },
})
vi.stubGlobal('document', {
  documentElement: { style: {} },
  body: { style: {} },
  createElement: () => ({ getContext: () => null }),
  addEventListener() {},
  removeEventListener() {},
})
vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 0))
vi.stubGlobal('devicePixelRatio', 1)

const { selectOutputState, useOperatorStore } = await import('./store')
const { LowerThirdsWorkspace } = await import('./components/LowerThirdsWorkspace')
const { OutputView } = await import('./components/OutputView')
const { DesignView } = await import('./components/DesignView')

const st = () => useOperatorStore.getState()

const strap = (id: number, name: string): Design => ({
  id,
  name,
  type: 'custom',
  style: {
    ...EMPTY_DESIGN.lowerThird,
    elements: [
      rectElement('bar', 'Bar', { x: 5, y: 75, width: 50, height: 14 }),
      textElement('name', 'Name', { x: 7, y: 76, width: 46, height: 7 }, { text: `${name} sample name`, field: 'headline' }),
      textElement('role', 'Role', { x: 7, y: 83, width: 46, height: 5 }, { text: `${name} sample role`, field: 'body' }),
    ],
  },
})
const NAME = strap(1, 'Name strap')
const QUOTE = strap(2, 'Quote')

const textOf = (node: ReactTestInstance): string => node.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('')

let renderers: ReactTestRenderer[] = []
const render = (element: Parameters<typeof create>[0]) => {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(element)
  })
  renderers.push(renderer)
  return renderer
}

/** The canvas: the workspace's large DesignView, the one that takes edits. */
const canvas = (workspace: ReactTestRenderer) => workspace.root.findAll((n) => n.type === DesignView && 'edit' in n.props && n.props.checker && n.props.warnings)[0]

/** What the operator does on the canvas: double-click a text, type, and press Enter. */
function typeOnCanvas(workspace: ReactTestRenderer, element: string, words: string) {
  const frame = workspace.root.find((n) => n.type === 'button' && String(n.props['aria-label']).startsWith(`${element}:`))
  act(() => frame.props.onDoubleClick())
  // Each key typed reaches the canvas, so the design stretches with the words, before Enter keeps them.
  for (let i = 1; i <= words.length; i++) act(() => canvas(workspace).props.edit.onInput(words.slice(0, i)))
  act(() => canvas(workspace).props.edit.onCommit(words))
}

/** A button under the canvas. */
const button = (workspace: ReactTestRenderer, name: string) =>
  workspace.root.find((n) => n.props.className === 'ltw-field-actions').find((n) => n.type === 'button' && textOf(n).includes(name))

/** The live output window, as App feeds it: the operator's state on each change. */
function sendToOutput() {
  act(() => outputListener?.(selectOutputState(st())))
}

beforeEach(() => {
  saved = {}
  st().hideLowerThird()
  useOperatorStore.setState((s) => ({
    designs: [NAME, QUOTE],
    lowerThirdsOpen: true,
    lowerThirdWorkspaceDesignId: NAME.id,
    lowerThirdPreview: null,
    lowerThirdPointIndex: -1,
    service: null,
    settings: { ...s.settings, lowerThirdDesignId: NAME.id, lowerThirdCanvasText: {}, lowerThirdServicePoints: {}, lowerThirdHoldSeconds: 0 },
    live: { ...s.live, mode: 'show' },
  }))
})

afterEach(() => {
  act(() => renderers.forEach((r) => r.unmount()))
  renderers = []
})

describe('the lower third canvas', () => {
  it('sends the words edited on the canvas after switching designs and back', async () => {
    const workspace = render(createElement(LowerThirdsWorkspace))
    const output = render(createElement(OutputView))
    // No Headline or Body fields beside the canvas: the canvas is the only place to type.
    expect(workspace.root.findAll((n) => n.type === 'input' && /^(Headline|Body)$/.test(String(n.props['aria-label'] ?? '')))).toEqual([])
    expect(workspace.root.findAll((n) => n.props.className === 'ltw-field')).toEqual([])

    typeOnCanvas(workspace, 'Name', 'Pastor Ada Obi')
    expect(canvas(workspace).props.fields).toEqual({ headline: 'Pastor Ada Obi', body: 'Name strap sample role' })

    // Away to another design, where other words are typed, and back.
    act(() => st().setWorkspaceDesign(QUOTE.id))
    expect(canvas(workspace).props.fields.headline).toBe('Quote sample name')
    typeOnCanvas(workspace, 'Role', 'Visiting choir')
    act(() => st().setWorkspaceDesign(NAME.id))
    expect(canvas(workspace).props.fields).toEqual({ headline: 'Pastor Ada Obi', body: 'Name strap sample role' })

    act(() => button(workspace, 'Send to Preview').props.onClick())
    expect(st().lowerThirdPreview).toMatchObject({ headline: 'Pastor Ada Obi', body: 'Name strap sample role', designId: NAME.id })
    act(() => button(workspace, 'Show live').props.onClick())
    sendToOutput()
    const onAir = output.root.findAll((n) => typeof n.type === 'string' && String(n.props.className).split(' ').includes('lt-design'))[0]
    expect(textOf(onAir)).toContain('Pastor Ada Obi')
    // The role was not typed on this design, so it goes out as the canvas shows it: the design's own words.
    expect(textOf(onAir)).toContain('Name strap sample role')
    expect(textOf(onAir)).not.toContain('Visiting choir')
    // Sending changed nothing on the canvas.
    expect(canvas(workspace).props.fields).toEqual({ headline: 'Pastor Ada Obi', body: 'Name strap sample role' })
    await Promise.resolve()
    expect(saved.lowerThirdCanvasText).toEqual({ '1': { headline: 'Pastor Ada Obi' }, '2': { body: 'Visiting choir' } })
  })

  it('keeps the words through closing the workspace and a restart', () => {
    let workspace = render(createElement(LowerThirdsWorkspace))
    typeOnCanvas(workspace, 'Name', 'Guest Speaker')
    act(() => workspace.unmount())

    // A restart: the store starts from what the main process kept.
    act(() => useOperatorStore.setState((s) => ({ settings: { ...s.settings, lowerThirdCanvasText: {} } })))
    act(() => useOperatorStore.setState((s) => ({ settings: { ...s.settings, ...saved } })))
    workspace = render(createElement(LowerThirdsWorkspace))
    expect(canvas(workspace).props.fields.headline).toBe('Guest Speaker')
    act(() => button(workspace, 'Show live').props.onClick())
    expect(st().live.lowerThird).toMatchObject({ headline: 'Guest Speaker', designId: NAME.id })
  })

  it('fills the canvas from a sermon point only when the point is picked, then keeps edits until another is', () => {
    const points = ['Grace is free', 'Grace is costly'].map((text, i) => ({ id: `p${i}`, text, designId: null }))
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, lowerThirdServicePoints: { '0': points } } }))
    const workspace = render(createElement(LowerThirdsWorkspace))
    typeOnCanvas(workspace, 'Name', 'Typed first')
    expect(canvas(workspace).props.fields.headline).toBe('Typed first')

    act(() => st().triggerPoint(0, 'preview'))
    expect(canvas(workspace).props.fields.headline).toBe('Grace is free')
    typeOnCanvas(workspace, 'Name', 'Grace is free, and enough')
    act(() => button(workspace, 'Show live').props.onClick())
    expect(st().live.lowerThird?.headline).toBe('Grace is free, and enough')
    act(() => st().nextPoint())
    expect(canvas(workspace).props.fields.headline).toBe('Grace is costly')
    expect(st().live.lowerThird?.headline).toBe('Grace is costly')
  })
})

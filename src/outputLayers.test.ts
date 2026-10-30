// The layers on the output windows, rendered as the windows render them: the operator's state goes through the main
// process (which checks it) to OutputView and StreamView. Bottom to top: the main content, the idle design while it is
// cleared, and the lower third over everything. Clear takes off the slide and the lower third; Clear lower third only
// the lower third; Black takes off everything.
import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_DESIGN, rectElement, textElement } from '../shared/designs'
import type { Design, OutputState, StreamState } from '../shared/types'

// The main process side: ipcMain keeps the handlers, and each window's webContents.send reaches its renderer.
const ipcHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  BrowserWindow: class {},
  dialog: {},
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => ipcHandlers.set(channel, fn),
    on: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => ipcHandlers.set(channel, fn),
  },
}))
vi.mock('../electron/db/index', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { initSchema } = await import('../electron/db/schema')
  const db = new Database(':memory:')
  initSchema(db)
  return { db }
})

const listeners: { output?: (state: OutputState) => void; stream?: (state: StreamState) => void } = {}
const fakeWindow = (deliver: (state: never) => void) => ({ webContents: { send: (_channel: string, state: never) => deliver(state) } })

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
    // The preload's send, as the operator window calls it: into the main process handler.
    output: {
      send: (state: unknown) => ipcHandlers.get('output:send')?.({}, state),
      onState: (fn: (state: OutputState) => void) => ((listeners.output = fn), () => (listeners.output = undefined)),
    },
    stream: {
      send: (state: unknown) => ipcHandlers.get('stream:send')?.({}, state),
      onState: (fn: (state: StreamState) => void) => ((listeners.stream = fn), () => (listeners.stream = undefined)),
    },
  },
})
// The Stream window makes its page transparent for a Transparent background.
vi.stubGlobal('document', { documentElement: { style: {} }, body: { style: {} } })
vi.stubGlobal('devicePixelRatio', 1)
vi.stubGlobal('innerWidth', 1920)
vi.stubGlobal('innerHeight', 1080)

const { registerOutputIpc } = await import('../electron/ipc/output')
const { registerStreamIpc } = await import('../electron/ipc/stream')
const { selectOutputState, selectStreamState, useOperatorStore } = await import('./store')
const { OutputView } = await import('./components/OutputView')
const { StreamView, StreamScreen } = await import('./components/StreamView')

const outputWindow = fakeWindow((state) => listeners.output?.(state))
const streamWindow = fakeWindow((state) => listeners.stream?.(state))
registerOutputIpc(() => outputWindow as never, () => {})
registerStreamIpc(() => streamWindow as never, () => [streamWindow as never], () => {})

const st = () => useOperatorStore.getState()

/** What App does on every store change: sends both outputs their state. */
function sendToOutputs() {
  act(() => {
    window.api.output.send(selectOutputState(st()))
    window.api.stream.send(selectStreamState(st()))
  })
}

/** Every rendered element, in document order: later ones draw on top, as nothing on the outputs sets a z-index. */
function inOrder(root: ReactTestInstance): ReactTestInstance[] {
  const all: ReactTestInstance[] = []
  const walk = (node: ReactTestInstance) => {
    if (typeof node.type === 'string') all.push(node)
    for (const child of node.children) if (typeof child !== 'string') walk(child)
  }
  walk(root)
  return all
}

const textOf = (node: ReactTestInstance): string => node.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('')
const hasClass = (node: ReactTestInstance, name: string) => String(node.props.className ?? '').split(/\s+/).includes(name)

/** The first element with the class whose words include `words`, and where it is in the drawing order. */
function find(renderer: ReactTestRenderer, className: string, words?: string) {
  const all = inOrder(renderer.root)
  const index = all.findIndex((node) => hasClass(node, className) && (words === undefined || textOf(node).includes(words)))
  return { node: index === -1 ? null : all[index], index }
}

const IDLE: Design = {
  id: 901,
  name: 'Idle logo and tag',
  type: 'custom',
  style: {
    ...EMPTY_DESIGN.lowerThird,
    elements: [
      textElement('logo', 'Church logo', { x: 80, y: 5, width: 15, height: 10 }, { text: 'GRACE CHURCH', loop: 'pulse' }),
      textElement('tag', 'Tag', { x: 3, y: 88, width: 25, height: 6 }, { text: 'Welcome home', hideWithLowerThird: true }),
    ],
  },
}

const DESIGNED: Design = {
  id: 902,
  name: 'Name strap',
  type: 'custom',
  style: {
    ...EMPTY_DESIGN.lowerThird,
    elements: [
      rectElement('bar', 'Bar', { x: 5, y: 75, width: 50, height: 14 }),
      textElement('name', 'Name', { x: 7, y: 76, width: 46, height: 7 }, { text: 'Sample name', field: 'headline' }),
      textElement('role', 'Role', { x: 7, y: 83, width: 46, height: 5 }, { text: 'Sample role', field: 'body' }),
    ],
  },
}

/** The line most tests show. */
const PASTOR = { headline: 'Pastor Sam', body: 'Lead Pastor' }

let renderers: ReactTestRenderer[] = []
const render = (element: Parameters<typeof create>[0]) => {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(element)
  })
  renderers.push(renderer)
  return renderer
}

beforeEach(() => {
  st().hideLowerThird()
  useOperatorStore.setState((s) => ({
    designs: [IDLE, DESIGNED],
    settings: {
      ...s.settings,
      streamSlideContent: 'full',
      streamKeyMode: 'chroma',
      lowerThirdHoldSeconds: 0,
      overlaysOnChurchScreen: false,
      idleDesignId: null,
      lowerThirdDesignId: null,
    },
    live: { ...s.live, mode: 'clear' },
  }))
  st().selectScripture('John 3:16 KJV', [{ text: 'For God so loved the world', caption: 'John 3:16 KJV' }])
  st().goLive(0)
})

afterEach(() => {
  act(() => renderers.forEach((r) => r.unmount()))
  renderers = []
})

describe('the live output window', () => {
  it('draws a lower third that has been shown, on top of the live slide', () => {
    const output = render(createElement(OutputView))
    sendToOutputs()
    const slide = find(output, 'output-frame', 'For God so loved the world')
    expect(slide.node).not.toBeNull()
    expect(find(output, 'lower-third-layer', 'Pastor Sam').node).toBeNull()

    act(() => st().showLowerThirdLine(PASTOR))
    sendToOutputs()
    const lowerThird = find(output, 'lower-third-layer', 'Pastor Sam')
    expect(lowerThird.node).not.toBeNull()
    expect(textOf(lowerThird.node!)).toContain('Lead Pastor')
    // Later in the document draws on top: the lower third is over the slide, not under it.
    expect(lowerThird.index).toBeGreaterThan(slide.index)
    expect(find(output, 'lt-slide-in', 'Pastor Sam').node).not.toBeNull()
  })

  it('draws the chosen design with the lower third’s words', () => {
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, lowerThirdDesignId: DESIGNED.id } }))
    const output = render(createElement(OutputView))
    act(() => st().showLowerThirdLine(PASTOR))
    sendToOutputs()
    const design = find(output, 'lt-design', 'Pastor Sam')
    expect(design.node).not.toBeNull()
    expect(textOf(design.node!)).toContain('Lead Pastor')
    expect(textOf(design.node!)).not.toContain('Sample name')
  })

  it('plays a sermon point in a design whose elements animate, one after another, and waits for the way out', () => {
    vi.useFakeTimers()
    const built: Design = {
      ...DESIGNED,
      id: 903,
      style: {
        ...DESIGNED.style,
        elements: [
          rectElement('bar', 'Bar', { x: 5, y: 75, width: 50, height: 14 }, {
            loop: 'shimmer',
            animation: { in: { motion: 'slideLeft', durationMs: 400, delayMs: 0, easing: 'easeOut' }, out: { motion: 'fade', durationMs: 300, delayMs: 0, easing: 'easeIn' }, order: 0 },
          }),
          textElement('number', 'Number', { x: 6, y: 76, width: 5, height: 12 }, { text: '0', field: 'number' }),
          textElement('point', 'Point', { x: 12, y: 76, width: 40, height: 12 }, {
            text: 'Sample',
            field: 'headline',
            animation: { in: { motion: 'fade', durationMs: 500, delayMs: 100, easing: 'ease' }, out: { motion: 'wipe', durationMs: 200, delayMs: 0, easing: 'easeIn' }, order: 1 },
          }),
        ],
      },
    }
    useOperatorStore.setState((s) => ({
      designs: [IDLE, DESIGNED, built],
      lowerThirdWorkspaceDesignId: built.id,
      settings: { ...s.settings, lowerThirdServicePoints: { '0': [{ id: 'p', text: 'Grace is free', designId: null }] } },
    }))
    const output = render(createElement(OutputView))
    act(() => st().triggerPoint(0, 'live'))
    sendToOutputs()
    const style = (id: string) => find(output, 'dv-el', id).node?.props.style
    expect(textOf(find(output, 'lt-design', 'Grace is free').node!)).toContain('1')
    // The bar slides in, then shimmers; the point fades in once the bar is in.
    expect(style('Grace is free')?.animation).toBe('dv-in-fade 500ms ease 500ms backwards')
    expect(find(output, 'dv-loop-shimmer').node?.props.style.animation).toBe('dv-in-slideLeft 400ms ease-out 0ms backwards, dv-shimmer 2.6s ease-in-out 400ms infinite')

    // On the way out the point wipes first, then the bar fades; the layer stays until both are done.
    act(() => st().hideLowerThird())
    sendToOutputs()
    expect(style('Grace is free')?.animation).toBe('dv-out-wipe 200ms ease-in 0ms forwards')
    act(() => {
      vi.advanceTimersByTime(450)
    })
    expect(find(output, 'lt-design', 'Grace is free').node).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(find(output, 'lt-design').node).toBeNull()
    vi.useRealTimers()
  })

  it('Clear lower third animates only the lower third out; the slide stays', () => {
    const output = render(createElement(OutputView))
    act(() => st().showLowerThirdLine(PASTOR))
    sendToOutputs()
    act(() => st().hideLowerThird())
    sendToOutputs()
    expect(st().live.mode).toBe('show')
    expect(find(output, 'lt-slide-out', 'Pastor Sam').node).not.toBeNull()
    expect(find(output, 'output-frame', 'For God so loved the world').node).not.toBeNull()
  })

  it('Clear takes off the slide and the lower third, and shows the idle design, whose tag steps aside for a lower third', () => {
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, idleDesignId: IDLE.id } }))
    const output = render(createElement(OutputView))
    act(() => st().showLowerThirdLine(PASTOR))
    sendToOutputs()
    expect(find(output, 'idle-layer').node).toBeNull()

    act(() => st().setOutputMode('clear'))
    sendToOutputs()
    expect(st().live.lowerThird).toBeNull()
    expect(find(output, 'lt-slide-out', 'Pastor Sam').node).not.toBeNull()
    const idle = find(output, 'idle-layer', 'GRACE CHURCH')
    expect(idle.node).not.toBeNull()
    expect(find(output, 'dv-loop-pulse', 'GRACE CHURCH').node).not.toBeNull()
    expect(find(output, 'dv-aside', 'Welcome home').node).toBeNull()

    // A lower third over the idle design: the idle design stays, its flagged tag fades out.
    act(() => st().showLowerThirdLine(PASTOR))
    sendToOutputs()
    expect(find(output, 'idle-layer', 'GRACE CHURCH').node).not.toBeNull()
    expect(find(output, 'dv-aside', 'Welcome home').node).not.toBeNull()
    expect(find(output, 'lower-third-layer', 'Pastor Sam').index).toBeGreaterThan(find(output, 'idle-layer').index)
  })

  it('Black takes everything off', () => {
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, idleDesignId: IDLE.id } }))
    const output = render(createElement(OutputView))
    act(() => st().showLowerThirdLine(PASTOR))
    act(() => st().setOutputMode('black'))
    sendToOutputs()
    expect(find(output, 'lower-third-layer', 'Pastor Sam').node).toBeNull()
    expect(find(output, 'idle-layer').node).toBeNull()
    expect(st().live.lowerThird?.headline).toBe('Pastor Sam')
  })
})

describe('the Stream output window', () => {
  it('draws the lower third over a full screen slide', () => {
    const stream = render(createElement(StreamView))
    act(() => st().showLowerThirdLine(PASTOR))
    sendToOutputs()
    const slide = find(stream, 'output-frame', 'For God so loved the world')
    const lowerThird = find(stream, 'lower-third-layer', 'Pastor Sam')
    expect(slide.node).not.toBeNull()
    expect(lowerThird.index).toBeGreaterThan(slide.index)
  })

  it('Overlay only leaves the slides off but keeps the lower third', () => {
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, streamSlideContent: 'hide' } }))
    const stream = render(createElement(StreamView))
    act(() => st().showLowerThirdLine(PASTOR))
    sendToOutputs()
    expect(find(stream, 'output-frame', 'For God so loved the world').node).toBeNull()
    expect(find(stream, 'lower-third-layer', 'Pastor Sam').node).not.toBeNull()
  })

  it('Transparent, chroma and black backgrounds, and the key matte for Key and Fill', () => {
    act(() => st().showLowerThirdLine(PASTOR))
    const background = (keyMode: StreamState['keyMode'], props: Record<string, unknown> = {}) => {
      useOperatorStore.setState((s) => ({ settings: { ...s.settings, streamKeyMode: keyMode } }))
      const screen = render(createElement(StreamScreen, { state: selectStreamState(st()), ...props }))
      return { screen, key: find(screen, 'stream-key').node }
    }
    expect(background('transparent').key?.props.style.background).toBe('transparent')
    expect(background('chroma').key?.props.style.background).toBe('#00ff00')
    expect(background('luma').key?.props.style.background).toBe('#000000')
    // The fill is the graphics on black; the key draws the same layers through the white matte filter.
    const fill = background('keyFill')
    expect(fill.key?.props.style.background).toBe('#000000')
    expect(find(fill.screen, 'stream-matte').node).toBeNull()
    const key = background('keyFill', { matte: true })
    expect(find(key.screen, 'stream-matte', 'Pastor Sam').node).not.toBeNull()
  })

  it('the preview’s test background replaces the key color behind the overlay', () => {
    act(() => st().showLowerThirdLine(PASTOR))
    const preview = render(createElement(StreamScreen, { state: selectStreamState(st()), testBackground: 'checker' }))
    expect(find(preview, 'checker').node).not.toBeNull()
    expect(find(preview, 'lower-third-layer', 'Pastor Sam').index).toBeGreaterThan(find(preview, 'checker').index)
  })
})

// The Stream output: Black blacks it out, Clear or Hide empties the slide layer, the logo layer has its own toggle,
// and overlays reach the projector only with the church screen setting.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogoItem } from '../shared/types'

vi.stubGlobal('window', { api: { media: { getSlideBackgrounds: async () => ({}) } } })

const { selectOutputState, selectStreamState, useOperatorStore } = await import('./store')

const logo = (id: string, enabled = true): LogoItem => ({
  id,
  name: `${id}.png`,
  url: `wd-media://local/${id}.png`,
  anchor: 'top-right',
  x: 50,
  y: 50,
  size: 12,
  margin: 0,
  opacity: 1,
  enabled,
})
const st = () => useOperatorStore.getState()
const stream = () => selectStreamState(st())

beforeEach(() => {
  useOperatorStore.setState((s) => ({
    settings: {
      ...s.settings,
      streamSlideContent: 'full',
      streamKeyMode: 'chroma',
      streamKeyColor: '#00ff00',
      streamResolution: '1920x1080',
      logoItems: [logo('a'), logo('b', false)],
      logoLayerVisible: true,
      overlaysOnChurchScreen: false,
    },
    streamTestPattern: false,
    live: { ...s.live, mode: 'show' },
  }))
  st().selectScripture('John 3:16 KJV', [{ text: 'For God so loved the world', caption: 'John 3:16 KJV' }])
  st().goLive(0)
})

describe('Stream output', () => {
  it('shows the live slide full screen over the key color and the logos that are on', () => {
    expect(stream()).toMatchObject({
      mode: 'show',
      text: 'For God so loved the world',
      keyMode: 'chroma',
      keyColor: '#00ff00',
      width: 1920,
      height: 1080,
      testPattern: false,
    })
    expect(stream().overlays.logos.map((l) => l.id)).toEqual(['a'])
  })

  it('empties the slide layer in Clear and with slide content hidden, and blacks out in Black', () => {
    st().setOutputMode('clear')
    expect(stream().mode).toBe('clear')
    st().setOutputMode('logo')
    expect(stream().mode).toBe('logo')
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, streamSlideContent: 'hide' } }))
    expect(stream().mode).toBe('clear')
    st().setOutputMode('show')
    expect(stream().mode).toBe('clear')
    st().setOutputMode('black')
    expect(stream().mode).toBe('black')
  })

  it('hides every logo while the logo layer is hidden, and shows the test pattern on request', () => {
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, logoLayerVisible: false } }))
    st().setStreamTestPattern(true)
    expect(stream().overlays.logos).toEqual([])
    expect(stream().testPattern).toBe(true)
  })

  it('keeps overlays off the projector unless the church screen setting is on, and never in Black', () => {
    expect(selectOutputState(st()).overlays).toBeNull()
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, overlaysOnChurchScreen: true } }))
    expect(selectOutputState(st()).overlays?.logos.map((l) => l.id)).toEqual(['a'])
    st().setOutputMode('black')
    expect(selectOutputState(st()).overlays).toBeNull()
  })
})

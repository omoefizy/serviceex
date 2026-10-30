// The lower third: it lives on the outputs apart from the slides, on top of everything, updates in place, keeps a
// history for this service, Clear takes it off with the slide, and the hold timer hides it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('window', { api: { media: { getSlideBackgrounds: async () => ({}) } } })

const { selectOutputState, selectStreamState, useOperatorStore } = await import('./store')

const st = () => useOperatorStore.getState()
const onStream = () => selectStreamState(st()).overlays.lowerThird
const type = (headline: string, body = '') => st().setLowerThirdDraft({ headline, body })

beforeEach(() => {
  vi.useFakeTimers()
  st().hideLowerThird()
  useOperatorStore.setState((s) => ({
    settings: {
      ...s.settings,
      streamSlideContent: 'full',
      lowerThirdHoldSeconds: 0,
      lowerThirdPoints: [],
      overlaysOnChurchScreen: false,
    },
    lowerThirdHistory: [],
    lowerThirdPointIndex: -1,
    live: { ...s.live, mode: 'clear' },
  }))
  st().selectScripture('John 3:16 KJV', [
    { text: 'One', caption: 'John 3:16 KJV' },
    { text: 'Two', caption: 'John 3:17 KJV' },
  ])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('lower third', () => {
  it('shows the typed line, untouched by going live, changing slides or Go Back', () => {
    type('Pastor Sam', 'Lead Pastor')
    st().showLowerThird()
    const shown = st().live.lowerThird
    expect(shown).toMatchObject({ headline: 'Pastor Sam', body: 'Lead Pastor' })
    st().goLive(0)
    st().nextSlide()
    st().goBack()
    st().setOutputMode('logo')
    expect(st().live.lowerThird).toEqual(shown)
    expect(onStream()).toMatchObject({ headline: 'Pastor Sam', body: 'Lead Pastor' })
  })

  it('does nothing with both fields empty, and an update keeps its run so the text changes in place', () => {
    type('  ')
    st().showLowerThird()
    expect(st().live.lowerThird).toBeNull()
    type('First point')
    st().showLowerThird()
    const runId = st().live.lowerThird?.runId
    type('First point, corrected')
    st().showLowerThird()
    expect(st().live.lowerThird).toMatchObject({ runId, headline: 'First point, corrected' })
    st().hideLowerThird()
    type('Second point')
    st().showLowerThird()
    expect(st().live.lowerThird?.runId).not.toBe(runId)
  })

  it('keeps the last 30 lines used, newest first, without repeats', () => {
    for (let i = 0; i < 35; i++) {
      type(`Line ${i}`)
      st().showLowerThird()
    }
    type('Line 33')
    st().showLowerThird()
    const history = st().lowerThirdHistory
    expect(history).toHaveLength(30)
    expect(history.slice(0, 3).map((l) => l.headline)).toEqual(['Line 33', 'Line 34', 'Line 32'])
  })

  it('stays up over a full screen slide on every output, and Black takes it off until it lifts', () => {
    type('Welcome')
    st().showLowerThird()
    st().goLive(0)
    expect(onStream()?.headline).toBe('Welcome')
    expect(selectOutputState(st()).overlays?.lowerThird?.headline).toBe('Welcome')
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, streamSlideContent: 'hide' } }))
    expect(onStream()?.headline).toBe('Welcome')
    st().setOutputMode('black')
    expect(onStream()).toBeNull()
    expect(selectOutputState(st()).overlays).toBeNull()
    expect(st().live.lowerThird?.headline).toBe('Welcome')
    st().setOutputMode('show')
    expect(selectOutputState(st()).overlays?.lowerThird?.headline).toBe('Welcome')
  })

  it('reaches the projector whatever the church screen setting, which governs only the logos', () => {
    const logo = { id: 'l', name: 'Logo', url: 'wd-media://logo.png', anchor: 'top-right', x: 50, y: 50, size: 10, margin: 0, opacity: 1, enabled: true } as const
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, logoItems: [logo] } }))
    type('Welcome')
    st().showLowerThird()
    expect(selectOutputState(st()).overlays?.lowerThird?.headline).toBe('Welcome')
    expect(selectOutputState(st()).overlays?.logos).toEqual([])
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, overlaysOnChurchScreen: true } }))
    expect(selectOutputState(st()).overlays?.logos).toEqual([logo])
  })

  it('Clear takes off the slide and the lower third; Clear lower third only the lower third', () => {
    type('Welcome')
    st().showLowerThird()
    st().goLive(0)
    st().hideLowerThird()
    expect(st().live.mode).toBe('show')
    expect(st().live.lowerThird).toBeNull()
    st().showLowerThird()
    st().setOutputMode('clear')
    expect(st().live.lowerThird).toBeNull()
    expect(st().live.mode).toBe('clear')
  })

  it('shows the idle design only while the main content is cleared, never in Black', () => {
    const idle = { id: 7, name: 'Idle', type: 'custom' as const, style: { category: 'lowerThird' as const, background: { kind: 'transparent' as const }, elements: [] } }
    useOperatorStore.setState((s) => ({ designs: [idle], settings: { ...s.settings, idleDesignId: 7 } }))
    st().setOutputMode('clear')
    expect(selectOutputState(st()).overlays?.idle).toEqual(idle.style)
    expect(selectStreamState(st()).overlays.idle).toEqual(idle.style)
    st().goLive(0)
    expect(selectOutputState(st()).overlays?.idle).toBeNull()
    st().setOutputMode('black')
    expect(selectOutputState(st()).overlays).toBeNull()
    expect(selectStreamState(st()).overlays.idle).toBeNull()
    // A deleted design shows nothing.
    useOperatorStore.setState({ designs: [] })
    st().setOutputMode('clear')
    expect(selectOutputState(st()).overlays?.idle).toBeNull()
  })

  it('hides itself after the hold time, counted from the latest show or update', () => {
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, lowerThirdHoldSeconds: 10 } }))
    type('Welcome')
    st().showLowerThird()
    vi.advanceTimersByTime(8000)
    type('Welcome, everyone')
    st().showLowerThird()
    vi.advanceTimersByTime(8000)
    expect(st().live.lowerThird?.headline).toBe('Welcome, everyone')
    vi.advanceTimersByTime(2000)
    expect(st().live.lowerThird).toBeNull()
  })

  it('Next Point shows the queued points in turn', () => {
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, lowerThirdPoints: ['Grace is free', 'Grace is costly'] } }))
    st().nextLowerThirdPoint()
    expect(st().live.lowerThird?.headline).toBe('Grace is free')
    st().nextLowerThirdPoint()
    expect(st().live.lowerThird?.headline).toBe('Grace is costly')
    st().nextLowerThirdPoint()
    expect(st().live.lowerThird?.headline).toBe('Grace is costly')
    expect(st().lowerThirdPointIndex).toBe(1)
  })
})

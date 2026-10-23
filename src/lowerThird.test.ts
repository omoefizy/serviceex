// The lower third: it lives on the output apart from the slides, updates in place, keeps a history for this service,
// steps aside for a full screen slide unless told to stay on top, and the hold timer hides it.
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
      lowerThirdOverFullSlide: false,
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
    st().setOutputMode('clear')
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

  it('steps aside for a full screen slide unless set to stay on top, and Black takes it off the stream', () => {
    type('Welcome')
    st().showLowerThird()
    st().goLive(0)
    expect(onStream()).toBeNull()
    expect(selectStreamState(st()).lowerThirdOnTop).toBe(false)
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, lowerThirdOverFullSlide: true } }))
    expect(onStream()?.headline).toBe('Welcome')
    expect(selectStreamState(st()).lowerThirdOnTop).toBe(true)
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, lowerThirdOverFullSlide: false, streamSlideContent: 'hide' } }))
    expect(onStream()?.headline).toBe('Welcome')
    st().setOutputMode('black')
    expect(onStream()).toBeNull()
    expect(st().live.lowerThird?.headline).toBe('Welcome')
  })

  it('reaches the projector only with the church screen setting', () => {
    type('Welcome')
    st().showLowerThird()
    expect(selectOutputState(st()).overlays).toBeNull()
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, overlaysOnChurchScreen: true } }))
    expect(selectOutputState(st()).overlays?.lowerThird?.headline).toBe('Welcome')
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

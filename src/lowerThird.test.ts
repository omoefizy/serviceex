// The lower third: it lives on the outputs apart from the slides, on top of everything, updates in place, keeps a
// history for this service, Clear takes it off with the slide, and the hold timer hides it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('window', { api: { media: { getSlideBackgrounds: async () => ({}) } } })

const { selectOutputState, selectPreviewLowerThirdDisplay, selectSermonPoints, selectStreamState, useOperatorStore } = await import('./store')
const { normalizeDesign } = await import('../shared/designs')

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
      lowerThirdServicePoints: {},
      overlaysOnChurchScreen: false,
    },
    lowerThirdHistory: [],
    lowerThirdPointIndex: -1,
    lowerThirdPreview: null,
    lowerThirdWorkspaceDesignId: null,
    service: null,
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
    const points = ['Grace is free', 'Grace is costly'].map((text, i) => ({ id: `p${i}`, text, designId: null }))
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, lowerThirdServicePoints: { '0': points } } }))
    st().nextPoint()
    expect(st().live.lowerThird?.headline).toBe('Grace is free')
    st().nextPoint()
    expect(st().live.lowerThird?.headline).toBe('Grace is costly')
    st().nextPoint()
    expect(st().live.lowerThird?.headline).toBe('Grace is costly')
    expect(st().lowerThirdPointIndex).toBe(1)
  })

  describe('sermon points and the Preview', () => {
    const design = (id: number, name: string) => ({ id, name, type: 'custom' as const, style: normalizeDesign({ category: 'lowerThird', elements: [{ kind: 'text', id: name, field: 'headline' }] }) })
    const points = [
      { id: 'a', text: 'Grace is free', designId: null },
      { id: 'b', text: 'Grace is costly', designId: 2 },
      { id: 'c', text: 'Grace changes us', designId: null },
    ]
    beforeEach(() => {
      useOperatorStore.setState((s) => ({
        designs: [design(1, 'Points'), design(2, 'Quote')],
        lowerThirdWorkspaceDesignId: 1,
        settings: { ...s.settings, lowerThirdDesignId: null, lowerThirdQuickTarget: 'preview', lowerThirdServicePoints: { '0': points, '7': [points[0]] } },
      }))
    })

    it('keeps each service its own points', () => {
      expect(selectSermonPoints(st()).map((p) => p.text)).toEqual(['Grace is free', 'Grace is costly', 'Grace changes us'])
      useOperatorStore.setState({ service: { id: 7, name: 'Easter', date: null, items: [] } })
      expect(selectSermonPoints(st()).map((p) => p.text)).toEqual(['Grace is free'])
    })

    it('stages a point on Preview without touching the air, then Show live takes it', () => {
      st().triggerPoint(0, 'preview')
      expect(st().live.lowerThird).toBeNull()
      expect(selectPreviewLowerThirdDisplay(st())).toMatchObject({ headline: 'Grace is free', number: '1', design: design(1, 'Points').style })
      st().takeLowerThirdPreviewLive()
      expect(onStream()).toMatchObject({ headline: 'Grace is free', number: '1' })
      expect(st().lowerThirdPointIndex).toBe(0)
    })

    it('shows a point live in its own design, else the workspace design, and Next goes on from the last one', () => {
      st().triggerPoint(1, 'live')
      expect(onStream()).toMatchObject({ headline: 'Grace is costly', number: '2', design: design(2, 'Quote').style })
      st().nextPoint()
      expect(onStream()).toMatchObject({ headline: 'Grace changes us', number: '3', design: design(1, 'Points').style })
      // Past the last point Next does nothing.
      st().nextPoint()
      expect(st().live.lowerThird?.headline).toBe('Grace changes us')
      expect(st().lowerThirdPointIndex).toBe(2)
    })

    it('changes the words in place within one design, and comes on afresh in another', () => {
      st().triggerPoint(0, 'live')
      const first = st().live.lowerThird?.runId
      st().triggerPoint(2, 'live')
      expect(st().live.lowerThird?.runId).toBe(first)
      st().triggerPoint(1, 'live')
      expect(st().live.lowerThird?.runId).not.toBe(first)
    })

    it('ignores points that do not exist, and Clear lower third takes it off', () => {
      st().triggerPoint(5, 'live')
      expect(st().live.lowerThird).toBeNull()
      st().triggerPoint(0, 'live')
      st().hideLowerThird()
      expect(onStream()).toBeNull()
    })

    it('sends a quote where Settings says, in the default design, unless told otherwise', () => {
      useOperatorStore.setState((s) => ({ settings: { ...s.settings, lowerThirdDesignId: 2 } }))
      st().sendQuoteAsLowerThird('  Faith takes the first step  ')
      expect(st().live.lowerThird).toBeNull()
      expect(selectPreviewLowerThirdDisplay(st())).toMatchObject({ headline: 'Faith takes the first step', design: design(2, 'Quote').style })
      st().sendQuoteAsLowerThird('Straight on air', 'live')
      expect(onStream()).toMatchObject({ headline: 'Straight on air' })
      useOperatorStore.setState((s) => ({ settings: { ...s.settings, lowerThirdQuickTarget: 'live' } }))
      st().sendQuoteAsLowerThird('By the setting')
      expect(onStream()).toMatchObject({ headline: 'By the setting' })
    })
  })
})

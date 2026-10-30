// The right column's Queue (the live item's slides still to come: play, remove, reorder) and Recently shown (the last
// items and lower thirds sent live, each sent again to Preview or live in one click).
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('window', { api: { media: { getSlideBackgrounds: async () => ({}) } } })

const { RECENT_LIMIT, useOperatorStore } = await import('./store')

const st = () => useOperatorStore.getState()
const liveTexts = () => st().live.slides.map((s) => s.text)

function scripture(title: string, texts: string[]) {
  st().selectScripture(title, texts.map((text, i) => ({ text, caption: `${title.split(' ')[0]} 1:${i + 1} KJV` })))
}

beforeEach(() => {
  st().hideLowerThird()
  useOperatorStore.setState({ recentlyShown: [], lowerThirdPreview: null, liveHistory: [] })
  useOperatorStore.setState((s) => ({ settings: { ...s.settings, lowerThirdHoldSeconds: 0 }, live: { ...s.live, slideIndex: null, slides: [], deckKey: null } }))
})

describe('the queue', () => {
  beforeEach(() => {
    scripture('John 1:1-4 KJV', ['One', 'Two', 'Three', 'Four'])
    st().goLive(0)
  })

  it('plays a waiting slide now', () => {
    st().playQueued(2)
    expect(st().live.slideIndex).toBe(2)
    expect(st().live.slides[2].text).toBe('Three')
  })

  it('removes a waiting slide, so Next skips it', () => {
    st().removeQueued(1)
    expect(liveTexts()).toEqual(['One', 'Three', 'Four'])
    st().nextSlide()
    expect(st().live.slides[st().live.slideIndex!].text).toBe('Three')
  })

  it('reorders the waiting slides, never the one on screen or before it', () => {
    st().moveQueued(3, 1)
    expect(liveTexts()).toEqual(['One', 'Four', 'Two', 'Three'])
    st().moveQueued(1, 0)
    st().removeQueued(0)
    st().playQueued(0)
    expect(liveTexts()).toEqual(['One', 'Four', 'Two', 'Three'])
    expect(st().live.slideIndex).toBe(0)
  })
})

describe('recently shown', () => {
  it('lists items and lower thirds sent live, newest first, once each', () => {
    scripture('John 1:1-2 KJV', ['In the beginning', 'The same was'])
    st().goLive(0)
    st().nextSlide()
    scripture('Psalm 1:1 KJV', ['Blessed is the man'])
    st().goLive(0)
    st().showLowerThirdLine({ headline: 'Pastor Sam', body: 'Lead Pastor' })
    expect(st().recentlyShown.map((r) => [r.kind, r.title])).toEqual([
      ['lowerThird', 'Pastor Sam'],
      ['scripture', 'Psalm 1:1 KJV'],
      ['scripture', 'John 1:1-2 KJV'],
    ])
    // The item keeps the slide that was live last.
    expect(st().recentlyShown[2]).toMatchObject({ slideIndex: 1, detail: 'John 1:2 KJV' })
  })

  it(`keeps the last ${RECENT_LIMIT}`, () => {
    for (let n = 1; n <= RECENT_LIMIT + 3; n++) st().showLowerThirdLine({ headline: `Line ${n}`, body: '' })
    expect(st().recentlyShown).toHaveLength(RECENT_LIMIT)
    expect(st().recentlyShown[0].title).toBe(`Line ${RECENT_LIMIT + 3}`)
  })

  it('sends an item back to Preview at its slide, or straight live', () => {
    scripture('John 1:1-3 KJV', ['One', 'Two', 'Three'])
    st().goLive(0)
    st().nextSlide()
    const john = st().recentlyShown[0]
    scripture('Psalm 1:1 KJV', ['Blessed'])
    st().goLive(0)
    st().resendRecent(john.id, 'preview')
    expect(st().deckTitle).toBe('John 1:1-3 KJV')
    expect(st().highlightIndex).toBe(1)
    expect(st().live.title).toBe('Psalm 1:1 KJV')
    st().resendRecent(john.id, 'live')
    expect(st().live).toMatchObject({ title: 'John 1:1-3 KJV', slideIndex: 1 })
  })

  it('sends a lower third back to Preview or live', () => {
    st().showLowerThirdLine({ headline: 'Welcome', body: '', designId: 4 })
    st().hideLowerThird()
    const welcome = st().recentlyShown[0]
    st().resendRecent(welcome.id, 'preview')
    expect(st().lowerThirdPreview).toMatchObject({ headline: 'Welcome', designId: 4 })
    expect(st().live.lowerThird).toBeNull()
    st().resendRecent(welcome.id, 'live')
    expect(st().live.lowerThird).toMatchObject({ headline: 'Welcome', designId: 4 })
  })
})

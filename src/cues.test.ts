// Cues: arriving in the tray, and Preview, Add to schedule and Dismiss on each kind, never change what is on the
// output. The text arrives exactly as it was sent.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cue, SharingEvent } from '../shared/types'

let listener: ((event: SharingEvent) => void) | null = null
const added: unknown[] = []
let cues: Cue[] = []

vi.stubGlobal('window', {
  api: {
    media: { getSlideBackgrounds: async () => ({}) },
    songs: {
      list: async () => [{ id: 7, title: 'Amazing Grace', author: null }],
      get: async (id: number) => (id === 7 ? { id: 7, title: 'Amazing Grace', author: null, copyright: null, tags: [], arrangement: { order: [], linesPerSlide: null }, themeId: null, lyrics: 'Amazing grace\nHow sweet the sound' } : undefined),
    },
    services: {
      addItem: async (...args: unknown[]) => added.push(args),
      get: async () => ({ id: 1, name: 'Sunday', date: null, items: [] }),
    },
    sharing: {
      status: async () => ({ enabled: true, deviceId: 'a'.repeat(32), deviceName: 'Booth', port: 1, addresses: [], error: null }),
      peers: async () => [],
      inbox: async () => [],
      cues: async () => cues,
      sharedService: async () => ({ role: 'none', items: [] }),
      librarySync: async () => null,
      dismissCue: async (id: string) => (cues = cues.filter((c) => c.id !== id)),
      onEvent: (fn: (event: SharingEvent) => void) => {
        listener = fn
        return () => {}
      },
    },
  },
})

const { selectOutputState, selectLiveSlide, useOperatorStore } = await import('./store')
const { addCueToSchedule, previewCue, startSharing, useSharingStore } = await import('./lib/sharing')

const st = () => useOperatorStore.getState()
const output = () => JSON.stringify(selectOutputState(st()))

const cue = (kind: Cue['kind'], text: string, extra: Partial<Cue> = {}): Cue => ({
  id: kind.padEnd(32, '0').slice(0, 32).replace(/[^0-9a-f]/g, '0'),
  kind,
  title: kind === 'verse' ? 'John 3:16 KJV' : kind === 'song' ? 'Amazing Grace' : 'Note',
  text,
  fromId: 'b'.repeat(32),
  fromName: 'Front',
  receivedAt: new Date().toISOString(),
  ...extra,
})

beforeEach(async () => {
  startSharing()
  await useOperatorStore.getState().openService(1)
  // Something is live: a scripture slide on screen.
  st().selectScripture('Psalm 23:1 KJV', [{ text: 'The LORD is my shepherd', caption: 'Psalm 23:1 KJV' }])
  st().goLive(0)
})

describe('cues', () => {
  it('never change the output: arriving, previewing, adding to the schedule or dismissing', async () => {
    const before = output()
    const live = selectLiveSlide(st())
    const sent = [
      cue('verse', 'For God so loved the world', { verses: [{ text: 'For God so loved the world', caption: 'John 3:16 KJV' }] }),
      cue('song', 'Amazing grace'),
      cue('point', 'Grace is a gift'),
      cue('note', 'Lights down after this song'),
      cue('text', '  “We love because He first loved us.”  \nSecond line'),
    ]
    for (const c of sent) {
      cues = [c, ...cues]
      listener!({ type: 'cues', cues, arrived: c })
    }
    expect(useSharingStore.getState().cues).toHaveLength(5)
    expect(output()).toBe(before)

    for (const c of sent) {
      await previewCue(c)
      expect(output(), `preview ${c.kind}`).toBe(before)
      await addCueToSchedule(c)
      expect(output(), `schedule ${c.kind}`).toBe(before)
    }
    expect(selectLiveSlide(st())).toEqual(live)
    expect(st().live.slideIndex).toBe(0)
    // With no lower third design, a point is staged on Preview in the template; it never goes live.
    expect(st().lowerThirdPreview?.headline).toBe('Grace is a gift')
    expect(st().live.lowerThird).toBeNull()
    // Added to the schedule, then gone from the tray; the free text kept exactly as sent.
    expect(added).toHaveLength(5)
    expect(added.at(-1)).toEqual([1, 'announcement', null, { title: 'Note', body: '  “We love because He first loved us.”  \nSecond line' }])
    expect(added[1]).toEqual([1, 'song', 7, null])
    expect(cues).toEqual([])
  })

  it('show the preview with the exact text, while the output keeps the live slide', async () => {
    const before = output()
    const text = '  Exact words,\nkept as written.  '
    await previewCue(cue('text', text))
    expect(st().slides.map((s) => s.text).join('\n')).toContain('Exact words,')
    expect(output()).toBe(before)
  })
})

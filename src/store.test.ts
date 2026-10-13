// The alert ticker: it runs on the live output apart from the slides, priority messages interrupt it and it carries
// on where it was, and a set number of loops ends it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlertMessage } from '../shared/types'

vi.stubGlobal('window', { api: { media: { getSlideBackgrounds: async () => ({}) } } })

const { selectAlertDisplay, selectOutputState, selectStageState, useOperatorStore } = await import('./store')
const { PRIORITY_BAND_COLOR, PRIORITY_PASSES, runDurationMs } = await import('./lib/ticker')

const message = (id: string, priority = false): AlertMessage => ({ id, text: `Message ${id}`, priority })
const st = () => useOperatorStore.getState()
const shown = () => selectAlertDisplay(st())

beforeEach(() => {
  vi.useFakeTimers()
  st().stopAlerts()
  useOperatorStore.setState((s) => ({
    settings: {
      ...s.settings,
      alertLoops: 0,
      alertLayout: 'divider',
      alertKeepOnClear: true,
      alertPosition: 'bottom',
      alertSpeed: 14,
      alertFontSize: 5,
      alertBandColor: '#0a0e1c',
      alertMessages: [],
    },
    live: { ...s.live, mode: 'show' },
  }))
  st().selectScripture('John 3:16 KJV', [
    { text: 'One', caption: 'John 3:16 KJV' },
    { text: 'Two', caption: 'John 3:17 KJV' },
  ])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('alert ticker', () => {
  it('runs the messages in turn, untouched by going live, changing slides or loading something else', () => {
    st().startAlerts([message('a'), message('b')])
    const run = shown()
    st().goLive(0)
    st().nextSlide()
    st().goLive(1)
    st().goBack()
    st().selectSong(null)
    expect(shown()).toEqual(run)
    expect(run).toMatchObject({ texts: ['Message a', 'Message b'], loops: 0, position: 'bottom', priority: false })
    expect(selectOutputState(st()).alert).toEqual(run)
    expect(selectStageState(st()).alert).toEqual(run)
  })

  it('is hidden by Black and by Hide, and kept by Clear unless the setting says otherwise, without losing its place', () => {
    st().startAlerts([message('a')])
    const startedAt = shown()?.startedAt
    st().setOutputMode('black')
    expect(shown()).toBeNull()
    st().setOutputMode('clear')
    expect(shown()?.startedAt).toBe(startedAt)
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, alertKeepOnClear: false } }))
    expect(shown()).toBeNull()
    st().setOutputMode('show')
    st().setAlertHidden(true)
    expect(shown()).toBeNull()
    vi.advanceTimersByTime(5000)
    st().setAlertHidden(false)
    expect(shown()?.startedAt).toBe(startedAt)
  })

  it('loops until stopped by default', () => {
    st().startAlerts([message('a')])
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(shown()?.texts).toEqual(['Message a'])
    st().stopAlerts()
    expect(st().live.alert).toBeNull()
  })

  it('stops after the set number of loops', () => {
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, alertLoops: 2 } }))
    st().startAlerts([message('a'), message('b')])
    const duration = runDurationMs(['Message a', 'Message b'], 2, 'divider', 5, 14)
    vi.advanceTimersByTime(duration - 10)
    expect(st().live.alert).not.toBeNull()
    vi.advanceTimersByTime(20)
    expect(st().live.alert).toBeNull()
  })

  it('lets a priority message interrupt in its own color, then carries on where it was', () => {
    st().startAlerts([message('a')])
    vi.advanceTimersByTime(5000)
    st().interruptAlert(message('p', true))
    expect(shown()).toMatchObject({ texts: ['Message p'], priority: true, bandColor: PRIORITY_BAND_COLOR, loops: PRIORITY_PASSES })
    vi.advanceTimersByTime(Math.ceil(runDurationMs(['Message p'], PRIORITY_PASSES, 'divider', 5, 14)))
    const resumed = shown()
    expect(resumed).toMatchObject({ texts: ['Message a'], priority: false })
    // Scrolled 5 seconds before the interruption, so it picks up 5 seconds in (read here up to 1 ms after resuming).
    expect(Date.now() - (resumed?.startedAt ?? 0)).toBeGreaterThanOrEqual(5000)
    expect(Date.now() - (resumed?.startedAt ?? 0)).toBeLessThanOrEqual(5001)
  })

  it('stops after a priority message when nothing else was running', () => {
    st().interruptAlert(message('p', true))
    vi.advanceTimersByTime(runDurationMs(['Message p'], PRIORITY_PASSES, 'divider', 5, 14) + 1)
    expect(st().live.alert).toBeNull()
  })

  it('Next moves on to the next message, or ends a priority one early', () => {
    st().startAlerts([message('a'), message('b'), message('c')])
    st().nextAlert()
    expect(shown()?.texts).toEqual(['Message b', 'Message c', 'Message a'])
    st().interruptAlert(message('p', true))
    st().nextAlert()
    expect(shown()?.texts).toEqual(['Message b', 'Message c', 'Message a'])
  })

  it('Next with nothing running starts the saved messages, leaving priority ones out', () => {
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, alertMessages: [message('a'), message('p', true), message('b')] } }))
    st().nextAlert()
    expect(shown()?.texts).toEqual(['Message a', 'Message b'])
  })
})

// The alert band: it sits on the live output apart from the slides, queues behind the one on screen unless it is a
// priority, and times out, loops or holds.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlertMessage } from '../shared/types'

vi.stubGlobal('window', { api: { media: { getSlideBackgrounds: async () => ({}) } } })

const { selectAlertDisplay, selectOutputState, selectStageState, useOperatorStore } = await import('./store')

const message = (id: string, extra: Partial<AlertMessage> = {}): AlertMessage => ({
  id,
  text: `Message ${id}`,
  priority: false,
  repeat: 'hold',
  everySeconds: 60,
  ...extra,
})
const st = () => useOperatorStore.getState()
const shown = () => selectAlertDisplay(st())?.text ?? null

beforeEach(() => {
  vi.useFakeTimers()
  st().hideAlert()
  useOperatorStore.setState((s) => ({
    settings: { ...s.settings, alertSeconds: 10, alertKeepOnClear: true, alertPosition: 'bottom', alertMessages: [] },
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

describe('alerts', () => {
  it('stays up while slides change and go live', () => {
    st().goLive(0)
    st().showAlert(message('a'))
    st().nextSlide()
    st().goLive(1)
    st().goBack()
    expect(shown()).toBe('Message a')
    expect(selectOutputState(st()).alert).toMatchObject({ text: 'Message a', position: 'bottom', priority: false })
    expect(selectStageState(st()).alert?.text).toBe('Message a')
  })

  it('is hidden by Black, and kept by Clear unless the setting says otherwise', () => {
    st().showAlert(message('a'))
    st().setOutputMode('black')
    expect(shown()).toBeNull()
    st().setOutputMode('clear')
    expect(shown()).toBe('Message a')
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, alertKeepOnClear: false } }))
    expect(shown()).toBeNull()
    st().setOutputMode('show')
    expect(shown()).toBe('Message a')
  })

  it('queues behind the alert on screen, and a priority alert replaces it', () => {
    st().showAlert(message('a', { repeat: 'once' }))
    st().showAlert(message('b'))
    expect(shown()).toBe('Message a')
    expect(st().alertQueue.map((m) => m.id)).toEqual(['b'])
    st().showAlert(message('p', { priority: true }))
    expect(selectAlertDisplay(st())).toMatchObject({ text: 'Message p', priority: true })
    st().nextAlert()
    expect(shown()).toBe('Message b')
  })

  it('runs once for the set time, then the waiting alert takes over', () => {
    st().showAlert(message('a', { repeat: 'once' }))
    st().showAlert(message('b', { repeat: 'once' }))
    vi.advanceTimersByTime(10_000)
    expect(shown()).toBe('Message b')
    vi.advanceTimersByTime(10_000)
    expect(shown()).toBeNull()
  })

  it('loops every N seconds until hidden', () => {
    st().showAlert(message('a', { repeat: 'loop', everySeconds: 30 }))
    vi.advanceTimersByTime(10_000)
    expect(shown()).toBeNull()
    vi.advanceTimersByTime(20_000)
    expect(shown()).toBe('Message a')
    st().hideAlert()
    vi.advanceTimersByTime(60_000)
    expect(shown()).toBeNull()
  })

  it('Next moves through the saved list when nothing is waiting', () => {
    const saved = [message('a'), message('b')]
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, alertMessages: saved } }))
    st().showAlert(saved[0])
    st().nextAlert()
    expect(shown()).toBe('Message b')
    st().nextAlert()
    expect(shown()).toBe('Message a')
  })
})

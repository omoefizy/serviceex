// The light effects' clock: one loop sets every effect's time, no more than 60 times a second on a 120 Hz display,
// stops while the window is hidden and carries on from where it was, and lets go of an effect after its last pass.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { newEffect } from '../shared/designEffects'

let clock = 0
let frames: ((at: number) => void)[] = []
let visibility: 'visible' | 'hidden' = 'visible'
let onVisibility: (() => void) | undefined

vi.stubGlobal('performance', { now: () => clock })
vi.stubGlobal('requestAnimationFrame', (fn: (at: number) => void) => frames.push(fn))
// One frame is ever pending, so cancelling clears it.
vi.stubGlobal('cancelAnimationFrame', () => (frames = []))
vi.stubGlobal('document', {
  get visibilityState() {
    return visibility
  },
  addEventListener: (type: string, fn: () => void) => type === 'visibilitychange' && (onVisibility = fn),
})

const { driveEffect, effectClockStats } = await import('./lib/effectClock')

/** A display refreshing every `ms` for `forMs`. */
function run(ms: number, forMs: number) {
  for (const end = clock + forMs; clock < end; ) {
    clock += ms
    const due = frames
    frames = []
    due.forEach((fn) => fn(clock))
  }
}

const fakeAnimation = () => ({ currentTime: null as number | null, pause: vi.fn(), cancel: vi.fn() })

afterEach(() => {
  frames = []
})

describe('the effect clock', () => {
  it('ticks at most 60 times a second on a 120 Hz display', () => {
    const animation = fakeAnimation()
    const stop = driveEffect({ ...newEffect('lightSweep', 'a'), repeat: 0 }, [animation as unknown as Animation])
    expect(animation.pause).toHaveBeenCalled()
    const before = effectClockStats().ticks
    run(1000 / 120, 1000)
    const ticks = effectClockStats().ticks - before
    expect(ticks).toBeLessThanOrEqual(61)
    expect(ticks).toBeGreaterThanOrEqual(55)
    stop()
    expect(animation.cancel).toHaveBeenCalled()
    expect(effectClockStats().playing).toBe(0)
  })

  it('stops while the window is hidden and carries on where it was', () => {
    const animation = fakeAnimation()
    const stop = driveEffect({ ...newEffect('lightSweep', 'a'), durationMs: 10000, gapMs: 0, speed: 1, delayMs: 0, repeat: 0 }, [animation as unknown as Animation])
    run(1000 / 60, 1000)
    const at = animation.currentTime!
    expect(at).toBeGreaterThan(900)
    visibility = 'hidden'
    onVisibility?.()
    const ticks = effectClockStats().ticks
    run(1000 / 60, 5000)
    expect(effectClockStats().ticks).toBe(ticks)
    expect(effectClockStats().running).toBe(false)
    visibility = 'visible'
    onVisibility?.()
    run(1000 / 60, 100)
    expect(animation.currentTime! - at).toBeLessThan(200)
    stop()
  })

  it('lets go of an effect after its last pass, out of sight', () => {
    const animation = fakeAnimation()
    driveEffect({ ...newEffect('glowPulse', 'g'), durationMs: 500, gapMs: 0, delayMs: 0, repeat: 2, speed: 1 }, [animation as unknown as Animation])
    run(1000 / 60, 1200)
    expect(effectClockStats().playing).toBe(0)
    expect(animation.currentTime).toBe(501)
  })
})

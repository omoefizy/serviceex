// Live PowerPoint on macOS: Microsoft PowerPoint through AppleScript, one osascript run per command (about 0.2 s
// each; starting a show about 0.5 to 1 s). PowerPoint for Mac reports the slide but not the build step, so the
// step is counted here from the clicks the file says each slide has. A click that arrives while an effect is
// still playing only finishes that effect, so a click waits for the one before it (the script itself waits out
// transitions); that keeps one press one step. PowerPoint for Mac also cannot go to a slide inside a running
// show, so going to a slide starts the show again from that slide to the end.

import { existsSync } from 'node:fs'
import { AUTOMATION_SETTINGS_PATH, MAC_POWERPOINT } from '../engines'
import {
  nextShown,
  previousShown,
  run,
  type OpenOptions,
  type RunError,
  type ShowBounds,
  type ShowPosition,
  type SlideShowController,
  type StartOptions,
} from './controller'

const COMMAND_TIMEOUT_MS = 25_000

interface Deck extends OpenOptions {
  count: number
}

interface Show {
  copy: string
  bounds: ShowBounds
  useTimings: boolean
  /** The show runs from this slide to the end (see start). */
  rangeStart: number
  slide: number
  step: number
}

/** Explains an osascript failure, from the AppleScript error number in its message. */
function macError(error: RunError): Error {
  const code = /\((-?\d+)\)\s*$/.exec(error.stderr)?.[1]
  if (code === '-1743') {
    return new Error(`macOS did not allow ServiceEx to control Microsoft PowerPoint. Turn on PowerPoint under ServiceEx in ${AUTOMATION_SETTINGS_PATH}.`)
  }
  if (error.timedOut || code === '-1712') return new Error('PowerPoint did not answer. If it is showing a dialog (sign in, file access), answer it and try again.')
  if (code === '-600' || code === '-10810') return new Error('PowerPoint could not be started. Open it once by hand to finish its setup.')
  return new Error(`PowerPoint: ${error.stderr.replace(/^.*?execution error:\s*/s, '').replace(/\s*\(-?\d+\)\s*$/, '') || error.message}`)
}

export function createMacController(script: string): SlideShowController {
  const decks = new Map<string, Deck>()
  let show: Show | null = null
  /** Whether PowerPoint was running before the first open; dispose quits it only if not. */
  let wasRunning: boolean | null = null
  /** When the effects of the last click finish. */
  let busyUntil = 0

  const osa = (...args: (string | number)[]) =>
    run('osascript', [script, ...args.map(String)], COMMAND_TIMEOUT_MS).catch((error: RunError) => {
      throw macError(error)
    })

  /** Reads "<slide>|<state>|<left>,<top>,<width>,<height>"; null for "none". */
  function parse(result: string): { slide: number; frame: ShowPosition['frame'] } | null {
    if (result === 'none') return null
    const [slide, , frame] = result.split('|')
    const [x, y, width, height] = (frame ?? '').split(',').map(Number)
    return { slide: Number(slide), frame: [x, y, width, height].every(Number.isFinite) ? { x, y, width, height } : null }
  }

  function position(current: Show, frame: ShowPosition['frame']): ShowPosition {
    const steps = decks.get(current.copy)?.steps?.[current.slide - 1]
    return { slide: current.slide, step: steps === undefined ? null : current.step, steps: steps ?? null, frame }
  }

  /** Runs a show command; the show having ended (Esc in PowerPoint, or closed) is an error. */
  async function command(current: Show, name: string, ...args: (string | number)[]) {
    const result = parse(await osa(name, current.copy, ...args))
    if (!result || result.slide < 1) {
      show = null
      throw new Error('The PowerPoint slide show is no longer running.')
    }
    return result
  }

  async function start(copy: string, bounds: ShowBounds, options: StartOptions): Promise<ShowPosition> {
    if (!decks.has(copy)) throw new Error('The presentation is not open in PowerPoint.')
    const { x, y, width, height } = bounds
    show = null
    const current: Show = { copy, bounds, useTimings: options.useTimings, rangeStart: options.slide, slide: options.slide, step: 0 }
    const result = await command(current, 'start', options.slide, options.useTimings ? 1 : 0, x, y, width, height)
    current.slide = result.slide
    show = current
    return position(current, result.frame)
  }

  const running = () => {
    if (!show) throw new Error('No PowerPoint slide show is running.')
    return show
  }

  return {
    platform: 'mac',
    showMode: 'Full screen (speaker) show, a space of its own on the output display; PowerPoint is brought forward to show it, then the keyboard returns to ServiceEx',

    available: async () => existsSync(MAC_POWERPOINT),

    async open(copy, options) {
      wasRunning ??= (await osa('running')) === 'true'
      const count = Number(await osa('open', copy))
      decks.set(copy, { ...options, count })
    },

    async close(copy) {
      if (show?.copy === copy) show = null
      decks.delete(copy)
      await osa('close', copy)
    },

    start,

    goToRestarts: true,

    previousRestarts: () => show !== null && show.slide === show.rangeStart && show.step === 0,

    async goToSlide(slide) {
      const current = running()
      return start(current.copy, current.bounds, { slide, useTimings: current.useTimings })
    },

    async next() {
      const current = running()
      const deck = decks.get(current.copy)
      const steps = deck?.steps?.[current.slide - 1]
      // At the end of the last slide there is nothing to play; PowerPoint would show "End of slide show".
      if (deck && steps !== undefined && current.step >= steps && nextShown(current.slide, deck.count, deck.hidden) === null) {
        return position(current, null)
      }
      const wait = busyUntil - Date.now()
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      const result = await command(current, 'next')
      busyUntil = 0
      if (result.slide === current.slide) {
        current.step = steps === undefined ? current.step + 1 : Math.min(current.step + 1, steps)
        busyUntil = Date.now() + (deck?.clickMs?.[current.slide - 1]?.[current.step - 1] ?? 0)
      } else Object.assign(current, { slide: result.slide, step: 0 })
      return position(current, result.frame)
    },

    async previous() {
      const current = running()
      const deck = decks.get(current.copy)
      if (current.slide === current.rangeStart && current.step === 0) {
        // The show starts at this slide, so PowerPoint cannot go back: start it again from the slide before and
        // play that slide's clicks, so it shows fully built as PowerPoint's own Previous does.
        const before = previousShown(current.slide, deck?.hidden ?? [])
        if (before === null) return position(current, null)
        const restarted = await start(current.copy, current.bounds, { slide: before, useTimings: current.useTimings })
        const clicks = deck?.steps?.[before - 1] ?? 0
        if (clicks === 0 || !show) return restarted
        const built = await command(show, 'build', clicks)
        show.step = clicks
        return position(show, built.frame)
      }
      const result = await command(current, 'previous')
      if (result.slide === current.slide) current.step = Math.max(0, current.step - 1)
      else Object.assign(current, { slide: result.slide, step: deck?.steps?.[result.slide - 1] ?? 0 })
      return position(current, result.frame)
    },

    async pause() {
      if (show?.useTimings) await command(show, 'pause')
    },

    async resume() {
      if (show?.useTimings) await command(show, 'resume')
    },

    async end() {
      const current = show
      show = null
      if (current) await osa('end', current.copy)
    },

    async isRunning() {
      return show !== null && parse(await osa('position', show.copy)) !== null
    },

    async getCurrentSlide() {
      if (!show) return null
      const result = parse(await osa('position', show.copy))
      if (!result) {
        show = null
        return null
      }
      // Slide timings (or a click in PowerPoint) may have moved it on.
      if (result.slide !== show.slide) Object.assign(show, { slide: result.slide, step: 0 })
      return position(show, result.frame)
    },

    async dispose() {
      show = null
      for (const copy of [...decks.keys()]) {
        decks.delete(copy)
        await osa('close', copy).catch(console.error)
      }
      // The script quits only when no other presentation is open, so nothing the operator has open is lost.
      if (wasRunning === false) await osa('quit').catch(console.error)
    },
  }
}

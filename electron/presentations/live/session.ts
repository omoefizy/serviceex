// The Live PowerPoint session: keeps private copies of presentations open in PowerPoint, and makes the slide show
// follow what the operator window asks for (a PowerPointTarget). The output window steps aside (hidden, not
// destroyed) while the show is seen and comes back on top, at once, for anything else; the show waits under it.
// Nothing here touches Electron: the window handoff comes in as callbacks.

import { randomBytes } from 'node:crypto'
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import type { LivePowerPointStatus, LivePowerPointTestResult, LivePowerPointTestStep, PowerPointTarget } from '../../../shared/types'
import { readPptx } from '../pptx'
import type { OpenOptions, ShowBounds, ShowPosition, SlideShowController } from './controller'
import { SAMPLE_STEPS, writeAnimatedSample } from './sampleDeck'

/** Going live must reach the screen within this, or the still slide shows instead. */
export const START_LIMIT_MS = 8000
/** How often a showing slide show is checked: closed in PowerPoint, or moved on by its slide timings. */
const WATCH_MS = 2000

export interface LiveSource {
  sourcePath: string
  kind: string
  useTimings: boolean
}

export interface SessionOptions {
  controller: SlideShowController
  /** The original of a library presentation, or null when it is gone. */
  lookup(id: number): LiveSource | null
  /** Where the private copies go. */
  copyDir: string
  /** Where the show goes: the output window's bounds. Null when the output is closed. */
  outputBounds(): ShowBounds | null
  /** Describes the display under `bounds`, for Diagnostics. */
  describeDisplay(bounds: ShowBounds): string
  /** Hides the output window so the show is seen. */
  stepAside(): void
  /** Brings the output window back on top, at once. */
  restore(): void
  /** Gives the keyboard back to the operator window, in case PowerPoint took it. */
  refocus(): void
  onStatus(status: LivePowerPointStatus): void
  /** A show started or ended, for the panic shortcut. */
  onShowRunning(running: boolean): void
}

/** A copy open in PowerPoint. */
interface Prepared {
  copy: string
  /** Opened, or failed to open. */
  ready: Promise<void>
  /** PowerPoint's slide number for each shown slide, in order (hidden slides are not in the slide list). */
  shown: number[]
  /** The original was saved since this copy was made. */
  stale: boolean
}

interface Running {
  presentationId: number
  generation: number
  /** The target cue the show was last moved for; see PowerPointTarget. */
  cue: number
  position: ShowPosition
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export class LivePowerPointSession {
  private readonly options: SessionOptions
  private readonly prepared = new Map<number, Prepared>()
  /**
   * Show commands (start, move, next, end) run one at a time, in order. Opening and closing copies do not wait
   * in it: they touch no running show, and PowerPoint takes one command at a time anyway.
   */
  private queue: Promise<unknown> = Promise.resolve()
  private desired: PowerPointTarget | null = null
  private running: Running | null = null
  private steppedAside = false
  private status: LivePowerPointStatus = { phase: 'idle', presentationId: null, slideIndex: null, step: null, steps: null, message: null, failures: 0 }
  /** The go-live being waited for, with its 8 second clock. */
  private pending: { key: string; timer: ReturnType<typeof setTimeout> } | null = null
  private watch: ReturnType<typeof setInterval> | null = null
  private closed = false
  /**
   * Other PowerPoint work running now (converting a saved original, opening or closing a copy). PowerPoint's
   * document windows can come up over the show, so that work waits until the output covers the show, and the show
   * is not uncovered until it is done.
   */
  private otherWork = 0
  private coverWaiters: (() => void)[] = []
  private idleWaiters: (() => void)[] = []
  /** Other work ran while a show waited under the output; on macOS it must start again to come back in front. */
  private needsRestart = false

  constructor(options: SessionOptions) {
    this.options = options
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task)
    this.queue = result.catch(() => undefined)
    return result
  }

  private setStatus(patch: Partial<LivePowerPointStatus>): void {
    this.status = { ...this.status, ...patch }
    this.options.onStatus(this.status)
  }

  getStatus(): LivePowerPointStatus {
    return this.status
  }

  /** Copies the original and opens the copy in PowerPoint, in the background. Again for a stale copy. */
  prepare(presentationId: number): Promise<Prepared> {
    const existing = this.prepared.get(presentationId)
    if (existing && !existing.stale) return existing.ready.then(() => existing)
    // A stale copy that is on screen stays until Resend (a new generation) replaces it.
    if (existing && this.running?.presentationId === presentationId) return existing.ready.then(() => existing)
    const source = this.options.lookup(presentationId)
    if (!source) return Promise.reject(new Error('That presentation is no longer in the library.'))
    if (source.kind !== 'pptx' && source.kind !== 'ppt') return Promise.reject(new Error('Only PowerPoint files play in PowerPoint.'))

    const entry: Prepared = { copy: '', ready: Promise.resolve(), shown: [], stale: false }
    entry.ready = (async () => {
      if (existing) await this.discard(presentationId, existing)
      await mkdir(this.options.copyDir, { recursive: true })
      // A new name each time: PowerPoint will not open two files with the same name.
      const copy = path.join(this.options.copyDir, `WorshipDeck ${presentationId}-${randomBytes(3).toString('hex')}${path.extname(source.sourcePath)}`)
      await copyFile(source.sourcePath, copy)
      entry.copy = copy
      const open: OpenOptions = { steps: null, clickMs: null, hidden: [] }
      if (source.kind === 'pptx') {
        try {
          const slides = readPptx(new Uint8Array(await readFile(copy)))
          open.steps = slides.map((slide) => slide.steps)
          open.clickMs = slides.map((slide) => slide.clickMs)
          open.hidden = slides.flatMap((slide, index) => (slide.hidden ? [index + 1] : []))
          entry.shown = slides.flatMap((slide, index) => (slide.hidden ? [] : [index + 1]))
        } catch (error) {
          console.error('Live PowerPoint could not read the slides:', error)
        }
      }
      await this.whileCovered(() => this.options.controller.open(copy, open))
      // Opening may bring PowerPoint to the front, the first time especially.
      this.options.refocus()
    })()
    this.prepared.set(presentationId, entry)
    entry.ready.catch((error) => {
      if (this.prepared.get(presentationId) === entry) this.prepared.delete(presentationId)
      if (entry.copy) rm(entry.copy, { force: true }).catch(() => undefined)
      console.error('Live PowerPoint could not prepare a presentation:', error)
    })
    return entry.ready.then(() => entry)
  }

  /** Prepares these in the background; failures are logged and retried when one goes live. */
  prepareAll(presentationIds: number[]): void {
    for (const id of presentationIds) this.prepare(id).catch(() => undefined)
  }

  /** The original was saved: its copy is out of date. Not on screen, it is replaced now; on screen, on Resend. */
  sourceUpdated(presentationId: number): void {
    const entry = this.prepared.get(presentationId)
    if (!entry) return
    entry.stale = true
    if (this.running?.presentationId !== presentationId) this.prepare(presentationId).catch(() => undefined)
  }

  private async discard(presentationId: number, entry: Prepared): Promise<void> {
    if (this.prepared.get(presentationId) === entry) this.prepared.delete(presentationId)
    if (!entry.copy) return
    await this.whileCovered(() => this.options.controller.close(entry.copy)).catch(console.error)
    await rm(entry.copy, { force: true }).catch(() => undefined)
  }

  /** Index into the shown slides for PowerPoint's slide number, and back. */
  private toIndex(entry: Prepared, slide: number): number {
    if (entry.shown.length === 0) return slide - 1
    const index = entry.shown.indexOf(slide)
    return index === -1 ? Math.max(0, entry.shown.findIndex((n) => n > slide) - 1) : index
  }

  private toSlide(entry: Prepared, index: number): number {
    return entry.shown.length === 0 ? index + 1 : (entry.shown[index] ?? entry.shown[entry.shown.length - 1] ?? 1)
  }

  /** Brings the output back on top, now. The show stays where it is, under it. */
  private cover(): void {
    if (this.steppedAside) {
      this.steppedAside = false
      this.options.restore()
    }
    this.stopWatching()
    for (const resolve of this.coverWaiters.splice(0)) resolve()
  }

  /** Runs other PowerPoint work once the show is covered (at once if it is); the show stays covered until it ends. */
  async whileCovered<T>(task: () => Promise<T>): Promise<T> {
    while (this.steppedAside) await new Promise<void>((resolve) => this.coverWaiters.push(resolve))
    this.otherWork++
    try {
      return await task()
    } finally {
      this.otherWork--
      if (this.running && this.options.controller.goToRestarts) this.needsRestart = true
      if (this.otherWork === 0) for (const resolve of this.idleWaiters.splice(0)) resolve()
    }
  }

  private reveal(): void {
    if (!this.steppedAside) {
      this.steppedAside = true
      this.options.stepAside()
    }
    this.options.refocus()
    this.startWatching()
  }

  /** What the operator window wants. Covering happens at once; starting and moving the show run in order. */
  sync(target: PowerPointTarget | null): void {
    if (this.closed) return
    const previous = this.desired
    this.desired = target
    if (!target?.visible) this.cover()
    if (target?.visible) {
      const key = `${target.presentationId}:${target.generation}:${target.cue}`
      const moved = !previous || !previous.visible || `${previous.presentationId}:${previous.generation}:${previous.cue}` !== key
      if (moved && this.pending?.key !== key) {
        if (this.pending) clearTimeout(this.pending.timer)
        // The clock runs from the request, so waiting behind a slow first start of PowerPoint counts too.
        this.pending = { key, timer: setTimeout(() => this.fail(`PowerPoint took longer than ${START_LIMIT_MS / 1000} seconds to start the slide show.`, key), START_LIMIT_MS) }
      }
    } else if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending = null
    }
    this.enqueue(() => this.apply()).catch((error) => this.fail(message(error)))
  }

  private async apply(): Promise<void> {
    const target = this.desired
    if (!target || !target.visible) {
      if (this.running) {
        await this.options.controller.pause().catch(() => undefined)
        this.setStatus({ phase: 'covered' })
      } else if (this.status.phase !== 'failed') this.setStatus({ phase: 'idle' })
      return
    }
    const key = `${target.presentationId}:${target.generation}:${target.cue}`
    const bounds = this.options.outputBounds()
    if (!bounds) throw new Error('The output is closed, so there is nowhere to play the slide show.')

    const current = this.running
    const sameShow = current && current.presentationId === target.presentationId && current.generation === target.generation
    let entry = this.prepared.get(target.presentationId)
    if (sameShow && entry) {
      // A new cue moves the show only when it asks for another slide; the same slide keeps its build step.
      const slide = this.toSlide(entry, target.slideIndex)
      const move = current.cue !== target.cue && slide !== current.position.slide
      if (move || this.needsRestart) {
        this.setStatus({ phase: 'starting', presentationId: target.presentationId })
        if (this.options.controller.goToRestarts) this.cover()
        current.position = await this.options.controller.goToSlide(move ? slide : current.position.slide)
        this.needsRestart = false
      } else await this.options.controller.resume().catch(() => undefined)
      current.cue = target.cue
    } else {
      this.setStatus({ phase: 'starting', presentationId: target.presentationId, message: null })
      // The still slide covers the gap while one show ends and the next starts.
      this.cover()
      if (current) await this.endShow()
      // Resend (a new generation) takes a fresh copy of the original.
      if (entry && current?.presentationId === target.presentationId && entry.stale) await this.discard(target.presentationId, entry)
      entry = await this.prepare(target.presentationId)
      const source = this.options.lookup(target.presentationId)
      const position = await this.options.controller.start(entry.copy, bounds, { slide: this.toSlide(entry, target.slideIndex), useTimings: source?.useTimings ?? false })
      this.running = { presentationId: target.presentationId, generation: target.generation, cue: target.cue, position }
      this.needsRestart = false
      this.options.onShowRunning(true)
    }

    // Not over PowerPoint's own windows: wait for other work (a conversion, say) to finish first.
    if (this.otherWork > 0) {
      while (this.otherWork > 0) await new Promise<void>((resolve) => this.idleWaiters.push(resolve))
      // The show has to start again to come back in front; this runs again for that.
      if (this.needsRestart) {
        this.enqueue(() => this.apply()).catch((error) => this.fail(message(error)))
        return
      }
    }
    // Too late (the clock ran out) or no longer wanted: leave it covered.
    if (this.desired?.visible !== true || `${this.desired.presentationId}:${this.desired.generation}:${this.desired.cue}` !== key) return
    if (this.status.phase === 'failed' && this.pending?.key !== key) return
    if (this.pending?.key === key) {
      clearTimeout(this.pending.timer)
      this.pending = null
    }
    this.reveal()
    this.report('showing')
  }

  private report(phase: LivePowerPointStatus['phase']): void {
    const running = this.running
    const entry = running && this.prepared.get(running.presentationId)
    if (!running || !entry) return
    this.setStatus({
      phase,
      presentationId: running.presentationId,
      slideIndex: this.toIndex(entry, running.position.slide),
      step: running.position.step,
      steps: running.position.steps,
      message: null,
    })
  }

  /** Right arrow or Next: the next build step, then the next slide. */
  next(): Promise<void> {
    return this.step((controller) => controller.next())
  }

  previous(): Promise<void> {
    return this.step((controller) => controller.previous(), (controller) => controller.previousRestarts())
  }

  private step(move: (controller: SlideShowController) => Promise<ShowPosition>, restarts?: (controller: SlideShowController) => boolean): Promise<void> {
    return this.enqueue(async () => {
      if (!this.running) return
      const shown = this.steppedAside
      if (shown && restarts?.(this.options.controller)) this.cover()
      this.running.position = await move(this.options.controller)
      if (shown && this.desired?.visible) this.reveal()
      this.report(this.steppedAside ? 'showing' : 'covered')
    }).catch((error) => this.fail(message(error)))
  }

  /** The show cannot carry on: the output comes back with the still slide, and the operator is told why. */
  private fail(text: string, key?: string): void {
    if (key && this.pending?.key !== key) return
    if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending = null
    }
    this.cover()
    this.setStatus({ phase: 'failed', message: `${text} Showing the still slide.`, failures: this.status.failures + 1 })
    this.enqueue(() => this.endShow()).catch(console.error)
  }

  /** The panic shortcut: ends the show and brings the output back. */
  panic(): void {
    if (!this.running && !this.steppedAside && this.status.phase !== 'starting') return
    this.desired = null
    if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending = null
    }
    this.cover()
    this.setStatus({ phase: 'failed', message: 'Slide show ended (Ctrl+Shift+K / Cmd+Shift+K). Showing the still slide.', failures: this.status.failures + 1 })
    this.enqueue(() => this.endShow()).catch(console.error)
  }

  private async endShow(): Promise<void> {
    if (!this.running) return
    this.running = null
    this.options.onShowRunning(false)
    await this.options.controller.end().catch(console.error)
  }

  private startWatching(): void {
    this.watch ??= setInterval(() => {
      this.enqueue(async () => {
        if (!this.running || !this.steppedAside) return
        const position = await this.options.controller.getCurrentSlide()
        if (!position) throw new Error('The slide show was closed in PowerPoint.')
        if (position.slide !== this.running.position.slide) {
          this.running.position = position
          this.report('showing')
        }
      }).catch((error) => this.fail(message(error)))
    }, WATCH_MS)
  }

  private stopWatching(): void {
    if (this.watch) clearInterval(this.watch)
    this.watch = null
  }

  /** Plays the generated sample deck over the output and times each step. Refuses while a live show runs. */
  async test(): Promise<LivePowerPointTestResult> {
    const { controller } = this.options
    if (this.running || this.desired?.visible) throw new Error('A slide show is live. End it (or send something else) before testing.')
    const bounds = this.options.outputBounds()
    if (!bounds) throw new Error('Open the output first: the test plays on it.')
    const steps: LivePowerPointTestStep[] = []
    const began = Date.now()
    const step = async <T>(label: string, task: () => Promise<T>, detail: (value: T) => string = () => ''): Promise<T> => {
      const started = Date.now()
      try {
        const value = await task()
        steps.push({ label, ms: Date.now() - started, ok: true, detail: detail(value) })
        return value
      } catch (error) {
        steps.push({ label, ms: Date.now() - started, ok: false, detail: message(error) })
        throw error
      }
    }
    const where = (p: ShowPosition) => `Slide ${p.slide}${p.steps ? `, step ${p.step ?? '?'} of ${p.steps}` : ''}`
    /** A move that must land on `slide`; anywhere else fails the step. */
    const move = (label: string, task: () => Promise<ShowPosition>, slide: number) =>
      step(label, async () => {
        const p = await task()
        if (p.slide !== slide) throw new Error(`${where(p)}, expected slide ${slide}`)
        return p
      }, where)
    const pause = () => new Promise((resolve) => setTimeout(resolve, 700))
    const copy = path.join(this.options.copyDir, `WorshipDeck test-${randomBytes(3).toString('hex')}.pptx`)
    let opened = false
    let ok = false
    try {
      await this.enqueue(async () => {
        await step('PowerPoint installed', async () => {
          if (!(await controller.available())) throw new Error('Microsoft PowerPoint is not installed')
        }, () => 'Found')
        await mkdir(this.options.copyDir, { recursive: true })
        await step('Generate the sample deck', () => writeAnimatedSample(copy), () => `3 slides, ${SAMPLE_STEPS.join(' + ')} clicks`)
        await step('Open the copy in PowerPoint', () => controller.open(copy, { steps: SAMPLE_STEPS, clickMs: SAMPLE_STEPS.map((n) => Array<number>(n).fill(500)), hidden: [] }))
        opened = true
        const started = await step('Start the slide show on the output', () => controller.start(copy, bounds, { slide: 1, useTimings: false }), (p) => {
          const rect = (r: { x: number; y: number; width: number; height: number }) => `${Math.round(r.x)}, ${Math.round(r.y)}, ${Math.round(r.width)} × ${Math.round(r.height)}`
          const same = p.frame && [p.frame.x - bounds.x, p.frame.y - bounds.y, p.frame.width - bounds.width, p.frame.height - bounds.height].every((d) => Math.abs(d) <= 2)
          // What PowerPoint reports; whether it is really there is for the eye on the output.
          return `${where(p)}. PowerPoint reports the show at ${p.frame ? rect(p.frame) : 'an unknown place'}${same ? ', the bounds asked for' : `; asked for ${rect(bounds)}`}`
        })
        this.reveal()
        this.options.onShowRunning(true)
        if (started.slide !== 1) throw new Error(`The show started on slide ${started.slide}`)
        // Every click of every slide, in order: the slide each one should land on.
        const landings = SAMPLE_STEPS.flatMap((clicks, index) => [...(index > 0 ? [index + 1] : []), ...Array<number>(clicks).fill(index + 1)])
        for (const slide of landings) {
          await pause()
          await move('Next', () => controller.next(), slide)
        }
        const last = SAMPLE_STEPS.length
        await pause()
        await move('Next at the end (stays on the last slide)', () => controller.next(), last)
        await pause()
        await move('Previous (the slide before, fully built)', () => controller.previous(), last - 1)
        await pause()
        await move('Go to slide 1', () => controller.goToSlide(1), 1)
        await pause()
        await step('End the slide show', () => controller.end())
        ok = steps.every((s) => s.ok)
      })
    } catch (error) {
      // A failed step is already in the list; anything else is added.
      if (steps.at(-1)?.ok !== false) steps.push({ label: 'Test', ms: 0, ok: false, detail: message(error) })
    } finally {
      this.cover()
      this.options.onShowRunning(false)
      await this.enqueue(async () => {
        await controller.end().catch(() => undefined)
        if (opened) await controller.close(copy).catch(() => undefined)
      })
      await rm(copy, { force: true }).catch(() => undefined)
    }
    return { ok, display: this.options.describeDisplay(bounds), mode: controller.showMode, steps, totalMs: Date.now() - began }
  }

  /** Ends the show, closes every copy and quits PowerPoint if this started it. The session can start again. */
  async stop(): Promise<void> {
    this.desired = null
    if (this.pending) clearTimeout(this.pending.timer)
    this.pending = null
    this.cover()
    const copies = [...this.prepared.values()]
    this.prepared.clear()
    await this.enqueue(async () => {
      if (this.running) {
        this.running = null
        this.options.onShowRunning(false)
      }
      await this.options.controller.dispose()
    }).catch(console.error)
    for (const entry of copies) if (entry.copy) await rm(entry.copy, { force: true }).catch(() => undefined)
    this.setStatus({ phase: 'idle', presentationId: null, slideIndex: null, step: null, steps: null, message: null })
  }

  /** For quitting: stop(), and nothing starts again. */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.stop()
  }
}

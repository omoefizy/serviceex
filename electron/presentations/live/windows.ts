// Live PowerPoint on Windows: desktop PowerPoint through COM, from one long-lived PowerShell process
// (resources/powerpoint-live.ps1) that takes a JSON command per line, so each command costs no PowerShell start.
// NOT YET TESTED ON WINDOWS. PowerPoint reports the build step itself (GetClickIndex and GetClickCount).

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { run, type ShowBounds, type ShowPosition, type SlideShowController } from './controller'

const COMMAND_TIMEOUT_MS = 25_000
/** PowerPoint places slide show windows in points, 72 to the inch; Electron uses 96 to the inch. */
const POINTS_PER_DIP = 0.75

interface ShowState {
  slide: number
  state: number
  step: number | null
  steps: number | null
  frame: { x: number; y: number; width: number; height: number }
}

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

let installed: Promise<boolean> | null = null

export function createWindowsController(script: string): SlideShowController {
  let child: ChildProcessWithoutNullStreams | null = null
  let nextId = 1
  const pending = new Map<number, Pending>()
  let show: { copy: string; bounds: ShowBounds; useTimings: boolean } | null = null
  const decks = new Set<string>()

  function failAll(error: Error) {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer)
      pending.delete(id)
      entry.reject(error)
    }
  }

  function helper(): ChildProcessWithoutNullStreams {
    if (child) return child
    const started = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true })
    child = started
    let stderr = ''
    started.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-2000)
    })
    createInterface({ input: started.stdout }).on('line', (line) => {
      let answer: { id: number; ok: boolean; result?: unknown; error?: string }
      try {
        answer = JSON.parse(line.replace(/^\uFEFF/, ''))
      } catch {
        return
      }
      const entry = pending.get(answer.id)
      if (!entry) return
      clearTimeout(entry.timer)
      pending.delete(answer.id)
      if (answer.ok) entry.resolve(answer.result ?? null)
      else entry.reject(new Error(`PowerPoint: ${answer.error ?? 'unknown error'}`))
    })
    started.on('exit', () => {
      if (child === started) child = null
      // PowerPoint's copies and shows went with the process's COM connection, as far as this side knows.
      decks.clear()
      show = null
      failAll(new Error(`PowerPoint's helper stopped${stderr.trim() ? `: ${stderr.trim().split('\n')[0]}` : ''}`))
    })
    started.on('error', (error) => failAll(error))
    return started
  }

  function send<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
    const id = nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('PowerPoint did not answer within 25 seconds. If it is showing a dialog, answer it and try again.'))
      }, COMMAND_TIMEOUT_MS)
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      helper().stdin.write(`${JSON.stringify({ id, cmd, ...args })}\n`)
    })
  }

  const toPosition = (state: ShowState): ShowPosition => ({
    slide: state.slide,
    step: state.step,
    steps: state.steps,
    frame: state.frame && {
      x: state.frame.x / POINTS_PER_DIP,
      y: state.frame.y / POINTS_PER_DIP,
      width: state.frame.width / POINTS_PER_DIP,
      height: state.frame.height / POINTS_PER_DIP,
    },
  })

  async function showCommand(cmd: string, args: Record<string, unknown> = {}): Promise<ShowPosition> {
    if (!show) throw new Error('No PowerPoint slide show is running.')
    const state = await send<ShowState | null>(cmd, { copy: show.copy, ...args })
    if (!state || state.slide < 1) {
      show = null
      throw new Error('The PowerPoint slide show is no longer running.')
    }
    return toPosition(state)
  }

  return {
    platform: 'windows',
    showMode: 'Full screen (speaker) show moved onto the output bounds, borderless (untested)',

    available() {
      // Desktop PowerPoint registers PowerPoint.Application for COM; the Store and web versions do not.
      installed ??= run('reg', ['query', 'HKCR\\PowerPoint.Application\\CurVer'], 10_000).then(
        () => true,
        () => false,
      )
      return installed
    },

    async open(copy) {
      await send('open', { copy })
      decks.add(copy)
    },

    async close(copy) {
      if (show?.copy === copy) show = null
      decks.delete(copy)
      await send('close', { copy })
    },

    async start(copy, bounds, options) {
      if (!decks.has(copy)) throw new Error('The presentation is not open in PowerPoint.')
      show = { copy, bounds, useTimings: options.useTimings }
      return showCommand('start', {
        slide: options.slide,
        useTimings: options.useTimings,
        x: bounds.x * POINTS_PER_DIP,
        y: bounds.y * POINTS_PER_DIP,
        width: bounds.width * POINTS_PER_DIP,
        height: bounds.height * POINTS_PER_DIP,
      })
    },

    goToRestarts: false,
    previousRestarts: () => false,
    goToSlide: (slide) => showCommand('goto', { slide }),
    next: () => showCommand('next'),
    previous: () => showCommand('previous'),

    async pause() {
      if (show?.useTimings) await showCommand('pause')
    },

    async resume() {
      if (show?.useTimings) await showCommand('resume')
    },

    async end() {
      const current = show
      show = null
      if (current) await send('end', { copy: current.copy })
    },

    async isRunning() {
      return show !== null && (await send<ShowState | null>('position', { copy: show.copy })) !== null
    },

    async getCurrentSlide() {
      if (!show) return null
      const state = await send<ShowState | null>('position', { copy: show.copy })
      if (!state || state.slide < 1) {
        show = null
        return null
      }
      return toPosition(state)
    },

    async dispose() {
      show = null
      decks.clear()
      if (!child) return
      await send('dispose').catch(console.error)
      child?.stdin.end()
    },
  }
}

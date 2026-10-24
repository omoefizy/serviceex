import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron'
import { mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { LivePowerPointStatus, PowerPointTarget } from '../../shared/types'
import { presentationStore } from '../db/presentations'
import { getAppSettings } from '../db/settings'
import { MAC_POWERPOINT_TMP } from '../presentations/engines'
import { createSlideShowController, type ShowBounds } from '../presentations/live/controller'
import { LivePowerPointSession } from '../presentations/live/session'

/** Ends the slide show and brings the output back, from anywhere, even while PowerPoint has the keyboard. */
export const PANIC_SHORTCUT = 'CommandOrControl+Shift+K'

interface Options {
  getOutputWindow(): BrowserWindow | null
  getOperatorWindow(): BrowserWindow | null
  /** Whether the output window stays on top of other windows when no slide show is running. */
  outputKeepsOnTop(): boolean
  /** Where the bundled AppleScript and PowerShell files are. */
  resourcesDir: string
}

export interface LivePowerPoint {
  /** A linked original was saved; its PowerPoint copy is replaced (at once, or on Resend if it is live). */
  sourceUpdated(presentationId: number): void
  /** Runs other PowerPoint work (a conversion) only while the slide show is covered by the output. */
  whileShowCovered<T>(task: () => Promise<T>): Promise<T>
  /** Live PowerPoint was turned off, or the operator window closed. */
  stop(): Promise<void>
  /** For quitting. */
  close(): Promise<void>
}

const NOT_AVAILABLE = 'Live PowerPoint needs desktop Microsoft PowerPoint on macOS or Windows.'

function assertTarget(value: unknown): PowerPointTarget | null {
  if (value === null) return null
  const t = value as Partial<PowerPointTarget> | null
  const whole = (v: unknown) => Number.isInteger(v) && (v as number) >= 0
  if (typeof t !== 'object' || t === null || !whole(t.presentationId) || !whole(t.slideIndex) || !whole(t.generation) || !whole(t.cue) || typeof t.visible !== 'boolean') {
    throw new TypeError('A Live PowerPoint target needs a presentation, a slide, a generation, a cue and visible')
  }
  return { presentationId: t.presentationId!, slideIndex: t.slideIndex!, visible: t.visible, generation: t.generation!, cue: t.cue! }
}

/** Registers the Live PowerPoint IPC: the slide show controller and the handoff with the output window. */
export function registerLivePowerPointIpc({ getOutputWindow, getOperatorWindow, outputKeepsOnTop, resourcesDir }: Options): LivePowerPoint {
  const controller = createSlideShowController((name) => path.join(resourcesDir, name))
  // PowerPoint for Mac is sandboxed; copies inside its own container open without a "Grant File Access" prompt.
  const copyDir = path.join(process.platform === 'darwin' ? MAC_POWERPOINT_TMP : os.tmpdir(), 'WorshipDeck-live')
  // Copies left by a session that did not end cleanly.
  rm(copyDir, { recursive: true, force: true })
    .then(() => mkdir(copyDir, { recursive: true }))
    .catch(() => undefined)

  const sendStatus = (status: LivePowerPointStatus) => {
    const win = getOperatorWindow()
    if (win && !win.isDestroyed()) win.webContents.send('livePowerPoint:status', status)
  }

  // When a WorshipDeck window last lost the keyboard; PowerPoint taking it just now is given back.
  let blurredAt = 0
  app.on('browser-window-blur', () => {
    blurredAt = Date.now()
  })

  const session =
    controller &&
    new LivePowerPointSession({
      controller,
      copyDir,
      lookup(id) {
        const record = presentationStore.get(id)
        return record ? { sourcePath: record.sourcePath, kind: record.kind, useTimings: record.useTimings === true } : null
      },
      outputBounds(): ShowBounds | null {
        const output = getOutputWindow()
        if (!output || output.isDestroyed()) return null
        const bounds = output.getBounds()
        const display = screen.getDisplayMatching(bounds)
        // On macOS the full screen show always fills the display the output is on, whatever the output's own size.
        const { x, y, width, height } = process.platform === 'darwin' ? display.bounds : bounds
        return { x, y, width, height, scaleFactor: display.scaleFactor }
      },
      describeDisplay(bounds) {
        const display = screen.getDisplayMatching(bounds)
        const name = display.label || `Display ${display.id}`
        const primary = display.id === screen.getPrimaryDisplay().id ? ', primary' : ''
        const { x, y, width, height } = display.bounds
        return `${name} (${width} × ${height} at ${x}, ${y}, scale ${display.scaleFactor}${primary}); output at ${bounds.x}, ${bounds.y}, ${bounds.width} × ${bounds.height}`
      },
      stepAside() {
        const output = getOutputWindow()
        if (output && !output.isDestroyed()) output.hide()
      },
      restore() {
        const output = getOutputWindow()
        if (!output || output.isDestroyed()) return
        // Above PowerPoint's full screen show on both platforms (on macOS, in front of full screen spaces too),
        // without taking the keyboard from the operator window.
        output.setAlwaysOnTop(true, 'screen-saver')
        if (process.platform === 'darwin') output.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
        output.showInactive()
        output.moveTop()
      },
      refocus() {
        const operator = getOperatorWindow()
        const output = getOutputWindow()
        if (!operator || operator.isDestroyed() || BrowserWindow.getFocusedWindow() || Date.now() - blurredAt > 15_000) return
        // On macOS the show is a full screen space; with the output on the operator's own display (a window, to try
        // it out), taking the keyboard back would switch that display away from the show, so PowerPoint keeps it.
        if (process.platform === 'darwin' && output && !output.isDestroyed()) {
          if (screen.getDisplayMatching(output.getBounds()).id === screen.getDisplayMatching(operator.getBounds()).id) return
        }
        if (process.platform === 'darwin') app.focus({ steal: true })
        operator.focus()
      },
      onStatus: sendStatus,
      onShowRunning(running) {
        if (running) {
          if (!globalShortcut.isRegistered(PANIC_SHORTCUT)) globalShortcut.register(PANIC_SHORTCUT, () => session?.panic())
          return
        }
        globalShortcut.unregister(PANIC_SHORTCUT)
        // Back to an ordinary window, unless it is the output on a display of its own (see main.ts).
        const output = getOutputWindow()
        if (output && !output.isDestroyed() && !outputKeepsOnTop()) {
          output.setAlwaysOnTop(false)
          if (process.platform === 'darwin') output.setVisibleOnAllWorkspaces(false)
        }
      },
    })

  const enabled = () => getAppSettings().presentationLivePowerPoint

  ipcMain.on('livePowerPoint:prepare', (_event, ids: unknown) => {
    if (!session || !enabled() || !Array.isArray(ids)) return
    // Only PowerPoint files with animated slides, and with Live PowerPoint left on for them.
    const wanted = ids.filter((id): id is number => {
      const record = Number.isInteger(id) ? presentationStore.get(id as number) : undefined
      return !!record && (record.kind === 'pptx' || record.kind === 'ppt') && record.livePowerPoint !== false && record.slides.some((slide) => slide.animated)
    })
    session.prepareAll(wanted.slice(0, 20))
  })

  ipcMain.on('livePowerPoint:sync', (_event, value: unknown) => {
    let target: PowerPointTarget | null
    try {
      target = assertTarget(value)
    } catch (error) {
      console.error(error)
      return
    }
    if (!session) {
      if (target?.visible) {
        sendStatus({ phase: 'failed', presentationId: target.presentationId, slideIndex: null, step: null, steps: null, message: `${NOT_AVAILABLE} Showing the still slide.`, failures: Date.now() })
      }
      return
    }
    session.sync(enabled() ? target : null)
  })

  ipcMain.handle('livePowerPoint:next', () => session?.next())
  ipcMain.handle('livePowerPoint:previous', () => session?.previous())
  ipcMain.on('livePowerPoint:panic', () => session?.panic())
  ipcMain.handle('livePowerPoint:test', async () => {
    if (!session || !controller) throw new Error(NOT_AVAILABLE)
    return session.test()
  })

  return {
    sourceUpdated: (id) => session?.sourceUpdated(id),
    whileShowCovered: (task) => (session ? session.whileCovered(task) : task()),
    stop: async () => {
      await session?.stop()
    },
    close: async () => {
      globalShortcut.unregister(PANIC_SHORTCUT)
      await session?.close()
    },
  }
}

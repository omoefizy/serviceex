import { BrowserWindow, ipcMain } from 'electron'
import { requireFeature } from '../../shared/features'
import { sanitizeRichFor } from '../../shared/richText'
import type { OutputMode, SlideContent, StageState } from '../../shared/types'
import { alertDisplayOf } from './output'

const MODES: OutputMode[] = ['show', 'black', 'clear', 'logo']

let lastState: StageState = { current: null, next: null, title: null, nextItemTitle: null, mode: 'show', alert: null }

function slideOf(value: unknown): SlideContent | null {
  const slide = value as Partial<SlideContent> | null
  if (slide === null) return null
  if (typeof slide !== 'object' || typeof slide.text !== 'string' || typeof slide.caption !== 'string') {
    throw new TypeError('A stage slide needs text and a caption')
  }
  return { text: slide.text, caption: slide.caption, rich: sanitizeRichFor(slide.rich, slide.text) ?? null }
}

const textOrNull = (value: unknown) => (typeof value === 'string' ? value : null)

function assertStageState(value: unknown): StageState {
  const state = value as Partial<StageState> | null
  if (typeof state !== 'object' || state === null || !MODES.includes(state.mode as OutputMode)) {
    throw new TypeError('Stage state needs a mode')
  }
  return {
    current: slideOf(state.current ?? null),
    next: slideOf(state.next ?? null),
    title: textOrNull(state.title),
    nextItemTitle: textOrNull(state.nextItemTitle),
    mode: state.mode as OutputMode,
    alert: alertDisplayOf(state.alert),
  }
}

interface StageWindowControls {
  open(): void
  close(): void
  getWindow(): BrowserWindow | null
}

/** Opens and closes the stage window, and forwards stage state from the operator window to it. */
export function registerStageIpc(controls: StageWindowControls): void {
  ipcMain.handle('stage:open', () => {
    requireFeature('stageDisplay')
    controls.open()
  })
  ipcMain.handle('stage:close', () => controls.close())
  ipcMain.handle('stage:isOpen', () => controls.getWindow() !== null)

  ipcMain.on('stage:send', (_event, state: unknown) => {
    try {
      lastState = assertStageState(state)
    } catch (error) {
      console.error(error)
      return
    }
    controls.getWindow()?.webContents.send('stage:state', lastState)
  })
}

/** Sends the latest state to a freshly loaded stage window. */
export function sendLastStageState(win: BrowserWindow): void {
  win.webContents.send('stage:state', lastState)
}

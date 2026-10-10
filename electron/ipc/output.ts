import { BrowserWindow, ipcMain } from 'electron'
import { DEFAULT_THEME_STYLE, normalizeTheme } from '../../shared/themes'
import type { OutputMode, OutputState } from '../../shared/types'

const MODES: OutputMode[] = ['show', 'black', 'clear', 'logo']

let lastState: OutputState = { mode: 'black', text: '', caption: '', theme: DEFAULT_THEME_STYLE }

function assertOutputState(value: unknown): OutputState {
  const state = value as Partial<OutputState> | null
  if (
    typeof state !== 'object' ||
    state === null ||
    !MODES.includes(state.mode as OutputMode) ||
    typeof state.text !== 'string' ||
    typeof state.caption !== 'string' ||
    typeof state.theme !== 'object'
  ) {
    throw new TypeError('Output state needs a mode, text, caption and theme')
  }
  return { mode: state.mode as OutputMode, text: state.text, caption: state.caption, theme: normalizeTheme(state.theme) }
}

/** Forwards output state from the operator window to the output window. */
export function registerOutputIpc(getOutputWindow: () => BrowserWindow | null): void {
  ipcMain.on('output:send', (_event, state: unknown) => {
    try {
      lastState = assertOutputState(state)
    } catch (error) {
      console.error(error)
      return
    }
    getOutputWindow()?.webContents.send('output:state', lastState)
  })
}

/** Sends the latest state to a freshly loaded output window. */
export function sendLastOutputState(win: BrowserWindow): void {
  win.webContents.send('output:state', lastState)
}

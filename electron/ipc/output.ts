import { BrowserWindow, ipcMain } from 'electron'
import { DEFAULT_THEME_STYLE, normalizeTheme } from '../../shared/themes'
import type { OutputMode, OutputState } from '../../shared/types'

const MODES: OutputMode[] = ['show', 'black', 'clear', 'logo']

let lastState: OutputState = { mode: 'black', text: '', caption: '', theme: DEFAULT_THEME_STYLE, fadeMs: 400, logoUrl: null }

function assertOutputState(value: unknown): OutputState {
  const state = value as Partial<OutputState> | null
  if (
    typeof state !== 'object' ||
    state === null ||
    !MODES.includes(state.mode as OutputMode) ||
    typeof state.text !== 'string' ||
    typeof state.caption !== 'string' ||
    typeof state.theme !== 'object' ||
    typeof state.fadeMs !== 'number' ||
    !Number.isFinite(state.fadeMs) ||
    (state.logoUrl !== null && !(typeof state.logoUrl === 'string' && state.logoUrl.startsWith('wd-media://')))
  ) {
    throw new TypeError('Output state needs a mode, text, caption, theme, fade length and logo (or null)')
  }
  return {
    mode: state.mode as OutputMode,
    text: state.text,
    caption: state.caption,
    theme: normalizeTheme(state.theme),
    fadeMs: Math.min(1500, Math.max(0, state.fadeMs)),
    logoUrl: state.logoUrl,
  }
}

/** Forwards output state from the operator window to the output window, and opens or closes that window. */
export function registerOutputIpc(getOutputWindow: () => BrowserWindow | null, setOpen: (open: boolean) => void): void {
  ipcMain.handle('output:setOpen', (_event, open: unknown) => setOpen(open === true))
  ipcMain.handle('output:isOpen', () => getOutputWindow() !== null)

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

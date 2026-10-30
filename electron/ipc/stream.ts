import { BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import { markOnAir, requireFeature } from '../../shared/features'
import { DEFAULT_FONT, DEFAULT_THEME_STYLE } from '../../shared/themes'
import type { StreamKeyMode, StreamState } from '../../shared/types'
import { copyIntoMedia, mediaUrl } from '../media'
import { assertOutputState, overlayLayersOf } from './output'

let lastState: StreamState = {
  mode: 'black',
  text: '',
  caption: '',
  copyright: '',
  theme: DEFAULT_THEME_STYLE,
  fadeMs: 400,
  logoUrl: null,
  defaultFont: DEFAULT_FONT,
  keyMode: 'chroma',
  keyColor: '#00ff00',
  width: 1920,
  height: 1080,
  overlays: { logos: [], idle: null, lowerThird: null },
  testPattern: false,
}

const KEY_MODES: StreamKeyMode[] = ['chroma', 'luma', 'transparent', 'keyFill']

const dimension = (value: unknown, fallback: number) =>
  Number.isInteger(value) && (value as number) >= 320 && (value as number) <= 7680 ? (value as number) : fallback

function assertStreamState(value: unknown): StreamState {
  // The slide part has the projector's shape; the alert ticker and church screen overlays do not apply.
  const { mode, text, caption, copyright, rich, theme, fadeMs, logoUrl, defaultFont } = assertOutputState(value)
  const state = value as Partial<StreamState>
  return {
    mode,
    text,
    caption,
    copyright,
    rich,
    theme,
    fadeMs,
    logoUrl,
    defaultFont,
    keyMode: KEY_MODES.includes(state.keyMode as StreamKeyMode) ? (state.keyMode as StreamKeyMode) : 'chroma',
    keyColor: typeof state.keyColor === 'string' && /^#[0-9a-f]{6}$/i.test(state.keyColor) ? state.keyColor : '#00ff00',
    width: dimension(state.width, 1920),
    height: dimension(state.height, 1080),
    overlays: overlayLayersOf(state.overlays) ?? { logos: [], idle: null, lowerThird: null },
    testPattern: state.testPattern === true,
  }
}

/**
 * Forwards stream state from the operator window to the Stream output windows (the Stream output, and its key window
 * for Key and Fill), opens and closes them, and adds logos. `getStreamWindow` answers whether the Stream output is open.
 */
export function registerStreamIpc(
  getStreamWindow: () => BrowserWindow | null,
  getStreamWindows: () => BrowserWindow[],
  setOpen: (open: boolean) => void,
): void {
  ipcMain.handle('stream:setOpen', (_event, open: unknown) => {
    // Closing always works; only opening needs the plan.
    if (open === true) {
      requireFeature('multiOutput')
      // On air from here: it stays available until the app restarts, whatever happens to the plan.
      markOnAir('multiOutput')
    }
    setOpen(open === true)
  })
  ipcMain.handle('stream:isOpen', () => getStreamWindow() !== null)

  ipcMain.on('stream:send', (_event, state: unknown) => {
    try {
      lastState = assertStreamState(state)
    } catch (error) {
      console.error(error)
      return
    }
    for (const win of getStreamWindows()) win.webContents.send('stream:state', lastState)
  })

  // The copy lives in the app data folder, so the logo keeps working when the original moves.
  ipcMain.handle('stream:pickLogo', async (event) => {
    const options: Electron.OpenDialogOptions = {
      title: 'Add a logo',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'webp', 'svg', 'jpg', 'jpeg'] }],
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (canceled || filePaths.length === 0) return null
    return { url: mediaUrl(await copyIntoMedia(filePaths[0])), name: path.basename(filePaths[0]) }
  })
}

/** Sends the latest state to a freshly loaded Stream or key window. */
export function sendLastStreamState(win: BrowserWindow): void {
  win.webContents.send('stream:state', lastState)
}

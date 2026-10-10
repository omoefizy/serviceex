import { app, BrowserWindow, screen } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import './db'
import { seedBuiltinThemes } from './db/themes'
import { registerSongIpc } from './ipc/songs'
import { registerBibleIpc } from './ipc/bible'
import { registerServiceIpc } from './ipc/services'
import { registerSongFileIpc } from './ipc/songFiles'
import { registerThemeIpc } from './ipc/themes'
import { registerMediaIpc } from './ipc/media'
import { registerSettingsIpc } from './ipc/settings'
import { registerStageIpc, sendLastStageState } from './ipc/stage'
import { registerAiIpc } from './ipc/ai'
import { registerSpeechIpc } from './ipc/speech'
import { startBackupSchedule } from './backup'
import { getAppSettings } from './db/settings'
import { registerMediaProtocol, registerMediaScheme } from './media'
import { registerOutputIpc, sendLastOutputState } from './ipc/output'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

// Must run before the app is ready.
registerMediaScheme()

let win: BrowserWindow | null
let outputWin: BrowserWindow | null = null
let stageWin: BrowserWindow | null = null

/** Loads the renderer, optionally at a hash route such as /output. */
function loadRenderer(target: BrowserWindow, route?: string) {
  if (VITE_DEV_SERVER_URL) {
    target.loadURL(route ? `${VITE_DEV_SERVER_URL}#${route}` : VITE_DEV_SERVER_URL)
  } else {
    target.loadFile(path.join(RENDERER_DIST, 'index.html'), route ? { hash: route } : undefined)
  }
}

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      // The sermon listener captures audio and keeps time here; it must not slow down when the window is hidden.
      backgroundThrottling: false,
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  // The output and stage windows have no use without the operator window.
  win.on('closed', () => {
    win = null
    outputWin?.close()
    stageWin?.close()
  })
}

/** The display chosen in Settings; 'auto' is the first display that is not the primary one. Null means a window. */
function outputDisplay(): Electron.Display | null {
  const choice = getAppSettings().outputDisplay
  if (choice === 'window') return null
  const displays = screen.getAllDisplays()
  // A display that has been unplugged falls back to automatic.
  const chosen = typeof choice === 'number' ? displays.find((display) => display.id === choice) : undefined
  if (chosen) return chosen
  const primaryId = screen.getPrimaryDisplay().id
  return displays.find((display) => display.id !== primaryId) ?? null
}

/** Opens the projector output: fullscreen on the chosen display (see outputDisplay), otherwise a 16:9 window. */
function createOutputWindow() {
  const external = outputDisplay()

  const output = new BrowserWindow({
    title: 'WorshipDeck Output',
    backgroundColor: '#000',
    ...(external
      ? { ...external.bounds, fullscreen: true, frame: false }
      : { width: 960, height: 540, resizable: true }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  outputWin = output
  output.webContents.on('did-finish-load', () => sendLastOutputState(output))
  output.on('closed', () => {
    // A replacement may already be open when the display setting changes.
    if (outputWin === output) outputWin = null
  })
  loadRenderer(output, '/output')
}

/** The stage display for the worship leader: an ordinary window to drag onto a confidence monitor. */
function openStageWindow() {
  if (stageWin) {
    stageWin.focus()
    return
  }
  const stage = new BrowserWindow({
    title: 'WorshipDeck Stage',
    width: 1280,
    height: 720,
    backgroundColor: '#000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })
  stageWin = stage
  stage.webContents.on('did-finish-load', () => sendLastStageState(stage))
  stage.on('closed', () => {
    if (stageWin === stage) stageWin = null
    win?.webContents.send('stage:open-changed', false)
  })
  loadRenderer(stage, '/stage')
  win?.webContents.send('stage:open-changed', true)
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
    createOutputWindow()
  }
})

app.whenReady().then(() => {
  seedBuiltinThemes()
  registerMediaProtocol()
  registerSongIpc()
  registerBibleIpc()
  registerServiceIpc()
  registerSongFileIpc()
  registerThemeIpc()
  registerMediaIpc()
  registerSettingsIpc((before, after) => {
    // Move the output by rebuilding its window; fullscreen and frame cannot change in place.
    if (before.outputDisplay !== after.outputDisplay) {
      outputWin?.destroy()
      createOutputWindow()
    }
  })
  registerStageIpc({ open: openStageWindow, close: () => stageWin?.close(), getWindow: () => stageWin })
  startBackupSchedule()
  registerAiIpc()
  registerSpeechIpc()
  registerOutputIpc(() => outputWin)
  createWindow()
  createOutputWindow()
})

import { app, BrowserWindow, screen } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import './db'
import { registerSongIpc } from './ipc/songs'
import { registerBibleIpc } from './ipc/bible'
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

let win: BrowserWindow | null
let outputWin: BrowserWindow | null = null

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
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

  // The output window has no use without the operator window.
  win.on('closed', () => {
    win = null
    outputWin?.close()
  })
}

/** Opens the projector output: fullscreen on a secondary display if there is one, otherwise a 16:9 window. */
function createOutputWindow() {
  const primaryId = screen.getPrimaryDisplay().id
  const external = screen.getAllDisplays().find((display) => display.id !== primaryId)

  outputWin = new BrowserWindow({
    title: 'WorshipDeck Output',
    backgroundColor: '#000',
    ...(external
      ? { ...external.bounds, fullscreen: true, frame: false }
      : { width: 960, height: 540, resizable: true }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  outputWin.webContents.on('did-finish-load', () => {
    if (outputWin) sendLastOutputState(outputWin)
  })
  outputWin.on('closed', () => {
    outputWin = null
  })

  if (VITE_DEV_SERVER_URL) {
    outputWin.loadURL(`${VITE_DEV_SERVER_URL}#/output`)
  } else {
    outputWin.loadFile(path.join(RENDERER_DIST, 'index.html'), { hash: '/output' })
  }
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
  registerSongIpc()
  registerBibleIpc()
  registerOutputIpc(() => outputWin)
  createWindow()
  createOutputWindow()
})

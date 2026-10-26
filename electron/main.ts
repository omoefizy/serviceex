import { app, BrowserWindow, screen } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import './db'
import { seedBuiltinThemes } from './db/themes'
import { seedBuiltinLowerThirds } from './db/lowerThirds'
import { registerLowerThirdIpc } from './ipc/lowerThirds'
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
import { registerStreamIpc, sendLastStreamState } from './ipc/stream'
import { registerPresentationIpc } from './ipc/presentations'
import { registerLivePowerPointIpc, type LivePowerPoint } from './ipc/livePowerPoint'
import { registerLogIpc } from './ipc/log'
import { registerFontIpc } from './ipc/fonts'
import { registerSharingIpc, type SharingHandle } from './ipc/sharing'
import { loadLicense, registerLicenseIpc } from './license'

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
let streamWin: BrowserWindow | null = null
/** Draws presentation slides out of sight (see ipc/presentations); made when first needed. */
let rasterWin: BrowserWindow | null = null
let stopPresentations: (() => Promise<void>) | null = null
/** Plays animated slides with PowerPoint over the output (see ipc/livePowerPoint). */
let livePowerPoint: LivePowerPoint | null = null
/** Local network sharing (see ipc/sharing); off unless turned on in Settings. */
let sharing: SharingHandle | null = null

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

  // Cmd+H toggles highlight mode; on macOS the app menu would take it to hide the app, so it is caught first and passed on.
  win.webContents.on('before-input-event', (event, input) => {
    const cmdH = input.type === 'keyDown' && input.meta && !input.control && !input.alt && !input.shift && input.key.toLowerCase() === 'h'
    if (process.platform !== 'darwin' || !cmdH) return
    event.preventDefault()
    win?.webContents.send('highlight:toggle')
  })

  // Cmd+Plus and Minus (Ctrl+Plus and Minus) size the live or preview verse; the View menu would take them to zoom the window.
  win.webContents.on('before-input-event', (event, input) => {
    const mod = process.platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta
    if (input.type !== 'keyDown' || !mod || input.alt) return
    const step = input.key === '=' || input.key === '+' ? 1 : input.key === '-' ? -1 : 0
    if (!step) return
    event.preventDefault()
    win?.webContents.send('scripture:size', step)
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
    streamWin?.close()
    rasterWin?.destroy()
    livePowerPoint?.stop().catch(console.error)
  })
}

/** The hidden renderer that draws PDF pages and fits slide pictures; it never shows. */
function createRasterWindow(): BrowserWindow {
  const raster = new BrowserWindow({
    show: false,
    width: 640,
    height: 360,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      // It works while hidden, which is always.
      backgroundThrottling: false,
    },
  })
  rasterWin = raster
  raster.on('closed', () => {
    if (rasterWin === raster) rasterWin = null
  })
  loadRenderer(raster, '/rasterize')
  return raster
}

/** The display chosen in Settings; 'auto' is the first display that is not the primary one. Null means a window. */
function outputDisplay(): Electron.Display | null {
  const choice = getAppSettings().outputDisplay
  if (choice === 'window' || choice === 'custom') return null
  const displays = screen.getAllDisplays()
  // A display that has been unplugged falls back to automatic.
  const chosen = typeof choice === 'number' ? displays.find((display) => display.id === choice) : undefined
  if (chosen) return chosen
  const primaryId = screen.getPrimaryDisplay().id
  return displays.find((display) => display.id !== primaryId) ?? null
}

/**
 * With Live PowerPoint on macOS, the output on a display is a borderless window above everything rather than a
 * full screen space, so it can step aside for PowerPoint's show and come back over it at once.
 */
function outputOverShow(): boolean {
  return process.platform === 'darwin' && getAppSettings().presentationLivePowerPoint && outputDisplay() !== null
}

/**
 * Opens the projector output: fullscreen on the chosen display (see outputDisplay), a frameless window at the
 * Custom Position from Live Options, otherwise a 16:9 window.
 */
function createOutputWindow() {
  const settings = getAppSettings()
  const external = outputDisplay()
  const custom = settings.outputDisplay === 'custom' ? settings.outputBounds : null
  const overShow = outputOverShow()

  const output = new BrowserWindow({
    title: 'WorshipDeck Output',
    backgroundColor: '#000',
    ...(external
      ? overShow
        ? { ...external.bounds, frame: false, fullscreenable: false, enableLargerThanScreen: true, hasShadow: false }
        : { ...external.bounds, fullscreen: true, frame: false }
      : custom
        ? { x: custom.left, y: custom.top, width: custom.width, height: custom.height, frame: false, resizable: false, enableLargerThanScreen: true }
        : { width: 960, height: 540, resizable: true }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  outputWin = output
  if (overShow) {
    output.setAlwaysOnTop(true, 'screen-saver')
    output.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }
  output.webContents.on('did-finish-load', () => sendLastOutputState(output))
  output.on('closed', () => {
    // A replacement may already be open when the display setting changes.
    if (outputWin !== output) return
    outputWin = null
    win?.webContents.send('output:open-changed', false)
  })
  loadRenderer(output, '/output')
  win?.webContents.send('output:open-changed', true)
}

/** The Live menu's "Show Live Output": opens the output (or brings it forward), or closes it. */
function setOutputOpen(open: boolean) {
  if (!open) outputWin?.close()
  else if (outputWin) outputWin.show()
  else createOutputWindow()
}

/** The display chosen for the Stream output, or null for a window (also when that display has been unplugged). */
function streamDisplay(): Electron.Display | null {
  const choice = getAppSettings().streamDisplay
  return choice === 'window' ? null : (screen.getAllDisplays().find((display) => display.id === choice) ?? null)
}

/**
 * Opens the Stream output for the livestream: fullscreen on the chosen display, otherwise a window that is the
 * stream resolution in pixels, scaled down to fit the screen.
 */
function createStreamWindow() {
  const external = streamDisplay()
  const [width, height] = getAppSettings().streamResolution.split('x').map(Number)
  const { workAreaSize, scaleFactor } = screen.getPrimaryDisplay()
  const fit = Math.min(1 / scaleFactor, (workAreaSize.width * 0.9) / width, (workAreaSize.height * 0.9) / height)

  const stream = new BrowserWindow({
    title: 'WorshipDeck Stream',
    backgroundColor: '#000',
    ...(external
      ? { ...external.bounds, fullscreen: true, frame: false }
      : { width: Math.round(width * fit), height: Math.round(height * fit), useContentSize: true, resizable: true }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      // The capture card keeps taking frames while the window is behind others.
      backgroundThrottling: false,
    },
  })

  streamWin = stream
  stream.webContents.on('did-finish-load', () => sendLastStreamState(stream))
  stream.on('closed', () => {
    // A replacement may already be open when the display setting changes.
    if (streamWin !== stream) return
    streamWin = null
    win?.webContents.send('stream:open-changed', false)
  })
  loadRenderer(stream, '/stream')
  win?.webContents.send('stream:open-changed', true)
}

function setStreamOpen(open: boolean) {
  if (!open) streamWin?.close()
  else if (streamWin) streamWin.show()
  else createStreamWindow()
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

// PowerPoint's slide show and copies end before quitting, giving it a few seconds at most.
let livePowerPointClosed = false
app.on('before-quit', (event) => {
  if (livePowerPointClosed || !livePowerPoint) return
  event.preventDefault()
  livePowerPointClosed = true
  const timeout = new Promise((resolve) => setTimeout(resolve, 6000))
  Promise.race([livePowerPoint.close(), timeout])
    .catch(console.error)
    .finally(() => app.quit())
})

app.on('will-quit', () => {
  stopPresentations?.().catch(console.error)
  stopPresentations = null
  sharing?.stop().catch(console.error)
  sharing = null
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
  // First: what the licence allows is fixed now, for this whole run, before any feature starts.
  loadLicense()
  registerLicenseIpc()
  seedBuiltinThemes()
  seedBuiltinLowerThirds()
  registerMediaProtocol()
  registerSongIpc()
  registerBibleIpc()
  registerServiceIpc()
  registerSongFileIpc()
  registerThemeIpc()
  registerLowerThirdIpc()
  registerMediaIpc()
  registerLogIpc()
  registerFontIpc()
  sharing = registerSharingIpc(() => win)
  registerSettingsIpc((before, after) => {
    sharing?.settingsChanged(before, after)
    // Live PowerPoint off: the slide show ends and PowerPoint lets go of the copies.
    if (before.presentationLivePowerPoint && !after.presentationLivePowerPoint) livePowerPoint?.stop().catch(console.error)
    // Move the output by rebuilding its window; fullscreen and frame cannot change in place. On macOS, Live
    // PowerPoint changes the kind of window too (see outputOverShow).
    const overShowChanged = process.platform === 'darwin' && before.presentationLivePowerPoint !== after.presentationLivePowerPoint && outputDisplay() !== null
    if (before.outputDisplay !== after.outputDisplay || overShowChanged) {
      outputWin?.destroy()
      createOutputWindow()
    } else if (after.outputDisplay === 'custom' && JSON.stringify(before.outputBounds) !== JSON.stringify(after.outputBounds)) {
      const { left, top, width, height } = after.outputBounds
      outputWin?.setBounds({ x: left, y: top, width, height })
    }
    // The same for the Stream output; a new resolution resizes its window.
    if (streamWin && (before.streamDisplay !== after.streamDisplay || before.streamResolution !== after.streamResolution)) {
      streamWin.destroy()
      createStreamWindow()
    }
  })
  registerStageIpc({ open: openStageWindow, close: () => stageWin?.close(), getWindow: () => stageWin })
  startBackupSchedule()
  registerAiIpc()
  registerSpeechIpc()
  registerOutputIpc(() => outputWin, setOutputOpen)
  registerStreamIpc(() => streamWin, setStreamOpen)
  // The PowerShell and AppleScript the PowerPoint engines and Live PowerPoint run.
  const resourcesDir = app.isPackaged ? path.join(process.resourcesPath, 'presentations') : path.join(process.env.APP_ROOT, 'resources')
  livePowerPoint = registerLivePowerPointIpc({
    getOutputWindow: () => outputWin,
    getOperatorWindow: () => win,
    outputKeepsOnTop: outputOverShow,
    resourcesDir,
  })
  stopPresentations = registerPresentationIpc({
    createRasterWindow,
    getOperatorWindow: () => win,
    resourcesDir,
    onSourceChanged: (id) => livePowerPoint?.sourceUpdated(id),
    whileShowCovered: (task) => (livePowerPoint ? livePowerPoint.whileShowCovered(task) : task()),
  })
  createWindow()
  createOutputWindow()
})

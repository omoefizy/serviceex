import { BrowserWindow, ipcMain } from 'electron'
import { normalizeLowerThirdStyle } from '../../shared/lowerThirds'
import { DEFAULT_FONT, DEFAULT_THEME_STYLE, normalizeTheme } from '../../shared/themes'
import type { AlertDisplay, LowerThirdDisplay, OutputMode, OutputState, OverlayLayers } from '../../shared/types'
import { cleanDefaultFont, cleanLogoItems, cleanScreenMargins, NO_MARGINS } from '../db/settings'

const MODES: OutputMode[] = ['show', 'black', 'clear', 'logo']

let lastState: OutputState = {
  mode: 'black',
  text: '',
  caption: '',
  copyright: '',
  theme: DEFAULT_THEME_STYLE,
  fadeMs: 400,
  logoUrl: null,
  defaultFont: DEFAULT_FONT,
  screenMargins: NO_MARGINS,
  testPattern: false,
  alert: null,
  overlays: null,
}

const clampNumber = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
const hexColor = (value: unknown, fallback: string) => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback)

/** The alert ticker of an output or stage state; anything malformed shows no ticker. */
export function alertDisplayOf(value: unknown): AlertDisplay | null {
  const alert = value as Partial<AlertDisplay> | null
  if (
    typeof alert !== 'object' ||
    alert === null ||
    !Array.isArray(alert.texts) ||
    alert.texts.length === 0 ||
    !alert.texts.every((text) => typeof text === 'string') ||
    !Number.isFinite(alert.runId) ||
    !Number.isFinite(alert.startedAt)
  ) {
    return null
  }
  return {
    runId: alert.runId as number,
    texts: alert.texts.slice(0, 100).map((text) => text.slice(0, 300)),
    startedAt: alert.startedAt as number,
    loops: Math.round(clampNumber(alert.loops, 0, 99, 0)),
    layout: alert.layout === 'sequence' ? 'sequence' : 'divider',
    priority: alert.priority === true,
    position: alert.position === 'top' ? 'top' : 'bottom',
    speed: clampNumber(alert.speed, 3, 40, 14),
    fontSize: clampNumber(alert.fontSize, 2, 15, 5),
    textColor: hexColor(alert.textColor, '#ffffff'),
    bandColor: hexColor(alert.bandColor, '#0a0e1c'),
    bandOpacity: clampNumber(alert.bandOpacity, 0, 1, 0.85),
    bandHeight: clampNumber(alert.bandHeight, 4, 25, 9),
  }
}

/** The lower third of an overlay state; anything malformed shows none. */
function lowerThirdDisplayOf(value: unknown): LowerThirdDisplay | null {
  const lowerThird = value as Partial<LowerThirdDisplay> | null
  if (
    typeof lowerThird !== 'object' ||
    lowerThird === null ||
    !Number.isFinite(lowerThird.runId) ||
    typeof lowerThird.headline !== 'string' ||
    typeof lowerThird.body !== 'string'
  ) {
    return null
  }
  return {
    runId: lowerThird.runId as number,
    headline: lowerThird.headline.slice(0, 300),
    body: lowerThird.body.slice(0, 300),
    style: normalizeLowerThirdStyle(lowerThird.style),
    animation: lowerThird.animation === 'fade' || lowerThird.animation === 'wipe' ? lowerThird.animation : 'slide',
    durationMs: clampNumber(lowerThird.durationMs, 200, 1000, 500),
  }
}

/** The overlay layers of a state; anything malformed draws none. */
export function overlayLayersOf(value: unknown): OverlayLayers | null {
  const overlays = value as Partial<OverlayLayers> | null
  if (typeof overlays !== 'object' || overlays === null) return null
  return { logos: cleanLogoItems(overlays.logos) ?? [], lowerThird: lowerThirdDisplayOf(overlays.lowerThird) }
}

export function assertOutputState(value: unknown): OutputState {
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
    copyright: typeof state.copyright === 'string' ? state.copyright : '',
    theme: normalizeTheme(state.theme),
    fadeMs: Math.min(1500, Math.max(0, state.fadeMs)),
    logoUrl: state.logoUrl,
    defaultFont: cleanDefaultFont(state.defaultFont) ?? DEFAULT_FONT,
    screenMargins: cleanScreenMargins(state.screenMargins) ?? NO_MARGINS,
    testPattern: state.testPattern === true,
    alert: alertDisplayOf(state.alert),
    overlays: overlayLayersOf(state.overlays),
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

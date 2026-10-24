// Live PowerPoint: drives desktop PowerPoint to play a presentation's slide show, animations and transitions
// included, over the output display. One interface, two implementations: AppleScript through osascript on macOS
// (mac.ts) and COM through a PowerShell script on Windows (windows.ts). Each opens a private copy of the
// presentation, never the original, so saving the original while live changes nothing on screen.

import { execFile } from 'node:child_process'
import { createMacController } from './mac'
import { createWindowsController } from './windows'

/** Where the show goes, in screen points (Electron's display and window coordinates). */
export interface ShowBounds {
  x: number
  y: number
  width: number
  height: number
  /** Device pixels per point on that display. */
  scaleFactor: number
}

/** Where a running show is. Slide numbers are PowerPoint's own, 1 based, hidden slides included. */
export interface ShowPosition {
  slide: number
  /** Build steps (clicks) of this slide already played, and how many it has; null when the controller cannot tell. */
  step: number | null
  steps: number | null
  /** Where PowerPoint put the show window, in screen points, as it reports it. */
  frame: { x: number; y: number; width: number; height: number } | null
}

export interface OpenOptions {
  /** Click steps of each slide in show order (index 0 is slide 1), when known from the file. */
  steps: number[] | null
  /** How long each click's effects play, per slide, in milliseconds, when known. */
  clickMs: number[][] | null
  /** Slides hidden in the show (1 based), which next and previous skip. */
  hidden: number[]
}

export interface StartOptions {
  /** PowerPoint's slide number to start on. */
  slide: number
  /** Advance on the slide timings saved in the file; otherwise only on next and previous. */
  useTimings: boolean
}

export interface SlideShowController {
  readonly platform: 'mac' | 'windows'
  /**
   * The kind of show window, as found to work on this platform: what Diagnostics reports. macOS: the full screen
   * (speaker) show, which is a space of its own that macOS shows only when PowerPoint is brought forward (the
   * windowed show has a title bar macOS keeps below the menu bar, and opens on PowerPoint's own space too).
   * Windows: the full screen show moved onto the output's bounds, borderless.
   */
  readonly showMode: string
  /** Whether PowerPoint is installed. */
  available(): Promise<boolean>
  /** Opens a copy in PowerPoint, without starting a show. Opening it again does nothing. */
  open(copy: string, options: OpenOptions): Promise<void>
  /** Ends its show (if any) and closes the copy without saving. */
  close(copy: string): Promise<void>
  /** Starts the copy's show at a slide, ending any show already running, and places it over `bounds`. */
  start(copy: string, bounds: ShowBounds, options: StartOptions): Promise<ShowPosition>
  goToSlide(slide: number): Promise<ShowPosition>
  /**
   * Whether goToSlide, and previous() from where the show is now, start the show again rather than move inside
   * it (macOS). The session covers the output with the still slide meanwhile, so the gap is never seen.
   */
  readonly goToRestarts: boolean
  previousRestarts(): boolean
  /** Plays the next build step, or moves to the next slide when none are left. Stays on the last slide at the end. */
  next(): Promise<ShowPosition>
  /** Takes back a build step, or moves to the previous slide, fully built, as PowerPoint does. */
  previous(): Promise<ShowPosition>
  /** Holds slide timings while the show is covered; resume carries on. No effect on a manual show. */
  pause(): Promise<void>
  resume(): Promise<void>
  /** Ends the running show; the copy stays open. */
  end(): Promise<void>
  isRunning(): Promise<boolean>
  getCurrentSlide(): Promise<ShowPosition | null>
  /** Ends any show, closes every copy it opened, and quits PowerPoint if it was not running before. */
  dispose(): Promise<void>
}

export interface RunError extends Error {
  stderr: string
  timedOut: boolean
}

/** Runs a program without a shell or a window; rejects with its error output, noting a timeout. */
export function run(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (!error) return resolve(String(stdout).trim())
      const failure = error as RunError
      failure.stderr = String(stderr ?? '').trim()
      failure.timedOut = (error as { killed?: boolean }).killed === true
      reject(failure)
    })
  })
}

/** The controller for this platform, or null where PowerPoint cannot be driven (Linux). */
export function createSlideShowController(script: (name: string) => string): SlideShowController | null {
  if (process.platform === 'darwin') return createMacController(script('powerpoint-live.applescript'))
  if (process.platform === 'win32') return createWindowsController(script('powerpoint-live.ps1'))
  return null
}

/** The next slide after `slide` that is not hidden, or null at the end. */
export function nextShown(slide: number, count: number, hidden: number[]): number | null {
  for (let n = slide + 1; n <= count; n++) if (!hidden.includes(n)) return n
  return null
}

/** The slide before `slide` that is not hidden, or null at the start. */
export function previousShown(slide: number, hidden: number[]): number | null {
  for (let n = slide - 1; n >= 1; n--) if (!hidden.includes(n)) return n
  return null
}

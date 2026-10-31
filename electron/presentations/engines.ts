// The programs that turn PowerPoint files into pictures, each run as a child process: desktop PowerPoint through
// COM (a PowerShell script) on Windows, Microsoft PowerPoint through AppleScript (osascript) on macOS, or
// LibreOffice headless anywhere. Each works on a private copy of the original, so the operator can keep the
// original open in PowerPoint while it converts, and nothing locks or renames it.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PresentationEngineId, PresentationEngineSetting, PresentationEngineStatus } from '../../shared/types'
import { ImportCancelledError } from './library'

export const MAC_POWERPOINT = '/Applications/Microsoft PowerPoint.app'
/** PowerPoint for Mac is sandboxed; a copy inside its own container opens without a "Grant File Access" prompt. */
export const MAC_POWERPOINT_TMP = path.join(os.homedir(), 'Library', 'Containers', 'com.microsoft.Powerpoint', 'Data', 'tmp')
const MAC_TIMEOUT_MS = 120_000
const CONVERT_TIMEOUT_MS = 300_000

export const AUTOMATION_SETTINGS_PATH = 'System Settings > Privacy & Security > Automation'

interface RunError extends Error {
  stderr: string
  timedOut: boolean
}

/**
 * Runs a program without a shell or a window; rejects with its error output, noting a timeout. Aborting the signal
 * stops the program and rejects with ImportCancelledError.
 */
function run(command: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024, signal }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout)
      if (signal?.aborted) return reject(new ImportCancelledError())
      const failure = error as RunError
      failure.stderr = String(stderr ?? '').trim()
      failure.timedOut = (error as { killed?: boolean }).killed === true
      reject(failure)
    })
  })
}

let windowsPowerPoint: Promise<boolean> | null = null

/** Desktop PowerPoint registers PowerPoint.Application for COM; the Store and web versions do not. */
function hasWindowsPowerPoint(): Promise<boolean> {
  windowsPowerPoint ??= run('reg', ['query', 'HKCR\\PowerPoint.Application\\CurVer'], 10_000).then(
    () => true,
    () => false,
  )
  return windowsPowerPoint
}

export function findLibreOffice(): string | null {
  const candidates: string[] = []
  if (process.platform === 'darwin') candidates.push('/Applications/LibreOffice.app/Contents/MacOS/soffice')
  if (process.platform === 'win32') {
    for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
      if (root) candidates.push(path.join(root, 'LibreOffice', 'program', 'soffice.exe'))
    }
  }
  const names = process.platform === 'win32' ? ['soffice.exe'] : ['soffice', 'libreoffice']
  for (const folder of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) candidates.push(path.join(folder, name))
  }
  return candidates.find((file) => existsSync(file)) ?? null
}

function installMessage(setting: PresentationEngineSetting): string {
  const either =
    process.platform === 'win32'
      ? 'desktop Microsoft PowerPoint or LibreOffice (free from libreoffice.org)'
      : process.platform === 'darwin'
        ? 'Microsoft PowerPoint (in Applications) or LibreOffice (free from libreoffice.org)'
        : 'LibreOffice Impress (from libreoffice.org or your package manager)'
  if (setting === 'powerpoint') {
    return process.platform === 'win32' || process.platform === 'darwin'
      ? 'Settings ask for PowerPoint, but desktop Microsoft PowerPoint is not installed. Install it, or set the engine to Auto.'
      : 'PowerPoint is not available on this system. Install LibreOffice and set the engine to Auto or LibreOffice.'
  }
  if (setting === 'libreoffice') return 'Settings ask for LibreOffice, but it is not installed. Get it free from libreoffice.org, or set the engine to Auto.'
  return `To import PowerPoint files, install ${either}. PDFs and images import without either.`
}

export async function engineStatus(setting: PresentationEngineSetting): Promise<PresentationEngineStatus> {
  const powerPoint =
    process.platform === 'win32' ? await hasWindowsPowerPoint() : process.platform === 'darwin' ? existsSync(MAC_POWERPOINT) : false
  const libreOffice = findLibreOffice()
  const powerPointId: PresentationEngineId = process.platform === 'win32' ? 'powerpoint-windows' : 'powerpoint-mac'
  const active: PresentationEngineId | null =
    setting === 'powerpoint'
      ? powerPoint ? powerPointId : null
      : setting === 'libreoffice'
        ? libreOffice ? 'libreoffice' : null
        : powerPoint ? powerPointId : libreOffice ? 'libreoffice' : null
  return { setting, active, powerPoint, libreOffice, message: active ? null : installMessage(setting) }
}

/** What the PowerShell script writes next to the pictures. */
export interface ComSlide {
  file: string
  title: string
  text: string
  notes: string
  animations: number
  transition: boolean
}

/** Exports each slide as a PNG into `outDir` with desktop PowerPoint through COM, read only and in the background. */
export async function exportWithWindowsPowerPoint(file: string, outDir: string, script: string, signal?: AbortSignal): Promise<ComSlide[]> {
  const work = await mkdtemp(path.join(os.tmpdir(), 'serviceex-ppt-'))
  try {
    const copy = path.join(work, `presentation${path.extname(file)}`)
    await copyFile(file, copy)
    await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-InputPath', copy, '-OutputDir', outDir],
      CONVERT_TIMEOUT_MS,
      signal,
    ).catch((error: RunError) => {
      if (error instanceof ImportCancelledError) throw error
      throw new Error(
        error.timedOut
          ? 'PowerPoint took longer than 5 minutes to export the slides.'
          : `PowerPoint could not export the slides: ${error.stderr.split('\n')[0] || error.message}`,
      )
    })
    const raw = JSON.parse((await readFile(path.join(outDir, 'slides.json'), 'utf8')).replace(/^\uFEFF/, '')) as { slides?: ComSlide | ComSlide[] }
    // ConvertTo-Json writes a one-element array as a plain object.
    return raw.slides === undefined ? [] : Array.isArray(raw.slides) ? raw.slides : [raw.slides]
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/** Explains an osascript failure, from the AppleScript error number in its message. */
function macPowerPointError(error: RunError, name: string): Error {
  const code = /\((-?\d+)\)\s*$/.exec(error.stderr)?.[1]
  if (code === '-1743') {
    return new Error(
      `macOS did not allow ServiceEx to control Microsoft PowerPoint. Turn on PowerPoint under ServiceEx in ${AUTOMATION_SETTINGS_PATH}, then try again.`,
    )
  }
  if (error.timedOut || code === '-1712') {
    return new Error(
      'PowerPoint did not finish within 2 minutes. If macOS or PowerPoint is showing a dialog (a permission prompt, sign in, or a file access request), answer it and try again.',
    )
  }
  if (code === '-128') return new Error('PowerPoint cancelled the export. Close any dialog open in PowerPoint and try again.')
  if (code === '-9074') {
    return new Error(
      `PowerPoint would not open ${name}. Open PowerPoint by hand and check it opens files (signed in and activated, no dialog waiting), then try again, or set the engine to LibreOffice.`,
    )
  }
  if (code === '-600' || code === '-10810') return new Error('PowerPoint could not be started. Open it once by hand to finish its setup, then try again.')
  const detail = error.stderr.replace(/^.*?execution error:\s*/s, '') || error.message
  return new Error(`PowerPoint could not export ${name}: ${detail}`)
}

/**
 * Exports to PDF with Microsoft PowerPoint for Mac through AppleScript: copies the original into a private folder,
 * opens the copy, saves it as a PDF and closes it without saving. PowerPoint is quit afterwards only if this
 * started it. Resolves to the PDF's bytes.
 */
export async function exportWithMacPowerPoint(file: string, script: string, signal?: AbortSignal): Promise<Uint8Array> {
  const parent = await mkdir(MAC_POWERPOINT_TMP, { recursive: true }).then(
    () => MAC_POWERPOINT_TMP,
    () => os.tmpdir(),
  )
  const work = await mkdtemp(path.join(parent, 'ServiceEx-'))
  try {
    const copy = path.join(work, `presentation${path.extname(file)}`)
    const pdf = path.join(work, 'presentation.pdf')
    await copyFile(file, copy)
    // The first run asks the operator to let ServiceEx control PowerPoint; osascript waits for the answer.
    await run('osascript', [script, copy, pdf], MAC_TIMEOUT_MS, signal).catch((error: RunError) => {
      if (error instanceof ImportCancelledError) throw error
      throw macPowerPointError(error, path.basename(file))
    })
    if (!existsSync(pdf)) throw new Error(`PowerPoint did not write a PDF of ${path.basename(file)}.`)
    return new Uint8Array(await readFile(pdf))
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/** Converts to PDF with LibreOffice headless, using its own profile so it runs even while LibreOffice is open. */
export async function exportWithLibreOffice(file: string, soffice: string, signal?: AbortSignal): Promise<Uint8Array> {
  const work = await mkdtemp(path.join(os.tmpdir(), 'serviceex-lo-'))
  try {
    const copy = path.join(work, `presentation${path.extname(file)}`)
    await copyFile(file, copy)
    const profile = pathToFileURL(path.join(work, 'profile')).toString()
    await run(
      soffice,
      [`-env:UserInstallation=${profile}`, '--headless', '--norestore', '--nolockcheck', '--convert-to', 'pdf', '--outdir', work, copy],
      CONVERT_TIMEOUT_MS,
      signal,
    ).catch((error: RunError) => {
      if (error instanceof ImportCancelledError) throw error
      throw new Error(
        error.timedOut
          ? 'LibreOffice took longer than 5 minutes to convert the presentation.'
          : `LibreOffice could not convert ${path.basename(file)}: ${error.stderr.split('\n')[0] || error.message}`,
      )
    })
    const pdf = path.join(work, 'presentation.pdf')
    if (!existsSync(pdf)) throw new Error(`LibreOffice did not write a PDF of ${path.basename(file)}.`)
    return new Uint8Array(await readFile(pdf))
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

// The diagnostics report: what went wrong in this window since it opened, with the technical text the screen keeps
// behind Show details, and which version of ServiceEx on which computer. Copied to the clipboard for support; nothing
// is sent anywhere.

import type { AppInfo } from '../../shared/types'

export interface ProblemRecord {
  /** ISO time. */
  at: string
  /** The panel or action, such as "Songs" or "Schedule". */
  where: string
  /** The sentence the operator saw. */
  message: string
  /** The technical text: the original error message, its stack and any component stack. */
  details: string
}

/** The newest problems are kept; older ones drop off. */
const MAX_PROBLEMS = 50
const MAX_DETAILS = 8_000

const problems: ProblemRecord[] = []

export function recordProblem(where: string, message: string, details: string): void {
  problems.push({ at: new Date().toISOString(), where, message, details: details.slice(0, MAX_DETAILS) })
  if (problems.length > MAX_PROBLEMS) problems.splice(0, problems.length - MAX_PROBLEMS)
}

export const recentProblems = (): readonly ProblemRecord[] => problems

/** For tests. */
export function clearProblems(): void {
  problems.length = 0
}

/** The report as plain text. `info` is null when the main process could not say. */
export function formatDiagnostics(info: AppInfo | null, list: readonly ProblemRecord[], now = new Date()): string {
  const lines = ['ServiceEx diagnostics', `Created: ${now.toISOString()}`]
  if (info) {
    lines.push(
      `Version: ${info.version}${info.packaged ? '' : ' (development build)'}`,
      `System: ${info.platform} ${info.osVersion} (${info.arch})`,
      `Electron ${info.electron}, Chrome ${info.chrome}`,
      `Locale: ${info.locale}`,
    )
  } else lines.push('Version: unknown (the app did not answer)')
  if (typeof navigator !== 'undefined') lines.push(`Online: ${navigator.onLine ? 'yes' : 'no'}`)
  if (typeof window !== 'undefined' && window.screen) lines.push(`Window: ${window.innerWidth}×${window.innerHeight}, screen ${window.screen.width}×${window.screen.height}`)
  lines.push('', list.length === 0 ? 'No problems recorded since this window opened.' : `Problems since this window opened (${list.length}, newest last):`)
  for (const problem of list) {
    lines.push('', `[${problem.at}] ${problem.where}: ${problem.message}`)
    if (problem.details && problem.details !== problem.message) lines.push(...problem.details.split('\n').map((line) => `    ${line}`))
  }
  return `${lines.join('\n')}\n`
}

export async function diagnosticsReport(): Promise<string> {
  const info = await window.api?.log?.appInfo().catch(() => null)
  return formatDiagnostics(info ?? null, problems)
}

/** Copies the report; false when the clipboard refused. */
export async function copyDiagnostics(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(await diagnosticsReport())
    return true
  } catch (err) {
    console.error('Could not copy the diagnostics', err)
    return false
  }
}

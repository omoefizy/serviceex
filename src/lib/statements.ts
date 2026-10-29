// AI statement picking from the live transcript. Final lines collect here; 30 seconds after the first new line, the
// text that arrived since the last run (and only that) goes to the pickStatements AI task. The main process keeps
// only statements found in that text word for word. They appear in the suggestion tray; nothing is saved.

import { can } from '../../shared/features'
import { locateStatement, wordKeys } from '../../shared/statements'
import { useOperatorStore } from '../store'
import { reportError } from './errors'
import { alertNewSuggestion, useSuggestions } from './scriptureDetection'

export const PICK_INTERVAL_MS = 30_000

interface Line {
  text: string
  heardAt: number
}

/** Final lines not sent yet. */
let pending: Line[] = []
let timer: ReturnType<typeof setTimeout> | null = null
/** Where to report a failed request (the listener's event log). */
let report: ((message: string) => void) | null = null

function enabled(): boolean {
  const { aiEnabled, statementPicking } = useOperatorStore.getState().settings
  return can('ai.statements') && aiEnabled && statementPicking
}

/** Takes one final transcript line. With statement picking off, nothing is kept. */
export function collectStatementText(line: string, heardAt = Date.now(), onProblem?: (message: string) => void): void {
  if (onProblem) report = onProblem
  if (!enabled()) {
    pending = []
    return
  }
  if (!line.trim()) return
  pending.push({ text: line, heardAt })
  timer ??= setTimeout(() => void pickStatements(), PICK_INTERVAL_MS)
}

/** Sends the lines collected since the last run and adds the statements that come back to the tray. */
export async function pickStatements(): Promise<void> {
  if (timer) clearTimeout(timer)
  timer = null
  const lines = pending
  pending = []
  if (!enabled() || lines.length === 0) return
  const transcript = lines.map((line) => line.text).join(' ')
  try {
    const answer = await window.api.ai.ask('pickStatements', { transcript })
    if (!answer.ok) return report?.(answer.error.message)
    for (const statement of answer.value.statements) {
      // The main process has checked it; finding it again here also tells when it was said.
      const found = locateStatement(statement, transcript)
      if (found && useSuggestions.getState().addStatement(found.text, heardAtOf(lines, found.start))) alertNewSuggestion()
    }
  } catch (error) {
    report?.(reportError('Quote suggestions', error).message)
  }
}

/** When the line holding word `index` of the joined lines was heard. */
function heardAtOf(lines: Line[], index: number): number {
  let words = 0
  for (const line of lines) {
    words += wordKeys(line.text).length
    if (index < words) return line.heardAt
  }
  return lines[lines.length - 1].heardAt
}

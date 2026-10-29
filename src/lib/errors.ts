// Turns anything thrown into a sentence the operator can act on. Known error codes (from the file system, the
// database, the network and the ServiceEx server) each have their own sentence; developer text such as "Cannot read
// properties of null" never reaches the screen. The original text is kept as `details`, shown behind Show details and
// written to the diagnostics report.

import { isServiceErrorCode, serviceErrorMessage } from '../../shared/serviceErrors'
import { recordProblem } from './diagnostics'

export interface FriendlyError {
  /** One or two plain sentences. */
  message: string
  /** The technical text, or null when there is nothing more to say than `message`. */
  details: string | null
}

/** What an error state takes: a sentence written for the screen, or a described error. */
export type ErrorLike = string | FriendlyError

export const GENERIC_ERROR = 'Something went wrong. Try again; if it keeps happening, copy the diagnostics for support.'

/** Electron wraps errors from the main process as "Error invoking remote method 'songs:get': Error: …". */
const IPC_PREFIX = /^Error invoking remote method '[^']+': (\w*Error: )?/

/** Codes from Node, SQLite and Chromium, as they appear in error messages, with what they mean for the operator. */
const CODE_MESSAGES: [RegExp, string][] = [
  [/\bENOENT\b/, 'A file ServiceEx needs could not be found. It may have been moved, renamed or deleted.'],
  [/\b(EACCES|EPERM)\b/, 'ServiceEx is not allowed to open that file or folder. Check its permissions, or choose another location.'],
  [/\bENOSPC\b/, 'The disk is full. Free some space and try again.'],
  [/\bEROFS\b/, 'That location is read only. Choose another folder.'],
  [/\bEBUSY\b/, 'That file is in use by another program. Close it there and try again.'],
  [/\bEEXIST\b/, 'A file with that name is already there.'],
  [/\bEMFILE\b/, 'Too many files are open at once. Wait a moment and try again.'],
  [/\bEADDRINUSE\b/, 'Another program is already using that network port. Close it, or choose another port in Settings, Sharing.'],
  [/\bEADDRNOTAVAIL\b/, 'That network address is not available on this computer. Check the network connection.'],
  [/\bSQLITE_(BUSY|LOCKED)\b/, 'The library is busy saving. Try again in a moment.'],
  [/\bSQLITE_FULL\b/, 'The disk is full, so the library could not be saved. Free some space and try again.'],
  [/\bSQLITE_READONLY\b/, 'The library cannot be saved because its folder is read only.'],
  [/\bSQLITE_(CORRUPT|NOTADB)\b/, 'The library file looks damaged. Restore a backup in Settings, Autosave and backups.'],
  [/\bSQLITE_CONSTRAINT\w*\b/, 'That would duplicate or break something already in the library, so it was not saved.'],
  [/\b(ETIMEDOUT|ESOCKETTIMEDOUT|ERR_TIMED_OUT)\b|\btimed out\b/i, 'That took too long to answer. Check the connection and try again.'],
  [/\b(ENOTFOUND|EAI_AGAIN|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ENETUNREACH)\b|Failed to fetch|NetworkError/, serviceErrorMessage('offline')],
  [/\b(ECONNREFUSED|ECONNRESET|EPIPE|ERR_CONNECTION_\w+)\b/, 'The connection was refused or dropped. Check the other computer or the internet connection and try again.'],
]

/** Text written for developers, not operators. Such a message is replaced by GENERIC_ERROR. */
const DEVELOPER_TEXT = [
  /Cannot read propert/i,
  /Cannot set propert/i,
  /is not a function/,
  /is not defined/,
  /is not iterable/,
  /(undefined|null) is not an object/,
  /Minified React error/,
  /react(js)?\.(org|dev)/,
  /Unexpected (token|end of)/,
  /\bJSON\b/,
  /Maximum call stack/,
  /\b(TypeError|ReferenceError|SyntaxError|RangeError|AssertionError|Invariant)\b/,
  /^\s*at .+:\d+:\d+/m,
  /NODE_MODULE_VERSION/,
  /^Bad [a-z]/i,
  /\bEnvelope\b/,
  /\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\b/,
]

const rawText = (error: unknown): string => {
  if (error === undefined || error === null) return ''
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string') return (error as { message: string }).message
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}

/** The plain sentence for an error, and its technical text. Pure: records nothing. */
export function describeError(error: unknown, fallback = GENERIC_ERROR): FriendlyError {
  if (typeof error === 'object' && error !== null && !(error instanceof Error) && typeof (error as { code?: unknown }).code === 'string') {
    const { code, message } = error as { code: string; message?: unknown }
    // An { code, message } from the ServiceEx client; its message was already chosen for the screen.
    if (isServiceErrorCode(code)) return { message: typeof message === 'string' && message ? message : serviceErrorMessage(code), details: `Code: ${code}` }
    // An AI or listener error: its message is a sentence too, but goes through the same checks.
    const described = describeError(typeof message === 'string' ? message : '', fallback)
    return { message: described.message, details: [`Code: ${code}`, described.details].filter(Boolean).join('\n') }
  }
  const raw = rawText(error)
  const stack = error instanceof Error && error.stack && !error.stack.includes(raw) ? `${raw}\n${error.stack}` : error instanceof Error && error.stack ? error.stack : raw
  const text = raw.replace(IPC_PREFIX, '').trim()
  const known = CODE_MESSAGES.find(([pattern]) => pattern.test(text))
  if (known) return { message: known[1], details: stack }
  if (!text || DEVELOPER_TEXT.some((pattern) => pattern.test(text))) return { message: fallback, details: stack || null }
  // A sentence ServiceEx itself wrote (such as "That song is no longer in the library"): shown as it is.
  const message = /[.!?)]$/.test(text) ? text : `${text}.`
  return { message, details: stack !== text ? stack : null }
}

/** Describes the error and records it in the diagnostics report, under the panel or action it happened in. */
export function reportError(where: string, error: unknown, fallback?: string): FriendlyError {
  const described = describeError(error, fallback)
  recordProblem(where, described.message, described.details ?? described.message)
  console.error(`${where}:`, error)
  return described
}

/** For an ErrorLike state: the sentence and the details. */
export const asFriendly = (error: ErrorLike): FriendlyError => (typeof error === 'string' ? { message: error, details: null } : error)

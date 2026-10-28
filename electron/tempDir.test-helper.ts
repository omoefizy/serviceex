// Temporary folders for tests. Windows refuses to delete a file that is still open (EBUSY) and releases handles a
// moment after they are closed, so removal retries instead of failing the test on the first attempt.
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const REMOVE_OPTIONS = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } as const

/** Creates an empty folder in the system temp folder whose name starts with `prefix`. */
export const makeTempDirSync = (prefix: string): string => mkdtempSync(path.join(tmpdir(), prefix))

export const makeTempDir = (prefix: string): Promise<string> => mkdtemp(path.join(tmpdir(), prefix))

/** Removes a file or folder and everything in it, waiting out short-lived locks on Windows. */
export const removeTempSync = (target: string): void => rmSync(target, REMOVE_OPTIONS)

export const removeTemp = (target: string): Promise<void> => rm(target, REMOVE_OPTIONS)

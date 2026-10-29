// What the operator reads when something fails: a plain sentence for known codes, never developer text, and the
// original kept for Show details and the diagnostics report.
import { beforeEach, describe, expect, it } from 'vitest'
import { serviceErrorMessage } from '../../shared/serviceErrors'
import { clearProblems, formatDiagnostics, recentProblems } from './diagnostics'
import { describeError, GENERIC_ERROR, reportError } from './errors'

const ipc = (text: string) => new Error(`Error invoking remote method 'songs:get': Error: ${text}`)

describe('describeError', () => {
  it('shows a sentence ServiceEx wrote as it is, without the IPC wrapper', () => {
    const described = describeError(ipc('That song is no longer in the library'))
    expect(described.message).toBe('That song is no longer in the library.')
    expect(described.details).toContain("Error invoking remote method 'songs:get'")
  })

  it('maps file system and database codes to plain sentences', () => {
    expect(describeError(ipc("ENOENT: no such file or directory, open '/Users/a/b.mp4'")).message).toMatch(/could not be found/)
    expect(describeError(new Error('EACCES: permission denied')).message).toMatch(/not allowed/)
    expect(describeError(new Error('ENOSPC: no space left on device')).message).toMatch(/disk is full/)
    expect(describeError(new Error('SQLITE_BUSY: database is locked')).message).toMatch(/busy/)
    expect(describeError(new Error('listen EADDRINUSE: address already in use 0.0.0.0:47800')).message).toMatch(/port/)
  })

  it('maps network failures to the offline sentence', () => {
    expect(describeError(new TypeError('Failed to fetch')).message).toBe(serviceErrorMessage('offline'))
    expect(describeError(new Error('getaddrinfo ENOTFOUND api.example.org')).message).toBe(serviceErrorMessage('offline'))
  })

  it('never shows developer text', () => {
    for (const text of [
      "Cannot read properties of null (reading 'find')",
      'items.map is not a function',
      'Minified React error #31; visit https://reactjs.org/docs/error-decoder.html?invariant=31',
      'Unexpected token < in JSON at position 0',
      'Bad WOFF2 table directory',
    ]) {
      const described = describeError(new TypeError(text))
      expect(described.message, text).toBe(GENERIC_ERROR)
      expect(described.details, text).toContain(text)
    }
  })

  it('uses the fallback given for developer text', () => {
    expect(describeError(new Error('x is not defined'), 'The slides could not be drawn.').message).toBe('The slides could not be drawn.')
  })

  it('keeps the sentence of a ServiceEx server error and notes its code', () => {
    expect(describeError({ code: 'rate_limited', message: 'Too many requests. Wait a minute and try again.' })).toEqual({
      message: 'Too many requests. Wait a minute and try again.',
      details: 'Code: rate_limited',
    })
    expect(describeError({ code: 'offline', message: '' }).message).toBe(serviceErrorMessage('offline'))
  })

  it('checks an AI error message too, and keeps its code in the details', () => {
    expect(describeError({ code: 'overloaded', message: 'Claude is busy right now. Try again shortly.' })).toEqual({
      message: 'Claude is busy right now. Try again shortly.',
      details: 'Code: overloaded',
    })
    expect(describeError({ code: 'unknown', message: 'TypeError: x is undefined' }).message).toBe(GENERIC_ERROR)
  })

  it('describes things that are not errors', () => {
    expect(describeError('The output is closed.').message).toBe('The output is closed.')
    expect(describeError(undefined).message).toBe(GENERIC_ERROR)
    expect(describeError(null).message).toBe(GENERIC_ERROR)
  })
})

describe('reportError and the diagnostics report', () => {
  beforeEach(() => clearProblems())

  it('records the sentence and the technical text', () => {
    const shown = reportError('Songs', new TypeError("Cannot read properties of undefined (reading 'title')"))
    expect(shown.message).toBe(GENERIC_ERROR)
    const [problem] = recentProblems()
    expect(problem.where).toBe('Songs')
    expect(problem.message).toBe(GENERIC_ERROR)
    expect(problem.details).toContain("Cannot read properties of undefined (reading 'title')")
  })

  it('keeps the newest 50', () => {
    for (let i = 0; i < 60; i++) reportError('Test', new Error(`Problem ${i}`))
    expect(recentProblems()).toHaveLength(50)
    expect(recentProblems()[0].message).toBe('Problem 10.')
  })

  it('formats the report with the app details and each problem with its details', () => {
    reportError('Schedule', new Error('ENOENT: no such file or directory'))
    const report = formatDiagnostics(
      { version: '1.2.3', platform: 'darwin', arch: 'arm64', osVersion: '25.1.0', electron: '38.8.6', chrome: '140', locale: 'en-GB', packaged: true },
      recentProblems(),
      new Date('2026-10-29T12:00:00Z'),
    )
    expect(report).toContain('Version: 1.2.3')
    expect(report).toContain('System: darwin 25.1.0 (arm64)')
    expect(report).toContain('Schedule: A file ServiceEx needs could not be found.')
    expect(report).toContain('    Error: ENOENT: no such file or directory')
  })

  it('says when nothing went wrong, or the app did not answer', () => {
    const report = formatDiagnostics(null, [])
    expect(report).toContain('Version: unknown')
    expect(report).toContain('No problems recorded')
  })
})

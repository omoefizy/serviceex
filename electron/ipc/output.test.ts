// The output window gets its state through the main process, which checks it: slide, ticker and lower third
// formatting must come through intact, and formatting that is malformed or does not match its words must not.
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_THEME_STYLE } from '../../shared/themes'
import type { OutputState, RichText } from '../../shared/types'

vi.mock('electron', () => ({ BrowserWindow: class {}, ipcMain: { handle() {}, on() {} } }))
vi.mock('../db/index', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { initSchema } = await import('../db/schema')
  const db = new Database(':memory:')
  initSchema(db)
  return { db }
})

const { alertDisplayOf, assertOutputState, overlayLayersOf } = await import('./output')

const RICH: RichText = { paragraphs: [{ align: 'center', spans: [{ text: 'Amazing ' }, { text: 'grace', bold: true, color: '#ffd400' }] }] }

const state = (patch: Partial<OutputState>) => ({ mode: 'show', text: 'Amazing grace', caption: '', theme: DEFAULT_THEME_STYLE, fadeMs: 300, logoUrl: null, ...patch })

describe('output state formatting', () => {
  it('keeps a slide’s formatting when it matches the slide', () => {
    expect(assertOutputState(state({ rich: RICH })).rich).toEqual(RICH)
  })

  it('drops formatting for other words, or that is not the schema', () => {
    expect(assertOutputState(state({ text: 'Other words', rich: RICH })).rich).toBeNull()
    expect(assertOutputState(state({ rich: '<b>Amazing grace</b>' as never })).rich).toBeNull()
    expect(assertOutputState(state({})).rich).toBeNull()
  })

  it('keeps the ticker’s and the lower third’s formatting', () => {
    const alert = alertDisplayOf({ runId: 1, startedAt: 0, texts: ['Amazing grace', 'Plain'], riches: [RICH, null] })
    expect(alert?.riches).toEqual([RICH, null])
    const overlays = overlayLayersOf({ logos: [], lowerThird: { runId: 1, headline: 'Amazing grace', body: 'Pastor', headlineRich: RICH, bodyRich: RICH } })
    expect(overlays?.lowerThird?.headlineRich).toEqual(RICH)
    expect(overlays?.lowerThird?.bodyRich).toBeUndefined()
  })

  it('keeps the idle design and a lower third’s design, checked as designs', () => {
    const design = { category: 'lowerThird', background: { kind: 'transparent' }, elements: [{ kind: 'text', id: 'tag', text: 'Welcome', hideWithLowerThird: true, loop: 'pulse' }] }
    const overlays = overlayLayersOf({ logos: [], idle: design, lowerThird: { runId: 1, headline: 'Pastor', body: '', design: { ...design, elements: [{ kind: 'nonsense' }] } } })
    expect(overlays?.idle?.elements[0]).toMatchObject({ text: 'Welcome', hideWithLowerThird: true, loop: 'pulse' })
    expect(overlays?.lowerThird?.design?.elements).toEqual([])
    expect(overlayLayersOf({ logos: [], idle: 'not a design' })?.idle).toBeNull()
    expect(overlayLayersOf({ logos: [], idle: { ...design, elements: [{ kind: 'text', loop: 'wobble' }] } })?.idle?.elements[0].loop).toBe('none')
  })
})

import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { writeFile } from 'node:fs/promises'
import { requireFeature } from '../../shared/features'
import { parseReference } from '../../shared/parseReference'
import { deckSlideTexts, exportFileName, rawTranscript, scriptureList, sermonDeck, sermonText, sermonTitle, SLIDE_VERSE_WORDS, type DeckSlide } from '../../shared/sermons'
import type { AiResult, AnnouncementPayload, Sermon, SermonAiOutcome, SermonAiProgress, SermonExportOptions, SermonExportResult } from '../../shared/types'
import { encryptionAvailable, fail } from '../ai/client'
import { getRange } from '../db/bible'
import {
  addScripture,
  addStatement,
  appendSegment,
  createSermon,
  deleteSermon,
  finishSermon,
  getSermon,
  listPreachers,
  listSermons,
  recoverRecordings,
  removeScripture,
  removeStatement,
  searchSermons,
  setCleanedTranscript,
  setStatementPinned,
  updateSermon,
} from '../db/sermons'
import { getAppSettings } from '../db/settings'
import { hasProviderKey, keyProvider } from '../keys'
import { signedIn } from '../service/registry'
import { mediaFilePath } from '../media'
import { cleanInChunks, jobControl, notesInChunks } from '../sermons/ai'
import { renderSermonPdf, renderSermonPptx } from '../sermons/export'

// Arguments arrive from the renderer, so check their shape before they reach the database or the disk. Transcripts
// stay on this computer: nothing here sends them anywhere except the AI buttons, which the operator presses.

function assertId(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new TypeError('Sermon id must be a positive integer')
  return value as number
}

function assertText(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new TypeError('Expected text')
  return value
}

function assertOptions(value: unknown): SermonExportOptions {
  const o = (typeof value === 'object' && value !== null ? value : {}) as Partial<Record<keyof SermonExportOptions, unknown>>
  return { summary: o.summary === true, scriptures: o.scriptures === true, transcript: o.transcript === true, cleaned: o.cleaned === true }
}

function mustGet(id: number): Sermon {
  const sermon = getSermon(id)
  if (!sermon) throw new Error('That sermon no longer exists.')
  return sermon
}

/** Asks where to save, then writes the file. A cancelled dialog is not an error. */
async function saveAs(event: IpcMainInvokeEvent, defaultPath: string, filters: Electron.FileFilter[], data: () => Promise<string | Buffer>): Promise<SermonExportResult> {
  try {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.SaveDialogOptions = { title: 'Export sermon', defaultPath, filters }
    const { canceled, filePath } = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (canceled || !filePath) return { ok: true, path: null }
    await writeFile(filePath, await data())
    return { ok: true, path: filePath }
  } catch (error) {
    console.error('Sermon export failed', error)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** The sermon's deck (see sermonDeck), each reference with its words from the local Bible when they fit on a slide. */
function deck(sermon: Sermon): DeckSlide[] {
  const version = getAppSettings().scriptureDefaultVersion
  const passages = scriptureList(sermon).map((reference) => {
    const ref = parseReference(reference)
    const verses = ref ? getRange(version, ref.book, ref.chapter, ref.verseStart ?? 1, ref.verseEnd ?? ref.verseStart ?? 1) : []
    // A whole chapter, or a passage too long for a slide, shows as its reference alone.
    const words = ref && ref.verseStart !== null ? verses.map((v) => v.text).join(' ') : ''
    return { reference: words ? `${reference} ${version}` : reference, text: words.split(/\s+/).length <= SLIDE_VERSE_WORDS ? words || null : null }
  })
  return sermonDeck(sermon, passages)
}

/** AI is on, and the chosen provider can be used: signed in to the account, or a developer key saved. Says nothing about the network. */
function aiAvailable(): boolean {
  if (!getAppSettings().aiEnabled) return false
  if (keyProvider('anthropic') === 'service') return signedIn()
  return encryptionAvailable() && hasProviderKey('anthropic')
}

/** The clean or notes job running for each sermon, so Cancel can reach it. One at a time per sermon. */
const jobs = new Map<number, { cancel(): void }>()

async function runJob(event: IpcMainInvokeEvent, id: number, job: (control: ReturnType<typeof jobControl>) => Promise<AiResult<SermonAiOutcome>>): Promise<AiResult<SermonAiOutcome>> {
  requireFeature('sermon.ai.cleanup')
  if (jobs.has(id)) return fail('bad_request', 'An AI task is already running for this sermon. Wait for it or cancel it.')
  const control = jobControl((step, done, total) => {
    const progress: SermonAiProgress = { sermonId: id, step, done, total }
    if (!event.sender.isDestroyed()) event.sender.send('sermons:aiProgress', progress)
  })
  jobs.set(id, control)
  try {
    return await job(control)
  } catch (error) {
    console.error('Sermon AI job failed', error)
    return fail('unavailable', error instanceof Error ? error.message : String(error))
  } finally {
    jobs.delete(id)
  }
}

/** Cleans the transcript a chunk at a time and saves it, keeping any chunk the AI could not do as spoken. */
function cleanTranscript(event: IpcMainInvokeEvent, id: number): Promise<AiResult<SermonAiOutcome>> {
  return runJob(event, id, async (control) => {
    const raw = rawTranscript(mustGet(id).segments)
    if (!raw) return fail('bad_request', 'This sermon has no transcript to clean.')
    const { transcript, ...outcome } = await cleanInChunks(raw, control)
    // Nothing cleaned: an error says why; a cancel before the first chunk leaves things as they were.
    if (outcome.done === 0) {
      if (outcome.error) return { ok: false, error: outcome.error }
      return { ok: true, value: { ...outcome, sermon: mustGet(id) } }
    }
    setCleanedTranscript(id, transcript)
    return { ok: true, value: { ...outcome, sermon: mustGet(id) } }
  })
}

/** Summary and key points, made from short summaries of each chunk when the sermon is long. */
function generateNotes(event: IpcMainInvokeEvent, id: number): Promise<AiResult<SermonAiOutcome>> {
  return runJob(event, id, async (control) => {
    const sermon = mustGet(id)
    const transcript = sermon.cleanedTranscript.trim() || rawTranscript(sermon.segments)
    if (!transcript) return fail('bad_request', 'This sermon has no transcript to summarise.')
    const { notes, ...outcome } = await notesInChunks(transcript, control)
    if (!notes) return { ok: true, value: { ...outcome, sermon } }
    if (!notes.ok) return notes
    // The scripture list is the sermon's own saved references, never the AI's.
    const saved = updateSermon(id, { summary: notes.value.summary, keyPoints: notes.value.points }) ?? mustGet(id)
    return { ok: true, value: { ...outcome, sermon: saved } }
  })
}

export function registerSermonIpc(): void {
  // A sermon left recording by a crash keeps what was saved and is finished now.
  const recovered = recoverRecordings()
  if (recovered > 0) console.log(`Finished ${recovered} sermon recording${recovered === 1 ? '' : 's'} left open by the last run`)

  ipcMain.handle('sermons:list', () => listSermons())
  ipcMain.handle('sermons:search', (_event, query: unknown) => searchSermons(assertText(query, 500)))
  ipcMain.handle('sermons:get', (_event, id: unknown) => getSermon(assertId(id)))
  ipcMain.handle('sermons:create', (_event, input: unknown) => {
    requireFeature('sermon.save')
    return createSermon(typeof input === 'object' && input !== null ? input : {}, getAppSettings().churchName)
  })
  ipcMain.handle('sermons:update', (_event, id: unknown, patch: unknown) => updateSermon(assertId(id), typeof patch === 'object' && patch !== null ? patch : {}))
  ipcMain.handle('sermons:delete', (_event, id: unknown) => deleteSermon(assertId(id)))
  ipcMain.handle('sermons:preachers', () => listPreachers())
  ipcMain.handle('sermons:appendSegment', (_event, id: unknown, text: unknown) => appendSegment(assertId(id), assertText(text, 10_000)))
  ipcMain.handle('sermons:addScripture', (_event, id: unknown, reference: unknown, source: unknown) =>
    addScripture(assertId(id), assertText(reference, 200), source === 'manual' ? 'manual' : 'detected'),
  )
  ipcMain.handle('sermons:removeScripture', (_event, id: unknown, scriptureId: unknown) => removeScripture(assertId(id), assertId(scriptureId)))
  ipcMain.handle('sermons:addStatement', (_event, id: unknown, text: unknown, pinned: unknown) => addStatement(assertId(id), assertText(text, 2000), pinned === true))
  ipcMain.handle('sermons:setStatementPinned', (_event, id: unknown, statementId: unknown, pinned: unknown) =>
    setStatementPinned(assertId(id), assertId(statementId), pinned === true),
  )
  ipcMain.handle('sermons:removeStatement', (_event, id: unknown, statementId: unknown) => removeStatement(assertId(id), assertId(statementId)))
  ipcMain.handle('sermons:finish', (_event, id: unknown) => finishSermon(assertId(id)))

  ipcMain.handle('sermons:exportText', (event, id: unknown, format: unknown, options: unknown) => {
    requireFeature('sermon.export.text')
    const sermon = mustGet(assertId(id))
    const md = format === 'md'
    return saveAs(
      event,
      exportFileName(sermon, md ? 'md' : 'txt'),
      [md ? { name: 'Markdown', extensions: ['md'] } : { name: 'Text', extensions: ['txt'] }],
      async () => sermonText(sermon, md ? 'md' : 'txt', assertOptions(options)),
    )
  })

  ipcMain.handle('sermons:exportPdf', (event, id: unknown, options: unknown) => {
    requireFeature('sermon.export.pdf')
    const sermon = mustGet(assertId(id))
    const { logoUrl, churchFooter } = getAppSettings()
    return saveAs(event, exportFileName(sermon, 'pdf'), [{ name: 'PDF', extensions: ['pdf'] }], () =>
      renderSermonPdf(sermon, assertOptions(options), logoUrl ? mediaFilePath(logoUrl) : null, churchFooter),
    )
  })

  // Both slide exports come from the same deck. The renderer asks before exporting one with nothing but its title.
  ipcMain.handle('sermons:exportSlides', (_event, id: unknown): AnnouncementPayload => {
    requireFeature('sermon.export.slides')
    const sermon = mustGet(assertId(id))
    // The announcement makes the title slide itself.
    return { title: sermonTitle(sermon), body: deckSlideTexts(deck(sermon)).join('\n\n'), titleSlide: true }
  })

  ipcMain.handle('sermons:exportPptx', (event, id: unknown) => {
    requireFeature('sermon.export.slides')
    const sermon = mustGet(assertId(id))
    const { logoUrl } = getAppSettings()
    return saveAs(event, exportFileName(sermon, 'pptx'), [{ name: 'PowerPoint', extensions: ['pptx'] }], () =>
      renderSermonPptx(sermonTitle(sermon), deck(sermon), logoUrl ? mediaFilePath(logoUrl) : null),
    )
  })

  ipcMain.handle('sermons:aiAvailable', () => aiAvailable())
  ipcMain.handle('sermons:cleanTranscript', (event, id: unknown) => cleanTranscript(event, assertId(id)))
  ipcMain.handle('sermons:generateNotes', (event, id: unknown) => generateNotes(event, assertId(id)))
  ipcMain.handle('sermons:cancelAi', (_event, id: unknown) => jobs.get(assertId(id))?.cancel())
}

import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { writeFile } from 'node:fs/promises'
import { requireFeature } from '../../shared/features'
import { parseReference } from '../../shared/parseReference'
import { exportFileName, rawTranscript, scriptureList, sermonSlideTexts, sermonText, sermonTitle, SLIDE_VERSE_WORDS, transcriptChunks } from '../../shared/sermons'
import type { AiResult, AnnouncementPayload, Sermon, SermonExportOptions, SermonExportResult } from '../../shared/types'
import { encryptionAvailable, fail } from '../ai/client'
import { CLEAN_CHUNK_CHARS, runTask } from '../ai/tasks'
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
import { mediaFilePath } from '../media'
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

/** The sermon's slides: key points, pinned statements, then each reference with its words from the local Bible when they fit. */
function slideTexts(sermon: Sermon): string[] {
  const version = getAppSettings().scriptureDefaultVersion
  const passages = scriptureList(sermon).map((reference) => {
    const ref = parseReference(reference)
    const verses = ref ? getRange(version, ref.book, ref.chapter, ref.verseStart ?? 1, ref.verseEnd ?? ref.verseStart ?? 1) : []
    // A whole chapter, or a passage too long for a slide, shows as its reference alone.
    const words = ref && ref.verseStart !== null ? verses.map((v) => v.text).join(' ') : ''
    return { reference: words ? `${reference} ${version}` : reference, text: words.split(/\s+/).length <= SLIDE_VERSE_WORDS ? words || null : null }
  })
  return sermonSlideTexts(sermon, passages)
}

/** AI is on, and a key is saved where the chosen provider can use it. Says nothing about the network. */
function aiAvailable(): boolean {
  return getAppSettings().aiEnabled && keyProvider('anthropic') !== 'service' && encryptionAvailable() && hasProviderKey('anthropic')
}

async function cleanTranscript(id: number): Promise<AiResult<Sermon>> {
  requireFeature('sermon.ai.cleanup')
  const sermon = mustGet(id)
  const raw = rawTranscript(sermon.segments)
  if (!raw) return fail('bad_request', 'This sermon has no transcript to clean.')
  const cleaned: string[] = []
  // One piece at a time: each answer is checked word for word against its own piece.
  for (const chunk of transcriptChunks(raw, CLEAN_CHUNK_CHARS)) {
    const answer = await runTask('cleanTranscript', { transcript: chunk })
    if (!answer.ok) return answer
    cleaned.push(answer.value.transcript)
  }
  setCleanedTranscript(id, cleaned.join('\n\n'))
  return { ok: true, value: mustGet(id) }
}

async function generateNotes(id: number): Promise<AiResult<Sermon>> {
  requireFeature('sermon.ai.cleanup')
  const sermon = mustGet(id)
  const transcript = sermon.cleanedTranscript.trim() || rawTranscript(sermon.segments)
  if (!transcript) return fail('bad_request', 'This sermon has no transcript to summarise.')
  const answer = await runTask('sermonNotes', { transcript })
  if (!answer.ok) return answer
  // The scripture list is the sermon's own saved references, never the AI's.
  return { ok: true, value: updateSermon(id, { summary: answer.value.summary, keyPoints: answer.value.points }) ?? mustGet(id) }
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

  ipcMain.handle('sermons:exportSlides', (_event, id: unknown): AnnouncementPayload | null => {
    requireFeature('sermon.export.slides')
    const sermon = mustGet(assertId(id))
    const slides = slideTexts(sermon)
    return slides.length > 0 ? { title: sermonTitle(sermon), body: slides.join('\n\n'), titleSlide: true } : null
  })

  ipcMain.handle('sermons:exportPptx', (event, id: unknown) => {
    requireFeature('sermon.export.slides')
    const sermon = mustGet(assertId(id))
    return saveAs(event, exportFileName(sermon, 'pptx'), [{ name: 'PowerPoint', extensions: ['pptx'] }], () => renderSermonPptx(sermon, slideTexts(sermon)))
  })

  ipcMain.handle('sermons:aiAvailable', () => aiAvailable())
  ipcMain.handle('sermons:cleanTranscript', (_event, id: unknown) => cleanTranscript(assertId(id)))
  ipcMain.handle('sermons:generateNotes', (_event, id: unknown) => generateNotes(assertId(id)))
}

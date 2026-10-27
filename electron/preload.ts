import { ipcRenderer, contextBridge, webUtils } from 'electron'
import type {
  AiApi,
  BibleApi,
  LivePowerPointApi,
  LivePowerPointStatus,
  LogApi,
  LowerThirdsApi,
  MediaApi,
  OutputState,
  Presentation,
  PresentationProgress,
  PresentationsApi,
  RasterizerApi,
  RasterJob,
  ServicesApi,
  SpeechApi,
  SpeechEvent,
  WhisperProgress,
  SettingsApi,
  SongFilesApi,
  SongsApi,
  StageApi,
  StageState,
  StreamApi,
  StreamState,
  ThemesApi,
  FontsApi,
  SharingApi,
  SharingEvent,
  LicenseApi,
  SermonAiProgress,
  SermonsApi,
  WorshipDeckApi,
} from '../shared/types'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

const songs: SongsApi = {
  list: (search) => ipcRenderer.invoke('songs:list', search),
  get: (id) => ipcRenderer.invoke('songs:get', id),
  create: (input) => ipcRenderer.invoke('songs:create', input),
  update: (id, input) => ipcRenderer.invoke('songs:update', id, input),
  delete: (id) => ipcRenderer.invoke('songs:delete', id),
}

const bible: BibleApi = {
  getVerse: (version, book, chapter, verse) => ipcRenderer.invoke('bible:getVerse', version, book, chapter, verse),
  getRange: (version, book, chapter, verseStart, verseEnd) =>
    ipcRenderer.invoke('bible:getRange', version, book, chapter, verseStart, verseEnd),
  searchText: (version, query) => ipcRenderer.invoke('bible:searchText', version, query),
  listBooks: () => ipcRenderer.invoke('bible:listBooks'),
  listVersions: () => ipcRenderer.invoke('bible:listVersions'),
  importVersion: (code, name) => ipcRenderer.invoke('bible:importVersion', code, name),
  removeVersion: (code) => ipcRenderer.invoke('bible:removeVersion', code),
  search: (params) => ipcRenderer.invoke('bible:search', params),
  bookStructure: (book) => ipcRenderer.invoke('bible:bookStructure', book),
  matchQuote: (text) => ipcRenderer.invoke('bible:matchQuote', text),
}

const services: ServicesApi = {
  create: (name, date) => ipcRenderer.invoke('services:create', name, date),
  list: () => ipcRenderer.invoke('services:list'),
  get: (id) => ipcRenderer.invoke('services:get', id),
  delete: (id) => ipcRenderer.invoke('services:delete', id),
  addItem: (serviceId, type, refId, payload) => ipcRenderer.invoke('services:addItem', serviceId, type, refId, payload),
  removeItem: (itemId) => ipcRenderer.invoke('services:removeItem', itemId),
  updatePayload: (itemId, payload) => ipcRenderer.invoke('services:updatePayload', itemId, payload),
  reorderItems: (serviceId, orderedItemIds) => ipcRenderer.invoke('services:reorderItems', serviceId, orderedItemIds),
}

const songFiles: SongFilesApi = {
  pickFiles: () => ipcRenderer.invoke('songFiles:pickFiles'),
  pickFolder: () => ipcRenderer.invoke('songFiles:pickFolder'),
  // Dropped File objects carry no path in the renderer since Electron 32; webUtils reads it here.
  pathForFile: (file) => webUtils.getPathForFile(file),
  scan: (paths) => ipcRenderer.invoke('songFiles:scan', paths),
  import: (songs) => ipcRenderer.invoke('songFiles:import', songs),
  export: (songIds, format) => ipcRenderer.invoke('songFiles:export', songIds, format),
}

const themes: ThemesApi = {
  list: () => ipcRenderer.invoke('themes:list'),
  create: (name, style) => ipcRenderer.invoke('themes:create', name, style),
  update: (id, name, style) => ipcRenderer.invoke('themes:update', id, name, style),
  delete: (id) => ipcRenderer.invoke('themes:delete', id),
  getDefaults: () => ipcRenderer.invoke('themes:getDefaults'),
  setDefault: (type, themeId) => ipcRenderer.invoke('themes:setDefault', type, themeId),
}

const media: MediaApi = {
  list: () => ipcRenderer.invoke('media:list'),
  import: () => ipcRenderer.invoke('media:import'),
  update: (id, name, tags) => ipcRenderer.invoke('media:update', id, name, tags),
  delete: (id) => ipcRenderer.invoke('media:delete', id),
  saveThumbnail: (id, jpeg) => ipcRenderer.invoke('media:saveThumbnail', id, jpeg),
  getSlideBackgrounds: (deckKey) => ipcRenderer.invoke('media:getSlideBackgrounds', deckKey),
  setSlideBackground: (deckKey, slideIndex, mediaId) =>
    ipcRenderer.invoke('media:setSlideBackground', deckKey, slideIndex, mediaId),
}

const presentations: PresentationsApi = {
  list: () => ipcRenderer.invoke('presentations:list'),
  pick: (kind) => ipcRenderer.invoke('presentations:pick', kind),
  pathForFile: (file) => webUtils.getPathForFile(file),
  import: (paths, mode) => ipcRenderer.invoke('presentations:import', paths, mode),
  setMode: (id, mode) => ipcRenderer.invoke('presentations:setMode', id, mode),
  setSlideUseImage: (id, index, useImage) => ipcRenderer.invoke('presentations:setSlideUseImage', id, index, useImage),
  updateNativeSlide: (id, index, style) => ipcRenderer.invoke('presentations:updateNativeSlide', id, index, style),
  detach: (id) => ipcRenderer.invoke('presentations:detach', id),
  delete: (id) => ipcRenderer.invoke('presentations:delete', id),
  openOriginal: (id) => ipcRenderer.invoke('presentations:openOriginal', id),
  engineStatus: () => ipcRenderer.invoke('presentations:engineStatus'),
  testConversion: () => ipcRenderer.invoke('presentations:testConversion'),
  onProgress(listener) {
    const handler = (_event: Electron.IpcRendererEvent, progress: PresentationProgress) => listener(progress)
    ipcRenderer.on('presentations:progress', handler)
    return () => ipcRenderer.off('presentations:progress', handler)
  },
  onUpdated(listener) {
    const handler = (_event: Electron.IpcRendererEvent, presentation: Presentation) => listener(presentation)
    ipcRenderer.on('presentations:updated', handler)
    return () => ipcRenderer.off('presentations:updated', handler)
  },
  onChanged(listener) {
    const handler = (_event: Electron.IpcRendererEvent, presentationId: number) => listener(presentationId)
    ipcRenderer.on('presentations:changed', handler)
    return () => ipcRenderer.off('presentations:changed', handler)
  },
  setLiveOptions: (id, options) => ipcRenderer.invoke('presentations:setLiveOptions', id, options),
}

const livePowerPoint: LivePowerPointApi = {
  prepare: (presentationIds) => ipcRenderer.send('livePowerPoint:prepare', presentationIds),
  sync: (target) => ipcRenderer.send('livePowerPoint:sync', target),
  next: () => ipcRenderer.invoke('livePowerPoint:next'),
  previous: () => ipcRenderer.invoke('livePowerPoint:previous'),
  panic: () => ipcRenderer.send('livePowerPoint:panic'),
  test: () => ipcRenderer.invoke('livePowerPoint:test'),
  onStatus(listener) {
    const handler = (_event: Electron.IpcRendererEvent, status: LivePowerPointStatus) => listener(status)
    ipcRenderer.on('livePowerPoint:status', handler)
    return () => ipcRenderer.off('livePowerPoint:status', handler)
  },
}

// Used only by the hidden window that draws slides.
const rasterizer: RasterizerApi = {
  onJob(listener) {
    const handler = (_event: Electron.IpcRendererEvent, job: RasterJob) => listener(job)
    ipcRenderer.on('rasterize:job', handler)
    return () => ipcRenderer.off('rasterize:job', handler)
  },
  ready: () => ipcRenderer.send('rasterize:ready'),
  page: (jobId, index, total, png, text) => ipcRenderer.send('rasterize:page', jobId, index, total, png, text),
  done: (jobId) => ipcRenderer.send('rasterize:done', jobId),
  fail: (jobId, message) => ipcRenderer.send('rasterize:fail', jobId, message),
}

const settings: SettingsApi = {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (patch) => ipcRenderer.invoke('settings:set', patch),
  listDisplays: () => ipcRenderer.invoke('settings:listDisplays'),
  pickBackupFolder: () => ipcRenderer.invoke('settings:pickBackupFolder'),
  pickLogo: () => ipcRenderer.invoke('settings:pickLogo'),
  backupNow: () => ipcRenderer.invoke('settings:backupNow'),
}

const stage: StageApi = {
  open: () => ipcRenderer.invoke('stage:open'),
  close: () => ipcRenderer.invoke('stage:close'),
  isOpen: () => ipcRenderer.invoke('stage:isOpen'),
  onOpenChange(listener) {
    const handler = (_event: Electron.IpcRendererEvent, open: boolean) => listener(open)
    ipcRenderer.on('stage:open-changed', handler)
    return () => ipcRenderer.off('stage:open-changed', handler)
  },
  send: (state) => ipcRenderer.send('stage:send', state),
  onState(listener) {
    const handler = (_event: Electron.IpcRendererEvent, state: StageState) => listener(state)
    ipcRenderer.on('stage:state', handler)
    return () => ipcRenderer.off('stage:state', handler)
  },
}

const stream: StreamApi = {
  send: (state) => ipcRenderer.send('stream:send', state),
  onState(listener) {
    const handler = (_event: Electron.IpcRendererEvent, state: StreamState) => listener(state)
    ipcRenderer.on('stream:state', handler)
    return () => ipcRenderer.off('stream:state', handler)
  },
  setOpen: (open) => ipcRenderer.invoke('stream:setOpen', open),
  isOpen: () => ipcRenderer.invoke('stream:isOpen'),
  onOpenChange(listener) {
    const handler = (_event: Electron.IpcRendererEvent, open: boolean) => listener(open)
    ipcRenderer.on('stream:open-changed', handler)
    return () => ipcRenderer.off('stream:open-changed', handler)
  },
  pickLogo: () => ipcRenderer.invoke('stream:pickLogo'),
}

const lowerThirds: LowerThirdsApi = {
  list: () => ipcRenderer.invoke('lowerThirds:list'),
  create: (name, style) => ipcRenderer.invoke('lowerThirds:create', name, style),
  update: (id, name, style) => ipcRenderer.invoke('lowerThirds:update', id, name, style),
  delete: (id) => ipcRenderer.invoke('lowerThirds:delete', id),
}

const output: WorshipDeckApi['output'] = {
  send: (state) => ipcRenderer.send('output:send', state),
  onState(listener) {
    const handler = (_event: Electron.IpcRendererEvent, state: OutputState) => listener(state)
    ipcRenderer.on('output:state', handler)
    return () => ipcRenderer.off('output:state', handler)
  },
  setOpen: (open) => ipcRenderer.invoke('output:setOpen', open),
  isOpen: () => ipcRenderer.invoke('output:isOpen'),
  onOpenChange(listener) {
    const handler = (_event: Electron.IpcRendererEvent, open: boolean) => listener(open)
    ipcRenderer.on('output:open-changed', handler)
    return () => ipcRenderer.off('output:open-changed', handler)
  },
}

// The API key goes to the main process once, in setKey, and is never sent back.
const ai: AiApi = {
  status: () => ipcRenderer.invoke('ai:status'),
  setKey: (key) => ipcRenderer.invoke('ai:setKey', key),
  clearKey: () => ipcRenderer.invoke('ai:clearKey'),
  testConnection: () => ipcRenderer.invoke('ai:test'),
  ask: (task, input) => ipcRenderer.invoke('ai:ask', task, input),
}

// The Deepgram key goes to the main process once, in setKey, and is never sent back.
const speech: SpeechApi = {
  status: () => ipcRenderer.invoke('speech:status'),
  setKey: (key) => ipcRenderer.invoke('speech:setKey', key),
  clearKey: () => ipcRenderer.invoke('speech:clearKey'),
  testConnection: () => ipcRenderer.invoke('speech:test'),
  micAccess: () => ipcRenderer.invoke('speech:micAccess'),
  start: (options) => ipcRenderer.invoke('speech:start', options),
  stop: () => ipcRenderer.invoke('speech:stop'),
  pushAudio: (chunk) => ipcRenderer.send('speech:audio', new Uint8Array(chunk)),
  setMicMuted: (muted) => ipcRenderer.send('speech:micMuted', muted === true),
  transcribeTest: (pcm) => ipcRenderer.invoke('speech:transcribeTest', new Uint8Array(pcm)),
  onEvent(listener) {
    const handler = (_event: Electron.IpcRendererEvent, message: SpeechEvent) => listener(message)
    ipcRenderer.on('speech:event', handler)
    return () => ipcRenderer.off('speech:event', handler)
  },
  whisper: {
    status: () => ipcRenderer.invoke('whisper:status'),
    download: (id) => ipcRenderer.invoke('whisper:download', id),
    cancelDownload: (id) => ipcRenderer.invoke('whisper:cancel', id),
    deleteModel: (id) => ipcRenderer.invoke('whisper:delete', id),
    onProgress(listener) {
      const handler = (_event: Electron.IpcRendererEvent, progress: WhisperProgress) => listener(progress)
      ipcRenderer.on('whisper:progress', handler)
      return () => ipcRenderer.off('whisper:progress', handler)
    },
  },
}

const log: LogApi = {
  panelError: (report) => ipcRenderer.invoke('log:panelError', report),
}

const fonts: FontsApi = {
  list: () => ipcRenderer.invoke('fonts:list'),
  import: () => ipcRenderer.invoke('fonts:import'),
  onChanged(listener) {
    const handler = () => listener()
    ipcRenderer.on('fonts:changed', handler)
    return () => ipcRenderer.off('fonts:changed', handler)
  },
}

const sharing: SharingApi = {
  status: () => ipcRenderer.invoke('sharing:status'),
  peers: () => ipcRenderer.invoke('sharing:peers'),
  paired: () => ipcRenderer.invoke('sharing:paired'),
  setTrusted: (id, trusted) => ipcRenderer.invoke('sharing:setTrusted', id, trusted),
  forget: (id) => ipcRenderer.invoke('sharing:forget', id),
  startPairing: (peerId) => ipcRenderer.invoke('sharing:startPairing', peerId),
  finishPairing: (pairingId, code) => ipcRenderer.invoke('sharing:finishPairing', pairingId, code),
  dismissPairing: (pairingId) => ipcRenderer.invoke('sharing:dismissPairing', pairingId),
  testConnection: (peerId) => ipcRenderer.invoke('sharing:testConnection', peerId),
  send: (peerId, sources) => ipcRenderer.invoke('sharing:send', peerId, sources),
  retry: (transferId) => ipcRenderer.invoke('sharing:retry', transferId),
  pathForFile: (file) => webUtils.getPathForFile(file),
  inbox: () => ipcRenderer.invoke('sharing:inbox'),
  preview: (id) => ipcRenderer.invoke('sharing:preview', id),
  accept: (id, options) => ipcRenderer.invoke('sharing:accept', id, options),
  reject: (id) => ipcRenderer.invoke('sharing:reject', id),
  exportPackage: (serviceId) => ipcRenderer.invoke('sharing:exportPackage', serviceId),
  importPackage: () => ipcRenderer.invoke('sharing:importPackage'),
  onEvent(listener) {
    const handler = (_event: Electron.IpcRendererEvent, event: SharingEvent) => listener(event)
    ipcRenderer.on('sharing:event', handler)
    return () => ipcRenderer.off('sharing:event', handler)
  },
  setAlias: (id, alias) => ipcRenderer.invoke('sharing:setAlias', id, alias),
  setDisconnected: (id, disconnected) => ipcRenderer.invoke('sharing:setDisconnected', id, disconnected),
  testSync: (peerId) => ipcRenderer.invoke('sharing:testSync', peerId),
  setLive: (info) => ipcRenderer.send('sharing:setLive', info),
  sendCue: (peerId, cue) => ipcRenderer.invoke('sharing:sendCue', peerId, cue),
  cues: () => ipcRenderer.invoke('sharing:cues'),
  dismissCue: (id) => ipcRenderer.invoke('sharing:dismissCue', id),
  sharedService: () => ipcRenderer.invoke('sharing:sharedService'),
  hostService: (name, items) => ipcRenderer.invoke('sharing:hostService', name, items),
  joinService: (peerId) => ipcRenderer.invoke('sharing:joinService', peerId),
  leaveService: () => ipcRenderer.invoke('sharing:leaveService'),
  addSharedItems: (items) => ipcRenderer.invoke('sharing:addSharedItems', items),
  updateSharedItem: (id, patch) => ipcRenderer.invoke('sharing:updateSharedItem', id, patch),
  librarySync: () => ipcRenderer.invoke('sharing:librarySync'),
  syncLibraryNow: () => ipcRenderer.invoke('sharing:syncLibraryNow'),
}

const license: LicenseApi = {
  status: () => ipcRenderer.invoke('license:status'),
  entitlements() {
    try {
      return ipcRenderer.sendSync('license:entitlements')
    } catch {
      return null
    }
  },
}

const sermons: SermonsApi = {
  list: () => ipcRenderer.invoke('sermons:list'),
  search: (query) => ipcRenderer.invoke('sermons:search', query),
  get: (id) => ipcRenderer.invoke('sermons:get', id),
  create: (input) => ipcRenderer.invoke('sermons:create', input),
  update: (id, patch) => ipcRenderer.invoke('sermons:update', id, patch),
  delete: (id) => ipcRenderer.invoke('sermons:delete', id),
  preachers: () => ipcRenderer.invoke('sermons:preachers'),
  appendSegment: (id, text) => ipcRenderer.invoke('sermons:appendSegment', id, text),
  addScripture: (id, reference, source) => ipcRenderer.invoke('sermons:addScripture', id, reference, source),
  removeScripture: (id, scriptureId) => ipcRenderer.invoke('sermons:removeScripture', id, scriptureId),
  addStatement: (id, text, pinned) => ipcRenderer.invoke('sermons:addStatement', id, text, pinned),
  setStatementPinned: (id, statementId, pinned) => ipcRenderer.invoke('sermons:setStatementPinned', id, statementId, pinned),
  removeStatement: (id, statementId) => ipcRenderer.invoke('sermons:removeStatement', id, statementId),
  finish: (id) => ipcRenderer.invoke('sermons:finish', id),
  exportText: (id, format, options) => ipcRenderer.invoke('sermons:exportText', id, format, options),
  exportPdf: (id, options) => ipcRenderer.invoke('sermons:exportPdf', id, options),
  exportSlides: (id) => ipcRenderer.invoke('sermons:exportSlides', id),
  exportPptx: (id) => ipcRenderer.invoke('sermons:exportPptx', id),
  aiAvailable: () => ipcRenderer.invoke('sermons:aiAvailable'),
  cleanTranscript: (id) => ipcRenderer.invoke('sermons:cleanTranscript', id),
  generateNotes: (id) => ipcRenderer.invoke('sermons:generateNotes', id),
  cancelAi: (id) => ipcRenderer.invoke('sermons:cancelAi', id),
  onAiProgress(listener) {
    const handler = (_event: Electron.IpcRendererEvent, progress: SermonAiProgress) => listener(progress)
    ipcRenderer.on('sermons:aiProgress', handler)
    return () => ipcRenderer.off('sermons:aiProgress', handler)
  },
}

const api: WorshipDeckApi = {
  songs,
  bible,
  services,
  songFiles,
  themes,
  media,
  settings,
  stage,
  ai,
  speech,
  stream,
  lowerThirds,
  presentations,
  livePowerPoint,
  rasterizer,
  log,
  fonts,
  sharing,
  license,
  sermons,
  onToggleHighlight(listener) {
    const handler = () => listener()
    ipcRenderer.on('highlight:toggle', handler)
    return () => ipcRenderer.off('highlight:toggle', handler)
  },
  onScriptureSize(listener) {
    const handler = (_event: Electron.IpcRendererEvent, step: 1 | -1) => listener(step)
    ipcRenderer.on('scripture:size', handler)
    return () => ipcRenderer.off('scripture:size', handler)
  },
  output,
}
contextBridge.exposeInMainWorld('api', api)

import { ipcRenderer, contextBridge, webUtils } from 'electron'
import type {
  AiApi,
  BibleApi,
  LivePowerPointApi,
  LivePowerPointStatus,
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
  import: (paths) => ipcRenderer.invoke('presentations:import', paths),
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
  start: () => ipcRenderer.invoke('speech:start'),
  stop: () => ipcRenderer.invoke('speech:stop'),
  pushAudio: (chunk) => ipcRenderer.send('speech:audio', new Uint8Array(chunk)),
  setMicMuted: (muted) => ipcRenderer.send('speech:micMuted', muted === true),
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
  output,
}
contextBridge.exposeInMainWorld('api', api)

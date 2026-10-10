import { ipcRenderer, contextBridge, webUtils } from 'electron'
import type {
  BibleApi,
  OutputState,
  ServicesApi,
  SongFilesApi,
  SongsApi,
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
  pickMedia: (kind) => ipcRenderer.invoke('themes:pickMedia', kind),
}

const output: WorshipDeckApi['output'] = {
  send: (state) => ipcRenderer.send('output:send', state),
  onState(listener) {
    const handler = (_event: Electron.IpcRendererEvent, state: OutputState) => listener(state)
    ipcRenderer.on('output:state', handler)
    return () => ipcRenderer.off('output:state', handler)
  },
}

const api: WorshipDeckApi = { songs, bible, services, songFiles, themes, output }
contextBridge.exposeInMainWorld('api', api)

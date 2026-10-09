import { ipcRenderer, contextBridge } from 'electron'
import type { BibleApi, OutputState, SongsApi, WorshipDeckApi } from '../shared/types'

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

const output: WorshipDeckApi['output'] = {
  send: (state) => ipcRenderer.send('output:send', state),
  onState(listener) {
    const handler = (_event: Electron.IpcRendererEvent, state: OutputState) => listener(state)
    ipcRenderer.on('output:state', handler)
    return () => ipcRenderer.off('output:state', handler)
  },
}

const api: WorshipDeckApi = { songs, bible, output }
contextBridge.exposeInMainWorld('api', api)

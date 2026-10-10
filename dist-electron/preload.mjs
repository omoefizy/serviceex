"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args) {
    const [channel, listener] = args;
    return electron.ipcRenderer.on(channel, (event, ...args2) => listener(event, ...args2));
  },
  off(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.off(channel, ...omit);
  },
  send(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.send(channel, ...omit);
  },
  invoke(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.invoke(channel, ...omit);
  }
  // You can expose other APTs you need here.
  // ...
});
const songs = {
  list: (search) => electron.ipcRenderer.invoke("songs:list", search),
  get: (id) => electron.ipcRenderer.invoke("songs:get", id),
  create: (input) => electron.ipcRenderer.invoke("songs:create", input),
  update: (id, input) => electron.ipcRenderer.invoke("songs:update", id, input),
  delete: (id) => electron.ipcRenderer.invoke("songs:delete", id)
};
const bible = {
  getVerse: (version, book, chapter, verse) => electron.ipcRenderer.invoke("bible:getVerse", version, book, chapter, verse),
  getRange: (version, book, chapter, verseStart, verseEnd) => electron.ipcRenderer.invoke("bible:getRange", version, book, chapter, verseStart, verseEnd),
  searchText: (version, query) => electron.ipcRenderer.invoke("bible:searchText", version, query),
  listBooks: () => electron.ipcRenderer.invoke("bible:listBooks")
};
const services = {
  create: (name, date) => electron.ipcRenderer.invoke("services:create", name, date),
  list: () => electron.ipcRenderer.invoke("services:list"),
  get: (id) => electron.ipcRenderer.invoke("services:get", id),
  delete: (id) => electron.ipcRenderer.invoke("services:delete", id),
  addItem: (serviceId, type, refId, payload) => electron.ipcRenderer.invoke("services:addItem", serviceId, type, refId, payload),
  removeItem: (itemId) => electron.ipcRenderer.invoke("services:removeItem", itemId),
  reorderItems: (serviceId, orderedItemIds) => electron.ipcRenderer.invoke("services:reorderItems", serviceId, orderedItemIds)
};
const songFiles = {
  pickFiles: () => electron.ipcRenderer.invoke("songFiles:pickFiles"),
  pickFolder: () => electron.ipcRenderer.invoke("songFiles:pickFolder"),
  // Dropped File objects carry no path in the renderer since Electron 32; webUtils reads it here.
  pathForFile: (file) => electron.webUtils.getPathForFile(file),
  scan: (paths) => electron.ipcRenderer.invoke("songFiles:scan", paths),
  import: (songs2) => electron.ipcRenderer.invoke("songFiles:import", songs2),
  export: (songIds, format) => electron.ipcRenderer.invoke("songFiles:export", songIds, format)
};
const output = {
  send: (state) => electron.ipcRenderer.send("output:send", state),
  onState(listener) {
    const handler = (_event, state) => listener(state);
    electron.ipcRenderer.on("output:state", handler);
    return () => electron.ipcRenderer.off("output:state", handler);
  }
};
const api = { songs, bible, services, songFiles, output };
electron.contextBridge.exposeInMainWorld("api", api);

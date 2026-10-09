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
const output = {
  send: (state) => electron.ipcRenderer.send("output:send", state),
  onState(listener) {
    const handler = (_event, state) => listener(state);
    electron.ipcRenderer.on("output:state", handler);
    return () => electron.ipcRenderer.off("output:state", handler);
  }
};
const api = { songs, bible, output };
electron.contextBridge.exposeInMainWorld("api", api);

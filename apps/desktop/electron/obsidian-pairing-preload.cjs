const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('obsidianPairing', Object.freeze({
  submit: code => ipcRenderer.invoke('desktop:obsidian-pairing-code', code),
}));

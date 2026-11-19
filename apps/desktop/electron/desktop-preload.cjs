const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('localDesktop', Object.freeze({
  call: (name, payload) => ipcRenderer.invoke('desktop-local', name, payload),
  onPreferences(callback) {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('desktop:preferences', listener);
    return () => ipcRenderer.removeListener('desktop:preferences', listener);
  },
}));

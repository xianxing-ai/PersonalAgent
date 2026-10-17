const {contextBridge, ipcRenderer} = require('electron');
for (const type of ['error', 'unhandledrejection']) window.addEventListener(type, () => {
  ipcRenderer.invoke('desktop-local', 'renderer-error', type).catch(() => {});
});
contextBridge.exposeInMainWorld('desktop', Object.freeze({
  openSettings: () => ipcRenderer.invoke('desktop-local', 'open'),
  preferences: () => ipcRenderer.invoke('desktop-local', 'preferences'),
  subscribePreferences: listener => {
    const receive = (_event, value) => listener(value);
    ipcRenderer.on('desktop:preferences', receive);
    return () => ipcRenderer.removeListener('desktop:preferences', receive);
  },
  invoke: (action, payload) => ipcRenderer.invoke('desktop:action', action, payload),
  onAudioLevel: listener => {
    if(typeof listener!=='function')throw Error('Audio level listener required');
    const receive=(_event,value)=>{if(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1)listener(value);};
    ipcRenderer.on('desktop:audio-level',receive);
    return ()=>ipcRenderer.removeListener('desktop:audio-level',receive);
  },
  onDictation: listener => {
    const receive = (_event, result) => listener(result);
    ipcRenderer.on('desktop:dictation-result', receive);
    return () => ipcRenderer.removeListener('desktop:dictation-result', receive);
  },
  subscribe: (listener) => {
    const receive = (_event, value) => listener(value);
    ipcRenderer.on('desktop:update', receive);
    return () => ipcRenderer.removeListener('desktop:update', receive);
  },
  microphone: Object.freeze({
    onCommand: listener => {
      const receive = (_event, command) => listener(command);
      ipcRenderer.on('desktop:microphone-command', receive);
      return () => ipcRenderer.removeListener('desktop:microphone-command', receive);
    },
    report: message => ipcRenderer.send('desktop:microphone-event', message),
  }),
  sisPlayback: Object.freeze({
    onCommand: listener => {
      const receive = (_event, command) => listener(command);
      ipcRenderer.on('desktop:voice-playback-command', receive);
      return () => ipcRenderer.removeListener('desktop:voice-playback-command', receive);
    },
    report: message => ipcRenderer.send('desktop:voice-playback-event', message),
  }),
  livePlayback: Object.freeze({
    onCommand: listener => {
      const receive = (_event, command) => listener(command);
      ipcRenderer.on('desktop:live-command', receive);
      return () => ipcRenderer.removeListener('desktop:live-command', receive);
    },
    report: message => ipcRenderer.send('desktop:live-event', message),
  }),
}));

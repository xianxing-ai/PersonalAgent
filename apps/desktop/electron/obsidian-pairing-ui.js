import {fileURLToPath} from 'node:url';

/** Dedicated secret-entry window. The regular Renderer never receives the code. */
export function createObsidianPairingUI({BrowserWindow, ipcMain, dialog, owner}) {
  let current, closed = false;
  const channel = 'desktop:obsidian-pairing-code';
  ipcMain.handle(channel, (event, code) => {
    if (!current || event.sender !== current.window.webContents || event.senderFrame !== event.sender.mainFrame) throw Error('配对窗口无效');
    if (typeof code !== 'string' || code.length > 4096 || !/^PA1\.[A-Za-z0-9_-]+$/.test(code)) return false;
    current.finish(code); return true;
  });
  return {
    requestCode(signal) {
      if (closed || current || signal.aborted || !owner() || owner().isDestroyed()) return Promise.reject(Error('配对窗口不可用'));
      return new Promise(resolve => {
        const window = new BrowserWindow({parent: owner(), modal: true, width: 560, height: 400,
          title: 'Obsidian 本机配对', show: false, autoHideMenuBar: true,
          webPreferences: {preload: fileURLToPath(new URL('./obsidian-pairing-preload.cjs', import.meta.url)),
            contextIsolation: true, sandbox: true, nodeIntegration: false, partition: 'obsidian-pairing'}});
        const finish = code => {
          if (current?.window !== window) return;
          current = undefined; clearTimeout(timer); signal.removeEventListener('abort', cancel);
          resolve(code); if (!window.isDestroyed()) window.destroy();
        };
        const cancel = () => finish(undefined), timer = setTimeout(cancel, 120_000);
        current = {window, finish}; signal.addEventListener('abort', cancel, {once: true});
        window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        window.webContents.session.setPermissionCheckHandler(() => false);
        window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
        window.webContents.on('will-navigate', event => event.preventDefault());
        window.webContents.on('will-redirect', event => event.preventDefault());
        window.on('closed', cancel); window.webContents.on('render-process-gone', cancel);
        window.once('ready-to-show', () => {if (!window.isDestroyed()) window.show();});
        void window.loadFile(fileURLToPath(new URL('../src/pairing/index.html', import.meta.url))).catch(cancel);
      });
    },
    async confirm({peer, signal, displayName}) {
      const parent = owner();
      if (closed || signal.aborted || !parent || parent.isDestroyed()) return false;
      const result = await dialog.showMessageBox(parent, {type: 'question', title: '确认 Obsidian 配对',
        message: '允许这个插件会话读取所选知识库？',
        detail: `所选知识库：${displayName}\n插件文件夹：${peer.folder}\n仅私人、本机、只读，最多 15 分钟。\n配对不授权笔记写入、保存长期记忆或云端发送。`,
        buttons: ['确认只读配对', '取消'], defaultId: 1, cancelId: 1, noLink: true, signal});
      return result.response === 0 && !signal.aborted && !parent.isDestroyed();
    },
    close() {closed = true; current?.finish(undefined); ipcMain.removeHandler(channel);},
  };
}

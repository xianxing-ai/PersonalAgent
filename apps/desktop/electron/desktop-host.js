import {app, BrowserWindow, dialog, globalShortcut, ipcMain, screen, shell} from 'electron';
import {mkdirSync, appendFileSync, readFileSync, statSync, renameSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DesktopState, fitBounds, snapBounds} from './desktop-state.js';
import {placeOrb} from './placement.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
export function createDesktopHost() {
  const state = new DesktopState(path.join(app.getPath('userData'), 'desktop-state.json'));
  const logFile = path.join(app.getPath('userData'), 'logs', 'desktop.log');
  const windows = new Map();
  let settingsWindow;
  let recoveryPrompt = false;
  async function recover(win, mode) {
    if (mode !== 'desktop-settings') { openSettings(); return; }
    if (recoveryPrompt || win.isDestroyed()) return;
    recoveryPrompt = true;
    try {
      const {response} = await dialog.showMessageBox({type: 'warning', title: 'PersonalAgent', message: '桌面设置未响应或已中断 / Desktop settings interrupted', detail: '重新加载会丢失未保存的设置。Reload discards unsaved settings.', buttons: ['重新加载 / Reload', '取消 / Cancel'], defaultId: 1, cancelId: 1});
      if (response === 0 && !win.isDestroyed()) win.webContents.reload();
    } finally { recoveryPrompt = false; }
  }
  const accelerator = 'CommandOrControl+Shift+Space';
  function shortcut(enabled) {
    if (enabled && !globalShortcut.isRegistered(accelerator) && !globalShortcut.register(accelerator, () => {
      const target = [...windows.values()].find(item => item.mode === 'orb');
      if (target) { target.win.show(); target.win.focus(); } else openSettings();
    })) throw Error('Ctrl+Shift+Space is already used by another application');
    if (!enabled) globalShortcut.unregister(accelerator);
  }
  app.on('will-quit', () => globalShortcut.unregister(accelerator));
  function log(event, mode, detail = '') {
    try {
      mkdirSync(path.dirname(logFile), {recursive: true});
      if (statSync(logFile, {throwIfNoEntry: false})?.size > 256 * 1024) renameSync(logFile, logFile + '.previous');
      // Only host-owned event labels and allowlisted diagnostic fields; never page messages or task text.
      appendFileSync(logFile, JSON.stringify({time: new Date().toISOString(), event, window: mode, detail}) + '\n');
    } catch { /* Diagnostics must not take down desktop windows. */ }
  }
  function logAgentArtsFailure(receipt) {
    const stages = new Set(['authorization', 'catalog_guard', 'export_guard', 'transport',
      'http_response', 'response_body', 'response_schema', 'application_schema']);
    const codes = new Set(['INVALID_ARGUMENT', 'UNSUPPORTED_CAPABILITY', 'UNAUTHORIZED',
      'EXTERNAL_FAILURE', 'CANCELLED', 'TIMEOUT']);
    if (!receipt || !stages.has(receipt.stage) || !codes.has(receipt.code)) return;
    const detail = {stage: receipt.stage, code: receipt.code};
    if (typeof receipt.requestId === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receipt.requestId)) {
      detail.requestId = receipt.requestId;
    }
    if (Number.isInteger(receipt.httpStatus) && receipt.httpStatus >= 100
      && receipt.httpStatus <= 599) detail.httpStatus = receipt.httpStatus;
    if (['json', 'sse', 'missing', 'other'].includes(receipt.contentType)) detail.contentType = receipt.contentType;
    if (typeof receipt.terminalEvents?.taskEnd === 'boolean'
      && typeof receipt.terminalEvents?.end === 'boolean') {
      detail.terminalEvents = {taskEnd: receipt.terminalEvents.taskEnd, end: receipt.terminalEvents.end};
    }
    if (['body_limit', 'body_shape', 'utf8', 'content_type', 'event_order', 'event_shape',
      'provider_failure', 'no_text', 'json_shape', 'application_json',
      'application_contract', 'other'].includes(receipt.schemaCategory)) {
      detail.schemaCategory = receipt.schemaCategory;
    }
    if (detail.schemaCategory === 'provider_failure') {
      if (['event', 'type', 'status', 'data.event', 'data.type', 'data.status']
        .includes(receipt.providerFailureField)) detail.providerFailureField = receipt.providerFailureField;
      if (['error', 'failed', 'failure'].includes(receipt.providerFailureToken)) {
        detail.providerFailureToken = receipt.providerFailureToken;
      }
      if (typeof receipt.providerErrorCode === 'string'
        && /^[A-Z][A-Z0-9_]{1,31}\.[0-9]{3,8}$/.test(receipt.providerErrorCode)) {
        detail.providerErrorCode = receipt.providerErrorCode;
      }
    }
    log('agentarts-failure', 'runtime', JSON.stringify(detail));
  }
  function area(bounds) { return screen.getDisplayMatching(bounds).workArea; }
  function restore(mode, fallback) {
    const saved = state.value.windows[mode];
    if (!saved) return fallback;
    const bounds = mode === 'orb' ? {...saved, width: fallback.width, height: fallback.height} : saved;
    return fitBounds(bounds, area(bounds));
  }
  function attach(win, mode) {
    const contentsId = win.webContents.id;
    windows.set(contentsId, {win, mode});
    const publishWindowState = () => {
      if (['admin','workspace'].includes(mode) && !win.isDestroyed()) {
        win.webContents.send('desktop:window-state', {maximized:win.isMaximized()});
      }
    };
    win.on('maximize', publishWindowState);
    win.on('unmaximize', publishWindowState);
    win.on('restore', publishWindowState);
    let saveTimer;
    const save = () => {
      if (mode === 'panel' || win.isDestroyed() || win.isMinimized()) return;
      try { state.remember(mode, win.getNormalBounds()); } catch { log('settings-write-failed', mode); }
    };
    const changed = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 200); };
    win.on('move', changed);
    win.on('resize', changed);
    win.on('close', save);
    win.on('closed', () => { clearTimeout(saveTimer); windows.delete(contentsId); });
    win.webContents.on('did-finish-load', () => {
      const fontScale = state.value.settings.fontScale;
      if (!['orb', 'panel'].includes(mode) && win.webContents.getZoomFactor() !== fontScale) {
        win.webContents.setZoomFactor(fontScale);
      }
      log('loaded', mode);
      publishWindowState();
    });
    win.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => { if (mainFrame) log('load-failed', mode, String(code)); });
    win.webContents.on('render-process-gone', (_event, details) => {
      log('renderer-gone', mode, details.reason);
      // Recovery stays explicit: never reload a form behind the user's back.
      void recover(win, mode);
    });
    win.on('unresponsive', () => { log('unresponsive', mode); void recover(win, mode); });
    if (mode === 'orb' || mode === 'panel') win.setAlwaysOnTop(state.value.settings.alwaysOnTop);
    log('created', mode);
  }
  function openSettings() {
    if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.restore(); settingsWindow.show(); settingsWindow.focus(); return; }
    const display = screen.getPrimaryDisplay().workArea;
    settingsWindow = new BrowserWindow({...restore('desktop-settings', {width: Math.min(780, display.width), height: Math.min(700, display.height)}), title: 'PersonalAgent · 桌面设置', autoHideMenuBar: true,
      webPreferences: {preload: path.join(dir, 'desktop-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false}});
    attach(settingsWindow, 'desktop-settings');
    settingsWindow.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    settingsWindow.webContents.on('will-navigate', event => event.preventDefault());
    settingsWindow.loadFile(path.join(dir, '../src/desktop-settings/index.html'));
  }
  ipcMain.handle('desktop-local', async (event, name, payload) => {
    const owner = windows.get(event.sender.id);
    if (!owner || event.senderFrame !== owner.win.webContents.mainFrame) throw Error('Untrusted desktop sender');
    if (name === 'open') { openSettings(); return; }
    if (name === 'preferences') return {settings: state.value.settings, locale: app.getLocale()};
    if (name === 'window-state') {
      if (!['admin','workspace'].includes(owner.mode)) throw Error('Window controls unavailable for this window');
      return {maximized:owner.win.isMaximized()};
    }
    if (name === 'renderer-error') { log('renderer-error', owner.mode, ['error','unhandledrejection'].includes(payload) ? payload : 'unknown'); return; }
    if (owner.mode !== 'desktop-settings') throw Error('Desktop settings window required');
    if (name === 'read') {
      let logs = '';
      try { logs = readFileSync(logFile, 'utf8').split('\n').slice(-80).join('\n'); } catch {}
      return {settings: state.value.settings, locale: app.getLocale(), version: app.getVersion(), electron: process.versions.electron, platform: process.platform, arch: process.arch,
        displays: screen.getAllDisplays().map(display => ({width: display.workArea.width, height: display.workArea.height, scale: display.scaleFactor})),
        windows: [...windows.values()].filter(item => item.mode !== 'desktop-settings').map(({win, mode}) => ({id: win.webContents.id, mode, visible: win.isVisible()})), logs};
    }
    if (name === 'save') {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('Invalid desktop settings');
      const before = {...state.value.settings};
      const settings = state.update(payload);
      try { shortcut(settings.shortcut); } catch (error) { state.update(before); throw error; }
      for (const {win, mode} of windows.values()) {
        if (mode === 'orb' || mode === 'panel') win.setAlwaysOnTop(settings.alwaysOnTop);
        else if (win.webContents.getZoomFactor() !== settings.fontScale) win.webContents.setZoomFactor(settings.fontScale);
        if (mode === 'admin' || mode === 'workspace') win.webContents.send('desktop:preferences', {settings, locale:app.getLocale()});
      }
      log('settings-saved', 'desktop-settings');
      return settings;
    }
    if (name === 'logs') return shell.openPath(path.dirname(logFile));
    if (name === 'window') {
      const target = windows.get(payload?.id);
      if (!target || !['show', 'reload', 'minimize', 'maximize'].includes(payload?.action)) throw Error('Unknown desktop window action');
      if (payload.action === 'reload') { target.win.webContents.reload(); log('manual-reload', target.mode); }
      if (payload.action === 'show') { target.win.restore(); target.win.show(); target.win.focus(); }
      if (payload.action === 'minimize') target.win.minimize();
      if (payload.action === 'maximize' && !['orb', 'panel'].includes(target.mode)) { if (target.win.isMaximized()) target.win.unmaximize(); else target.win.maximize(); }
      return;
    }
    throw Error('Unknown desktop action');
  });
  function reposition() {
    for (const {win, mode} of windows.values()) {
      if (mode === 'panel' || win.isDestroyed()) continue;
      const current = mode === 'orb' ? win.getContentBounds() : win.getNormalBounds();
      const bounds = fitBounds(current, area(current));
      if (mode === 'orb') placeOrb(win, bounds);
      else if (!win.isMaximized()) win.setBounds(bounds);
    }
  }
  screen.on('display-removed', reposition);
  screen.on('display-metrics-changed', reposition);
  try { shortcut(state.value.settings.shortcut); } catch { state.update({shortcut:false}); log('shortcut-unavailable','desktop-settings'); }
  return {attach, restore, openSettings, logAgentArtsFailure,
    hasSavedBounds: mode => Boolean(state.value.windows[mode]),
    logVoicePlayback(phase) {
      if (['dispatched','decoding','resuming','started','completed','stopped','error','release_failed'].includes(phase)) {
        log('voice-playback', 'panel', phase);
      }
    },
    get settings() { return state.value.settings; },
    get userNamespace() { return state.ensureHostUserNamespace(); },
    snap(win) {
      if (!state.value.settings.snap) return;
      const isOrb = windows.get(win.webContents.id)?.mode === 'orb';
      const current = isOrb ? win.getContentBounds() : win.getBounds();
      const bounds = snapBounds(current, area(current));
      if (isOrb) placeOrb(win, bounds); else win.setPosition(bounds.x, bounds.y);
    },
  };
}

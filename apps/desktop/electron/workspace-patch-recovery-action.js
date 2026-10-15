import {createWorkspacePatchRecoveryHost} from './workspace-patch-recovery-host.js';

/** Shared by the production IPC route and isolated Electron acceptance fixture. */
export function createWorkspacePatchRecoveryAction({getApplication, getAdmin, isEnabled, publish}) {
  return async (event, payload) => {
    const application = getApplication(), admin = getAdmin();
    const authorized = () => Boolean(admin && !admin.isDestroyed() && admin === getAdmin()
      && admin.webContents === event.sender && event.senderFrame === admin.webContents.mainFrame
      && application === getApplication() && isEnabled());
    const result = await createWorkspacePatchRecoveryHost({application, isAuthorized: authorized}).reconcile(payload);
    await publish();
    if (!authorized()) throw Error('核实会话已失效，请刷新任务状态后重试。');
    return result;
  };
}

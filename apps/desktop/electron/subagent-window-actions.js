/** Child readers are bound by the host; they never inherit the main window's actions. */
export async function handleSubagentWindowAction({event,name,payload,record,readDetail,openMain}) {
  const win=record.window;
  if(win.isDestroyed()||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('子对话窗口不可信');
  if(payload!==undefined)throw Error('子对话读取不接受任务替换参数');
  if(name==='subagentConversation.snapshot')return readDetail(record.binding);
  if(name==='subagentConversation.close'){win.close();return;}
  if(name==='subagentConversation.main'){await openMain();return;}
  throw Error('子对话仅允许读取、关闭或返回主对话');
}

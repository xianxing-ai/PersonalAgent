/** Final metadata write before Electron destroys a renderer. No task or credential authority. */
export function flushConversationDrafts(event,entries,{panel,workspace,conversations}){
  const surface=event.sender===panel?.webContents?'panel':event.sender===workspace?.webContents?'workspace':undefined;
  if(!surface||event.senderFrame!==event.sender.mainFrame||!conversations)throw Error('关闭草稿来源无效');
  conversations.flushDrafts(surface,entries);
}

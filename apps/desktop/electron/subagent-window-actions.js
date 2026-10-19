/** Child conversations are host-bound; they never inherit arbitrary main-window actions. */
export async function handleSubagentWindowAction({event,name,payload,record,readDetail,openMain,submit,cancel}) {
  const win=record.window;
  if(win.isDestroyed()||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('子对话窗口不可信');
  const exact=(allowed)=>payload&&typeof payload==='object'&&!Array.isArray(payload)&&Object.keys(payload).every(key=>allowed.includes(key));
  if(name==='subagentConversation.submit'){
    if(!exact(['text','requestId'])||typeof payload.text!=='string'||!payload.text.trim()
      ||typeof payload.requestId!=='string'||!payload.requestId.trim()||typeof submit!=='function')throw Error('子对话消息参数无效');
    return submit(record.binding,payload);
  }
  if(name==='subagentConversation.cancel'){
    if(!exact(['taskId'])||typeof payload.taskId!=='string'||!payload.taskId.trim()||typeof cancel!=='function')throw Error('子对话停止参数无效');
    return cancel(record.binding,payload.taskId);
  }
  if(payload!==undefined)throw Error('子对话读取不接受任务替换参数');
  if(name==='subagentConversation.snapshot')return readDetail(record.binding);
  if(name==='subagentConversation.close'){win.close();return;}
  if(name==='subagentConversation.main'){await openMain();return;}
  throw Error('子对话不支持此操作');
}

/** The all-conversations window may page local history and open a validated child, never execute work. */
export async function handleSubagentListAction({event,name,payload,window,list,open}) {
  if(window.isDestroyed()||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw Error('子对话列表窗口不可信');
  const exact=keys=>payload&&typeof payload==='object'&&!Array.isArray(payload)&&Object.keys(payload).every(key=>keys.includes(key));
  if(name==='subagentConversations.list'){
    if(payload!==undefined&&(!exact(['cursor'])||(payload.cursor!==undefined&&typeof payload.cursor!=='string')))throw Error('子对话分页参数无效');
    return list(payload??{});
  }
  if(name==='subagentConversations.open'){
    if(!exact(['parentTaskId','taskId'])||typeof payload.parentTaskId!=='string'||!payload.parentTaskId.trim()
      ||typeof payload.taskId!=='string'||!payload.taskId.trim())throw Error('子对话定位参数无效');
    return open(payload);
  }
  if(name==='subagentConversations.close'&&payload===undefined){window.close();return;}
  throw Error('子对话列表不支持此操作');
}

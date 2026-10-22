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

/** Inline workspace tabs consume the same child ports with an explicit immutable binding. */
export async function handleWorkspaceSubagentAction({event,name,payload,window,readDetail,submit,cancel}) {
  if(!window||window.isDestroyed()||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)
    throw Error('工作区子对话窗口不可信');
  const actions={'workspace.subagent.snapshot':'subagentConversation.snapshot','workspace.subagent.submit':'subagentConversation.submit','workspace.subagent.cancel':'subagentConversation.cancel'};
  const mapped=actions[name],exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
  if(!mapped||!exact(payload,mapped==='subagentConversation.snapshot'?['binding']:['binding','request'])
    ||!exact(payload.binding,['parentTaskId','taskId'])
    ||!['parentTaskId','taskId'].every(key=>typeof payload.binding[key]==='string'&&payload.binding[key].trim()===payload.binding[key]&&payload.binding[key]))
    throw Error('工作区子对话参数无效');
  const binding=Object.freeze({parentTaskId:payload.binding.parentTaskId,taskId:payload.binding.taskId});
  // Revalidate the original parent-child relationship for every operation.
  const detail=await readDetail(binding);
  if(detail?.parentTaskId!==binding.parentTaskId||detail?.taskId!==binding.taskId)throw Error('子对话记录与原任务绑定不一致');
  if(mapped==='subagentConversation.snapshot')return detail;
  return handleSubagentWindowAction({event,name:mapped,payload:payload.request,record:{window,binding},readDetail,submit,cancel});
}

/** The all-conversations window may page local history and open a validated child, never execute work. */
export async function handleSubagentListAction({event,name,payload,window,list,open,collapse}) {
  if(window.isDestroyed()||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw Error('子对话列表窗口不可信');
  const exact=keys=>payload&&typeof payload==='object'&&!Array.isArray(payload)&&Object.keys(payload).every(key=>keys.includes(key));
  if(name==='subagentConversations.list'){
    if(payload!==undefined&&(!exact(['cursor'])||(payload.cursor!==undefined&&typeof payload.cursor!=='string')))throw Error('子对话分页参数无效');
    return list(payload??{});
  }
  if(name==='subagentConversations.collapseAll'){
    if(payload!==undefined||typeof collapse!=='function')throw Error('子对话收起参数无效');
    return collapse();
  }
  if(name==='subagentConversations.open'){
    if(!exact(['parentTaskId','taskId'])||typeof payload.parentTaskId!=='string'||!payload.parentTaskId.trim()
      ||typeof payload.taskId!=='string'||!payload.taskId.trim())throw Error('子对话定位参数无效');
    return open(payload);
  }
  if(name==='subagentConversations.close'&&payload===undefined){window.close();return;}
  throw Error('子对话列表不支持此操作');
}

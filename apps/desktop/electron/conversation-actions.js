/** Desktop metadata only. Never changes Runtime task states. */
export function handleConversationAction({name,payload,surface,conversations,tasks,taskSurface,submitting,publish}){
  if(!['panel','workspace'].includes(surface))throw Error('请从受信对话窗口管理会话');
  const input=payload??{};if(!input||typeof input!=='object'||Array.isArray(input))throw Error('对话操作格式无效');
  if(name==='conversation.readDraft'){if(Object.keys(input).some(k=>k!=='conversationId'))throw Error('草稿读取格式无效');const session=conversations.session(input.conversationId,surface);return {conversationId:session.id,text:session.draft};}
  if(name==='conversation.draft'){
    if(Object.keys(input).some(k=>!['conversationId','text'].includes(k)))throw Error('草稿格式无效');
    conversations.setDraft(surface,input.conversationId,input.text);return {saved:true,conversationId:input.conversationId};
  }
  if(Object.keys(input).some(k=>!['conversationId','expectedConversationId','title'].includes(k)))throw Error('对话操作字段无效');
  if(input.expectedConversationId!==undefined&&input.expectedConversationId!==conversations.activeConversationId(surface))throw Error('当前对话已切换，请重试');
  if(name==='conversation.archive'&&submitting.has(input.conversationId))throw Error('任务正在受理，请稍后归档会话');
  if(name==='conversation.new')conversations.create(surface,input.title??'新对话');
  else if(name==='conversation.switch')conversations.switch(surface,input.conversationId);
  else if(name==='conversation.rename')conversations.rename(surface,input.conversationId,input.title);
  else if(['conversation.archive','conversation.restore'].includes(name)){
    if(name==='conversation.archive'&&[...tasks.values()].some(t=>taskSurface(t)===surface&&conversations.conversationIdForTask(t)===input.conversationId&&!['succeeded','failed','cancelled'].includes(t.state)))throw Error('任务尚未结束，请先停止或核实后归档');
    conversations.archive(surface,input.conversationId,name==='conversation.archive');
  }else throw Error('不支持的对话管理操作');
  publish();return conversations.snapshot(surface);
}

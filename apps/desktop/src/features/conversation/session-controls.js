/** Metadata controls and debounced per-conversation drafts; no execution loop. */
export function mountSessionControls(root,input,invoke,report,{singleMain=false,flushBeforeClose}={}){
  const box=document.createElement('section');box.className='conversation-sessions';
  // Keep draft persistence for the small workspace without session-management UI.
  box.hidden=singleMain;
  box.innerHTML='<label>对话<select data-session-list aria-label="当前对话"></select></label><button type="button" data-session-new>新对话</button><label>名称<input data-session-title maxlength="100" aria-label="对话名称"></label><button type="button" data-session-rename>保存名称</button><button type="button" data-session-archive>归档</button><details><summary>已归档</summary><div data-session-archived></div></details><p class="notice" data-session-status role="status"></p>';
  root.append(box);const select=box.querySelector('[data-session-list]'),title=box.querySelector('[data-session-title]'),status=box.querySelector('[data-session-status]'),archived=box.querySelector('[data-session-archived]');
  if(singleMain)root.append(status);
  let active,state,busy=false,timer,titleDirty=false,titleRevision=0,signature='',closed=false,composing=false;
  const drafts=new Map(),versions=new Map(),dictations=new Set(),dictationQueues=new Map(),compositionWaiters=[];
  let quitPrepared=false,previousReadOnly=false;
  const flushClose=event=>{
    if(quitPrepared)return;
    if(!active||!flushBeforeClose)return;
    // A readonly archive may have newer late dictation in the cache.
    if(!input.readOnly)drafts.set(active,input.value);
    try{flushBeforeClose([...drafts].map(([conversationId,text])=>({conversationId,text})));}
    catch(error){event.preventDefault();event.returnValue='';report(error);}
  };
  window.addEventListener('beforeunload',flushClose);
  window.addEventListener('pa:prepare-quit',event=>{
    if(event.detail)event.detail.handled=true;
    if(quitPrepared)return;
    if(busy||composing||dictationQueues.size){event.preventDefault();report(Error('请先完成对话切换或输入，再退出'));return;}
    flushClose(event);if(event.defaultPrevented)return;
    quitPrepared=true;previousReadOnly=input.readOnly;input.readOnly=true;
  });
  window.addEventListener('pa:cancel-quit',()=>{if(quitPrepared)input.readOnly=previousReadOnly;quitPrepared=false;});
  async function saveDraft(id=active){if(!id||!drafts.has(id))return;await invoke('conversation.draft',{conversationId:id,text:drafts.get(id)});}
  input.addEventListener('input',()=>{if(!active)return;drafts.set(active,input.value);versions.set(active,(versions.get(active)??0)+1);clearTimeout(timer);const id=active;timer=setTimeout(()=>{timer=undefined;void saveDraft(id).catch(report);},800);});
  input.addEventListener('blur',()=>{clearTimeout(timer);timer=undefined;void saveDraft().catch(report);});
  input.addEventListener('compositionstart',()=>{composing=true;});
  input.addEventListener('compositionend',()=>{composing=false;setTimeout(()=>{for(const resolve of compositionWaiters.splice(0))resolve();},0);});
  title.oninput=()=>{titleDirty=true;titleRevision++;};
  async function action(name,extra={}){
    if(busy||!active)return;
    const archiving=name==='conversation.archive';
    if(archiving&&composing){status.textContent='请先完成输入法输入，再归档对话。';return false;}
    const previousReadOnly=input.readOnly;if(archiving){input.readOnly=true;status.textContent='正在保存并归档；输入框暂时只读。';}
    busy=true;box.setAttribute('aria-busy','true');const origin=active;clearTimeout(timer);timer=undefined;
    try{drafts.set(origin,input.value);await saveDraft(origin);await invoke(name,{expectedConversationId:origin,...extra});status.textContent='';return true;}
    catch(error){status.textContent=error.message;select.value=active;report(error);return false;}
    finally{if(archiving)input.readOnly=previousReadOnly;busy=false;box.setAttribute('aria-busy','false');}
  }
  select.onchange=()=>action('conversation.switch',{conversationId:select.value});
  box.querySelector('[data-session-new]').onclick=()=>action('conversation.new');
  box.querySelector('[data-session-rename]').onclick=async()=>{const version=titleRevision;if(await action('conversation.rename',{conversationId:active,title:title.value.trim()})&&version===titleRevision)titleDirty=false;};
  box.querySelector('[data-session-archive]').onclick=()=>action('conversation.archive',{conversationId:active});
  archived.onclick=event=>{const button=event.target.closest('[data-restore-conversation]');if(button)void action('conversation.restore',{conversationId:button.dataset.restoreConversation});};
  function update(value){
    if(closed||!value?.conversationState)return false;state=value.conversationState;const changed=active!==state.activeId;
    if(changed){if(!active&&input.value)drafts.set(state.activeId,input.value);active=state.activeId;input.value=drafts.get(active)??state.draft??'';drafts.set(active,input.value);titleDirty=false;}
    const next=JSON.stringify([state.activeId,state.sessions]);
    if(next!==signature){signature=next;select.replaceChildren(...state.sessions.filter(s=>!s.archived).map(s=>new Option(s.title,s.id)));select.value=state.activeId;archived.replaceChildren(...state.sessions.filter(s=>s.archived).map(s=>{const button=document.createElement('button');button.type='button';button.dataset.restoreConversation=s.id;button.textContent='恢复 '+s.title;return button;}));}
    if(!titleDirty)title.value=state.sessions.find(s=>s.id===active)?.title??'';
    return changed;
  }
  window.addEventListener('unload',()=>{closed=true;clearTimeout(timer);});
  const capture=()=>({conversationId:active,text:input.value,revision:versions.get(active)??0});
  async function appendDictation(result){
    if(quitPrepared)throw Error('正在退出，听写未填入草稿');
    const id=result?.conversationId??'desktop-panel',text=result?.text;
    if(typeof text!=='string'||!text.trim())return;
    const key=result.dictationId;if(key&&dictations.has(key))return;if(key)dictations.add(key);
    const pending=(dictationQueues.get(id)??Promise.resolve()).catch(()=>{}).then(async()=>{
      if(!drafts.has(id)){const original=await invoke('conversation.readDraft',{conversationId:id});if(!drafts.has(id))drafts.set(id,original.text);}
      if(id===active&&composing)await new Promise(resolve=>compositionWaiters.push(resolve));
      const before=id===active&&!input.readOnly?input.value:drafts.get(id);const next=(before.trim()?before.trimEnd()+'\n':'')+text;
      drafts.set(id,next);versions.set(id,(versions.get(id)??0)+1);
      if(id===active&&!input.readOnly&&!composing){input.value=next;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus?.();input.setSelectionRange?.(next.length,next.length);}
      try{await saveDraft(id);status.textContent=id===active?'听写已填入草稿。':'听写已保存至原对话；当前输入未改变。';}
      catch{status.textContent='原对话听写草稿尚未保存，请恢复原对话后保存；文本仍保留在本机当前窗口。';}
    });
    dictationQueues.set(id,pending);
    try{await pending;}finally{if(dictationQueues.get(id)===pending)dictationQueues.delete(id);}
  }
  return {update,capture,appendDictation,async flush(token=capture()){clearTimeout(timer);timer=undefined;if(token.conversationId){drafts.set(token.conversationId,token.text);await saveDraft(token.conversationId);}return token;},async submitted(token){
    if(!token?.conversationId||(versions.get(token.conversationId)??0)!==token.revision||drafts.get(token.conversationId)!==token.text)return;
    drafts.set(token.conversationId,'');
    if(active===token.conversationId&&input.value===token.text){input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));}
    try{await saveDraft(token.conversationId);}catch(error){if(active===token.conversationId)report(Error('任务已受理，但草稿清理保存未确认：'+error.message));}
  }};
}

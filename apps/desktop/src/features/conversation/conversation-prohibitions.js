const labels={send:'发送消息或邮件',publish:'发布内容',delete:'删除或移除对象',computer:'操作电脑',payment:'付款或转账',permission:'修改权限'};

/** Explicit sidebar edits only. Conversation text never calls this controller. */
export function mountConversationProhibitions(root,invoke,report=()=>{}) {
  const document=root.ownerDocument??globalThis.document;
  if(document.head&&!document.querySelector('[data-conversation-prohibitions-style]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./conversation-prohibitions.css',import.meta.url).href;
    link.setAttribute('data-conversation-prohibitions-style','');document.head.append(link);
  }
  root.classList.add('conversation-prohibitions-sidebar');
  root.innerHTML='<button type="button" data-prohibitions-toggle aria-expanded="false" aria-label="本对话禁止项：0 条">⊘ <span data-prohibitions-count>0</span></button>'
    +'<section class="conversation-prohibitions-editor" data-prohibitions-editor hidden aria-label="本对话禁止项">'
    +'<button type="button" data-prohibitions-close>关闭</button><h3>本对话禁止项</h3><p>每条禁止项拦住本对话的整个动作类别，对象不明确也不执行。原句、期限和条件完整保留；持续拦住直到你在这里修改或移除，聊天不会自动改变规则。</p>'
    +'<div data-prohibitions-list></div><form data-prohibitions-form><label>动作类别<select name="action">'
    +Object.entries(labels).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')
    +'</select></label><label>禁止项原句<textarea name="text" required maxlength="4000" rows="3"></textarea></label>'
    +'<button type="submit" data-prohibitions-save>添加</button><button type="button" data-prohibitions-cancel hidden>取消修改</button></form>'
    +'<p data-prohibitions-status role="status"></p></section>';
  const toggle=root.querySelector('[data-prohibitions-toggle]'),count=root.querySelector('[data-prohibitions-count]'),editor=root.querySelector('[data-prohibitions-editor]');
  const list=root.querySelector('[data-prohibitions-list]'),form=root.querySelector('[data-prohibitions-form]'),action=form.querySelector('[name="action"]'),text=form.querySelector('[name="text"]');
  const save=root.querySelector('[data-prohibitions-save]'),cancel=root.querySelector('[data-prohibitions-cancel]'),status=root.querySelector('[data-prohibitions-status]');
  let active,rules={revision:0,items:[]},editing,busy=false,signature='';
  toggle.onclick=()=>{editor.hidden=!editor.hidden;toggle.setAttribute('aria-expanded',String(!editor.hidden));};
  root.querySelector('[data-prohibitions-close]').onclick=()=>{editor.hidden=true;toggle.setAttribute('aria-expanded','false');};
  const reset=()=>{editing=undefined;text.value='';save.textContent='添加';cancel.hidden=true;};
  cancel.onclick=reset;
  async function persist(items){
    if(busy||!active)return;
    busy=true;save.disabled=true;const origin=active;
    try{
      const state=await invoke('conversation.prohibitions.update',{conversationId:origin,expectedConversationId:origin,expectedRevision:rules.revision,items});
      if(active===origin){reset();update(state);status.textContent='已保存本对话禁止项。';}
    }catch(error){status.textContent=error.message;report(error);}
    finally{busy=false;save.disabled=false;}
  }
  form.onsubmit=event=>{
    event.preventDefault();if(busy||!text.value.trim())return;
    const item={id:editing??globalThis.crypto.randomUUID(),action:action.value,text:text.value};
    void persist(editing?rules.items.map(previous=>previous.id===editing?item:previous):[...rules.items,item]);
  };
  function update(value){
    const state=value?.conversationState??value;if(!state?.activeId||!Array.isArray(state.sessions))return;
    if(active!==state.activeId){active=state.activeId;reset();status.textContent='';editor.hidden=true;toggle.setAttribute('aria-expanded','false');}
    rules=structuredClone(state.sessions.find(session=>session.id===active)?.prohibitions??{revision:0,items:[]});
    count.textContent=String(rules.items.length);toggle.setAttribute('aria-label',`本对话禁止项：${rules.items.length} 条`);
    const next=JSON.stringify([active,rules]);if(next===signature)return;signature=next;
    list.replaceChildren(...rules.items.map(item=>{
      const row=document.createElement('article'),heading=document.createElement('strong'),body=document.createElement('p');
      heading.textContent=labels[item.action];body.textContent=item.text;
      const edit=document.createElement('button');edit.type='button';edit.textContent='修改';edit.onclick=()=>{
        if(busy)return;editing=item.id;action.value=item.action;text.value=item.text;save.textContent='保存修改';cancel.hidden=false;
      };
      const remove=document.createElement('button');remove.type='button';remove.textContent='移除';remove.onclick=()=>void persist(rules.items.filter(rule=>rule.id!==item.id));
      row.append(heading,body,edit,remove);return row;
    }));
  }
  return {update};
}

import {mountSubagentConversationPage} from '../conversation/subagent-conversations.js';

const keyOf=binding=>JSON.stringify([binding.parentTaskId,binding.taskId]);

/** Each retained view owns its draft and pending replies; switching never rebinds it. */
export function mountInlineSubagents(chat,invoke,report,onChange=()=>{}){
  const host=document.createElement('div');host.className='cc-inline-host';host.hidden=true;chat.append(host);
  const views=new Map();let selected=null,closed=false;
  const main=()=>{if(closed)return;selected=null;host.hidden=true;chat.classList.remove('cc-showing-child');onChange(null);};
  function select(binding){
    if(closed)return;
    const key=keyOf(binding);let view=views.get(key);
    if(!view){
      if(views.size>=12){const idle=[...views].find(([id,entry])=>id!==selected&&!entry.page.hasUnsentChanges());if(!idle){report(Error('子对话中仍有草稿或提交，请先处理后再打开更多对话'));return;}idle[1].page.dispose();idle[1].root.remove();views.delete(idle[0]);}
      const owner=Object.freeze({parentTaskId:binding.parentTaskId,taskId:binding.taskId}),root=document.createElement('div');root.className='cc-child-pane';root.hidden=true;host.append(root);
      const scoped=(name,payload)=>{
        if(name==='subagentConversation.main'||name==='subagentConversation.close'){main();return Promise.resolve();}
        const suffix={'subagentConversation.snapshot':'snapshot','subagentConversation.submit':'submit','subagentConversation.cancel':'cancel'}[name];
        if(!suffix)return Promise.reject(Error('内嵌子对话不支持此操作'));
        return invoke('workspace.subagent.'+suffix,{binding:owner,...(payload===undefined?{}:{request:payload})});
      };
      view={root,binding:owner,page:mountSubagentConversationPage(root,scoped,{embedded:true}),lastRefresh:Date.now()};views.set(key,view);
    }
    selected=key;for(const [id,entry] of views)entry.root.hidden=id!==key;host.hidden=false;chat.classList.add('cc-showing-child');onChange(view.binding);
    void view.page.refresh();
  }
  const dispose=()=>{closed=true;for(const view of views.values())view.page.dispose();views.clear();};
  window.addEventListener('unload',dispose,{once:true});
  return {select,main,get selected(){return selected===null?null:views.get(selected)?.binding;},update(){const view=views.get(selected);if(view&&Date.now()-view.lastRefresh>750){view.lastRefresh=Date.now();void view.page.refresh();}}};
}

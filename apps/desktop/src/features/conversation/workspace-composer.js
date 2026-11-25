/** Existing task.submit/cancel bridge only. */
import {isTerminal,stateNames} from './state.js';
export function mountWorkspaceComposer(root,invoke,report){
  const form=document.createElement('form');form.className='workspace-composer';form.innerHTML='<label>任务内容<textarea aria-label="工作区任务内容" placeholder="输入任务，Enter 发送，Shift+Enter 换行"></textarea></label><div class="workspace-composer-actions"><p class="notice" role="status"></p><button type="button" data-stop>停止当前任务</button><button type="submit" data-send>发送</button></div>';root.append(form);
  const input=form.querySelector('textarea'),send=form.querySelector('[data-send]'),stop=form.querySelector('[data-stop]'),status=form.querySelector('[role=status]');let snapshot={tasks:[]},pending=false,revision=0,generation=0,owner;
  const foregroundTask=()=>snapshot.tasks?.find(task=>task.state==='waiting_reconciliation'
    &&!task.outputTruncated&&!task.cancelRequested);
  const stoppableTask=()=>foregroundTask()??[...(snapshot.tasks??[])].reverse().find(task=>!task.conflictOnly
    &&!isTerminal(task)&&task.state!=='waiting_reconciliation'&&!task.outputTruncated&&!task.cancelRequested
    &&task.state!=='cancelling');
  function update(value){
    const next=value.conversationState?.activeId;
    if(owner!==next){owner=next;generation++;pending=false;}
    snapshot=value;
    const active=foregroundTask(),stoppable=stoppableTask();
    send.hidden=!input.value.trim();
    send.disabled=pending||Boolean(active)||!input.value.trim();
    stop.disabled=(!stoppable&&!pending)||stoppable?.state==='cancelling';
    stop.textContent=stoppable?.state==='cancelling'?'正在停止…':'停止';
    stop.title='停止当前任务';
    stop.setAttribute?.('aria-label','停止当前任务');
    status.textContent=active?(stateNames[active.state]??'正在处理'):pending?'正在发送…':'';
  }
  input.addEventListener('input',()=>{revision++;update(snapshot);});
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();if(!send.disabled)form.requestSubmit();}});
  form.onsubmit=async event=>{event.preventDefault();if(send.disabled||pending)return;const token=++generation,id=snapshot.conversationState?.activeId,version=revision,text=input.value;pending=true;update(snapshot);try{const draft=control.beforeSubmit?await control.beforeSubmit():undefined;await invoke('task.submit',{text,conversationId:id});if(control.onAccepted)await control.onAccepted(draft);if(snapshot.conversationState?.activeId===id&&revision===version){input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));}}catch(error){if(token===generation)report(error);}finally{if(token===generation){pending=false;update(snapshot);}}};
  stop.onclick=async()=>{
    const task=stoppableTask();
    if(!task&&!pending)return;
    if(stop.disabled)return;
    const token=++generation;
    stop.disabled=true;
    try{
      if(task)await invoke('task.cancel',task.taskId);
      else await invoke('conversation.interrupt',{conversationId:snapshot.conversationState?.activeId});
    }catch(error){if(token===generation)report(error);}
    finally{if(token===generation){pending=false;update(snapshot);}}
  };
  const control={input,update};
  return control;
}

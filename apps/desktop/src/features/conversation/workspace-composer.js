/** Existing task.submit/cancel bridge only. */
import {isTerminal,stateNames} from './state.js';
export function mountWorkspaceComposer(root,invoke,report){
  const form=document.createElement('form');form.className='workspace-composer';form.innerHTML='<label>任务内容<textarea aria-label="工作区任务内容" placeholder="输入任务，Enter 发送，Shift+Enter 换行"></textarea></label><div class="workspace-composer-actions"><p class="notice" role="status"></p><button type="button" data-stop>停止当前任务</button><button type="submit" data-send>发送</button></div>';root.append(form);
  const input=form.querySelector('textarea'),send=form.querySelector('[data-send]'),stop=form.querySelector('[data-stop]'),status=form.querySelector('[role=status]');let snapshot={tasks:[]},pending=false,revision=0,generation=0,owner;
  const foregroundTask=()=>snapshot.tasks?.find(task=>!isTerminal(task)&&!task.backgroundDelegation
    &&!task.outputTruncated&&!task.cancelRequested
    &&!snapshot.subagentTasks?.some(child=>child.parentTaskId===task.taskId));
  function update(value){
    const next=value.conversationState?.activeId;
    if(owner!==next){owner=next;generation++;pending=false;}
    snapshot=value;
    const active=foregroundTask();
    send.disabled=pending||Boolean(active)||!input.value.trim();
    stop.disabled=pending||!active||active.state==='cancelling';
    status.textContent=active?(stateNames[active.state]??'正在处理'):pending?'正在发送…':'';
  }
  input.addEventListener('input',()=>{revision++;update(snapshot);});
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();if(!send.disabled)form.requestSubmit();}});
  form.onsubmit=async event=>{event.preventDefault();if(send.disabled||pending)return;const token=++generation,id=snapshot.conversationState?.activeId,version=revision,text=input.value;pending=true;update(snapshot);try{const draft=control.beforeSubmit?await control.beforeSubmit():undefined;await invoke('task.submit',{text,conversationId:id});if(control.onAccepted)await control.onAccepted(draft);if(snapshot.conversationState?.activeId===id&&revision===version){input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));}}catch(error){if(token===generation)report(error);}finally{if(token===generation){pending=false;update(snapshot);}}};
  stop.onclick=async()=>{const task=foregroundTask();if(!task||pending)return;const token=++generation;pending=true;update(snapshot);try{await invoke('task.cancel',task.taskId);}catch(error){if(token===generation)report(error);}finally{if(token===generation){pending=false;update(snapshot);}}};
  const control={input,update};
  return control;
}

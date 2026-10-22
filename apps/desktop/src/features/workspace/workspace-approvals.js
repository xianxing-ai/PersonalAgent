import {approvalCards,approvalResponse,nextApprovalExpiry} from '../conversation/approval-card.js';
import {approvalsWithoutQuestionCards} from '../conversation/authorization-question-card.js';

// Application authorization questions remain mounted by the existing renderer.
export function mountWorkspaceApprovals(conversation,invoke,report,readRevision){
  let snapshot={tasks:[],approvals:[]},timer,closed=false;
  const pending=new Set();
  const approvals=()=>approvalsWithoutQuestionCards(snapshot.approvals,snapshot.authorizationQuestions,snapshot.conversationState?.activeId);
  function project(){
    clearTimeout(timer);const visible=approvals();
    for(const slot of conversation.querySelectorAll('[data-workspace-approvals]')){
      const task=snapshot.tasks.find(task=>task.taskId===slot.dataset.workspaceApprovals),html=task?approvalCards(task,visible):'';
      if(slot.dataset.signature!==html){slot.dataset.signature=html;slot.innerHTML=html;}
      for(const button of slot.querySelectorAll('[data-approval-decision]'))button.disabled=pending.has(button.dataset.approvalId);
    }
    const next=nextApprovalExpiry(snapshot.tasks,visible);
    if(next!==undefined)timer=setTimeout(project,Math.max(1,next-Date.now()+1));
  }
  const decide=async event=>{
    const button=event.target.closest('[data-approval-decision]');if(!button||button.disabled||closed)return;
    const id=button.dataset.approvalId,owner=snapshot.conversationState?.activeId,revision=readRevision();if(pending.has(id))return;
    pending.add(id);project();
    try{await invoke('authorization.respond',approvalResponse(id,button.dataset.approvalDecision,snapshot.tasks,approvals()));}
    catch(error){pending.delete(id);if(!closed&&snapshot.conversationState?.activeId===owner&&readRevision()===revision)report(error);}
    finally{if(!closed)project();}
  };
  conversation.addEventListener('click',decide);
  window.addEventListener('unload',()=>{closed=true;clearTimeout(timer);conversation.removeEventListener('click',decide);},{once:true});
  return {update(data){snapshot={...data,tasks:data.tasks??[],approvals:data.approvals??[]};for(const id of pending)if(!snapshot.approvals.some(item=>item.approvalId===id&&item.state==='pending'))pending.delete(id);project();}};
}

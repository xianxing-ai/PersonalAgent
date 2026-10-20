import {isTerminal,stateNames} from './state.js';

// A held native cancel gesture needs its button to remain connected throughout a progress update.
export function updateConversationTurns(container, html, {tasks,pendingCancelIds,cancelSelector,cancelAttribute}) {
  const staged=document.createElement('div');
  staged.innerHTML=html;
  const previous=[...container.children],next=[...staged.children];
  const plans=[];
  let safe=previous.length===next.length;
  for(let index=0;safe&&index<previous.length;index++) {
    const card=previous[index],replacement=next[index];
    if(!card.dataset.turn||card.dataset.turn!==replacement.dataset.turn
      ||typeof card.cloneNode!=='function'||card.cloneNode(false).outerHTML!==replacement.cloneNode(false).outerHTML) {safe=false;break;}
    const button=card.querySelector(cancelSelector),fresh=replacement.querySelector(cancelSelector);
    const id=button?.dataset[cancelAttribute];
    const task=tasks.find(item=>item.taskId===id);
    const children=[...card.children],freshChildren=[...replacement.children];
    const action=children.find(child=>child.contains(button));
    const freshAction=freshChildren.find(child=>child.contains(fresh));
    const canKeep=Boolean(button&&fresh&&id&&id===card.dataset.turn&&fresh.dataset[cancelAttribute]===id
      &&task&&Object.hasOwn(stateNames,task.state)&&!isTerminal(task)&&task.state!=='cancelling'
      &&!pendingCancelIds.has(id)&&!button.disabled&&!fresh.disabled
      &&button.outerHTML===fresh.outerHTML&&action&&freshAction&&action.outerHTML===freshAction.outerHTML
      &&button.parentElement===action&&fresh.parentElement===freshAction
      &&action.childNodes.length===freshAction.childNodes.length
      &&children.length===freshChildren.length&&children.every((child,childIndex)=>child.contains(button)
        ?childIndex===freshChildren.indexOf(freshAction):!freshChildren[childIndex].contains(fresh)));
    plans.push({card,replacement,children,freshChildren,button,action,freshAction,canKeep});
  }
  // Reuse the nodes already parsed into `staged`: assigning innerHTML again would re-parse the
  // whole transcript a second time for the same result.
  if(!safe) {container.replaceChildren(...next);return;}
  for(const {card,replacement,children,freshChildren,button,action,freshAction,canKeep} of plans) {
    if(card.outerHTML===replacement.outerHTML)continue;
    if(!canKeep) {
      if(card.outerHTML!==replacement.outerHTML)card.replaceWith(replacement);
      continue; // Unchanged turns retain selection, disclosure and keyboard focus.
    }
    // Refresh every other action as before; only task.cancel retains its native gesture state.
    const actionChildren=[...action.childNodes],freshActionChildren=[...freshAction.childNodes];
    for(let index=0;index<actionChildren.length;index++) {
      if(actionChildren[index]!==button) actionChildren[index].replaceWith(freshActionChildren[index]);
    }
    children.forEach((child,index)=>{
      if(child!==action&&child.outerHTML!==freshChildren[index].outerHTML) child.replaceWith(freshChildren[index]);
    });
  }
}

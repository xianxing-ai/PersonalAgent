import {isTerminal,stateNames} from './state.js';

// A held native cancel gesture needs its button to remain connected throughout a progress update.
export function updateConversationTurns(container, html, {tasks,pendingCancelIds,cancelSelector,cancelAttribute}) {
  const staged=document.createElement('div');
  staged.innerHTML=html;
  const previous=[...container.children],next=[...staged.children];
  const plans=[];
  const previousById=new Map(previous.map(card=>[card.dataset.turn,card]));
  const nextIds=new Set(next.map(card=>card.dataset.turn));
  let safe=previousById.size===previous.length&&nextIds.size===next.length&&!nextIds.has(undefined)&&!previousById.has(undefined);
  // Real DOM inserts preserve all unchanged turns even when the page gains or loses a turn.
  if(previous.length!==next.length&&typeof container.insertBefore!=='function')safe=false;
  for(let index=0;safe&&index<next.length;index++) {
    const replacement=next[index],card=previousById.get(replacement.dataset.turn);
    if(!card||typeof card.cloneNode!=='function'||card.cloneNode(false).outerHTML!==replacement.cloneNode(false).outerHTML){plans.push({replacement});continue;}
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
  const desired=[];
  for(const {card,replacement,children,freshChildren,button,action,freshAction,canKeep} of plans) {
    if(!card){desired.push(replacement);continue;}
    if(card.outerHTML===replacement.outerHTML){desired.push(card);continue;}
    if(!canKeep) {
      desired.push(replacement);
      continue; // Unchanged turns retain selection, disclosure and keyboard focus.
    }
    desired.push(card);
    // Refresh every other action as before; only task.cancel retains its native gesture state.
    const actionChildren=[...action.childNodes],freshActionChildren=[...freshAction.childNodes];
    for(let index=0;index<actionChildren.length;index++) {
      if(actionChildren[index]!==button) actionChildren[index].replaceWith(freshActionChildren[index]);
    }
    children.forEach((child,index)=>{
      if(child!==action&&child.outerHTML!==freshChildren[index].outerHTML) child.replaceWith(freshChildren[index]);
    });
  }
  if(typeof container.insertBefore==='function'){
    for(let index=0;index<desired.length;index++)if(container.children[index]!==desired[index])container.insertBefore(desired[index],container.children[index]??null);
    const retained=new Set(desired);for(const card of [...container.children])if(!retained.has(card))card.remove();
  }else for(let index=0;index<previous.length;index++)if(previous[index]!==desired[index])previous[index].replaceWith(desired[index]);
}

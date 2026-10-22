/** Unsent drafts for the current window, not Runtime tasks or an execution scheduler. */
export function createMessageQueue() {
  let nextId=0,paused=false;
  const items=[];
  return {
    get paused(){return paused;},
    pause(){paused=true;},
    resume(){paused=false;},
    add(text,conversationId){const item={id:String(++nextId),text,conversationId};items.push(item);return item;},
    list(conversationId){return items.filter(item=>item.conversationId===conversationId);},
    remove(id){const index=items.findIndex(item=>item.id===id);return index<0?undefined:items.splice(index,1)[0];},
  };
}

export const HISTORY_PAGE_SIZE=40;
export const compareHistoryKeys=(a,b)=>a.createdAt<b.createdAt?-1:a.createdAt>b.createdAt?1:a.key<b.key?-1:a.key>b.key?1:0;
const messageKey=message=>({createdAt:message.createdAt,key:`message:${message.id}`});

/** Three host-owned page cursors. No client cursor, task store, or authority is introduced.
 * Only the selected page is retained. Paging back and forth does not accumulate old payloads. */
export function createHistoryPages({readTasks,readMessages,readMessagePage,conversationId,onTasks,readRevision=()=>0,now=()=>new Date().toISOString()}) {
  const pages=new Map();let sourceRevision=0,pageRevision=0;
  const revision=()=>`${sourceRevision}:${readRevision()}`;
  function load(surface,direction='latest') {
    const id=conversationId(surface),previous=pages.get(surface);
    if(!['latest','older','newer'].includes(direction))throw Error('历史翻页方向无效');
    const latest=direction==='latest'||!previous||previous.conversationId!==id;
    const before=!latest&&direction==='older'?previous.first:undefined;
    const after=!latest&&direction==='newer'?previous.last:undefined;
    const snapshotSequence=latest?undefined:previous.snapshotSequence;
    const messageThrough=latest?now():previous.messageThrough;
    const taskPage=readTasks({conversationId:id,limit:HISTORY_PAGE_SIZE+1,snapshotSequence,before,after});
    const messages=[];
    if(readMessagePage){
      const page=readMessagePage({conversationId:id,limit:HISTORY_PAGE_SIZE+1,before,after,messageThrough});
      if(!Array.isArray(page)||page.length>HISTORY_PAGE_SIZE+1)throw Error('历史消息读页超出约定');
      for(const message of page)messages.push({...messageKey(message),kind:'message',id:message.id});
    }else{
      for(const message of readMessages().values()) {
        if(id!==undefined&&message.conversationId!==id||message.createdAt>messageThrough)continue;
        const key=messageKey(message);
        if(before&&compareHistoryKeys(key,before)>=0||after&&compareHistoryKeys(key,after)<=0)continue;
        // Compatibility for callers without the optional metadata index.
        messages.push({...key,kind:'message',id:message.id});messages.sort(compareHistoryKeys);
        if(messages.length>HISTORY_PAGE_SIZE+1)messages.splice(after?HISTORY_PAGE_SIZE+1:0,1);
      }
    }
    const candidates=[...taskPage.items.map(task=>({createdAt:task.createdAt,key:`task:${task.taskId}`,kind:'task',id:task.taskId})),...messages].sort(compareHistoryKeys);
    const entries=after?candidates.slice(0,HISTORY_PAGE_SIZE):candidates.slice(-HISTORY_PAGE_SIZE);
    if(!entries.length&&!latest)return previous;
    const page={conversationId:id,entries,first:entries[0],last:entries.at(-1),snapshotSequence:taskPage.snapshotSequence,messageThrough,pageRevision:++pageRevision,
      viewingLatest:latest,hasOlder:after?true:candidates.length>HISTORY_PAGE_SIZE||taskPage.hasMore,
      hasNewer:latest?false:after?candidates.length>HISTORY_PAGE_SIZE||taskPage.hasMore:true};
    // Reaching the end of an older watermark is not the current latest history. Keep the
    // explicit Latest action available, including when new tasks arrived while browsing.
    pages.set(surface,page);
    onTasks(taskPage.items.filter(task=>entries.some(entry=>entry.kind==='task'&&entry.id===task.taskId)));
    page.sourceRevision=revision();
    return page;
  }
  function get(surface) {
    const page=pages.get(surface);
    return !page||page.conversationId!==conversationId(surface)||page.viewingLatest&&page.sourceRevision!==revision()?load(surface):page;
  }
  return {load,get,
    invalidate(){sourceRevision++;},
    pinned(){return new Set([...pages.values()].flatMap(page=>page.entries.filter(entry=>entry.kind==='task').map(entry=>entry.id)));},
    summary(surface){const page=get(surface);return {conversationId:page.conversationId,hasOlder:page.hasOlder,hasNewer:page.hasNewer,
      viewingLatest:page.viewingLatest,pageSize:HISTORY_PAGE_SIZE,pageRevision:page.pageRevision};},
    clear(){pages.clear();sourceRevision++;},
  };
}

import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const denied=()=>{throw new ProtocolError('UNAUTHORIZED','原会话的唯一 F08 邮箱来源不可用');};

/** Main-only native source controls. Renderer supplies its visible root task, never graph/session references. */
export function createF08SourceActions({getApplication,sourceHost,now=Date.now}={}) {
  if(typeof getApplication!=='function'||!sourceHost)throw Error('Original F08 source actions are unavailable');
  function resolve(taskId,context){
    const app=getApplication(),runtime=app.runtime,root=runtime.getTask(taskId);
    if(!context?.signal||context.signal.aborted||root.conversationId!==context.conversationId||root.cancelRequested)denied();
    const queue=[taskId],seen=new Set(),found=new Map();
    while(queue.length){
      const id=queue.shift();if(seen.has(id))continue;if(seen.size>=128)denied();seen.add(id);
      if(runtime.loadCheckpoint(id,'private-copy-erasure')!==undefined||runtime.loadCheckpoint(id,'private-copy-erasure-binding')!==undefined)denied();
      for(const child of app.readSubagentTasks(id))queue.push(child.taskId);
      for(const key of runtime.listCheckpointKeys(id).filter(key=>key.startsWith('coding-repair:host:'))){
        const edge=runtime.loadCheckpoint(id,key),operationId=key.slice('coding-repair:host:'.length);
        const intent=runtime.loadCheckpoint(id,'owned-workflow:intent:'+operationId);
        if(intent?.workflowId!=='F08')continue;
        const host=edge?.localTaskId&&runtime.loadCheckpoint(edge.localTaskId,'host-tool-intent');
        if(!host||host.commandId!==operationId||intent.taskId!==id||intent.proposal?.operationId!==operationId
          ||!isDeepStrictEqual(runtime.loadCheckpoint(edge.localTaskId,'coding-repair:parent'),{taskId:id,operationId})
          ||!isDeepStrictEqual(edge.request,{commandId:host.commandId,toolName:host.toolName,toolVersion:host.toolVersion,arguments:host.arguments,deadline:host.deadline}))denied();
        const user=app.readDelegatedUserTaskParent(id),graph=runtime.getTask(id);
        if(!user||user.taskId!==root.taskId||user.conversationId!==context.conversationId||user.deadline!==host.deadline
          ||graph.cancelRequested||!['running','waiting_approval','waiting_reconciliation'].includes(graph.state)
          ||Date.parse(host.deadline)<=now())continue;
        const scope={parentTaskId:id,sessionId:intent.sessionId,deadline:host.deadline,signal:context.signal};
        const source=sourceHost.readSource(scope);found.set(id+':'+intent.sessionId,{scope,source});
      }
    }
    if(found.size!==1)denied();return [...found.values()][0];
  }
  return Object.freeze({
    readSource({taskId},context){const {scope,source}=resolve(taskId,context);
      return {taskId,sourceId:digest(source),deadline:scope.deadline,account:source.inbox.account,folder:source.inbox.folder,
        items:structuredClone(source.inbox.items),sourceRef:source.sourceRef};},
    async remember(input,context){
      if(!input||Object.keys(input).sort().join(',')!=='commandId,sourceId,summary,taskId,validFrom,validUntil'
        ||typeof input.commandId!=='string'||!input.commandId||input.commandId.length>128||typeof input.summary!=='string'||!input.summary.trim()
        ||input.summary.length>4000||![input.validFrom,input.validUntil].every(value=>typeof value==='string'&&Number.isFinite(Date.parse(value))))
        throw new ProtocolError('INVALID_ARGUMENT','邮件来源记忆需要原版本与明确内容');
      const {scope,source}=resolve(input.taskId,context);if(digest(source)!==input.sourceId)denied();
      const control={boundUserTaskId:input.taskId,conversationId:context.conversationId,commandId:input.commandId,sourceDigest:input.sourceId};
      const value={factId:'mail-'+digest(source.sourceRef),operationId:'mail-source-'+digest([input.taskId,input.commandId]),
        summary:input.summary,validFrom:input.validFrom,validUntil:input.validUntil};
      return sourceHost.rememberSource({...scope,control},value);
    },
    listSources:context=>sourceHost.listSources(context),
    withdraw:(input,context)=>sourceHost.withdrawSource({...input,deadline:context.deadline,signal:context.signal},context.control),
    erase:(input,context)=>sourceHost.eraseSource({...input,deadline:context.deadline,signal:context.signal},context.control),
  });
}

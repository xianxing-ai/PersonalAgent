import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const denied=()=>{throw new ProtocolError('UNAUTHORIZED','原会话的唯一 F08 邮箱来源不可用');};

/** Main-only native source controls. Renderer supplies its visible root task, never graph/session references. */
export function createF08SourceActions({getApplication,sourceHost,f03MailReview,confirmReview,now=Date.now}={}) {
  if(typeof getApplication!=='function'||!sourceHost)throw Error('Original F08 source actions are unavailable');
  function resolve(taskId,context,review=false){
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
          ||graph.cancelRequested||!(review?['running','waiting_approval','waiting_reconciliation','failed','succeeded']:['running','waiting_approval','waiting_reconciliation']).includes(graph.state)
          ||Date.parse(host.deadline)<=now())continue;
        const scope={parentTaskId:id,sessionId:intent.sessionId,deadline:host.deadline,signal:context.signal};
        if(review){
          const keys=runtime.listCheckpointKeys(id).filter(key=>key.startsWith('f08:mail-review:'));
          for(const key of keys){
            const reference={graphTaskId:id,readRunId:key.slice('f08:mail-review:'.length)};
            const source=sourceHost.readReviewSource(reference,scope);found.set(id+':'+reference.readRunId,{scope,source,reference});
          }
          if(!keys.length){const pending=runtime.loadCheckpoint(id,'f08:pending-replan:'+intent.sessionId);
            const change=pending&&runtime.loadCheckpoint(id,'f08:mail-source-change:'+pending.priorOperationId);
            if(change?.graphTaskId===id&&change.sessionId===intent.sessionId&&change.readRunId===pending.priorOperationId){
              const source={reason:pending.reason,requiresReview:true,plan:change.planSource?.plan??null,review:{affected:[]}};
              found.set(id+':'+change.readRunId,{scope,source,unavailable:true});
            }
          }
          continue;
        }
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
    readReview({taskId},context){const {scope,source,unavailable}=resolve(taskId,context,true);
      return {taskId,reviewId:digest(source),deadline:scope.deadline,plan:source.plan,affected:source.review.affected,
        requiresReview:source.requiresReview,effectsPreserved:true,canSubmit:!unavailable,...(source.reason?{reason:source.reason}:{})};},
    async submitReview(input,context){
      if(!input||Object.keys(input).sort().join(',')!=='commandId,reviewId,taskId'||typeof input.commandId!=='string'||!input.commandId||input.commandId.length>128)
        throw new ProtocolError('INVALID_ARGUMENT','原邮件审查需要明确操作和来源版本');
      const original=resolve(input.taskId,context,true);
      if(original.unavailable)throw new ProtocolError('UNSUPPORTED_CAPABILITY','原邮件任务缺少已选择的 Plan 与私密来源绑定；请先在现有计划入口明确选择来源，不会自动挑选计划');
      if(digest(original.source)!==input.reviewId||typeof f03MailReview?.submitChange!=='function'||typeof confirmReview!=='function')denied();
      const assertCurrent=()=>{if(digest(resolve(input.taskId,context,true).source)!==input.reviewId)denied();};
      if(await confirmReview({plan:original.source.plan,affected:original.source.review.affected,sourceDigest:original.source.review.sourceDigest},
        {...original.scope,assertCurrent,control:{boundUserTaskId:input.taskId,conversationId:context.conversationId,commandId:input.commandId}})!==true)
        return {state:'declined'};
      assertCurrent();
      const change=getApplication().runtime.loadCheckpoint(original.reference.graphTaskId,'f08:mail-source-change:'+original.reference.readRunId);
      return f03MailReview.submitChange(original.scope,{reviewReference:original.reference,change});
    },
    listSources:context=>sourceHost.listSources(context),
    withdraw:(input,context)=>sourceHost.withdrawSource({...input,deadline:context.deadline,signal:context.signal},context.control),
    erase:(input,context)=>sourceHost.eraseSource({...input,deadline:context.deadline,signal:context.signal},context.control),
  });
}

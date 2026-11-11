import {isDeepStrictEqual} from 'node:util';
import {notificationDigest} from '@personal-agent/notifications';

/** The original trusted return button admits exact per-scope graphs, without delivering or acknowledging feed items. */
export function createF12ReturnDigestController({getApplication,explicitReturnSource,notificationHost,
  readTimeoutMs,onTask,now=Date.now}) {
  return {submit(source){
    const accepted=explicitReturnSource.acceptExplicitReturn(source),application=getApplication();
    const key='desktop-f12-return:'+notificationDigest([source.taskId,source.commandId]);
    let original=application.runtime.loadCheckpoint(source.taskId,key);
    if(original===undefined){
      const groups=new Map();
      for(const item of notificationHost.getDigest({trigger:'on_return'}).items){
        const scopeKey=notificationDigest(item.scope),group=groups.get(scopeKey)??[];
        group.push(item.id);groups.set(scopeKey,group);
      }
      const deadline=new Date(Math.min(Date.parse(accepted.taskDeadline),now()+readTimeoutMs())).toISOString();
      const requests=[...groups].map(([scopeKey,itemIds])=>({conversationId:accepted.conversationId,deadline,
        idempotencyKey:accepted.idempotencyKey+':'+scopeKey,
        arguments:{itemIds:[...new Set(itemIds)].sort(),trigger:'on_return',returnSource:structuredClone(source)}}));
      application.runtime.saveCheckpointOnce(source.taskId,key,{source:structuredClone(source),requests});
      original=application.runtime.loadCheckpoint(source.taskId,key);
    }
    if(!original||!isDeepStrictEqual(original.source,source)||!Array.isArray(original.requests))
      throw Error('原归来摘要请求已变化，请查看原任务');
    const tasks=[];
    for(const request of original.requests){
      let task=application.readF12ReturnDigestTask(request.idempotencyKey);
      if(!task)task=application.submitF12ReturnDigestTask(request);
      onTask(task);tasks.push({taskId:task.taskId,state:task.state});
    }
    return {state:tasks.length?'submitted':'empty',tasks};
  }};
}

import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {createRuntimeF01ContextHost,readPersistedRuntimeProactiveWorkflow} from '@personal-agent/runtime/application';
import {createF01ContextSelectionHost} from './f01-context-selection-host.js';
import {createF01ModelCatalogSource} from './f01-model-catalog-source.js';

/** Existing public Fact, proactive responsibility and selected AgentArts sources. */
export function createF01WorkflowContextPorts({getApplication,getPublicFactHost,getProactiveHost,getAuthorizationIntentHost,
  models,readDeploymentBinding,assertCurrent,authorizeExport}) {
  const unavailable=()=>{throw new ProtocolError('UNSUPPORTED_CAPABILITY','F01 原上下文来源不可用');};
  const runtime=new Proxy({}, {get:(_target,name)=>(...args)=>getApplication().runtime[name](...args)});
  const application={runtime,readHostToolTask:(...args)=>getApplication().readHostToolTask(...args)};
  const selection=createF01ContextSelectionHost({getApplication,getPublicFactHost,getAuthorizationIntentHost,readDeploymentBinding});
  const modelSource=createF01ModelCatalogSource({getApplication,models,readDeploymentBinding,assertCurrent});
  function source(scope){
    assertCurrent(scope);const app=getApplication(),bound=app.readF01ContextBinding({taskId:scope.parentTaskId,sessionId:scope.sessionId,signal:scope.signal});
    if(!bound||bound.binding.deadline!==scope.deadline)return unavailable();
    const target=bound.binding.input.context.responsibilitySession,persisted=readPersistedRuntimeProactiveWorkflow(app.runtime,target.taskId,target.sessionId);
    if(!persisted)return unavailable();return {app,bound,target,persisted};
  }
  async function responsibilities(scope){
    selection.assertCurrent(scope);const original=source(scope),items=[],host=getProactiveHost();
    const entries=Object.entries(original.persisted.application.state.responsibilities);
    if(entries.length>100||typeof host?.readResponsibility!=='function')return unavailable();
    for(const [id,value] of entries.sort(([a],[b])=>a.localeCompare(b))){
      const read=await host.readResponsibility(original.target,{responsibilityId:id,responsibilityRevision:value.revision},original.bound.user.taskId,scope);
      if(read.lifecycle.state==='current')items.push({id,revision:read.responsibility.revision,authority:read.responsibility.authority,sourceQuotes:read.responsibility.sourceQuotes});
    }
    const current=source(scope);
    if(host!==getProactiveHost()||original.app!==current.app||!isDeepStrictEqual(original.persisted.application,current.persisted.application))return unavailable();
    return {revision:String(current.persisted.application.revision),items};
  }
  const memory=Object.fromEntries(['listCurrent','getVersion'].map(name=>[name,async request=>{
    const original=getPublicFactHost();if(typeof original?.facts?.publicMemory?.[name]!=='function')return unavailable();
    const result=await original.facts.publicMemory[name](request),current=getPublicFactHost();
    if(original.facts!==current?.facts||original.memoryNamespace!==current.memoryNamespace)return unavailable();return result;
  }]));
  const host=createRuntimeF01ContextHost({application,memory,requiredScopes:['memory:read','responsibility:read'],now:()=>new Date(),assertCurrent,
    readResponsibilities:responsibilities,readModels:async scope=>modelSource(scope),
    resolveQuery:async scope=>{if(await selection.prepare(scope)!==true)throw new ProtocolError('UNAUTHORIZED','F01 原来源选择未确认');return selection.resolveQuery(scope);},
    authorizeExport});
  return {...host,selection,
    /** Synchronous final-send guard; never caches validity across credentials or an await. */
    assertSourcesCurrent(scope,result){
      selection.assertCurrent(scope);const current=source(scope),memory=getPublicFactHost();
      if(!isDeepStrictEqual(result.models,modelSource(scope))||result.responsibilities.revision!==String(current.persisted.application.revision)
        ||result.memory.facts.some(fact=>!isDeepStrictEqual(memory.facts.readCurrentPublicFact(fact.ref),fact)))return unavailable();
      for(const item of result.responsibilities.items){
        const lifecycle=current.persisted.application.state.responsibilityLifecycles?.[item.id];
        if(lifecycle?.state!=='active'||lifecycle.responsibilityRevision!==item.revision||Date.parse(lifecycle.validUntil)<=Date.now())return unavailable();
        for(const quote of [...item.sourceQuotes,lifecycle.activationQuote]){
          const task=current.app.runtime.getTask(quote.messageId);
          if(current.app.runtime.loadCheckpoint(task.taskId,'private-copy-erasure')!==undefined||current.app.runtime.loadCheckpoint(task.taskId,'private-copy-erasure-binding')!==undefined
            ||task.conversationId!==quote.conversationId||!task.goal||quote.quoteRef!=='runtime:task:'+task.taskId+':goal'
            ||createHash('sha256').update(task.goal).digest('hex')!==quote.sha256)return unavailable();
        }
      }
    }};
}

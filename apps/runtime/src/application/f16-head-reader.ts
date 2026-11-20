import {isDeepStrictEqual} from 'node:util';
import type {ToolContext} from '@personal-agent/contracts';
import type {OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';
import type {F16HeadRequest,F16ReadStage} from './f16-ci-failure-ports.js';
import {awaitF16Port,readF16Source,assertF16SourceAction,sourceObject,sourceFailure,type F16SourceApplication,type F16SourceRead} from './f16-source-receipts.js';

/** Each fresh read reserves an exact phase/action before invoking the original bridge.
 * An interrupted reservation retains that action; unknown reads never acquire a new ID. */
export function createF16HeadReader(options:{application:F16SourceApplication;now:()=>Date;
  invokeWorkspaceHead:(scope:OwnedWorkflowHostScope,request:F16HeadRequest,context:ToolContext)=>Promise<F16SourceRead>}) {
  return async(scope:OwnedWorkflowHostScope,context:ToolContext,repository:string,workflow:'f16'|'f17',stage:F16ReadStage)=>{
    const runtime=options.application.runtime;
    for(let sequence=0;sequence<32;sequence++){
      const actionKey=`${workflow}.head.${stage}.${sequence}`,key='f16-f17:head:'+actionKey;
      const completed=runtime.loadCheckpoint(scope.localTaskId,key+':receipt');
      if(completed!==undefined){
        if(!sourceObject(completed)||!sourceObject(completed.ref))sourceFailure('Original HEAD receipt marker changed');
        const source=readF16Source(options.application,scope,completed.ref as F16SourceRead,'workspace.git.head');
        assertF16SourceAction(source,scope,actionKey);
        if(!isDeepStrictEqual(completed,source))sourceFailure('Original HEAD receipt changed');
        continue;
      }
      const request:F16HeadRequest={actionKey,stage,toolName:'workspace.git.head',toolVersion:'1.0.0',arguments:{repository},deadline:scope.deadline};
      const intent={parentTaskId:scope.parentTaskId,sessionId:scope.sessionId,operationId:scope.operationId,request};
      runtime.saveCheckpointOnce(scope.localTaskId,key,intent);
      if(!isDeepStrictEqual(runtime.loadCheckpoint(scope.localTaskId,key),intent))sourceFailure('Original HEAD phase changed');
      const ref=await awaitF16Port(scope,options.now,()=>options.invokeWorkspaceHead(scope,structuredClone(request),context));
      const source=readF16Source(options.application,scope,ref,request.toolName);
      assertF16SourceAction(source,scope,actionKey);
      if(ref.toolVersion!==request.toolVersion||!isDeepStrictEqual(ref.arguments,request.arguments))sourceFailure('Original HEAD input changed');
      runtime.saveCheckpointOnce(scope.localTaskId,key+':receipt',source);
      if(!isDeepStrictEqual(runtime.loadCheckpoint(scope.localTaskId,key+':receipt'),source))sourceFailure('Original HEAD receipt changed');
      return source;
    }
    sourceFailure('Original HEAD observation budget exhausted');
  };
}

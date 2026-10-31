import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {F16FailureBinding} from './workflow-f16-ci-failure-host.js';
import type {OwnedWorkflowHostScope as Scope} from './workflow-owned-host-scope.js';
import {awaitF16Port,readF16Source,sourceObject,sourceFailure,type F16SourceRead,type F16SourceApplication} from './f16-source-receipts.js';

export type F16HeadRequest={commandId:string;toolName:'workspace.git.head';toolVersion:'1.0.0';arguments:{repository:string};deadline:string};
export interface F16CiFailurePortsOptions {
  application:F16SourceApplication;
  selectionCheckpointKey:string;
  now:()=>Date;
  /** The existing trusted child bridge must submit this exact request through Policy/Gateway.
   * Return only its persisted original source reference. Pending/unknown is not success. */
  invokeWorkspaceHead:(scope:Scope,request:F16HeadRequest)=>Promise<F16SourceRead>;
}

/** Trusted composition API, never a model tool or a replacement GitHub provider. */
export function createF16CiFailurePorts(options:F16CiFailurePortsOptions) {
  if(!options.selectionCheckpointKey?.trim()||typeof options.invokeWorkspaceHead!=='function')
    sourceFailure('F16 trusted selection and HEAD invocation required');
  const {application}=options;
  const key=(scope:Scope)=>options.selectionCheckpointKey+':'+scope.sessionId;
  const snapshot=(scope:Scope,binding:F16FailureBinding)=>[
    readF16Source(application,scope,binding.runList,'github.actions.run.list'),
    readF16Source(application,scope,binding.jobList,'github.actions.job.list'),
    readF16Source(application,scope,binding.logRead,'github.actions.log.read')];
  const selection=(scope:Scope)=>{
    const saved=application.runtime.loadCheckpoint(scope.parentTaskId,key(scope)) as
      {parentTaskId:string;sessionId:string;deadline:string;binding:F16FailureBinding;sources:unknown}|undefined;
    if(!saved||saved.parentTaskId!==scope.parentTaskId||saved.sessionId!==scope.sessionId||saved.deadline!==scope.deadline
      ||!isDeepStrictEqual(saved.sources,snapshot(scope,saved.binding)))sourceFailure('F16 selected source changed');
    return structuredClone(saved);
  };
  return {
    bindSelection(scope:Scope,binding:F16FailureBinding) {
      const saved={parentTaskId:scope.parentTaskId,sessionId:scope.sessionId,deadline:scope.deadline,
        binding:structuredClone(binding),sources:snapshot(scope,binding)};
      application.runtime.saveCheckpointOnce(scope.parentTaskId,key(scope),saved);
      if(!isDeepStrictEqual(saved,selection(scope)))sourceFailure('F16 selection cannot be replaced');
    },
    resolveFailure:async(scope:Scope)=>selection(scope).binding,
    assertSelectionCurrent:(scope:Scope)=>{selection(scope);},
    readCurrentHead:async(scope:Scope)=>{
      const before=selection(scope),request:F16HeadRequest={commandId:'f16-head:'+randomUUID(),toolName:'workspace.git.head',
        toolVersion:'1.0.0',arguments:{repository:before.binding.repo},deadline:scope.deadline};
      const ref=await awaitF16Port(scope,options.now,()=>options.invokeWorkspaceHead(scope,structuredClone(request)));
      const source=readF16Source(application,scope,ref,request.toolName);
      if(source.read.commandId!==request.commandId||ref.toolVersion!==request.toolVersion||!isDeepStrictEqual(ref.arguments,request.arguments)
        ||!sourceObject(source.result)||typeof source.result.headSha!=='string'
        ||!isDeepStrictEqual(before,selection(scope)))sourceFailure('F16 fresh HEAD receipt changed');
      return source.result.headSha;
    },
  };
}

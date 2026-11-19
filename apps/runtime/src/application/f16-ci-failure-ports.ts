import {isDeepStrictEqual} from 'node:util';
import type {ToolContext} from '@personal-agent/contracts';
import type {F16FailureBinding} from './workflow-f16-ci-failure-host.js';
import type {OwnedWorkflowHostScope as Scope} from './workflow-owned-host-scope.js';
import {readF16Source,sourceObject,sourceFailure,type F16SourceRead,type F16SourceApplication} from './f16-source-receipts.js';
import {createF16HeadReader} from './f16-head-reader.js';

export type F16ReadStage='execute'|'before_export'|'after_export'|'before_command'|'after_command';
export type F16HeadRequest={actionKey:string;stage:F16ReadStage;toolName:'workspace.git.head';toolVersion:'1.0.0';arguments:{repository:string};deadline:string};
export interface F16CiFailurePortsOptions {
  application:F16SourceApplication;
  selectionCheckpointKey:string;
  now:()=>Date;
  /** The existing trusted child bridge must submit this exact request through Policy/Gateway.
   * Return only its persisted original source reference. Pending/unknown is not success. */
  invokeWorkspaceHead:(scope:Scope,request:F16HeadRequest,context:ToolContext)=>Promise<F16SourceRead>;
}

/** Trusted composition API, never a model tool or a replacement GitHub provider. */
export function createF16CiFailurePorts(options:F16CiFailurePortsOptions) {
  if(!options.selectionCheckpointKey?.trim()||typeof options.invokeWorkspaceHead!=='function')
    sourceFailure('F16 trusted selection and HEAD invocation required');
  const {application}=options;
  const readHead=createF16HeadReader(options);
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
    readCurrentHead:async(scope:Scope,context:ToolContext,stage:F16ReadStage)=>{
      const before=selection(scope),source=await readHead(scope,context,before.binding.repo,'f16',stage);
      if(!sourceObject(source.result)||typeof source.result.headSha!=='string'
        ||!isDeepStrictEqual(before,selection(scope)))sourceFailure('F16 fresh HEAD receipt changed');
      return source.result.headSha;
    },
  };
}

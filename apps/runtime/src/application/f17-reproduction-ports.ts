import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {WorkspaceCommandRecipe} from '@personal-agent/coding-tools';
import type {OwnedWorkflowHostScope as Scope} from './workflow-owned-host-scope.js';
import type {F16HeadRequest} from './f16-ci-failure-ports.js';
import {awaitF16Port,readF16Source,sourceObject,sourceFailure,type F16SourceRead,type F16SourceApplication} from './f16-source-receipts.js';

export interface F17ReproductionBinding {
  operationId:string;repository:string;command:F16SourceRead;beforeHead:F16SourceRead;afterHead:F16SourceRead;
}
export interface F17Reproduction {
  repository:string;headSha:string;workspaceFingerprint:string;recipeId:string;recipeDigest:string;
  command:F16SourceRead;beforeHead:F16SourceRead;afterHead:F16SourceRead;
}
export interface F17ReproductionPortsOptions {
  application:F16SourceApplication;
  checkpointPrefix:string;
  /** Same trusted recipe definitions supplied to createWorkspaceCommandTool. No secret values are persisted. */
  recipes:readonly WorkspaceCommandRecipe[];
  now:()=>Date;
  invokeWorkspaceHead:(scope:Scope,request:F16HeadRequest)=>Promise<F16SourceRead>;
}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Bind an already executed N03 command, never execute or retry the reproduction here. */
export function createF17ReproductionPorts(options:F17ReproductionPortsOptions) {
  if(!options.checkpointPrefix?.trim()||!options.recipes.length||typeof options.invokeWorkspaceHead!=='function')
    sourceFailure('F17 trusted recipes, version sources and HEAD invocation required');
  const recipes=structuredClone(options.recipes);
  const snapshot=(scope:Scope,binding:F17ReproductionBinding)=>{
    const {application}=options;
    const command=readF16Source(application,scope,binding.command,'workspace.run_allowed_command');
    const before=readF16Source(application,scope,binding.beforeHead,'workspace.git.head');
    const after=readF16Source(application,scope,binding.afterHead,'workspace.git.head');
    const recipe=recipes.find(v=>v.id===binding.command.arguments.recipeId);
    const prepared=application.runtime.loadCheckpoint(scope.parentTaskId,options.checkpointPrefix+'prepared:'+binding.operationId);
    if(!sourceObject(prepared)||prepared.parentTaskId!==scope.parentTaskId||prepared.sessionId!==scope.sessionId
      ||prepared.deadline!==scope.deadline||prepared.repository!==binding.repository||prepared.operationId!==binding.operationId
      ||!recipe||prepared.recipeDigest!==digest(recipe)||!isDeepStrictEqual(prepared.beforeHead,before)
      ||typeof prepared.preparedAt!=='string'||!Number.isFinite(Date.parse(prepared.preparedAt))
      ||Date.parse(before.record.finishedAt!)>Date.parse(prepared.preparedAt)
      ||Date.parse(prepared.preparedAt)>Date.parse(command.record.startedAt))
      sourceFailure('F17 original recipe preparation unavailable');
    if(!recipe||command.read.commandId!==binding.operationId||!isDeepStrictEqual(binding.command.arguments,{recipeId:recipe.id})
      ||!isDeepStrictEqual(binding.beforeHead.arguments,{repository:binding.repository})
      ||!isDeepStrictEqual(binding.afterHead.arguments,{repository:binding.repository})
      ||new Set([binding.command.taskId,binding.beforeHead.taskId,binding.afterHead.taskId]).size!==3
      ||!sourceObject(command.result)||command.result.recipeId!==recipe.id||!Number.isSafeInteger(command.result.exitCode)
      ||Number(command.result.exitCode)<=0||typeof command.result.stdout!=='string'||typeof command.result.stderr!=='string'
      ||!sourceObject(before.result)||!sourceObject(after.result)||!isDeepStrictEqual(before.result,after.result)
      ||typeof before.result.headSha!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(before.result.headSha)
      ||typeof before.result.fingerprint!=='string'||!/^[a-f0-9]{64}$/u.test(before.result.fingerprint)
      ||![before.record.finishedAt,command.record.startedAt,command.record.finishedAt,after.record.startedAt].every(v=>typeof v==='string'&&Number.isFinite(Date.parse(v)))
      ||Date.parse(before.record.finishedAt!)>Date.parse(command.record.startedAt)
      ||Date.parse(command.record.finishedAt!)>Date.parse(after.record.startedAt))sourceFailure('F17 command version evidence unavailable');
    const reproduction:F17Reproduction={repository:binding.repository,headSha:before.result.headSha,
      workspaceFingerprint:before.result.fingerprint,recipeId:recipe.id,recipeDigest:digest(recipe),
      command:binding.command,beforeHead:binding.beforeHead,afterHead:binding.afterHead};
    return {reproduction,sources:{command,before,after}};
  };
  const selected=(scope:Scope,operationId:string)=>{
    const saved=options.application.runtime.loadCheckpoint(scope.parentTaskId,options.checkpointPrefix+operationId) as
      {parentTaskId:string;sessionId:string;deadline:string;binding:F17ReproductionBinding;snapshot:ReturnType<typeof snapshot>}|undefined;
    if(!saved||saved.parentTaskId!==scope.parentTaskId||saved.sessionId!==scope.sessionId||saved.deadline!==scope.deadline
      ||saved.binding.operationId!==operationId||!isDeepStrictEqual(saved.snapshot,snapshot(scope,saved.binding)))
      sourceFailure('F17 original reproduction binding changed');
    return structuredClone(saved);
  };
  return {
    /** Call before dispatching N03 using the same registered recipe table. */
    prepareReproduction(scope:Scope,input:{operationId:string;repository:string;recipeId:string;beforeHead:F16SourceRead}) {
      const recipe=recipes.find(v=>v.id===input.recipeId);
      const beforeHead=readF16Source(options.application,scope,input.beforeHead,'workspace.git.head');
      if(!recipe||!isDeepStrictEqual(input.beforeHead.arguments,{repository:input.repository})
        ||options.application.runtime.loadCheckpoint(scope.parentTaskId,'coding-repair:host:'+input.operationId)!==undefined)
        sourceFailure('F17 recipe must be bound before original dispatch');
      const value={parentTaskId:scope.parentTaskId,sessionId:scope.sessionId,deadline:scope.deadline,operationId:input.operationId,
        repository:input.repository,recipeDigest:digest(recipe),beforeHead};
      const key=options.checkpointPrefix+'prepared:'+input.operationId;
      const saved=options.application.runtime.loadCheckpoint(scope.parentTaskId,key);
      if(saved!==undefined){
        if(!sourceObject(saved)||!isDeepStrictEqual({...saved,preparedAt:undefined},{...value,preparedAt:undefined}))
          sourceFailure('F17 original recipe preparation changed');
        return;
      }
      options.application.runtime.saveCheckpointOnce(scope.parentTaskId,key,{...value,preparedAt:options.now().toISOString()});
    },
    bindReproduction(scope:Scope,binding:F17ReproductionBinding) {
      const saved={parentTaskId:scope.parentTaskId,sessionId:scope.sessionId,deadline:scope.deadline,
        binding:structuredClone(binding),snapshot:snapshot(scope,binding)};
      options.application.runtime.saveCheckpointOnce(scope.parentTaskId,options.checkpointPrefix+binding.operationId,saved);
      if(!isDeepStrictEqual(saved,selected(scope,binding.operationId)))sourceFailure('F17 reproduction cannot be replaced');
    },
    resolveReproduction:async(scope:Scope,command:{taskId:string;operationId:string;arguments:Record<string,unknown>})=>{
      const before=selected(scope,command.operationId),bound=before.snapshot.reproduction;
      if(bound.command.taskId!==command.taskId||!isDeepStrictEqual(bound.command.arguments,command.arguments))
        sourceFailure('F17 reproduction is from another command');
      const request:F16HeadRequest={commandId:'f17-head:'+randomUUID(),toolName:'workspace.git.head',toolVersion:'1.0.0',
        arguments:{repository:bound.repository},deadline:scope.deadline};
      const ref=await awaitF16Port(scope,options.now,()=>options.invokeWorkspaceHead(scope,structuredClone(request)));
      const current=readF16Source(options.application,scope,ref,request.toolName);
      if(current.read.commandId!==request.commandId||ref.toolVersion!==request.toolVersion||!isDeepStrictEqual(ref.arguments,request.arguments)
        ||!sourceObject(current.result)||current.result.headSha!==bound.headSha||current.result.fingerprint!==bound.workspaceFingerprint
        ||!isDeepStrictEqual(before,selected(scope,command.operationId)))sourceFailure('F17 workspace or source changed');
      return structuredClone(bound);
    },
  };
}

import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {ToolContext} from '@personal-agent/contracts';
import type {F17RecipeBinding} from './f17-recipe-binding.js';
import type {OwnedWorkflowHostScope as Scope} from './workflow-owned-host-scope.js';
import type {F16HeadRequest,F16ReadStage} from './f16-ci-failure-ports.js';
import {readF16Source,sourceObject,sourceFailure,type F16SourceRead,type F16SourceApplication} from './f16-source-receipts.js';
import {createF16HeadReader} from './f16-head-reader.js';

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
  /** Original recipe definitions or the existing command host's immutable configuration binding. */
  recipes:readonly F17RecipeBinding[];
  now:()=>Date;
  invokeWorkspaceHead:(scope:Scope,request:F16HeadRequest,context:ToolContext)=>Promise<F16SourceRead>;
}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Bind an already executed N03 command, never execute or retry the reproduction here. */
export function createF17ReproductionPorts(options:F17ReproductionPortsOptions) {
  if(!options.checkpointPrefix?.trim()||!options.recipes.length||typeof options.invokeWorkspaceHead!=='function')
    sourceFailure('F17 trusted recipes, version sources and HEAD invocation required');
  const recipes=structuredClone(options.recipes);
  const readHead=createF16HeadReader(options);
  const snapshot=(scope:Scope,binding:F17ReproductionBinding)=>{
    const {application}=options;
    const command=readF16Source(application,scope,binding.command,'workspace.run_allowed_command');
    const before=readF16Source(application,scope,binding.beforeHead,'workspace.git.head');
    const after=readF16Source(application,scope,binding.afterHead,'workspace.git.head');
    const recipe=recipes.find(v=>v.id===binding.command.arguments.recipeId);
    const prepared=application.runtime.loadCheckpoint(scope.parentTaskId,options.checkpointPrefix+'prepared:'+binding.operationId);
    const observed=application.runtime.loadCheckpoint(binding.command.taskId,'f17:command-observation');
    if(observed!==undefined){
      const finished=application.runtime.loadCheckpoint(binding.command.taskId,'f17:command-observation:finished');
      const last=application.runtime.loadCheckpoint(binding.command.taskId,'f17:command-observation:after');
      if(!sourceObject(observed)||observed.version!==1||observed.parentTaskId!==scope.parentTaskId
        ||observed.sessionId!==scope.sessionId||observed.operationId!==binding.operationId||observed.deadline!==scope.deadline
        ||observed.taskId!==binding.command.taskId||observed.runId!==binding.command.runId||observed.repository!==binding.repository
        ||!recipe||observed.recipeDigest!==digest(recipe)||!isDeepStrictEqual(observed.beforeHead,before)||!isDeepStrictEqual(last,after)
        ||!sourceObject(finished)||finished.resultDigest!==digest(command.result))sourceFailure('F17 original execution observation changed');
      const times=[command.record.startedAt,before.record.finishedAt,observed.startedAt,finished.finishedAt,after.record.startedAt,command.record.finishedAt];
      if(!times.every(v=>typeof v==='string'&&Number.isFinite(Date.parse(v)))
        ||times.some((v,i)=>i>0&&Date.parse(v as string)<Date.parse(times[i-1] as string)))
        sourceFailure('F17 original execution order changed');
    }else if(!sourceObject(prepared)||prepared.parentTaskId!==scope.parentTaskId||prepared.sessionId!==scope.sessionId
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
      ||observed===undefined&&(Date.parse(before.record.finishedAt!)>Date.parse(command.record.startedAt)
      ||Date.parse(command.record.finishedAt!)>Date.parse(after.record.startedAt)))sourceFailure('F17 command version evidence unavailable');
    const reproduction:F17Reproduction={repository:binding.repository,headSha:before.result.headSha,
      workspaceFingerprint:before.result.fingerprint,recipeId:recipe.id,recipeDigest:digest(recipe),
      command:binding.command,beforeHead:binding.beforeHead,afterHead:binding.afterHead};
    return {reproduction,sources:{command,before,after,preparation:observed??prepared,
      ...(observed!==undefined?{finished:application.runtime.loadCheckpoint(binding.command.taskId,'f17:command-observation:finished')}:{})}};
  };
  const selected=(scope:Scope,operationId:string)=>{
    const saved=options.application.runtime.loadCheckpoint(scope.parentTaskId,options.checkpointPrefix+operationId) as
      {parentTaskId:string;sessionId:string;deadline:string;binding:F17ReproductionBinding;snapshot:ReturnType<typeof snapshot>}|undefined;
    if(!saved||saved.parentTaskId!==scope.parentTaskId||saved.sessionId!==scope.sessionId||saved.deadline!==scope.deadline
      ||saved.binding.operationId!==operationId||!isDeepStrictEqual(saved.snapshot,snapshot(scope,saved.binding)))
      sourceFailure('F17 original reproduction binding changed');
    return structuredClone(saved);
  };
  const bindReproduction=(scope:Scope,binding:F17ReproductionBinding)=>{
    const saved={parentTaskId:scope.parentTaskId,sessionId:scope.sessionId,deadline:scope.deadline,
      binding:structuredClone(binding),snapshot:snapshot(scope,binding)};
    options.application.runtime.saveCheckpointOnce(scope.parentTaskId,options.checkpointPrefix+binding.operationId,saved);
    if(!isDeepStrictEqual(saved,selected(scope,binding.operationId)))sourceFailure('F17 reproduction cannot be replaced');
  };
  return {
    assertReproductionCurrent(scope:Scope,operationId:string){selected(scope,operationId);},
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
    bindReproduction,
    bindObservedReproduction(scope:Scope,command:F16SourceRead){
      const read=readF16Source(options.application,scope,command,'workspace.run_allowed_command');
      const observed=options.application.runtime.loadCheckpoint(command.taskId,'f17:command-observation');
      const after=options.application.runtime.loadCheckpoint(command.taskId,'f17:command-observation:after');
      if(!sourceObject(observed)||typeof observed.repository!=='string'||!sourceObject(observed.beforeHead)
        ||!sourceObject(after))sourceFailure('F17 original before/after observations unavailable');
      bindReproduction(scope,{operationId:read.read.commandId,repository:observed.repository,command,
        beforeHead:observed.beforeHead.ref as F16SourceRead,afterHead:after.ref as F16SourceRead});
    },
    resolveReproduction:async(scope:Scope,command:{taskId:string;operationId:string;arguments:Record<string,unknown>},
      context:ToolContext,stage:F16ReadStage)=>{
      const before=selected(scope,command.operationId),bound=before.snapshot.reproduction;
      if(bound.command.taskId!==command.taskId||!isDeepStrictEqual(bound.command.arguments,command.arguments))
        sourceFailure('F17 reproduction is from another command');
      const current=await readHead(scope,context,bound.repository,'f17',stage);
      if(!sourceObject(current.result)||current.result.headSha!==bound.headSha||current.result.fingerprint!==bound.workspaceFingerprint
        ||!isDeepStrictEqual(before,selected(scope,command.operationId)))sourceFailure('F17 workspace or source changed');
      return structuredClone(bound);
    },
  };
}

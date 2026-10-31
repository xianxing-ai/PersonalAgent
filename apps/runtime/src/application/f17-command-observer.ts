import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import type {WorkspaceCommandRecipe} from '@personal-agent/coding-tools';
import type {RuntimeApplication} from './runtime-application.js';
import {assertOwnedWorkflowHostScope,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';
import {createF16HeadReader} from './f16-head-reader.js';
import type {F16HeadRequest} from './f16-ci-failure-ports.js';
import {awaitF16Port,sourceObject,sourceFailure,type F16SourceRead} from './f16-source-receipts.js';

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Wrap the registered implementation inside its existing Policy/Gateway invocation.
 * The original command is called once. No new command tool, executor or grant is created. */
export function createF17ObservedCommandTool(options:{getApplication:()=>RuntimeApplication;tool:RegisteredTool;
  recipes:readonly WorkspaceCommandRecipe[];now:()=>Date;
  assertCurrent:(scope:OwnedWorkflowHostScope,context:ToolContext)=>void;
  invokeWorkspaceHead:(scope:OwnedWorkflowHostScope,request:F16HeadRequest,context:ToolContext)=>Promise<F16SourceRead>}):RegisteredTool {
  if(options.tool.descriptor.name!=='workspace.run_allowed_command'||options.tool.descriptor.version!=='1.0.0'
    ||!options.recipes.length)sourceFailure('Original workspace command implementation required');
  const recipes=structuredClone(options.recipes);
  const application={get runtime(){return options.getApplication().runtime;},
    readHostToolTask:(id:string)=>options.getApplication().readHostToolTask(id)};
  const readHead=createF16HeadReader({...options,application});
  return {descriptor:options.tool.descriptor,async execute(input:unknown,context:ToolContext){
    const runtime=application.runtime,parent=runtime.loadCheckpoint(context.taskId,'coding-repair:parent');
    const intent=sourceObject(parent)&&typeof parent.taskId==='string'&&typeof parent.operationId==='string'
      ?runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId):undefined;
    if(!sourceObject(intent)||intent.workflowId!=='F17')return options.tool.execute(input,context);
    const scope=assertOwnedWorkflowHostScope({runtime,context,workflowId:'F17',nodeId:'F17_N03',
      hostToolName:options.tool.descriptor.name,proposalArguments:input,assertCurrent:options.assertCurrent,now:options.now});
    const bound=options.getApplication().readConfiguredWorkflowBinding({taskId:scope.parentTaskId,workflowId:'F17',
      sessionId:scope.sessionId,signal:scope.signal});
    if(!bound||bound.deadline!==scope.deadline||!sourceObject(bound.input)||typeof bound.input.repository!=='string'
      ||!isDeepStrictEqual(input,{recipeId:bound.input.recipeId}))sourceFailure('Original F17 command selection unavailable');
    const recipeId=bound.input.recipeId,recipe=recipes.find(v=>v.id===recipeId);
    if(!recipe)sourceFailure('Original F17 recipe unavailable');
    const key='f17:command-observation',repository=bound.input.repository;
    if(runtime.loadCheckpoint(context.taskId,key)!==undefined)sourceFailure('Original F17 command observation cannot replay');
    const before=await readHead(scope,context,repository,'f17','before_command');
    options.assertCurrent(scope,context);
    if(!sourceObject(before.result)||before.result.headSha!==bound.input.headSha)sourceFailure('Original F17 HEAD changed before command');
    const observation={version:1,parentTaskId:scope.parentTaskId,sessionId:scope.sessionId,operationId:scope.operationId,
      taskId:context.taskId,runId:context.runId,deadline:scope.deadline,repository,recipeDigest:digest(recipe),beforeHead:before,
      startedAt:options.now().toISOString()};
    if(!runtime.saveCheckpointOnce(context.taskId,key,observation))sourceFailure('Original F17 command already reserved');
    const result=await awaitF16Port(scope,options.now,()=>options.tool.execute(input,context));
    const finished={finishedAt:options.now().toISOString(),resultDigest:digest(result)};
    runtime.saveCheckpointOnce(context.taskId,key+':finished',finished);
    options.assertCurrent(scope,context);
    const after=await readHead(scope,context,repository,'f17','after_command');
    if(!isDeepStrictEqual(before.result,after.result))sourceFailure('F17 command changed its original workspace version');
    runtime.saveCheckpointOnce(context.taskId,key+':after',after);
    return result;
  }} satisfies RegisteredTool;
}

import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,ToolNotStartedError} from '@personal-agent/contracts';
import type {ToolDescriptor} from '@personal-agent/contracts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {AgentToolPort,SubtaskDefinition} from '@personal-agent/agents';
import {computeSubtaskInputDigest} from '@personal-agent/agents';
import type {WorkerContext} from '../index.js';
import type {RuntimeApplication} from './runtime-application.js';
import {readWorkflowBusinessToolOrigin} from './workflow-business-tool-bridge.js';

export interface F28ToolExecution {tools:ToolDescriptor[];maxSteps:number;}
function fail(message='Original F28 tool delegation, scope or authority changed'):never {throw new ProtocolError('UNAUTHORIZED',message);}
export function f28ToolDefinition(taskId:string,goal:string,execution:F28ToolExecution):SubtaskDefinition {
  return {subtaskId:'f28-tools-'+createHash('sha256').update(taskId).digest('hex').slice(0,32),role:'researcher',
    roleLabel:'F28 read-only tool exploration',goal,thinkingDepth:execution.maxSteps/2-1};
}

/** Exact graph -> N12 host -> original dispatch -> ordinary subagent. This read
 * only limits its existing ToolGateway; it cannot issue a tool grant. */
export function readF28SubagentScope(application:RuntimeApplication,taskId:string,signal:AbortSignal):
  {origin:{dispatchTaskId:string;graphTaskId:string;sessionId:string};tools:ToolDescriptor[];definition:SubtaskDefinition}|undefined {
  const runtime=application.runtime,child=runtime.getTask(taskId);
  const parent=runtime.loadCheckpoint(taskId,'subtask-parent') as (SubtaskDefinition&{parentTaskId:string;parentDeadline:string})|undefined;
  const marker=runtime.loadCheckpoint(taskId,'f28:tool-scope-origin') as {dispatchTaskId:string;graphTaskId:string;sessionId:string}|undefined;
  if(!parent)return undefined;
  const dispatch=runtime.loadCheckpoint(parent.parentTaskId,'host-tool-intent') as {toolName?:string;arguments?:Record<string,unknown>}|undefined;
  const source=runtime.loadCheckpoint(parent.parentTaskId,'workflow-business-tool:source') as {sourceTaskId?:string}|undefined;
  const host=source?.sourceTaskId?runtime.loadCheckpoint(source.sourceTaskId,'host-tool-intent') as {toolName?:string}|undefined:undefined;
  if(host?.toolName!=='workflow.host.f28_n12'){if(marker)fail();return undefined;}
  const edge=runtime.loadCheckpoint(source!.sourceTaskId!,'coding-repair:parent') as {taskId:string;operationId:string}|undefined;
  const graphIntent=edge&&runtime.loadCheckpoint(edge.taskId,'owned-workflow:intent:'+edge.operationId) as {sessionId?:string}|undefined;
  if(!edge||!graphIntent?.sessionId||dispatch?.toolName!=='subagent.dispatch'||!dispatch.arguments)fail();
  const proof=readWorkflowBusinessToolOrigin(application,{parentTaskId:edge.taskId,sessionId:graphIntent.sessionId,deadline:parent.parentDeadline},
    {taskId:parent.parentTaskId,runId:'host-tool-'+parent.parentTaskId,scopeRef:'host-tool-'+parent.parentTaskId,toolVersion:'1.0.0',arguments:dispatch.arguments},'subagent.dispatch');
  const saved=runtime.loadCheckpoint(edge.taskId,'f28:original-model-candidates') as
    {user?:{taskId:string;conversationId:string;deadline:string};goalDigest?:string;toolExecution?:F28ToolExecution}|undefined;
  const user=application.readDelegatedUserTaskParent(edge.taskId),execution=saved?.toolExecution;
  const sourceGrant=runtime.policy.get(proof.sourceHost.runId),dispatchGrant=runtime.policy.get(proof.reference.runId);
  if(!execution||!user||!isDeepStrictEqual(saved.user,user)||user.deadline!==parent.parentDeadline||signal.aborted
    ||Date.now()>=Date.parse(parent.parentDeadline)||child.cancelRequested||!['running','waiting_approval'].includes(child.state)
    ||proof.actionKey!=='f28.tools.dispatch'||proof.graph.workflowId!=='F28'||proof.graph.nodeId!=='F28_N12'
    ||proof.sourceHost.taskId!==source!.sourceTaskId||!runtime.isToolExecutionActive(runtime.readToolExecutions(proof.sourceHost.taskId)
      .find(record=>record.evidenceId===proof.sourceHost.runId)!)||!application.isDefaultSubagentAvailable()
    ||!sourceGrant||sourceGrant.taskId!==proof.sourceHost.taskId||sourceGrant.toolName!=='workflow.host.f28_n12'
    ||sourceGrant.argumentsDigest!==toolArgumentsDigest({})||Date.parse(sourceGrant.expiresAt)<=Date.now()
    ||!dispatchGrant||dispatchGrant.taskId!==parent.parentTaskId||dispatchGrant.toolName!=='subagent.dispatch'
    ||dispatchGrant.argumentsDigest!==toolArgumentsDigest(dispatch.arguments)||Date.parse(dispatchGrant.expiresAt)<=Date.now())fail('Original F28 delegation authority is no longer active');
  const goal=runtime.getTask(user.taskId).goal;if(typeof goal!=='string'||!goal)fail();
  const definition=f28ToolDefinition(edge.taskId,goal,execution);
  if(saved.goalDigest!==createHash('sha256').update(JSON.stringify(goal)).digest('hex')
    ||!isDeepStrictEqual(parent,{...definition,parentTaskId:proof.reference.taskId,parentDeadline:parent.parentDeadline})
    ||!isDeepStrictEqual(dispatch.arguments,{subtasks:[definition]})
    ||child.conversationId!=='desktop-subtask:'+parent.parentTaskId||child.goal!==`[${definition.roleLabel}] ${goal}`
    ||runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.parentTaskId}-${definition.subtaskId}`)?.taskId!==taskId
    ||!isDeepStrictEqual(execution.tools.map(tool=>runtime.readToolDescriptors().find(item=>item.name===tool.name&&item.version===tool.version)),execution.tools)
    ||execution.tools.some(tool=>tool.sideEffect!=='read'||/^(?:workflow\.|subagent\.|developer\.)/.test(tool.name)))fail();
  const origin={dispatchTaskId:parent.parentTaskId,graphTaskId:edge.taskId,sessionId:graphIntent.sessionId};
  if(marker&&!isDeepStrictEqual(marker,origin))fail();
  return {origin,tools:structuredClone(execution.tools),definition};
}

/** Existing SubagentHostOptions.getToolsForSubtask hook, including approval resume. */
export function restrictF28SubagentTools(application:RuntimeApplication,subtask:SubtaskDefinition,worker:WorkerContext,tools:AgentToolPort):AgentToolPort {
  const scope=readF28SubagentScope(application,worker.taskId,worker.signal);if(!scope)return tools;
  if(computeSubtaskInputDigest(scope.definition)!==computeSubtaskInputDigest(subtask))fail('Original F28 executor definition changed');
  if(application.runtime.loadCheckpoint(worker.taskId,'f28:tool-scope-origin')===undefined
    &&!application.runtime.saveCheckpointOnce(worker.taskId,'f28:tool-scope-origin',scope.origin))fail();
  const descriptors=scope.tools;
  return {list:()=>structuredClone(descriptors),invoke:request=>{
    const current=readF28SubagentScope(application,worker.taskId,worker.signal);
    if(!current||!isDeepStrictEqual(current.tools,descriptors)||request.taskId!==worker.taskId||request.deadline!==worker.deadline
      ||!descriptors.some(tool=>tool.name===request.toolName&&tool.version===request.toolVersion))fail();
    return tools.invoke(request);
  }};
}

export function assertF28SubagentToolInvocation(application:RuntimeApplication,invocation:{taskId:string;toolName:string;toolVersion:string;signal:AbortSignal}):void {
  try {
    const scope=readF28SubagentScope(application,invocation.taskId,invocation.signal);if(!scope)return;
    if(!scope.tools.some(tool=>tool.name===invocation.toolName&&tool.version===invocation.toolVersion))fail();
  }catch{throw new ToolNotStartedError('UNAUTHORIZED','Original F28 read-only tool scope is no longer active');}
}

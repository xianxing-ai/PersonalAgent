import {ProtocolError} from '@personal-agent/contracts';
import {DEFAULT_ROLE_LABELS} from '@personal-agent/agents';
import type {SubtaskDefinition} from '@personal-agent/agents';
import {parseExecutionModelSelection} from '@personal-agent/coordination';
import type {ExecutionModelSelection} from '@personal-agent/coordination';

export interface RuntimeWorkflowRolePlanEntry {
  role:'research'|'analysis'|'coder';definition:SubtaskDefinition;selection:ExecutionModelSelection;
  maxSteps:number;verificationPolicyRef:string;
}
export interface RuntimeWorkflowRolePlan {version:1;parentTaskId:string;deadline:string;roles:RuntimeWorkflowRolePlanEntry[]}
export interface RuntimeWorkflowRoleIntent {operationId:string;requestDigest:string}
export const RUNTIME_WORKFLOW_ROLE_PLAN_KEY='workflow-f28-native-role-plan:v1';
export const RUNTIME_WORKFLOW_ROLE_ATTEMPT_KEY='workflow-f28-native-role-attempt:v1';
export const RUNTIME_WORKFLOW_CHILD_ROLE_KEY='workflow-f28-native-role-child:v1';
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
const bad=():never=>{throw new ProtocolError('INVALID_ARGUMENT','Invalid trusted F28 role plan');};
export function parseRuntimeWorkflowRolePlan(input:unknown):RuntimeWorkflowRolePlan {
  if(!plain(input)||Object.keys(input).sort().join(',')!=='deadline,parentTaskId,roles,version'||input.version!==1
    ||!text(input.parentTaskId)||!text(input.deadline)||!Number.isFinite(Date.parse(input.deadline))
    ||!Array.isArray(input.roles)||input.roles.length!==3)return bad();
  const roles:RuntimeWorkflowRolePlanEntry[]=input.roles.map(value=>{
    if(!plain(value)||Object.keys(value).sort().join(',')!=='definition,maxSteps,role,selection,verificationPolicyRef'
      ||!['research','analysis','coder'].includes(String(value.role))||!plain(value.definition)
      ||!Number.isSafeInteger(value.maxSteps)||(value.maxSteps as number)<1||!text(value.verificationPolicyRef))return bad();
    const d=value.definition;
    if(Object.keys(d).some(key=>!['subtaskId','role','roleLabel','goal','model','reasoningEffort','thinkingDepth'].includes(key))
      ||!text(d.subtaskId)||!text(d.goal)||!text(d.model)||!['researcher','planner','reviewer','coder'].includes(String(d.role))
      ||value.role==='research'&&d.role!=='researcher'||value.role==='coder'&&d.role!=='coder'
      ||value.role==='analysis'&&!['planner','reviewer'].includes(String(d.role))
      ||d.roleLabel!==undefined&&!text(d.roleLabel)
      ||d.thinkingDepth!==undefined&&(!Number.isInteger(d.thinkingDepth)||(d.thinkingDepth as number)<0||(d.thinkingDepth as number)>5))return bad();
    const selection=parseExecutionModelSelection(value.selection);
    if(selection.modelId!==d.model||selection.reasoningEffort!==d.reasoningEffort)return bad();
    return {role:value.role as RuntimeWorkflowRolePlanEntry['role'],definition:structuredClone(d) as unknown as SubtaskDefinition,
      selection,maxSteps:value.maxSteps as number,verificationPolicyRef:value.verificationPolicyRef};
  });
  if(new Set(roles.map(v=>v.role)).size!==3||new Set(roles.map(v=>v.definition.subtaskId)).size!==3)return bad();
  return {version:1,parentTaskId:input.parentTaskId,deadline:input.deadline,roles};
}
export function workflowRoleMatchesChild(plan:RuntimeWorkflowRolePlan,role:RuntimeWorkflowRolePlanEntry,binding:unknown):boolean {
  if(!plain(binding))return false;
  const d=role.definition,roleLabel=d.roleLabel?.trim()||DEFAULT_ROLE_LABELS[d.role];
  return binding.parentTaskId===plan.parentTaskId&&binding.parentDeadline===plan.deadline&&binding.subtaskId===d.subtaskId
    &&binding.roleLabel===roleLabel&&binding.role===d.role&&binding.goal===d.goal&&binding.model===d.model
    &&binding.reasoningEffort===d.reasoningEffort&&binding.thinkingDepth===d.thinkingDepth;
}

import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {TaskRuntime} from '../index.js';

const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=2048;
function fail(message:string):never {throw new ProtocolError('UNAUTHORIZED',message);}

/** F20 decision frontier guard; mirrors coding-repair candidate discipline via original checkpoints. */
export function assertF20CandidateSelection(input:{
  runtime:TaskRuntime;
  parentTaskId:string;
  operationId:string;
  candidateValues:readonly unknown[];
  selectedId:string;
}):void {
  if(!text(input.parentTaskId)||!text(input.operationId)||!text(input.selectedId))fail('F20 candidate selection binding unavailable');
  const parent=input.runtime.getTask(input.parentTaskId);
  if(parent.cancelRequested||!['running','waiting_approval'].includes(parent.state))fail('F20 graph is not current');
  const binding=input.runtime.loadCheckpoint(input.parentTaskId,'owned-workflow:operation:'+input.operationId) as
    {taskId?:string;sessionId?:string;workflowId?:string;controlRevision?:number;localTaskId?:string;
      proposal?:{nodeId?:string;operationId?:string;toolName?:string;arguments?:unknown}}|undefined;
  const intent=input.runtime.loadCheckpoint(input.parentTaskId,'owned-workflow:intent:'+input.operationId) as
    {taskId?:string;sessionId?:string;workflowId?:string;proposal?:{nodeId?:string;operationId?:string;toolName?:string;arguments?:unknown}}|undefined;
  const host=binding?.localTaskId?input.runtime.loadCheckpoint(binding.localTaskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined:undefined;
  if(!binding?.proposal||!text(binding.localTaskId)||binding.taskId!==input.parentTaskId||binding.workflowId!=='F20'||binding.proposal.operationId!==input.operationId
    ||binding.proposal.toolName!=='decision.choose_candidate'||!['F20_N02','F20_N04'].includes(String(binding.proposal.nodeId))
    ||!intent?.proposal||intent.taskId!==input.parentTaskId||intent.workflowId!=='F20'||intent.proposal.operationId!==input.operationId
    ||!isDeepStrictEqual(intent.proposal,binding.proposal)||host?.taskId!==input.parentTaskId||host.operationId!==input.operationId)
    fail('F20 candidate operation binding changed');
  const args=binding.proposal.arguments;
  if(!plain(args)||typeof args.context!=='string')fail('F20 candidate context unavailable');
  let context:unknown;try {context=JSON.parse(args.context);}catch{fail('F20 candidate context unavailable');}
  if(!plain(context)||context.workflowId!=='F20'||context.nodeId!==binding.proposal.nodeId||!Array.isArray(context.candidateValues)
    ||!isDeepStrictEqual(context.candidateValues,input.candidateValues))fail('F20 candidate context drifted from the original graph');
  const ids=new Set<string>();
  for(const candidate of input.candidateValues) {
    if(!plain(candidate)||typeof candidate.id!=='string'||!candidate.id.trim())fail('F20 candidate values are invalid');
    if(candidate.abstain===true&&candidate.id===input.selectedId)fail('F20 cannot select an abstain candidate');
    if(ids.has(candidate.id))fail('F20 candidate ids must be unique');
    ids.add(candidate.id);
  }
  if(!ids.has(input.selectedId))fail('F20 selected candidate is outside the original frontier');
  const matches=input.candidateValues.filter(candidate=>plain(candidate)&&candidate.id===input.selectedId);
  if(matches.length!==1||plain(matches[0])&&matches[0].abstain===true)fail('F20 selected candidate is unavailable');
}

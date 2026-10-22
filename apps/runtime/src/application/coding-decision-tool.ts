import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool} from '@personal-agent/contracts';
import {createWorkflowDecisionTool} from '@personal-agent/agentarts';
import type {LayaActionChoiceService,LayaActionSelection} from '@personal-agent/cognition';
import {actionArgumentsDigest} from '@personal-agent/cognition';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';

/** Local diagnostic only; never part of the selectedId result or its cloud projection. */
export const CODING_DECISION_CHECKPOINT='coding-repair:local-decision:v1:';
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
export interface RuntimeCodingDecisionReceipt {
  version:1;taskId:string;runId:string;requestId:string;argumentsDigest:string;contextDigest:string;candidateDigest:string;deadline:string;
  disposition:'selected'|'review_fallback'|'unavailable';selectedId:string|null;
  selection:LayaActionSelection;authority:'diagnostic_no_tool_grant';
}

export function createRuntimeCodingDecisionTool(options:{localChooser:Pick<LayaActionChoiceService,'choose'>;
  save:(key:string,receipt:RuntimeCodingDecisionReceipt)=>void}):RegisteredTool {
  // Each invocation owns its ToolContext, including concurrent host tasks.
  const descriptor=createWorkflowDecisionTool({selector:{select:async()=>{throw Error('Invocation selector unavailable');}}}).descriptor;
  return {descriptor,execute:(argumentsValue,context)=>createWorkflowDecisionTool({selector:{select:async input=>{
    const argumentsDigest=toolArgumentsDigest(argumentsValue);
    if(context.argumentsDigest!==undefined&&context.argumentsDigest!==argumentsDigest)
      throw new ProtocolError('UNAUTHORIZED','Original coding decision arguments changed');
    const candidates=input.candidates.map(candidate=>({id:candidate.id,revision:1,kind:'noop' as const,
      description:candidate.description,sources:[],scopeRef:input.requestId,expiresAt:input.deadline,
      risk:'low' as const,argumentsDigest:actionArgumentsDigest({})}));
    const value=await options.localChooser.choose({context:input.context,deadline:input.deadline,signal:input.signal,candidates});
    const contextDigest=sha(input.context);
    const probability=(item:unknown)=>item===null||typeof item==='number'&&Number.isFinite(item)&&item>=0&&item<=1;
    const reference=(item:{id:string;revision:number}|undefined)=>item&&typeof item.id==='string'&&item.id.length>0&&item.id.length<=256
      &&Number.isSafeInteger(item.revision)&&item.revision>0;
    if(!value||!['selected','review','abstain'].includes(value.state)||typeof value.eligibleForRuntime!=='boolean'||value.calibrated!==false
      ||!['selected','high_risk','uncertain','insufficient_candidates','invalid_response','unavailable','cancelled','deadline','candidate_expired'].includes(value.reason)
      ||value.selected!==undefined&&!reference(value.selected)||!Array.isArray(value.scores)||value.scores.length!==candidates.length
      ||value.scores.some(item=>!item||!reference(item.candidate)||!probability(item.probability))
      ||!isDeepStrictEqual(value.scores.map(item=>item.candidate),candidates.map(candidate=>({id:candidate.id,revision:1})))
      ||value.answerConfidence!==undefined&&(value.answerConfidence===null||!probability(value.answerConfidence))
      ||value.entropyConcentration!==undefined&&(value.entropyConcentration===null||!probability(value.entropyConcentration))
      ||!value.receipt||value.receipt.promptVersion!=='action-choice-v1'||!Array.isArray(value.receipt.candidates)
      ||value.receipt.candidates.some(item=>!item||!reference(item.candidate)||typeof item.digest!=='string'||!/^[a-f0-9]{64}$/.test(item.digest)
        ||item.exclusion!==undefined&&!['expired','unauthorized'].includes(item.exclusion)))
      throw new ProtocolError('EXTERNAL_FAILURE','Local coding decision returned an invalid typed receipt');
    // Keep only typed fields. No model text, context body, source, credentials or error messages are persisted here.
    const selection:LayaActionSelection={state:value.state,eligibleForRuntime:value.eligibleForRuntime,reason:value.reason,
      calibrated:value.calibrated,...(value.selected?{selected:{id:value.selected.id,revision:value.selected.revision}}:{}),
      scores:value.scores.map(item=>({candidate:{id:item.candidate.id,revision:item.candidate.revision},probability:item.probability})),
      ...(value.answerConfidence===undefined?{}:{answerConfidence:value.answerConfidence}),
      ...(value.entropyConcentration===undefined?{}:{entropyConcentration:value.entropyConcentration}),
      receipt:{id:value.receipt.id,promptVersion:value.receipt.promptVersion,contextDigest:value.receipt.contextDigest,
        candidates:value.receipt.candidates.map(item=>({candidate:{id:item.candidate.id,revision:item.candidate.revision},digest:item.digest,
          ...(item.exclusion?{exclusion:item.exclusion}:{})}))}};
    if(selection.receipt.contextDigest!==contextDigest||selection.receipt.id!==toolArgumentsDigest({context:input.context,candidates})
      ||!isDeepStrictEqual(selection.receipt.candidates.map(item=>({candidate:item.candidate,digest:item.digest})),
        candidates.map(candidate=>({candidate:{id:candidate.id,revision:candidate.revision},digest:toolArgumentsDigest(candidate)}))))
      throw new ProtocolError('EXTERNAL_FAILURE','Local coding decision receipt does not bind the original input');
    const eligible=value.state==='selected'&&value.eligibleForRuntime&&value.selected
      &&input.candidates.some(candidate=>candidate.id===value.selected!.id);
    const review=input.candidates.find(candidate=>candidate.id==='owned-review')??input.candidates.find(candidate=>candidate.id==='review');
    const selectedId=eligible?value.selected!.id:review?.id??null;
    options.save(CODING_DECISION_CHECKPOINT+context.runId,{version:1,taskId:context.taskId,runId:context.runId,requestId:input.requestId,
      argumentsDigest,contextDigest,candidateDigest:toolArgumentsDigest(input.candidates),deadline:context.deadline,
      disposition:eligible?'selected':review?'review_fallback':'unavailable',selectedId,selection,authority:'diagnostic_no_tool_grant'});
    if(selectedId===null)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Local Laya requires review for this original coding decision');
    return selectedId;
  }}}).execute(argumentsValue,context)};
}

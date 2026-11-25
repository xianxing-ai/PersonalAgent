import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import type {WorkflowNodeContext,WorkflowCandidate} from './owned-workflows.js';
import {requiredCodingVerification} from './coding-repair.js';
import {parseF20DocumentCandidate} from './f20-worker-trust.js';

/** Use existing bound operations and results as candidates without regenerating their contents. */
export function boundSourceReadCandidates(context:WorkflowNodeContext):readonly WorkflowCandidate[]|undefined {
  if(context.node.id==='F09_N02') {
    const source=context.predecessorOperations?.F09_N01;
    if(context.predecessorStates.F09_N01!=='completed'||!source||source.toolName!=='feeds.collect'
      ||source.toolVersion!=='1.0.0'||typeof source.operationId!=='string'||!source.operationId)
      throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original feed operation correlation unavailable');
    const descriptor=context.availableTools.find(tool=>tool.name==='workflow.host.f09_n02'&&tool.version==='1.0.0');
    if(!descriptor)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Feed graph adapter is not published');
    const argumentsValue={sourceOperationId:source.operationId};validateToolValue(descriptor.inputSchema,argumentsValue);
    return [{id:'bound-feed-operation',description:'Request validation of the original feed operation; the host independently checks its receipt and authorization.',
      value:{arguments:argumentsValue}}];
  }
  if(context.template.workflowId==='F20'&&context.node.id==='F20_N04'){
    const input=context.input as {recipeId?:unknown}|undefined;
    const check=context.predecessorOutputs.F20_N03 as {recipeId?:unknown;exitCode?:unknown}|undefined;
    if(context.predecessorStates.F20_N02!=='completed'||context.predecessorStates.F20_N03!=='completed'
      ||typeof input?.recipeId!=='string'||check?.recipeId!==input.recipeId||check.exitCode!==0)
      throw new ProtocolError('UNSUPPORTED_CAPABILITY','F20 review requires the original draft and its confirmed TypeScript check');
    return [{id:'bound-f20-document',description:'Review the original selected document against its original sources and confirmed TypeScript check.',
      value:parseF20DocumentCandidate(context.predecessorOutputs.F20_N02)}];
  }
  const coding=context.codingRepair;
  if(coding&&(['F15_N01','F15_N04','F15_N05','F15_N06'].includes(context.node.id)||context.node.id==='F15_N03'&&coding.readPath)){
    const sessionId=coding.configuration.session.sessionId;
    let argumentsValue:Record<string,unknown>,name:string;
    if(context.node.id==='F15_N01'){name='workspace.coding_snapshot';argumentsValue={sessionId};}
    else if(context.node.id==='F15_N03'){name='coding.repair.read';argumentsValue={sessionId,path:coding.readPath};}
    else if(context.node.id==='F15_N06'){
      if(!requiredCodingVerification(coding))throw new ProtocolError('UNSUPPORTED_CAPABILITY','Coding delivery requires all current mandatory checks');
      const initial=new Map(coding.configuration.initialSnapshot.files.map(f=>[f.path,f.sha256]));
      name='workflow.host.f15_n06';argumentsValue={version:1,sessionId,baselineSnapshotId:coding.configuration.session.baselineSnapshotId,
        snapshotId:coding.snapshot.snapshotId,paths:coding.snapshot.files.filter(f=>f.sha256!==(initial.get(f.path)??null)).map(f=>f.path),
        verificationRunIds:coding.configuration.recipes.filter(r=>r.required).map(recipe=>[...coding.verification].reverse().find(r=>r.recipeId===recipe.recipeId)!.runId)};
    }else{
      if(!coding.pendingPatch)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Coding request has no original exact patch candidate');
      name=context.node.id==='F15_N04'?'workflow.host.f15_n04':'workflow.host.f15_n05';
      argumentsValue={sessionId,patches:coding.pendingPatch.patches,
        // A pending patch can invalidate a previously passing recipe. The host evaluates
        // current validity only after applying these exact patches in the isolated session.
        ...(context.node.id==='F15_N05'?{recipeIds:coding.configuration.recipes.filter(recipe=>recipe.required).map(r=>r.recipeId)}:{})};
    }
    const descriptor=context.availableTools.find(tool=>tool.name===name&&tool.version==='1.0.0');
    if(!descriptor)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Coding host adapter is not published');
    validateToolValue(descriptor.inputSchema,argumentsValue);
    // Host-node values are only arguments. The engine wraps them in the original signed proposal.
    return [{id:'bound-coding-operation',description:'Request the exact current session operation through its published schema; no execution, grant or success is claimed.',
      value:context.node.kind==='tool'?{toolName:name,toolVersion:descriptor.version,arguments:argumentsValue}:{arguments:argumentsValue}}];
  }
  if(!['F15_N01','F20_N01'].includes(context.node.id)||!context.input||typeof context.input!=='object'||Array.isArray(context.input))return;
  const input=context.input as Record<string,unknown>,path=context.node.id==='F15_N01'?input.targetFile:input.schemaFile;
  if(typeof path!=='string'||!path)return;
  const tool=context.availableTools.find(item=>item.name==='workspace.read_text');if(!tool)return;
  const argumentsValue={path};validateToolValue(tool.inputSchema,argumentsValue);
  return [{id:'bound-source-read',description:'Read exactly the source path explicitly supplied by this task, using the published reader schema. This is an unexecuted request; no source content, permission or future result is claimed.',
    value:{toolName:tool.name,toolVersion:tool.version,arguments:argumentsValue}}];
}

import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {parseCodingRepairCheckReadback,parseCodingRepairInput,parseCodingRepairPatch,parseCodingRepairPublishRequest,parseCodingRepairSnapshot} from '@personal-agent/contracts/coding-repair';
import type {CodingRepairInput,CodingRepairPatch} from '@personal-agent/contracts/coding-repair';
import type {OwnedWorkflowAdvanceResult,OwnedWorkflowHostBridge} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import type {RuntimeOwnedWorkflowDriverState} from './owned-workflow-driver.js';

type Proposal=Extract<OwnedWorkflowAdvanceResult['proposals'][number],{kind:'tool_proposal'}>;
type GraphInput={goal:string;codingRepair:CodingRepairInput;executionModel?:unknown};
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function reject(message:string):never {throw new ProtocolError('UNAUTHORIZED',message);}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Read-only trusted host port. It must verify reviewer independence, current authorization,
 * the reviewed policy and expiry; it is not supplied by the image or Renderer. */
export interface RuntimeCodingRepairIndependentReviewPort {
  read(input:{taskId:string;sessionId:string;snapshotId:string;patchDigest:string;deadline:string;signal:AbortSignal}):
    {localTaskId:string;operationId:string}|undefined;
  assertCurrent(input:{taskId:string;sessionId:string;snapshotId:string;patchDigest:string;deadline:string;signal:AbortSignal;
    localTaskId:string;operationId:string;reviewerId:string;reviewedAt:string;expiresAt:string}):void;
}

/** Local F15 frontier; no image node state, checkpoint or model output is authority. */
export function createCodingRepairFrontierGuard(application:RuntimeApplication,bridge:OwnedWorkflowHostBridge,
  input:{taskId:string;sessionId:string;controlRevision:number;initialRunId:string;codingRepair:CodingRepairInput;allowedPaths?:readonly string[];
    deadline:string;signal:AbortSignal;independentReview?:RuntimeCodingRepairIndependentReviewPort}) {
  const start=()=>{
    const original=application.runtime.readToolExecutions(input.taskId).find(record=>record.evidenceId===input.initialRunId);
    const cached=application.runtime.loadCheckpoint(input.taskId,'tool-result-'+input.initialRunId) as {result?:unknown}|undefined;
    const args={mode:input.codingRepair.session.mode,...(input.allowedPaths?{allowedPaths:[...input.allowedPaths]}:{})};
    if(!original||original.toolName!=='coding.repair.start'||original.toolVersion!=='1.0.0'||original.state!=='confirmed'
      ||!original.executionStarted||original.policyDecision!=='allow'||!application.runtime.matchesToolExecutionInput(original,{arguments:args,scopeRef:input.initialRunId})
      ||!cached||!Object.hasOwn(cached,'result')||!isDeepStrictEqual(parseCodingRepairInput(cached.result),input.codingRepair)
      ||input.codingRepair.session.taskId!==input.taskId||input.codingRepair.session.sessionId!==input.sessionId)
      reject('Original coding session authorization or snapshot changed');
  };
  const original=(state:RuntimeOwnedWorkflowDriverState<GraphInput>,nodeId:string,toolName:string)=>
    Object.values(state.confirmedOperations??{}).map((item,index)=>({item,index})).filter(({item})=>item.nodeId===nodeId&&item.toolName===toolName).map(({item,index})=>{
      const binding=application.runtime.loadCheckpoint(input.taskId,'owned-workflow:operation:'+item.operationId) as
        {taskId?:string;sessionId?:string;workflowId?:string;controlRevision?:number;localTaskId?:string;proposal?:Proposal}|undefined;
      const parent=application.runtime.loadCheckpoint(item.localTaskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
      const intent=application.runtime.loadCheckpoint(input.taskId,'coding-repair:host:'+item.operationId) as
        {localTaskId?:string;request?:{commandId?:string;toolName?:string;toolVersion?:string;arguments?:unknown}}|undefined;
      if(!binding?.proposal||binding.taskId!==input.taskId||binding.sessionId!==input.sessionId||binding.workflowId!=='F15'
        ||binding.controlRevision!==input.controlRevision||binding.localTaskId!==item.localTaskId
        ||binding.proposal.nodeId!==nodeId||binding.proposal.toolName!==toolName||binding.proposal.operationId!==item.operationId
        ||parent?.taskId!==input.taskId||parent.operationId!==item.operationId||intent?.localTaskId!==item.localTaskId
        ||intent.request?.commandId!==item.operationId||intent.request.toolName!==toolName
        ||intent.request.toolVersion!==binding.proposal.toolVersion||!isDeepStrictEqual(intent.request.arguments,binding.proposal.arguments))
        reject('Original coding frontier operation binding changed');
      const task=application.readHostToolTask(item.localTaskId),receipt=bridge.readReceipt({taskId:input.taskId,
        sessionId:input.sessionId,workflowId:'F15',controlRevision:input.controlRevision},binding.proposal);
      if(task.task.state!=='succeeded'||task.commandId!==item.operationId||!task.confirmed?.evidenceRefs.length
        ||receipt?.state!=='confirmed'||!isDeepStrictEqual(task.confirmed.result,item.result)||!isDeepStrictEqual(receipt.result,item.result)
        ||!isDeepStrictEqual(receipt.evidenceRefs,task.confirmed.evidenceRefs))
        reject('Original coding frontier receipt is not confirmed');
      return {proposal:binding.proposal,result:task.confirmed.result,index};
    });
  const roundStart=(state:RuntimeOwnedWorkflowDriverState<GraphInput>)=>{
    const snapshots=original(state,'F15_N01','workspace.coding_snapshot'),checks=original(state,'F15_N05','workflow.host.f15_n05');
    if(!snapshots.length)reject('Original coding snapshot is unavailable');
    for(let i=0;i<snapshots.length;i++) {
      const current=snapshots[i]!;
      if(current.proposal.arguments.sessionId!==input.sessionId)reject('Original coding snapshot session changed');
      const value=parseCodingRepairSnapshot(current.result);
      if(i===0){if(!isDeepStrictEqual(value,input.codingRepair.initialSnapshot))reject('Original coding snapshot changed');continue;}
      const previous=snapshots[i-1]!,between=checks.filter(check=>check.index>previous.index&&check.index<current.index);
      if(between.length!==1)reject('New coding round has no unique original verification');
      const check=between[0]!,readback=parseCodingRepairCheckReadback(check.result);
      const recipeIds=input.codingRepair.recipes.filter(recipe=>recipe.required).map(recipe=>recipe.recipeId);
      const failed=readback.verification.some(receipt=>receipt.status==='FAILED'&&receipt.exitCode!==null&&receipt.exitCode!==0
        &&receipt.inputSnapshotId===readback.snapshot.snapshotId&&recipeIds.includes(receipt.recipeId)
        &&isDeepStrictEqual([...receipt.packageIds].sort(),[...input.codingRepair.recipes.find(recipe=>recipe.recipeId===receipt.recipeId)!.packageIds].sort()));
      if(readback.sessionId!==input.sessionId||!failed||!isDeepStrictEqual(value,readback.snapshot)
        ||!isDeepStrictEqual(check.proposal.arguments.recipeIds,recipeIds)||check.proposal.arguments.sessionId!==input.sessionId)
        reject('New coding snapshot lacks its original failed verification');
      const previews=original(state,'F15_N04','workflow.host.f15_n04').filter(item=>item.index>previous.index&&item.index<check.index);
      if(previews.length!==1||!isDeepStrictEqual(check.proposal.arguments.patches,previews[0]!.proposal.arguments.patches))
        reject('Previous coding verification differs from its original preview');
      const preview=previews[0]!,before=parseCodingRepairSnapshot(previous.result);
      if(!plain(preview.result)||preview.result.sessionId!==input.sessionId||preview.result.approved!==true
        ||preview.result.previewed!==true||!Array.isArray(preview.result.patches)||!Array.isArray(preview.proposal.arguments.patches)
        ||!isDeepStrictEqual(before.packages,readback.snapshot.packages))reject('Previous coding preview or package graph changed');
      const patches=preview.proposal.arguments.patches.map(parseCodingRepairPatch),rows=preview.result.patches as unknown[];
      if(rows.length!==patches.length||patches.some(item=>{
        const row=rows.find(value=>plain(value)&&value.path===item.path),old=before.files.find(file=>file.path===item.path),
          current=readback.snapshot.files.find(file=>file.path===item.path);
        return !plain(row)||row.beforeSha256!==item.expectedSha256||item.expectedSha256!==(old?.sha256??null)
          ||typeof row.afterSha256!=='string'||!current||row.afterSha256!==current.sha256;
      })||before.files.some(file=>!patches.some(item=>item.path===file.path)
        &&!isDeepStrictEqual(file,readback.snapshot.files.find(value=>value.path===file.path)))
        ||readback.snapshot.files.some(file=>!before.files.some(old=>old.path===file.path)&&!patches.some(item=>item.path===file.path)))
        reject('Previous coding check snapshot differs from the reviewed patch');
    }
    return {snapshot:parseCodingRepairSnapshot(snapshots.at(-1)!.result),index:snapshots.at(-1)!.index,checks};
  };
  const selected=(state:RuntimeOwnedWorkflowDriverState<GraphInput>,nodeId:string,predicate:(value:unknown)=>boolean)=>{
    const round=roundStart(state),choices=original(state,nodeId,'decision.choose_candidate').filter(item=>item.index>round.index);
    for(const item of choices.reverse()) {
      const result=item.result,args=item.proposal.arguments;
      if(!plain(result)||typeof result.selectedId!=='string'||typeof args.context!=='string')continue;
      let context:unknown;try{context=JSON.parse(args.context);}catch{continue;}
      if(!plain(context)||context.workflowId!=='F15'||context.nodeId!==nodeId||!Array.isArray(context.candidateValues))continue;
      const matches=context.candidateValues.filter(candidate=>plain(candidate)&&candidate.id===result.selectedId);
      if(matches.length!==1||!plain(matches[0])||matches[0].abstain===true||!predicate(matches[0].value))continue;
      return matches[0].value;
    }
    return reject('Original coding decision is unavailable');
  };
  const snapshot=(state:RuntimeOwnedWorkflowDriverState<GraphInput>)=>{
    return roundStart(state).snapshot;
  };
  const scope=(state:RuntimeOwnedWorkflowDriverState<GraphInput>)=>{
    const originalSnapshot=snapshot(state);
    const value=selected(state,'F15_N02',candidate=>plain(candidate)&&Array.isArray(candidate.scope)&&candidate.scope.length>0);
    const paths=(value as {scope:unknown[]}).scope;
    if(paths.some(path=>typeof path!=='string'||!path||path.includes('\\')||path.startsWith('/')||/^[A-Za-z]:/.test(path)
      ||path.split('/').some(part=>!part||part==='.'||part==='..')||input.allowedPaths&&!input.allowedPaths.includes(path)
      ||!originalSnapshot.files.some(file=>file.path===path)&&!input.allowedPaths?.includes(path)))
      reject('Coding scope is outside the original snapshot or explicit user paths');
    return paths as string[];
  };
  const patch=(state:RuntimeOwnedWorkflowDriverState<GraphInput>):CodingRepairPatch[]=>{
    const paths=scope(state),originalSnapshot=snapshot(state);
    const candidate=selected(state,'F15_N03',value=>plain(value)&&Array.isArray(value.patches)&&value.patches.length>0) as {patches:unknown[]};
    const patches=candidate.patches.map(parseCodingRepairPatch);
    if(new Set(patches.map(item=>item.path)).size!==patches.length)reject('Duplicate coding patch path');
    const round=roundStart(state),reads=original(state,'F15_N03','coding.repair.read').filter(read=>read.index>round.index);
    for(const item of patches) {
      const source=originalSnapshot.files.find(file=>file.path===item.path);
      if(!paths.includes(item.path)||item.expectedSha256!==(source?.sha256??null))reject('Coding patch differs from original snapshot or selected scope');
      if(source?.sha256&&!reads.some(read=>read.proposal.arguments.sessionId===input.sessionId&&read.proposal.arguments.path===item.path
        &&plain(read.result)&&read.result.path===item.path&&read.result.sha256===source.sha256&&typeof read.result.content==='string'
        &&createHash('sha256').update(read.result.content).digest('hex')===source.sha256))
        reject('Coding patch has no original source readback');
    }
    return patches;
  };
  const reviewContext=(state:RuntimeOwnedWorkflowDriverState<GraphInput>)=>{
    start();const patches=patch(state);
    const round=roundStart(state),preview=original(state,'F15_N04','workflow.host.f15_n04').filter(item=>item.index>round.index).at(-1),expected={sessionId:input.sessionId,patches};
    if(!preview||!isDeepStrictEqual(preview.proposal.arguments,expected)||!plain(preview.result)||preview.result.sessionId!==input.sessionId
      ||preview.result.approved!==true||preview.result.previewed!==true||!Array.isArray(preview.result.patches))
      reject('Original coding preview is unavailable or does not match the selected patch');
    const previewPatches=preview.result.patches as unknown[];
    if(previewPatches.length!==patches.length||patches.some(item=>!previewPatches.some(value=>plain(value)
        &&value.path===item.path&&value.beforeSha256===item.expectedSha256&&typeof value.afterSha256==='string'&&/^[a-f0-9]{64}$/u.test(value.afterSha256))))
      reject('Original coding preview is unavailable or does not match the selected patch');
    return {taskId:input.taskId,sessionId:input.sessionId,snapshotId:round.snapshot.snapshotId,
      patchDigest:digest(patches),deadline:input.deadline,signal:input.signal};
  };
  const review=(state:RuntimeOwnedWorkflowDriverState<GraphInput>)=>{
    const port=input.independentReview;
    if(!port||typeof port.read!=='function'||typeof port.assertCurrent!=='function')
      throw new ProtocolError('UNSUPPORTED_CAPABILITY','F15 independent redline review is unavailable');
    const common=reviewContext(state);
    const reference=port.read(common);
    if(!reference||typeof reference.localTaskId!=='string'||typeof reference.operationId!=='string')
      throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original independent redline review is unavailable');
    const parent=application.runtime.loadCheckpoint(reference.localTaskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
    const binding=application.runtime.loadCheckpoint(input.taskId,'coding-repair:host:'+reference.operationId) as
      {localTaskId?:string;request?:{commandId?:string;toolName?:string;toolVersion?:string;arguments?:unknown}}|undefined;
    const graphBinding=application.runtime.loadCheckpoint(input.taskId,'owned-workflow:operation:'+reference.operationId) as
      {taskId?:string;sessionId?:string;workflowId?:string;controlRevision?:number;localTaskId?:string;proposal?:Proposal}|undefined;
    const result=application.readHostToolTask(reference.localTaskId),value=result.confirmed?.result;
    if(parent?.taskId!==input.taskId||parent.operationId!==reference.operationId||binding?.localTaskId!==reference.localTaskId
      ||binding.request?.commandId!==reference.operationId||binding.request.toolName!=='workflow.host.f15_independent_review'
      ||binding.request.toolVersion!=='1.0.0'||!isDeepStrictEqual(binding.request.arguments,{sessionId:input.sessionId,
        snapshotId:common.snapshotId,patchDigest:common.patchDigest})||graphBinding?.taskId!==input.taskId
      ||graphBinding.sessionId!==input.sessionId||graphBinding.workflowId!=='F15'||graphBinding.controlRevision!==input.controlRevision
      ||graphBinding.localTaskId!==reference.localTaskId||graphBinding.proposal?.nodeId!=='F15_N04'
      ||graphBinding.proposal.operationId!==reference.operationId||graphBinding.proposal.toolName!=='workflow.host.f15_independent_review'
      ||!isDeepStrictEqual(graphBinding.proposal.arguments,binding.request.arguments)||result.task.state!=='succeeded'
      ||result.commandId!==reference.operationId||result.toolName!=='workflow.host.f15_independent_review'||!result.confirmed?.evidenceRefs.length
      ||!plain(value)||Object.keys(value).sort().join(',')!=='decision,expiresAt,patchDigest,reviewedAt,reviewerId,sessionId,snapshotId,version'
      ||value.version!==1||value.sessionId!==input.sessionId||value.snapshotId!==common.snapshotId||value.patchDigest!==common.patchDigest
      ||value.decision!=='approved'||typeof value.reviewerId!=='string'||!value.reviewerId.trim()
      ||typeof value.reviewedAt!=='string'||typeof value.expiresAt!=='string'||!Number.isFinite(Date.parse(value.reviewedAt))
      ||!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.reviewedAt)>Date.now()||Date.parse(value.expiresAt)<=Date.now())
      reject('Independent redline review does not match the original confirmed task');
    const receipt=bridge.readReceipt({taskId:input.taskId,sessionId:input.sessionId,workflowId:'F15',controlRevision:input.controlRevision},graphBinding.proposal);
    if(receipt?.state!=='confirmed'||!receipt.evidenceRefs.length||!isDeepStrictEqual(receipt.result,value)
      ||!isDeepStrictEqual(receipt.evidenceRefs,result.confirmed.evidenceRefs))reject('Independent review receipt is unavailable');
    const current=port.assertCurrent({...common,...reference,reviewerId:value.reviewerId,reviewedAt:value.reviewedAt,expiresAt:value.expiresAt});
    if(current!==undefined){void Promise.resolve(current).catch(()=>undefined);reject('Independent review guard must be synchronous');}
    if(input.signal.aborted)throw new ProtocolError('CANCELLED','Independent review authorization was cancelled');
    if(!Number.isFinite(Date.parse(input.deadline))||Date.now()>=Date.parse(input.deadline)||Date.now()>=Date.parse(value.expiresAt))
      throw new ProtocolError('TIMEOUT','Independent review authorization expired');
    state.evidenceRefs=[...new Set([...state.evidenceRefs,...receipt.evidenceRefs])];
  };
  const guard=({proposal,state}:{proposal:Proposal;state:RuntimeOwnedWorkflowDriverState<GraphInput>}):void=>{
    start();
    if(proposal.toolVersion!=='1.0.0'||state.result?.nodes[proposal.nodeId]?.state!=='waiting_receipt')
      reject('Coding proposal is outside its original frontier');
    if(['F15_N05','F15_N06'].includes(proposal.nodeId)) {
      if(!input.independentReview)throw new ProtocolError('UNSUPPORTED_CAPABILITY','F15 independent redline review is unavailable');
      const patches=patch(state);review(state);
      if(proposal.nodeId==='F15_N05') {
        const round=roundStart(state);
        if(round.checks.some(check=>check.index>round.index))reject('Coding round already has an original verification');
        if(proposal.toolName==='decision.choose_candidate')return;
        const recipeIds=input.codingRepair.recipes.filter(recipe=>recipe.required).map(recipe=>recipe.recipeId);
        if(proposal.toolName!=='workflow.host.f15_n05'||!isDeepStrictEqual(proposal.arguments,{sessionId:input.sessionId,patches,recipeIds}))
          reject('Coding check differs from the reviewed original patch and recipes');
        return;
      }
      const round=roundStart(state),check=round.checks.filter(item=>item.index>round.index).at(-1);
      if(!check)reject('Original coding verification is unavailable');
      const checked=parseCodingRepairCheckReadback(check.result),recipeIds=input.codingRepair.recipes.filter(recipe=>recipe.required).map(recipe=>recipe.recipeId);
      if(!isDeepStrictEqual(check.proposal.arguments,{sessionId:input.sessionId,patches,recipeIds})||checked.sessionId!==input.sessionId)
        reject('Original coding verification changed');
      const selected=recipeIds.map(id=>[...checked.verification].reverse().find(item=>item.recipeId===id));
      if(selected.some(item=>!item||item.status!=='VALID'||item.exitCode!==0||item.sessionId!==input.sessionId
        ||item.inputSnapshotId!==checked.snapshot.snapshotId))reject('Current required coding checks are unavailable');
      if(proposal.toolName==='decision.choose_candidate')return;
      if(proposal.toolName!=='workflow.host.f15_n06')reject('Coding delivery is outside its graph tool');
      const delivery=parseCodingRepairPublishRequest(proposal.arguments),before=new Map(input.codingRepair.initialSnapshot.files.map(file=>[file.path,file.sha256]));
      const changed=checked.snapshot.files.filter(file=>file.sha256!==(before.get(file.path)??null)).map(file=>file.path).sort();
      if(delivery.sessionId!==input.sessionId||delivery.baselineSnapshotId!==input.codingRepair.session.baselineSnapshotId
        ||delivery.snapshotId!==checked.snapshot.snapshotId||!isDeepStrictEqual([...delivery.paths].sort(),changed)
        ||!isDeepStrictEqual(delivery.verificationRunIds,selected.map(item=>item!.runId)))reject('Coding delivery differs from current confirmed verification');
      return;
    }
    if(proposal.toolName==='decision.choose_candidate') {
      if(!['F15_N01','F15_N02','F15_N03','F15_N04'].includes(proposal.nodeId))reject('Coding decision is outside its graph node');
      if(proposal.nodeId!=='F15_N01') {const round=roundStart(state);
        if(round.checks.some(check=>check.index>round.index))reject('A new coding snapshot is required after verification');}
      if(proposal.nodeId==='F15_N02')snapshot(state);
      if(proposal.nodeId==='F15_N03')scope(state);
      if(proposal.nodeId==='F15_N04')patch(state);
      return;
    }
    if(proposal.nodeId==='F15_N01'&&proposal.toolName==='workspace.coding_snapshot'
      &&isDeepStrictEqual(proposal.arguments,{sessionId:input.sessionId}))return;
    if(proposal.nodeId==='F15_N03'&&proposal.toolName==='coding.repair.read') {
      const round=roundStart(state);if(round.checks.some(check=>check.index>round.index))reject('A new coding snapshot is required after verification');
      const paths=scope(state),args=proposal.arguments;
      if(args.sessionId!==input.sessionId||typeof args.path!=='string'||!paths.includes(args.path)
        ||Object.keys(args).some(key=>!['sessionId','path','maxBytes'].includes(key)))reject('Coding source is outside original selected scope');
      return;
    }
    if(proposal.nodeId==='F15_N04'&&proposal.toolName==='workflow.host.f15_n04') {
      const round=roundStart(state);if(round.checks.some(check=>check.index>round.index))reject('A new coding snapshot is required after verification');
      if(!isDeepStrictEqual(proposal.arguments,{sessionId:input.sessionId,patches:patch(state)}))
        reject('Coding preview does not match the original selected patch');
      return;
    }
    reject('Coding proposal is outside its original node tool');
  };
  return Object.assign(guard,{reviewContext});
}

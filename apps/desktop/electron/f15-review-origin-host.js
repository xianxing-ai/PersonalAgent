import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {parseCodingRepairPatch} from '@personal-agent/contracts/coding-repair';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
function denied(){throw new ProtocolError('UNAUTHORIZED','原编码任务、审核身份或本机授权已变化');}
/** This identifies a trusted deployment, not a natural person or proof of independence. */
export function f15DeploymentAuthorId(configuration){
  if(!plain(configuration)||typeof configuration.coordinationBinding!=='string'||!configuration.coordinationBinding.trim()
    ||typeof configuration.imageBinding!=='string'||!configuration.imageBinding.trim())return undefined;
  return 'agentarts-deployment:'+hash({coordinationBinding:configuration.coordinationBinding,imageBinding:configuration.imageBinding});
}

/** Main-only verifier. Source bytes are handed only to an explicitly invoked native display callback. */
export function createDesktopF15ReviewOriginHost({getApplication,readExecutionConfig,assertWorkspacePermission,confirmNativeDisclosure,showNativePatch}) {
  function readAuthorIdentity(){try{return f15DeploymentAuthorId(readExecutionConfig());}catch{return undefined;}}
  function inspect(key){
    const application=getApplication?.(),runtime=application?.runtime,config=readExecutionConfig?.(),authorId=f15DeploymentAuthorId(config);
    if(!runtime||!authorId||typeof assertWorkspacePermission!=='function'||!plain(key)||key.authorId!==authorId
      ||typeof key.reviewerId!=='string'||typeof key.policyId!=='string'||!['taskId','sessionId','snapshotId','patchDigest'].every(name=>typeof key[name]==='string'))denied();
    const task=runtime.getTask(key.taskId),graph=runtime.loadCheckpoint(key.taskId,'coding-repair:graph'),bound=runtime.loadCheckpoint(key.taskId,'coding-repair:worker-capability');
    const loop=runtime.loadCheckpoint(key.taskId,'competition-loop'),coord=runtime.loadCheckpoint(key.taskId,'subtask-coordination-binding');
    const deadline=runtime.loadCheckpoint(key.taskId,'application-deadline'),parent=runtime.loadCheckpoint(key.taskId,'subtask-parent');
    const expected=loop?.pending?.arguments&&{version:1,...loop.pending.arguments.codingRepair,subtasks:loop.pending.arguments.subtasks};
    if(!task||task.cancelRequested||!['running','waiting_approval'].includes(task.state)||typeof deadline!=='string'||Date.parse(deadline)<=Date.now()
      ||!Number.isFinite(Date.parse(deadline))||runtime.loadCheckpoint(key.taskId,'application-profile')!=='huawei_ict_agentarts'
      ||coord?.profile!=='huawei_ict_agentarts'||coord.configurationRef!==config.coordinationBinding
      ||!plain(graph)||graph.sessionId!==key.sessionId||graph.bindingId!==config.imageBinding||graph.input?.codingRepair?.session?.taskId!==key.taskId
      ||graph.input.codingRepair.session.sessionId!==key.sessionId||!plain(bound)||bound.taskId!==key.taskId||bound.deadline!==deadline
      ||bound.bindingId!==config.imageBinding||bound.proposalDigest!==hash(loop?.pending)||bound.revision!==loop?.pendingRevision
      ||loop?.pending?.toolName!=='coding.repair.workflow'||!isDeepStrictEqual(bound.request,expected)
      ||!plain(parent)||typeof parent.parentTaskId!=='string'||task.conversationId!=='desktop-subtask:'+parent.parentTaskId)denied();
    const parentTask=runtime.getTask(parent.parentTaskId);
    if(parentTask.cancelRequested||['succeeded','failed','cancelled','cancelling'].includes(parentTask.state))denied();
    const operationId='f15-review-'+hash({taskId:key.taskId,sessionId:key.sessionId,snapshotId:key.snapshotId,patchDigest:key.patchDigest});
    const reviewIntent=runtime.loadCheckpoint(key.taskId,'owned-workflow:intent:'+operationId),preflight=runtime.loadCheckpoint(key.taskId,'coding-repair:review-preflight:'+operationId);
    if(!isDeepStrictEqual(preflight,{taskId:key.taskId,sessionId:key.sessionId,snapshotId:key.snapshotId,patchDigest:key.patchDigest})
      ||reviewIntent?.taskId!==key.taskId||reviewIntent.sessionId!==key.sessionId||reviewIntent.workflowId!=='F15'
      ||reviewIntent.proposal?.toolName!=='workflow.host.f15_independent_review'||reviewIntent.proposal?.nodeId!=='F15_N04'
      ||reviewIntent.proposal?.operationId!==operationId||!isDeepStrictEqual(reviewIntent.proposal.arguments,
        {sessionId:key.sessionId,snapshotId:key.snapshotId,patchDigest:key.patchDigest}))denied();
    const records=Object.values(graph.confirmedOperations??{});
    const confirmed=(record,nodeId,toolName)=>{
      if(!record||record.nodeId!==nodeId||record.toolName!==toolName)denied();
      const original=runtime.loadCheckpoint(key.taskId,'owned-workflow:operation:'+record.operationId);
      const link=runtime.loadCheckpoint(record.localTaskId,'coding-repair:parent'),intent=runtime.loadCheckpoint(key.taskId,'coding-repair:host:'+record.operationId);
      if(original?.taskId!==key.taskId||original.sessionId!==key.sessionId||original.workflowId!=='F15'||original.controlRevision!==graph.controlRevision
        ||original.localTaskId!==record.localTaskId||original.proposal?.nodeId!==nodeId||original.proposal.toolName!==toolName
        ||original.proposal.operationId!==record.operationId||link?.taskId!==key.taskId||link.operationId!==record.operationId
        ||intent?.localTaskId!==record.localTaskId||intent.request?.commandId!==record.operationId||intent.request.toolName!==toolName
        ||intent.request.toolVersion!==original.proposal.toolVersion
        ||!isDeepStrictEqual(intent.request.arguments,original.proposal.arguments))denied();
      const readback=application.readHostToolTask(record.localTaskId),runId='host-tool-'+record.localTaskId;
      const evidence=runtime.readToolExecutions(record.localTaskId).find(item=>item.evidenceId===runId);
      if(readback.task.state!=='succeeded'||readback.commandId!==record.operationId||readback.confirmed?.runId!==runId
        ||!Array.isArray(readback.confirmed.evidenceRefs)||!readback.confirmed.evidenceRefs.includes(runId)
        ||!isDeepStrictEqual(readback.confirmed.result,record.result)||evidence?.state!=='confirmed'||evidence.policyDecision!=='allow'
        ||!evidence.executionStarted||evidence.toolName!==toolName||evidence.toolVersion!==original.proposal.toolVersion
        ||!runtime.matchesToolExecutionInput(evidence,{arguments:original.proposal.arguments,scopeRef:runId}))denied();
      return {record,proposal:original.proposal,result:readback.confirmed.result,runId};
    };
    const snapshotRecord=records.filter(item=>item.nodeId==='F15_N01'&&item.toolName==='workspace.coding_snapshot').at(-1);
    const snapshot=confirmed(snapshotRecord,'F15_N01','workspace.coding_snapshot');
    if(snapshot.proposal.arguments.sessionId!==key.sessionId||snapshot.result?.snapshotId!==key.snapshotId||!Array.isArray(snapshot.result.files))denied();
    const previewRecord=records.filter(item=>item.nodeId==='F15_N04'&&item.toolName==='workflow.host.f15_n04').at(-1);
    const preview=confirmed(previewRecord,'F15_N04','workflow.host.f15_n04');
    const start=records.indexOf(snapshotRecord),end=records.indexOf(previewRecord);
    if(start<0||end<=start||records.slice(start+1,end).some(item=>item.nodeId==='F15_N05'&&item.toolName==='workflow.host.f15_n05'))denied();
    const args=preview.proposal.arguments;if(args.sessionId!==key.sessionId||!Array.isArray(args.patches)||hash(args.patches)!==key.patchDigest
      ||!plain(preview.result)||preview.result.approved!==true||preview.result.previewed!==true||preview.result.sessionId!==key.sessionId
      ||!Array.isArray(preview.result.patches))denied();
    const selectedRecord=records.slice(start+1,end).filter(item=>item.nodeId==='F15_N03'&&item.toolName==='decision.choose_candidate').at(-1);
    const selection=confirmed(selectedRecord,'F15_N03','decision.choose_candidate');
    let decision;try{decision=JSON.parse(selection.proposal.arguments.context);}catch{denied();}
    const candidates=Array.isArray(decision?.candidateValues)?decision.candidateValues.filter(item=>item?.id===selection.result?.selectedId):[];
    if(decision?.workflowId!=='F15'||decision.nodeId!=='F15_N03'||candidates.length!==1||candidates[0].abstain===true
      ||!isDeepStrictEqual(candidates[0].value?.patches,args.patches))denied();
    const patches=args.patches.map(parseCodingRepairPatch),sources=[];
    for(const patch of patches){
      const file=snapshot.result.files.find(item=>item.path===patch.path),row=preview.result.patches.find(item=>item.path===patch.path);
      if(patch.expectedSha256!==(file?.sha256??null)||!row||row.beforeSha256!==patch.expectedSha256||!/^[a-f0-9]{64}$/.test(row.afterSha256))denied();
      if(patch.expectedSha256===null){sources.push({path:patch.path,source:null});continue;}
      const sourceRecord=records.slice(start+1,end).filter(item=>item.nodeId==='F15_N03'&&item.toolName==='coding.repair.read'
        &&item.result?.path===patch.path&&item.result?.sha256===patch.expectedSha256).at(-1);
      const source=confirmed(sourceRecord,'F15_N03','coding.repair.read');
      if(source.proposal.arguments.sessionId!==key.sessionId||source.proposal.arguments.path!==patch.path
        ||typeof source.result?.content!=='string'||createHash('sha256').update(source.result.content).digest('hex')!==patch.expectedSha256)denied();
      sources.push({path:patch.path,source:source.result.content});
    }
    if(assertWorkspacePermission({ownerTaskId:key.taskId,taskId:preview.record.localTaskId,runId:preview.runId,
      arguments:structuredClone(args),deadline})!==true)denied();
    return {authorId,deadline,patches,sources,reviewerId:key.reviewerId,policyId:key.policyId,sessionId:key.sessionId,
      taskId:key.taskId,snapshotId:key.snapshotId,patchDigest:key.patchDigest};
  }
  return {readAuthorIdentity,assertOriginalOwner(key){try{inspect(key);return true;}catch{return false;}},
    async showOriginalPatch(key){
      if(typeof showNativePatch!=='function'||typeof confirmNativeDisclosure!=='function')throw new ProtocolError('UNSUPPORTED_CAPABILITY','本机独立审核展示不可用');
      const before=inspect(key);
      if(Buffer.byteLength(JSON.stringify({patches:before.patches,sources:before.sources}),'utf8')>256*1024)
        throw new ProtocolError('UNSUPPORTED_CAPABILITY','原补丁过大，无法在本机安全展示');
      if(await confirmNativeDisclosure({taskId:before.taskId,sessionId:before.sessionId,snapshotId:before.snapshotId,
        patchDigest:before.patchDigest,reviewerId:before.reviewerId,authorId:before.authorId,policyId:before.policyId,
        fileCount:before.patches.length})!==true)return {shown:false};
      if(!isDeepStrictEqual(before,inspect(key)))denied();
      // This callback is supplied only by native main composition; no content is returned over IPC.
      const shown=await showNativePatch(structuredClone(before));
      const after=inspect(key);if(!isDeepStrictEqual(before,after))denied();
      return {shown:shown===true};
    }};
}

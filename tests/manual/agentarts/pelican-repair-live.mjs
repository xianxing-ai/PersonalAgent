// Real full F15 main + isolated-shadow acceptance over the existing image protocol.
// Reads trusted configuration from stdin. Only a fresh public fixture is writable.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp,realpath} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync,execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {TaskRuntime} from '@personal-agent/runtime';
import {createWorkspaceReadTool,createWorkspacePatchPreviewTool,createWorkspacePatchApplyTool} from '@personal-agent/coding-tools';
import {createWorkflowDecisionTool,createOwnedWorkflowAdapter,getOwnedWorkflowTemplate,createOwnedWorkflowReceiptVerifier} from '@personal-agent/agentarts';
import {ModelGateway} from '@personal-agent/models';
import {ProtocolError} from '@personal-agent/contracts';
import {startLayaService} from '../../../apps/agentarts-runtime/src/laya-service.mjs';
import {createOwnedLayaSelector} from '../../../apps/agentarts-runtime/src/laya-selector.mjs';
import {ownedWorkflowLiveConfiguration,ownedWorkflowInvocationTarget,parseOwnedWorkflowInvocationBody,runOwnedWorkflowParent} from './owned-workflow-live.mjs';
import {createAdaptiveWorkflowSelector,decisionDigest} from '../../../apps/agentarts-runtime/src/adaptive-decision.mjs';
import {createTestImageModelProvider,readTestImageResponseText} from './test-image-model-provider.mjs';
import {pelicanAcceptanceContract,createTestPatchReconciliation} from './pelican-test-version.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url)),baseline=fileURLToPath(new URL('./fixtures/pelican-animation-bug.svg',import.meta.url));
const checker=fileURLToPath(new URL('./check-pelican.py',import.meta.url));
const sha=value=>createHash('sha256').update(typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value)).digest('hex');
const objectSchema={type:'object'},filename='pelican.svg';
const patchSchema={type:'object',additionalProperties:false,required:['path','expectedSha256','edits'],properties:{path:{const:filename},
  expectedSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},edits:{type:'array',minItems:1,items:{type:'object',additionalProperties:false,
    required:['oldText','newText'],properties:{oldText:{type:'string',minLength:1},newText:{type:'string'}}}}}};
const template=getOwnedWorkflowTemplate('F15'),nodeIds=template.nodes.map(node=>node.id);
const requiredTools={F15_N01:'workspace.read_text',F15_N04:'workflow.host.f15_n04',
  F15_N05:'workflow.host.f15_n05',F15_N06:'workflow.host.f15_n06'};
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const active=(signal,deadline)=>{
  if(signal.aborted)throw new ProtocolError('CANCELLED','Original F15 task cancelled');
  if(!Number.isFinite(Date.parse(deadline))||Date.parse(deadline)<=Date.now())throw new ProtocolError('TIMEOUT','Original F15 deadline expired');
};

/** Only test-launcher aliases; the shared trusted endpoint/configuration validator remains authoritative. */
export function pelicanWorkflowConfiguration(supplied) {
  const value={...supplied};
  for(const [alias,canonical] of [['url','invocationUrl'],['innerAuth','innerAuthorization'],['inboundAuth','inboundAuthorization']]) {
    if(value[alias]===undefined)continue;
    const normalized=alias==='url'||value[alias].startsWith('Bearer ')?value[alias]:'Bearer '+value[alias];
    assert.ok(value[canonical]===undefined||value[canonical]===normalized,'Conflicting trusted test configuration');
    value[canonical]=normalized;delete value[alias];
  }
  if(value.invocationUrl) {
    const endpoint=new URL(value.invocationUrl),match=/^\/runtimes\/([A-Za-z0-9_-]+)\/invocations$/.exec(endpoint.pathname);
    if(value.runtimeName===undefined&&value.runtimeId===undefined&&match)value.runtimeName=match[1];
    value.version??=endpoint.searchParams.get('endpoint');
  }
  const modelRevision=value.modelRevision??'unqualified-local-config-'+sha(value.localLaya??{});delete value.modelRevision;
  assert.equal(typeof modelRevision,'string');assert.ok(modelRevision.length>0&&modelRevision.length<256);
  const config=ownedWorkflowLiveConfiguration({...value,workflowId:value.workflowId??'F15'});
  assert.equal(config.workflowId,'F15');assert.ok(config.localLaya,'Explicit local Laya configuration required');
  return {...config,modelRevision};
}

/** Reuses the existing Adaptive selector and the original parent TaskRuntime checkpoints. */
export function createPelicanAdaptiveSelector({runtime,taskId,laya,teacher,modelRevision,onRecord=()=>{}}) {
  const adaptive=createAdaptiveWorkflowSelector({laya,teacher,modelRevision,qualification:()=>false,
    store:{read:key=>runtime.loadCheckpoint(taskId,key),writeOnce:(key,value)=>runtime.saveCheckpointOnce(taskId,key,value)},onRecord});
  return {select:async request=>{
    const context=JSON.parse(request.context);assert.equal(context.workflowId,'F15');assert.ok(nodeIds.includes(context.nodeId));
    const record=await adaptive.decide({...request,site:context.nodeId,criteriaVersion:pelicanAcceptanceContract.version,
      criteria:'Choose an original candidate satisfying the CURRENT node contract, published schema and actual predecessors. '
        +'An unexecuted tool request is only a request; never require future evidence or claim it has run. '
        +JSON.stringify({nodeContract:context.nodeContract,acceptanceContract:pelicanAcceptanceContract}),
      sources:[{sourceId:'F15-current-context-'+context.nodeId,revision:sha(request.context),sha256:sha(request.context)}],
      abstainIds:(context.candidateValues??[]).filter(candidate=>candidate.abstain===true).map(candidate=>candidate.id)});
    assert.equal(record.decided_by,'deepseek','Unqualified Laya must escalate to the original teacher');
    return {selectedId:record.selectedId,...(record.metadata?{metadata:record.metadata}:{})};
  }};
}

/** Byte check complements the XML oracle; it neither generates nor applies a candidate patch. */
export function assertPelicanBeginOnly(before,after) {
  const neutralize=text=>{
    const ids=[];
    const normalized=text.replace(/<animateTransform\b[^>]*>/g,tag=>{
      const id=/\bid="([^"]+)"/.exec(tag)?.[1];assert.ok(['back-spin','front-spin','pedal-spin'].includes(id));ids.push(id);
      const begin=/\sbegin="([^"]*)"/.exec(tag);if(begin)assert.ok(['indefinite','0','0s','0ms'].includes(begin[1]));
      return tag.replace(/\sbegin="[^"]*"/,'');
    });
    assert.deepEqual(ids.sort(),['back-spin','front-spin','pedal-spin']);return normalized;
  };
  assert.equal(neutralize(before),neutralize(after),'Only the existing begin attribute bytes may change');
}

/** Compare signed host receipts with original Policy, ToolGateway records, cached results and Evidence. */
export async function verifyPelicanOperation(runtime,identity,proposal,receipt,receiptSecret) {
  assert.ok(receipt&&await createOwnedWorkflowReceiptVerifier({secret:receiptSecret}).verify(receipt,proposal,identity),'Original signed receipt is required');
  assert.equal(receipt.state,'confirmed');
  const localTaskId=receipt.proof.localTaskId,runId=receipt.proof.runId,task=runtime.getTask(localTaskId);
  const binding=runtime.loadCheckpoint(identity.taskId,'owned-workflow:operation:'+proposal.operationId);
  assert.ok(binding);assert.equal(binding.localTaskId,localTaskId);assert.equal(binding.taskId,identity.taskId);
  assert.equal(binding.sessionId,identity.sessionId);assert.equal(binding.workflowId,'F15');
  assert.equal(binding.taskDeadline,identity.taskDeadline);assert.equal(decisionDigest(binding.proposal),decisionDigest(proposal));
  assert.equal(task.state,'succeeded');const records=runtime.readToolExecutions(localTaskId);assert.equal(records.length,1);
  const record=records[0];assert.equal(record.state,'confirmed');assert.equal(record.policyDecision,'allow');
  assert.equal(record.executionStarted,true);assert.ok(record.finishedAt);assert.equal(record.taskId,localTaskId);
  assert.equal(record.evidenceId,runId);assert.equal(record.toolName,proposal.toolName);assert.equal(record.toolVersion,proposal.toolVersion);
  assert.ok(runtime.matchesToolExecutionInput(record,{arguments:proposal.arguments,scopeRef:runId}),'Original ToolGateway input binding is required');
  const cached=runtime.loadCheckpoint(localTaskId,'tool-result-'+runId);assert.ok(cached);
  assert.equal(decisionDigest(cached.result),decisionDigest(receipt.result));
  const evidence=runtime.readEvidence(localTaskId);assert.ok(receipt.evidenceRefs.length);
  for(const ref of receipt.evidenceRefs)assert.ok(evidence.some(item=>item.evidenceId===ref&&item.sourceRef===proposal.toolName),'Original Evidence is required');
  return {localTaskId,runId,record:structuredClone(record),evidence:structuredClone(evidence),resultDigest:decisionDigest(cached.result)};
}

export function assertPelicanGraphCompletion(graph,{operations,stages,identity,validation,sourceSha256,currentSha256}) {
  assert.ok(stages?.length>1,'Completion requires actual advance transport records');
  for(const stage of stages) {
    assert.equal(stage.surface,'workflow_advance');assert.equal(stage.operation,'advance');assert.equal(stage.workflowVersion,'1.0.0');
    assert.equal(stage.status,'returned');assert.equal(stage.sessionId,identity.sessionId);assert.equal(stage.taskId,identity.taskId);
    assert.equal(stage.controlRevision,identity.controlRevision);assert.equal(stage.taskDeadline,identity.taskDeadline);
    assert.equal(stage.requestedVersion,identity.requestedVersion);assert.equal(stage.httpStatus,200);
    assert.ok(Number.isFinite(stage.wallMs)&&stage.wallMs>=0);assert.ok(Date.parse(stage.finishedAt)>=Date.parse(stage.startedAt));
  }
  assert.equal(stages.at(-1).graphState,'settled');
  assert.equal(graph?.workflowVersion,'1.0.0');assert.equal(graph.workflowId,'F15');assert.equal(graph.templateVersion,template.version);
  assert.equal(graph.templateDigest,template.templateDigest);assert.equal(graph.verification,'unverified');assert.equal(graph.state,'settled');
  assert.deepEqual(Object.keys(graph.nodes).sort(),[...nodeIds].sort());assert.equal(graph.proposals.length,0);assert.equal(graph.unavailable.length,0);
  assert.ok(operations.length>0);assert.equal(new Set(operations.map(op=>op.proposal.operationId)).size,operations.length);
  for(const node of template.nodes) {
    assert.equal(node.required,true);assert.equal(graph.nodes[node.id].state,'completed','Every required F15 node must complete');
    const actual=operations.filter(op=>op.proposal.nodeId===node.id);assert.ok(actual.some(op=>op.proposal.toolName==='decision.choose_candidate'));
    for(const op of actual) {
      const stageIndex=stages.findIndex(stage=>stage.requestId===op.requestId);
      assert.ok(stageIndex>=0&&stages[stageIndex].proposedNodeIds.includes(node.id),'Operation requires its original advance proposal');
      assert.ok(stages.slice(stageIndex+1).some(stage=>stage.receiptOperationIds.includes(op.proposal.operationId)),
        'Original receipt must be consumed by a later advance');
      assert.equal(op.receipt.state,'confirmed');assert.ok(op.verified?.record?.state==='confirmed');assert.ok(op.receipt.evidenceRefs.length);
      for(const ref of op.receipt.evidenceRefs)assert.ok(graph.nodes[node.id].evidenceRefs?.includes(ref),'Graph must consume every original operation Evidence');
    }
    if(requiredTools[node.id]) {
      const business=actual.filter(op=>op.proposal.toolName===requiredTools[node.id]);assert.equal(business.length,1);
      const result=business[0].receipt.result,value=graph.nodes[node.id].value;
      assert.ok(decisionDigest(value)===decisionDigest(result)||value?.kind==='trusted_tool_result_reference'&&value.valueDigest===sha(result),
        'Completed node must retain its actual host result');
    }
  }
  assert.equal(validation?.passed,true);assert.equal(validation.geometryPreserved,true);
  assert.equal(validation.baselineSha256,sourceSha256);assert.equal(validation.currentSha256,currentSha256);
  assert.deepEqual([...validation.activeAnimations].sort(),['back-spin','front-spin','pedal-spin']);
  const delivered=operations.find(op=>op.proposal.toolName===requiredTools.F15_N06).receipt.result;
  assert.equal(delivered.patchReadyForReview,true);assert.equal(delivered.autoPushBlocked,true);
  assert.equal(delivered.baselineSha256,sourceSha256);assert.equal(delivered.currentSha256,currentSha256);
  return {workflowId:'F15',templateVersion:template.version,templateDigest:template.templateDigest,
    nodeStates:Object.fromEntries(nodeIds.map(id=>[id,graph.nodes[id].state])),operationCount:operations.length,
    evidenceRefs:[...new Set(operations.flatMap(op=>op.receipt.evidenceRefs))],sourceSha256,currentSha256};
}

export function assertPelicanMainAndIsolated(report) {
  assert.equal(report.runs.length,2);assert.deepEqual(report.runs.map(run=>run.mode).sort(),['isolated','main']);
  for(const run of report.runs) {
    assert.equal(run.status,'passed_real_workflow');assert.equal(run.parentState,'succeeded');assert.equal(run.graphCompletion?.workflowId,'F15');
    assert.equal(run.persistence?.parentState,'succeeded');assert.equal(run.persistence?.allOperationsVerified,true);
  }
  for(const key of ['sameBaseline','rootsSeparate','mainSourceUnaffectedByShadow'])assert.equal(report.comparison[key],true);
}

export async function runPelicanRepairLive(supplied) {
const config=pelicanWorkflowConfiguration(supplied);
const report={schemaVersion:1,kind:'real_pelican_incremental_repair_main_and_shadow',startedAt:new Date().toISOString(),
  fixture:'existing pelican/bicycle SVG; three animations deliberately do not start',
  target:ownedWorkflowInvocationTarget(config),
  modelProviders:{execution:'cloud workflow advance',decision:'unqualified local Laya candidate then cloud testVersion teacher',fake:false},
  wiringSurface:'explicit manual test harness; not default Desktop wiring',teacherCalls:[],
  isolationScope:'Independent F15 fixture tasks/roots/sessions/authorizations; not CW06/F22 same-decision counterfactual or resource admission',
  acceptance:{localDecisionTargetMs:150,fullWorkflowIncludesShadow:true,resourceQuota:false,
    browserPlayback:'not_yet_observed'},shadowScheduling:'after_main',runs:[]};
const secrets=[config.receiptSecret,config.inboundAuthorization.slice(7),config.innerAuthorization.slice(7)];
const safe=value=>JSON.parse(JSON.stringify(value,(_key,item)=>typeof item==='string'
  ?secrets.reduce((text,secret)=>text.replaceAll(secret,'[redacted]'),item):item));
const failure=error=>safe({code:typeof error?.code==='string'?error.code:'HARNESS_ASSERTION',message:String(error?.message??'F15 test failed').slice(0,400)});
const directory=await mkdtemp(join(root,'.cache','pelican-live-'));report.directory=directory;
let service;
const controller=new AbortController(),stop=()=>controller.abort();
process.once('SIGINT',stop);process.once('SIGTERM',stop);
const deadlineSignal=AbortSignal.any([controller.signal,AbortSignal.timeout(Math.max(1,Date.parse(config.deadline)-Date.now()))]);

async function resourceSnapshot() {
  const response=await fetch('http://127.0.0.1:'+service.port+'/health',{headers:{authorization:'Bearer '+service.key},
    redirect:'error',signal:deadlineSignal});assert.equal(response.status,200);const health=await response.json();
  assert.ok(Number.isSafeInteger(health.processId)&&health.processId>0);
  const code='$p=Get-Process -Id '+health.processId+'; @{cpuMs=$p.TotalProcessorTime.TotalMilliseconds;rssBytes=$p.WorkingSet64;'
    +'peakRssBytes=$p.PeakWorkingSet64;osThreads=$p.Threads.Count}|ConvertTo-Json -Compress';
  const processUsage=JSON.parse(execFileSync('C:/Program Files/PowerShell/7/pwsh.exe',['-NoProfile','-Command',code],{windowsHide:true,encoding:'utf8'}));
  return {at:new Date().toISOString(),processId:health.processId,device:health.device,precision:health.precision,
    process:processUsage,accelerator:health.accelerator};
}

function validate(directory,signal=deadlineSignal) {
  active(signal,config.deadline);const started=performance.now(),startedAt=new Date().toISOString();
  const run=spawnSync(config.localLaya.python,[checker,join(directory,filename),baseline],{windowsHide:true,shell:false,encoding:'utf8',
    timeout:Math.max(1,Math.min(2147483647,Date.parse(config.deadline)-Date.now()))});
  if(run.error)throw Error('Pelican checker did not execute');
  active(signal,config.deadline);const value=JSON.parse(run.stdout);assert.equal(run.status,value.passed?0:1);
  return {...value,checker:{command:'check-pelican.py <fixture> <baseline>',startedAt,finishedAt:new Date().toISOString(),wallMs:performance.now()-started,exitCode:run.status}};
}

async function runGraph(mode,laya,teacher) {
  const hostCpuStart=process.cpuUsage();
  const started=performance.now(),runDirectory=join(directory,mode);await mkdir(runDirectory);const recoveryDirectory=join(directory,mode+'-backups');await mkdir(recoveryDirectory);
  const source=await readFile(baseline,'utf8');await writeFile(join(runDirectory,filename),source);
  const initial=validate(runDirectory);assert.equal(initial.passed,false);assert.equal(initial.failure,'pelican_animation_not_started');
  const result={mode,directory:runDirectory,initial,stages:[],decisions:[],executions:[],operations:[],status:'in_progress'};report.runs.push(result);
  const readTool=createWorkspaceReadTool({rootPath:runDirectory}),preview=createWorkspacePatchPreviewTool({rootPath:runDirectory});
  const apply=createWorkspacePatchApplyTool({rootPath:runDirectory,recoveryRootPath:recoveryDirectory,powerShellPath:'C:/Program Files/PowerShell/7/pwsh.exe'});
  let previewed,applied,validated,selector;
  const decision=createWorkflowDecisionTool({selector:{select:request=>selector.select(request)}});
  const scopeAdapter=createOwnedWorkflowAdapter({nodeId:'F15_N04',kind:'host',inputSchema:patchSchema,outputSchema:objectSchema,
    requiredScopes:['workspace:read'],sideEffect:'read',execute:async(input,context)=>{
      previewed=await preview.execute(input,context);assert.equal(previewed.path,filename);assert.equal(previewed.beforeSha256,sha(source));
      active(context.signal,context.deadline);assertPelicanBeginOnly(source,previewed.previewText);
      const checkedAt=new Date().toISOString(),start=performance.now();
      const check=spawnSync(config.localLaya.python,[checker,'-',baseline],{input:previewed.previewText,windowsHide:true,shell:false,encoding:'utf8',
        timeout:Math.max(1,Date.parse(context.deadline)-Date.now())});active(context.signal,context.deadline);
      const checked=JSON.parse(check.stdout);assert.equal(check.status,0,'The candidate must fix animation without replacing the original geometry');
      return {approved:true,noBreakingApi:'not_applicable_static_svg',noUnrelatedFormatting:true,scopeReview:'deterministic byte/structure check; not an independent model review',
        patch:input,previewSha256:previewed.afterSha256,checks:checked,checker:{startedAt:checkedAt,finishedAt:new Date().toISOString(),wallMs:performance.now()-start,exitCode:check.status}};
    }});
  const applyAdapter=createOwnedWorkflowAdapter({nodeId:'F15_N05',kind:'host',inputSchema:patchSchema,outputSchema:objectSchema,
    requiredScopes:['workspace:read','workspace:write','workspace:apply'],sideEffect:'local_write',execute:async(input,context)=>{
      assert.ok(previewed);const nextPreview=await preview.execute(input,context);
      assert.equal(nextPreview.afterSha256,previewed.afterSha256);applied=await apply.execute(input,context);
      assert.equal(applied.applied,true);validated=validate(runDirectory,context.signal);
      return {passedTests:validated.passed?1:0,failedTests:validated.passed?0:1,testDurationMs:validated.checker.wallMs,
        patch:input,patchReceipt:applied,verification:validated};
    }});
  const deliver=createOwnedWorkflowAdapter({nodeId:'F15_N06',kind:'host',inputSchema:{type:'object',additionalProperties:false,properties:{},required:[]},
    outputSchema:objectSchema,requiredScopes:['workspace:read'],sideEffect:'local_write',execute:async()=>{
      assert.ok(applied&&validated?.passed);const bytes=await readFile(join(runDirectory,filename));
      assert.equal(sha(bytes),applied.afterSha256);return {patchReadyForReview:true,autoPushBlocked:true,artifact:filename,
        baselineSha256:initial.baselineSha256,currentSha256:sha(bytes),geometryPreserved:validated.geometryPreserved,activeAnimations:validated.activeAnimations};
    }});
  const tools=[readTool,decision,scopeAdapter,applyAdapter,deliver];
  const workspacePatchReconciliation=await createTestPatchReconciliation({rootPath:runDirectory,recoveryRootPath:recoveryDirectory,
    powerShellPath:'C:/Program Files/PowerShell/7/pwsh.exe'});
  let app=createRuntimeApplication({path:join(runDirectory,'runtime.sqlite'),profile:'huawei_ict_agentarts',
    hostUserNamespace:'pelican-'+mode,tools,workspacePatchReconciliation});
  const task=app.runtime.submitTask({goal:'Incrementally repair the existing pelican SVG animations',conversationId:'pelican-'+mode,idempotencyKey:randomUUID()});
  const sessionId='pelican-'+randomUUID(),snapshot={namespace:'pelican-'+mode,asOf:report.startedAt,sourceVersions:{pelican:sha(source)}};
  const identity={taskId:task.taskId,workflowId:'F15',controlRevision:1,sessionId,deadline:config.deadline,taskDeadline:config.deadline};
  result.identity={...identity,requestedVersion:config.version};
  selector=createPelicanAdaptiveSelector({runtime:app.runtime,taskId:task.taskId,laya,teacher,modelRevision:config.modelRevision,
    onRecord:record=>result.decisions.push(safe(record))});
  const bridge=app.createOwnedWorkflowHost({receiptSecret:config.receiptSecret,
    assertActive:(id,revision)=>{const current=app.runtime.getTask(id);assert.equal(id,task.taskId);assert.equal(revision,1);assert.equal(current.state,'running');assert.notEqual(current.cancelRequested,true);},
    assertIsolation:(id,isolation)=>{assert.equal(mode,'isolated');assert.equal(id,task.taskId);assert.equal(isolation.namespace,snapshot.namespace);
      assert.equal(isolation.snapshotDigest,sha(snapshot));assert.equal(relative(directory,runDirectory),'isolated');}});
  const client=new Client(app);await client.connect();let last,graph;
  const evidence=new Set();
  const input={goal:'Repair the existing pelican riding a bicycle SVG. Its three wheel/pedal animations never start. '
      +'Use only an incremental exact-text patch; preserve all original geometry, layout, IDs and animation transforms/durations. '
      +'N01 read pelican.svg. N02 scope is only pelican.svg. N03 patchDiff MUST be an object with path,expectedSha256,edits[{oldText,newText}] '
      +'compatible with the supplied patchSchema, never a unified diff string. Use exact original source strings. '
      +'N04 and N05 host arguments MUST be that exact patch object directly, not wrapped in patch. N04 performs preview/scope checks; '
      +'N05 actually applies and validates. N06 arguments are {} and delivers only after actual passed verification. Never claim a future write already happened.',
    targetFile:filename,patchGoal:'Make the three existing animateTransform animations start automatically',patchSchema,
    sourceSnapshot:source,sourceSha256:sha(source),initialFailure:initial,allowedPaths:[filename],acceptanceContract:pelicanAcceptanceContract};
  const waitForReadback=reason=>{
    const current=app.runtime.getTask(task.taskId);
    if(current.state==='running')app.runtime.transitionTask(task.taskId,'waiting_reconciliation',
      {error:{code:'RESULT_UNKNOWN',message:reason,retryable:false}});
  };
  try {
    await runOwnedWorkflowParent(app.runtime,task.taskId,async worker=>{
      const signal=AbortSignal.any([deadlineSignal,worker.signal]);
      let receipts=[];
      while(!signal.aborted) {
        const requestId='pelican-'+randomUUID(),query={workflowVersion:'1.0.0',operation:'advance',...identity,input,
          availableTools:tools.map(({descriptor})=>({name:descriptor.name,version:descriptor.version,inputSchema:descriptor.inputSchema})),
          ...(mode==='isolated'?{mode:'isolated',snapshot}:{}),...(last?{checkpoint:last}:{}),receipts};
        // deadline/session are transport metadata, not new query fields.
        delete query.deadline;delete query.sessionId;
        worker.saveCheckpoint('pelican:send:'+requestId,{state:'sent_or_unknown',inputDigest:sha(query)});
        const stage={surface:'workflow_advance',operation:query.operation,workflowVersion:query.workflowVersion,requestId,sessionId,
          requestedVersion:config.version,taskId:task.taskId,controlRevision:identity.controlRevision,taskDeadline:config.deadline,
          startedAt:new Date().toISOString(),status:'sent_or_unknown',receiptOperationIds:receipts.map(receipt=>receipt.operationId)};
        result.stages.push(stage);await writeFile(join(runDirectory,'receipt.json'),JSON.stringify(safe(result),null,2)+'\n');
        active(signal,config.deadline);const start=performance.now();
        try {
        const response=await fetch(config.url,{method:'POST',redirect:'error',signal,
          headers:{'content-type':'application/json',accept:'application/json,text/event-stream',authorization:config.inboundAuthorization,
            'x-pa-agent-token':config.innerAuthorization,'x-hw-agentarts-session-id':sessionId,'x-request-id':requestId,
            'x-pa-deadline':config.deadline,'x-invoke-mode':config.invokeMode},body:JSON.stringify({query:JSON.stringify(query)})});
        stage.httpStatus=response.status;assert.equal(response.status,200);const text=await readTestImageResponseText(response);active(signal,config.deadline);
        graph=parseOwnedWorkflowInvocationBody(text,response.headers.get('content-type'));
        assert.equal(graph.workflowId,'F15');assert.equal(graph.templateVersion,template.version);assert.equal(graph.templateDigest,template.templateDigest);
        assert.equal(typeof graph.checkpoint,'string');assert.ok(graph.checkpoint);
        Object.assign(stage,{status:'returned',graphState:graph.state,templateVersion:graph.templateVersion,templateDigest:graph.templateDigest,
          proposedNodeIds:graph.proposals.map(proposal=>proposal.nodeId),nodeStates:Object.fromEntries(Object.entries(graph.nodes).map(([id,node])=>[id,node.state]))});
        }catch(error){stage.status='failed_or_unknown';stage.failure=failure(error);waitForReadback('Original advance response must be reconciled; no automatic resend');throw error;}
        finally{stage.finishedAt=new Date().toISOString();stage.wallMs=performance.now()-start;}
        worker.saveCheckpoint('pelican:graph',graph.checkpoint);last=graph.checkpoint;receipts=[];
        if(graph.state==='settled') {
          const bytes=await readFile(join(runDirectory,filename));assertPelicanBeginOnly(source,bytes.toString('utf8'));
          result.graphCompletion=assertPelicanGraphCompletion(graph,{operations:result.operations,stages:result.stages,identity:result.identity,
            validation:validated,sourceSha256:sha(source),currentSha256:sha(bytes)});
          result.finalGraph=graph;result.status='passed_real_workflow';result.final=validated;
          return {resultSummary:'Existing pelican animation repaired by actual generated patch and verified readback',evidenceRefs:[...evidence]};
        }
        if(!['progress','awaiting_host'].includes(graph.state)) {
          if(graph.state==='unknown')waitForReadback('Original workflow contains an unknown operation; only original readback is allowed');
          result.blocker={graphState:graph.state,nodes:Object.fromEntries(Object.entries(graph.nodes)
            .filter(([,node])=>['unknown','unavailable','failed'].includes(node.state)).map(([id,node])=>[id,{state:node.state,reason:node.reason}]))};
          throw Error('Workflow did not advance: '+graph.state);
        }
        if(!graph.proposals.length) {
          const key=sha(result.stages.at(-1).nodeStates);if(key===result.previousProgressKey)throw Error('Workflow has no new evidence or progress');
          result.previousProgressKey=key;continue;
        }
        assert.equal(graph.proposals.length,1);
        for(const proposal of graph.proposals) {
          active(signal,config.deadline);const start=performance.now(),startedAt=new Date().toISOString();
          // Isolated is an explicitly authorized independent fixture, without invented CW06 resource admission.
          const hostRequest={...identity,signal};
          const local=mode==='isolated'?bridge.submit(hostRequest,proposal):await bridge.submitWithShadow(hostRequest,proposal);
          const operation={proposal:structuredClone(proposal),localTaskId:local.localTaskId,requestId,sessionId,requestedVersion:config.version,
            startedAt,status:'submitted'};result.operations.push(operation);
          while(!signal.aborted) {
            const pending=app.readHostToolTask(local.localTaskId);
            if(pending.task.state==='waiting_approval') {
              if(pending.approval?.state==='pending')await client.call('authorization.respond',{approvalId:pending.approval.approvalId,expectedRevision:pending.approval.revision,decision:'allow_once'});
              else if(pending.approval?.state==='allowed')app.resumeHostToolTask(local.localTaskId);
              else throw Error('Original tool approval is unavailable');
            } else if(['succeeded','failed','cancelled','waiting_reconciliation'].includes(pending.task.state))break;
            await new Promise(resolve=>setTimeout(resolve,10));
          }
          if(signal.aborted)app.runtime.requestCancel(local.localTaskId,'Original F15 parent cancelled');
          const receipt=await bridge.readReceiptWithShadow(hostRequest,proposal);
          Object.assign(operation,{status:receipt?.state??'unknown',receipt:receipt??null,task:app.runtime.getTask(local.localTaskId),
            records:app.runtime.readToolExecutions(local.localTaskId),evidence:app.runtime.readEvidence(local.localTaskId),
            finishedAt:new Date().toISOString(),wallMs:performance.now()-start});
          await writeFile(join(runDirectory,'receipt.json'),JSON.stringify(safe(result),null,2)+'\n');
          worker.saveCheckpoint('pelican:receipt:'+proposal.operationId,operation);
          if(!receipt||['unknown','stopping'].includes(receipt.state)) {
            waitForReadback('Original ToolGateway operation requires readback; no replacement operation is permitted');
            throw new ProtocolError('RESULT_UNKNOWN','Original F15 operation is not confirmed');
          }
          if(receipt.state!=='confirmed')throw new ProtocolError('EXTERNAL_FAILURE','Original F15 ToolGateway operation failed; retained in receipt');
          operation.verified=await verifyPelicanOperation(app.runtime,identity,proposal,receipt,config.receiptSecret);
          result.executions.push({nodeId:proposal.nodeId,tool:proposal.toolName,localTaskId:local.localTaskId,wallMs:performance.now()-start,
            operationId:proposal.operationId,evidenceRefs:receipt.evidenceRefs,confirmed:true});
          for(const ref of receipt.evidenceRefs)evidence.add(ref);receipts.push(receipt);
        }
      }
      throw Error('Original task deadline or cancellation');
    },{deadline:config.deadline,sideEffect:'local_write'});
    result.parentState=app.runtime.getTask(task.taskId).state;
    if(result.status!=='passed_real_workflow'||result.parentState!=='succeeded') {
      result.status='failed_or_unknown';result.failure=app.runtime.getTask(task.taskId).error?.message??'Workflow did not complete';
    }
  }catch(error){result.status='failed_or_unknown';result.failure=failure(error);result.parentState=app.runtime.getTask(task.taskId).state;}
  finally {
    while(app.activeTaskCount)await new Promise(resolve=>setTimeout(resolve,10));app.close();app=undefined;
    const persisted=new TaskRuntime(join(runDirectory,'runtime.sqlite'));
    try {
      result.persistence={parentState:persisted.getTask(task.taskId).state,operations:[],readbackOnly:true,allOperationsVerified:false};
      for(const operation of result.operations) {
        const row={operationId:operation.proposal.operationId,localTaskId:operation.localTaskId,
          task:persisted.getTask(operation.localTaskId),records:persisted.readToolExecutions(operation.localTaskId),evidence:persisted.readEvidence(operation.localTaskId)};
        result.persistence.operations.push(row);
        if(operation.receipt?.state==='confirmed')row.verified=await verifyPelicanOperation(persisted,identity,operation.proposal,operation.receipt,config.receiptSecret);
      }
      result.persistence.allOperationsVerified=result.operations.length>0&&result.persistence.operations.every(row=>row.verified);
      if(result.status==='passed_real_workflow') {
        assert.equal(result.persistence.parentState,'succeeded');assert.equal(result.persistence.allOperationsVerified,true);
        assertPelicanGraphCompletion(result.finalGraph,{operations:result.operations,stages:result.stages,identity:result.identity,validation:result.final,sourceSha256:sha(source),
          currentSha256:sha(await readFile(join(runDirectory,filename)))});
      }
    }catch(error){result.status='failed_or_unknown';result.persistenceFailure=failure(error);}finally{persisted.close();}
    result.wallMs=performance.now()-started;
    result.resources={localHostCpuMicros:process.cpuUsage(hostCpuStart),
      scope:report.shadowScheduling==='overlap_with_main'?'Shared process during overlapping workflows; not exclusive CPU attribution':'Local harness CPU only; model usage in joint report'};
    await writeFile(join(runDirectory,'receipt.json'),JSON.stringify(safe(result),null,2)+'\n');
  }
  return result;
}

try {
  const teacherProvider=await createTestImageModelProvider({url:config.url,token:config.innerAuthorization.slice(7),
    inboundAuthorization:config.inboundAuthorization,signal:deadlineSignal,deadline:config.deadline,invokeMode:config.invokeMode,
    onRecord:record=>report.teacherCalls.push(record)});
  const teacher=new ModelGateway(teacherProvider);
  const start=performance.now();service=await startLayaService({...config.localLaya,signal:deadlineSignal,cpuExecutionPolicy:'sequential'});
  report.localModel={device:service.device,torchThreads:service.torchThreads,startupMs:performance.now()-start,records:[]};
  const selector=createOwnedLayaSelector({port:service.port,getApiKey:()=>service.key,isReady:service.isReady,cpuExecutionPolicy:'sequential',
    onDecision:record=>report.localModel.records.push(record)});
  report.resourcesBefore=await resourceSnapshot();const startFlows=performance.now();
  await runGraph('main',selector,teacher);const mainBeforeShadow=sha(await readFile(join(directory,'main',filename)));
  await runGraph('isolated',selector,teacher);
  report.mainAndShadowWallMs=performance.now()-startFlows;
  report.resourcesAfter=await resourceSnapshot();
  const main=report.runs.find(run=>run.mode==='main'),shadow=report.runs.find(run=>run.mode==='isolated');
  report.comparison={sameBaseline:main.initial.baselineSha256===shadow.initial.baselineSha256,
    rootsSeparate:main.directory!==shadow.directory,
    bothPassed:report.runs.every(run=>run.status==='passed_real_workflow'&&run.parentState==='succeeded'),
    mainSourceUnaffectedByShadow:sha(await readFile(join(main.directory,filename)))===mainBeforeShadow};
  assertPelicanMainAndIsolated(report);report.status='passed_real_main_and_shadow';
}catch(error){report.status='failed_or_unknown';report.failure=failure(error);}
finally {
  await service?.stop();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  report.finishedAt=new Date().toISOString();const text=JSON.stringify(safe(report),null,2)+'\n';
  assert.ok(![config.receiptSecret,config.inboundAuthorization.slice(7),config.innerAuthorization.slice(7)].some(secret=>text.includes(secret)));
  await writeFile(join(directory,'receipt.json'),text);
  process.stdout.write(JSON.stringify({status:report.status,directory,mainAndShadowWallMs:report.mainAndShadowWallMs,
    runs:report.runs.map(({mode,status,wallMs,parentState,failure})=>({mode,status,wallMs,parentState,failure})),
    layaDecisions:report.localModel?.records.length,failure:report.failure},null,2)+'\n');
  if(report.status!=='passed_real_main_and_shadow')process.exitCode=1;
}
return safe(report);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const chunks=[];let size=0;
  for await(const chunk of process.stdin){size+=chunk.length;assert.ok(size<=16384,'Trusted test config exceeds limit');chunks.push(chunk);}
  await runPelicanRepairLive(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));
}

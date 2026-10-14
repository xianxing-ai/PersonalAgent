import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {Client} from '@personal-agent/client';
import {TaskRuntime} from '@personal-agent/runtime';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createWorkspaceReadTool} from '@personal-agent/coding-tools';
import {OwnedWorkflowHostBridge,deriveOwnedWorkflowKeys} from '@personal-agent/agentarts';

const ROOT=fileURLToPath(new URL('../../../',import.meta.url));
const CACHE=join(ROOT,'.cache','owned-workflow-live');
const FIXTURE_NAME='owned-workflow-public-fixture.txt';
const FIXTURE_CONTENT='PersonalAgent owned workflow public fixture.\nThis file is synthetic and contains no private project or account data.\n';
const SHA=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const fail=(code,stage)=>{throw Object.assign(new Error(code),{code,stage});};
const JSON_WRITE=async(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n');
const MAX_RESPONSE_BYTES=1_200_000;

/** Native image message/task_end/end collector. Pure: no I/O or model substitution. */
export function parseOwnedWorkflowInvocationBody(body,contentType) {
  let events;
  if(typeof body!=='string'||Buffer.byteLength(body)>MAX_RESPONSE_BYTES)fail('RESPONSE_LIMIT','response');
  const type=(contentType??'').split(';',1)[0].trim().toLowerCase();
  if(type==='application/json') {
    try{events=JSON.parse(body);}catch{fail('INVALID_JSON','response');}
    if(!Array.isArray(events))fail('INVALID_EVENT_ARRAY','response');
  } else if(type==='text/event-stream') {
    events=[];
    const normalized=body.replaceAll('\r\n','\n');
    if(normalized.includes('\r'))fail('INVALID_SSE_NEWLINE','response');
    for(const frame of normalized.split('\n\n')) {
      if(!frame.trim())continue;
      const lines=frame.split('\n');let eventName;
      const data=[];
      for(const line of lines) {
        if(!line||line.startsWith(':'))continue;
        if(line.startsWith('event:'))eventName=line.slice(6).trim();
        else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));
        else if(!/^(?:id|retry):/.test(line))fail('INVALID_SSE_FIELD','response');
      }
      if(!data.length)continue;
      if(data.join('\n')==='[DONE]')continue;
      let value;try{value=JSON.parse(data.join('\n'));}catch{fail('INVALID_SSE_JSON','response');}
      const values=Array.isArray(value)?value:[value];
      for(const item of values) {
        if(!plain(item))fail('INVALID_SSE_EVENT','response');
        events.push(item.event===undefined&&eventName?{...item,event:eventName}:item);
      }
    }
  } else fail('UNSUPPORTED_CONTENT_TYPE','response');
  let terminal='open';const indexed=new Map(),unindexed=[];
  const failureToken=value=>typeof value==='string'&&value.toLowerCase().split(/[^a-z]+/).some(token=>['error','failed','failure'].includes(token));
  for(const event of events) {
    if(!plain(event)||typeof event.event!=='string')fail('INVALID_EVENT','response');
    if(['event','type','status'].some(field=>failureToken(event[field]))
      ||plain(event.data)&&(['event','type','status'].some(field=>failureToken(event.data[field]))||event.data.error_code!==undefined)) {
      fail('PLATFORM_EVENT_FAILED','response');
    }
    if(event.event==='message') {
      if(terminal!=='open'||!plain(event.data)||(event.data.text!==null&&typeof event.data.text!=='string'))fail('INVALID_MESSAGE_ORDER','response');
      if(event.data.text===null)continue;
      if(Object.hasOwn(event.data,'index')) {
        if(!Number.isSafeInteger(event.data.index)||event.data.index<0)fail('INVALID_MESSAGE_INDEX','response');
        if(indexed.has(event.data.index)&&indexed.get(event.data.index)!==event.data.text)fail('CONFLICTING_MESSAGE_INDEX','response');
        indexed.set(event.data.index,event.data.text);
      }else unindexed.push(event.data.text);
    } else if(event.event==='task_end') {
      if(terminal!=='open')fail('INVALID_TASK_END_ORDER','response');terminal='task-ended';
    } else if(event.event==='end') {
      if(terminal!=='task-ended')fail('INVALID_END_ORDER','response');terminal='ended';
    } else if(['workflow_start','workflow_end','execution_start','execution_end','ping'].includes(event.event)) {
      if(terminal!=='open')fail('INVALID_INTERMEDIATE_ORDER','response');
    } else fail('UNKNOWN_EVENT','response');
  }
  const text=[...indexed.entries()].sort(([a],[b])=>a-b).map(([,value])=>value).concat(unindexed).join('');
  if(terminal!=='ended'||!text.trim())fail('INCOMPLETE_INVOCATION','response');
  let value;try{value=JSON.parse(text);}catch{fail('INVALID_APPLICATION_JSON','response');}
  if(!plain(value)||value.workflowVersion!=='1.0.0'||value.verification!=='unverified')fail('INVALID_GRAPH_ENVELOPE','response');
  return value;
}

function configuration(value) {
  if(!plain(value))fail('INVALID_CONFIG','configuration');
  if(value.operation==='readback') {
    if(typeof value.runDirectory!=='string')fail('RUN_DIRECTORY_REQUIRED','configuration');
    const path=resolve(value.runDirectory),inside=relative(CACHE,path);
    if(!inside||inside.startsWith('..')||isAbsolute(inside)||resolve(path)===resolve(CACHE))fail('RUN_DIRECTORY_OUTSIDE_CACHE','configuration');
    return {operation:'readback',runDirectory:path};
  }
  const allowed=['operation','gatewayUrl','invocationUrl','runtimeId','runtimeName','version','inboundAuthorization',
    'innerAuthorization','receiptSecret','deadline','workflowId','runtimeLogFile','expectedSourceRevision','invokeMode'];
  if(Object.keys(value).some(key=>!allowed.includes(key))||value.operation!==undefined&&value.operation!=='live')fail('UNKNOWN_CONFIG_FIELD','configuration');
  const identity=value.runtimeId??value.runtimeName;
  if(!safeId(identity)||typeof value.version!=='string'||!/^[A-Za-z0-9_.-]{1,128}$/.test(value.version)
    ||typeof value.deadline!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.deadline)
    ||!Number.isFinite(Date.parse(value.deadline))||Date.parse(value.deadline)<=Date.now()
    ||!['F20','F15'].includes(value.workflowId??'F20'))fail('INVALID_RUNTIME_OR_DEADLINE','configuration');
  const credential=name=>{
    const text=value[name];
    if(typeof text!=='string'||!/^Bearer [\x21-\x7e]+$/.test(text)||text.length>4096)fail('INVALID_AUTHORIZATION','configuration');
    return text;
  };
  const inboundAuthorization=credential('inboundAuthorization'),innerAuthorization=credential('innerAuthorization');
  let endpoint;
  try {
    if(value.invocationUrl)endpoint=new URL(value.invocationUrl);
    else {
      const gateway=new URL(value.gatewayUrl);
      if(gateway.protocol!=='https:'||gateway.username||gateway.password||gateway.hash||gateway.search)throw Error();
      endpoint=new URL(gateway.toString().replace(/\/$/,'')+'/runtimes/'+encodeURIComponent(identity)+'/invocations');
    }
    if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.hash
      ||!endpoint.pathname.endsWith('/runtimes/'+encodeURIComponent(identity)+'/invocations')
      ||[...endpoint.searchParams.keys()].some(key=>key!=='endpoint')||endpoint.searchParams.getAll('endpoint').length>1)throw Error();
    endpoint.searchParams.set('endpoint',value.version);
  }catch{fail('INVALID_TRUSTED_ENDPOINT','configuration');}
  if(value.receiptSecret!==undefined&&(typeof value.receiptSecret!=='string'||Buffer.byteLength(value.receiptSecret)<32))fail('INVALID_RECEIPT_SECRET','configuration');
  if(value.runtimeLogFile!==undefined&&typeof value.runtimeLogFile!=='string')fail('INVALID_LOG_FILE','configuration');
  if(value.expectedSourceRevision!==undefined&&!/^[a-f0-9]{40}$/.test(value.expectedSourceRevision))fail('INVALID_EXPECTED_REVISION','configuration');
  const invokeMode=value.invokeMode??'published';if(!['published','debug'].includes(invokeMode))fail('INVALID_INVOKE_MODE','configuration');
  const keys=deriveOwnedWorkflowKeys({transportToken:innerAuthorization.slice(7),
    ...(value.receiptSecret===undefined?{}:{receiptSecret:value.receiptSecret})});
  return {operation:'live',url:endpoint.toString(),runtime:identity,version:value.version,
    deadline:value.deadline,workflowId:value.workflowId??'F20',inboundAuthorization,innerAuthorization,
    receiptSecret:keys.receiptSecret,receiptKeyMode:value.receiptSecret===undefined?'trusted-development-shared-bearer':'independent-host-key',
    runtimeLogFile:value.runtimeLogFile,expectedSourceRevision:value.expectedSourceRevision,invokeMode};
}

async function input() {
  const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>16384)fail('CONFIG_LIMIT','configuration');chunks.push(chunk);}
  try{return configuration(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));}
  catch(error){if(error.code)throw error;fail('INVALID_STDIN_JSON','configuration');}
}

async function readback(runDirectory) {
  const state=JSON.parse(await readFile(join(runDirectory,'state.json'),'utf8'));
  if(!safeId(state.taskId))fail('INVALID_SAVED_STATE','readback');
  const runtime=new TaskRuntime(join(runDirectory,'runtime.sqlite'));
  try {
    const binding=state.operationId?runtime.loadCheckpoint(state.taskId,'owned-workflow:operation:'+state.operationId):undefined;
    const localTaskId=state.localTaskId??binding?.localTaskId;
    const task=localTaskId?runtime.getTask(localTaskId):undefined;
    const records=localTaskId?runtime.readToolExecutions(localTaskId):[];
    return {status:'readback_only',networkCalls:0,toolExecutionRequests:0,runDirectory,
      parentState:runtime.getTask(state.taskId).state,localTaskId:localTaskId??null,localState:task?.state??'not_located',
      toolRecordCount:records.length,toolRecords:records.map(record=>({toolName:record.toolName,toolVersion:record.toolVersion,
        state:record.state,policyDecision:record.policyDecision,executionStarted:record.executionStarted,evidenceId:record.evidenceId})),
      evidenceCount:localTaskId?runtime.readEvidence(localTaskId).length:0,
      cloudDispatches:state.dispatches??[],notice:'Only original SQLite facts were read. Unknown cloud dispatches are not retried.'};
  }finally{runtime.close();}
}

async function layaLogs(path,requestIds) {
  if(!path)return {status:'not_observed_from_invocation_api',requestIds,records:[],
    requirement:'Correlate these requestIds with actual platform stdout laya_choice events; no synthetic log is substituted.'};
  const text=await readFile(path,'utf8'),records=[];
  for(const line of text.split(/\r?\n/)) {
    let record;try{record=JSON.parse(line);}catch{continue;}
    if(record?.event==='laya_ready'&&record.model==='multilingual'&&record.service==='embedded'&&record.warmed===true) {
      records.push({event:'laya_ready',model:'multilingual',service:'embedded',warmed:true});
    } else if(record?.event==='laya_choice'&&record.model==='multilingual'&&requestIds.includes(record.requestId)
      &&safeId(record.candidateId)&&Number.isFinite(record.durationMs)&&record.durationMs>=0) {
      records.push({event:'laya_choice',model:'multilingual',requestId:record.requestId,candidateId:record.candidateId,durationMs:record.durationMs});
    }
  }
  return {status:records.some(record=>record.event==='laya_choice')?'correlated_supplied_platform_log':'matching_choice_not_found',
    sourceFileSha256:SHA(text),sourceAuthenticity:'must_be_proven_by_platform_log_export',requestIds,records};
}

async function execute(config) {
  await mkdir(CACHE,{recursive:true});const runDirectory=await mkdtemp(join(CACHE,'live-'));
  await writeFile(join(runDirectory,FIXTURE_NAME),FIXTURE_CONTENT);
  const readTool=createWorkspaceReadTool({rootPath:runDirectory});
  let reads=0,app=createRuntimeApplication({path:join(runDirectory,'runtime.sqlite'),profile:'huawei_ict_agentarts',
    hostUserNamespace:'owned-public-live-harness',tools:[{descriptor:readTool.descriptor,execute:async(...arguments_)=>{reads++;return readTool.execute(...arguments_);}}]});
  const report={schemaVersion:1,profile:'huawei_ict_agentarts',status:'in_progress',startedAt:new Date().toISOString(),runDirectory,
    target:{runtime:config.runtime,requestedVersion:config.version,requestedVersionVerified:false,
      expectedSourceRevision:config.expectedSourceRevision??null,platformDeploymentReadback:'not_checked_by_this_cli'},
    providers:{fakeSelector:false,fakeExecutionModel:false,cloud:'real_agentarts_https',localTool:'production_workspace.read_text'},
    credentialHandling:{via:'stdin',exported:false,receiptKeyMode:config.receiptKeyMode},
    scope:{fixture:FIXTURE_NAME,contentSha256:SHA(FIXTURE_CONTENT),actor:'authorized-public-fixture-acceptance-harness',
      manualDesktopApproval:false,voiceConfirmation:false},network:[],unknown:[],unavailable:[]};
  const controller=new AbortController(),expiresAt=Date.parse(config.deadline);
  const timer=setTimeout(()=>controller.abort(),Math.min(2_147_483_647,Math.max(1,expiresAt-Date.now())));
  const onStop=()=>controller.abort();process.once('SIGINT',onStop);process.once('SIGTERM',onStop);
  const originalTask=app.runtime.submitTask({goal:'Read the fixed public owned-workflow fixture',conversationId:'owned-public-live',idempotencyKey:randomUUID()});
  const sessionId='owned-live-'+randomUUID(),state={taskId:originalTask.taskId,workflowId:config.workflowId,sessionId,controlRevision:1,dispatches:[]};
  await JSON_WRITE(join(runDirectory,'state.json'),state);
  const invocation=async(stage,query)=>{
    if(controller.signal.aborted||Date.now()>=expiresAt)fail('TIMEOUT',stage);
    const requestId='owned-'+randomUUID(),dispatch={stage,requestId,querySha256:SHA(query),state:'prepared'};
    state.dispatches.push(dispatch);await JSON_WRITE(join(runDirectory,'state.json'),state);
    // Persist before sending. A transport/parse failure stays unknown and is never automatically resubmitted.
    app.runtime.saveCheckpoint(originalTask.taskId,'owned-live:dispatch:'+requestId,dispatch);
    dispatch.state='sent_or_unknown';await JSON_WRITE(join(runDirectory,'state.json'),state);
    const started=Date.now();let response;
    try {
      response=await fetch(config.url,{method:'POST',headers:{'content-type':'application/json',accept:'application/json,text/event-stream',
        authorization:config.inboundAuthorization,'x-pa-agent-token':config.innerAuthorization,'x-hw-agentarts-session-id':sessionId,
        'x-request-id':requestId,'x-pa-deadline':config.deadline,'x-invoke-mode':config.invokeMode},
        body:JSON.stringify({query:JSON.stringify(query)}),signal:controller.signal,redirect:'error'});
      const surface={stage,requestId,httpStatus:response.status,contentType:(response.headers.get('content-type')??'').split(';',1)[0],
        durationMs:Date.now()-started,transport:'https',requestedEndpoint:config.version};report.network.push(surface);
      if(!response.ok){await response.body?.cancel();fail('HTTP_'+response.status,stage);}
      const chunks=[];let size=0;const reader=response.body?.getReader();if(!reader)fail('MISSING_BODY',stage);
      try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>MAX_RESPONSE_BYTES)fail('RESPONSE_LIMIT',stage);chunks.push(Buffer.from(item.value));}}
      catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
      const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
      const value=parseOwnedWorkflowInvocationBody(text,response.headers.get('content-type'));
      surface.durationMs=Date.now()-started;dispatch.state='response_validated';
      app.runtime.saveCheckpoint(originalTask.taskId,'owned-live:response:'+requestId,{workflowVersion:value.workflowVersion,
        ...(value.checkpoint?{checkpoint:value.checkpoint}:{})});
      await JSON_WRITE(join(runDirectory,'state.json'),state);return value;
    }catch(error){report.unknown.push({stage,requestId,code:/^[A-Z_0-9]+$/.test(error.code??'')?error.code:'TRANSPORT_OR_RESPONSE_UNKNOWN'});throw error;}
  };
  try {
    const catalog=await invocation('catalog',{workflowVersion:'1.0.0',operation:'catalog',workflowId:config.workflowId});
    if(!Array.isArray(catalog.workflowBindings)||catalog.workflowBindings.length!==28
      ||new Set(catalog.workflowBindings.map(binding=>binding.workflowId)).size!==28
      ||!catalog.workflowBindings.every(binding=>/^F(?:0[1-9]|1[0-9]|2[0-8])$/.test(binding.workflowId))
      ||catalog.template?.workflowId!==config.workflowId)fail('INVALID_CATALOG','catalog');
    report.catalog={workflowCount:28,workflowVersion:catalog.workflowVersion,
      templateVersion:catalog.template.version,templateDigest:catalog.template.templateDigest,
      selectedWorkflow:config.workflowId,selectedNodeCount:catalog.template.nodes.length};
    const goal=`Read exactly the public synthetic file ${FIXTURE_NAME} with workspace.read_text. Its current published inputSchema is supplied. `
      +'Prepare a candidate using only path and supported fields. Do not run commands, modify files, use other paths or claim that a tool already ran. '
      +'After the actual source receipt, use the public file result as evidence for the next candidate. No credentials or private context are supplied.';
    const common={workflowVersion:'1.0.0',operation:'advance',workflowId:config.workflowId,taskId:originalTask.taskId,controlRevision:1,
      input:{goal},availableTools:[{name:readTool.descriptor.name,version:readTool.descriptor.version,inputSchema:readTool.descriptor.inputSchema}]};
    const first=await invocation('proposal',common),nodeId=config.workflowId+'_N01';
    if(!plain(first.nodes)||!Array.isArray(first.proposals)||!first.checkpoint||first.workflowId!==config.workflowId)fail('INVALID_FIRST_GRAPH','proposal');
    report.firstGraph={state:first.state,targetNodeState:first.nodes[nodeId]?.state};
    report.unavailable=(first.unavailable??[]).map(item=>({nodeId:item.nodeId,capabilities:item.capabilities,reason:item.reason}));
    const proposals=first.proposals.filter(proposal=>proposal.nodeId===nodeId);
    if(proposals.length!==1)fail('NO_SINGLE_READ_PROPOSAL','proposal');
    const proposal=proposals[0];
    if(proposal.kind!=='tool_proposal'||proposal.toolName!==readTool.descriptor.name||proposal.toolVersion!==readTool.descriptor.version
      ||proposal.effect!=='read'||proposal.originControlRevision!==1||!plain(proposal.arguments)||proposal.arguments.path!==FIXTURE_NAME
      ||Object.keys(proposal.arguments).some(key=>!['path','maxBytes'].includes(key)))fail('PROPOSAL_OUTSIDE_PUBLIC_READ_SCOPE','proposal');
    state.operationId=proposal.operationId;await JSON_WRITE(join(runDirectory,'state.json'),state);
    app.runtime.saveCheckpoint(originalTask.taskId,'owned-live:graph-checkpoint',first.checkpoint);
    const bridge=new OwnedWorkflowHostBridge({receiptSecret:config.receiptSecret,host:app,
      checkpoints:{read:(task,key)=>app.runtime.loadCheckpoint(task,key),writeOnce:(task,key,value)=>app.runtime.saveCheckpointOnce(task,key,value)},
      assertActive:(task,revision)=>{const current=app.runtime.getTask(task);if(task!==originalTask.taskId||revision!==1
        ||current.cancelRequested||current.state!=='created')fail('STALE_LOCAL_CONTROL','host');}});
    const hostRequest={...common,sessionId,deadline:config.deadline};
    const local=bridge.submit(hostRequest,proposal);state.localTaskId=local.localTaskId;await JSON_WRITE(join(runDirectory,'state.json'),state);
    const waitFor=async(states)=>{
      while(Date.now()<expiresAt&&!controller.signal.aborted){const task=app.runtime.getTask(local.localTaskId);if(states.includes(task.state))return task;await new Promise(resolve=>setTimeout(resolve,10));}
      fail('LOCAL_TASK_TIMEOUT','host');
    };
    const waiting=await waitFor(['waiting_approval','failed','waiting_reconciliation','succeeded']);
    if(waiting.state!=='waiting_approval'||reads!==0)fail('EXPECTED_EXISTING_POLICY_WAIT','host');
    const pending=app.readHostToolTask(local.localTaskId),approval=pending.approval;
    if(!approval||approval.state!=='pending')fail('MISSING_ORIGINAL_APPROVAL','host');
    const client=new Client(app);await client.connect();
    await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    const completed=await waitFor(['succeeded','failed','waiting_reconciliation']);
    if(completed.state!=='succeeded')fail('LOCAL_READ_NOT_CONFIRMED','host');
    const receipt=bridge.readReceipt(hostRequest,proposal),records=app.runtime.readToolExecutions(local.localTaskId),evidence=app.runtime.readEvidence(local.localTaskId);
    if(!receipt||receipt.state!=='confirmed'||receipt.result?.content!==FIXTURE_CONTENT||reads!==1||records.length!==1
      ||records[0].state!=='confirmed'||records[0].policyDecision!=='allow'||records[0].executionStarted!==true
      ||evidence.length!==1||!receipt.evidenceRefs.includes(records[0].evidenceId))fail('ORIGINAL_EXECUTION_EVIDENCE_MISMATCH','host');
    const independentFile=await readFile(join(runDirectory,FIXTURE_NAME),'utf8');
    if(independentFile!==receipt.result.content)fail('PUBLIC_FILE_READBACK_MISMATCH','host');
    report.tool={operationId:proposal.operationId,originControlRevision:proposal.originControlRevision,proposalId:proposal.proposalId,
      toolName:proposal.toolName,toolVersion:proposal.toolVersion,inputDigest:proposal.inputDigest,
      localTaskId:local.localTaskId,localState:completed.state,executionCount:reads,policyDecision:'allow',
      approvalActor:'authorized-public-fixture-acceptance-harness',runId:records[0].evidenceId,
      evidence:evidence.map(item=>({evidenceId:item.evidenceId??item.id,verification:item.verification})),
      independentlyReadContentSha256:SHA(independentFile),signedReceipt:true};
    const continued=await invocation('receipt_resume',{...common,checkpoint:first.checkpoint,receipts:[receipt]});
    if(continued.nodes?.[nodeId]?.state!=='completed'||!continued.nodes[nodeId].evidenceRefs?.includes(records[0].evidenceId)) {
      fail('CLOUD_DID_NOT_ADMIT_SOURCE_RECEIPT','receipt_resume');
    }
    report.continuation={graphState:continued.state,originalToolNodeState:'completed',receiptAccepted:true,
      completedPostReceiptModelNodes:catalog.template.nodes.filter(node=>['decision','executor'].includes(node.kind)
        &&continued.nodes[node.id]?.state==='completed'&&first.nodes[node.id]?.state!=='completed').map(node=>node.id),
      localParentState:app.runtime.getTask(originalTask.taskId).state,localTerminalAuthority:'TaskRuntime; graph state is not a task terminal'};
    report.unavailable=(continued.unavailable??[]).map(item=>({nodeId:item.nodeId,capabilities:item.capabilities,reason:item.reason}));
    app.runtime.saveCheckpoint(originalTask.taskId,'owned-live:graph-checkpoint',continued.checkpoint);
    while(app.activeTaskCount)await new Promise(resolve=>setTimeout(resolve,10));app.close();app=undefined;
    const persisted=new TaskRuntime(join(runDirectory,'runtime.sqlite'));
    try{const original=persisted.getTask(local.localTaskId);if(original.state!=='succeeded'
      ||persisted.readToolExecutions(local.localTaskId).length!==1||persisted.readEvidence(local.localTaskId).length!==1)fail('PERSISTED_READBACK_MISMATCH','readback');
      report.persistence={reopened:true,localState:original.state,toolRecordCount:1,evidenceCount:1,additionalNetworkCalls:0,additionalToolExecutions:0};
    }finally{persisted.close();}
    report.status=report.continuation.completedPostReceiptModelNodes.length?'passed_public_read_and_graph_resume':'partial_receipt_admitted_model_recheck';
    report.laya=await layaLogs(config.runtimeLogFile,state.dispatches.map(dispatch=>dispatch.requestId));
    report.remaining=['28 real business workflows are not all accepted by this fixture','native knowledge/MCP/log/assessment are separate acceptance',
      'requested endpoint version needs independent platform deployment readback','Laya choice logs require authenticated platform export',
      'harness allow_once is not a human Desktop or voice-confirmation acceptance'];
  }catch(error){report.status='failed_or_unknown';report.failure={stage:error.stage??'execution',code:/^[A-Z_0-9]+$/.test(error.code??'')?error.code:'SANITIZED_FAILURE'};
    report.local={executionCount:reads,parentState:app?.runtime.getTask(originalTask.taskId).state??'closed',localTaskId:state.localTaskId??null};
  }finally{
    clearTimeout(timer);process.removeListener('SIGINT',onStop);process.removeListener('SIGTERM',onStop);
    if(app){if(app.activeTaskCount){report.cleanup='original host worker retained until its existing deadline';while(app.activeTaskCount)await new Promise(resolve=>setTimeout(resolve,10));}app.close();}
  }
  report.finishedAt=new Date().toISOString();
  const encoded=JSON.stringify(report);
  if([config.inboundAuthorization,config.innerAuthorization,config.inboundAuthorization.slice(7),config.innerAuthorization.slice(7),
    config.receiptSecret].some(secret=>secret&&encoded.includes(secret)))fail('REPORT_SECRET_PROJECTION','report');
  await JSON_WRITE(join(runDirectory,'receipt.json'),report);return report;
}

export async function main() {
  try{const config=await input();const result=config.operation==='readback'?await readback(config.runDirectory):await execute(config);
    process.stdout.write(JSON.stringify(result,null,2)+'\n');if(result.status==='failed_or_unknown'||result.status.startsWith('partial'))process.exitCode=1;
  }catch(error){process.stdout.write(JSON.stringify({schemaVersion:1,status:'not_executed_or_failed',failure:{stage:error.stage??'startup',
    code:/^[A-Z_0-9]+$/.test(error.code??'')?error.code:'SANITIZED_FAILURE'},credentialsExported:false})+'\n');process.exitCode=1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();

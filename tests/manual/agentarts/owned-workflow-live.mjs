import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {Client} from '@personal-agent/client';
import {TaskRuntime} from '@personal-agent/runtime';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createWorkspaceReadTool,createWorkspaceCommandTool} from '@personal-agent/coding-tools';
import {OwnedWorkflowHostBridge,deriveOwnedWorkflowKeys} from '@personal-agent/agentarts';
import {projectOwnedLayaTokenTelemetry} from '../../../scripts/agentarts/export-owned-release-evidence.mjs';

const ROOT=fileURLToPath(new URL('../../../',import.meta.url));
const CACHE=join(ROOT,'.cache','owned-workflow-live');
const FIXTURE_NAME='owned-workflow-public-fixture.txt';
const LEGACY_FIXTURE_CONTENT='PersonalAgent owned workflow public fixture.\nThis file is synthetic and contains no private project or account data.\n';
const API_FIXTURE={schemaVersion:1,scope:'Public synthetic API',
  api:{method:'POST',path:'/v1/public/greeting',operationId:'buildGreeting',version:'public-fixture-1'},
  contractTypeScript:'export interface GreetingRequest { name: string; language?: "zh-CN" | "en-US"; }\nexport interface GreetingResponse { message: string; }\n',
  implementationTypeScript:'import type { GreetingRequest, GreetingResponse } from "./public-contract.js";\nexport function buildGreeting(input: GreetingRequest): GreetingResponse { return { message: (input.language === "en-US" ? "Hello, " : "你好，") + input.name }; }\n',
  jsonSchema:{type:'object',required:['name'],additionalProperties:false,
    properties:{name:{type:'string'},language:{type:'string',enum:['zh-CN','en-US']}}},
  documentedFields:['name'],field:'language',
  docTemplate:'# Greeting\nPOST /v1/public/greeting\nname: required string; response.message: string.\n',
  exampleArguments:{name:'Public fixture',language:'zh-CN'},
  expectedDifference:{field:'language'}};

/** Fixed public inputs for the real providers; this is source data, not a Fake model or host result. */
export function ownedWorkflowPublicFixture(workflowId) {
  return {name:FIXTURE_NAME,content:workflowId==='F20'?JSON.stringify(API_FIXTURE)+'\n':LEGACY_FIXTURE_CONTENT};
}
export function ownedWorkflowFixtureInput(workflowId) {
  if(workflowId!=='F20')return {goal:`Read exactly the public synthetic file ${FIXTURE_NAME} with workspace.read_text. `
    +'Prepare its first candidate from the supplied published inputSchema using only supported fields. '
    +'After the actual source receipt, use the public result for the next candidate. Do not claim a tool already ran.'};
  return {goal:`F20 API docs: read ${FIXTURE_NAME}. N02 returns {docMarkdown,exampleArguments}; cite that file. `
    +`N03 requests recipe ${PUBLIC_RECIPE_ID}. From actual source and validation receipts, N04 returns {docVersion,synchronized:false,docMarkdown,sourceRefs}; `
    +'use the source API version, the exact checked document, and sourceRefs for the source file and owned-api-check-result.json. '
    +'Do not claim it was written, published or synchronized externally.',
    schemaFile:FIXTURE_NAME,codeFile:FIXTURE_NAME,field:API_FIXTURE.field,docTemplate:FIXTURE_NAME+'#docTemplate',
    targetDoc:PUBLIC_FINAL_DOC_NAME,
    fixtureLayout:{schema:'jsonSchema',contract:'contractTypeScript',code:'implementationTypeScript'},
    expectedOutputFields:['docMarkdown','exampleArguments']};
}
const SHA=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const fail=(code,stage)=>{throw Object.assign(new Error(code),{code,stage});};
const JSON_WRITE=async(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n');
const MAX_RESPONSE_BYTES=1_200_000;
const PUBLIC_CANDIDATE_NAME='owned-api-selected-candidate.json';
const PUBLIC_BINDING_NAME='owned-api-validation-binding.json';
const PUBLIC_SAMPLE_NAME='owned-api-example.ts';
const PUBLIC_CHECK_CONFIG_NAME='owned-api-tsconfig.json';
const PUBLIC_FINAL_DOC_NAME='owned-api-final-doc.md';
const PUBLIC_RECIPE_ID='validate-public-api-docs';
const require=createRequire(import.meta.url);
const fixtureMode=operation=>operation==='image-live'
  ?{surface:'local_owned_image',provider:'real_owned_image_http',prefix:'local_image'}
  :operation==='runtime-live'?{surface:'local_owned_source_runtime',provider:'real_owned_runtime_http',prefix:'local_runtime'}
    :{surface:'agentarts_cloud',provider:'real_agentarts_https',prefix:'public'};

/** Validated data from the actual selected MaaS/Laya candidate; no prewritten substitute document. */
export function ownedApiDocCandidate(value) {
  if(!plain(value)||typeof value.docMarkdown!=='string'||!value.docMarkdown.trim()
    ||!plain(value.exampleArguments)||Buffer.byteLength(JSON.stringify(value))>MAX_RESPONSE_BYTES) {
    fail('INVALID_PUBLIC_DOC_CANDIDATE','candidate');
  }
  return structuredClone(value);
}

/** TaskRuntime may return on deadline before its worker settles. Keep the original worker alive until cleanup is safe. */
export async function runOwnedWorkflowParent(runtime,taskId,worker,options) {
  let finishWorker,workerStarted=false;const workerFinished=new Promise(resolve=>{finishWorker=resolve;});
  const result=await runtime.runTask(taskId,async context=>{
    workerStarted=true;
    try{return await worker(context);}finally{finishWorker();}
  },options);
  if(workerStarted)await workerFinished;return result;
}

export function ownedApiDocCompletion(graph,{sourceSha256,candidateSha256,docSha256,check,sourceEvidenceRefs,checkEvidenceRefs}) {
  const nodes=['F20_N01','F20_N02','F20_N03','F20_N04'];
  if(graph?.workflowId!=='F20'||graph.state!=='settled'||!plain(graph.nodes)
    ||!nodes.every(node=>graph.nodes[node]?.state==='completed')
    ||graph.proposals?.length!==0||graph.unavailable?.length!==0)fail('PUBLIC_F20_NOT_COMPLETE','completion');
  if(check?.state!=='passed'||check.compiler?.exitCode!==0||check.checks?.typeCheckPassed!==true
    ||check.checks?.noPhantomFields!==true||check.source?.sha256!==sourceSha256
    ||check.candidate?.sha256!==candidateSha256||check.candidate?.docSha256!==docSha256)fail('PUBLIC_CHECK_BINDING_MISMATCH','completion');
  if(!Array.isArray(sourceEvidenceRefs)||!sourceEvidenceRefs.length||!Array.isArray(checkEvidenceRefs)||!checkEvidenceRefs.length
    ||!sourceEvidenceRefs.every(ref=>graph.nodes.F20_N01.evidenceRefs?.includes(ref))
    ||!checkEvidenceRefs.every(ref=>graph.nodes.F20_N03.evidenceRefs?.includes(ref)))fail('PUBLIC_COMPLETION_EVIDENCE_MISMATCH','completion');
  const final=graph.nodes.F20_N04.value;
  if(!plain(final)||typeof final.docMarkdown!=='string'||SHA(final.docMarkdown)!==docSha256
    ||final.docVersion!==API_FIXTURE.api.version||final.synchronized!==false
    ||!Array.isArray(final.sourceRefs)||!final.sourceRefs.includes(FIXTURE_NAME)||!final.sourceRefs.includes('owned-api-check-result.json')
    ||final.published===true||final.written===true)fail('FINAL_DOC_CANDIDATE_MISMATCH','completion');
  if(!final.docMarkdown.includes(FIXTURE_NAME)
    ||![API_FIXTURE.api.method,API_FIXTURE.api.path,'name','language','zh-CN','en-US','message']
      .every(field=>final.docMarkdown.includes(field)))fail('FINAL_DOC_SOURCE_CITATION_MISSING','completion');
  return {docMarkdown:final.docMarkdown,nodeStates:Object.fromEntries(nodes.map(node=>[node,graph.nodes[node].state])),
    docVersion:final.docVersion,synchronized:false,sourceRefs:[FIXTURE_NAME,'owned-api-check-result.json'],
    sourceSha256,candidateSha256,docSha256,evidenceRefs:[...new Set([...sourceEvidenceRefs,...checkEvidenceRefs])]};
}

/** Fixed recipe subprocess. It checks only already-staged public artifacts in this repository's cache. */
export async function checkOwnedPublicApiDocs(directory,compilerPath,deadline) {
  const root=resolve(directory),inside=relative(CACHE,root),actualCompiler=require.resolve('typescript/bin/tsc');
  if(!inside||inside.startsWith('..')||isAbsolute(inside)||resolve(compilerPath)!==resolve(actualCompiler))fail('PUBLIC_CHECK_SCOPE','check');
  const remaining=Date.parse(deadline)-Date.now();if(!Number.isFinite(remaining)||remaining<=0)fail('TIMEOUT','check');
  const sourceText=await readFile(join(root,FIXTURE_NAME),'utf8'),candidateText=await readFile(join(root,PUBLIC_CANDIDATE_NAME),'utf8');
  const binding=JSON.parse(await readFile(join(root,PUBLIC_BINDING_NAME),'utf8')),source=JSON.parse(sourceText),candidate=ownedApiDocCandidate(JSON.parse(candidateText));
  if(binding.sourceSha256!==SHA(sourceText)||binding.candidateSha256!==SHA(candidateText)||binding.docSha256!==SHA(candidate.docMarkdown)
    ||JSON.stringify(source.jsonSchema)!==JSON.stringify(API_FIXTURE.jsonSchema)
    ||source.contractTypeScript!==API_FIXTURE.contractTypeScript||source.implementationTypeScript!==API_FIXTURE.implementationTypeScript)fail('PUBLIC_ARTIFACT_BINDING_MISMATCH','check');
  const sample='import type { GreetingRequest } from "./public-contract.js";\nimport { buildGreeting } from "./public-implementation.js";\n'
    +'const example: GreetingRequest = '+JSON.stringify(candidate.exampleArguments)+';\nconst response = buildGreeting(example);\n';
  await writeFile(join(root,'public-contract.ts'),source.contractTypeScript);
  await writeFile(join(root,'public-implementation.ts'),source.implementationTypeScript);
  await writeFile(join(root,PUBLIC_SAMPLE_NAME),sample);
  await JSON_WRITE(join(root,PUBLIC_CHECK_CONFIG_NAME),{compilerOptions:{strict:true,noEmit:true,skipLibCheck:true,
    types:[],target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext'},files:[PUBLIC_SAMPLE_NAME]});
  const compilation=spawnSync(process.execPath,[actualCompiler,'--project',PUBLIC_CHECK_CONFIG_NAME,'--pretty','false'],
    {cwd:root,env:{},shell:false,windowsHide:true,encoding:'utf8',timeout:Math.min(2_147_483_647,Math.max(1,Date.parse(deadline)-Date.now()))});
  const packageInfo=JSON.parse(await readFile(resolve(actualCompiler,'../../package.json'),'utf8'));
  const noPhantomFields=Object.keys(candidate.exampleArguments).every(field=>Object.hasOwn(source.jsonSchema.properties,field));
  const passed=compilation.error===undefined&&compilation.status===0&&noPhantomFields;
  return {schemaVersion:1,kind:'public_api_doc_validation',state:passed?'passed':'failed',
    source:{name:FIXTURE_NAME,sha256:binding.sourceSha256,api:source.api,documentedFields:source.documentedFields,
      expectedDifference:source.expectedDifference,contractTypeScript:source.contractTypeScript,
      implementationTypeScript:source.implementationTypeScript,jsonSchema:source.jsonSchema,docTemplate:source.docTemplate,field:source.field},
    candidate:{sha256:binding.candidateSha256,docSha256:binding.docSha256,docMarkdown:candidate.docMarkdown,exampleArguments:candidate.exampleArguments},
    compiler:{name:'TypeScript',version:packageInfo.version,exitCode:Number.isInteger(compilation.status)?compilation.status:null,
      diagnosticsSha256:SHA((compilation.stdout??'')+(compilation.stderr??'')),started:compilation.error?.code!=='ENOENT'},
    checks:{typeCheckPassed:compilation.error===undefined&&compilation.status===0,noPhantomFields,
      noPhantomFieldsScope:'exampleArguments checked against the API schema and TypeScript interface; not the whole Markdown',sourceBinding:true,candidateBinding:true},
    sampleSha256:SHA(sample),diagnostics:passed?null:String(compilation.stdout??compilation.error?.code??'COMPILER_FAILED').slice(0,4096)};
}

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

/** Public invocation target only; credentials are never part of the receipt target. */
export function ownedWorkflowInvocationTarget(config) {
  const mode=fixtureMode(config.operation);
  return {runtime:config.runtime,requestedVersion:config.version,invokeMode:config.invokeMode,requestedVersionVerified:false,
    expectedSourceRevision:config.expectedSourceRevision??null,validationSurface:mode.surface,kind:mode.surface,
    platformDeploymentReadback:mode.surface==='agentarts_cloud'?'not_checked_by_this_cli':'not_applicable_local_execution'};
}

export function ownedWorkflowLiveConfiguration(value) {
  if(!plain(value))fail('INVALID_CONFIG','configuration');
  if(value.operation==='readback') {
    if(typeof value.runDirectory!=='string')fail('RUN_DIRECTORY_REQUIRED','configuration');
    const path=resolve(value.runDirectory),inside=relative(CACHE,path);
    if(!inside||inside.startsWith('..')||isAbsolute(inside)||resolve(path)===resolve(CACHE))fail('RUN_DIRECTORY_OUTSIDE_CACHE','configuration');
    return {operation:'readback',runDirectory:path};
  }
  const allowed=['operation','gatewayUrl','invocationUrl','runtimeId','runtimeName','version','inboundAuthorization',
    'innerAuthorization','receiptSecret','deadline','workflowId','runtimeLogFile','expectedSourceRevision','invokeMode'];
  if(Object.keys(value).some(key=>!allowed.includes(key))||value.operation!==undefined&&!['live','image-live','runtime-live'].includes(value.operation))fail('UNKNOWN_CONFIG_FIELD','configuration');
  const operation=value.operation??'live';
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
    if(operation!=='live') {
      const matched=typeof value.invocationUrl==='string'&&/^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/invocations$/.exec(value.invocationUrl);
      if(!matched||Number(matched[1])>65535||value.gatewayUrl!==undefined)throw Error();
      endpoint=new URL(value.invocationUrl);
    } else {
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
    }
  }catch{fail('INVALID_TRUSTED_ENDPOINT','configuration');}
  if(value.receiptSecret!==undefined&&(typeof value.receiptSecret!=='string'||Buffer.byteLength(value.receiptSecret)<32))fail('INVALID_RECEIPT_SECRET','configuration');
  if(value.runtimeLogFile!==undefined&&typeof value.runtimeLogFile!=='string')fail('INVALID_LOG_FILE','configuration');
  if(value.expectedSourceRevision!==undefined&&!/^[a-f0-9]{40}$/.test(value.expectedSourceRevision))fail('INVALID_EXPECTED_REVISION','configuration');
  const invokeMode=value.invokeMode??'published';if(!['published','debug'].includes(invokeMode))fail('INVALID_INVOKE_MODE','configuration');
  const keys=deriveOwnedWorkflowKeys({transportToken:innerAuthorization.slice(7),
    ...(value.receiptSecret===undefined?{}:{receiptSecret:value.receiptSecret})});
  return {operation,url:endpoint.toString(),runtime:identity,version:value.version,
    deadline:value.deadline,workflowId:value.workflowId??'F20',inboundAuthorization,innerAuthorization,
    receiptSecret:keys.receiptSecret,receiptKeyMode:value.receiptSecret===undefined?'trusted-development-shared-bearer':'independent-host-key',
    runtimeLogFile:value.runtimeLogFile,expectedSourceRevision:value.expectedSourceRevision,invokeMode};
}

async function input() {
  const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>16384)fail('CONFIG_LIMIT','configuration');chunks.push(chunk);}
  try{return ownedWorkflowLiveConfiguration(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));}
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
      ...(state.validationTaskId?{validation:{localState:runtime.getTask(state.validationTaskId).state,
        toolRecordCount:runtime.readToolExecutions(state.validationTaskId).length,evidenceCount:runtime.readEvidence(state.validationTaskId).length},
        originalCompletion:runtime.loadCheckpoint(state.taskId,'owned-live:verified-completion')??null}:{}),
      cloudDispatches:state.dispatches??[],notice:'Only original SQLite facts were read. Unknown cloud dispatches are not retried.'};
  }finally{runtime.close();}
}

export async function ownedWorkflowLayaLogs(path,requestIds,surface='agentarts_cloud') {
  if(!path)return {status:'not_observed_from_invocation_api',requestIds,records:[],
    requirement:'Correlate these requestIds with actual platform stdout laya_choice events; no synthetic log is substituted.'};
  const text=await readFile(path,'utf8'),records=[];
  for(const line of text.split(/\r?\n/)) {
    let record;try{record=JSON.parse(line);}catch{continue;}
    if(record?.event==='laya_ready'&&record.model==='multilingual'&&record.service==='embedded'&&record.warmed===true) {
      records.push({event:'laya_ready',model:'multilingual',service:'embedded',warmed:true});
    } else if(record?.event==='laya_choice'&&record.model==='multilingual'&&requestIds.includes(record.requestId)
      &&safeId(record.candidateId)&&Number.isFinite(record.durationMs)&&record.durationMs>=0) {
      records.push({event:'laya_choice',model:'multilingual',requestId:record.requestId,candidateId:record.candidateId,durationMs:record.durationMs,
        ...projectOwnedLayaTokenTelemetry(record)});
    }
  }
  return {status:records.some(record=>record.event==='laya_choice')?(surface==='local_owned_image'?'correlated_supplied_image_log'
    :surface==='local_owned_source_runtime'?'correlated_supplied_runtime_log':'correlated_supplied_platform_log'):'matching_choice_not_found',
    sourceFileSha256:SHA(text),sourceAuthenticity:surface==='local_owned_image'
      ?'supplied image stdout; provenance requires independent image/source binding':surface==='local_owned_source_runtime'
        ?'supplied source runtime stdout; provenance requires independent source/model binding':'must_be_proven_by_platform_log_export',requestIds,records};
}

async function execute(config) {
  const mode=fixtureMode(config.operation);
  await mkdir(CACHE,{recursive:true});const runDirectory=await mkdtemp(join(CACHE,'live-'));
  const fixture=ownedWorkflowPublicFixture(config.workflowId),fixtureContent=fixture.content;
  await writeFile(join(runDirectory,FIXTURE_NAME),fixtureContent);
  const readTool=createWorkspaceReadTool({rootPath:runDirectory});
  const commandTool=config.workflowId==='F20'?createWorkspaceCommandTool({rootPath:runDirectory,recipes:[{id:PUBLIC_RECIPE_ID,
    executable:process.execPath,args:[fileURLToPath(import.meta.url),'--check-public-api-docs',require.resolve('typescript/bin/tsc'),config.deadline]}]}):undefined;
  let reads=0,commands=0,app=createRuntimeApplication({path:join(runDirectory,'runtime.sqlite'),profile:'huawei_ict_agentarts',
    hostUserNamespace:'owned-public-live-harness',tools:[{descriptor:readTool.descriptor,execute:async(...arguments_)=>{reads++;return readTool.execute(...arguments_);}},
      ...(commandTool?[{descriptor:commandTool.descriptor,execute:async(...arguments_)=>{commands++;return commandTool.execute(...arguments_);}}]:[])]});
  const report={schemaVersion:1,profile:'huawei_ict_agentarts',status:'in_progress',startedAt:new Date().toISOString(),runDirectory,
    target:ownedWorkflowInvocationTarget(config),
    providers:{fakeSelector:false,fakeExecutionModel:false,cloud:mode.provider,localTool:'production_workspace.read_text',
      ...(commandTool?{validationTool:'production_workspace.run_allowed_command',compiler:'real_typescript_noEmit'}:{})},
    credentialHandling:{via:'stdin',exported:false,receiptKeyMode:config.receiptKeyMode},
    scope:{fixture:FIXTURE_NAME,contentSha256:SHA(fixtureContent),actor:'authorized-public-fixture-acceptance-harness',
      manualDesktopApproval:false,voiceConfirmation:false},network:[],unknown:[],unavailable:[]};
  const confirmedEvidenceRefs=new Set();
  const controller=new AbortController(),expiresAt=Date.parse(config.deadline);
  const timer=setTimeout(()=>controller.abort(),Math.min(2_147_483_647,Math.max(1,expiresAt-Date.now())));
  const onStop=()=>controller.abort();process.once('SIGINT',onStop);process.once('SIGTERM',onStop);
  const originalTask=app.runtime.submitTask({goal:config.workflowId==='F20'?'Produce and verify an API documentation candidate from the fixed public API source':'Read the fixed public owned-workflow fixture',
    conversationId:'owned-public-live',idempotencyKey:randomUUID()});
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
        durationMs:Date.now()-started,transport:mode.surface==='agentarts_cloud'?'https':'http_loopback',requestedEndpoint:config.version};report.network.push(surface);
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
    const parentResult=await runOwnedWorkflowParent(app.runtime,originalTask.taskId,async worker=>{
    const cancel=()=>controller.abort();worker.signal.addEventListener('abort',cancel,{once:true});
    const assertActive=()=>{const current=app.runtime.getTask(originalTask.taskId);
      if(worker.signal.aborted||controller.signal.aborted||Date.now()>=expiresAt||current.cancelRequested||current.state!=='running')fail('TIMEOUT','completion');};
    try {
    const catalog=await invocation('catalog',{workflowVersion:'1.0.0',operation:'catalog',workflowId:config.workflowId});
    if(!Array.isArray(catalog.workflowBindings)||catalog.workflowBindings.length!==28
      ||new Set(catalog.workflowBindings.map(binding=>binding.workflowId)).size!==28
      ||!catalog.workflowBindings.every(binding=>/^F(?:0[1-9]|1[0-9]|2[0-8])$/.test(binding.workflowId))
      ||catalog.template?.workflowId!==config.workflowId)fail('INVALID_CATALOG','catalog');
    report.catalog={workflowCount:28,workflowVersion:catalog.workflowVersion,
      templateVersion:catalog.template.version,templateDigest:catalog.template.templateDigest,
      selectedWorkflow:config.workflowId,selectedNodeCount:catalog.template.nodes.length};
    const common={workflowVersion:'1.0.0',operation:'advance',workflowId:config.workflowId,taskId:originalTask.taskId,controlRevision:1,
      input:ownedWorkflowFixtureInput(config.workflowId),
      availableTools:[readTool,...(commandTool?[commandTool]:[])].map(({descriptor})=>({name:descriptor.name,version:descriptor.version,inputSchema:descriptor.inputSchema}))};
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
        ||current.cancelRequested||current.state!=='running')fail('STALE_LOCAL_CONTROL','host');}});
    const hostRequest={...common,sessionId,deadline:config.deadline};
    const local=bridge.submit(hostRequest,proposal);state.localTaskId=local.localTaskId;await JSON_WRITE(join(runDirectory,'state.json'),state);
    const waitFor=async(states,localTaskId=local.localTaskId)=>{
      while(Date.now()<expiresAt&&!controller.signal.aborted){const task=app.runtime.getTask(localTaskId);if(states.includes(task.state))return task;await new Promise(resolve=>setTimeout(resolve,10));}
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
    if(!receipt||receipt.state!=='confirmed'||receipt.result?.content!==fixtureContent||reads!==1||records.length!==1
      ||records[0].state!=='confirmed'||records[0].policyDecision!=='allow'||records[0].executionStarted!==true
      ||evidence.length!==1||!receipt.evidenceRefs.includes(records[0].evidenceId))fail('ORIGINAL_EXECUTION_EVIDENCE_MISMATCH','host');
    const independentFile=await readFile(join(runDirectory,FIXTURE_NAME),'utf8');
    if(independentFile!==receipt.result.content)fail('PUBLIC_FILE_READBACK_MISMATCH','host');
    for(const ref of receipt.evidenceRefs)confirmedEvidenceRefs.add(ref);
    worker.saveCheckpoint('owned-live:confirmed-evidence-refs',[...confirmedEvidenceRefs]);
    report.tool={operationId:proposal.operationId,originControlRevision:proposal.originControlRevision,proposalId:proposal.proposalId,
      toolName:proposal.toolName,toolVersion:proposal.toolVersion,inputDigest:proposal.inputDigest,
      localTaskId:local.localTaskId,localState:completed.state,executionCount:reads,policyDecision:'allow',
      approvalActor:'authorized-public-fixture-acceptance-harness',runId:records[0].evidenceId,
      evidence:evidence.map(item=>({evidenceId:item.evidenceId??item.id,verification:item.verification})),
      independentlyReadContentSha256:SHA(independentFile),signedReceipt:true};
    let continued=await invocation('receipt_resume',{...common,checkpoint:first.checkpoint,receipts:[receipt]});
    if(continued.nodes?.[nodeId]?.state!=='completed'||!continued.nodes[nodeId].evidenceRefs?.includes(records[0].evidenceId)) {
      fail('CLOUD_DID_NOT_ADMIT_SOURCE_RECEIPT','receipt_resume');
    }
    const continuationReport=()=>({graphState:continued.state,originalToolNodeState:'completed',receiptAccepted:true,
      completedPostReceiptModelNodes:catalog.template.nodes.filter(node=>['decision','executor'].includes(node.kind)
        &&continued.nodes[node.id]?.state==='completed'&&first.nodes[node.id]?.state!=='completed').map(node=>node.id),
      localParentState:app.runtime.getTask(originalTask.taskId).state,localTerminalAuthority:'TaskRuntime; graph state is not a task terminal'});
    report.continuation=continuationReport();
    app.runtime.saveCheckpoint(originalTask.taskId,'owned-live:graph-checkpoint',continued.checkpoint);
    const sourceEvidenceRefs=[...receipt.evidenceRefs];let checkEvidenceRefs=[],check,candidateBinding;
    if(config.workflowId==='F20') {
      if(catalog.template.nodes.length!==4||!['F20_N01','F20_N02','F20_N03','F20_N04'].every(id=>catalog.template.nodes.some(node=>node.id===id)))fail('INVALID_F20_TEMPLATE','catalog');
      while(['progress','awaiting_host'].includes(continued.state)) {
        if(continued.nodes.F20_N02?.state==='completed'&&!candidateBinding) {
          const candidate=ownedApiDocCandidate(continued.nodes.F20_N02.value),candidateText=JSON.stringify(candidate,null,2)+'\n';
          candidateBinding={sourceSha256:SHA(fixtureContent),candidateSha256:SHA(candidateText),docSha256:SHA(candidate.docMarkdown)};
          await writeFile(join(runDirectory,PUBLIC_CANDIDATE_NAME),candidateText);
          await JSON_WRITE(join(runDirectory,PUBLIC_BINDING_NAME),candidateBinding);
          worker.saveCheckpoint('owned-live:selected-doc-binding',candidateBinding);
          report.candidate={nodeId:'F20_N02',artifactName:PUBLIC_CANDIDATE_NAME,...candidateBinding};
        }
        const checkProposals=continued.proposals.filter(item=>item.nodeId==='F20_N03');
        let next;
        if(checkProposals.length) {
          if(checkProposals.length!==1||commands!==0||!candidateBinding||!commandTool)fail('INVALID_PUBLIC_CHECK_PROPOSAL','validation');
          const checkProposal=checkProposals[0];
          if(checkProposal.kind!=='tool_proposal'||checkProposal.toolName!==commandTool.descriptor.name
            ||checkProposal.toolVersion!==commandTool.descriptor.version||checkProposal.originControlRevision!==1
            ||!plain(checkProposal.arguments)||Object.keys(checkProposal.arguments).length!==1
            ||checkProposal.arguments.recipeId!==PUBLIC_RECIPE_ID)fail('PROPOSAL_OUTSIDE_PUBLIC_CHECK_SCOPE','validation');
          const validationLocal=bridge.submit(hostRequest,checkProposal);state.validationTaskId=validationLocal.localTaskId;
          state.validationOperationId=checkProposal.operationId;await JSON_WRITE(join(runDirectory,'state.json'),state);
          const validationWaiting=await waitFor(['waiting_approval','failed','waiting_reconciliation','succeeded'],validationLocal.localTaskId);
          if(validationWaiting.state!=='waiting_approval'||commands!==0)fail('EXPECTED_COMMAND_POLICY_WAIT','validation');
          const checkApproval=app.readHostToolTask(validationLocal.localTaskId).approval;
          if(!checkApproval||checkApproval.state!=='pending')fail('MISSING_CHECK_APPROVAL','validation');
          await client.call('authorization.respond',{approvalId:checkApproval.approvalId,expectedRevision:checkApproval.revision,decision:'allow_once'});
          const validationCompleted=await waitFor(['succeeded','failed','waiting_reconciliation'],validationLocal.localTaskId);
          const checkReceipt=bridge.readReceipt(hostRequest,checkProposal),checkRecords=app.runtime.readToolExecutions(validationLocal.localTaskId),checkEvidence=app.runtime.readEvidence(validationLocal.localTaskId);
          if(validationCompleted.state!=='succeeded'||!checkReceipt||checkReceipt.state!=='confirmed'||commands!==1
            ||checkRecords.length!==1||checkRecords[0].state!=='confirmed'||checkRecords[0].policyDecision!=='allow'
            ||checkRecords[0].executionStarted!==true||checkEvidence.length!==1||!checkReceipt.evidenceRefs.includes(checkRecords[0].evidenceId))fail('CHECK_EXECUTION_EVIDENCE_MISMATCH','validation');
          report.validationTool={operationId:checkProposal.operationId,proposalId:checkProposal.proposalId,nodeId:'F20_N03',
            toolName:checkProposal.toolName,toolVersion:checkProposal.toolVersion,actualSideEffect:commandTool.descriptor.sideEffect,
            inputDigest:checkProposal.inputDigest,runId:checkRecords[0].evidenceId,localTaskId:validationLocal.localTaskId,
            localState:validationCompleted.state,executionCount:commands,policyDecision:'allow',signedReceipt:true,
            evidence:checkEvidence.map(item=>({evidenceId:item.evidenceId??item.id,verification:item.verification}))};
          for(const ref of checkReceipt.evidenceRefs)confirmedEvidenceRefs.add(ref);
          worker.saveCheckpoint('owned-live:confirmed-evidence-refs',[...confirmedEvidenceRefs]);
          try{check=JSON.parse(checkReceipt.result.stdout);}catch{fail('INVALID_COMPILER_RECEIPT','validation');}
          report.validation={state:check.state,sourceSha256:check.source?.sha256,candidateSha256:check.candidate?.sha256,
            docSha256:check.candidate?.docSha256,compiler:check.compiler,checks:check.checks,sampleSha256:check.sampleSha256};
          await JSON_WRITE(join(runDirectory,'owned-api-check-result.json'),check);
          report.validation.checkArtifactSha256=SHA(await readFile(join(runDirectory,'owned-api-check-result.json'),'utf8'));
          if(checkReceipt.result.exitCode!==0||check.kind!=='public_api_doc_validation'||check.state!=='passed'
            ||check.compiler?.exitCode!==0||check.checks?.typeCheckPassed!==true||check.checks?.noPhantomFields!==true
            ||check.source?.sha256!==candidateBinding.sourceSha256||check.candidate?.sha256!==candidateBinding.candidateSha256
            ||check.candidate?.docSha256!==candidateBinding.docSha256)fail('REAL_PUBLIC_TYPECHECK_FAILED','validation');
          checkEvidenceRefs=[...checkReceipt.evidenceRefs];
          next=await invocation('validation_receipt_resume',{...common,checkpoint:continued.checkpoint,receipts:[checkReceipt]});
          if(next.nodes?.F20_N03?.state!=='completed'||!checkEvidenceRefs.every(ref=>next.nodes.F20_N03.evidenceRefs?.includes(ref)))fail('CLOUD_DID_NOT_ADMIT_CHECK_RECEIPT','validation_receipt_resume');
        } else {
          if(continued.proposals.length)fail('UNEXPECTED_PUBLIC_GRAPH_PROPOSAL','advance');
          next=await invocation('graph_advance',{...common,checkpoint:continued.checkpoint});
        }
        const progressed=JSON.stringify(Object.fromEntries(Object.entries(next.nodes??{}).map(([id,node])=>[id,node.state])))
          !==JSON.stringify(Object.fromEntries(Object.entries(continued.nodes).map(([id,node])=>[id,node.state])));
        continued=next;worker.saveCheckpoint('owned-live:graph-checkpoint',continued.checkpoint);report.continuation=continuationReport();
        if(!progressed)break; // Busy/unchanged semantic state is retained for diagnosis, never hot-looped.
      }
      if(continued.state==='settled') {
        assertActive();
        const completion=ownedApiDocCompletion(continued,{...candidateBinding,check,sourceEvidenceRefs,checkEvidenceRefs});
        await writeFile(join(runDirectory,PUBLIC_FINAL_DOC_NAME),completion.docMarkdown);
        if(SHA(await readFile(join(runDirectory,PUBLIC_FINAL_DOC_NAME),'utf8'))!==completion.docSha256)fail('FINAL_DOC_ARTIFACT_READBACK_FAILED','completion');
        if(SHA(await readFile(join(runDirectory,'owned-api-check-result.json'),'utf8'))!==report.validation.checkArtifactSha256)fail('FINAL_CHECK_ARTIFACT_READBACK_FAILED','completion');
        assertActive();
        report.workflowCompletion={workflowId:'F20',graphState:'settled',allRequiredNodesCompleted:true,nodeStates:completion.nodeStates,
          verificationScope:'fixed public API documentation candidate; no project/account document was modified',
          sourceSha256:completion.sourceSha256,candidateSha256:completion.candidateSha256,docSha256:completion.docSha256,
          checkArtifactSha256:report.validation.checkArtifactSha256,
          docVersion:completion.docVersion,synchronized:false,sourceRefs:completion.sourceRefs,
          finalArtifactName:PUBLIC_FINAL_DOC_NAME,finalArtifactReadback:true,evidenceRefs:completion.evidenceRefs};
        worker.saveCheckpoint('owned-live:verified-completion',report.workflowCompletion);
        report.status='passed_'+mode.prefix+'_f20_documentation_workflow';
        return {resultSummary:'F20 public API documentation candidate: four nodes and actual TypeScript validation confirmed; final public artifact read back.',evidenceRefs:completion.evidenceRefs};
      }
    }
    report.unavailable=(continued.unavailable??[]).map(item=>({nodeId:item.nodeId,capabilities:item.capabilities,reason:item.reason}));
    report.status=config.workflowId==='F20'?'partial_'+(mode.prefix==='public'?'':mode.prefix+'_')+'receipt_admitted_model_recheck'
      :report.continuation.completedPostReceiptModelNodes.length?'passed_'+mode.prefix+'_read_and_graph_resume'
        :'partial_'+(mode.prefix==='public'?'':mode.prefix+'_')+'receipt_admitted_model_recheck';
    app.runtime.transitionTask(originalTask.taskId,'waiting_reconciliation',{resultSummary:'Original public tool evidence retained; the full workflow requires further verified continuation.',
      evidenceRefs:[...confirmedEvidenceRefs]});
    return {resultSummary:'Public read confirmed; full graph is pending verified continuation.',evidenceRefs:[...sourceEvidenceRefs,...checkEvidenceRefs]};
    }catch(error){report.failure={stage:error.stage??'execution',code:/^[A-Z_0-9]+$/.test(error.code??'')?error.code:'SANITIZED_FAILURE'};
      if(report.unknown.length||app.runtime.getTask(originalTask.taskId).state==='waiting_reconciliation') {
        if(app.runtime.getTask(originalTask.taskId).state==='running')app.runtime.transitionTask(originalTask.taskId,'waiting_reconciliation',
          {resultSummary:'Original dispatch/tool facts retained; unknown results are not retried.',evidenceRefs:[...confirmedEvidenceRefs]});
        report.status='failed_or_unknown';return {resultSummary:'Unknown workflow result retained for reconciliation.'};
      }
      throw error;
    }finally{worker.signal.removeEventListener('abort',cancel);}
    },{deadline:config.deadline,sideEffect:commandTool?'local_write':'read'});
    report.parentTask={taskId:originalTask.taskId,state:parentResult.state,evidenceRefs:parentResult.evidenceRefs,
      terminalAuthority:'existing TaskRuntime.runTask',completionProducedByWorker:report.status==='passed_'+mode.prefix+'_f20_documentation_workflow'};
    if(report.workflowCompletion&&parentResult.state!=='succeeded')fail('PARENT_TASK_NOT_SUCCEEDED','completion');
    if(parentResult.state==='failed')report.status='failed_or_unknown';
    if(report.continuation)report.continuation.localParentState=parentResult.state;
    while(app.activeTaskCount)await new Promise(resolve=>setTimeout(resolve,10));app.close();app=undefined;
    const persisted=new TaskRuntime(join(runDirectory,'runtime.sqlite'));
    try{const original=state.localTaskId?persisted.getTask(state.localTaskId):undefined;
      if(report.tool&&(original?.state!=='succeeded'
        ||persisted.readToolExecutions(state.localTaskId).length!==1||persisted.readEvidence(state.localTaskId).length!==1))fail('PERSISTED_READBACK_MISMATCH','readback');
      const parent=persisted.getTask(originalTask.taskId);
      report.persistence={reopened:true,localState:original?.state??'not_submitted',toolRecordCount:state.localTaskId?persisted.readToolExecutions(state.localTaskId).length:0,
        evidenceCount:state.localTaskId?persisted.readEvidence(state.localTaskId).length:0,additionalNetworkCalls:0,additionalToolExecutions:0,
        parentState:parent.state,parentEvidenceRefs:parent.evidenceRefs};
      if(state.validationTaskId) {
        const validation=persisted.getTask(state.validationTaskId),validationRecords=persisted.readToolExecutions(state.validationTaskId),validationEvidence=persisted.readEvidence(state.validationTaskId);
        report.persistence.validation={localState:validation.state,toolRecordCount:validationRecords.length,evidenceCount:validationEvidence.length};
        if(report.workflowCompletion&&(parent.state!=='succeeded'||validation.state!=='succeeded'||validationRecords.length!==1||validationEvidence.length!==1
          ||!report.workflowCompletion.evidenceRefs.every(ref=>parent.evidenceRefs.includes(ref))))fail('PERSISTED_WORKFLOW_COMPLETION_MISMATCH','readback');
      }
    }finally{persisted.close();}
    report.laya=await ownedWorkflowLayaLogs(config.runtimeLogFile,state.dispatches.map(dispatch=>dispatch.requestId),mode.surface);
    report.remaining=['28 real business workflows are not all accepted by this fixture','native knowledge/MCP/log/assessment are separate acceptance',
      ...(mode.surface!=='agentarts_cloud'?['Local '+mode.surface+' execution is not Huawei deployment or cloud acceptance; no AgentArts fallback was attempted',
        'Native Windows runtime timing is distinct from local ARM image/QEMU and Huawei native ARM measurements']:[]),
      'requested endpoint version needs independent platform deployment readback','Laya choice logs require authenticated platform export',
      'harness allow_once is not a human Desktop or voice-confirmation acceptance'];
  }catch(error){report.status='failed_or_unknown';report.failure={stage:error.stage??'execution',code:/^[A-Z_0-9]+$/.test(error.code??'')?error.code:'SANITIZED_FAILURE'};
    report.local={executionCount:reads,validationExecutionCount:commands,parentState:app?.runtime.getTask(originalTask.taskId).state??'closed',localTaskId:state.localTaskId??null};
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
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv[2]==='--check-public-api-docs') {
    try{const check=await checkOwnedPublicApiDocs(process.cwd(),process.argv[3],process.argv[4]);
      process.stdout.write(JSON.stringify(check)+'\n');if(check.state!=='passed')process.exitCode=1;
    }catch(error){process.stdout.write(JSON.stringify({schemaVersion:1,kind:'public_api_doc_validation',state:'failed',
      code:/^[A-Z_0-9]+$/.test(error.code??'')?error.code:'PUBLIC_CHECK_FAILED'})+'\n');process.exitCode=1;}
  }else await main();
}

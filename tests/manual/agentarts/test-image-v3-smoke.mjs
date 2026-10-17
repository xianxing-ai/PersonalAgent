// Actual Docker ARM64 production startup and HTTP protocol smoke, network disabled.
// Input JSON on stdin: {docker,image,output}. Caller builds the image separately.
// Synthetic signed host/model receipts only: no inference, device or platform account call.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
const config=JSON.parse(Buffer.concat(chunks).toString('utf8')),run=promisify(execFile),startedAtUtc=new Date().toISOString(),started=performance.now();
assert.ok(typeof config.docker==='string'&&typeof config.image==='string'&&typeof config.output==='string');
const inspected=JSON.parse((await run(config.docker,['image','inspect',config.image])).stdout)[0];assert.equal(inspected.Architecture,'arm64');
const negativeResults=[];
for(const variant of ['missing_proxy_header','direct_route_forbidden']) {
  const before=performance.now(),negativeScript=`
    Object.assign(process.env,{PA_AGENT_HOST_MODE:'agentarts',PA_AGENT_LAYA_MODE:'local',PA_AGENT_MODEL_BASE_URL:'https://proxy.synthetic.invalid/inference/v1',
      PA_AGENT_MODEL:'synthetic-no-inference',PA_AGENT_MODEL_API_KEY:'synthetic-no-account',PA_AGENT_WSS_AUTH_TOKEN:'synthetic-transport-credential-at-least32'});
    delete process.env.PA_AGENT_MODEL_PROXY_KEY_HEADER;
    ${variant==='direct_route_forbidden'?"process.env.PA_AGENT_MODEL_PROXY_KEY_HEADER='x-test-key';process.env.PA_AGENT_MODEL_ROUTE='direct-validation';":''}
    globalThis.fetch=()=>{throw Error('No external call allowed during rejected startup');};
    await import('./apps/agentarts-runtime/src/main.mjs');
  `;
  let rejection;try {await run(config.docker,['run','--rm','--platform','linux/arm64','--network','none','--entrypoint','node',config.image,'--input-type=module','-e',negativeScript],{maxBuffer:1024*1024});}
  catch(error){rejection=error;}
  assert.ok(rejection,'Production startup must reject '+variant);assert.equal(rejection.code,1);
  assert.match(rejection.stderr,/Agent runtime startup failed/);
  negativeResults.push({variant,exitCode:rejection.code,wallMs:performance.now()-before,rejected:true});
}
const script=String.raw`
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {deriveOwnedWorkflowKeys,proactiveWorkflowDigest as digest} from '@personal-agent/agentarts';
import {createProactiveHostProofs} from './apps/agentarts-runtime/src/proactive-controller.mjs';
const token=randomBytes(32).toString('hex'),keys=deriveOwnedWorkflowKeys({transportToken:token}),proofs=createProactiveHostProofs(keys.receiptSecret);
const contract={id:'synthetic-v3-triage',version:'v1',criteria:'Synthetic source context only',qualifiedForMain:false,batchIndependent:true,
 candidates:[{id:'research',description:'Inspect source',action:'research'},{id:'defer',description:'Wait for source',action:'defer'}]};
const file='/tmp/test-image-v3-services.json';
await writeFile(file,JSON.stringify({proactive:{decisionContracts:[contract]}}));
Object.assign(process.env,{PA_AGENT_HOST_MODE:'agentarts',PA_AGENT_LAYA_MODE:'local',PA_AGENT_MODEL_ROUTE:'agentarts-proxy',
 PA_AGENT_MODEL_BASE_URL:'https://proxy.synthetic.invalid/inference/v1',PA_AGENT_MODEL_PROXY_KEY_HEADER:'x-test-key',
 PA_AGENT_MODEL:'synthetic-no-inference',PA_AGENT_MODEL_API_KEY:'synthetic-no-account',PA_AGENT_WSS_AUTH_TOKEN:token,PA_AGENT_SERVICES_CONFIG_FILE:file});
const originalFetch=globalThis.fetch;let attemptedExternalCalls=0;
globalThis.fetch=(input,init)=>{if(!String(input).startsWith('http://127.0.0.1:8080/')){attemptedExternalCalls++;throw Error('External network forbidden in smoke');}return originalFetch(input,init);};
await import('./apps/agentarts-runtime/src/main.mjs');
let ping;for(let attempt=0;attempt<100;attempt++){try{ping=await fetch('http://127.0.0.1:8080/ping');if(ping.ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
assert.equal(ping?.status,200);
const timings=[],sessionId='v3-smoke-session';let sequence=0;
async function invoke(value,requestId,stage,expectedStatus=200) {
 const startedAtUtc=new Date().toISOString(),started=performance.now();
 const response=await fetch('http://127.0.0.1:8080/invocations',{method:'POST',headers:{'content-type':'application/json',
  'x-pa-agent-token':'Bearer '+token,'x-hw-agentarts-session-id':sessionId,'x-request-id':requestId},body:JSON.stringify({query:JSON.stringify(value)})});
 const frames=await response.json();assert.equal(response.status,expectedStatus,JSON.stringify(frames));
 timings.push({stage,startedAtUtc,finishedAtUtc:new Date().toISOString(),wallMs:performance.now()-started,httpStatus:response.status});
 return response.ok?JSON.parse(frames[0].data.text):frames;
}
const catalog=await invoke({workflowVersion:'1.0.0',operation:'catalog'},'v3-catalog','owned.catalog');
assert.equal(catalog.workflowBindings.length,28);assert.equal(catalog.designCoverage.nodeCount,185);
const platform=await invoke({platformVersion:1,operation:'list'},'v3-platform','platform.status');
assert.equal(platform.status.mcp.state,'unavailable');assert.equal(platform.status.toolExecution.state,'unavailable');
const description=await invoke({proactiveVersion:1,operation:'describe'},'v3-describe','proactive.describe');
assert.equal(description.descriptor.entries.length,4);assert.equal(description.descriptor.changesOwnedF01ToF28,false);
const binding={taskId:'v3-smoke-task',sessionId,controlRevision:1,taskDeadline:new Date(Date.now()+120000).toISOString()};
const caps=[{kind:'retrieve_context',ref:'synthetic.retrieve',location:'cloud_persistent',effect:'read'},
 {kind:'local_decision_batch',ref:'synthetic.local',location:'local_device',effect:'read'},
 {kind:'teacher_decision',ref:'synthetic.teacher',location:'cloud_persistent',effect:'read'}];
const event=proofs.sign('event',{eventId:'v3-source',entry:'connector',conversationId:'v3-conversation',sourceId:'synthetic-connector',entityRef:'fixture-entity',
 sourceVersion:'v1',observedAt:new Date(Date.now()-1000).toISOString(),change:'upsert',payloadRef:'synthetic-persisted-source',payloadDigest:digest('source'),
 anchorRefs:['synthetic-anchor'],responsibilityRefs:[],goalRefs:[],contractRef:contract.id,priority:'unknown',evidenceRefs:['synthetic-source-evidence']},binding);
let latest;
async function advance(delta,stage) {
 const requestId='v3-advance-'+(++sequence),value={proactiveVersion:1,operation:'advance',taskId:binding.taskId,controlRevision:binding.controlRevision,
  taskDeadline:binding.taskDeadline,...(latest?{checkpoint:latest.checkpoint}:{}),...delta};
 value.hostFrame=proofs.sign('frame',{requestId,hostAvailability:{localDevice:true,cloudPersistentHost:true},availableCapabilities:caps},binding);
 latest=await invoke(value,requestId,stage);return latest;
}
const receipt=(p,result)=>proofs.sign('receipt',{proposalId:p.proposalId,operationId:p.operationId,argumentsDigest:p.argumentsDigest,state:'confirmed',result,
 observedAt:new Date().toISOString(),evidenceRefs:['synthetic-host-readback:'+p.operationId]},binding);
let state=await advance({events:[event]},'proactive.source_frontier');assert.equal(state.proposals[0].stage,'retrieve');
let proposal=state.proposals[0];state=await advance({receipts:[receipt(proposal,{contextRef:'synthetic-context',sourceVersions:{'synthetic-connector':'v1'},
 sourceQuotes:[],goalRefs:[],memoryRefs:[],experienceRefs:[],scopeRefs:[]})]},'proactive.context_receipt');
assert.equal(state.proposals[0].stage,'laya');proposal=state.proposals[0];
state=await advance({receipts:[receipt(proposal,{selections:proposal.itemIds.map(itemId=>({itemId,candidateId:'research',decisionRef:'synthetic-laya-result',
 decidedBy:'laya',uncertain:false,complex:false,importance:'normal',authorityRequired:false}))})]},'proactive.laya_fixture_receipt');
assert.equal(state.proposals[0].stage,'teacher');
state=await advance({control:proofs.sign('control',{commandId:'v3-unattended',action:'enter_unattended',evidenceRefs:['synthetic-user-mode-evidence']},binding)},'proactive.unattended');
assert.equal(state.mode,'unattended');
state=await advance({control:proofs.sign('control',{commandId:'v3-return',action:'return',evidenceRefs:['synthetic-return-evidence']},binding)},'proactive.return');
assert.equal(state.returnSummary.replayedNotifications,0);assert.equal(state.proposals.length,0);
const requestId='v3-forged-frame',forged={proactiveVersion:1,operation:'advance',taskId:binding.taskId,controlRevision:1,taskDeadline:binding.taskDeadline,checkpoint:latest.checkpoint,
 hostFrame:proofs.sign('frame',{requestId,hostAvailability:{localDevice:true,cloudPersistentHost:true},availableCapabilities:caps},binding)};
forged.hostFrame.hostAvailability.localDevice=false;await invoke(forged,requestId,'proactive.reject_tampered_frame',401);
assert.equal(attemptedExternalCalls,0);assert.ok(state.timeline.every(t=>Number.isFinite(t.wallMs)&&t.startedAtUtc&&t.finishedAtUtc));
console.log(JSON.stringify({architecture:process.arch,uid:process.getuid(),ping:ping.status,workflowCount:catalog.workflowBindings.length,nodeCount:catalog.designCoverage.nodeCount,
 proactive:{descriptor:description.descriptor.id,entries:description.descriptor.entries,frontierStages:['retrieve','laya','teacher'],mode:state.mode,
  returnSummary:state.returnSummary,verification:state.verification,timeline:state.timeline},timings,
 productionModelRoute:'agentarts-proxy',syntheticEndpoint:'https://proxy.synthetic.invalid/inference/v1',syntheticKeyHeader:'x-test-key',
 missingPlatformPortsExplicit:true,attemptedExternalCalls,realModelCalls:0,actualConnectorCalls:0,actualDeviceCalls:0,
 syntheticDecisionReceipts:true,platformConnected:false,published:false}));process.exit(0);
`;
const {stdout}=await run(config.docker,['run','--rm','--platform','linux/arm64','--network','none','--entrypoint','node',config.image,'--input-type=module','-e',script],{maxBuffer:2*1024*1024});
const result=JSON.parse(stdout.trim().split(/\r?\n/).at(-1));assert.equal(result.architecture,'arm64');assert.equal(result.uid,1000);
const receipt={kind:'test_image_v3_services_smoke',image:config.image,imageId:inspected.Id,sizeBytes:inspected.Size,network:'none',
 startedAtUtc,finishedAtUtc:new Date().toISOString(),wallMs:performance.now()-started,startupRejections:negativeResults,result};
await writeFile(config.output,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));

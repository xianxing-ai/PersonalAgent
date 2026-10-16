// Actual ARM64 image / production entry, synthetic receipts, no model or platform calls.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
const config=JSON.parse(Buffer.concat(chunks).toString('utf8')),run=promisify(execFile);
const script=String.raw`
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {deriveOwnedWorkflowKeys,OwnedWorkflowHostBridge} from '@personal-agent/agentarts';
import {signWorkflowShadowRequest,signWorkflowShadowIsolationReceipt,verifyWorkflowShadowResponse,workflowTraceDigest}
 from './apps/agentarts-runtime/src/shadow-controller.mjs';
const token=randomBytes(32).toString('hex'),keys=deriveOwnedWorkflowKeys({transportToken:token});
const file='/tmp/image-services-smoke.json';
await writeFile(file,JSON.stringify({shadowPolicy:{
 sampling:{base:1,min:0,max:1,adjustmentRate:0.2,minimumVerifiedSamples:1},
 comparison:{qualityWeight:1,wallMsWeight:0,modelCallWeight:0}}}));
Object.assign(process.env,{PA_AGENT_HOST_MODE:'agentarts',PA_AGENT_LAYA_MODE:'local',
 PA_AGENT_MODEL_BASE_URL:'https://synthetic.invalid/v1',PA_AGENT_MODEL:'synthetic-no-model-call',
 PA_AGENT_MODEL_API_KEY:'synthetic-no-account',PA_AGENT_WSS_AUTH_TOKEN:token,PA_AGENT_SERVICES_CONFIG_FILE:file});
const originalFetch=globalThis.fetch;let attemptedExternalCalls=0;
globalThis.fetch=(input,init)=>{
 const url=String(input);if(!url.startsWith('http://127.0.0.1:8080/')){attemptedExternalCalls++;throw Error('Network forbidden in this smoke');}
 return originalFetch(input,init);
};
await import('./apps/agentarts-runtime/src/main.mjs');
let ping;for(let attempt=0;attempt<100;attempt++){
 try{ping=await fetch('http://127.0.0.1:8080/ping');if(ping.ok)break;}catch{}
 await new Promise(resolve=>setTimeout(resolve,50));
}
assert.equal(ping?.status,200);
const taskDeadline=new Date(Date.now()+120000).toISOString(),sessionId='smoke-session',requestId='smoke-request';
const invoke=async value=>{
 const response=await fetch('http://127.0.0.1:8080/invocations',{method:'POST',
 headers:{'content-type':'application/json','x-pa-agent-token':'Bearer '+token,
 'x-hw-agentarts-session-id':sessionId,'x-request-id':requestId},
 body:JSON.stringify({query:JSON.stringify(value)})});
 const frames=await response.json();assert.equal(response.status,200,JSON.stringify(frames));
 return JSON.parse(frames[0].data.text);
};
const catalog=await invoke({workflowVersion:'1.0.0',operation:'catalog'});
assert.equal(catalog.workflowBindings.length,28);
const platform=await invoke({platformVersion:1,operation:'list'});
assert.equal(platform.status.mcp.state,'unavailable');
assert.equal(platform.status.toolExecution.state,'unavailable');
const original={workflowVersion:'1.0.0',operation:'advance',workflowId:'F20',
 taskId:'smoke-task',controlRevision:1,input:{goal:'public smoke only'},availableTools:[],taskDeadline};
let state=await invoke(original);
const bridge=new OwnedWorkflowHostBridge({receiptSecret:keys.receiptSecret,host:{},checkpoints:{},assertActive(){}});
const controls=[];
for(const [index,action] of ['pause','notify_controller','resume','request_controller','continue','request_user'].entries()){
 const hostControl=bridge.control({...original,sessionId,checkpoint:state.checkpoint},{commandId:'smoke-'+index,action});
 state=await invoke({...original,checkpoint:state.checkpoint,hostControl});
 assert.equal(state.hostControl.events.at(-1).action,action);controls.push({action,state:state.state});
}
const context={taskId:'smoke-shadow',sessionId,controlRevision:1,taskDeadline};
const tiers=[];
for(const tier of ['decision_shadow','trace_replay','isolated']){
 const isolation=tier==='isolated'?signWorkflowShadowIsolationReceipt({receiptSecret:keys.receiptSecret,context,
  snapshotDigest:'a'.repeat(64),namespace:'synthetic-isolated-root'}):null;
 const value=signWorkflowShadowRequest({receiptSecret:keys.receiptSecret,value:{
  shadowVersion:1,operation:'evaluate',...context,requestId,
  plan:{taskKey:context.taskId,taskClass:'smoke-fixture',mode:'ordinary',tier,isolation,
   decision:{selectedCandidateId:'main',shadowCandidateId:'shadow',shadowRequested:true,uncertain:true,
    decisionRef:'same-selection-fixture',provenance:{decidedBy:'deepseek',deepseekProposalRef:'fixture-deepseek-receipt',
    layaDecisionRef:'fixture-laya-receipt',layaQualified:false,uncertaintyResolved:true}}},
  resources:{mainPriorityAvailable:true,shadowAllowed:true,taskValueEligible:true,advancedEnabled:true},observedBranches:[],historySnapshot:null}});
 const response=await invoke(value);
 const result=verifyWorkflowShadowResponse({receiptSecret:keys.receiptSecret,response,request:value,currentContext:context});
 assert.equal(result.action,'run');assert.equal(result.actualExecutionVerified,false);
 assert.equal(result.comparison.status,'unknown');assert.equal(result.decisionProvenance.decidedBy,'deepseek');
 tiers.push({tier,action:result.action,comparison:result.comparison.status,actualExecutionVerified:false});
}
const sourceVersions={workspace:'frozen-smoke-v1'},args={path:'public.txt'},historicalResult={content:'recorded fixture'};
const record={recordId:'smoke-original-tool-evidence',kind:'tool',observedAt:new Date(Date.now()-2000).toISOString(),
 sourceVersions,state:'confirmed',toolName:'workspace.read_text',toolVersion:'1.0.0',arguments:args,
 argumentsDigest:workflowTraceDigest(args),result:historicalResult,resultDigest:workflowTraceDigest(historicalResult),
 evidenceRefs:['synthetic-original-evidence'],effect:'read'};
const action=(actionId,argumentsValue)=>({actionId,toolName:record.toolName,toolVersion:record.toolVersion,
 arguments:argumentsValue,argumentsDigest:workflowTraceDigest(argumentsValue),sourceVersions});
const replayRequest=signWorkflowShadowRequest({receiptSecret:keys.receiptSecret,value:{
 shadowVersion:1,operation:'replay',...context,requestId,
 snapshot:{asOf:new Date(Date.now()-1000).toISOString(),sourceVersions,records:[record]},
 requestedActions:[action('exact',args),action('new',{path:'unseen.txt'})]}});
const replayResponse=await invoke(replayRequest);
const replay=verifyWorkflowShadowResponse({receiptSecret:keys.receiptSecret,response:replayResponse,request:replayRequest,currentContext:context});
assert.equal(replay.actions[0].state,'reused_historical_read');assert.equal(replay.actions[1].state,'counterfactual_unknown');
assert.equal(replay.actualToolCalls,0);assert.equal(replay.actualModelCalls,0);
assert.equal(attemptedExternalCalls,0);
console.log(JSON.stringify({architecture:process.arch,uid:process.getuid(),ping:ping.status,
 workflowCount:catalog.workflowBindings.length,nodeCount:catalog.designCoverage.nodeCount,controls,tiers,
 replay:{states:replay.actions.map(action=>action.state),actualToolCalls:replay.actualToolCalls,authority:replay.authority},
 missingPlatformPortsExplicit:true,syntheticModelDecisionReceipts:true,attemptedExternalCalls,realModelCalls:0,
 advancedExecutionVerified:false,platformConnected:false,published:false}));process.exit(0);
`;
const inspected=JSON.parse((await run(config.docker,['image','inspect',config.image])).stdout)[0];
assert.equal(inspected.Architecture,'arm64');
const {stdout}=await run(config.docker,['run','--rm','--platform','linux/arm64','--network','none',
 '--entrypoint','node',config.image,'--input-type=module','-e',script],{maxBuffer:2*1024*1024});
const result=JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
assert.equal(result.architecture,'arm64');assert.equal(result.uid,1000);
const receipt={kind:'test_image_v2_services_smoke',image:config.image,imageId:inspected.Id,sizeBytes:inspected.Size,result};
await writeFile(config.output,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));

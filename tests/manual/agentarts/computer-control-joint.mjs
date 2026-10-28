// Explicit live joint acceptance. Uses the unmodified released image over a
// trusted loopback transport, real remote inference, original Runtime/Policy,
// and a real visible owned browser. Only the local page/data are synthetic.
// The model route must be recorded: a test ModelPort adapter is not a new cloud deployment.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as playwright from 'playwright';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication} from '@personal-agent/runtime/application';
import {deriveOwnedWorkflowKeys} from '@personal-agent/agentarts';
import {createBrowserControlHost} from '../../../apps/desktop/electron/browser-control-host.js';
import {createComputerControlLease} from '../../../apps/desktop/electron/computer-control-lease.js';

const imageUrl=new URL(process.env.PA_JOINT_IMAGE_URL??''),token=process.env.PA_JOINT_IMAGE_TOKEN;
assert.equal(imageUrl.protocol,'http:');assert.equal(imageUrl.hostname,'127.0.0.1');
assert.ok(typeof token==='string'&&token.length>=32);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const runId=randomUUID(),directory=path.join(root,'.cache/computer-control-joint',runId);
await mkdir(directory,{recursive:true});
const note='joint-image-'+runId,value='Saved fixture: '+note;
const pageServer=createServer((request,response)=>{
  if(request.url!=='/'){response.writeHead(404);response.end();return;}
  response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
  response.end('<!doctype html><meta charset="utf-8"><title>PersonalAgent new image joint acceptance</title>'
    +'<h1>Synthetic joint acceptance</h1><label>Note <input aria-label="Note" type="text"></label>'
    +'<button type="button">Add note</button><p id="result">No note yet</p>'
    +'<script>document.querySelector("button").onclick=()=>document.querySelector("#result").textContent="Saved fixture: "+document.querySelector("input").value</script>');
});
await new Promise(resolve=>pageServer.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+pageServer.address().port;
let app,context,taskId,finalTask;const controller=new AbortController(),requests=[],approvals=[],permissions=[],progress=[];
const lifetime=new Date(Date.now()+1800000).toISOString();
const driver={chromium:{launchPersistentContext:async(profile,options)=>{
  context=await playwright.chromium.launchPersistentContext(profile,{...options,channel:'msedge'});return context;}}};
const browser=createBrowserControlHost({userDataPath:path.join(directory,'browser-profile'),playwright:driver,
  testOnlyAllowedOrigins:[origin],authorizePresence:async scope=>{
    const current=taskId??scope.taskId;
    const allowed=scope.taskId===current&&(!scope.origin||scope.origin===origin)&&!controller.signal.aborted;
    permissions.push({taskId:scope.taskId,phase:scope.phase,allowed});return allowed;
  }});
const lease=createComputerControlLease({getRuntime:()=>app?.runtime});
const report={recordedAt:new Date().toISOString(),profile:'huawei_ict_agentarts',
  image:process.env.PA_JOINT_IMAGE_REFERENCE,sourceOverlay:false,imageExecution:'local_linux_arm64_released_image',
  modelRoute:process.env.PA_JOINT_MODEL_ROUTE,modelDeployment:process.env.PA_JOINT_MODEL_DEPLOYMENT,
  newImagePlatformDeployment:'not_run',remoteInferenceEvidence:'separate_actual_model_proxy_receipt_required',realBrowser:false,realRuntimePolicyGateway:false,
  fixture:'isolated_local_synthetic_page',decisions:'synthetic_allow_once_through_original_Runtime',
  screenshotsSentToModel:false,modelVision:'unavailable_in_current_text_port',status:'running'};
try{
  app=createAgentArtsRuntimeApplication({path:path.join(directory,'runtime.sqlite'),
    gatewayUrl:'https://local-joint-image.invalid',runtimeName:'released-joint-image',
    responseMode:'tool-proposal-json',initialRequestMode:'goal-with-tools-json',continuationContext:'goal',competitionMaxSteps:32,
    tools:lease.wrapTools(browser.tools),competitionToolAvailability:browser.competitionToolAvailability,
    competitionToolExports:browser.competitionToolExports,isUserPresent:()=>true,
    authorizationProvider:{read:async()=> 'Bearer '+token},fetchHandlesHostAuthorization:true,
    readOwnedWorkflowReceiptSecret:async()=>deriveOwnedWorkflowKeys({transportToken:token}).receiptSecret,
    fetchImpl:async(input,init)=>{
      const source=new URL(String(input));assert.equal(source.hostname,'local-joint-image.invalid');
      assert.match(source.pathname,/\/invocations$/);
      const headers=new Headers(init.headers);headers.set('x-pa-agent-token','Bearer '+token);
      const started=Date.now(),id=headers.get('x-request-id');
      const response=await fetch(new URL('/invocations',imageUrl),{...init,headers,redirect:'error'});
      requests.push({requestId:id,status:response.status,wallMs:Date.now()-started});
      console.log(JSON.stringify({stage:'new-image-response',requestId:id,status:response.status}));return response;
    }});
  browser.bind({runtime:app.runtime});report.realRuntimePolicyGateway=true;
  const client=new Client(app);await client.connect();
  const submitted=await client.call('task.submit',{
    goal:'请用 browser 工具完成这个真实浏览器合成任务。仅操作 '+origin+' 这一页：打开它，在 Note 输入框填写“'+note
      +'”，点击 Add note，读取页面出现的 Saved fixture: '+note+'，然后保存该页面视口截图到本机，最后在回答中报告实际读回的完整结果。'
      +'先 browser.open 获得当前 targetRef/控件 ref；每步只使用最近返回的新引用。不要访问其他来源，不操作任何用户账号或本机其它应用。'
      +'截图产物仅本机保存，你没有图像视觉输入能力。只有实际工具读回才能证明完成，不要描述未执行的动作。',
    conversationId:'new-image-computer-joint-synthetic'},
    {idempotencyKey:'computer-joint-'+runId,timeoutMs:1800000});
  taskId=submitted.taskId;report.taskId=taskId;
  const handled=new Set();let lastState;
  while(Date.now()<Date.parse(lifetime)){
    const task=app.runtime.getTask(taskId);
    if(task.state!==lastState){lastState=task.state;progress.push({state:task.state,at:new Date().toISOString()});
      console.log(JSON.stringify({stage:'original-runtime',taskId,state:task.state}));}
    if(['succeeded','failed','cancelled','waiting_reconciliation'].includes(task.state)){finalTask=task;break;}
    for(const approval of (await client.call('approval.list',{taskId})).items){
      if(approval.state!=='pending'||handled.has(approval.approvalId))continue;
      assert.equal(approval.taskId,taskId);assert.ok(browser.tools.some(tool=>tool.descriptor.name===approval.action));handled.add(approval.approvalId);
      approvals.push({approvalId:approval.approvalId,toolName:approval.action,revision:approval.revision});
      await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(finalTask,'Original task must settle by its own deadline');
  report.taskState=finalTask.state;report.taskError=finalTask.error;
  assert.equal(finalTask.state,'succeeded',JSON.stringify(finalTask.error));
  assert.ok(context,'The model must actually open its owned browser');
  const page=context.pages().find(page=>page.url().startsWith(origin));assert.ok(page);
  const independentReadback=await page.locator('#result').innerText();assert.equal(independentReadback,value);
  const runs=app.runtime.readToolExecutions(taskId),names=runs.filter(run=>run.state==='confirmed').map(run=>run.toolName);
  for(const name of ['browser.open','browser.type','browser.click','browser.screenshot'])assert.ok(names.includes(name),'Missing original confirmed '+name);
  assert.ok(runs.every(run=>run.policyDecision==='allow'&&run.state==='confirmed'&&run.executionStarted===true));
  assert.ok(approvals.length>=4);assert.equal(lease.snapshot().writeBlocked,false);
  const evidence=app.runtime.readEvidence(taskId);assert.equal(evidence.length,runs.length);
  assert.ok(evidence.every(item=>item.verification==='conditional'));
  const lastScreenshot=runs.findLast(run=>run.toolName==='browser.screenshot');
  const screenshot=app.runtime.loadCheckpoint(taskId,'tool-result-'+lastScreenshot.evidenceId);
  const artifact=screenshot?.artifact??screenshot?.result?.artifact;assert.ok(artifact?.artifactId);
  const bytes=await browser.readScreenshotArtifact({artifactId:artifact.artifactId,taskId,signal:controller.signal,deadline:lifetime});
  assert.deepEqual([...bytes.bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  await writeFile(path.join(directory,'synthetic-browser.png'),bytes.bytes);
  report.status='passed';report.independentReadback=independentReadback;
  report.checks={modelSelectedActualBrowserTools:true,exactOriginalApprovals:true,realDomGoalReadback:true,
    realWindowScreenshotSavedLocally:true,noImageSentToTextModel:true,originalRuntimeRuns:true,conditionalEvidence:true,sharedLeaseReleased:true};
  report.artifact={artifactId:artifact.artifactId,sha256:artifact.sha256,mimeType:artifact.mimeType};
  report.runs=runs.map(({evidenceId,toolName,state,policyDecision,executionStarted})=>({evidenceId,toolName,state,policyDecision,executionStarted}));
  report.evidenceCount=evidence.length;
}catch(error){report.status='failed';report.failure={code:typeof error.code==='string'?error.code:'ACCEPTANCE_FAILURE',message:error.message};
  console.error(JSON.stringify({stage:'joint-acceptance',status:'failed',...report.failure}));process.exitCode=1;
}finally{
  report.requests=requests;report.approvals=approvals;report.permissions=permissions;report.progress=progress;
  report.realBrowser=Boolean(context);
  if(app&&taskId&&!['succeeded','failed','cancelled','waiting_reconciliation'].includes(app.runtime.getTask(taskId).state))
    await app.send({kind:'request',protocolVersion:'1.0.0',requestId:randomUUID(),operation:'task.cancel',deadline:lifetime,
      payload:{taskId,reason:'Joint acceptance cleanup'}},controller.signal).catch(()=>{});
  await browser.close().then(()=>report.ownedBrowserClosed=true,error=>{report.ownedBrowserClosed=false;report.cleanupError=error.code??'EXTERNAL_FAILURE';process.exitCode=1;});
  controller.abort();lease.close();
  if(app){for(let tries=0;app.activeTaskCount&&tries<100;tries++)await new Promise(resolve=>setTimeout(resolve,50));
    try{app.close();report.runtimeClosed=true;}catch(error){report.runtimeClosed=false;report.cleanupError=error.code??'EXTERNAL_FAILURE';process.exitCode=1;}}
  await new Promise(resolve=>pageServer.close(resolve));report.finishedAt=new Date().toISOString();
  const receiptPath=path.join(directory,'receipt.json');await writeFile(receiptPath,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({stage:'joint-acceptance',status:report.status,receiptPath,taskId:report.taskId,taskState:report.taskState,
    requests:requests.length,approvals:approvals.length,ownedBrowserClosed:report.ownedBrowserClosed,runtimeClosed:report.runtimeClosed}));
}

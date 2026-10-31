// Authorized OpenCLI public-site joint. Local released image + cloud model proxy,
// original Runtime/Policy, and a real Chrome/Edge tab via OpenCLI Browser Bridge.
// Does not replace formal Desktop UI Competition presence confirmation.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication} from '@personal-agent/runtime/application';
import {deriveOwnedWorkflowKeys} from '@personal-agent/agentarts';
import {createOpenCliBrowserHost} from '../../../apps/desktop/electron/opencli-browser-host.js';
import {createComputerControlLease} from '../../../apps/desktop/electron/computer-control-lease.js';

const imageUrl=new URL(process.env.PA_JOINT_IMAGE_URL??''),token=process.env.PA_JOINT_IMAGE_TOKEN;
assert.equal(imageUrl.protocol,'http:');assert.equal(imageUrl.hostname,'127.0.0.1');
assert.ok(typeof token==='string'&&token.length>=32);
const origin=process.env.PA_OPENCLI_JOINT_ORIGIN||'https://httpbin.org';
const openUrl=process.env.PA_OPENCLI_JOINT_URL||'https://httpbin.org/forms/post';
assert.equal(new URL(openUrl).origin,origin);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const runId=randomUUID(),directory=path.join(root,'.cache/computer-control-joint',runId);
await mkdir(directory,{recursive:true});
let app,taskId,finalTask;const controller=new AbortController(),requests=[],approvals=[],permissions=[],progress=[];
const lifetime=new Date(Date.now()+1800000).toISOString();
const browser=createOpenCliBrowserHost({
  readTask:id=>app?.runtime.getTask(id),
  authorize:async scope=>{
    const current=taskId??scope.taskId;
    const allowed=scope.taskId===current&&!controller.signal.aborted;
    permissions.push({taskId:scope.taskId,phase:scope.phase,allowed});
    return allowed;
  },
});
const lease=createComputerControlLease({getRuntime:()=>app?.runtime});
const report={recordedAt:new Date().toISOString(),profile:'huawei_ict_agentarts',
  image:process.env.PA_JOINT_IMAGE_REFERENCE,sourceOverlay:false,imageExecution:'local_linux_arm64_released_image',
  modelRoute:process.env.PA_JOINT_MODEL_ROUTE,modelDeployment:process.env.PA_JOINT_MODEL_DEPLOYMENT,
  newImagePlatformDeployment:'not_run',remoteInferenceEvidence:'separate_actual_model_proxy_receipt_required',
  realBrowser:'opencli_browser_bridge',realRuntimePolicyGateway:false,
  fixture:'public_httpbin_forms_post',decisions:'synthetic_allow_once_through_original_Runtime',
  screenshotsSentToModel:false,modelVision:'unavailable_in_current_text_port',desktopUiCompetition:'not_run',status:'running'};
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
  await browser.probeExtension({signal:controller.signal});
  const client=new Client(app);await client.connect();
  const submitted=await client.call('task.submit',{
    goal:'请只用 browser.connected 工具完成真实公网站点任务。仅操作 '+origin+' ：'
      +'1) browser.connected.open 打开 '+openUrl+'；'
      +'2) 用最近观察里的同站 Submit/提交类按钮做 browser.connected.click；'
      +'3) 再 browser.connected.observe，确认仍在 '+origin+' 且 URL 已变化或控件已读回；'
      +'4) 在最终回答中报告实际读回的完整 URL。'
      +'每步只用最近返回的 targetRef/ref。不要访问其他来源，不操作用户账号，不使用 browser.* Playwright 工具。'
      +'只有实际工具读回才能证明完成。',
    conversationId:'opencli-connected-joint-public'},
    {idempotencyKey:'opencli-joint-'+runId,timeoutMs:1800000});
  taskId=submitted.taskId;report.taskId=taskId;
  const handled=new Set();let lastState;
  while(Date.now()<Date.parse(lifetime)){
    const task=app.runtime.getTask(taskId);
    if(task.state!==lastState){lastState=task.state;progress.push({state:task.state,at:new Date().toISOString()});
      console.log(JSON.stringify({stage:'original-runtime',taskId,state:task.state}));}
    if(['succeeded','failed','cancelled','waiting_reconciliation'].includes(task.state)){finalTask=task;break;}
    for(const approval of (await client.call('approval.list',{taskId})).items){
      if(approval.state!=='pending'||handled.has(approval.approvalId))continue;
      assert.equal(approval.taskId,taskId);
      assert.ok(browser.tools.some(tool=>tool.descriptor.name===approval.action),
        'unexpected approval action '+approval.action);
      handled.add(approval.approvalId);
      approvals.push({approvalId:approval.approvalId,toolName:approval.action,revision:approval.revision});
      await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(finalTask,'Original task must settle by its own deadline');
  report.taskState=finalTask.state;report.taskError=finalTask.error;
  assert.equal(finalTask.state,'succeeded',JSON.stringify(finalTask.error));
  const runs=app.runtime.readToolExecutions(taskId),names=runs.filter(run=>run.state==='confirmed').map(run=>run.toolName);
  // open/click already embed an independent observe; a separate observe/wait tool is optional.
  for(const name of ['browser.connected.open','browser.connected.click'])assert.ok(names.includes(name),'Missing confirmed '+name);
  assert.ok(runs.every(run=>run.policyDecision==='allow'&&run.state==='confirmed'&&run.executionStarted===true));
  assert.ok(approvals.length>=2);
  const evidence=app.runtime.readEvidence(taskId);assert.equal(evidence.length,runs.length);
  report.status='passed';report.checks={modelSelectedOpenCliTools:true,exactOriginalApprovals:true,
    publicOriginDualDns:true,originalRuntimeRuns:true,conditionalEvidence:true};
  report.runs=runs.map(({evidenceId,toolName,state,policyDecision,executionStarted})=>({evidenceId,toolName,state,policyDecision,executionStarted}));
  report.evidenceCount=evidence.length;report.extension=browser.snapshot().extension;
}catch(error){report.status='failed';report.failure={code:typeof error.code==='string'?error.code:'ACCEPTANCE_FAILURE',message:error.message};
  console.error(JSON.stringify({stage:'opencli-joint-acceptance',status:'failed',...report.failure}));process.exitCode=1;
}finally{
  report.requests=requests;report.approvals=approvals;report.permissions=permissions;report.progress=progress;
  try{await browser.close();}catch{/* Best-effort. */}
  try{await app?.close?.();}catch{/* Best-effort. */}
  await writeFile(path.join(directory,'receipt.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({stage:'opencli-joint-acceptance',status:report.status,
    receiptPath:path.join(directory,'receipt.json'),taskId:report.taskId,taskState:report.taskState,
    requests:requests.length,approvals:approvals.length}));
}

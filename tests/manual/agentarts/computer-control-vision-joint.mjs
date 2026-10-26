// LIVE acceptance export, deliberately inert on import. Invoke only from the trusted
// Electron helper with real safeStorage and credentials supplied in memory.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as playwright from 'playwright';
import {Client} from '@personal-agent/client';
import {TaskRuntime} from '@personal-agent/runtime';
import {AuthorizationPolicy} from '@personal-agent/policy';
import {AuthorizationQuestions,createAgentArtsRuntimeApplication,createConfiguredSubagentModelGateway} from '@personal-agent/runtime/application';
import {deriveOwnedWorkflowKeys} from '@personal-agent/agentarts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createWindowsNativeDesktopControlHost} from '@personal-agent/windows-client';
import {createBrowserControlHost} from '../../../apps/desktop/electron/browser-control-host.js';
import {createDesktopWindowsControlHost} from '../../../apps/desktop/electron/windows-control-host.js';
import {createComputerControlLease} from '../../../apps/desktop/electron/computer-control-lease.js';
import {createToolPresenceHost} from '../../../apps/desktop/electron/tool-presence-host.js';
import {createDesktopAuthorizationQuestionHost} from '../../../apps/desktop/electron/authorization-question-host.js';
import {createComputerVisionConfig} from '../../../apps/desktop/electron/computer-vision-config.js';
import {createComputerVisionHost} from '../../../apps/desktop/electron/computer-vision-host.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const terminal=new Set(['succeeded','failed','cancelled','waiting_reconciliation']);
const safeLabel=value=>typeof value==='string'&&/^[A-Za-z0-9_./:@ -]{1,240}$/u.test(value)?value:'unavailable';

export async function runComputerControlVisionJoint({safeStorage,modelConfig,imageUrl,token,imageReference,modelDeployment}){
  const id=randomUUID(),directory=path.join(root,'.cache','computer-control-vision-joint',id);
  const controller=new AbortController(),deadline=new Date(Date.now()+1_800_000).toISOString();
  const expected=Array.from(randomBytes(8),byte=>String.fromCharCode(65+byte%26)).join('');
  const allowedNames=new Set(['computer.request_access','browser.open','browser.observe','browser.screenshot','computer.vision.inspect']);
  const plannerRequests=[],visionRequests=[],permissions=[],progress=[],sourceReads=[],authorizationDecisions=[];
  let app,desktop,browser,context,question,presence,lease,configuration,vision,server,taskId,finalTask,origin;
  let stage='preflight',finalRuns=[],finalEvidence=[],screenshot,visionObservation,contextClosed=false;
  const report={schemaVersion:1,recordedAt:new Date().toISOString(),profile:'huawei_ict_agentarts',status:'not_run',
    image:safeLabel(imageReference),sourceOverlay:false,imageExecution:'local_linux_arm64_released_image',
    modelDeployment:safeLabel(modelDeployment),newImagePlatformDeployment:'not_run',
    decisions:'synthetic_full_access_profile_through_original_Desktop_AuthorizationQuestions',
    presence:'production_createToolPresenceHost_full_access_original_task_conversation_binding',
    fixture:'owned_isolated_Edge_canvas_only_random_marker_and_three_colored_shapes',
    evidenceVerification:'conditional',limitations:[
      'Local released-image execution is not a newly deployed AgentArts platform resource.',
      'Synthetic full-access profile decisions are test configuration; the original Runtime/Policy and exact authorization receipts remain active.',
      'The original Runtime tool Evidence remains conditional; correct vision is independently checked against a random marker unknown to the goal.',
      'Planner requests contain no pixels; the marker may enter later continuations only after a confirmed original vision result.']};
  const runtimeRuns=()=>taskId?app.runtime.readToolExecutions(taskId):[];
  const safeFailure=error=>({code:typeof error?.code==='string'?error.code:'ACCEPTANCE_FAILURE',
    message:String(error?.message??error??'Unknown failure').replaceAll(modelConfig?.apiKey??'__absent_key__','[credential redacted]')
      .replaceAll(token??'__absent_token__','[credential redacted]').replace(/data:image\/[^\s"']+/gu,'[image redacted]').slice(0,2000)});
  const confirmed=(name)=>runtimeRuns().filter(run=>run.state==='confirmed'&&run.policyDecision==='allow'&&run.executionStarted&&run.toolName===name);
  const resultOf=run=>app.runtime.loadCheckpoint(taskId,'tool-result-'+run.evidenceId)?.result;
  function originalScreenshot(){
    const runs=confirmed('browser.screenshot');assert.equal(runs.length,1,'Exactly one original confirmed screenshot is required');
    const artifact=resultOf(runs[0])?.artifact;assert(artifact?.artifactId&&artifact.sha256);return {run:runs[0],artifact};
  }
  function assertProposal(scope){
    assert.equal(scope.taskId,taskId);assert(allowedNames.has(scope.proposal.toolName));
    const {toolName,arguments:args}=scope.proposal;
    assert(!JSON.stringify(args).includes(expected),'Expected random marker must not be injected into tool arguments');
    if(toolName==='browser.open')assert.equal(args.url,origin+'/');
    if(toolName==='browser.screenshot'){
      const observations=runtimeRuns().filter(run=>run.state==='confirmed'&&['browser.open','browser.observe'].includes(run.toolName)).map(resultOf);
      assert(observations.some(item=>item?.targetRef===args.targetRef),'Screenshot must use a real observed target');
    }
    if(toolName==='computer.vision.inspect'){
      const original=originalScreenshot();assert.equal(args.driver,'browser');assert.equal(args.artifactId,original.artifact.artifactId);assert.equal(args.sha256,original.artifact.sha256);
    }
  }
  try{
    assert.equal(process.platform,'win32');assert.equal(safeStorage?.isEncryptionAvailable(),true,'Real Electron safeStorage must be available');
    assert(modelConfig&&typeof modelConfig.apiKey==='string'&&modelConfig.apiKey.length>0,'Trusted in-memory vision credentials are required');
    const selected={source:modelConfig.source??'agentarts-proxy',baseUrl:modelConfig.baseUrl,model:modelConfig.model??'deepseek-v4.1-flash'};
    assert.equal(selected.source,'agentarts-proxy');assert.equal(typeof selected.baseUrl,'string');
    const transport=new URL(imageUrl);assert.equal(transport.protocol,'http:');assert.equal(transport.hostname,'127.0.0.1');
    assert.equal(transport.username,'');assert.equal(transport.password,'');assert.equal(transport.search,'');assert.equal(transport.hash,'');
    assert.equal(typeof token,'string');assert(token.length>=32);assert.notEqual(report.image,'unavailable');
    assert.notEqual(report.modelDeployment,'unavailable');
    await mkdir(directory,{recursive:true});
    // The visible DOM/AX has no text carrying the marker. The script only stores
    // character codes; no observation API reads script source or canvas pixels.
    const pageHtml='<!doctype html><html><meta charset="utf-8"><title>Synthetic canvas vision fixture</title>'
      +'<style>html,body{margin:0;background:#fff}canvas{display:block}</style><body><canvas width="1000" height="640" aria-label="Synthetic visual task"></canvas>'
      +'<script>const c=document.querySelector("canvas"),x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,1000,640);'
      +'x.fillStyle="#111";x.font="bold 78px monospace";x.textBaseline="top";x.fillText(String.fromCharCode('+Array.from(expected,ch=>ch.charCodeAt(0)).join(',')+'),70,65);'
      +'x.fillStyle="#db202c";x.fillRect(90,270,135,135);x.fillStyle="#1775d1";x.beginPath();x.arc(440,338,75,0,Math.PI*2);x.fill();'
      +'x.fillStyle="#20a348";x.beginPath();x.moveTo(730,250);x.lineTo(820,420);x.lineTo(640,420);x.closePath();x.fill();</script></body></html>';
    assert(!pageHtml.includes(expected));
    server=createServer((request,response)=>{if(request.url!=='/'){response.writeHead(204);response.end();return;}
      response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"});response.end(pageHtml);});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    origin='http://127.0.0.1:'+server.address().port;
    const conversationId='synthetic-vision-'+id;
    question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>app,
      namespace:'synthetic-vision-'+id,resolveConversation:()=>conversationId,available:()=>true,
      profiles:[{ref:'synthetic-full-access',label:'Synthetic acceptance full access',mode:'full-access',revision:1,available:true}],defaultProfileRef:'synthetic-full-access'});
    const policyBinding=()=>JSON.stringify(['synthetic-full-access',question.sandboxSnapshot().selected.mode,question.sandboxSnapshot().selected.revision]);
    presence=createToolPresenceHost({registerNativeShortcut:()=>{throw Error('Synthetic full-access must never request a native gesture');},
      isTaskCurrent:current=>!!app&&['pending','running','waiting_approval'].includes(app.runtime.getTask(current).state)&&!controller.signal.aborted,
      readTaskBinding:current=>app?.runtime.getTask(current).conversationId,isFullAccess:()=>question.automaticallyApproves(),readPolicyBinding:policyBinding,onPrompt:()=>{}});
    desktop=createDesktopWindowsControlHost({createControlHost:createWindowsNativeDesktopControlHost,presenceHost:presence,
      isFullAccess:()=>question.automaticallyApproves(),readPolicyBinding:policyBinding,
      readTaskBinding:current=>app?.runtime.getTask(current).conversationId,allowObservationExport:true,
      providerOptions:{executable:path.join(root,'apps/windows-host/desktop/bin/Release/net8.0-windows/WindowsHost.Desktop.exe'),
        artifactDirectory:path.join(directory,'native-artifacts')}});
    await desktop.start({signal:controller.signal,deadline});assert.equal(desktop.snapshot().available,true);
    const realDriver={chromium:{async launchPersistentContext(profile,options){
      assert.equal(options.headless,false);assert.equal(options.acceptDownloads,false);assert(!path.relative(directory,profile).startsWith('..'));
      context=await playwright.chromium.launchPersistentContext(profile,{...options,channel:'msedge'});context.once('close',()=>{contextClosed=true;});return context;
    }}};
    browser=createBrowserControlHost({userDataPath:path.join(directory,'browser-profile'),playwright:realDriver,testOnlyAllowedOrigins:[origin],
      isFullAccess:()=>question.automaticallyApproves(),async authorizePresence(scope){
        assert.equal(scope.taskId,taskId);assert(!scope.origin||scope.origin===origin);
        if(scope.phase!=='export')await desktop.preparePresence(scope);
        const allowed=desktop.hasPresence(scope.taskId);permissions.push({taskId:scope.taskId,phase:scope.phase,allowed});return allowed;
      }});
    configuration=createComputerVisionConfig({userData:path.join(directory,'encrypted-vision-config'),safeStorage,
      createGateway:createConfiguredSubagentModelGateway,fetchImpl:async(url,init)=>{
        assert.equal(String(url),selected.baseUrl.replace(/\/+$/u,'')+'/chat/completions');
        const body=JSON.parse(init.body);assert.equal(body.model,selected.model);assert.equal(body.stream,false);
        const parts=body.messages.flatMap(message=>Array.isArray(message.content)?message.content:[]).filter(part=>part.type==='image_url');
        assert.equal(parts.length,1);assert.match(parts[0].image_url.url,/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/u);
        const image=Buffer.from(parts[0].image_url.url.slice('data:image/png;base64,'.length),'base64'),source=originalScreenshot();
        assert.equal(hash(image),source.artifact.sha256);assert.equal(image.length,source.artifact.byteLength);assert(Buffer.byteLength(init.body,'utf8')<=5_000_000);
        assert.equal(image.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
        const text=body.messages.flatMap(message=>typeof message.content==='string'?[message.content]:message.content.filter(part=>part.type==='text').map(part=>part.text)).join('\n');
        assert(!text.includes(expected));assert(!text.includes(modelConfig.apiKey));assert(!text.includes(token));
        const response=await fetch(url,init);let responseModel='unavailable';try{responseModel=safeLabel((await response.clone().json()).model);}catch{}
        visionRequests.push({sha256:hash(image),byteLength:image.length,requestBodyByteLength:Buffer.byteLength(init.body,'utf8'),model:safeLabel(body.model),status:response.status,responseModel,
          requestId:safeLabel(response.headers.get('x-request-id')??response.headers.get('x-requestid')??response.headers.get('request-id'))});
        return response;
      }});
    configuration.configure({expectedRevision:configuration.snapshot().revision,enabled:true,...selected,apiKey:modelConfig.apiKey});assert(configuration.snapshot().available);
    vision=createComputerVisionHost({configuration,getApplication:()=>app,question,isObservationAllowed:()=>!controller.signal.aborted,
      hasPresence:current=>desktop.hasPresence(current),readArtifact:async(driver,scope)=>{
        assert.equal(driver,'browser');const result=scope.metadataOnly?await browser.readScreenshotArtifactMetadata(scope):await browser.readScreenshotArtifact(scope);
        sourceReads.push({metadataOnly:scope.metadataOnly===true,artifactId:result.artifactId,sha256:result.sha256,byteLength:result.byteLength,sourceRunId:result.runId});return result;
      }});
    lease=createComputerControlLease({getRuntime:()=>app?.runtime});
    app=createAgentArtsRuntimeApplication({path:path.join(directory,'runtime.sqlite'),hostUserNamespace:'synthetic-vision-'+id,
      gatewayUrl:'https://local-joint-vision-image.invalid',runtimeName:'released-joint-vision-image',responseMode:'tool-proposal-json',
      initialRequestMode:'goal-with-tools-json',continuationContext:'goal',competitionMaxSteps:16,
      tools:lease.wrapTools([...desktop.tools.filter(tool=>allowedNames.has(tool.descriptor.name)),...browser.tools.filter(tool=>allowedNames.has(tool.descriptor.name)),...vision.tools]),
      competitionToolAvailability:[...desktop.competitionToolAvailability.filter(item=>allowedNames.has(item.toolName)),...browser.competitionToolAvailability.filter(item=>allowedNames.has(item.toolName)),...vision.competitionToolAvailability],
      competitionToolExports:[...desktop.competitionToolExports.filter(item=>allowedNames.has(item.toolName)),...browser.competitionToolExports.filter(item=>allowedNames.has(item.toolName)),...vision.competitionToolExports],
      isUserPresent:current=>presence.isUserPresent(current),requiresToolAuthorization:()=>true,
      requestToolAuthorization:async scope=>{
        const original=app.readAuthorizationQuestionInvocation(scope.taskId,scope.runId);assert(original);
        assert.equal(original.argumentsDigest,toolArgumentsDigest(original.arguments));assert.equal(original.argumentsDigest,scope.argumentsDigest);
        const decision=await question.requestToolAuthorization(scope);
        authorizationDecisions.push({taskId:scope.taskId,runId:scope.runId,toolName:scope.toolName,argumentsDigest:scope.argumentsDigest,decision,
          source:'synthetic_full_access_original_Desktop_AuthorizationQuestions'});return decision;
      },
      prepareCompetitionToolExport:async scope=>{assertProposal(scope);
        if(scope.phase==='preflight'&&scope.proposal.toolName==='computer.vision.inspect')await desktop.prepareToolPresence(scope);
        await vision.prepareExport(scope);
        if(scope.phase==='projection'&&scope.proposal.toolName.startsWith('browser.')){
          const result=app.runtime.loadCheckpoint(scope.taskId,'tool-result-'+scope.runId)?.result;
          assert(!JSON.stringify(result).includes(expected));assert(!/data:image\/|iVBORw0KGgo/u.test(JSON.stringify(result)));
        }
      },
      authorizationProvider:{read:async()=>'Bearer '+token},fetchHandlesHostAuthorization:true,
      readOwnedWorkflowReceiptSecret:async()=>deriveOwnedWorkflowKeys({transportToken:token}).receiptSecret,
      fetchImpl:async(input,init)=>{
        const url=new URL(String(input));assert.equal(url.hostname,'local-joint-vision-image.invalid');assert.match(url.pathname,/\/invocations$/u);
        const body=String(init.body??'');assert(!/data:image\/|iVBORw0KGgo/u.test(body));assert(!body.includes(token));assert(!body.includes(modelConfig.apiKey));
        const observed=confirmed('computer.vision.inspect').map(resultOf).filter(result=>result?.state==='visual_observation');
        if(body.includes(expected))assert(observed.some(result=>result.description.includes(expected)),'Only confirmed actual vision text may carry the marker into planner continuation');
        const headers=new Headers(init.headers);headers.set('x-pa-agent-token','Bearer '+token);
        const response=await fetch(new URL('/invocations',transport),{...init,headers,redirect:'error'});
        plannerRequests.push({requestId:safeLabel(headers.get('x-request-id')),status:response.status,byteLength:Buffer.byteLength(body),sha256:hash(body),
          pixelsAbsent:true,expectedMarkerAbsentBeforeVision:observed.length===0?!body.includes(expected):true,confirmedVisionAvailable:observed.length>0});return response;
      }});
    assert(app.runtime instanceof TaskRuntime);assert(app.runtime.policy instanceof AuthorizationPolicy);desktop.bind(app);browser.bind(app);
    const client=new Client(app);await client.connect();stage='released-image-model-task';report.status='running';
    const submitted=await client.call('task.submit',{conversationId,
      goal:'请实际使用工具识别自有合成canvas画面。只访问 '+origin+'/，不访问其他来源或账户。'
        +'先用 browser.open 打开页面，得到真实 targetRef；再用 browser.screenshot 保存视口截图。页面仅canvas绘制内容，DOM文字不包含答案。'
        +'用该截图真实 artifactId 和 sha256 调用 computer.vision.inspect，driver 必须为 browser，问题为“读取图中八位大写英文字母标记，并描述三种彩色形状；看不清就说明”。'
        +'截图元数据本身不是视觉输入；只有 computer.vision.inspect 的真实结果才是识别依据。最后复述完整八位标记，并描述颜色形状。'
        +'若本机许可过期，先 computer.request_access 取得当前任务许可，成功后继续原步骤。'
        +'若targetRef已过期，先 browser.observe 重取当前引用；不要猜引用、不要读脚本、不要用其它工具或说明未执行动作。'},
    {idempotencyKey:'vision-joint-'+id,timeoutMs:1_800_000});taskId=submitted.taskId;report.taskId=taskId;
    let previous;
    while(Date.now()<Date.parse(deadline)){
      const task=app.runtime.getTask(taskId);if(task.state!==previous){previous=task.state;progress.push({state:task.state,at:new Date().toISOString()});console.log(JSON.stringify({stage:'vision-original-runtime',state:task.state,taskId}));}
      if(terminal.has(task.state)){finalTask=task;break;}await sleep(100);
    }
    assert(finalTask,'Original task must settle by its own deadline');report.taskState=finalTask.state;report.taskErrorCode=finalTask.error?.code;
    if(finalTask.error)report.taskError=safeFailure(finalTask.error);
    assert.equal(finalTask.state,'succeeded');stage='independent-random-marker-readback';
    assert(context);const page=context.pages().find(item=>item.url()===origin+'/');assert(page);
    assert.equal((await page.locator('body').innerText()).trim(),'');assert.equal(await page.locator('canvas').count(),1);
    assert(!String(await page.locator('body').ariaSnapshot()).includes(expected));
    finalRuns=runtimeRuns();finalEvidence=app.runtime.readEvidence(taskId);
    for(const name of ['browser.open','browser.screenshot','computer.vision.inspect'])assert(confirmed(name).length>=1);
    assert(finalRuns.every(run=>allowedNames.has(run.toolName)&&run.state==='confirmed'&&run.policyDecision==='allow'&&run.executionStarted));
    assert(finalEvidence.every(item=>item.verification==='conditional'));
    const visual=confirmed('computer.vision.inspect');assert.equal(visual.length,1);visionObservation=resultOf(visual[0]);
    assert.equal(visionObservation.goalVerified,false);assert.equal(visionObservation.untrustedObservation,true);
    assert(visionObservation.description.includes(expected),'Actual vision model must independently read the unpredictable marker');
    assert(finalTask.resultSummary.includes(expected),'Actual released-image planner must repeat the visual observation marker');
    screenshot=originalScreenshot().artifact;assert.equal(visionRequests.length,1);assert.equal(visionRequests[0].status,200);assert.equal(visionRequests[0].sha256,screenshot.sha256);
    assert(sourceReads.some(item=>!item.metadataOnly));assert(sourceReads.some(item=>item.metadataOnly));
    assert.equal(lease.snapshot().writeBlocked,false);
    const questionState=app.runtime.bindTrustedHostState('desktop-authorization:'+hash(JSON.stringify('synthetic-vision-'+id))).get('state');
    assert(questionState?.questions?.length>=3);
    report.authorizationQuestions=questionState.questions.filter(item=>item.taskId===taskId).map(item=>({questionId:item.questionId,runId:item.runId,
      toolName:item.toolName,state:item.state,decision:item.decision,automatic:item.automatic,argumentsDigest:item.argumentsDigest,
      requirements:item.requirements.map(({requirementId,kind,scopes,bindingDigest})=>({requirementId,kind,scopes,bindingDigest}))}));
    assert(report.authorizationQuestions.some(item=>item.toolName==='computer.vision.inspect'&&item.state==='allowed'&&item.automatic==='full-access'
      &&item.requirements.some(requirement=>requirement.requirementId==='computer-image-export'&&requirement.scopes.includes('computer:image:export'))));
    report.status='passed';report.artifact={artifactId:screenshot.artifactId,sha256:screenshot.sha256,byteLength:screenshot.byteLength,mimeType:screenshot.mimeType};
    report.result={expectedRandomMarker:expected,observedRandomMarker:expected,visionDescription:visionObservation.description,plannerSummary:finalTask.resultSummary};
    report.checks={realReleasedPlanner:true,realIsolatedEdge:true,canvasDomAndAXDoNotContainMarker:true,goalNeverIncludesExpectedMarker:true,
      actualImageUrlBytesMatchConfirmedScreenshot:true,realVisionGateway:true,realEncryptedConfiguration:true,originalAuthorizationQuestions:true,
      exactImageExportRequirement:true,beforeSendMetadataRecheck:true,independentRandomMarkerMatch:true,plannerRepeatsVisionResult:true,pixelsAbsentFromPlanner:true};
  }catch(error){report.status='failed';report.failure={stage,...safeFailure(error)};
    console.error(JSON.stringify({stage:'vision-joint-acceptance',status:'failed',...report.failure}));
  }finally{
    if(app&&taskId){if(!terminal.has(app.runtime.getTask(taskId).state))await app.send({kind:'request',protocolVersion:'1.0.0',requestId:randomUUID(),operation:'task.cancel',
      deadline:new Date(Date.now()+5000).toISOString(),payload:{taskId,reason:'Synthetic vision joint cleanup'}},new AbortController().signal).catch(()=>{});
      finalRuns=runtimeRuns();finalEvidence=app.runtime.readEvidence(taskId);report.taskState=app.runtime.getTask(taskId).state;}
    if(browser)try{await browser.close();report.ownedBrowserClosed=!context||contextClosed;}catch{report.cleanupError='BROWSER_RELEASE_UNCONFIRMED';report.status='failed';}
    controller.abort();vision?.close();configuration?.dispose();
    if(desktop)try{await desktop.close();report.ownedNativeHostClosed=true;}catch{report.cleanupError='NATIVE_RELEASE_UNCONFIRMED';report.status='failed';}
    presence?.close();question?.close();lease?.close();
    if(app){for(let tries=0;app.activeTaskCount&&tries<100;tries++)await sleep(50);try{app.close();report.runtimeClosed=true;}catch{report.cleanupError='RUNTIME_RELEASE_UNCONFIRMED';report.status='failed';}}
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    report.runs=finalRuns.map(({evidenceId,toolName,state,policyDecision,executionStarted})=>({evidenceId,toolName,state,policyDecision,executionStarted}));
    report.evidence=finalEvidence.map(({evidenceId,verification})=>({evidenceId,verification}));report.plannerRequests=plannerRequests;report.visionRequests=visionRequests;
    report.permissions=permissions;report.progress=progress;report.sourceReads=sourceReads;report.authorizationDecisions=authorizationDecisions;
    report.realBrowser=Boolean(context);report.finishedAt=new Date().toISOString();await mkdir(directory,{recursive:true});
    const receiptPath=path.join(directory,'receipt.json');await writeFile(receiptPath,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({stage:'vision-joint-acceptance',status:report.status,receiptPath,taskId,taskState:report.taskState,plannerRequests:plannerRequests.length,
      visionRequests:visionRequests.length,ownedBrowserClosed:report.ownedBrowserClosed,runtimeClosed:report.runtimeClosed}));
    return {status:report.status,receiptPath,taskId,taskState:report.taskState,artifact:report.artifact,checks:report.checks,failure:report.failure,
      cleanup:{ownedBrowserClosed:report.ownedBrowserClosed,runtimeClosed:report.runtimeClosed},visionRequests};
  }
}

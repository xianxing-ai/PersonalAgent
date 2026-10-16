import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {appendFileSync} from 'node:fs';
import {createTimingRecorder,timedProvider,chooseVerifiedIdenticalDelivery} from './wukong-test-version.mjs';
import {readFile,writeFile,mkdir,mkdtemp,realpath,stat,lstat} from 'node:fs/promises';
import {join,resolve,isAbsolute,relative} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {ModelGateway,StructuredToolProvider} from '@personal-agent/models';
import {createTestImageModelProvider} from './test-image-model-provider.mjs';
import {runAgent} from '@personal-agent/agents';
import {Client} from '@personal-agent/client';
import {TaskRuntime} from '@personal-agent/runtime';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createWorkspaceReadTool,createWorkspacePatchPreviewTool,createWorkspacePatchApplyTool,reconcileWorkspacePatchApply} from '@personal-agent/coding-tools';
import {startLayaService} from '../../../apps/agentarts-runtime/src/laya-service.mjs';
import {createOwnedLayaSelector} from '../../../apps/agentarts-runtime/src/laya-selector.mjs';
import {createAdaptiveWorkflowSelector,decisionDigest} from '../../../apps/agentarts-runtime/src/adaptive-decision.mjs';
import {createTestVersionBusinessTools} from './test-version-tools.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const fixture=fileURLToPath(new URL('./fixtures/pelican-animation-bug.svg',import.meta.url));
const checker=fileURLToPath(new URL('./check-pelican.py',import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');
const file='pelican.svg',plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const remaining=deadline=>Math.max(1,Date.parse(deadline)-Date.now());
/** Only for newly allocated test-owned recovery directories, never a user's existing workspace. */
export async function createTestPatchReconciliation({rootPath,recoveryRootPath,powerShellPath}) {
  if(process.platform!=='win32')throw Error('Windows patch recovery required');
  const pin=async(source,directory)=>{
    assert.ok(isAbsolute(source));assert.equal((await lstat(source)).isSymbolicLink(),false);
    const canonical=await realpath(source),value=await stat(canonical);
    assert.equal(directory?value.isDirectory():value.isFile(),true);
    return {source,canonical,directory,identity:{dev:value.dev,ino:value.ino,birthtimeMs:value.birthtimeMs,
      ...(directory?{}:{size:value.size,mtimeMs:value.mtimeMs})}};
  };
  const pinned=await Promise.all([pin(rootPath,true),pin(recoveryRootPath,true),pin(powerShellPath,false)]);
  const [root,recovery,pwsh]=pinned.map(item=>item.canonical);
  const inside=(parent,child)=>{const path=relative(parent,child);return !path||!path.startsWith('..')&&!isAbsolute(path);};
  assert.ok(!inside(root,recovery)&&!inside(recovery,root)&&!inside(root,pwsh)&&!inside(recovery,pwsh));
  const acl=protect=>{
    const script=`$ErrorActionPreference='Stop'\n$root=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(recovery).toString('base64')}'))\n$self=[Security.Principal.WindowsIdentity]::GetCurrent().User\n$trusted=@($self.Value,'S-1-5-18','S-1-5-32-544')\n$acl=Get-Acl -LiteralPath $root\n`+
      (protect?`$acl.SetOwner($self)\n$acl.SetAccessRuleProtection($true,$false)\nforeach($rule in @($acl.Access)){$acl.RemoveAccessRuleSpecific($rule)}\nforeach($sid in $trusted){$rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule)}\nSet-Acl -LiteralPath $root -AclObject $acl\n$acl=Get-Acl -LiteralPath $root\n`:``)+
      `$owner=([Security.Principal.NTAccount]$acl.Owner).Translate([Security.Principal.SecurityIdentifier]).Value\nif(!$acl.AreAccessRulesProtected -or $owner -ne $self.Value){throw 'Unsafe recovery owner or inheritance'}\nforeach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($rule.IsInherited -or ($rule.AccessControlType -eq 'Allow' -and $trusted -notcontains $rule.IdentityReference.Value)){throw 'Unsafe recovery ACL'}}\n[Console]::Out.Write('secure')`;
    const result=spawnSync(pwsh,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,shell:false,timeout:10000});
    assert.equal(result.status,0,'Recovery ACL preparation/verification failed');assert.equal(result.stdout,'secure');
  };
  acl(true);
  const bindingId=sha(JSON.stringify(pinned.map(({canonical,identity})=>({canonical,identity}))));
  return {bindingId,reconcile:async({relativePath,expectedRunId,expectedArgumentsDigest,expectedBeforeSha256,retainMarker})=>{
    for(const original of pinned)assert.deepEqual(await pin(original.source,original.directory),original,'Trusted patch path identity changed');
    acl(false);
    return reconcileWorkspacePatchApply({rootPath:root,recoveryRootPath:recovery,powerShellPath:pwsh,
      relativePath,expectedRunId,expectedArgumentsDigest,expectedBeforeSha256,retainMarker});
  }};
}
export const pelicanAcceptanceContract=Object.freeze({
  version:'pelican-existing-begin-only-v1',
  allowedChange:'Only the automatic-start begin semantics of the three existing animateTransform elements may change. A begin attribute may be removed to use the SVG default 0s.',
  preserve:'Preserve the element tree, all text, every other attribute, animation targets, dur and ids exactly.',
  forbidden:'Do not add trigger elements, metadata, CSS, JavaScript or other nodes; do not redraw or replace artwork.',
  strategies:'Different modification orders, individual versus batched edits, and removing begin for its default may be considered; all proposed strategies must satisfy this same contract.',
  failureRecovery:'The selected strategy is advisory. If real verification shows it violates this contract, abandon that strategy, inspect the current file and real failure, and propose a different contract-compliant correction. Do not repeat the same rejected approach or claim success without current passing evidence.'
});
export function pelicanAcceptanceInput(context) {
  return JSON.stringify({...context,acceptanceContract:pelicanAcceptanceContract});
}
export function observeModelStage(provider,stage,calls,signal,onRecord=()=>{}) {
  assert.ok(['candidate_planning','escalated_decision','branch_execution'].includes(stage));
  return {deployment:provider.deployment,complete:async request=>{
    const started=performance.now(),record={provider:provider.deployment.provider,model:provider.deployment.model,
      stage,status:'attempted',startedAt:new Date().toISOString(),
      requestSummary:{messageCount:request.messages.length,toolCount:request.tools.length}};
    calls.push(record);onRecord({event:'model_attempt_started',...record});
    try {
      const result=await provider.complete({...request,
        signal:AbortSignal.any([...(signal?[signal]:[]),...(request.signal?[request.signal]:[])])});
      Object.assign(record,{status:'succeeded',provider:result.deployment.provider,model:result.deployment.model,
        usage:result.usage??null,response:structuredClone(result.response),stopReason:result.stopReason??null});return result;
    }catch(error){record.status='failed';record.errorCode=typeof error?.code==='string'?error.code:'MODEL_CALL_FAILED';throw error;}
    finally {record.endedAt=new Date().toISOString();record.wallMs=performance.now()-started;
      onRecord({event:'model_attempt_finished',stage,status:record.status,startedAt:record.startedAt,endedAt:record.endedAt,
        wallMs:record.wallMs,...(record.errorCode?{errorCode:record.errorCode}:{})});}
  }};
}
export function recordBranchFailure(branch,task,error) {
  branch.status='failed';branch.taskId=task.taskId;branch.taskState=task.state;
  branch.taskError=task.error?structuredClone(task.error):null;
  branch.error=task.error?.message??String(error?.message??error);
  branch.runnerError={name:error?.name??'Error',message:String(error?.message??error),...(error?.code?{code:error.code}:{})};
}
export function readOnlyToolFailureFeedback(app,invocation,readback,toolFailures,descriptor) {
  const records=app.runtime.readToolExecutions(readback.task.taskId),evidenceRefs=app.runtime.readEvidence(readback.task.taskId).map(item=>item.evidenceId);
  const failure={taskId:readback.task.taskId,parentTaskId:invocation.taskId,tool:invocation.toolName,
    taskState:readback.task.state,taskError:structuredClone(readback.task.error??null),
    executions:records.map(({evidenceId,state,errorCode,executionStarted})=>({evidenceId,state,errorCode,executionStarted})),evidenceRefs,feedbackToAgent:false};
  toolFailures.push(failure);
  const unsafe=records.some(record=>['started','unknown'].includes(record.state)||['TIMEOUT','CANCELLED','RESULT_UNKNOWN'].includes(record.errorCode))
    ||['TIMEOUT','CANCELLED','RESULT_UNKNOWN'].includes(readback.task.error?.code);
  if(readback.task.state!=='failed'||unsafe||descriptor?.sideEffect!=='read'||descriptor.name!==invocation.toolName||descriptor.version!==invocation.toolVersion
    ||!['workspace.read_text','workspace.preview_text_patch','pelican.verify'].includes(invocation.toolName))return null;
  failure.feedbackToAgent=true;
  return {state:'confirmed',evidenceRefs,result:{toolStatus:'failed',taskState:'failed',taskId:readback.task.taskId,
    error:failure.taskError,executionErrors:failure.executions,evidenceRefs,
    guidance:'This read-only attempt failed. Inspect the actual error and current file, adjust arguments, and make a new proposal. No write or success is implied.'}};
}
export function summarizeModelCalls(calls,laya=[],decisions=[]) {
  const totals=items=>({attempted:items.length,succeeded:items.filter(call=>call.status==='succeeded').length,
    failed:items.filter(call=>call.status==='failed').length,pending:items.filter(call=>call.status==='attempted').length,
    attemptedWallMs:items.reduce((sum,call)=>sum+(call.wallMs??0),0),
    succeededWallMs:items.filter(call=>call.status==='succeeded').reduce((sum,call)=>sum+call.wallMs,0),
    failedWallMs:items.filter(call=>call.status==='failed').reduce((sum,call)=>sum+call.wallMs,0)});
  const byStage=Object.fromEntries(['candidate_planning','escalated_decision','branch_execution'].map(stage=>[stage,totals(calls.filter(call=>call.stage===stage))]));
  return {modelCalls:calls.length,modelCallOutcomes:totals(calls),modelCallsByStage:byStage,
    candidatePlanningCalls:byStage.candidate_planning.attempted,escalatedDecisionCalls:byStage.escalated_decision.attempted,
    branchExecutionCalls:byStage.branch_execution.attempted,
    callDefinition:'Provider attempts by fixed host stage including failures; succeeded means provider returned, not task success. Failed spend and pricing remain unknown',
    layaSuccessfulChoiceCalls:laya.filter(record=>record.event==='laya_choice').length,
    layaRejectedCalls:laya.filter(record=>record.event==='laya_rejected').length,
    layaFailureCoverage:'Successful choices and explicit rejection records only; absence of a record does not prove no attempted call',
    actualDecisionMakers:decisions.map(record=>record.decided_by),trainingPerformed:false};
}
function active(signal,deadline) {signal.throwIfAborted();if(Date.now()>=Date.parse(deadline))throw Error('Task deadline expired');}
export function minimalEdit(before,after) {
  if(before===after)return [];
  let start=0,end=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;
  while(end<before.length-start&&end<after.length-start&&before[before.length-1-end]===after[after.length-1-end])end++;
  return [{oldText:before.slice(start,before.length-end),newText:after.slice(start,after.length-end)}];
}
function structural(config,path) {
  const check=spawnSync(config.python,[checker,path,fixture],{encoding:'utf8',windowsHide:true,shell:false,timeout:remaining(config.deadline)});
  if(check.error)throw Error('Structural checker failed to run');
  const result=JSON.parse(check.stdout);assert.equal(check.status,result.passed?0:1);return result;
}
export async function browserObservation(page,path,screenshot) {
  const errors=[],warnings=[],onError=error=>errors.push(String(error.message));page.on('pageerror',onError);
  const onConsole=message=>{if(['error','warning'].includes(message.type()))(message.type()==='error'?errors:warnings).push(message.text());};page.on('console',onConsole);
  const target=pathToFileURL(path).href,blockExternal=route=>route.request().url()===target?route.continue():route.abort();
  if(page.route)await page.route('**/*',blockExternal);
  try {
    await page.goto(pathToFileURL(path).href,{waitUntil:'load'});
    const sample=()=>page.evaluate(()=>({time:document.documentElement.getCurrentTime(),
      width:document.documentElement.getBoundingClientRect().width,
      elements:['wheel-back','wheel-front','pedal'].map(id=>{
        const node=document.getElementById(id),matrix=node?.getCTM();
        return {id,matrix:matrix?[matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f]:null};
      })}));
    const before=await sample();await page.waitForTimeout(240);const after=await sample();
    await page.screenshot({path:screenshot});
    return {browser:'headless installed Edge, fresh profile',automation:'isolated benchmark browser; external requests blocked',
      url:pathToFileURL(path).href,nonBlank:after.width>0,errors,warnings,
      moving:after.elements.map((element,i)=>({id:element.id,
        changed:element.matrix!==null&&JSON.stringify(element.matrix)!==JSON.stringify(before.elements[i].matrix)})),
      elapsedSvgSeconds:after.time-before.time,screenshot};
  }finally{page.off('pageerror',onError);page.off('console',onConsole);if(page.unroute)await page.unroute('**/*',blockExternal);}
}
export async function runPelicanTestVersion(config) {
  assert.ok(config.image?.url&&config.image?.token,'Explicit authenticated test image configuration required');
  assert.ok(config.localLaya?.modelPath&&config.python&&config.browserPath,'Explicit local model/Python/browser paths required');
  assert.ok(Number.isInteger(config.maxSteps)&&config.maxSteps>0,'Choose a test step budget explicitly');
  assert.ok(Number.isFinite(Date.parse(config.deadline))&&Date.parse(config.deadline)>Date.now(),'Choose an original deadline explicitly');
  await mkdir(join(root,'.cache'),{recursive:true});
  const directory=await mkdtemp(join(root,'.cache','pelican-test-version-')),controller=new AbortController();
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(remaining(config.deadline))]);
  const onStop=()=>controller.abort();process.once('SIGINT',onStop);process.once('SIGTERM',onStop);
  const report={version:1,kind:'experimental_real_model_test_version',startedAt:new Date().toISOString(),directory,
    architectureStatus:'experimental_not_final',imagePublished:false,resourceQuota:false,
    fixture:'Explicit controlled animation-start fault; not an invented model mistake',calls:[],decisions:[],laya:[],branches:[],status:'running'};
  const persistStage=row=>appendFileSync(join(directory,'stage-timeline.jsonl'),JSON.stringify(row)+'\n');
  report.timings=[];const timed=createTimingRecorder(report.timings,()=>new Date().toISOString(),()=>performance.now(),persistStage);
  const apps=[],start=performance.now();let service,browser,control;
  const source=await readFile(fixture,'utf8'),baselineSha=sha(source);
  const business=createTestVersionBusinessTools(config.business);
  report.business=business.states;
  try {
    const {chromium}=await import('playwright');
    browser=await timed('startup','browser',()=>chromium.launch({headless:true,executablePath:config.browserPath}));
    const baseText=await timed('startup','image_model_binding',()=>createTestImageModelProvider({...config.image,signal,deadline:config.deadline}));
    const text=timedProvider(baseText,'model_turn',report.timings,timed);
    const planner=new ModelGateway(observeModelStage(text,'candidate_planning',report.calls,signal,persistStage));
    const teacher=new ModelGateway(observeModelStage(text,'escalated_decision',report.calls,signal,persistStage));
    const executor=new ModelGateway(new StructuredToolProvider(observeModelStage(text,'branch_execution',report.calls,signal,persistStage)));
    const runtime=new TaskRuntime(join(directory,'controller.sqlite'));control=runtime;
    const task=runtime.submitTask({goal:'Public pelican main/shadow test',conversationId:'pelican-test',idempotencyKey:randomUUID()});
    const taskId=task.taskId;
    service=await timed('startup','local_laya',()=>startLayaService({...config.localLaya,python:config.python,signal,cpuExecutionPolicy:'sequential'}));
    report.localModel={device:service.device,torchThreads:service.torchThreads,precision:service.precision,modelRevision:config.modelRevision};
    const local=createOwnedLayaSelector({port:service.port,getApiKey:()=>service.key,isReady:service.isReady,
      cpuExecutionPolicy:'sequential',onDecision:record=>report.laya.push(record)});
    const store={read:key=>runtime.loadCheckpoint(taskId,key),writeOnce:(key,value)=>runtime.saveCheckpointOnce(taskId,key,value)};
    const outcomeStillValid=async value=>{
      if(!value.verifiedFileSha256||!value.evidenceRefs?.length||!value.verifiedFile)return false;
      try {return sha(await readFile(value.verifiedFile))===value.verifiedFileSha256
        &&value.evidenceRefs.every(ref=>runtime.loadCheckpoint(taskId,'verified:'+ref)?.sha256===value.verifiedFileSha256);}
      catch {return false;}
    };
    const adaptive=createAdaptiveWorkflowSelector({laya:local,teacher,store,modelRevision:config.modelRevision,
      verifyOutcome:outcomeStillValid,onRecord:record=>report.decisions.push(record)});
    const toolsSeen=[],registeredDescriptors=new WeakMap();report.toolExecutions=toolsSeen;report.toolFailures=[];
    const invoke=async(app,client,invocation)=>timed('tool',invocation.toolName,async()=>{
      active(signal,config.deadline);
      const child=app.submitHostToolTask({commandId:invocation.runId,toolName:invocation.toolName,toolVersion:invocation.toolVersion,
        arguments:invocation.arguments,deadline:invocation.deadline});
      app.runtime.saveCheckpoint(child.task.taskId,'test-parent',{taskId:invocation.taskId,runId:invocation.runId});
      while(true) {
        if(signal.aborted||invocation.signal.aborted)app.runtime.requestCancel(child.task.taskId,'Parent test cancelled');
        active(signal,config.deadline);active(invocation.signal,invocation.deadline);
        const readback=app.readHostToolTask(child.task.taskId);
        if(readback.task.state==='waiting_approval') {
          // Explicit public-fixture test authorization, never a production blanket grant.
          await client.call('authorization.respond',{approvalId:readback.approval.approvalId,
            expectedRevision:readback.approval.revision,decision:'allow_once'});
        } else if(readback.task.state==='succeeded'&&readback.confirmed) {
          const records=app.runtime.readToolExecutions(child.task.taskId);assert.equal(records.length,1);assert.equal(records[0].executionStarted,true);
          toolsSeen.push({taskId:child.task.taskId,parentTaskId:invocation.taskId,tool:invocation.toolName,
            argumentsDigest:decisionDigest(invocation.arguments),evidenceRefs:readback.confirmed.evidenceRefs});
          return {state:'confirmed',result:readback.confirmed.result,evidenceRefs:readback.confirmed.evidenceRefs};
        } else if(readback.task.state==='waiting_reconciliation') {
          readOnlyToolFailureFeedback(app,invocation,readback,report.toolFailures);
          return {state:'unknown',evidenceRefs:report.toolFailures.at(-1).evidenceRefs};
        }
        else if(['failed','cancelled'].includes(readback.task.state)) {
          const descriptor=registeredDescriptors.get(app)?.find(tool=>tool.name===invocation.toolName&&tool.version===invocation.toolVersion);
          const feedback=readOnlyToolFailureFeedback(app,invocation,readback,report.toolFailures,descriptor);
          if(feedback)return feedback;
          throw Error(readback.task.error?.message??('Tool task '+readback.task.state+': '+invocation.toolName));
        }
        await new Promise(resolve=>setTimeout(resolve,15));
      }
    });
    const planning=await planner.complete({tools:[],deadline:config.deadline,signal,messages:[
      {role:'system',content:'Return only JSON {"plans":[{"id":"unique","description":"comparison description","goal":"specific executable repair strategy"}]}. Produce three feasible distinct incremental strategies for an existing SVG animation fault. Do not include code or claims of execution. Real tools will read, preview, apply exact-text patches and run structural/browser tests. Preserve all geometry and animation duration/targets. Use actual findings to repair incrementally.'},
      {role:'user',content:pelicanAcceptanceInput({goal:'Fix the existing pelican bicycle animation; the three animateTransform elements do not start.',
        file,baselineSha,source,availableTools:['workspace.read_text','workspace.preview_text_patch','workspace.apply_text_patch','pelican.verify']})}
    ]});
    const plans=JSON.parse(planning.response.text).plans;
    assert.equal(plans.length,3);assert.equal(new Set(plans.map(p=>p.id)).size,3);
    assert.ok(plans.every(p=>plain(p)&&p.id&&p.description&&p.goal));
    report.plans=plans;
    const select=async(site,candidates,context,sources)=>adaptive.decide({requestId:randomUUID(),site,criteriaVersion:'pelican-v1',
      criteria:'Select the feasible incremental strategy best supported by actual observations. Preserve existing pelican/bicycle geometry and animation targets/timing. No tool execution has occurred unless a real receipt is supplied.',
      context:pelicanAcceptanceInput(context),candidates:candidates.map(p=>({id:p.id,description:p.description})),sources,signal,deadline:config.deadline});
    const sources=[{sourceId:file,revision:'baseline',sha256:baselineSha}];
    const mainChoice=await select('pelican.main-plan',plans,{goal:'main',source,baselineSha},sources);
    const remainingPlans=plans.filter(p=>p.id!==mainChoice.selectedId);
    const shadowChoice=await select('pelican.shadow-plan',remainingPlans,{goal:'isolated alternative',source,baselineSha},sources);
    const userRoot=join(directory,'user-workspace');await mkdir(userRoot);await writeFile(join(userRoot,file),source);
    await writeFile(join(userRoot,'user-uncommitted.txt'),'Existing user changes must survive.\n');
    async function runBranch(mode,plan) {
      const branchStart=performance.now(),branchRoot=join(directory,mode),recovery=join(directory,mode+'-recovery');
      await mkdir(branchRoot);await mkdir(recovery);await writeFile(join(branchRoot,file),source);
      const branch={mode,planId:plan.id,directory:branchRoot,baselineSha256:baselineSha,verifications:[],status:'running'};report.branches.push(branch);
      const page=await browser.newPage({viewport:{width:900,height:720},javaScriptEnabled:false});
      page.setDefaultTimeout(remaining(config.deadline));page.setDefaultNavigationTimeout(remaining(config.deadline));
      let lastVerification;
      const verify={descriptor:{name:'pelican.verify',version:'1.0.0',inputSchema:{type:'object',properties:{},additionalProperties:false},
        outputSchema:{type:'object'},requiredScopes:['workspace:read'],sideEffect:'read',idempotencySupport:true,recoverySupport:true,requiresPresence:false},
        execute:async(_input,context)=>{
          active(context.signal,context.deadline);const checkedSha256=sha(await readFile(join(branchRoot,file)));
          const structure=await timed('verification',mode+':structure',()=>structural({...config,deadline:context.deadline},join(branchRoot,file)));
          const visual=await timed('browser',mode,()=>browserObservation(page,join(branchRoot,file),join(directory,mode+'-'+context.runId+'.png')));
          const currentSha256=sha(await readFile(join(branchRoot,file)));
          active(context.signal,context.deadline);
          lastVerification={...structure,browser:visual,passed:checkedSha256===currentSha256&&structure.passed&&visual.nonBlank&&!visual.errors.length&&visual.moving.every(x=>x.changed),
            currentSha256,verifiedAt:new Date().toISOString()};
          branch.verifications.push(lastVerification);return lastVerification;
        }};
      const read=createWorkspaceReadTool({rootPath:branchRoot}),preview=createWorkspacePatchPreviewTool({rootPath:branchRoot});
      const apply=createWorkspacePatchApplyTool({rootPath:branchRoot,recoveryRootPath:recovery,powerShellPath:config.powerShellPath});
      const tools=[read,preview,apply,verify];
      const workspacePatchReconciliation=await createTestPatchReconciliation({rootPath:branchRoot,recoveryRootPath:recovery,powerShellPath:config.powerShellPath});
      const app=createRuntimeApplication({path:join(branchRoot,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'pelican-'+mode,tools,workspacePatchReconciliation});
      registeredDescriptors.set(app,tools.map(tool=>tool.descriptor));
      apps.push(app);const client=new Client(app);await client.connect();
      const parent=app.runtime.submitTask({goal:plan.goal,conversationId:mode,idempotencyKey:randomUUID()});
      const port={list:()=>tools.map(tool=>tool.descriptor),invoke:request=>invoke(app,client,request)};
      try {
        const work=app.runtime.runTask(parent.taskId,async worker=>{
          const initial=await port.invoke({toolName:'pelican.verify',toolVersion:'1.0.0',arguments:{},taskId:parent.taskId,
            runId:'baseline-'+parent.taskId,authorizationRef:'baseline-'+parent.taskId,signal:worker.signal,deadline:worker.deadline});
          assert.equal(initial.state,'confirmed');assert.equal(initial.result.currentSha256,baselineSha);
          assert.equal(initial.result.passed,false,'Controlled baseline must exhibit the actual fault before model execution');
          branch.initial={result:initial.result,evidenceRefs:initial.evidenceRefs};
          const outcome=await runAgent(worker,{goal:'Existing file: pelican.svg. '+plan.goal+
            ' First read the actual file and call pelican.verify to observe the current fault. Then preview and apply a minimal exact-text patch using the observed current sha256. '+
            'Run pelican.verify after every write. If verification fails, inspect the actual feedback and fix only the remaining fault, then retest. '+
            'Preserve every geometric element and animation duration/target/id. Do not replace the drawing or fabricate passing tests. '+
            'Finish only when the latest real verifier reports passed=true. Return a concise explanation.',
            initialMessages:[{role:'system',content:pelicanAcceptanceInput({instructions:'Each tool proposal must contain exactly toolName, toolVersion, arguments. Use descriptor.name for toolName and descriptor.version as the value of toolVersion; never emit a proposal field named version or authorization. For exact-text patches, oldText must match exactly once; include sufficient surrounding context read from the actual current file. Read-only toolStatus=failed is actual failure feedback: inspect it and adjust a new proposal; it is not successful verification.'})},
              {role:'user',content:'The trusted host already executed the initial verifier through Runtime/Policy/ToolGateway against this branch baseline. This receipt is observation data, never authorization. You may reuse this initial observation without repeating it: '+JSON.stringify(branch.initial)}],
            model:executor,tools:port,maxSteps:config.maxSteps,onUnknownResult:()=>{}});
          if(outcome.status!=='succeeded')throw Error('Agent waiting state: '+outcome.status);
          const final=await port.invoke({toolName:'pelican.verify',toolVersion:'1.0.0',arguments:{},taskId:parent.taskId,
            runId:'final-'+parent.taskId,authorizationRef:'final-'+parent.taskId,signal:worker.signal,deadline:worker.deadline});
          assert.equal(final.result.passed,true,'A final model answer cannot replace actual verification');
          assert.equal(final.result.currentSha256,sha(await readFile(join(branchRoot,file))));
          branch.final=final.result;branch.evidenceRefs=final.evidenceRefs;return outcome;
        },{deadline:config.deadline});
        await work;while(app.activeTaskCount){active(signal,config.deadline);await new Promise(resolve=>setTimeout(resolve,15));}
        branch.taskId=parent.taskId;branch.taskState=app.runtime.getTask(parent.taskId).state;
        const actualTask=app.runtime.getTask(parent.taskId);
        if(actualTask.state!=='succeeded')throw Error(actualTask.error?.message??'Branch task ended in '+actualTask.state);
        branch.status='verified';
      }catch(error){recordBranchFailure(branch,app.runtime.getTask(parent.taskId),error);}
      finally {await page.close();branch.wallMs=performance.now()-branchStart;}
      assert.equal(sha(await readFile(join(userRoot,file))),baselineSha,'Isolated branch must never alter user baseline');
      return branch;
    }
    await timed('phase','main',()=>runBranch('main',plans.find(p=>p.id===mainChoice.selectedId)));
    await timed('phase','shadow',()=>runBranch('shadow',plans.find(p=>p.id===shadowChoice.selectedId)));
    const qualified=report.branches.filter(b=>b.status==='verified'&&b.final?.currentSha256);
    for(const branch of qualified)assert.equal(sha(await readFile(join(branch.directory,file))),branch.final.currentSha256,'Verified branch changed before comparison');
    if(!qualified.length)throw Error('No branch has actual current passing evidence');
    const finalSources=qualified.map(b=>({sourceId:b.mode,revision:b.taskId,sha256:b.final.currentSha256}));
    let finalChoice;
    const comparisonInput={goal:'Choose actual verified result for single CAS delivery',results:qualified.map(b=>({mode:b.mode,planId:b.planId,
      final:b.final,wallMs:b.wallMs,evidenceRefs:b.evidenceRefs}))};
    const identical=chooseVerifiedIdenticalDelivery(qualified);
    if(identical)finalChoice=identical;
    else finalChoice=await select('pelican.result-comparison',qualified.map(b=>({id:b.planId,description:JSON.stringify({mode:b.mode,
      sha256:b.final.currentSha256,passed:b.final.passed,wallMs:b.wallMs})})),comparisonInput,finalSources);
    report.finalChoice=finalChoice;
    const winner=qualified.find(b=>b.planId===finalChoice.selectedId);
    const selectedSource=await readFile(join(winner.directory,file),'utf8');
    assert.equal(sha(selectedSource),winner.final.currentSha256,'Delivery bytes changed after branch verification');
    assert.equal(sha(await readFile(join(userRoot,file))),baselineSha,'User changed target after baseline; CAS must stop');
    const deliveryRecovery=join(directory,'delivery-recovery');await mkdir(deliveryRecovery);
    const deliveryTool=createWorkspacePatchApplyTool({rootPath:userRoot,recoveryRootPath:deliveryRecovery,powerShellPath:config.powerShellPath});
    const delivery=createRuntimeApplication({path:join(directory,'delivery.sqlite'),profile:'huawei_ict_agentarts',
      hostUserNamespace:'pelican-single-delivery',tools:[deliveryTool,...business.tools],
      workspacePatchReconciliation:await createTestPatchReconciliation({rootPath:userRoot,recoveryRootPath:deliveryRecovery,powerShellPath:config.powerShellPath})});
    registeredDescriptors.set(delivery,[deliveryTool,...business.tools].map(tool=>tool.descriptor));
    apps.push(delivery);const deliveryClient=new Client(delivery);await deliveryClient.connect();
    const delivered=await invoke(delivery,deliveryClient,{toolName:deliveryTool.descriptor.name,toolVersion:deliveryTool.descriptor.version,
      arguments:{path:file,expectedSha256:baselineSha,edits:minimalEdit(source,selectedSource)},taskId,
      runId:'deliver-'+randomUUID(),signal,deadline:config.deadline});
    assert.equal(delivered.result.afterSha256,sha(selectedSource));assert.equal(sha(await readFile(join(userRoot,file))),sha(selectedSource));
    assert.equal(await readFile(join(userRoot,'user-uncommitted.txt'),'utf8'),'Existing user changes must survive.\n');
    report.delivery={...delivered,singleWriteback:true,userBaselinePreserved:true,selectedSha256:sha(selectedSource)};
    if(qualified.length===2&&finalChoice.decided_by!=='code') {
      for(const evidenceRef of delivered.evidenceRefs)runtime.saveCheckpoint(taskId,'verified:'+evidenceRef,{sha256:sha(selectedSource)});
      const verified={evidenceRefs:delivered.evidenceRefs,verifiedFile:join(userRoot,file),verifiedFileSha256:sha(selectedSource)};
      // Trusted readback, not teacher agreement, qualifies ONLY this exact comparison case.
      await adaptive.rememberVerified(finalChoice,{},verified);
      const replay=await select('pelican.result-comparison',qualified.map(b=>({id:b.planId,description:JSON.stringify({mode:b.mode,
        sha256:b.final.currentSha256,passed:b.final.passed,wallMs:b.wallMs})})),comparisonInput,finalSources);
      assert.equal(replay.decided_by,'verified_experience');report.exactCaseReuse=replay;
    }
    report.status=report.branches.every(b=>b.status==='verified')?'verified_main_shadow_and_delivery':'partial_one_branch_failed';
    if(report.status!=='verified_main_shadow_and_delivery')process.exitCode=1;
    report.toolExecutions=toolsSeen;
  }catch(error){report.status='failed';report.failure=String(error.message).slice(0,500);process.exitCode=1;}
  finally {
    controller.abort();
    for(const app of apps.reverse()) {
      const stopAt=Date.now()+5000;
      while(app.activeTaskCount&&Date.now()<stopAt)await new Promise(resolve=>setTimeout(resolve,15));
      if(!app.activeTaskCount)app.close();else report.cleanupPending=true;
    }
    control?.close();business.dispose();await browser?.close();await service?.stop();
    process.removeListener('SIGINT',onStop);process.removeListener('SIGTERM',onStop);
    report.wallMs=performance.now()-start;report.finishedAt=new Date().toISOString();
    report.summary=summarizeModelCalls(report.calls,report.laya,report.decisions);
    const result=JSON.stringify(report,null,2)+'\n';assert.ok(!result.includes(config.image.token),'Secrets must never enter test evidence');
    await writeFile(join(directory,'report.json'),result);
  }
  return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.argv.includes('--live'))throw Error('This entry performs real model calls. Run the launcher with -Live and explicit configuration.');
  const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
  const report=await runPelicanTestVersion(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  console.log(JSON.stringify({status:report.status,directory:report.directory,summary:report.summary,failure:report.failure},null,2));
}

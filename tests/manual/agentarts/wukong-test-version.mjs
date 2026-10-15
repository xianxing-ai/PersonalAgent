import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {appendFileSync} from 'node:fs';
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
const scaffold='<!doctype html><html><head><meta charset="utf-8"><title>Wukong scaffold</title></head><body><!-- MODEL_GENERATION_ANCHOR --></body></html>';
const checker=fileURLToPath(new URL('./check-wukong.py',import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');
const file='wukong.html',plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function createTimingRecorder(records,now=()=>new Date().toISOString(),clock=()=>performance.now(),onRecord=()=>{}) {
  return async function timed(kind,label,fn) {const startedAt=now(),start=clock();let outcome='failed';
    onRecord({event:'stage_started',kind,label,startedAt});
    try{const result=await fn();outcome=result?.status==='failed'?'failed':'completed';return result;}finally{const row={kind,label,startedAt,endedAt:now(),wallMs:clock()-start,outcome};records.push(row);onRecord({event:'stage_finished',...row});}};
}
export function timedProvider(provider,stage,records,timed=createTimingRecorder(records)) {
  return {...provider,complete:request=>timed('model',stage,()=>provider.complete(request))};}
export function assertCurrentDelivery(source,expectedSha256) {assert.equal(sha(source),expectedSha256,'Delivery bytes differ from current verified SHA');}
export function injectPausedAnimations(config,source) {
  const check=spawnSync(config.python,[checker,'--pause-smil','-'],{input:source,encoding:'utf8',shell:false,windowsHide:true,timeout:remaining(config.deadline)});
  assert.ifError(check.error);assert.equal(check.status,0,'Structural fault injection must succeed');
  const result=JSON.parse(check.stdout);assert.equal(result.beforeSha256,sha(source));assert.equal(result.afterSha256,sha(result.source));return result;
}
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
    ||!['workspace.read_text','workspace.preview_text_patch','wukong.verify'].includes(invocation.toolName))return null;
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
  const check=spawnSync(config.python,[checker,path],{encoding:'utf8',windowsHide:true,shell:false,timeout:remaining(config.deadline)});
  if(check.error)throw Error('Structural checker failed to run');
  const result=JSON.parse(check.stdout);assert.equal(check.status,result.passed?0:1);return result;
}
export async function browserObservation(page,path,screenshot) {
  const errors=[],warnings=[],onError=error=>errors.push(String(error.message));
  const onConsole=message=>{if(['error','warning'].includes(message.type()))(message.type()==='error'?errors:warnings).push(message.text());};
  page.on('pageerror',onError);page.on('console',onConsole);
  const target=pathToFileURL(path).href,blockExternal=route=>route.request().url()===target?route.continue():route.abort();
  if(page.route)await page.route('**/*',blockExternal);
  try {
    await page.goto(pathToFileURL(path).href,{waitUntil:'load'});
    const sample=()=>page.evaluate(()=>({time:document.querySelector('svg')?.getCurrentTime()??0,
      width:document.documentElement.getBoundingClientRect().width,
      artwork:['wukong','white-dragon-horse'].map(id=>{const node=document.getElementById(id),box=node?.getBBox();return {id,width:box?.width??0,height:box?.height??0,shapes:node?.querySelectorAll('path,circle,ellipse,rect,polygon,polyline,line').length??0};}),
      elements:['wukong','white-dragon-horse'].map(id=>{
        const node=document.getElementById(id),matrix=node?.getCTM();
        return {id,matrix:matrix?[matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f]:null};
      })}));
    const before=await sample();await page.waitForTimeout(240);const after=await sample();
    await page.screenshot({path:screenshot});
    return {browser:'headless installed Edge, fresh profile',automation:'isolated benchmark browser; fresh profile, external requests blocked',
      url:pathToFileURL(path).href,nonBlank:after.width>0&&after.artwork.every(item=>item.width>0&&item.height>0&&item.shapes>0),artwork:after.artwork,errors,warnings,
      moving:after.elements.map((element,i)=>({id:element.id,
        changed:element.matrix!==null&&JSON.stringify(element.matrix)!==JSON.stringify(before.elements[i].matrix)})),
      elapsedSvgSeconds:after.time-before.time,screenshot};
  }finally{page.off('pageerror',onError);page.off('console',onConsole);if(page.unroute)await page.unroute('**/*',blockExternal);}
}
export async function runWukongTestVersion(config) {
  assert.ok(config.image?.url&&config.image?.token,'Explicit authenticated test image configuration required');
  assert.ok(config.localLaya?.modelPath&&config.python&&config.browserPath,'Explicit local model/Python/browser paths required');
  assert.ok(Number.isInteger(config.maxSteps)&&config.maxSteps>0,'Choose a test step budget explicitly');
  assert.ok(Number.isFinite(Date.parse(config.deadline))&&Date.parse(config.deadline)>Date.now(),'Choose an original deadline explicitly');
  await mkdir(join(root,'.cache'),{recursive:true});
  const directory=await mkdtemp(join(root,'.cache','wukong-test-version-')),controller=new AbortController();
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(remaining(config.deadline))]);
  const onStop=()=>controller.abort();process.once('SIGINT',onStop);process.once('SIGTERM',onStop);
  const report={version:1,kind:'experimental_real_model_test_version',startedAt:new Date().toISOString(),directory,
    architectureStatus:'experimental_not_final',imagePublished:false,resourceQuota:false,
    fixture:'Initial drawing must be generated by the real image model; optional animation pause is explicit host fault injection',calls:[],decisions:[],laya:[],branches:[],status:'running'};
  const git=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',shell:false,windowsHide:true});
  assert.equal(git.status,0,'Implementation SHA must be readable');report.implementationGitSha=git.stdout.trim();
  report.semanticVisualReview='Pending human screenshot review; static labels and motion do not prove recognizable Wukong/horse artwork';
  const persistStage=row=>appendFileSync(join(directory,'stage-timeline.jsonl'),JSON.stringify(row)+'\n');
  report.timings=[];const timed=createTimingRecorder(report.timings,()=>new Date().toISOString(),()=>performance.now(),persistStage);
  const apps=[],start=performance.now();let service,browser,control;
  let source=scaffold,baselineSha=sha(source);
  const business=createTestVersionBusinessTools(config.business);
  report.business=business.states;
  try {
    const {chromium}=await import('playwright');
    browser=await timed('startup','browser',()=>chromium.launch({headless:true,executablePath:config.browserPath}));
    const text=await timed('startup','image_model_binding',()=>createTestImageModelProvider({...config.image,signal,deadline:config.deadline}));
    const planner=new ModelGateway(observeModelStage(timedProvider(text,'candidate_planning',report.timings,timed),'candidate_planning',report.calls,signal,persistStage));
    const teacher=new ModelGateway(observeModelStage(timedProvider(text,'teacher',report.timings,timed),'escalated_decision',report.calls,signal,persistStage));
    const executor=new ModelGateway(new StructuredToolProvider(observeModelStage(timedProvider(text,'branch_execution',report.timings,timed),'branch_execution',report.calls,signal,persistStage)));
    const runtime=new TaskRuntime(join(directory,'controller.sqlite'));control=runtime;
    const task=runtime.submitTask({goal:'Public wukong main/shadow test',conversationId:'wukong-test',idempotencyKey:randomUUID()});
    const taskId=task.taskId;
    service=await timed('startup','local_laya',()=>startLayaService({...config.localLaya,python:config.python,signal,cpuExecutionPolicy:'sequential'}));
    report.localModel={device:service.device,torchThreads:service.torchThreads,precision:service.precision,modelRevision:config.modelRevision};
    const rawLocal=createOwnedLayaSelector({port:service.port,getApiKey:()=>service.key,isReady:service.isReady,
      cpuExecutionPolicy:'sequential',onDecision:record=>report.laya.push(record)});
    const local={...rawLocal,select:request=>timed('laya','select',()=>rawLocal.select(request))};
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
    // Generate the actual initial artifact from an empty drawing scaffold through the same Runtime tools.
    const generationRoot=join(directory,'generation'),generationRecovery=join(directory,'generation-recovery');
    await mkdir(generationRoot);await mkdir(generationRecovery);await writeFile(join(generationRoot,file),scaffold);
    const generationTools=[createWorkspaceReadTool({rootPath:generationRoot}),createWorkspacePatchPreviewTool({rootPath:generationRoot}),
      createWorkspacePatchApplyTool({rootPath:generationRoot,recoveryRootPath:generationRecovery,powerShellPath:config.powerShellPath})];
    const generationApp=createRuntimeApplication({path:join(generationRoot,'runtime.sqlite'),profile:'huawei_ict_agentarts',
      hostUserNamespace:'wukong-generation',tools:generationTools,workspacePatchReconciliation:await createTestPatchReconciliation({
        rootPath:generationRoot,recoveryRootPath:generationRecovery,powerShellPath:config.powerShellPath})});
    registeredDescriptors.set(generationApp,generationTools.map(t=>t.descriptor));apps.push(generationApp);
    const generationClient=new Client(generationApp);await generationClient.connect();
    const generationTask=generationApp.runtime.submitTask({goal:'Generate Wukong riding the white dragon horse from an empty drawing scaffold',conversationId:'generation',idempotencyKey:randomUUID()});
    await timed('phase','initial_generation',()=>generationApp.runtime.runTask(generationTask.taskId,async worker=>{const outcome=await runAgent(worker,{
      goal:'Read wukong.html and replace MODEL_GENERATION_ANCHOR with your ORIGINAL complete detailed SVG artwork of 孙悟空骑白龙马 (Sun Wukong riding the white dragon horse). Create the actual drawing; no existing drawing is supplied. '+
        'Preserve the HTML scaffold. Use only inline SVG and CSS; no script, event handlers, external resources, foreignObject or network access. '+
        'SVG must have visible groups with ids wukong and white-dragon-horse, containing the actual rider and horse artwork. '+
        'Put each group inside its own animated parent group with id rider-motion and horse-motion. Use animateTransform children with begin="0s", repeatCount="indefinite", dur between 0.5s and 4s and nonconstant translate values. '+
        'Give these animation elements ids rider-bob and horse-gallop respectively. Include SVG title identifying 孙悟空骑白龙马. '+
        'Use workspace.preview_text_patch then workspace.apply_text_patch with the actual SHA and exact original anchor. Finish only after the write tool confirms.',
      initialMessages:[{role:'system',content:'Tool proposal contains exactly toolName,toolVersion,arguments. Do not claim success without the actual tool receipt.'}],
      model:executor,tools:{list:()=>generationTools.map(t=>t.descriptor),invoke:req=>invoke(generationApp,generationClient,req)},
      maxSteps:config.maxSteps,...(config.maxTokens===undefined?{}:{maxTokens:config.maxTokens}),onUnknownResult:()=>{}
    });assert.equal(outcome.status,'succeeded');return outcome;},{deadline:config.deadline}));
    assert.equal(generationApp.runtime.getTask(generationTask.taskId).state,'succeeded','Initial generation task must really succeed');
    source=await readFile(join(generationRoot,file),'utf8');assert.notEqual(source,scaffold,'Real model must generate the drawing');
    report.generation={taskId:generationTask.taskId,currentSha256:sha(source),evidenceRefs:toolsSeen.filter(item=>item.parentTaskId===generationTask.taskId).flatMap(item=>item.evidenceRefs)};
    // Host-side verification is observational here; branch verification below also has Runtime Evidence.
    const generatedStructure=await timed('verification','generated_structure',()=>structural(config,join(generationRoot,file)));
    // Reject active/external markup before opening generated content in a real browser.
    const generatedPage=await browser.newPage({javaScriptEnabled:false});generatedPage.setDefaultTimeout(remaining(config.deadline));
    const generatedBrowser=generatedStructure.passed||generatedStructure.failure?.startsWith('animation_')?await timed('browser','generated',()=>browserObservation(generatedPage,join(generationRoot,file),join(directory,'generated.png'))):{nonBlank:false,errors:['Static contract failed; browser navigation refused'],moving:[]};await generatedPage.close();
    report.generation.verification={structure:generatedStructure,browser:generatedBrowser,passed:generatedStructure.passed&&generatedBrowser.nonBlank&&!generatedBrowser.errors.length&&generatedBrowser.moving.every(x=>x.changed)};
    if(config.faultInjection!==undefined)assert.equal(config.faultInjection,'pause_smil','Only explicit pause_smil fault injection is supported');
    if(config.faultInjection==='pause_smil'&&!report.generation.verification.passed)
      report.faultInjection={requested:'pause_smil',applied:false,reason:'Initial generated drawing already has an actual observed defect'};
    if(config.faultInjection==='pause_smil'&&report.generation.verification.passed) {
      const injection=injectPausedAnimations(config,source),injected=injection.source;assert.notEqual(injected,source);
      const apply=generationTools[2],before=sha(source);
      const fault=await invoke(generationApp,generationClient,{toolName:apply.descriptor.name,toolVersion:apply.descriptor.version,
        arguments:{path:file,expectedSha256:before,edits:minimalEdit(source,injected)},taskId:generationTask.taskId,
        runId:'explicit-fault-'+randomUUID(),signal,deadline:config.deadline});
      source=await readFile(join(generationRoot,file),'utf8');assert.equal(source,injected);
      const injectedStructure=await timed('verification','injected_structure',()=>structural(config,join(generationRoot,file)));
      assert.equal(injectedStructure.passed,false);assert.match(injectedStructure.failure,/^animation_not_started:/);
      const injectedPage=await browser.newPage({javaScriptEnabled:false});injectedPage.setDefaultTimeout(remaining(config.deadline));
      let injectedBrowser;try{injectedBrowser=await timed('browser','injected',()=>browserObservation(injectedPage,join(generationRoot,file),join(directory,'injected.png')));}finally{await injectedPage.close();}
      assert.equal(injectedBrowser.moving.length,2);assert.ok(injectedBrowser.moving.every(item=>!item.changed),'Both artwork transforms must really be paused');
      report.faultInjection={kind:'pause_smil',explicit:true,applied:true,animationIds:injection.animationIds,beforeSha256:before,afterSha256:sha(source),
        currentSha256:sha(source),structure:injectedStructure,browser:injectedBrowser,evidenceRefs:fault.evidenceRefs};
    }
    baselineSha=sha(source);
    report.baseline={baselineSha256:baselineSha,currentSha256:baselineSha,generationSha256:report.generation.currentSha256,
      faultKind:report.faultInjection?.applied?'host_injected_pause_smil':report.generation.verification.passed?'none':'observed_initial_defect'};
    const planning=await planner.complete({tools:[],deadline:config.deadline,signal,messages:[
      {role:'system',content:'Return only JSON {"plans":[{"id":"unique","description":"comparison description","goal":"specific executable repair strategy"}]}. Produce three feasible distinct incremental strategies for an existing SVG animation fault. Do not include code or claims of execution. Real tools will read, preview, apply exact-text patches and run structural/browser tests. Preserve all artwork and animation duration/targets. Use actual findings to repair incrementally.'},
      {role:'user',content:JSON.stringify({goal:'Fix the existing Wukong white dragon horse animation; inspect the actual generated animation and repair any actual failure; preserve an already passing drawing.',
        file,baselineSha,source,actualGenerationObservation:report.generation.verification,explicitFaultInjection:report.faultInjection??null,availableTools:['workspace.read_text','workspace.preview_text_patch','workspace.apply_text_patch','wukong.verify']})}
    ]});
    const plans=JSON.parse(planning.response.text).plans;
    assert.equal(plans.length,3);assert.equal(new Set(plans.map(p=>p.id)).size,3);
    assert.ok(plans.every(p=>plain(p)&&p.id&&p.description&&p.goal));
    report.plans=plans;
    const select=async(site,candidates,context,sources)=>adaptive.decide({requestId:randomUUID(),site,criteriaVersion:'wukong-v1',
      criteria:'Select the feasible incremental strategy best supported by actual observations. Preserve existing Wukong/horse geometry and animation targets/timing. No tool execution has occurred unless a real receipt is supplied.',
      context:JSON.stringify(context),candidates:candidates.map(p=>({id:p.id,description:p.description})),sources,signal,deadline:config.deadline});
    const sources=[{sourceId:file,revision:'baseline',sha256:baselineSha}];
    const mainChoice=await select('wukong.main-plan',plans,{goal:'main',source,baselineSha},sources);
    const remainingPlans=plans.filter(p=>p.id!==mainChoice.selectedId);
    const shadowChoice=await select('wukong.shadow-plan',remainingPlans,{goal:'isolated alternative',source,baselineSha},sources);
    const userRoot=join(directory,'user-workspace'),userBaselineSha=sha(scaffold);await mkdir(userRoot);await writeFile(join(userRoot,file),scaffold);
    await writeFile(join(userRoot,'user-uncommitted.txt'),'Existing user changes must survive.\n');
    async function runBranch(mode,plan) {
      const branchStart=performance.now(),branchRoot=join(directory,mode),recovery=join(directory,mode+'-recovery');
      await mkdir(branchRoot);await mkdir(recovery);await writeFile(join(branchRoot,file),source);
      const branch={mode,planId:plan.id,directory:branchRoot,baselineSha256:baselineSha,verifications:[],status:'running'};report.branches.push(branch);
      const page=await browser.newPage({viewport:{width:900,height:720},javaScriptEnabled:false});
      page.setDefaultTimeout(remaining(config.deadline));page.setDefaultNavigationTimeout(remaining(config.deadline));
      let lastVerification;
      const verify={descriptor:{name:'wukong.verify',version:'1.0.0',inputSchema:{type:'object',properties:{},additionalProperties:false},
        outputSchema:{type:'object'},requiredScopes:['workspace:read'],sideEffect:'read',idempotencySupport:true,recoverySupport:true,requiresPresence:false},
        execute:async(_input,context)=>{
          active(context.signal,context.deadline);const checkedSha256=sha(await readFile(join(branchRoot,file)));
          const structure=await timed('verification',mode+':structure',()=>structural({...config,deadline:context.deadline},join(branchRoot,file)));
          const visual=structure.passed||structure.failure?.startsWith('animation_')?await timed('browser',mode,()=>browserObservation(page,join(branchRoot,file),join(directory,mode+'-'+context.runId+'.png'))):{nonBlank:false,errors:['Static generated-artifact contract failed; browser navigation refused'],moving:[]};
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
      const app=createRuntimeApplication({path:join(branchRoot,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'wukong-'+mode,tools,workspacePatchReconciliation});
      registeredDescriptors.set(app,tools.map(tool=>tool.descriptor));
      apps.push(app);const client=new Client(app);await client.connect();
      const parent=app.runtime.submitTask({goal:plan.goal,conversationId:mode,idempotencyKey:randomUUID()});
      const port={list:()=>tools.map(tool=>tool.descriptor),invoke:request=>invoke(app,client,request)};
      try {
        const work=app.runtime.runTask(parent.taskId,async worker=>{
          const initial=await port.invoke({toolName:'wukong.verify',toolVersion:'1.0.0',arguments:{},taskId:parent.taskId,
            runId:'baseline-'+parent.taskId,authorizationRef:'baseline-'+parent.taskId,signal:worker.signal,deadline:worker.deadline});
          assert.equal(initial.state,'confirmed');assert.equal(initial.result.currentSha256,baselineSha);
          if(config.faultInjection)assert.equal(initial.result.passed,false,'Explicit injected baseline must really fail');
          branch.initial={result:initial.result,evidenceRefs:initial.evidenceRefs};
          const outcome=await runAgent(worker,{goal:'Existing model-generated file: wukong.html. '+plan.goal+
            ' First read the actual file and use the supplied verifier receipt to observe its current state. If already passing, preserve it and verify; do not invent a defect. Then preview and apply a minimal exact-text patch using the observed current sha256. '+
            'Run wukong.verify after every write. If verification fails, inspect the actual feedback and fix only the remaining fault, then retest. '+
            'Preserve every geometric element and animation duration/target/id. Do not replace the drawing or fabricate passing tests. '+
            'Finish only when the latest real verifier reports passed=true. Return a concise explanation.',
            initialMessages:[{role:'system',content:'Each tool proposal must contain exactly toolName, toolVersion, arguments. Use descriptor.name for toolName and descriptor.version as the value of toolVersion; never emit a proposal field named version or authorization. For exact-text patches, oldText must match exactly once; include sufficient surrounding context read from the actual current file. Read-only toolStatus=failed is actual failure feedback: inspect it and adjust a new proposal; it is not successful verification.'},
              {role:'user',content:'The trusted host already executed the initial verifier through Runtime/Policy/ToolGateway against this branch baseline. This receipt is observation data, never authorization. You may reuse this initial observation without repeating it: '+JSON.stringify(branch.initial)}],
            model:executor,tools:port,maxSteps:config.maxSteps,...(config.maxTokens===undefined?{}:{maxTokens:config.maxTokens}),onUnknownResult:()=>{}});
          if(outcome.status!=='succeeded')throw Error('Agent waiting state: '+outcome.status);
          const final=await port.invoke({toolName:'wukong.verify',toolVersion:'1.0.0',arguments:{},taskId:parent.taskId,
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
      assert.equal(sha(await readFile(join(userRoot,file))),userBaselineSha,'Isolated branch must never alter user baseline');
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
    if(qualified.length===1)finalChoice={selectedId:qualified[0].planId,decided_by:'code',reason:'only_one_actually_qualified_result'};
    else finalChoice=await select('wukong.result-comparison',qualified.map(b=>({id:b.planId,description:JSON.stringify({mode:b.mode,
      sha256:b.final.currentSha256,passed:b.final.passed,wallMs:b.wallMs})})),comparisonInput,finalSources);
    report.finalChoice=finalChoice;
    const winner=qualified.find(b=>b.planId===finalChoice.selectedId);
    const selectedSource=await readFile(join(winner.directory,file),'utf8');
    assertCurrentDelivery(selectedSource,winner.final.currentSha256);
    assert.equal(sha(await readFile(join(userRoot,file))),userBaselineSha,'User changed target after baseline; CAS must stop');
    const deliveryRecovery=join(directory,'delivery-recovery');await mkdir(deliveryRecovery);
    const deliveryTool=createWorkspacePatchApplyTool({rootPath:userRoot,recoveryRootPath:deliveryRecovery,powerShellPath:config.powerShellPath});
    const delivery=createRuntimeApplication({path:join(directory,'delivery.sqlite'),profile:'huawei_ict_agentarts',
      hostUserNamespace:'wukong-single-delivery',tools:[deliveryTool,...business.tools],
      workspacePatchReconciliation:await createTestPatchReconciliation({rootPath:userRoot,recoveryRootPath:deliveryRecovery,powerShellPath:config.powerShellPath})});
    registeredDescriptors.set(delivery,[deliveryTool,...business.tools].map(tool=>tool.descriptor));
    apps.push(delivery);const deliveryClient=new Client(delivery);await deliveryClient.connect();
    const delivered=await invoke(delivery,deliveryClient,{toolName:deliveryTool.descriptor.name,toolVersion:deliveryTool.descriptor.version,
      arguments:{path:file,expectedSha256:userBaselineSha,edits:minimalEdit(scaffold,selectedSource)},taskId,
      runId:'deliver-'+randomUUID(),signal,deadline:config.deadline});
    assert.equal(delivered.result.afterSha256,sha(selectedSource));assert.equal(sha(await readFile(join(userRoot,file))),sha(selectedSource));
    assert.equal(await readFile(join(userRoot,'user-uncommitted.txt'),'utf8'),'Existing user changes must survive.\n');
    report.delivery={...delivered,singleWriteback:true,userBaselinePreserved:true,selectedSha256:sha(selectedSource)};
    if(qualified.length===2&&finalChoice.decided_by!=='code') {
      for(const evidenceRef of delivered.evidenceRefs)runtime.saveCheckpoint(taskId,'verified:'+evidenceRef,{sha256:sha(selectedSource)});
      const verified={evidenceRefs:delivered.evidenceRefs,verifiedFile:join(userRoot,file),verifiedFileSha256:sha(selectedSource)};
      // Trusted readback, not teacher agreement, qualifies ONLY this exact comparison case.
      await adaptive.rememberVerified(finalChoice,{},verified);
      const replay=await select('wukong.result-comparison',qualified.map(b=>({id:b.planId,description:JSON.stringify({mode:b.mode,
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
  const report=await runWukongTestVersion(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  console.log(JSON.stringify({status:report.status,directory:report.directory,summary:report.summary,failure:report.failure},null,2));
}

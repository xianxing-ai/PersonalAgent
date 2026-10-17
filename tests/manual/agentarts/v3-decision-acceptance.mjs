// Opt-in public synthetic decision acceptance, no product changes/training/notification execution.
// From repository root: Get-Content -Raw <private-config.json> | node tests/manual/agentarts/v3-decision-acceptance.mjs --live
// Explicit stdin config: {python,modelPath,port,device:'cuda',torchThreads:1,modelRevision,datasetSha256,
// deadline,mode:'quality'|'teacher_only',rawReportPath? (teacher_only),teacherMode:'agentarts'|'none',image:{url,token,modelRef:'plan',reasoningEffort},
// performance:null|{caseIds:[four distinct long case ids],rounds:positiveInteger},pythonModulePath?}
// JSON report path is returned; all config paths/secrets are omitted from the report. Root schedules real execution.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startLayaService} from '../../../apps/agentarts-runtime/src/laya-service.mjs';
import {createOwnedLayaSelector} from '../../../apps/agentarts-runtime/src/laya-selector.mjs';
import {createAdaptiveWorkflowSelector,decisionDigest} from '../../../apps/agentarts-runtime/src/adaptive-decision.mjs';
import {createTestImageModelProvider} from './test-image-model-provider.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
export const datasetPath=fileURLToPath(new URL('./v3-decision-cases.json',import.meta.url));
export const FROZEN_DATASET_SHA256='5a19f073b632442bd4bd7139af75b12596584b1775001be53f6911d2e00a29af';
const hash=v=>createHash('sha256').update(v).digest('hex'),utc=()=>new Date().toISOString();
const active=(signal,deadline)=>{signal.throwIfAborted();assert.ok(Date.parse(deadline)>Date.now(),'Original deadline expired');};
export function validateDataset(dataset) {
  assert.equal(dataset.version,'v3-synthetic-decision-1');assert.ok(dataset.annotation&&dataset.backgroundUnit);
  const ids=new Set();
  for(const row of dataset.cases){assert.ok(!ids.has(row.id));ids.add(row.id);
    const task=dataset.tasks[row.task];assert.ok(task&&['development','holdout'].includes(row.split)&&['short','long'].includes(row.length));
    assert.ok(row.context&&task.criteria&&task.candidates.length>=2&&new Set(task.candidates.map(c=>c.id)).size===task.candidates.length);
    assert.ok(task.candidates.some(c=>c.id===row.expected)&&task.candidates.some(c=>c.id==='review'));
    assert.ok(task.positiveIds.every(id=>task.candidates.some(c=>c.id===id)));
    if(row.length==='long')assert.ok(Number.isSafeInteger(row.backgroundRepeat)&&row.backgroundRepeat>0);
  }
  for(const task of Object.keys(dataset.tasks))for(const split of ['development','holdout'])
    assert.ok(dataset.cases.some(row=>row.task===task&&row.split===split),'Every task needs a frozen independent split');
  return dataset;
}
// Explicit allowlist: host label/split/background metadata never enters either model's prompt.
export function modelInput(dataset,row) {
  const task=dataset.tasks[row.task],context=(row.length==='long'?dataset.backgroundUnit.repeat(row.backgroundRepeat):'')+row.context;
  return {site:row.task,criteriaVersion:dataset.version,criteria:task.criteria,context,
    candidates:structuredClone(task.candidates),abstainIds:['review'],
    sources:[{sourceId:'public-synthetic-context',revision:dataset.version,sha256:hash(context)}]};
}
export function scoreRows(dataset,rows,field) {
  const groups={};
  for(const split of ['development','holdout'])for(const task of Object.keys(dataset.tasks)){
    const cases=dataset.cases.filter(c=>c.split===split&&c.task===task),positives=dataset.tasks[task].positiveIds;
    const score={total:cases.length,correct:0,wrong:0,abstained:0,rejected:0,errors:0,notAttempted:0,TP:0,FP:0,TN:0,FN:0,unresolvedPositive:0,
      confusionScope:'Only non-review host labels and non-review valid model choices; rejection/error/review reported separately'};
    for(const row of cases){const actual=rows.find(r=>r.caseId===row.id);if(!actual){score.notAttempted++;continue;}
      const result=actual[field],choice=result?.selectedId;if(result?.receipt?.event==='laya_rejected')score.rejected++;
      const valid=dataset.tasks[task].candidates.some(c=>c.id===choice);
      if(!valid){score.errors++;if(positives.includes(row.expected))score.unresolvedPositive++;continue;}
      if(choice===row.expected)score.correct++;else score.wrong++;
      if(choice==='review'){score.abstained++;if(positives.includes(row.expected))score.unresolvedPositive++;continue;}
      if(row.expected==='review')continue;
      const expected=positives.includes(row.expected),predicted=positives.includes(choice);
      score[expected?(predicted?'TP':'FN'):(predicted?'FP':'TN')]++;
    }
    score.accuracy=score.total?score.correct/score.total:null;
    score.precision=score.TP+score.FP?score.TP/(score.TP+score.FP):null;
    score.recall=score.TP+score.FN?score.TP/(score.TP+score.FN):null;
    groups[split+':'+task]=score;
  }
  return groups;
}
export function latencySummary(rows){const values=rows.filter(r=>!r.error).map(r=>r.wallMs).sort((a,b)=>a-b);
  return {attempts:rows.length,samples:values.length,errors:rows.length-values.length,
    p50Ms:values.length?values[Math.floor(values.length*.5)]:null,p95Ms:values.length?values[Math.min(values.length-1,Math.ceil(values.length*.95)-1)]:null,
    maximumMs:values.at(-1)??null};}
const safeError=error=>({code:/^[A-Z_]+$/.test(error?.code??'')?error.code:'ACCEPTANCE_OPERATION_FAILED',type:error?.name==='AssertionError'?'AssertionError':'OperationError'});
export async function runDecisionAcceptance(config,deps={}) {
  assert.equal(config.device,'cuda','This acceptance binds explicit native CUDA, not silently CPU');assert.equal(config.torchThreads,1);
  assert.ok(config.python&&config.modelPath&&Number.isSafeInteger(config.port)&&config.port>=1024&&config.port<=65535);
  assert.ok(config.modelRevision&&Number.isFinite(Date.parse(config.deadline))&&Date.parse(config.deadline)>Date.now());
  assert.ok(['agentarts','none'].includes(config.teacherMode));assert.ok(config.performance===null||config.performance&&Number.isSafeInteger(config.performance.rounds)&&config.performance.rounds>0);
  const mode=config.mode??'quality',teacherOnly=mode==='teacher_only';assert.ok(['quality','teacher_only'].includes(mode));
  if(!deps.fixture)assert.ok(isAbsolute(config.python)&&isAbsolute(config.modelPath),'Explicit absolute Python and model paths required');
  if(teacherOnly)assert.ok(config.teacherMode==='agentarts'&&config.performance===null&&typeof config.rawReportPath==='string','Teacher-only requires original raw report and no performance');
  const raw=await readFile(datasetPath),dataset=validateDataset(JSON.parse(raw)),datasetSha256=hash(raw.toString('utf8').replace(/\r\n/g,'\n'));
  assert.equal(datasetSha256,FROZEN_DATASET_SHA256,'Frozen dataset changed; review labels and independent split before updating the pin');
  assert.equal(config.datasetSha256,datasetSha256,'Dataset must be explicitly frozen before real execution');
  if(config.performance){assert.equal(config.performance.caseIds.length,4);assert.equal(new Set(config.performance.caseIds).size,4);
    assert.ok(config.performance.caseIds.every(id=>dataset.cases.some(c=>c.id===id&&c.length==='long')),'Only new long cases are benchmarked');}
  if(config.teacherMode==='agentarts')assert.ok(config.image?.url&&config.image?.token);
  const cache=join(root,'.cache','v3-decision-acceptance');await mkdir(cache,{recursive:true});const directory=await mkdtemp(join(cache,'run-'));
  const report={schemaVersion:1,kind:deps.fixture===true?'offline_fixture_decision_acceptance':'real_native_decision_acceptance',status:'running',startedAtUtc:utc(),
    mode,datasetSha256,datasetFileSha256:hash(raw),datasetHashScope:'Exact UTF-8 file bytes with CRLF normalized to LF',datasetVersion:dataset.version,annotation:dataset.annotation,splits:dataset.cases.map(c=>({id:c.id,split:c.split,expected:c.expected,task:c.task,length:c.length})),
    modelRevision:config.modelRevision,device:config.device,torchThreads:config.torchThreads,noCpuMemoryQuota:true,trainingPerformed:false,modelInstancesAtOnce:1,
    autonomousSuppressionAuthorized:false,qualification:'unqualified_report_only_no_automatic_promotion',
    trueConcurrentForwards:{state:'unavailable',reason:'Existing service single gate; packed groups independent requests, not simultaneous graph forwards'},
    coldInference:{state:'unavailable',reason:'Existing service performs internal readiness warmup; startup includes load and warmup, first request is not cold inference'},
    stages:[],rows:[],performance:[],cleanupErrors:[],teacherCalls:0,localSelectionRequests:0};
  const wallStart=performance.now();
  report.resourceMetrics={gpuMemory:'unavailable_in_existing_receipt',processRss:'unavailable_in_existing_receipt',externalSampling:'host_may_sample_actual_processes_separately'};
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(Math.min(2147483647,Date.parse(config.deadline)-Date.now()))]);
  const onStop=()=>controller.abort();process.once('SIGINT',onStop);process.once('SIGTERM',onStop);
  let service,closeStore=()=>{},store,teacher;const destination=join(directory,'report.json');
  const persist=async()=>{await writeFile(destination,JSON.stringify(report,null,2)+'\n');};
  const stage=async(name,fn)=>{const startedAtUtc=utc(),start=performance.now();let outcome='failed';try{const result=await fn();outcome='completed';return result;}
    finally{report.stages.push({stage:name,startedAtUtc,finishedAtUtc:utc(),wallMs:performance.now()-start,outcome});await persist();}};
  const receipts=new Map();
  async function start(policy){active(signal,config.deadline);assert.equal(service,undefined,'No second weight instance');
    service=await stage('local_service_start:'+policy,()=> (deps.startService??startLayaService)({python:config.python,modelPath:config.modelPath,port:config.port,
      device:config.device,torchThreads:config.torchThreads,pythonModulePath:config.pythonModulePath,cpuExecutionPolicy:policy,signal}));
    assert.equal(service.device,config.device);assert.equal(service.torchThreads,config.torchThreads);
    if(report.precision)assert.deepEqual(service.precision,report.precision,'Precision must match between service policies');
    assert.equal(hash(deps.fixture===true?Buffer.from('explicit-fixture-manifest'):await readFile(join(config.modelPath,'asset-manifest.json'))),report.modelManifestSha256,'Source model manifest changed');
    report.precision=service.precision;report.serviceWarmup='internal_startup_readiness_forward';
    return (deps.createSelector??createOwnedLayaSelector)({port:service.port,getApiKey:()=>service.key,isReady:service.isReady,cpuExecutionPolicy:policy,
      onDecision:receipt=>receipts.set(receipt.requestId,structuredClone(receipt))});
  }
  async function stop(){if(service){const original=service;await stage('local_service_stop',()=>original.stop());service=undefined;}}
  async function localOne(selector,input,requestId){active(signal,config.deadline);report.localSelectionRequests++;const start=performance.now(),actual={context:JSON.stringify({criteria:input.criteria,sources:input.sources,data:input.context}),candidates:input.candidates};
    let selectedId,error;try{selectedId=await selector.select({...actual,requestId,signal,deadline:config.deadline});}catch(e){error=safeError(e);}
    const receipt=receipts.get(requestId);return {selectedId:selectedId??null,...(error?{error}:{}),inputSha256:decisionDigest(actual),contextBytes:Buffer.byteLength(actual.context),
      wallMs:performance.now()-start,receipt:receipt??null,observedAtUtc:utc()};}
  try {
    report.modelManifestSha256=await stage('manifest_binding',async()=>hash(deps.fixture===true?Buffer.from('explicit-fixture-manifest'):await readFile(join(config.modelPath,'asset-manifest.json'))));
    let reused;
    if(teacherOnly){const bytes=await readFile(config.rawReportPath),original=JSON.parse(bytes);
      assert.equal(original.kind,deps.fixture===true?'offline_fixture_decision_acceptance':'real_native_decision_acceptance');
      assert.ok(['completed','completed_with_errors'].includes(original.status));assert.equal(original.datasetSha256,datasetSha256);
      assert.equal(original.modelRevision,config.modelRevision);assert.equal(original.modelManifestSha256,report.modelManifestSha256);
      assert.equal(original.rows.length,dataset.cases.length);assert.equal(new Set(original.rows.map(r=>r.caseId)).size,dataset.cases.length);
      for(const item of dataset.cases){const bound=modelInput(dataset,item),saved=original.rows.find(row=>row.caseId===item.id)?.rawLaya;
        assert.ok(saved);assert.equal(saved.inputSha256,decisionDigest({context:JSON.stringify({criteria:bound.criteria,sources:bound.sources,data:bound.context}),candidates:bound.candidates}),'Original raw report input mismatch');}
      reused=original;report.reusedRawReportSha256=hash(bytes);report.precision=structuredClone(original.precision);
      report.rawTimingScope='Reused historical raw samples, not inference performed during this teacher-only run';}
    if(deps.store){store=deps.store;}else{const {TaskRuntime}=await import('@personal-agent/runtime');const runtime=new TaskRuntime(join(directory,'decisions.sqlite'));
      const task=runtime.submitTask({goal:'Public synthetic decision acceptance only',conversationId:'v3-decision-acceptance',idempotencyKey:randomUUID()});
      store={read:key=>runtime.loadCheckpoint(task.taskId,key),writeOnce:(key,value)=>runtime.saveCheckpointOnce(task.taskId,key,value)};closeStore=()=>runtime.close();}
    if(config.teacherMode==='agentarts'){
      teacher=await stage('agentarts_teacher_binding',()=> (deps.createTeacher??createTestImageModelProvider)({...config.image,signal,deadline:config.deadline}));
      report.teacherDeployment=structuredClone(teacher.deployment);report.teacherProtocolLabel='Existing adaptive decided_by=deepseek; actual configured deployment metadata is authoritative';
    }
    const selector=teacherOnly?undefined:await start('sequential');let first=true;
    for(const item of dataset.cases){active(signal,config.deadline);const input=modelInput(dataset,item),requestId='quality-'+randomUUID();let rawResult;
      const observed={select:async()=>{
        if(teacherOnly){rawResult=structuredClone(reused.rows.find(row=>row.caseId===item.id)?.rawLaya);assert.ok(rawResult);
          assert.equal(rawResult.inputSha256,decisionDigest({context:JSON.stringify({criteria:input.criteria,sources:input.sources,data:input.context}),candidates:input.candidates}),'Raw input differs from frozen teacher case');}
        else rawResult=await localOne(selector,input,requestId);
        if(rawResult.error){const e=new Error('Local decision failed');e.code=rawResult.error.code;throw e;}return rawResult.selectedId;}};
      const row={caseId:item.id,task:item.task,split:item.split,length:item.length,firstRequestAfterReadiness:first,expected:item.expected};first=false;
      report.rows.push(row);
      try{if(teacher){const measuredTeacher={...teacher,complete:async request=>{report.teacherCalls++;const startedAtUtc=utc(),start=performance.now();let outcome='failed';
          try{const result=await teacher.complete(request);outcome='completed';return result;}finally{report.stages.push({stage:'teacher_call',caseId:item.id,startedAtUtc,finishedAtUtc:utc(),wallMs:performance.now()-start,outcome});}}};
        const adaptive=createAdaptiveWorkflowSelector({laya:observed,teacher:measuredTeacher,store,modelRevision:config.modelRevision,qualification:()=>false,verifyOutcome:()=>false});
        row.adaptive=await adaptive.decide({...input,requestId,signal,deadline:config.deadline});
      }else{await observed.select();row.adaptive={state:'unavailable',selectedId:null,reason:'Teacher explicitly not requested; raw local output is not qualified'};}}
      catch(e){row.adaptive={state:'failed',error:safeError(e),selectedId:null};}
      row.rawLaya=rawResult??{selectedId:null,error:{code:'NO_LOCAL_RESULT',type:'OperationError'}};await persist();
    }
    if(config.performance){const selected=config.performance.caseIds.map(id=>dataset.cases.find(c=>c.id===id));
      async function measure(local,policy){const arm={policy,precision:service.precision,modelManifestSha256:report.modelManifestSha256,serial:[],parallelRequests:[],groups:[]};report.performance.push(arm);
        for(let round=0;round<config.performance.rounds;round++)for(const mode of ['serial','parallelRequests']){active(signal,config.deadline);const start=performance.now();
          const one=async item=>({caseId:item.id,...await localOne(local,modelInput(dataset,item),'perf-'+randomUUID())});let rows;
          if(mode==='serial'){rows=[];for(const item of selected)rows.push(await one(item));}else rows=await Promise.all(selected.map(one));
          arm[mode].push(...rows);arm.groups.push({round,mode,requests:4,totalWallMs:performance.now()-start});await persist();}
        arm.summary={serial:latencySummary(arm.serial),parallelRequests:latencySummary(arm.parallelRequests)};
        arm.choicesStable=arm.parallelRequests.every(row=>!row.error&&arm.serial.filter(s=>s.caseId===row.caseId).every(s=>!s.error&&s.selectedId===row.selectedId));
      }
      await measure(selector,'sequential');await stop();const packed=await start('packed');await measure(packed,'packed');
    }
    report.scores={rawLaya:scoreRows(dataset,report.rows,'rawLaya'),adaptive:config.teacherMode==='agentarts'?scoreRows(dataset,report.rows,'adaptive'):null};
    report.qualityLatency={scope:teacherOnly?report.rawTimingScope:'Mixed quality cases, not repeated old short benchmark; startup and first post-readiness request separate',
      firstPostReadiness:report.rows[0]?.rawLaya??null,
      steadyByLength:Object.fromEntries(['short','long'].map(length=>[length,latencySummary(report.rows.filter(row=>!row.firstRequestAfterReadiness&&row.length===length).map(row=>row.rawLaya))]))};
    report.status=report.rows.every(row=>!row.rawLaya.error&&row.adaptive.state!=='failed')&&report.performance.every(arm=>arm.serial.every(r=>!r.error)&&arm.parallelRequests.every(r=>!r.error))?'completed':'completed_with_errors';
  }catch(e){report.status='failed';report.error=safeError(e);}
  finally{controller.abort();try{await stop();}catch(e){report.cleanupErrors.push(safeError(e));report.status='failed';}
    try{closeStore();}catch(e){report.cleanupErrors.push(safeError(e));report.status='failed';}
    report.scores??={rawLaya:scoreRows(dataset,report.rows,'rawLaya'),adaptive:config.teacherMode==='agentarts'?scoreRows(dataset,report.rows,'adaptive'):null};
    process.removeListener('SIGINT',onStop);process.removeListener('SIGTERM',onStop);report.finishedAtUtc=utc();report.wallMs=performance.now()-wallStart;await persist();}
  return {report,directory,destination};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {
  assert.ok(process.argv.includes('--live'),'Real model acceptance requires --live and explicit stdin config');
  const chunks=[];for await(const part of process.stdin)chunks.push(part);
  const {report,destination}=await runDecisionAcceptance(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  console.log(JSON.stringify({report:destination,status:report.status,datasetSha256:report.datasetSha256,localSelectionRequests:report.localSelectionRequests,teacherCalls:report.teacherCalls,autonomousSuppressionAuthorized:false}));
  if(report.status!=='completed')process.exitCode=1;
  }catch(error){console.error(JSON.stringify({status:'configuration_or_entry_failed',error:safeError(error)}));process.exitCode=1;}
}

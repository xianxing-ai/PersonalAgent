import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateDataset,modelInput,scoreRows,latencySummary,runDecisionAcceptance,datasetPath,FROZEN_DATASET_SHA256} from './v3-decision-acceptance.mjs';
const bytes=await readFile(datasetPath),dataset=validateDataset(JSON.parse(bytes));
const config=()=>({python:'explicit-fixture-no-python',modelPath:'explicit-fixture-no-weights',port:49123,device:'cuda',torchThreads:1,
  modelRevision:'explicit-fixture-revision',datasetSha256:FROZEN_DATASET_SHA256,deadline:new Date(Date.now()+60000).toISOString(),
  teacherMode:'agentarts',image:{url:'http://127.0.0.1:49124/invocations',token:'explicit-fixture-not-a-real-key'},performance:{caseIds:['case04','case10','case16','case22'],rounds:1}});
function fixture({rejectFirst=false,invalidTeacher=false}={}){
  let active=0,maximum=0,calls=0,teacherCalls=0;const store=new Map(),policies=[],prompts=[];
  return {stats:()=>({active,maximum,calls,teacherCalls,policies,prompts}),deps:{fixture:true,
    store:{read:key=>store.get(key),writeOnce:(key,value)=>{if(store.has(key))return false;store.set(key,structuredClone(value));return true;}},
    startService:async options=>{assert.equal(active,0);active++;maximum=Math.max(maximum,active);policies.push(options.cpuExecutionPolicy);
      return {port:49123,key:'fixture-local-key',device:options.device,torchThreads:options.torchThreads,isReady:()=>true,precision:{autocastEnabled:true,autocastDtype:'fixture-bf16'},stop:async()=>{active--;}};},
    createSelector:options=>({select:async request=>{calls++;prompts.push(request.context);
      if(rejectFirst&&calls===1){options.onDecision({requestId:request.requestId,event:'laya_rejected',errorCode:'CONTEXT_WINDOW_EXCEEDED'});const e=Error('fixture refusal');e.code='UNSUPPORTED_CAPABILITY';throw e;}
      options.onDecision({requestId:request.requestId,event:'laya_choice',encodedTokens:400,queueWaitMs:2,batchSize:options.cpuExecutionPolicy==='packed'?4:1,
        inferenceMetrics:{forwardMs:3,processCpuMs:4},executionPolicy:options.cpuExecutionPolicy});return request.candidates[0].id;}}),
    createTeacher:async()=>({deployment:{provider:'explicit_fixture',model:'no_real_model',deployment:'fixture'},complete:async request=>{
      teacherCalls++;prompts.push(...request.messages.map(m=>m.content));return {deployment:{provider:'explicit_fixture',model:'no_real_model',deployment:'fixture'},
        response:{kind:'final',text:invalidTeacher?'not JSON':JSON.stringify({selectedId:'review',rationale:'Explicit synthetic teacher fixture'})},latencyMs:1,usage:null};}})}};
}

test('frozen host synthetic dataset has balanced independent splits and pinned exact bytes',()=>{
  assert.equal(createHash('sha256').update(bytes.toString('utf8').replace(/\r\n/g,'\n')).digest('hex'),FROZEN_DATASET_SHA256);assert.equal(dataset.cases.length,24);
  for(const task of Object.keys(dataset.tasks))for(const split of ['development','holdout'])assert.equal(dataset.cases.filter(c=>c.task===task&&c.split===split).length,3);
  assert.equal(dataset.cases.filter(c=>c.length==='long').length,8);assert.match(dataset.annotation,/not human gold/);
});
test('model input allowlist never includes holdout/development labels or expected host answers',()=>{
  for(const row of dataset.cases){const input=modelInput(dataset,row),serialized=JSON.stringify(input);
    assert.equal('expected' in input,false);assert.equal('split' in input,false);assert.equal('caseId' in input,false);
    assert.ok(!serialized.includes('"expected"')&&!serialized.includes('"split"'));
    const poisoned=modelInput(dataset,{...row,expected:'HOST_LABEL_SENTINEL',split:'HOST_SPLIT_SENTINEL'});
    assert.deepEqual(poisoned,input);if(row.length==='long')assert.ok(Buffer.byteLength(input.context)>3000);
  }
});
test('FP/FN, review abstention, rejection and unattempted cases are distinct host scoring outcomes',()=>{
  const rows=[{caseId:'case01',raw:{selectedId:'routine'}},{caseId:'case02',raw:{selectedId:'important'}},{caseId:'case03',raw:{selectedId:'review'}},
    {caseId:'case04',raw:{selectedId:null,receipt:{event:'laya_rejected'},error:{code:'UNSUPPORTED_CAPABILITY'}}}];
  const scores=scoreRows(dataset,rows,'raw');assert.equal(scores['development:mail_importance'].FN,1);assert.equal(scores['development:mail_importance'].FP,1);
  assert.equal(scores['development:mail_importance'].abstained,1);assert.equal(scores['development:mail_importance'].correct,1);
  assert.equal(scores['holdout:mail_importance'].rejected,1);assert.equal(scores['holdout:mail_importance'].errors,1);
  assert.equal(scores['holdout:mail_importance'].notAttempted,2);assert.equal(scores['holdout:mail_importance'].unresolvedPositive,1);
});
test('latency percentiles do not silently count failed requests as fast successes',()=>{
  assert.deepEqual(latencySummary([{wallMs:1},{wallMs:2},{wallMs:100,error:{code:'fixture'}}]),{attempts:3,samples:2,errors:1,p50Ms:2,p95Ms:2,maximumMs:2});
  assert.equal(latencySummary([]).p95Ms,null);
});
test('explicit offline fixture runs raw plus teacher, same-input modes and only one service instance',async()=>{
  const f=fixture(),result=await runDecisionAcceptance(config(),f.deps),report=result.report;
  assert.equal(report.kind,'offline_fixture_decision_acceptance');assert.equal(report.status,'completed');assert.equal(report.rows.length,24);
  assert.equal(report.teacherCalls,24);assert.ok(report.rows.every(row=>row.adaptive.decided_by==='deepseek'&&row.adaptive.teacher.provider==='explicit_fixture'));
  assert.equal(report.autonomousSuppressionAuthorized,false);assert.equal(report.qualification,'unqualified_report_only_no_automatic_promotion');
  assert.equal(report.coldInference.state,'unavailable');assert.equal(report.trueConcurrentForwards.state,'unavailable');
  assert.equal(f.stats().maximum,1);assert.equal(f.stats().active,0);assert.deepEqual(f.stats().policies,['sequential','packed']);
  assert.equal(report.performance.length,2);assert.equal(report.performance[0].serial.length,4);assert.equal(report.performance[1].parallelRequests.length,4);
  for(const arm of report.performance)for(const row of arm.serial){const other=arm.parallelRequests.find(r=>r.caseId===row.caseId);assert.equal(row.inputSha256,other.inputSha256);}
  assert.ok(f.stats().prompts.every(prompt=>!prompt.includes('"expected"')&&!prompt.includes('"split"')));
  const saved=JSON.parse(await readFile(result.destination));assert.equal(saved.status,'completed');
  assert.equal(JSON.stringify(saved).includes(config().image.token),false);assert.equal(JSON.stringify(saved).includes('explicit-fixture-no-weights'),false);
});
test('local context refusal still escalates actual teacher, and invalid teacher cannot become qualified output',async()=>{
  const f=fixture({rejectFirst:true,invalidTeacher:true});const result=await runDecisionAcceptance({...config(),performance:null},f.deps);
  assert.equal(result.report.status,'completed_with_errors');assert.equal(result.report.rows[0].rawLaya.receipt.event,'laya_rejected');
  assert.equal(result.report.rows[0].adaptive.state,'failed');assert.equal(result.report.teacherCalls,24);assert.equal(f.stats().active,0);
  assert.equal(result.report.autonomousSuppressionAuthorized,false);assert.ok(result.report.rows.every(row=>!row.adaptive.selectedId));
});
test('explicitly local-only mode makes no teacher claim or cloud call; frozen SHA mismatch starts nothing',async()=>{
  const f=fixture(),local=await runDecisionAcceptance({...config(),teacherMode:'none',image:undefined,performance:null},f.deps);
  assert.equal(local.report.teacherCalls,0);assert.equal(f.stats().teacherCalls,0);assert.equal(local.report.scores.adaptive,null);
  const untouched=fixture();await assert.rejects(runDecisionAcceptance({...config(),datasetSha256:'0'.repeat(64)},untouched.deps),/frozen before/);
  assert.equal(untouched.stats().calls,0);assert.equal(untouched.stats().active,0);
});
test('teacher-only reuses bound raw choices and input hashes with zero local starts or performance reruns',async()=>{
  const initial=fixture(),raw=await runDecisionAcceptance({...config(),teacherMode:'none',performance:null},initial.deps);
  const teacher=fixture(),result=await runDecisionAcceptance({...config(),mode:'teacher_only',rawReportPath:raw.destination,performance:null},teacher.deps);
  assert.equal(result.report.status,'completed');assert.equal(result.report.localSelectionRequests,0);assert.equal(result.report.teacherCalls,24);
  assert.equal(teacher.stats().active,0);assert.equal(teacher.stats().calls,0);assert.deepEqual(teacher.stats().policies,[]);
  assert.equal(result.report.performance.length,0);assert.match(result.report.reusedRawReportSha256,/^[a-f0-9]{64}$/);
  assert.match(result.report.rawTimingScope,/historical/);assert.deepEqual(result.report.rows[0].rawLaya,raw.report.rows[0].rawLaya);
  const modified=structuredClone(raw.report);modified.rows[0].rawLaya.inputSha256='0'.repeat(64);
  const badPath=raw.destination+'.tampered-fixture.json';await writeFile(badPath,JSON.stringify(modified));const blocked=fixture();
  const bad=await runDecisionAcceptance({...config(),mode:'teacher_only',rawReportPath:badPath,performance:null},blocked.deps);
  assert.equal(bad.report.status,'failed');assert.equal(blocked.stats().teacherCalls,0);assert.deepEqual(blocked.stats().policies,[]);
});

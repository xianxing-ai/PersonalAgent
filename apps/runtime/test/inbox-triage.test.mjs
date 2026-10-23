import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {LayaTriageService} from '@personal-agent/cognition';
import {createEncryptedModuleStorage} from '../../desktop/electron/encrypted-module-storage.js';
import {createInboxTriagePipeline} from '../src/application/inbox-triage.ts';

const safeStorage = {isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value).reverse(),
  decryptString: value => Buffer.from(value).reverse().toString()};
const answer = (choice, probabilities) => ({choice, probabilities,
  answer_confidence: Math.max(...Object.values(probabilities)), confidence: 0.42});
const items = Array.from({length: 5}, (_, index) => ({source: 'mail', accountRef: 'fixture',
  externalId: `INBOX:${index + 1}`, occurredAt: '2026-09-27T00:00:00.000Z',
  fetchedAt: '2026-09-27T01:00:00.000Z', contentRef: `subject ${index + 1}`,
  sensitivity: 'private', dedupeKey: `fixture:1:INBOX:${index + 1}:message-${index + 1}`}));
const context = () => ({deadline: new Date(Date.now() + 60000).toISOString(),
  signal: new AbortController().signal});
const cacheRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..', '.cache', 'runtime-tests');

test('trusted retry restores only the original accepted cached source without a cloud result',async()=>{
  let saved,fingerprint='original-policy';
  const storage={get:()=>structuredClone(saved),set:(_key,value)=>{saved=structuredClone(value);}};
  const triage=new LayaTriageService({async infer(){return {answers:{category_0:answer('meeting',{meeting:.9,other:.1}),
    impact_0:answer('high_impact',{routine:.1,high_impact:.9})}};}});
  const open=()=>createInboxTriagePipeline({storage,namespace:'trusted-retry',triage,labels:{meeting:'Meeting',other:'Other'},
    getClassifierFingerprint:()=>fingerprint,authorizeRead:()=>true});
  const pipeline=open();await pipeline.processPage({...context(),accountRef:'fixture',folder:'INBOX',items:[items[0]],nextCursor:'1:1',hasMore:false});
  const [pending]=pipeline.pendingReviewAnalyses(context()),binding={workKey:pending.workKey,sourceRevision:pending.sourceRevision,
    receiptId:pending.receipt.id,projectionDigest:pending.projectionDigest},retry={...binding,previousTaskId:'failed-before-send'};
  pipeline.confirmCachedAnalysisAccepted({...binding,taskId:retry.previousTaskId},context());fingerprint=undefined;
  const before=pipeline.snapshot().records;
  assert.throws(()=>pipeline.retryCachedAnalysis({...retry,previousTaskId:'another-task'},context()),{code:'REVISION_CONFLICT'});
  const originalHead={...saved.heads[pending.messageId]};saved.heads[pending.messageId].sourceRevision='changed-source';
  assert.throws(()=>open().retryCachedAnalysis(retry,context()),{code:'REVISION_CONFLICT'});saved.heads[pending.messageId]=originalHead;
  assert.deepEqual(pipeline.retryCachedAnalysis(retry,context()),pending);
  assert.equal(pipeline.readReviewAnalysis(pending.workKey,context()).taskId,undefined);
  assert.deepEqual(pipeline.snapshot().records,before,'retry preserves local classifications and source metadata');
  assert.throws(()=>pipeline.retryCachedAnalysis(retry,context()),{code:'REVISION_CONFLICT'});
  pipeline.confirmCachedAnalysisAccepted({...binding,taskId:'replacement-task'},context());
  pipeline.applyCachedAnalysisReview({...binding,taskId:'replacement-task',review:{version:1,label:'other',impact:'routine',
    notificationRecommendation:'none',reasonCode:'other'}},context());
  assert.throws(()=>pipeline.retryCachedAnalysis({...binding,previousTaskId:'replacement-task'},context()),{code:'REVISION_CONFLICT'});
});

test('reclassification preserves first observation and never refreshes legacy unknown mail into new cloud work',async()=>{
  let saved,fingerprint='original-policy';
  const storage={get:()=>structuredClone(saved),set:(_key,value)=>{saved=structuredClone(value);}};
  const triage=new LayaTriageService({async infer(payload){return {answers:Object.fromEntries(payload.state.events.flatMap((_,index)=>[
    [`category_${index}`,answer('meeting',{meeting:.9,other:.1})],
    [`impact_${index}`,answer('high_impact',{routine:.1,high_impact:.9})],
  ]))};}});
  const open=()=>createInboxTriagePipeline({storage,namespace:'first-observation',triage,labels:{meeting:'Meeting',other:'Other'},
    getClassifierFingerprint:()=>fingerprint,authorizeRead:()=>true});
  const page=rows=>({...context(),accountRef:'fixture',folder:'INBOX',items:rows,nextCursor:'1:1',hasMore:false});
  await open().processPage(page(items.slice(0,2)));
  const originalAnalyses=Object.values(saved.analyses),first=originalAnalyses.find(row=>row.projection.text===items[0].contentRef),
    legacy=originalAnalyses.find(row=>row.projection.text===items[1].contentRef);
  delete saved.heads[legacy.messageId].firstObservedAt;
  delete saved.records[saved.latest[legacy.messageId]].receiptId;
  fingerprint='updated-policy';const pipeline=open(),watermark='2026-10-23T00:00:00.000Z';
  await pipeline.processPage(page(items.slice(0,3).map(row=>({...row,fetchedAt:watermark}))));
  const pending=pipeline.pendingReviewAnalyses(context()),firstPending=pending.find(row=>row.messageId===first.messageId),
    legacyPending=pending.find(row=>row.messageId===legacy.messageId),fresh=pending.find(row=>row.projection.text===items[2].contentRef);
  assert.equal(firstPending.observedAt,items[0].fetchedAt,'model changes preserve the first trusted observation');
  assert.equal(legacyPending.observedAt,undefined,'known legacy mail cannot acquire a new observation date');
  assert.equal(fresh.observedAt,watermark,'genuinely unseen mail gets its first trusted observation');
  assert.deepEqual(pipeline.pendingReviewAnalyses(context(),{observedAtOrAfter:watermark}).map(row=>row.workKey),[fresh.workKey]);
  await pipeline.processPage(page([{...items[0],contentRef:'changed source header',fetchedAt:'2026-10-24T00:00:00.000Z'}]));
  assert.equal(pipeline.pendingReviewAnalyses(context()).find(row=>row.messageId===first.messageId).observedAt,items[0].fetchedAt,
    'source changes also preserve the original observation');
});

test('filtered analysis admission clones at most one envelope from 6006 historical records',async t=>{
  let saved;
  const storage={get:()=>structuredClone(saved),set:(_key,value)=>{saved=structuredClone(value);}};
  const triage=new LayaTriageService({async infer(){return {answers:{category_0:answer('meeting',{meeting:.9,other:.1}),
    impact_0:answer('high_impact',{routine:.1,high_impact:.9})}};}});
  const options={storage,namespace:'bounded-filter',triage,labels:{meeting:'Meeting',other:'Other'},classifierFingerprint:'fixed',authorizeRead:()=>true};
  const first=createInboxTriagePipeline(options);
  await first.processPage({...context(),accountRef:'fixture',folder:'INBOX',items:[items[0]],nextCursor:'1:1',hasMore:false});
  const original=first.pendingAnalyses(context())[0],watermark='2026-10-23T00:00:00.000Z';
  saved.analyses={};saved.heads={};
  for(let i=0;i<6006;i++){
    const key='work-'+i,messageId='message-'+i;
    saved.analyses[key]={...structuredClone(original),workKey:key,messageId,accountRef:'fixture',folder:'INBOX',classifierFingerprint:'fixed',
      ...(i===6005?{observedAt:watermark}:i===6004?{observedAt:'invalid'}:i===6003?{observedAt:undefined}:{observedAt:'2026-01-01T00:00:00.000Z'})};
    if(i===6003)delete saved.analyses[key].observedAt;
    saved.heads[messageId]={sourceRevision:original.sourceRevision,fetchedAt:items[0].fetchedAt};
  }
  const pipeline=createInboxTriagePipeline(options);assert.deepEqual(pipeline.pendingAnalyses(context(),{}),[]);
  let clones=0;const clone=globalThis.structuredClone;
  const mock=t.mock.method(globalThis,'structuredClone',value=>{clones++;return clone(value);});
  const result=pipeline.pendingAnalyses(context(),{observedAtOrAfter:watermark,limit:1});
  assert.equal(result.length,1);assert.equal(result[0].workKey,'work-6005');assert.equal(clones,1);
  mock.mock.restore();
  assert.equal(pipeline.pendingAnalyses(context(),{workKeys:['work-6003'],limit:1})[0].observedAt,undefined,'explicit selected legacy binding remains admissible');
  assert.deepEqual(pipeline.pendingAnalyses(context(),{observedAtOrAfter:watermark,excludeWorkKeys:['work-6005'],limit:1}),[]);
  assert.equal(pipeline.pendingAnalyses(context()).length,6006,'unfiltered legacy behavior is preserved');
});

test('cached review filters historical metadata before hashing and still validates eligible sources',async t=>{
  let saved,authorizationChecks=0;
  const storage={get:()=>structuredClone(saved),set:(_key,value)=>{saved=structuredClone(value);}};
  const triage=new LayaTriageService({async infer(){return {answers:{category_0:answer('meeting',{meeting:.9,other:.1}),
    impact_0:answer('high_impact',{routine:.1,high_impact:.9})}};}});
  const options={storage,namespace:'cached-eligibility',triage,labels:{meeting:'Meeting',other:'Other'},classifierFingerprint:'fixed',
    authorizeRead:()=>{authorizationChecks++;return true;}};
  const seed=createInboxTriagePipeline(options);
  await seed.processPage({...context(),accountRef:'fixture',folder:'INBOX',items:[items[0]],nextCursor:'1:1',hasMore:false});
  const original=Object.values(saved.analyses)[0],originalRow=Object.values(saved.records)[0],watermark='2026-10-23T00:00:00.000Z';
  saved.analyses={};saved.heads={};saved.records={};saved.latest={};
  for(let i=0;i<6006;i++){
    const workKey='work-'+i,messageId='message-'+i,recordKey='record-'+i;
    saved.analyses[workKey]={...structuredClone(original),workKey,messageId,observedAt:i<6000?'2026-01-01T00:00:00.000Z':watermark,
      ...(i===6001?{state:'accepted',taskId:'already-accepted'}:i===6002?{state:'deferred'}:{})};
    if(i===6003)delete saved.analyses[workKey].observedAt;
    saved.heads[messageId]={sourceRevision:original.sourceRevision,fetchedAt:items[0].fetchedAt};
    saved.latest[messageId]=recordKey;saved.records[recordKey]={...structuredClone(originalRow),messageId,
      ...(i===6004?{receiptId:'different-source-receipt'}:{})};
  }
  const pipeline=createInboxTriagePipeline(options);
  assert.deepEqual(pipeline.pendingReviewAnalyses(context(),{}),[],'load validates the durable cache once');
  let projectionHashes=0;const stringify=JSON.stringify;authorizationChecks=0;
  t.mock.method(JSON,'stringify',(value,...args)=>{
    if(value?.headersOnly===true&&value?.sensitivity==='private'&&typeof value?.text==='string')projectionHashes++;
    return stringify(value,...args);
  });
  const result=pipeline.pendingReviewAnalyses(context(),{observedAtOrAfter:watermark,excludeWorkKeys:['work-6000'],limit:1});
  assert.deepEqual(result.map(row=>row.workKey),['work-6005'],'eligible receipt mismatch is rejected before returning the valid candidate');
  assert.equal(projectionHashes,1,'6004 ineligible historical entries never rehash projections; the valid candidate still does');
  assert.equal(authorizationChecks,1,'the eligible valid candidate still passes its current read authorization');
});

test('cloud review stays independently bound, strict and durable without rewriting local judgments',async()=>{
  const values=new Map();let failSave=false,fingerprint='policy-v1';
  const storage={get:key=>structuredClone(values.get(key)),set:(key,value)=>{if(failSave)throw Error('Synthetic save failure');values.set(key,structuredClone(value));}};
  const triage=new LayaTriageService({async infer(){return {answers:{category_0:answer('meeting',{meeting:.9,other:.1}),
    impact_0:answer('high_impact',{routine:.1,high_impact:.9})}};}});
  const open=()=>createInboxTriagePipeline({storage,namespace:'review-binding',triage,labels:{meeting:'Meeting',other:'Other'},
    getClassifierFingerprint:()=>fingerprint,authorizeRead:()=>true});
  const pipeline=open();
  const page=()=>({...context(),accountRef:'fixture',folder:'INBOX',items:[items[0]],nextCursor:'1:1',hasMore:false});
  await pipeline.processPage(page());const [pending]=pipeline.pendingAnalyses(context());
  assert.equal(pending.observedAt,items[0].fetchedAt);
  const legacyValues=structuredClone([...values]);
  for(const [,state]of legacyValues)for(const analysis of Object.values(state.analyses))delete analysis.observedAt;
  const legacy=createInboxTriagePipeline({storage:{get:key=>structuredClone(new Map(legacyValues).get(key)),set:()=>{}},
    namespace:'review-binding',triage,labels:{meeting:'Meeting',other:'Other'},getClassifierFingerprint:()=>fingerprint,authorizeRead:()=>true});
  assert.equal(legacy.pendingAnalyses(context())[0].observedAt,undefined);
  const binding={workKey:pending.workKey,sourceRevision:pending.sourceRevision,receiptId:pending.receipt.id,
    projectionDigest:pending.projectionDigest,taskId:'original-cloud-task'};
  const review={version:1,label:'other',impact:'routine',notificationRecommendation:'none',reasonCode:'other'};
  const input={...binding,review};
  assert.throws(()=>pipeline.applyAnalysisReview(input,context()),{code:'REVISION_CONFLICT'});
  pipeline.confirmAnalysisAccepted(binding,context());
  const before=pipeline.snapshot().records[0];
  for(const key of ['taskId','workKey','sourceRevision','receiptId','projectionDigest'])
    assert.throws(()=>pipeline.applyAnalysisReview({...input,[key]:'different'},context()),{code:'REVISION_CONFLICT'});
  for(const bad of [{...review,extra:'PRIVATE'},{...review,label:'invented'},{...review,impact:'execute'},
    {...review,reasonCode:'PRIVATE'},{...review,notificationRecommendation:'send'}])
    assert.throws(()=>pipeline.applyAnalysisReview({...input,review:bad},context()),{code:'INVALID_ARGUMENT'});
  const cancelled=new AbortController();cancelled.abort();
  assert.throws(()=>pipeline.applyAnalysisReview(input,{...context(),signal:cancelled.signal}),{code:'CANCELLED'});
  assert.throws(()=>pipeline.applyAnalysisReview(input,{...context(),deadline:new Date(0).toISOString()}),{code:'TIMEOUT'});
  fingerprint='policy-v2';assert.throws(()=>pipeline.applyAnalysisReview(input,context()),{code:'REVISION_CONFLICT'});fingerprint='policy-v1';
  failSave=true;assert.throws(()=>pipeline.applyAnalysisReview(input,context()),/Synthetic save failure/);failSave=false;
  assert.equal(pipeline.snapshot().records[0].cloudReview,undefined);
  const applied=pipeline.applyAnalysisReview(input,context());
  assert.deepEqual(applied.cloudReview.review,review);
  const {cloudReview,...local}=applied;assert.deepEqual(local,before);
  assert.deepEqual(pipeline.applyAnalysisReview(input,context()),applied);
  const snapshot=pipeline.snapshot(),effective=snapshot.records[0].effectiveClassification;
  assert.deepEqual(effective,{source:'cloud-review',label:'other',route:'group',needsReview:false,highImpactCandidate:false,meetingCandidate:false});
  assert.equal(snapshot.records[0].label,'meeting');assert.equal(snapshot.needsReview,0);assert.equal(snapshot.cloudReviewed,1);
  assert.deepEqual(snapshot.groups,{other:1});
  assert.deepEqual(open().snapshot(),snapshot,'reopen derives the same effective classification from its original bindings');
  assert.deepEqual(pipeline.summary(),pipeline.summary(),'incremental reads do not count a review twice');
  fingerprint='policy-v2';assert.equal(pipeline.snapshot().cloudReviewed,1);assert.deepEqual(pipeline.snapshot().records[0].effectiveClassification,effective);
  assert.equal(pipeline.snapshot().records[0].classifierStale,true);
  fingerprint='policy-v1';assert.equal(pipeline.snapshot().cloudReviewed,1);
  assert.throws(()=>pipeline.applyAnalysisReview({...input,review:{...review,label:'meeting'}},context()),{code:'REVISION_CONFLICT'});
  await pipeline.processPage({...page(),items:[{...items[0],contentRef:'Changed source'}]});
  assert.equal(pipeline.snapshot().cloudReviewed,0);
  assert.throws(()=>pipeline.applyAnalysisReview(input,context()),{code:'REVISION_CONFLICT'});
});

test('local classification diagnostics preserve bounded scores without model extras and tolerate legacy rows', async () => {
  const values=new Map(),storage={get:key=>structuredClone(values.get(key)),set:(key,value)=>values.set(key,structuredClone(value))};
  const service=new LayaTriageService({async infer(){return {answers:{
    category_0:answer('meeting',{meeting:0.6,other:0.4}),impact_0:answer('routine',{routine:0.9,high_impact:0.1})}};}});
  const triage={async classify(input){return (await service.classify(input)).map(row=>({...row,
    privateText:'PRIVATE EXTRA',scores:{...row.scores,privateText:'PRIVATE EXTRA'}}));}};
  const options={storage,namespace:'safe-diagnostics',triage,labels:{meeting:'Meeting',other:'Other'},
    classifierFingerprint:'fixture-v1',authorizeRead:()=>true};
  const pipeline=createInboxTriagePipeline(options);
  await pipeline.processPage({...context(),accountRef:'fixture',folder:'INBOX',items:[items[0]],nextCursor:'1:1',hasMore:false});
  const [row]=pipeline.snapshot().records;
  assert.equal(row.label,null);assert.equal(row.classificationReason,'high_impact');assert.equal(row.candidateLabel,'meeting');
  assert.deepEqual(row.scores,{choice:'meeting',probabilities:{meeting:0.6,other:0.4},answerConfidence:0.6,
    entropyConcentration:0.42,margin:0.6-0.4});
  assert.equal(row.impactScores.choice,'routine');assert.equal(JSON.stringify([...values]).includes('PRIVATE EXTRA'),false);
  const saved=[...values.values()][0];
  for(const record of Object.values(saved.records))for(const key of ['classificationReason','candidateLabel','scores','impactScores'])delete record[key];
  values.set([...values.keys()][0],saved);
  const reopened=createInboxTriagePipeline(options);
  assert.equal(reopened.snapshot().total,1);assert.equal(reopened.snapshot().records[0].classificationReason,undefined);
});

test('encrypted inbox persistence: partial retry, revision replacement and no fabricated public facts', async () => {
  await mkdir(cacheRoot, {recursive: true});
  const userData = await mkdtemp(path.join(cacheRoot, 'pa-triage-'));
  let failLast = true, authorized = true;
  const calls = [];
  const triage = new LayaTriageService({async infer(payload) {
    const observations = payload.state.events.map(event => event.observation);
    calls.push(observations);
    if (failLast && observations.includes('subject 5')) throw Error('Laya temporarily unavailable');
    return {answers: Object.fromEntries(observations.flatMap((_text, index) => [
      [`category_${index}`, answer('meeting', {meeting: 0.9, other: 0.1})],
      [`impact_${index}`, answer('high_impact', {routine: 0.1, high_impact: 0.9})],
    ]))};
  }});
  let classifierFingerprint = 'fixture-policy-v1';
  const open = () => createInboxTriagePipeline({storage: createEncryptedModuleStorage({userData,
    safeStorage, filename: 'mail-classification.json'}), namespace: 'synthetic-user', triage,
  labels: {meeting: 'Meeting-related subject needing source review', other: 'Other'},
  meetingLabels: ['meeting'], classifierFingerprint, authorizeRead: () => authorized});
  const page = () => ({...context(), accountRef: 'fixture', folder: 'INBOX', nextCursor: '1:5',
    hasMore: false, items});
  try {
    let pipeline = open();
    const partial = await pipeline.processPage(page());
    assert.equal(partial.complete, false);
    assert.equal(partial.classified, 4);
    assert.equal(pipeline.cursor('fixture', 'INBOX'), undefined);
    assert.equal(pipeline.snapshot().total, 4);
    const unfinished = pipeline.pendingAnalyses(context());
    assert.equal(unfinished.length, 5);
    assert.equal(unfinished.filter(item => item.state === 'deferred').length, 1);
    assert.ok(unfinished.every(item => item.projection.headersOnly && item.projection.sensitivity === 'private'));
    const file = await readFile(path.join(userData, 'mail-classification.json'), 'utf8');
    assert.doesNotMatch(file, /subject [1-5]|validFrom/);
    const decoded = safeStorage.decryptString(Buffer.from(JSON.parse(file).encrypted, 'base64'));
    assert.match(decoded, /subject 1/); // Host-owned header projection survives restart for analysis.
    failLast = false;
    pipeline = open();
    const resumed = await pipeline.processPage(page());
    assert.equal(resumed.classified, 1);
    assert.equal(resumed.reused, 4);
    assert.equal(pipeline.cursor('fixture', 'INBOX'), '1:5');
    const toAccept = pipeline.pendingAnalyses(context()).find(item => item.projection.text === 'subject 1');
    assert.ok(toAccept);
    const acceptance = {workKey: toAccept.workKey, sourceRevision: toAccept.sourceRevision,
      receiptId: toAccept.receipt.id, projectionDigest: toAccept.projectionDigest, taskId: 'runtime-analysis-1'};
    const accepted = pipeline.confirmAnalysisAccepted(acceptance, context());
    assert.equal(accepted.state, 'accepted');
    assert.equal(pipeline.confirmAnalysisAccepted(acceptance, context()).taskId, acceptance.taskId);
    assert.equal(pipeline.readAnalysis(toAccept.workKey, context()).state, 'accepted');
    assert.throws(() => pipeline.confirmAnalysisAccepted({...acceptance, taskId: 'other-task'}, context()),
      {code: 'REVISION_CONFLICT'});
    assert.throws(() => pipeline.confirmAnalysisAccepted({...acceptance, receiptId: 'wrong'}, context()),
      {code: 'REVISION_CONFLICT'});
    const callCount = calls.length;
    pipeline = open();
    const replay = await pipeline.processPage({...page(),
      items: items.map(item => ({...item, fetchedAt: '2026-09-27T02:00:00.000Z'}))});
    assert.equal(replay.classified, 0);
    assert.equal(calls.length, callCount);
    assert.equal(pipeline.readCursor({...context(), accountRef:'fixture', folder:'INBOX'}), '1:5');
    classifierFingerprint = 'fixture-policy-v2'; pipeline = open();
    assert.equal(pipeline.snapshot().needsReview, 5);
    assert.equal(pipeline.snapshot().meetingCandidates, 0);
    assert.deepEqual(pipeline.pendingAnalyses(context()), []);
    assert.equal(pipeline.readAnalysis(toAccept.workKey, context()), undefined);
    const policyRefresh = await pipeline.processPage({...page(), cursor:'1:5'});
    assert.equal(policyRefresh.classified, 5);
    assert.equal(pipeline.pendingAnalyses(context()).length, 4); // Accepted work is never resubmitted.
    classifierFingerprint = 'fixture-policy-v1'; pipeline = open();
    assert.equal(pipeline.readAnalysis(toAccept.workKey, context()).state, 'accepted');
    classifierFingerprint = 'fixture-policy-v2'; pipeline = open();
    const changed = await pipeline.processPage({...page(),
      items: items.map((item, index) => index === 0 ? {...item,
        fetchedAt: '2026-09-27T03:00:00.000Z', contentRef: 'revised meeting subject'} : item)});
    assert.equal(changed.classified, 1);
    assert.equal(changed.summary.total, 5);
    assert.equal(changed.summary.meetingCandidates, 5);
    assert.ok(pipeline.snapshot().records.every(item => item.headersOnly && item.sensitivity === 'private' && item.needsReview));
    assert.doesNotMatch(JSON.stringify(changed.summary), /revised meeting subject|validFrom/);
    assert.equal(pipeline.readAnalysis(toAccept.workKey, context()), undefined);
    const current = pipeline.pendingAnalyses(context()).find(item => item.messageId === toAccept.messageId);
    assert.ok(current);
    assert.notEqual(current.sourceRevision, toAccept.sourceRevision);
    assert.throws(() => pipeline.confirmAnalysisAccepted(acceptance, context()), {code: 'REVISION_CONFLICT'});
    await pipeline.processPage(page());
    assert.equal(pipeline.readAnalysis(toAccept.workKey, context()), undefined);
    await assert.rejects(pipeline.processPage({...page(), items: [{...items[0], sensitivity: 'public'}]}),
      {code: 'INVALID_ARGUMENT'});
    authorized = false;
    await assert.rejects(pipeline.processPage(page()), {code: 'UNAUTHORIZED'});
    assert.equal(pipeline.cursor('fixture', 'INBOX'), '1:5');
    assert.throws(() => pipeline.readCursor({...context(), accountRef:'fixture', folder:'INBOX'}), {code:'UNAUTHORIZED'});
    authorized = true;
    assert.throws(() => pipeline.resetExpiredCursor({...context(), accountRef:'fixture', folder:'INBOX', expectedCursor:'1:0'}), {code:'REVISION_CONFLICT'});
    pipeline.resetExpiredCursor({...context(), accountRef:'fixture', folder:'INBOX', expectedCursor:'1:5'});
    assert.equal(pipeline.cursor('fixture', 'INBOX'), undefined);
    assert.equal(pipeline.snapshot().total, 5);
  } finally {await rm(userData, {recursive: true, force: true});}
});

/**
 * 2026-10-22 实测：换模型/重装 Laya 后分类器指纹变化，snapshot 把所有历史行
 * 重置为 label=null / needsReview=true，2296 条里 2101 条被打回待核对，等于“分类白做”。
 * 新语义：保留历史 label/route 与复核状态，只加 classifierStale 标记。
 */
test('分类器指纹变化保留历史结论，只标记 stale', async () => {
  await mkdir(cacheRoot, {recursive: true});
  const userData = await mkdtemp(path.join(cacheRoot, 'pa-triage-stale-'));
  const strong = (choice, probabilities) => ({choice, probabilities,
    answer_confidence: Math.max(...Object.values(probabilities)), confidence: 0.95});
  const triage = new LayaTriageService({async infer(payload) {
    const observations = payload.state.events.map(event => event.observation);
    return {answers: Object.fromEntries(observations.flatMap((_text, index) => [
      [`category_${index}`, strong('meeting', {meeting: 0.98, other: 0.02})],
      [`impact_${index}`, strong('high_impact', {routine: 0.02, high_impact: 0.98})],
    ]))};
  }});
  const open = fingerprint => createInboxTriagePipeline({storage: createEncryptedModuleStorage({userData,
    safeStorage, filename: 'mail-classification.json'}), namespace: 'synthetic-user', triage,
  labels: {meeting: 'Meeting-related', other: 'Other'}, meetingLabels: ['meeting'],
  classifierFingerprint: fingerprint, authorizeRead: () => true});
  const page = () => ({...context(), accountRef: 'fixture', folder: 'INBOX', nextCursor: '1:5',
    hasMore: false, items});
  const shape = rows => rows.map(row => ({label: row.label, route: row.route, needsReview: row.needsReview}));
  let pipeline = open('fixture-policy-v1');
  const processed = await pipeline.processPage(page());
  assert.equal(processed.complete, true);
  const before = pipeline.snapshot();
  assert.equal(before.total, 5);
  assert.ok(before.records.every(row => row.label === 'meeting'), '前置：分类结论已落 label');
  const beforeShape = shape(before.records);
  pipeline = open('fixture-policy-v2');
  const after = pipeline.snapshot();
  assert.equal(after.total, before.total);
  assert.deepEqual(shape(after.records), beforeShape);
  assert.deepEqual(after.groups, before.groups);
  assert.equal(after.needsReview, before.needsReview);
  assert.ok(after.records.every(row => row.classifierStale === true));
});

function performanceFixture({cancelAt,failWriteAt}={}){
  let gets=0,sets=0,calls=0,fingerprint='performance-v1',cancel;
  const values=new Map(),storage={get(key){gets++;return structuredClone(values.get(key));},set(key,value){
    sets++;if(sets===failWriteAt)throw Error('Synthetic durable write failure');values.set(key,structuredClone(value));}};
  const triage=new LayaTriageService({async infer(payload){calls++;if(calls===cancelAt)cancel?.abort();
    return {answers:Object.fromEntries(payload.state.events.flatMap((_,index)=>[
      [`category_${index}`,answer('other',{meeting:.01,other:.99})],
      [`impact_${index}`,answer('routine',{routine:.99,high_impact:.01})]]))};}});
  const messages=Array.from({length:20},(_,index)=>({...items[0],externalId:`INBOX:${index+1}`,dedupeKey:`performance:${index+1}`,contentRef:`Synthetic header ${index+1}`}));
  const open=()=>createInboxTriagePipeline({storage,namespace:'performance-fixture',triage,labels:{meeting:'Meeting',other:'Other'},
    getClassifierFingerprint:()=>fingerprint,authorizeRead:()=>true});
  return {open,page:(signal=new AbortController().signal)=>({...context(),signal,accountRef:'fixture',folder:'INBOX',items:messages,nextCursor:'1:20',hasMore:false}),
    get calls(){return calls;},get gets(){return gets;},get sets(){return sets;},changeFingerprint:()=>{fingerprint='performance-v2';},setCancel:value=>{cancel=value;}};
}

test('cached state and lightweight summaries avoid storage reloads; exact replays do not infer again',async()=>{
  const f=performanceFixture(),pipeline=f.open();
  const result=await pipeline.processPage(f.page());assert.equal(result.classified,20);assert.equal(f.calls,5);
  assert.equal(f.sets,3,'one source invalidation, one 16-message checkpoint and one page completion');
  assert.equal(Object.hasOwn(result.summary,'records'),false,'page summary does not clone every historical row');
  for(let index=0;index<100;index++)assert.equal(pipeline.summary().total,20);
  assert.equal(f.gets,1,'the single owner validates and loads its state once');
  const writes=f.sets;
  const replay=await pipeline.processPage(f.page());assert.equal(replay.reused,20);assert.equal(replay.classified,0);assert.equal(f.calls,5);
  assert.equal(f.sets,writes,'an unchanged page replay does not rewrite the encrypted metadata map');
  const restarted=f.open();await restarted.processPage(f.page());assert.equal(f.calls,5,'durable replay also reuses all receipts');
  const changed=f.page();changed.items=changed.items.map((item,index)=>index===0?{...item,contentRef:'Synthetic changed header',fetchedAt:'2026-09-28T00:00:00Z'}:item);
  assert.equal((await restarted.processPage(changed)).classified,1);assert.equal(f.calls,6);
  f.changeFingerprint();assert.equal(restarted.summary().highImpactCandidates,0);
  assert.equal((await restarted.processPage(changed)).classified,20);assert.equal(f.calls,11);
});

test('cancellation flushes completed chunks without advancing an incomplete page cursor',async()=>{
  const f=performanceFixture({cancelAt:2}),controller=new AbortController();f.setCancel(controller);
  const pipeline=f.open();await assert.rejects(pipeline.processPage(f.page(controller.signal)),{code:'CANCELLED'});
  assert.equal(pipeline.summary().total,4);assert.equal(pipeline.cursor('fixture','INBOX'),undefined);
  assert.equal(f.sets,2,'completed receipts are flushed once when the page is interrupted');
  const resumed=f.open(),result=await resumed.processPage(f.page());
  assert.equal(result.reused,4);assert.equal(result.classified,16);assert.equal(resumed.summary().total,20);assert.equal(f.calls,6);
});

test('failed completion write cannot manufacture a durable cursor or completed classifications',async()=>{
  const f=performanceFixture({failWriteAt:3}),pipeline=f.open();
  await assert.rejects(pipeline.processPage(f.page()),/Synthetic durable write failure/);
  assert.equal(pipeline.cursor('fixture','INBOX'),undefined,'failed cache is discarded and reloaded from its durable checkpoint');
  assert.equal(pipeline.summary().total,16);
  const resumed=f.open(),result=await resumed.processPage(f.page());assert.equal(result.reused,16);assert.equal(result.classified,4);
  assert.equal(resumed.cursor('fixture','INBOX'),'1:20');
});

for(const failure of ['authorization','fingerprint','deadline']){
  test('rejected unpublished source mutation is reloaded before retry inference: '+failure,async t=>{
    let clock=Date.now(),rejectSource=false,checks=0,fingerprintReads=0,writes=0,hold=false,release,entered;
    const initialClock=clock;t.mock.method(Date,'now',()=>clock);
    const values=new Map(),storage={get:key=>structuredClone(values.get(key)),set(key,value){writes++;values.set(key,structuredClone(value));}};
    const triage=new LayaTriageService({async infer(payload){
      if(hold){entered();await new Promise(resolve=>{release=resolve;});}
      return {answers:Object.fromEntries(payload.state.events.flatMap((_,index)=>[
        [`category_${index}`,answer('meeting',{meeting:.99,other:.01})],
        [`impact_${index}`,answer('high_impact',{routine:.01,high_impact:.99})]]))};}});
    const open=()=>createInboxTriagePipeline({storage,namespace:'source-rejection-'+failure,triage,labels:{meeting:'Meeting',other:'Other'},
      authorizeRead:()=>!(rejectSource&&failure==='authorization'&&++checks===2),
      getClassifierFingerprint:()=>{
        if(rejectSource){fingerprintReads++;
          if(failure==='deadline'&&fingerprintReads===2)clock=initialClock+60_001;
          if(failure==='fingerprint'&&fingerprintReads===3)return 'changed-policy';
        }
        return 'stable-policy';
      }});
    const page=text=>({...context(),accountRef:'fixture',folder:'INBOX',nextCursor:'1:1',hasMore:false,
      items:[{...items[0],contentRef:text}]});
    const pipeline=open();await pipeline.processPage(page('Synthetic revision A'));
    const [original]=pipeline.pendingAnalyses(context());assert.ok(original);
    const savedWrites=writes;rejectSource=true;
    await assert.rejects(pipeline.processPage(page('Synthetic revision B')),
      {code:failure==='authorization'?'UNAUTHORIZED':failure==='deadline'?'TIMEOUT':'REVISION_CONFLICT'});
    assert.equal(writes,savedWrites,'a rejected scope never persists its source mutations');
    rejectSource=false;clock=initialClock;
    assert.ok(open().readAnalysis(original.workKey,context()),'disk still contains the previously authorized source before retry');
    hold=true;const started=new Promise(resolve=>{entered=resolve;});
    const retry=pipeline.processPage(page('Synthetic revision B'));
    await started;
    try {
      const reopened=open();
      assert.equal(reopened.readAnalysis(original.workKey,context()),undefined,
        'the retry durably invalidates A before its first asynchronous inference can yield or crash');
      assert.deepEqual(reopened.pendingAnalyses(context()),[]);
      assert.equal(writes,savedWrites+1);
    } finally {release();}
    await retry;
  });
}

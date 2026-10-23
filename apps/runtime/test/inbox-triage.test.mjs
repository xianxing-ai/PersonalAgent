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

import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {LayaTriageService} from '@personal-agent/cognition';
import {ProtocolError} from '@personal-agent/contracts';
import {createEncryptedModuleStorage} from '../../desktop/electron/encrypted-module-storage.js';
import {createRuntimeApplication, createQQMailTriageHost} from '../dist/application.js';
import {createInboxTriagePipeline} from '../src/application/inbox-triage.ts';

const descriptor = {name: 'mail.inbox', version: '0.1.0-alpha.1', sideEffect: 'read',
  requiredScopes: ['mail:read'], requiresPresence: false, idempotencySupport: true, recoverySupport: true,
  inputSchema: {type: 'object', additionalProperties: false, required: ['account', 'folder', 'limit'],
    properties: {account: {type: 'string'}, folder: {enum: ['INBOX']}, limit: {type: 'integer'}, cursor: {type: 'string'}}},
  outputSchema: {type: 'object', additionalProperties: true}};
const safeStorage = {isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value).reverse(),
  decryptString: value => Buffer.from(value).reverse().toString()};
const item = {source: 'mail', accountRef: 'fixture', externalId: 'INBOX:1',
  occurredAt: '2026-09-27T00:00:00.000Z', fetchedAt: '2026-09-27T01:00:00.000Z',
  contentRef: 'PRIVATE appointment header', sensitivity: 'private', dedupeKey: 'fixture:1:INBOX:1:message-1'};
const answer = (choice, probabilities) => ({choice, probabilities,
  answer_confidence: Math.max(...Object.values(probabilities)), confidence: 0.42});
const triage = new LayaTriageService({async infer(payload) {
  return {answers: Object.fromEntries(payload.state.events.flatMap((_, index) => [
    [`category_${index}`, answer('meeting', {meeting: 0.9, other: 0.1})],
    [`impact_${index}`, answer('high_impact', {routine: 0.1, high_impact: 0.9})],
  ]))};
}});
const context = () => ({deadline: new Date(Date.now() + 60_000).toISOString(),
  signal: new AbortController().signal});

test('cached headers can be reviewed with no Laya or batch while strict source and old live gates remain',async()=>{
  const values=new Map(),storage={get:key=>structuredClone(values.get(key)),set:(key,value)=>values.set(key,structuredClone(value))};
  const labels={meeting:'Meeting',other:'Other'},namespace='cached-review';let allowed=true;
  const seed=createInboxTriagePipeline({storage,namespace,triage,labels,classifierFingerprint:'original-policy',authorizeRead:()=>true});
  await seed.processPage({...context(),accountRef:'fixture',folder:'INBOX',items:[item],nextCursor:'1:1',hasMore:false});
  const open=()=>createQQMailTriageHost({user:'fixture@qq.com',authCode:'fake-only',accountRef:'fixture',storage,namespace,
    triage:{classify:()=>assert.fail('Cached review must not call Laya')},labels,getClassifierFingerprint:()=>undefined,isSessionAllowed:()=>allowed});
  let host=open();
  try{
    const [pending]=host.pendingReviewAnalyses(context());assert.ok(pending);assert.equal(pending.sessionId,undefined);
    assert.deepEqual(host.readReviewAnalysis(pending.workKey,context()),pending);
    assert.throws(()=>host.pendingAnalyses(context()),{code:'UNAUTHORIZED'});
    assert.throws(()=>host.readAnalysis(pending.workKey,context()),{code:'UNAUTHORIZED'});
    assert.equal(seed.readAnalysis(pending.workKey,context()).state,'pending');
    const binding={workKey:pending.workKey,sourceRevision:pending.sourceRevision,receiptId:pending.receipt.id,
      projectionDigest:pending.projectionDigest,taskId:'original-review-task'};
    const review={version:1,label:'other',impact:'routine',notificationRecommendation:'none',reasonCode:'other'};
    assert.throws(()=>host.applyCachedAnalysisReview({...binding,review},context()),{code:'REVISION_CONFLICT'});
    assert.equal(host.confirmCachedAnalysisAccepted(binding,context()).state,'accepted');
    assert.throws(()=>host.applyAnalysisReview({...binding,sessionId:'invented',review},context()),{code:'UNAUTHORIZED'});
    assert.throws(()=>host.applyCachedAnalysisReview({...binding,taskId:'different-task',review},context()),{code:'REVISION_CONFLICT'});
    const applied=host.applyCachedAnalysisReview({...binding,review},context());
    assert.deepEqual(host.applyCachedAnalysisReview({...binding,review},context()),applied);
    assert.equal(applied.classifierFingerprint,'original-policy');assert.equal(applied.label,'meeting');
    assert.equal(host.snapshot().counts.cloudReviewed,1);assert.deepEqual(host.snapshot().counts.groups,{other:1});
    allowed=false;assert.throws(()=>host.readReviewAnalysis(pending.workKey,context()),{code:'UNAUTHORIZED'});allowed=true;
    await host.close();host=open();
    assert.equal(host.snapshot().counts.cloudReviewed,1,'persisted independent cloud review survives model absence and restart');
    assert.equal(host.readReviewAnalysis(pending.workKey,context()).taskId,binding.taskId);
    await host.close();
    const stored=[...values.values()][0],row=stored.records[stored.latest[pending.messageId]];
    row.classifierFingerprint='different-original-policy';host=open();
    assert.equal(host.readReviewAnalysis(pending.workKey,context()),undefined);
    assert.throws(()=>host.applyCachedAnalysisReview({...binding,review},context()),{code:'REVISION_CONFLICT'});
    await host.close();row.classifierFingerprint='original-policy';stored.heads[pending.messageId].sourceRevision='changed-source';host=open();
    assert.deepEqual(host.pendingReviewAnalyses(context()),[]);assert.equal(host.readReviewAnalysis(pending.workKey,context()),undefined);
    assert.throws(()=>host.applyCachedAnalysisReview({...binding,review},context()),{code:'REVISION_CONFLICT'});
  }finally{await host.close();}
});

test('native mail origin callback receives only the actual Runtime page and session; refusal stops its lease',async()=>{
  for(const refused of [false,true]) {
    await mkdir(cacheRoot,{recursive:true});const directory=await mkdtemp(path.join(cacheRoot,'pa-mail-origin-'));
    const values=new Map(),observations=[];
    const app=createRuntimeApplication({path:path.join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',
      hostUserNamespace:'fixture-mail-user',tools:[{descriptor,execute:async()=>({account:'fixture',folder:'INBOX',
        items:[item],nextCursor:'1:1',hasMore:false})}]});
    const host=createQQMailTriageHost({user:'fixture@qq.com',authCode:'fake-only',accountRef:'fixture',
      storage:{get:key=>values.get(key),set:(key,value)=>values.set(key,value)},namespace:'fixture-origin',triage,
      classifierFingerprint:'fixture-origin-policy',labels:{meeting:'Meeting',other:'Other'},isSessionAllowed:()=>true,
      onReadTask:input=>{observations.push(input);assert.deepEqual(Object.keys(input).sort(),['sessionId','taskId']);
        assert.equal(app.runtime.loadCheckpoint(input.taskId,'mail-read-session'),input.sessionId);
        assert.equal(app.runtime.loadCheckpoint(input.taskId,'host-tool-intent').toolName,'mail.inbox');
        if(refused)throw Error('explicit fixture binding refusal');}});
    try {
      host.bindApplication(app);
      if(refused)assert.throws(()=>host.startBatch({expiresAt:context().deadline}),{code:'UNAUTHORIZED'});
      else host.startBatch({expiresAt:context().deadline});
      await idle(app);assert.equal(observations.length,1);
      if(refused) {
        assert.equal(host.snapshot().status,'disabled');
        assert.throws(()=>host.pendingAnalyses(context()),{code:'UNAUTHORIZED'});
      }else assert.equal((await host.refresh()).status,'complete');
    }finally{await host.close();await idle(app);app.close();await rm(directory,{recursive:true,force:true});}
  }
});
const cacheRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..', '.cache', 'runtime-tests');
async function idle(app) {
  for (let index = 0; index < 200; index++) {
    if (!app.activeTaskCount) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Runtime did not become idle');
}

test('confirmed Fake Runtime inbox page keeps encrypted analysis outbox across restart and binds ack to lease', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  await mkdir(cacheRoot, {recursive: true});
  const directory = await mkdtemp(path.join(cacheRoot, 'pa-mail-analysis-'));
  const userData = path.join(directory, 'user-data');
  let allowed = true, calls = 0;
  const storage = () => createEncryptedModuleStorage({userData, safeStorage, filename: 'mail-classification.json'});
  const openApp = () => createRuntimeApplication({path: path.join(directory, 'runtime.sqlite'), now: () => new Date(now),
    profile: 'huawei_ict_agentarts', hostUserNamespace: 'fixture-mail-user', tools: [{descriptor,
      execute: async args => {
        calls++;
        assert.deepEqual(args, {account: 'fixture', folder: 'INBOX', limit: 100, ...(calls > 1 ? {cursor:'1:1'} : {})});
        return {account: 'fixture', folder: 'INBOX', items: [item], nextCursor: '1:1', hasMore: false};
      }}]});
  const openHost = () => createQQMailTriageHost({user: 'fixture@qq.com', authCode: 'fake-only',
    accountRef: 'fixture', storage: storage(), namespace: 'fixture-mail-user', triage, classifierFingerprint:'fixture-policy-v1',
    labels: {meeting: 'Meeting-related header', other: 'Other'}, meetingLabels: ['meeting'],
    isSessionAllowed: () => allowed});
  let app = openApp(), host = openHost();
  try {
    host.bindApplication(app);
    host.startBatch({expiresAt: context().deadline});
    await idle(app);
    assert.equal((await host.refresh()).status, 'complete');
    assert.equal(calls, 1);
    const [pending] = host.pendingAnalyses(context());
    assert.ok(pending);
    assert.equal(pending.state, 'pending');
    assert.equal(pending.route, 'main_agent');
    assert.deepEqual(pending.projection, {headersOnly: true, sensitivity: 'private', text: item.contentRef});
    assert.equal(host.readAnalysis(pending.workKey, context()).sessionId, pending.sessionId);
    const acceptance = {sessionId: pending.sessionId, workKey: pending.workKey,
      sourceRevision: pending.sourceRevision, receiptId: pending.receipt.id,
      projectionDigest: pending.projectionDigest, taskId: 'runtime-task-1'};
    assert.throws(() => host.confirmAnalysisAccepted({...acceptance, sessionId: 'wrong'}, context()),
      {code: 'UNAUTHORIZED'});
    assert.equal(host.confirmAnalysisAccepted(acceptance, context()).state, 'accepted');
    assert.equal(host.confirmAnalysisAccepted(acceptance, context()).taskId, 'runtime-task-1');
    const review={version:1,label:'meeting',impact:'high_impact',notificationRecommendation:'review',reasonCode:'meeting_change'};
    assert.throws(()=>host.applyAnalysisReview({...acceptance,sessionId:'wrong',review},context()),{code:'UNAUTHORIZED'});
    const applied=host.applyAnalysisReview({...acceptance,review},context());
    assert.deepEqual(applied.cloudReview.review,review);assert.equal(applied.cloudReview.taskId,'runtime-task-1');
    assert.equal(host.snapshot().counts.cloudReviewed,1);
    assert.equal(applied.receiptId,pending.receipt.id);
    assert.deepEqual(host.pendingAnalyses(context()), []);
    await host.cancel();
    assert.throws(() => host.readAnalysis(pending.workKey, context()), {code: 'UNAUTHORIZED'});
    await host.close(); app.close();

    app = openApp(); host = openHost(); host.bindApplication(app);
    assert.throws(() => host.pendingAnalyses(context()), {code: 'UNAUTHORIZED'});
    host.startBatch({expiresAt: context().deadline}); await idle(app); await host.refresh();
    const recovered = host.readAnalysis(pending.workKey, context());
    assert.equal(recovered.state, 'accepted');
    assert.notEqual(recovered.sessionId, pending.sessionId);
    assert.throws(() => host.confirmAnalysisAccepted(acceptance, context()), {code: 'UNAUTHORIZED'});
    assert.equal(host.confirmAnalysisAccepted({...acceptance, sessionId: recovered.sessionId}, context()).taskId,
      'runtime-task-1');
    allowed = false;
    assert.throws(() => host.readAnalysis(pending.workKey, context()), {code: 'UNAUTHORIZED'});
    allowed = true;
    await host.cancel();
    host.startBatch({expiresAt: new Date(now + 60000).toISOString()});
    now += 60001;
    assert.throws(() => host.pendingAnalyses(context()), {code: 'UNAUTHORIZED'});
  } finally {await host.close(); await idle(app); app.close(); await rm(directory, {recursive: true, force: true});}
});

test('failed or wrong-scope Fake inbox task revokes its analysis lease', async () => {
  await mkdir(cacheRoot, {recursive: true});
  for (const failure of ['failed', 'wrong_scope']) {
    const directory = await mkdtemp(path.join(cacheRoot, 'pa-mail-analysis-failure-'));
    const app = createRuntimeApplication({path: path.join(directory, 'runtime.sqlite'),
      profile: 'huawei_ict_agentarts', hostUserNamespace: 'fixture-mail-user', tools: [{descriptor,
        execute: async () => {
          if (failure === 'failed') throw Error('Fake read failed');
          return {account: 'different-account', folder: 'INBOX', items: [item], nextCursor: '1:1', hasMore: false};
        }}]});
    const host = createQQMailTriageHost({user: 'fixture@qq.com', authCode: 'fake-only',
      accountRef: 'fixture', storage: createEncryptedModuleStorage({userData: path.join(directory, 'user-data'),
        safeStorage, filename: 'mail-classification.json'}), namespace: 'fixture-mail-user', triage,
      labels: {meeting: 'Meeting-related header', other: 'Other'}, isSessionAllowed: () => true});
    try {
      host.bindApplication(app);
      host.startBatch({expiresAt: context().deadline});
      await idle(app);
      if (failure === 'wrong_scope') await assert.rejects(host.refresh(), {code: 'EXTERNAL_FAILURE'});
      else assert.equal((await host.refresh()).status, 'failed');
      assert.throws(() => host.pendingAnalyses(context()), {code: 'UNAUTHORIZED'});
      assert.throws(() => host.readAnalysis('any-work-key', context()), {code: 'UNAUTHORIZED'});
    } finally {await host.close(); await idle(app); app.close(); await rm(directory, {recursive: true, force: true});}
  }
});

test('external read failure preserves classified counts and cursor, while explicit cancel remains disabled', async () => {
  const values=new Map(),seen=[];
  const storage={get:key=>structuredClone(values.get(key)),set:(key,value)=>values.set(key,structuredClone(value))};
  await mkdir(cacheRoot,{recursive:true});
  const directory=await mkdtemp(path.join(cacheRoot,'pa-mail-read-failed-'));
  let failRead=false;
  const app=createRuntimeApplication({path:path.join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',
    hostUserNamespace:'fixture-mail-user',tools:[{descriptor,execute:async args=>{
      seen.push(args);
      if(failRead)throw new ProtocolError('EXTERNAL_FAILURE','PRIVATE synthetic provider error');
      return {account:'fixture',folder:'INBOX',items:[item],nextCursor:'1:1',hasMore:false};
    }}]});
  const host=createQQMailTriageHost({user:'fixture@qq.com',authCode:'fake-only',accountRef:'fixture',storage,
    namespace:'fixture-mail-user',triage,classifierFingerprint:'fixture-policy-v1',
    labels:{meeting:'Meeting',other:'Other'},isSessionAllowed:()=>true});
  try {
    host.bindApplication(app);host.startBatch({expiresAt:context().deadline});await idle(app);
    const completed=await host.refresh();assert.equal(completed.status,'complete');assert.equal(completed.counts.total,1);
    const saved=structuredClone([...values]);
    await host.cancel();failRead=true;host.startBatch({expiresAt:context().deadline});await idle(app);
    const failed=await host.refresh();assert.equal(failed.status,'failed');
    assert.deepEqual(failed.counts,completed.counts);assert.deepEqual([...values],saved);
    assert.equal(seen[1].cursor,'1:1');assert.match(failed.reason,/保留/);
    assert.equal(JSON.stringify(failed).includes('PRIVATE'),false);
    assert.throws(()=>host.pendingAnalyses(context()),{code:'UNAUTHORIZED'});
    assert.equal((await host.cancel()).status,'disabled');
    host.startBatch({expiresAt:context().deadline});await idle(app);
    assert.equal(seen[2].cursor,'1:1');assert.equal((await host.refresh()).status,'failed');
  } finally {await host.close();await idle(app);app.close();await rm(directory,{recursive:true,force:true});}
});

test('authoritative expired inbox cursor stops until a new user read and preserves accepted outbox', async () => {
  const values = new Map(), seen = [];
  const storage = {get:key=>structuredClone(values.get(key)), set:(key,value)=>values.set(key,structuredClone(value))};
  await mkdir(cacheRoot, {recursive:true});
  const directory = await mkdtemp(path.join(cacheRoot, 'pa-mail-resync-'));
  let expired = false;
  const app = createRuntimeApplication({path:path.join(directory,'runtime.sqlite'), profile:'huawei_ict_agentarts',
    hostUserNamespace:'fixture-mail-user', tools:[{descriptor, execute:async args=>{
      seen.push(args);
      if (expired && args.cursor) throw new ProtocolError('CURSOR_EXPIRED','Fixture UIDVALIDITY changed');
      return {account:'fixture', folder:'INBOX', items:[item], nextCursor:expired?'2:1':'1:1', hasMore:false};
    }}]});
  const host = createQQMailTriageHost({user:'fixture@qq.com', authCode:'fake-only', accountRef:'fixture', storage,
    namespace:'fixture-mail-user', triage, classifierFingerprint:'fixture-policy-v1',
    labels:{meeting:'Meeting-related header',other:'Other'}, isSessionAllowed:()=>true});
  try {
    host.bindApplication(app); host.startBatch({expiresAt:context().deadline}); await idle(app); await host.refresh();
    const [pending] = host.pendingAnalyses(context());
    host.confirmAnalysisAccepted({...pending, receiptId:pending.receipt.id, taskId:'existing-analysis'},context());
    await host.cancel(); expired = true;
    host.startBatch({expiresAt:context().deadline}); await idle(app);
    assert.equal((await host.refresh()).status,'resync_required');
    assert.equal(seen.length,2); assert.equal(seen[1].cursor,'1:1');
    assert.equal((await host.refresh()).status,'resync_required'); assert.equal(seen.length,2);
    assert.throws(()=>host.pendingAnalyses(context()),{code:'UNAUTHORIZED'});
    host.startBatch({expiresAt:context().deadline}); await idle(app);
    assert.equal((await host.refresh()).status,'complete');
    assert.equal(seen[2].cursor,undefined);
    assert.equal(host.readAnalysis(pending.workKey,context()).taskId,'existing-analysis');
    assert.deepEqual(host.pendingAnalyses(context()),[]);
  } finally {await host.close(); await idle(app); app.close(); await rm(directory,{recursive:true,force:true});}
});

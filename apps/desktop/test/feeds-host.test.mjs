import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {HttpFeedProvider,encodeCursor} from '@personal-agent/feeds';
import {createDesktopFeedsHost} from '../electron/feeds-host.js';

// Test configuration stays in the repository's ignored cache; no account credentials are used.
import {mkdirSync} from 'node:fs';
const cache = new URL('../../../.cache/feeds-host-tests/',import.meta.url);
mkdirSync(cache,{recursive:true});
const safeStorage = {isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),
  decryptString:value=>Buffer.from(value).reverse().toString()};
function runtime() {
  const records = new Map();
  return {runtime:{loadCheckpoint:(id,key)=>records.get(id+key),saveCheckpoint:(id,key,value)=>records.set(id+key,value)},
    createHostStateStore:()=>({get:key=>records.get(key),set:(key,value)=>records.set(key,value),delete:key=>records.delete(key)})};
}
const request = id => ({taskId:id,signal:new AbortController().signal,deadline:new Date(Date.now()+30_000).toISOString(),scopes:['feeds:read']});
const xml = '<?xml version="1.0"?><rss version="2.0"><channel><title>Engineering updates</title><link>https://example.com/</link>'
  + '<item><guid>one</guid><title>New release</title><link>https://example.com/one</link><pubDate>Sun, 27 Sep 2026 08:00:00 GMT</pubDate><description>Release summary</description></item>'
  + '<item><guid>two</guid><title>Previous release</title><pubDate>Sat, 26 Sep 2026 08:00:00 GMT</pubDate></item></channel></rss>';

test('configured feeds reuse connector parsing and pagination with session-bound read/export permission', async () => {
  const userData = mkdtempSync(new URL('configured-',cache)); let calls = 0;
  const provider = new HttpFeedProvider({fetchImpl:async()=>{
    calls++; return {status:200,headers:{get:()=>null},body:null,text:async()=>xml};
  }});
  let host = createDesktopFeedsHost({userData,safeStorage,provider});
  const configured = host.add({title:'Engineering updates',url:'https://example.com/rss?token=synthetic-secret-123'});
  assert.doesNotMatch(JSON.stringify(configured),/example\.com|synthetic-secret/);
  assert.doesNotMatch(readFileSync(path.join(userData,'feeds-config.json'),'utf8'),/synthetic-secret/);
  host.close();
  host = createDesktopFeedsHost({userData,safeStorage,provider}); host.prepare(); host.bindApplication(runtime(),'synthetic-user');
  try {
    const context = request('feed-task');
    const binding = host.competitionToolAvailability.find(item=>item.toolName==='feeds.collect');
    const collect = host.tools.find(item=>item.descriptor.name==='feeds.collect');
    const list = host.tools.find(item=>item.descriptor.name==='feeds.subscriptions');
    const policy = host.competitionToolExports.find(item=>item.toolName==='feeds.collect');
    assert.equal(calls,0); assert.equal(binding.available(context),false);
    host.authorize({readAndCloudConsent:true}); assert.equal(binding.available(context),true);
    const listed = await list.execute({},context);
    assert.equal(listed.subscriptions[0].title,'Engineering updates');
    const subscriptionId = listed.subscriptions[0].id;
    const first = await collect.execute({subscriptionId,limit:1},context);
    assert.equal(first.items.length,1); assert.equal(first.hasMore,true);
    assert.equal(policy.project({...context,result:first}).items[0].title,'New release');
    const next = await collect.execute({subscriptionId,limit:1,cursor:first.nextCursor},context);
    assert.equal(next.items[0].title,'Previous release'); assert.equal(next.hasMore,false);
    await assert.rejects(collect.execute({subscriptionId:'unregistered'},context)); assert.equal(calls,2);
    const leakedCursor = encodeCursor({v:1,seen:[],etag:'synthetic-secret-123'});
    assert.throws(()=>policy.project({...context,result:{...first,nextCursor:leakedCursor}}),/受保护配置/);
    host.revoke(); assert.equal(policy.accepts(context),false);
    host.authorize({readAndCloudConsent:true}); assert.equal(binding.available(context),false);
    assert.equal(binding.available(request('new-task')),true);
    host.remove({id:subscriptionId}); assert.equal(host.snapshot().requiresRestart,true);
    assert.equal(binding.available(request('third-task')),false);
  } finally {host.close();}
  const reopened = createDesktopFeedsHost({userData,safeStorage,provider});
  assert.equal(reopened.snapshot().sessionAllowed,false); reopened.close();
});

test('revocation rejects an in-flight result even if the provider ignores cancellation', async () => {
  const userData = mkdtempSync(new URL('revocation-',cache)); let finish;
  const provider = new HttpFeedProvider({fetchImpl:async()=>{
    await new Promise(resolve=>{finish=resolve;});
    return {status:200,headers:{get:()=>null},body:null,text:async()=>xml};
  }});
  const host = createDesktopFeedsHost({userData,safeStorage,provider});
  host.add({title:'Updates',url:'https://example.com/rss'}); host.prepare(); host.bindApplication(runtime());
  const context = request('revocation-task'); host.authorize({readAndCloudConsent:true});
  host.competitionToolAvailability.find(item=>item.toolName==='feeds.collect').available(context);
  const task = host.tools.find(item=>item.descriptor.name==='feeds.collect').execute(
    {subscriptionId:host.snapshot().subscriptions[0].id},context);
  host.revoke(); finish();
  await assert.rejects(task); host.close();
});

test('F09 persistent cursor, feed-source-grant session lease and feeds.validate_and_deduplicate survive host restart', async () => {
  const userData = mkdtempSync(new URL('f09-persist-', cache));
  const sharedRows = new Map();
  const makePersistentRuntime = () => ({
    runtime: {
      loadCheckpoint: (id, key) => sharedRows.get(`${id}:${key}`),
      saveCheckpoint: (id, key, value) => sharedRows.set(`${id}:${key}`, value),
      getTask: id => ({
        taskId: id,
        conversationId: 'desktop-panel',
        state: 'running',
        cancelRequested: false,
        goal: 'Track public release notes',
      }),
    },
    createHostStateStore: scope => ({
      get: key => sharedRows.get(`${scope}:${key}`),
      set: (key, value) => sharedRows.set(`${scope}:${key}`, value),
      delete: key => sharedRows.delete(`${scope}:${key}`),
    }),
  });
  const xml1 = '<?xml version="1.0"?><rss version="2.0"><channel><title>Engineering</title>'
    + '<item><guid>item-1</guid><title>Release v1</title><link>https://example.com/1</link><pubDate>Sun, 27 Sep 2026 08:00:00 GMT</pubDate></item>'
    + '<item><guid>item-2</guid><title>Release v2</title><link>https://example.com/2</link><pubDate>Sun, 27 Sep 2026 09:00:00 GMT</pubDate></item>'
    + '</channel></rss>';
  const xml2 = '<?xml version="1.0"?><rss version="2.0"><channel><title>Engineering</title>'
    + '<item><guid>item-1</guid><title>Release v1</title><link>https://example.com/1</link><pubDate>Sun, 27 Sep 2026 08:00:00 GMT</pubDate></item>'
    + '<item><guid>item-2</guid><title>Release v2</title><link>https://example.com/2</link><pubDate>Sun, 27 Sep 2026 09:00:00 GMT</pubDate></item>'
    + '<item><guid>item-3</guid><title>Release v3</title><link>https://example.com/3</link><pubDate>Sun, 27 Sep 2026 10:00:00 GMT</pubDate></item>'
    + '</channel></rss>';
  let currentXml = xml1;
  const provider = new HttpFeedProvider({
    fetchImpl: async () => ({status: 200, headers: {get: () => null}, body: null, text: async () => currentXml}),
  });

  const rt1 = makePersistentRuntime();
  const ctx1 = request('f09-task-1');
  rt1.runtime.saveCheckpoint('f09-task-1', 'application-deadline', ctx1.deadline);
  const host1 = createDesktopFeedsHost({userData, safeStorage, provider});
  host1.add({title: 'Engineering', url: 'https://example.com/feed.xml'});
  host1.prepare();
  host1.bindApplication(rt1, 'f09-user');
  host1.authorize({readAndCloudConsent: true});
  const subscriptionId = host1.snapshot().subscriptions[0].id;

  // Before native feed-source-grant, validateAndDeduplicate must fail closed and persist nothing.
  await assert.rejects(
    host1.validateAndDeduplicate({subscriptionId, taskId: 'f09-task-1', items: [{guid: 'item-1', url: 'https://example.com/1'}]}),
    /feed_source_grant_unavailable/,
  );
  assert.equal(host1.readPersistedCursor(subscriptionId), undefined);

  const choice = host1.prepareNativeSourceChoice({subscriptionId, taskId: 'f09-task-1'});
  host1.applyNativeSourceChoice(choice, 'public');
  host1.authorize({readAndCloudConsent: true});
  const avail1 = host1.competitionToolAvailability.find(item => item.toolName === 'feeds.collect');
  assert.equal(avail1.available(ctx1), true);
  const grant = host1.readTrackingGrant({namespace: 'f09-user', sourceId: subscriptionId, taskId: 'f09-task-1'});
  assert.equal(grant.state, 'granted');
  assert.deepEqual(grant.grantedScopes, ['feeds.collect', 'feeds.validate_and_deduplicate']);

  const collect1 = host1.tools.find(t => t.descriptor.name === 'feeds.collect');
  const batch1 = await collect1.execute({subscriptionId}, ctx1);
  assert.equal(batch1.items.length, 2);
  const dedupe1 = await host1.validateAndDeduplicate({
    subscriptionId,
    taskId: 'f09-task-1',
    items: batch1.items,
    nextCursor: batch1.nextCursor,
  });
  assert.equal(dedupe1.uniqueCount, 2);
  assert.equal(dedupe1.duplicateDiscarded, 0);
  assert.equal(host1.readPersistedCursor(subscriptionId), batch1.nextCursor);
  host1.close();

  // Reopen after process restart with the persisted grantStore & runtime checkpoints.
  const rt2 = makePersistentRuntime();
  const ctx2 = request('f09-task-2');
  rt2.runtime.saveCheckpoint('f09-task-2', 'application-deadline', ctx2.deadline);
  const host2 = createDesktopFeedsHost({userData, safeStorage, provider});
  host2.prepare();
  host2.bindApplication(rt2, 'f09-user');
  const choice2 = host2.prepareNativeSourceChoice({subscriptionId, taskId: 'f09-task-2'});
  host2.applyNativeSourceChoice(choice2, 'public');
  host2.authorize({readAndCloudConsent: true});
  const avail2 = host2.competitionToolAvailability.find(item => item.toolName === 'feeds.collect');
  assert.equal(avail2.available(ctx2), true);
  const grant2 = host2.readTrackingGrant({namespace: 'f09-user', sourceId: subscriptionId, taskId: 'f09-task-2'});
  const savedCursor = host2.readPersistedCursor(subscriptionId);
  assert.equal(savedCursor, batch1.nextCursor);

  // Poll same content with persisted cursor -> 0 items delivered.
  const collect2 = host2.tools.find(t => t.descriptor.name === 'feeds.collect');
  const batch2 = await collect2.execute({subscriptionId, cursor: savedCursor}, ctx2);
  assert.equal(batch2.items.length, 0);

  // Add item-3 -> only 1 new item delivered and validated.
  currentXml = xml2;
  const batch3 = await collect2.execute({subscriptionId, cursor: savedCursor}, ctx2);
  assert.equal(batch3.items.length, 1);
  assert.equal(batch3.items[0].title, 'Release v3');

  // Even if duplicate old item is re-submitted to workflow.host.f09_n02 adapter, persisted fingerprints block duplicates.
  const f09Adapter = host2.workflowHostTools.find(t => t.descriptor.name === 'workflow.host.f09_n02');
  assert.ok(f09Adapter);
  const dedupe3 = await f09Adapter.execute(
    {
      subscriptionId,
      events: [batch1.items[0], ...batch3.items],
      nextCursor: batch3.nextCursor,
    },
    {...ctx2, authorizationRef: `feed-source-grant:${grant2.id}`},
  );
  assert.equal(dedupe3.uniqueCount, 1);
  assert.equal(dedupe3.duplicateDiscarded, 1);
  assert.equal(host2.readPersistedCursor(subscriptionId), batch3.nextCursor);

  // Revoking session revokes feed-source-grant and rejects further validation.
  host2.revoke();
  await assert.rejects(
    host2.validateAndDeduplicate({subscriptionId, taskId: 'f09-task-2', items: [{guid: 'item-4', url: 'https://example.com/4'}]}),
    /feed_session_not_authorized|feed_source_grant_unavailable/,
  );
  host2.close();
});

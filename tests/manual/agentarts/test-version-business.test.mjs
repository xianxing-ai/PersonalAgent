import test from 'node:test';
import assert from 'node:assert/strict';
import {FakeMailProvider,MailAccountRegistry} from '@personal-agent/mail';
import {FakeResearchProvider} from '@personal-agent/research';
import {ProtocolError} from '@personal-agent/contracts';
import {FakeStorage} from '@personal-agent/testkit';
import {createTestVersionBusinessTools} from './test-version-tools.mjs';

const now=()=>Date.parse('2026-10-15T00:00:00.000Z');
const context=()=>({runId:'fixture-run',taskId:'fixture-task',signal:new AbortController().signal,
  deadline:'2026-10-15T01:00:00.000Z'});
const call=(composition,name,input={})=>composition.tools.find(t=>t.descriptor.name===name).execute(input,context());

test('explicit configuration only; duplicate supplied tools rejected; disposal is idempotent',()=>{
  const absent=createTestVersionBusinessTools();
  assert.equal(absent.tools.length,0);assert.ok(absent.states.every(s=>s.state==='unavailable'));
  const tool={descriptor:{name:'fixture.read',version:'1.0.0'},execute:async()=>({})};
  assert.throws(()=>createTestVersionBusinessTools({tools:[tool,tool]}),/Duplicate actual tool/);
  const composition=createTestVersionBusinessTools({mail:{provider:new FakeMailProvider(),now}});
  assert.equal(composition.tools.some(t=>t.descriptor.name==='mail.save_draft'),false);
  assert.equal(composition.tools.some(t=>t.descriptor.name==='mail.send'),false);
  composition.dispose();composition.dispose();assert.equal(composition.tools.length,0);
});

test('mock mail public tools preserve multi-account paging, dedupe identity and UIDVALIDITY failure',async()=>{
  const provider=new FakeMailProvider(),registry=new MailAccountRegistry();
  registry.bind('secondary',new FakeMailProvider());
  const composition=createTestVersionBusinessTools({mail:{provider,accountRef:'primary',registry,now}});
  try {
    assert.equal((await call(composition,'mail.accounts')).accounts.length,2);
    const first=await call(composition,'mail.inbox',{account:'primary',limit:3});
    const next=await call(composition,'mail.inbox',{account:'primary',cursor:first.nextCursor,limit:3});
    assert.equal(first.items.length,3);assert.equal(next.items.length,3);
    assert.equal(new Set([...first.items,...next.items].map(i=>i.dedupeKey)).size,6);
    const replay=await call(composition,'mail.inbox',{account:'primary',cursor:first.nextCursor,limit:3});
    assert.deepEqual(replay.items.map(i=>i.dedupeKey),next.items.map(i=>i.dedupeKey));
    const other=await call(composition,'mail.inbox',{account:'secondary',limit:3});
    assert.notEqual(first.items[0].dedupeKey,other.items[0].dedupeKey);
    assert.ok(first.items.every(i=>i.sensitivity==='private'));
    provider.rotateUidValidity();
    await assert.rejects(call(composition,'mail.inbox',{cursor:first.nextCursor}),e=>e.code==='CURSOR_EXPIRED');
    const read=composition.tools.find(t=>t.descriptor.name==='mail.inbox').descriptor;
    assert.equal(read.version,'0.1.0-alpha.1');assert.deepEqual(read.requiredScopes,['mail:read']);
    assert.deepEqual(composition.tools.find(t=>t.descriptor.name==='mail.mark_seen').descriptor.requiredScopes,['mail:write']);
  }finally{composition.dispose();}
});

test('mock research keeps DOI, publication/fetch time and disclosed stale failure; status is read-only',async()=>{
  let clock=now();const provider=new FakeResearchProvider();
  const composition=createTestVersionBusinessTools({research:{provider,now:()=>clock,cacheTtlMs:1},
    notifications:{storage:new FakeStorage().namespace('test-version-notifications'),policy:{},now}});
  try {
    const result=await call(composition,'research.search',{query:'agent automated'});
    assert.ok(JSON.stringify(result).includes('doi.org/10.fixture/2026'));
    assert.equal(result.cache.fetchedAt,new Date(clock).toISOString());
    assert.equal(result.results[0].publishedAt,'2026-06-15T00:00:00.000Z');
    assert.equal(result.results[1].freshness,'stale');
    clock+=2;provider.setFailure(new ProtocolError('EXTERNAL_FAILURE','fixture offline',true));
    const stale=await call(composition,'research.search',{query:'agent automated'});
    assert.equal(stale.cache.state,'stale');assert.equal(stale.cache.lastError.code,'EXTERNAL_FAILURE');
    assert.deepEqual(composition.tools.find(t=>t.descriptor.name==='research.search').descriptor.requiredScopes,['research:read']);
    assert.equal((await call(composition,'notifications.status')).pending,0);
  }finally{composition.dispose();}
});

test('explicit fixture draft capability preserves scope and unknown result; cancelled write never reaches provider',async()=>{
  const provider=new FakeMailProvider();let calls=0;
  // Deliberate test-only capability; FakeMailProvider itself does not implement drafts.
  provider.saveDraft=async(account,input)=>{calls++;return {actionId:`draft:${input.idempotencyKey}`,
    state:'unknown',externalId:'<fixture-draft@example.test>',evidenceRefs:[],verification:'mock'};};
  const composition=createTestVersionBusinessTools({mail:{provider,accountRef:'fixture',now}});
  try {
    const tool=composition.tools.find(t=>t.descriptor.name==='mail.save_draft');
    assert.deepEqual(tool.descriptor.requiredScopes,['mail:draft']);
    assert.equal(tool.descriptor.sideEffect,'external_write');assert.equal(tool.descriptor.recoverySupport,false);
    const input={to:'test@example.test',subject:'Fixture only',text:'Mock draft'};
    assert.equal((await tool.execute(input,context())).state,'unknown');assert.equal(calls,1);
    const controller=new AbortController();controller.abort();
    await assert.rejects(tool.execute(input,{...context(),signal:controller.signal}),e=>e.code==='CANCELLED');
    assert.equal(calls,1);
  }finally{composition.dispose();}
});

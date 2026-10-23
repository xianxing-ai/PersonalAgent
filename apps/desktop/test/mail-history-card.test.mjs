import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorCards,connectorDestination} from '../src/features/workspace/connectors.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createEncryptedModuleStorage} from '../electron/encrypted-module-storage.js';
import {createInboxTriagePipeline,createQQMailTriageHost} from '../../runtime/dist/application.js';
import {LayaTriageService} from '@personal-agent/cognition';
import {QQMailProvider} from '@personal-agent/mail';

const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const mailCard=mail=>connectorCards({mail},escape).split('<article').find(card=>card.includes('data-connector="mail"'));

test('saved classification counts after restart remain visible without suggesting a restored reading grant',()=>{
  const mail={configured:true,status:'disabled',sessionAllowed:false,user:'<fixture>',counts:{total:42,unread:9}};
  const html=mailCard(mail);
  assert.match(html,/历史分类 42 封 · 非实时/);
  assert.match(html,/需重新授权/);
  assert.match(html,/读取许可已过期/);
  assert.match(html,/此卡片不会读取新邮件/);
  assert.match(html,/&lt;fixture&gt;/);
  assert.doesNotMatch(html,/9 封未读|尚未拉取邮件|已允许/);
  assert.deepEqual(connectorDestination('mail',{mail}),{page:'connections'});
  assert.equal(mail.sessionAllowed,false);
});

test('current mail grants and active monitors keep the current card instead of an expired-cache claim',()=>{
  for(const state of [{sessionAllowed:true},{sessionAllowed:false,monitoring:{enabled:true}},
    ...['waiting_approval','reading','classifying','stop_unconfirmed','failed'].map(status=>({sessionAllowed:false,status}))]) {
    assert.doesNotMatch(mailCard({configured:true,status:'disabled',counts:{total:42},...state}),/读取许可已过期|历史分类/);
  }
});

test('empty, invalid and unconfigured mail summaries cannot invent historical classifications',()=>{
  for(const total of [0,-1,NaN,Infinity,'42',1.5,undefined]) {
    assert.doesNotMatch(mailCard({configured:true,sessionAllowed:false,counts:{total}}),/历史分类|读取许可已过期/);
  }
  assert.doesNotMatch(mailCard({configured:false,counts:{total:42}}),/历史分类/);
});

test('production host summary reopens encrypted classification cache with no provider read or permission mint',async t=>{
  const userData=await mkdtemp(path.join(tmpdir(),'mail-history-card-'));
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),
    decryptString:value=>Buffer.from(value).reverse().toString()};
  const storage=()=>createEncryptedModuleStorage({userData,safeStorage,filename:'mail-classification.json'});
  const labels={meeting:'Meeting',other:'Other'}, namespace='synthetic-mail-history';
  const answer=(choice,probabilities)=>({choice,probabilities,answer_confidence:0.9,confidence:0.42});
  const triage=new LayaTriageService({async infer(){return {answers:{
    category_0:answer('meeting',{meeting:0.9,other:0.1}),impact_0:answer('high_impact',{routine:0.1,high_impact:0.9})}};}});
  const context=()=>({signal:new AbortController().signal,deadline:new Date(Date.now()+60000).toISOString()});
  let providerReads=0,permissionMints=0;
  t.mock.method(QQMailProvider.prototype,'fetchPage',async()=>{providerReads++;throw Error('unexpected provider read');});
  t.mock.method(QQMailProvider.prototype,'connect',async()=>{providerReads++;throw Error('unexpected provider connection');});
  let host;
  try {
    const pipeline=createInboxTriagePipeline({storage:storage(),namespace,labels,triage,
      classifierFingerprint:'fixture-policy',authorizeRead:()=>true});
    const processed=await pipeline.processPage({...context(),accountRef:'fixture',folder:'INBOX',nextCursor:'1:1',hasMore:false,
      items:[{source:'mail',accountRef:'fixture',externalId:'INBOX:1',occurredAt:'2026-10-23T00:00:00.000Z',
        fetchedAt:'2026-10-23T01:00:00.000Z',contentRef:'synthetic meeting',sensitivity:'private',dedupeKey:'fixture:1:INBOX:1'}]});
    assert.equal(processed.complete,true);
    host=createQQMailTriageHost({user:'fixture@example.invalid',authCode:'fake-only',accountRef:'fixture',
      storage:storage(),namespace,labels,triage,classifierFingerprint:'fixture-policy',isSessionAllowed:()=>false,
      batchAuthorization:{canRequest:()=>false,preparePage(){permissionMints++;throw Error('unexpected mint');},
        assertCurrent(){throw Error('no grant');},assertPage(){throw Error('no grant');},assertConsumed(){throw Error('no grant');},finish(){}}});
    host.bindApplication({});
    const mail={...host.snapshot(),configured:true,sessionAllowed:false};
    assert.equal(mail.counts.total,1);
    assert.match(mailCard(mail),/历史分类 1 封 · 非实时/);
    assert.match(mailCard(mail),/需重新授权/);
    assert.throws(()=>host.pendingAnalyses(context()),{code:'UNAUTHORIZED'});
    assert.throws(()=>host.startBatch({expiresAt:context().deadline}),{code:'UNAUTHORIZED'});
    assert.equal((await host.refresh()).counts.total,1);
    assert.equal(providerReads,0);
    assert.equal(permissionMints,0);
  }finally{await host?.close();await rm(userData,{recursive:true,force:true});}
});

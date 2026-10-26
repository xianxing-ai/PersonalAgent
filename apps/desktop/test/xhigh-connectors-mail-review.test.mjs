import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createDesktopMailReviewHost} from '../electron/mail-review-host.js';

// Real local Runtime/SQLite persistence; mailbox and confirmation are explicit
// synthetic ports. No actual mailbox, model, cloud or notification is invoked.
function fixture(t,{confirmConsent}={}) {
  const root=resolve('.cache/xhigh-connectors-20261026/tests');mkdirSync(root,{recursive:true});
  const directory=mkdtempSync(join(root,'mail-review-')),namespace='synthetic-xhigh-mail-review';
  let host,submissions=0,cloudCalls=0;
  const pending=[],items=['first','second'].map(workKey=>({workKey,sourceRevision:'revision-1',projectionDigest:'digest-'+workKey,
    receipt:{id:'receipt-'+workKey},state:'pending',observedAt:new Date(Date.now()-60000).toISOString(),
    projection:{headersOnly:true,sensitivity:'private',text:'SYNTHETIC_HEADER '+workKey}}));
  const application=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:namespace,
    coordination:{execute:async()=>{cloudCalls++;throw Error('Synthetic fixture forbids dispatch');}},
    mailReview:{readEnvelope:(...args)=>host.readEnvelope(...args),assertExport:(...args)=>host.assertExport(...args)}});
  const submit=application.submitHostToolTask.bind(application);
  application.submitHostToolTask=request=>{submissions++;return submit(request);};
  const mail={pendingReviewAnalyses:()=>items.filter(item=>item.state==='pending'),
    readReviewAnalysis:key=>structuredClone(items.find(item=>item.workKey===key)),
    confirmCachedAnalysisAccepted(input){const item=items.find(item=>item.workKey===input.workKey);item.state='accepted';item.taskId=input.taskId;}};
  const question={prepare(){},prepareExport(){},currentRequirement(){},authorizeExport(){},authorizeConsumedExport(){}};
  host=createDesktopMailReviewHost({getApplication:()=>application,namespace,mail,question,readConfigurationRef:()=> 'synthetic-config',
    confirmConsent:confirmConsent??(request=>new Promise(resolve=>pending.push({request,resolve}))),getNotifications:()=>undefined});
  const state=()=>application.runtime.bindTrustedHostState('desktop-mail-review').get(createHash('sha256').update(JSON.stringify(namespace)).digest('hex'));
  t.after(async()=>{await host.close();for(let i=0;i<100&&application.activeTaskCount;i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(application.activeTaskCount,0);assert.equal(cloudCalls,0);application.close();
    assert.ok(directory.startsWith(root));rmSync(directory,{recursive:true,force:true});});
  return {host,pending,state,application,counts:()=>({submissions,cloudCalls}),
    select:index=>({workKey:items[index].workKey,sourceRevision:items[index].sourceRevision,
      projectionDigest:items[index].projectionDigest,receiptId:items[index].receipt.id})};
}

test('mail review revocation invalidates a pending enable confirmation and its late accepted boolean',async t=>{
  const f=fixture(t),configuring=f.host.configure({enabled:true,selectedBindings:[f.select(0)]});
  const result=configuring.then(value=>({value}),error=>({error}));
  assert.equal(f.pending[0].request.isCurrent(),true);
  await f.host.revoke();
  const currentAfterRevoke=f.pending[0].request.isCurrent();
  assert.equal(f.pending[0].request.signal.aborted,true);
  f.pending[0].resolve(true);const settled=await result;
  assert.equal(currentAfterRevoke,false,'the original confirmation itself must be stale after revoke');
  assert.equal(settled.error?.code,'UNAUTHORIZED');
  assert.equal(f.host.snapshot().enabled,false);
  await f.host.tick();assert.equal(f.counts().submissions,0);
});

test('a newer mail review selection cannot be replaced by an older late confirmation',async t=>{
  const f=fixture(t);
  const first=f.host.configure({enabled:true,selectedBindings:[f.select(0)]}).then(value=>({value}),error=>({error}));
  const second=f.host.configure({enabled:true,selectedBindings:[f.select(1)]});
  const stale=f.pending[0].request.isCurrent();
  f.pending[1].resolve(true);await second;
  const accepted=structuredClone(f.state());
  f.pending[0].resolve(true);const older=await first;
  assert.equal(stale,false,'a later configuration operation invalidates the earlier confirmation');
  assert.equal(older.error?.code,'UNAUTHORIZED');
  assert.deepEqual(f.state(),accepted,'late confirmation cannot rotate generation or replace the selected source');
  await f.host.tick();assert.equal(f.counts().submissions,1);
  const entry=f.state().entries.second;
  assert.equal(f.state().entries.first,undefined);
  await f.application.waitForHostToolTask(entry.taskId);
  const original=f.application.readHostToolTask(entry.taskId);
  assert.equal(original.task.state,'waiting_approval','the selected original task still requires Policy approval');
  assert.deepEqual(f.application.runtime.loadCheckpoint(entry.taskId,'host-tool-intent').arguments,f.select(1));
  assert.equal(f.counts().cloudCalls,0);
});

test('close between confirmed enable and configuration commit cannot reopen the mail review host',async t=>{
  const f=fixture(t,{confirmConsent:async()=>true});
  const configuring=f.host.configure({enabled:true,selectedBindings:[f.select(0)]}).then(value=>({value}),error=>({error}));
  // The confirmation continuation runs first; its await on revoke yields before
  // committing the configuration. Close is a normal intervening microtask.
  await Promise.resolve();await f.host.close();
  const settled=await configuring;
  assert.equal(f.host.snapshot().enabled,false,'a closed host cannot be reopened by its old configure continuation');
  assert.equal(settled.error?.code,'UNAUTHORIZED');
  await f.host.tick();assert.equal(f.counts().submissions,0);
});

test('revoke between confirmed enable and configuration commit cannot restore an enabled policy',async t=>{
  const f=fixture(t,{confirmConsent:async()=>true});
  const configuring=f.host.configure({enabled:true,selectedBindings:[f.select(0)]}).then(value=>({value}),error=>({error}));
  await Promise.resolve();await f.host.revoke();
  const settled=await configuring;
  assert.equal(f.host.snapshot().enabled,false);
  assert.equal(settled.error?.code,'UNAUTHORIZED');
  await f.host.tick();assert.equal(f.counts().submissions,0);
});

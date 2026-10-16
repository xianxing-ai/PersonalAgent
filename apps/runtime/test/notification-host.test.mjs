import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {TaskRuntime} from '../dist/index.js';
import {createRuntimeNotificationHost} from '../dist/application/notification-host.js';
import {toolArgumentsDigest as digest} from '@personal-agent/tool-gateway';

// Real existing Runtime SQLite/CAS; explicit synthetic signed UI/voice authority only.
// No microphone, device notification, cloud account, model inference or actual voice playback.
const scope={kind:'connector',connectorId:'mail'},globalScope={kind:'global'},secret='fixture-user-command-signature';
const sign=command=>{const {proof:_,...body}=command;return createHmac('sha256',secret).update(digest(body)).digest('hex');};
const signed=command=>({...command,proof:sign(command)});
const policy=(patch={})=>({mode:'normal',maxInterruptions:1,windowMinutes:17,silentUntilUtc:null,preferredChannel:'banner',
  allowUrgentBreakthrough:false,digestMode:'on_return',quietHours:null,...patch});
function fixture() {
  const now=Date.now(),stages=[];let currentTime=now,ids=0;
  const cache=path.join(process.cwd(),'.cache','notification-host-tests');mkdirSync(cache,{recursive:true});
  const file=path.join(mkdtempSync(path.join(cache,'run-')),'runtime.sqlite');
  const options={policy:{},settingsScopes:['notifications:settings'],now:()=>currentTime,idFactory:()=>`notification-${++ids}`,
    onStage:event=>stages.push(event),verifyUserCommand:command=>command.proof===sign(command)};
  const command=(operationId,expectedRevision,patch,extra={})=>signed({settings:{operationId,expectedRevision,scope:globalScope,patch},
    source:'structured',phase:'final',origin:'user',echo:false,issuedAt:new Date(currentTime).toISOString(),
    expiresAt:new Date(currentTime+60000).toISOString(),argumentsDigest:digest({operationId,expectedRevision,scope:globalScope,patch}),...extra});
  const context=command=>({taskId:'fixture-settings',runId:'fixture-settings-run',authorizationRef:'fixture-existing-policy-grant',
    scopes:['notifications:settings'],signal:new AbortController().signal,deadline:new Date(Date.now()+60000).toISOString(),argumentsDigest:digest(command.settings)});
  const item=id=>({source:'mail',accountRef:'synthetic',externalId:id,occurredAt:new Date(currentTime).toISOString(),fetchedAt:new Date(currentTime).toISOString(),
    contentRef:'synthetic:'+id,sensitivity:'normal',dedupeKey:id});
  const reserve=(host,id,batch)=>host.reserveInterruption({roundId:id,batchIds:[batch.id],scope,channels:['banner'],expiresAt:new Date(currentTime+60000).toISOString()});
  return {file,options,command,context,item,reserve,stages,advance:ms=>{currentTime+=ms;},now:()=>currentTime};
}
test('two SQLite connections share policy/quota, unknown receipt and unread feed across full restart',async()=>{
  const f=fixture();let first=new TaskRuntime(f.file),second=new TaskRuntime(f.file);
  try {
    const a=createRuntimeNotificationHost(first,f.options),b=createRuntimeNotificationHost(second,f.options),setting=f.command('configure',0,policy());
    await a.applyUserCommand(setting,f.context(setting));assert.equal(b.getInterruptionPolicy(scope).effective.maxInterruptions,1);
    a.ingest([f.item('one')],{scope});const one=a.drain().batches[0];b.ingest([f.item('two')],{scope});const two=b.drain().batches.find(batch=>batch.itemRefs.includes('two'));
    const results=await Promise.all([Promise.resolve().then(()=>f.reserve(a,'round-one',one)),Promise.resolve().then(()=>f.reserve(b,'round-two',two))]);
    assert.equal(results.filter(r=>r.counted).length,1);assert.equal(results.filter(r=>r.reason==='interruption_limit_reached').length,1);
    assert.equal(a.beginDelivery({roundId:'round-one',channel:'banner'}).maySend,true);
    a.completeDelivery({roundId:'round-one',channel:'banner',state:'unknown',evidenceRefs:[]});
    assert.equal(b.beginDelivery({roundId:'round-one',channel:'banner'}).maySend,false);
    first.close();second.close();first=new TaskRuntime(f.file);second=new TaskRuntime(f.file);
    const reopened=createRuntimeNotificationHost(first,f.options),peer=createRuntimeNotificationHost(second,f.options);
    assert.equal(reopened.getInterruptionRound('round-one').attempts.banner.state,'unknown');
    assert.equal(reopened.beginDelivery({roundId:'round-one',channel:'banner'}).maySend,false);
    const silence=f.command('silence',1,{mode:'silent'});await peer.applyUserCommand(silence,f.context(silence));
    reopened.ingest([f.item('silent-three')],{scope});assert.equal(reopened.drain().batches.length,0);
    assert.equal(peer.notificationFeed().items.length,3);assert.equal(peer.notificationFeed().items.every(item=>item.unread),true);
    peer.acknowledgeRead({operationId:'read-three',itemIds:['silent-three']});assert.equal(reopened.notificationFeed().items[2].unread,false);
    assert.deepEqual(reopened.getDigest({trigger:'on_return'}).items.map(item=>item.id),['one','two']);
    assert.ok(f.stages.every(stage=>Number.isFinite(Date.parse(stage.observedAt))));assert.equal(first.listTasks({limit:10}).items.length,0);
  } finally {first.close();second.close();}
});
test('signed partial/echo/model/expired voice commands are rejected and final user payload is digest-bound',async()=>{
  const f=fixture(),runtime=new TaskRuntime(f.file);
  try {
    const host=createRuntimeNotificationHost(runtime,f.options);
    const voice={source:'voice',utteranceId:'fixture-utterance',transcriptDigest:digest('synthetic final command')};
    for(const change of [{phase:'partial'},{origin:'echo',echo:true},{origin:'model'},
      {expiresAt:new Date(f.now()-1).toISOString()},{utteranceId:undefined},{transcriptDigest:undefined}]) {
      const command=f.command('invalid',0,policy(),{...voice,...change});
      await assert.rejects(host.applyUserCommand(command,f.context(command)),/user settings command/);
    }
    const command=f.command('final-user',0,policy(),voice);assert.equal((await host.applyUserCommand(command,f.context(command))).revision,1);
    assert.equal((await host.applyUserCommand(command,f.context(command))).revision,1);
    const substituted=structuredClone(command);substituted.settings.patch.mode='silent';
    await assert.rejects(host.applyUserCommand(substituted,f.context(command)),/argument\/version binding/);
    substituted.argumentsDigest=digest(substituted.settings);substituted.proof=sign(substituted);
    await assert.rejects(host.applyUserCommand(substituted,f.context(substituted)),/parameters changed/);
    await assert.rejects(host.settingsTool.execute(command.settings,f.context(command)),/user settings command/);
    assert.throws(()=>createRuntimeNotificationHost(runtime,{...f.options,verifyUserCommand:undefined}),/verifier/);
  } finally {runtime.close();}
});
test('registered settings tool resolves original host proof, keeps lease live and excludes withdrawn or expired return changes',async()=>{
  const f=fixture(),runtime=new TaskRuntime(f.file);let saved;
  try {
    const host=createRuntimeNotificationHost(runtime,{...f.options,resolveUserCommand:()=>saved});saved=f.command('configure',0,policy({maxInterruptions:null}));
    await host.settingsTool.execute(saved.settings,f.context(saved));
    host.ingest([f.item('withdrawn')],{scope});host.ingest([f.item('expired')],{scope,validUntilUtc:new Date(f.now()+1).toISOString()});
    host.ingest([f.item('valid')],{scope});host.withdrawNotifications({operationId:'withdraw',itemIds:['withdrawn']});f.advance(2);
    assert.deepEqual(host.getDigest({trigger:'on_return'}).items.map(item=>item.id),['valid']);
    const late=createRuntimeNotificationHost(runtime,{...f.options,verifyUserCommand:()=>{f.advance(60001);return true;}});
    const settings=f.command('late',1,{mode:'silent'});await assert.rejects(late.applyUserCommand(settings,f.context(settings)),/user settings command/);
    assert.equal(host.getInterruptionPolicy(scope).effective.mode,'normal');
  } finally {runtime.close();}
});

test('trusted persisted final transcript ledger rejects older revision, silence, partial and echo without changing policy',async()=>{
  const f=fixture(),runtime=new TaskRuntime(f.file),anchor=runtime.submitTask({goal:'Explicit offline final transcript fixture',conversationId:'voice-fixture',idempotencyKey:'voice-ledger'});
  const key='fixture-original-final-transcript';
  const store=value=>runtime.saveCheckpoint(anchor.taskId,key,value);
  // Fixture of the mandatory trusted verifier, not a production microphone/ASR revision adapter.
  const host=createRuntimeNotificationHost(runtime,{...f.options,verifyUserCommand:command=>{
    const actual=runtime.loadCheckpoint(anchor.taskId,key);
    return command.proof===sign(command)&&actual.phase==='final'&&actual.origin==='user'&&!actual.echo&&actual.text.trim().length>0
      &&command.utteranceId===actual.utteranceId&&command.transcriptDigest===digest(actual.text);
  }});
  try {
    const voice=(id,text)=>({source:'voice',utteranceId:id,transcriptDigest:digest(text)});
    store({utteranceId:'turn-one-final-2',phase:'final',origin:'user',echo:false,text:'保持静默'});
    const stale=f.command('old-final',0,policy(),voice('turn-one-final-1','旧修订'));
    await assert.rejects(host.applyUserCommand(stale,f.context(stale)),/user settings command/);
    for(const [phase,origin,echo,text] of [['partial','user',false,'静默'],['final','echo',true,'静默'],['final','user',false,'   ']]){
      store({utteranceId:'turn-one-final-2',phase,origin,echo,text});
      const invalid=f.command('invalid-final',0,policy(),voice('turn-one-final-2',text));
      await assert.rejects(host.applyUserCommand(invalid,f.context(invalid)),/user settings command/);
      assert.equal(host.getInterruptionPolicy(globalScope).state,'unconfigured');
    }
    store({utteranceId:'turn-one-final-2',phase:'final',origin:'user',echo:false,text:'保持静默'});
    const final=f.command('current-final',0,policy({mode:'silent'}),voice('turn-one-final-2','保持静默'));
    assert.equal((await host.applyUserCommand(final,f.context(final))).revision,1);
    const oldPolicyRevision=f.command('stale-policy',0,{mode:'normal'},voice('turn-one-final-2','保持静默'));
    await assert.rejects(host.applyUserCommand(oldPolicyRevision,f.context(oldPolicyRevision)),{code:'REVISION_CONFLICT'});
    assert.equal(host.getInterruptionPolicy(globalScope).effective.mode,'silent');
  } finally {runtime.close();}
});

test('legacy final settings retain exact host proof and cannot replace a typed command or self-assert final authority',async()=>{
  const f=fixture(),runtime=new TaskRuntime(f.file);let saved=f.command('typed-question',0,policy());
  try {
    const host=createRuntimeNotificationHost(runtime,{...f.options,resolveUserCommand:()=>saved});
    const legacy={operationId:'legacy-question',expectedRevision:0,scope:{kind:'connector',connectorId:'productivity'},legacyPolicy:{digest:{windowMs:60000,maxItems:2}}};
    const context=f.context({settings:legacy});
    await assert.rejects(host.settingsTool.execute(legacy,context),/user settings command/);
    assert.equal(host.getLegacyPolicy(legacy.scope).revision,0);
    saved=signed({...saved,settings:legacy,argumentsDigest:digest(legacy),source:'voice',utteranceId:'legacy-current-final',transcriptDigest:digest('同意')});
    const forged={...saved,proof:'payload-says-final'};
    await assert.rejects(host.applyUserCommand(forged,context),/user settings command/);
    assert.equal((await host.applyUserCommand(saved,context)).revision,1);
    assert.deepEqual(host.getLegacyPolicy(legacy.scope).policy,legacy.legacyPolicy);
    assert.equal(host.getInterruptionPolicy(globalScope).state,'unconfigured');
    const substituted=structuredClone(saved);substituted.settings.legacyPolicy.digest.maxItems=1;
    await assert.rejects(host.applyUserCommand(substituted,context),/argument\/version binding/);
    assert.equal(host.getLegacyPolicy(legacy.scope).policy.digest.maxItems,2);
  } finally {runtime.close();}
});

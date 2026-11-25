import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {QQMailProvider} from '@personal-agent/mail';
import {prepareOriginalMailSendIdentity,readOriginalMailSendIdentity} from '@personal-agent/runtime/application';
import {mailSendIdentityScenario,mailArguments} from './fixtures/mail-send-identity-scenario.mjs';

const binding=(f,taskId)=>{const record=f.application.runtime.readToolExecutions(taskId).find(value=>value.toolName==='mail.send');
  assert.ok(record);return {taskId,runId:record.evidenceId,toolVersion:record.toolVersion,scopeRef:record.evidenceId,arguments:mailArguments};};

test('original SMTP identity is durable before transport success/throw without storing credentials or mail content',async t=>{
  for(const mode of ['success','throw'])await t.test(mode,async t=>{
    const f=await mailSendIdentityScenario({mode});t.after(()=>f.close());const taskId=await f.send();
    await f.wait(()=>f.sends()===1&&['succeeded','waiting_reconciliation','failed'].includes(f.application.runtime.getTask(taskId).state));
    const b=binding(f,taskId),identity=f.host.readOriginalSendIdentity(b);
    assert.equal(identity.messageId,f.transportMessages[0].messageId);assert.equal(identity.idempotencyKey,b.runId);
    assert.equal(identity.taskId,taskId);assert.equal(Object.isFrozen(identity),true);
    assert.equal(JSON.stringify(identity).includes('offline-unused'),false);assert.equal(JSON.stringify(identity).includes(mailArguments.text),false);
    assert.equal(f.application.runtime.readToolDescriptors().find(value=>value.name==='mail.send').recoverySupport,false);
    assert.throws(()=>f.host.readOriginalSendIdentity({...b,arguments:{...mailArguments,text:'replaced'}}),{code:'UNAUTHORIZED'});
    assert.throws(()=>f.host.readOriginalSendIdentity({...b,scopeRef:'replaced'}),{code:'UNAUTHORIZED'});
    f.rotate();assert.throws(()=>f.host.readOriginalSendIdentity(b),{code:'UNAUTHORIZED'});assert.equal(f.sends(),1);
  });
});

test('actual cancellation throw keeps the original identity across SQLite reopen without reopening or SMTP replay',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'pa-mail-cancel-'));
  const path=join(directory,'runtime.sqlite'),f=await mailSendIdentityScenario({path,mode:'cancel'});let closed=false;
  let restarted;t.after(async()=>{if(restarted)await restarted.close();if(!closed)await f.close();rmSync(directory,{recursive:true,force:true});});
  const taskId=await f.send();await f.wait(()=>f.sends()===1);
  const b=binding(f,taskId),identity=f.host.readOriginalSendIdentity(b);
  await f.client.call('task.cancel',{taskId});await f.wait(()=>f.application.runtime.getTask(taskId).state==='waiting_reconciliation');
  assert.equal(f.application.runtime.readToolExecutions(taskId)[0].state,'unknown');assert.equal(f.sends(),1);
  const snapshot=f.application.runtime.getTask(taskId);assert.equal(snapshot.cancelRequested,true);
  assert.deepEqual(f.host.readOriginalSendIdentity(b),identity);await f.close();closed=true;
  restarted=await mailSendIdentityScenario({path});
  assert.deepEqual(restarted.host.readOriginalSendIdentity(b),identity);
  assert.deepEqual(restarted.application.runtime.getTask(taskId),snapshot);assert.equal(restarted.sends(),0);assert.equal(restarted.cloudCalls(),0);
  // Identity read is not a permission to resume a cancelled task or to replace the original scope.
  assert.throws(()=>prepareOriginalMailSendIdentity(restarted.application.runtime,{...b,accountRef:identity.accountRef,configurationRef:identity.configurationRef},
    {messageId:identity.messageId,idempotencyKey:identity.idempotencyKey},
    {taskId,runId:b.runId,authorizationRef:b.scopeRef,argumentsDigest:identity.argumentsDigest,scopes:['mail:send'],
      signal:new AbortController().signal,deadline:identity.deadline}),{code:'UNAUTHORIZED'});
  restarted.application.runtime.saveCheckpoint(taskId,'private-copy-erasure',{state:'withheld'});
  assert.throws(()=>restarted.host.readOriginalSendIdentity(b),{code:'UNAUTHORIZED'});
});

test('process exits inside first sendMail with identity already committed; restart reads original and never sends',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'pa-mail-crash-'));
  const path=join(directory,'runtime.sqlite'),child=spawnSync(process.execPath,
    [fileURLToPath(new URL('./fixtures/mail-send-identity-scenario.mjs',import.meta.url)),path],{encoding:'utf8',timeout:15000,windowsHide:true});
  assert.equal(child.status,77,child.stderr);
  const f=await mailSendIdentityScenario({path});t.after(async()=>{await f.close();rmSync(directory,{recursive:true,force:true});});
  const task=f.application.runtime.findTaskByIdempotencyKey('mail-send-identity');assert.ok(task);
  const b=binding(f,task.taskId),identity=f.host.readOriginalSendIdentity(b),snapshot=f.application.runtime.getTask(task.taskId);
  assert.ok(identity);assert.equal(f.application.runtime.readToolExecutions(task.taskId)[0].state,'started');
  assert.deepEqual(f.host.readOriginalSendIdentity(b),identity);assert.deepEqual(f.application.runtime.getTask(task.taskId),snapshot);
  assert.equal(f.sends(),0);assert.equal(f.cloudCalls(),0);
  const provider=new QQMailProvider({user:'synthetic@example.invalid',authCode:'offline-unused'});let smtp=0;
  provider.transporter={sendMail(){smtp++;throw Error('must not replay');},close(){}};
  const result=await provider.send(identity.accountRef,{...mailArguments,timeoutMs:100,idempotencyKey:identity.runId},{beforeSend:actual=>{
    assert.equal(actual.messageId,identity.messageId);return 'existing';}});
  assert.equal(result.state,'unknown');assert.equal(smtp,0);
  const exact={...b,accountRef:identity.accountRef,configurationRef:identity.configurationRef};
  assert.deepEqual(readOriginalMailSendIdentity(f.application.runtime,exact),identity);
});

test('a provider omitting the hook cannot claim recovery identity or supported successful execution',async t=>{
  for(const mode of ['omitted-hook','legacy-provider'])await t.test(mode,async t=>{
    const f=await mailSendIdentityScenario({mode});t.after(()=>f.close());const taskId=await f.send();
    await f.wait(()=>['succeeded','failed','waiting_reconciliation'].includes(f.application.runtime.getTask(taskId).state));
    assert.equal(f.host.readOriginalSendIdentity(binding(f,taskId)),undefined);assert.equal(f.sends(),0);
    if(mode==='omitted-hook')assert.notEqual(f.application.runtime.readToolExecutions(taskId)[0].state,'confirmed');
  });
});

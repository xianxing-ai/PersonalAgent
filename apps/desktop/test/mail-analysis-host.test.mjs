import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {Client} from '@personal-agent/client';
import {createMailConfig} from '../electron/mail-config.js';
import {createDesktopMailAnalysisHost} from '../electron/mail-analysis-host.js';

const cache=new URL('../../../.cache/mail-analysis-tests/',import.meta.url);mkdirSync(cache,{recursive:true});
const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),
  decryptString:value=>Buffer.from(value).reverse().toString()};
const until=async predicate=>{for(let n=0;n<100;n++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('Task did not settle');};

test('mail cloud permission is separate from local read, revoked immediately and not restored',async()=>{
  const options={userData:mkdtempSync(new URL('config-',cache)),safeStorage};
  const config=createMailConfig(options);
  await config.configure({user:'synthetic@qq.com',authCode:'syntheticonly',readConsent:true});
  assert.equal(config.snapshot().sessionAllowed,false,'saving credentials never grants even a legacy read session');
  config.markBound(config.current().revision);
  config.enableSession({readConsent:true}); // Explicit legacy host-only compatibility, not the production question path.
  assert.equal(config.cloudLease(),undefined);
  assert.throws(()=>config.enableCloudAnalysis({cloudAnalysisConsent:false}));
  config.enableCloudAnalysis({cloudAnalysisConsent:true});const first=config.cloudLease();assert.ok(first);
  assert.equal(createMailConfig(options).snapshot().cloudAnalysisAllowed,false);
  await config.revokeCloudAnalysis();assert.equal(config.cloudLease(),undefined);
  assert.equal(config.snapshot().sessionAllowed,true);
  config.enableCloudAnalysis({cloudAnalysisConsent:true});assert.notEqual(config.cloudLease(),first);
  await config.revoke();assert.equal(config.cloudLease(),undefined);
});

test('mail handoff uses Runtime idempotency, checks current revision and retains visible task receipts',async t=>{
  const root=mkdtempSync(new URL('runtime-',cache));let host,sends=0,lease='explicit-grant';
  let item={workKey:'mail-1:r1',messageId:'mail-1',sourceRevision:'r1',sessionId:'read-session',
    projectionDigest:'digest-1',receipt:{id:'receipt-1'},route:'main_agent',state:'pending',
    projection:{headersOnly:true,sensitivity:'private',text:'Subject: Synthetic meeting moved to Friday'}};
  const config={cloudLease:()=>lease};
  const mail={pendingAnalyses:()=>item.state==='pending'?[structuredClone(item)]:[],
    readAnalysis:()=>structuredClone(item),confirmAnalysisAccepted(input){
      assert.equal(input.sourceRevision,item.sourceRevision);item={...item,state:'accepted',taskId:input.taskId};}};
  const app=createRuntimeApplication({path:path.join(root,'runtime.sqlite'),profile:'huawei_ict_agentarts',
    coordination:{async execute(request){host.assertCloudSend(request);sends++;return{kind:'text',text:'建议已生成',verification:'unverified'};}}});
  const client=new Client(app);await client.connect();let displayed;
  host=createDesktopMailAnalysisHost({application:app,client,mail,config,namespace:'test',onTask:value=>{displayed=value;}});
  t.after(async()=>{host.close();await until(()=>app.activeTaskCount===0);app.close();});
  await host.tick();await until(()=>app.runtime.getTask(item.taskId).state==='succeeded');
  assert.equal(sends,1);assert.equal(displayed.taskId,item.taskId);
  item.state='pending';await host.tick();assert.equal(sends,1); // submit succeeded but ack had been lost
  const task=app.runtime.getTask(item.taskId);
  const request={taskId:task.taskId,goal:task.goal,signal:new AbortController().signal};
  host.assertCloudSend(request);
  item.sourceRevision='r2';assert.throws(()=>host.assertCloudSend(request));item.sourceRevision='r1';
  lease=undefined;assert.throws(()=>host.assertCloudSend(request));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
const require=createRequire(import.meta.url);
const {questionBinding,approveQuestions}=require('../../../tests/manual/connectors/desktop-authorization-live.cjs');
const {changeAudit}=require('../../../tests/manual/connectors/desktop-change-notification-live.cjs');

function fixture(t){
  const directory=mkdtempSync(join(tmpdir(),'pa-connector-live-runner-')),database=join(directory,'runtime.sqlite');
  const db=new DatabaseSync(database);
  db.exec('CREATE TABLE task_checkpoints(task_id TEXT,checkpoint_key TEXT,value_json TEXT);'
    +'CREATE TABLE trusted_host_state(namespace TEXT,value_json TEXT);'
    +'CREATE TABLE tasks(task_id TEXT,conversation_id TEXT,state TEXT,evidence_refs_json TEXT);'
    +'CREATE TABLE tool_execution_records(record_json TEXT)');
  const save=(task,key,value)=>db.prepare('INSERT INTO task_checkpoints VALUES(?,?,?)').run(task,key,JSON.stringify(value));
  const question={questionId:'synthetic-question',taskId:'synthetic-task',sourceApprovalId:'synthetic-run',
    toolName:'mail.inbox',revision:1,state:'pending',expiresAt:new Date(Date.now()+60_000).toISOString(),requirements:[]};
  const args={folder:'INBOX',limit:1},anchor={taskId:question.taskId,runId:question.sourceApprovalId,toolName:question.toolName,
    proposalId:'synthetic-proposal',argumentsDigest:toolArgumentsDigest(args),deadline:question.expiresAt};
  save(question.taskId,'authorization-question-binding:'+question.sourceApprovalId,anchor);
  save(question.taskId,'application-tool-invocation:'+question.sourceApprovalId,{arguments:args});
  t.after(()=>{db.close();const target=resolve(directory);assert.ok(target.startsWith(resolve(tmpdir())+sep));rmSync(target,{recursive:true,force:true});});
  return {db,database,save,question,anchor,args};
}

test('live card driver refuses a substituted run, altered frozen arguments and expired question before any UI click',async t=>{
  const f=fixture(t);assert.deepEqual(questionBinding(f.database,f.question).arguments,f.args);
  assert.throws(()=>questionBinding(f.database,{...f.question,toolName:'mail.mark_seen'}),/exact original Runtime invocation/);
  f.db.prepare('UPDATE task_checkpoints SET value_json=? WHERE checkpoint_key=?')
    .run(JSON.stringify({arguments:{folder:'INBOX',limit:100}}),'application-tool-invocation:'+f.question.sourceApprovalId);
  const page={locator(){assert.fail('a rejected question cannot click the UI');}};
  const options={page,database:f.database,value:{authorizationQuestions:[f.question]},allowed:['mail.inbox'],
    validate(){assert.fail('altered arguments must fail before scope validation');},report:{}};
  await assert.rejects(approveQuestions(options),/argument digest/);
  await assert.rejects(approveQuestions({...options,value:{authorizationQuestions:[{...f.question,expiresAt:'2000-01-01T00:00:00.000Z'}]}}),/must be current/);
});

test('real change receipt projection retains original identities and native Evidence while dropping private content',t=>{
  const f=fixture(t),privateText='SYNTHETIC_PRIVATE_HEADER_DO_NOT_PROJECT';
  f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?)').run('decision-task','original-conversation','succeeded','["source-run"]');
  f.db.prepare('INSERT INTO tool_execution_records VALUES(?)').run(JSON.stringify({taskId:'source-task',evidenceId:'source-run',
    toolName:'mail.inbox',state:'confirmed',policyDecision:'allow',executionStarted:true,privateText}));
  f.save('source-task','desktop-connector-watch-origin',{watchId:'original-watch'});
  f.save('decision-task','connector-change-decision',{action:'notify',reason:'selected',receiptId:'local-receipt',calibrated:false,
    deadline:f.question.expiresAt,decidedAt:new Date().toISOString()});
  const state=(namespace,value)=>f.db.prepare('INSERT INTO trusted_host_state VALUES(?,?)')
    .run(namespace,JSON.stringify({_paAtomicStateVersion:1,revision:1,value}));
  state('desktop-connector-changes',{sources:{source:{kind:'mail',initialized:true,heads:{privateText}}},events:{event:{
    id:'event',kind:'mail.new',state:'delivered',observedAt:new Date().toISOString(),origin:{taskId:'source-task',runId:'source-run'},
    decisionTaskId:'decision-task',notificationBatchId:'original-batch',details:{privateText}}}});
  state('desktop-connector-watches',{watches:{watch:{id:'original-watch',source:'mail',enabled:true,state:'monitoring',sequence:2,
    conversationId:'original-conversation',origin:{taskId:'original-start'},input:{expiresAt:f.question.expiresAt},privateText}}});
  state('device-notifications',{interruption:{feed:[{contentRef:privateText}],rounds:{round:{roundId:'original-round',
    itemIds:['event'],batchIds:['original-batch'],counted:true,reason:'quota_reserved',attempts:{banner:{state:'delivered',
      evidenceRefs:['desktop-notification:original-show:show']}}}}}});
  const value=changeAudit(f.database);assert.doesNotMatch(JSON.stringify(value),new RegExp(privateText));
  assert.equal(value.events[0].sourceWatch,'original-watch');assert.equal(value.events[0].decision.receiptId,'local-receipt');
  assert.equal(value.events[0].sourceExecution.policyDecision,'allow');
  assert.deepEqual(value.events[0].round.banner.evidenceRefs,['desktop-notification:original-show:show']);
});

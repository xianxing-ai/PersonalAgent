import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';
import {createProactiveHostProofs} from '@personal-agent/agentarts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createCloudRuntimeReminders} from './cloud-runtime-reminders.mjs';
import {createCloudRuntimeNotifications} from './cloud-runtime-notifications.mjs';

const until=async predicate=>{for(let n=0;n<100;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Original reminder task did not settle');};
test('cloud reminders use original approval, schedule and notification receipt without replacing unknown operations',async()=>{
  mkdirSync('.cache',{recursive:true});const file=join(resolve(mkdtempSync(join('.cache','cloud-reminders-'))),'runtime.sqlite');
  let application,notifications,clock=Date.now(),lostReceipt=false,executions=0;
  const namespace='reminder-fixture',now=()=>clock;
  const reminders=createCloudRuntimeReminders({getApplication:()=>application,getNotifications:()=>notifications,namespace,assertCurrent(){},now});
  // Inject only a lost response after the actual original todo write; never fabricate a successful result.
  const tools=reminders.tools.map(tool=>({...tool,execute:async(input,context)=>{
    executions++;const result=await tool.execute(input,context);
    if(lostReceipt)throw new ProtocolError('RESULT_UNKNOWN','Fixture lost the original post-write receipt');
    return result;
  }}));
  application=createRuntimeApplication({path:file,profile:'huawei_ict_agentarts',hostUserNamespace:namespace,proactiveWorkflows:true,
    tools,hostOnlyTools:tools.map(tool=>tool.descriptor.name),now:()=>new Date(clock)});
  notifications=createCloudRuntimeNotifications({application,assertCurrent(){},now});
  const bindings=new Map(),proofs=createProactiveHostProofs('explicit-offline-reminder-proof-fixture-32');
  const bind=name=>{
    const source=application.runtime.submitTask({goal:'Explicit original reminder '+name,conversationId:'cloud-user:'+name,idempotencyKey:'source:'+name});
    const task=application.runtime.submitTask({goal:source.goal,conversationId:source.conversationId,idempotencyKey:'responsibility:'+name});
    const binding={taskId:task.taskId,sourceTaskId:source.taskId,sessionId:name,taskDeadline:new Date(clock+300_000).toISOString(),
      goalDigest:createHash('sha256').update(source.goal).digest('hex')};
    const host=application.createProactiveWorkflowHost({...binding,contractRef:'fixture-contract',
      advancePort:async()=>assert.fail('No cloud inference in reminder fixture'),verifyAdvance:()=>false,sign:proofs.sign,localDeviceAvailable:()=>false});
    host.ingestUserInstruction({sourceTaskId:source.taskId},{deadline:binding.taskDeadline,signal:new AbortController().signal});
    bindings.set(task.taskId,binding);return binding;
  };
  reminders.bindWorkflow({readBinding:id=>{const binding=bindings.get(id);assert.ok(binding);return binding;}});
  try {
    const first=bind('first'),other=bind('other'),remindUtc=new Date(clock+2_000).toISOString();
    const input={action:'create',title:'Original future reminder',remindUtc,missedPolicy:'run_once'};
    reminders.configure(first,input,'create-one');const [child]=reminders.approvalTaskIds(first);
    await until(()=>application.runtime.getTask(child).state==='waiting_approval'&&application.activeTaskCount===0);
    assert.equal(executions,0);assert.deepEqual(reminders.snapshot(first).items,[]);
    const read=application.readHostToolTask(child),approval=application.runtime.getApproval(read.approval.approvalId);
    assert.equal(approval.taskId,child);assert.equal(approval.toolName,'todo.create');
    assert.equal(approval.argumentsDigest,toolArgumentsDigest({title:input.title,remindUtc,missedPolicy:'run_once'}));
    reminders.restrict(first,'pause');assert.equal(application.runtime.getTask(child).state,'waiting_approval');
    await reminders.maintain(first);await reminders.maintain(first);
    assert.deepEqual(reminders.approvalTaskIds(first),[child]);assert.equal(executions,0);
    assert.throws(()=>reminders.assertReadCurrent(other,child),{code:'UNAUTHORIZED'});
    assert.throws(()=>reminders.configure(first,input,'replace-pending'),{code:'RESULT_UNKNOWN'});
    application.runtime.respondApproval(read.approval.approvalId,'allow_once',read.approval.revision);
    await reminders.maintain(first);await until(()=>application.runtime.getTask(child).state==='succeeded'&&application.activeTaskCount===0);
    assert.equal(executions,1);assert.ok(application.readHostToolTask(child).confirmed);
    const created=reminders.snapshot(first).items[0];assert.equal(created.title,input.title);
    assert.throws(()=>reminders.configure(other,{action:'update',id:created.id,expectedRevision:created.revision,status:'done'},'wrong-parent'),{code:'NOT_FOUND'});
    await reminders.maintain(first);assert.equal(notifications.snapshot(first).items.length,0);
    clock+=3_000;await reminders.maintain(first);
    const feed=notifications.snapshot(first);assert.equal(feed.items.length,1);assert.equal(feed.delivery,'waiting_device');
    assert.equal(reminders.snapshot(first).items[0].reminderState,'delivered','Original todo state denotes queued dispatch, not device delivery');
    await reminders.maintain(first);assert.equal(notifications.snapshot(first).items.length,1);assert.equal(executions,1);
    assert.deepEqual(notifications.snapshot(other).items,[]);
    lostReceipt=true;reminders.configure(first,{action:'create',title:'Actual write with lost response'},'unknown-write');
    const unknown=reminders.approvalTaskIds(first).at(-1);
    await until(()=>application.runtime.getTask(unknown).state==='waiting_approval'&&application.activeTaskCount===0);
    const pending=application.readHostToolTask(unknown).approval;
    application.runtime.respondApproval(pending.approvalId,'allow_once',pending.revision);await reminders.maintain(first);
    await until(()=>application.runtime.getTask(unknown).state==='waiting_reconciliation'&&application.activeTaskCount===0);
    assert.equal(executions,2);const identities=reminders.approvalTaskIds(first);
    await reminders.maintain(first);assert.deepEqual(reminders.approvalTaskIds(first),identities);assert.equal(executions,2);
    assert.throws(()=>reminders.configure(first,{action:'create',title:'Do not replace unknown'},'new-identity'),{code:'RESULT_UNKNOWN'});
    assert.equal(reminders.snapshot(first).items.length,2,'The actual unknown write is retained without replay');
  } finally {await reminders.close();application.close();}
});

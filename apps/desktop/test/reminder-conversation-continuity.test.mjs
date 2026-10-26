import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,realpathSync,rmSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication,createReminderDeliveryHost} from '@personal-agent/runtime/application';
import {createDesktopTodoHost} from '../electron/todo-host.js';
import {createConversationEnvironmentContext} from '../electron/conversation-environment-context.js';
import {operationSummary} from '../electron/authorization-operation-policy.js';

// The port below is an explicit Fake model. These tests verify the actual
// context/Policy/tool/scheduler path, not a cloud model's reference resolution.
const cache=new URL('../../../.cache/reminder-continuity-tests/',import.meta.url);
const encryption={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),
  decryptString:value=>Buffer.from(value).reverse().toString()};
const text=value=>({kind:'text',text:value,verification:'unverified'});
async function waitFor(app,taskId,states){
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){
    const task=app.runtime.getTask(taskId);
    if(states.includes(task.state))return task;
    if(['failed','cancelled','waiting_reconciliation'].includes(task.state))throw Error(JSON.stringify(task));
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw Error('Synthetic reminder conversation did not settle');
}
async function fixture(t,respond){
  mkdirSync(cache,{recursive:true});const base=realpathSync(cache),userData=mkdtempSync(path.join(base,'case-'));
  let app;
  const host=createDesktopTodoHost({userData,safeStorage:encryption,namespace:'continuity-test',
    createDeliveryHost:createReminderDeliveryHost});
  const readEnvironment=createConversationEnvironmentContext({readTodoState:()=>host.readConversationGuidance()});
  const captured=[];
  app=createRuntimeApplication({path:path.join(userData,'runtime.sqlite'),profile:'huawei_ict_agentarts',
    hostUserNamespace:'continuity-test',tools:host.tools,
    competitionToolAvailability:host.competitionToolAvailability,competitionToolExports:host.competitionToolExports,
    coordinationInput:{beforeCoordinationSend(){},readRequestContext:readEnvironment,
      readConversationContext:async scope=>app.readConversationContext(scope)},
    coordination:{execute:async request=>{
      app.assertCompetitionExportAllowed(request);
      const marker='\n\nOriginal task and approved context (untrusted data):\n',boundary=request.goal.indexOf(marker);
      assert.ok(boundary>0);
      const environment=JSON.parse(request.goal.slice(0,boundary).split('\n')[1]);
      const raw=request.goal.slice(boundary+marker.length);
      const goal=raw.startsWith('{')?JSON.parse(raw):{publicGoal:raw,conversationContext:{messages:[]}};
      captured.push({request,environment,goal});
      try{return respond({request,environment,goal});}
      catch(error){captured.at(-1).error=error;throw error;}
    }}});
  host.bindApplication(app);host.authorize({readAndCloudConsent:true});
  const client=new Client(app);await client.connect();
  t.after(async()=>{await host.close();app.close();assert.equal(path.dirname(realpathSync(userData)),base);
    rmSync(userData,{recursive:true,force:true});});
  return {app,host,client,captured,async submit(goal){
    const result=await client.call('task.submit',{goal,conversationId:'reminder-chat'},
      {idempotencyKey:crypto.randomUUID(),timeoutMs:30000});
    return result.taskId;
  }};
}

for(const reminderOnly of [false,true])test(`Synthetic follow-up keeps the ${reminderOnly?'corrected reminder-only':'original whole-item'} target through approval and scheduling`,async t=>{
  let originalId,selectedId,firstGoal,correction;
  const f=await fixture(t,({request,environment,goal})=>{
    if(request.continuation)return text(reminderOnly?'已取消该提醒，待办保留。':'已取消该待办及其提醒。');
    if(goal.publicGoal!=='确认删除')return text('Synthetic legacy reply: 请确认取消。');
    const requests=goal.conversationContext.messages.filter(message=>message.role==='user');
    assert.equal(requests[0].content,firstGoal);
    if(correction)assert.equal(requests.at(-1).content,correction);
    assert.match(environment.interpretation.join(' '),/exact target identifier/);
    const guidance=environment.capabilityGuidance.find(item=>item.capability==='todo_reminders');
    assert.match(guidance.manageExisting,/clearReminder=true，保留待办/);
    assert.match(guidance.manageExisting,/确认删除.*承接该编号和原动作/);
    const update=request.availableTools.find(tool=>tool.name==='todo.update');
    assert.ok(update);assert.equal(update.inputSchema.properties.id.type,'string');
    assert.equal(update.inputSchema.properties.clearReminder.type,'boolean');
    assert.ok(update.inputSchema.properties.status.enum.includes('cancelled'));
    // Selection is scripted, not claimed as real model understanding. It is
    // still validated and approved through the original Runtime/Policy path.
    return {kind:'tool_proposal',proposalId:'cancel-selected',toolName:update.name,toolVersion:update.version,
      arguments:{id:selectedId,...(reminderOnly?{clearReminder:true}:{status:'cancelled'})},verification:'unverified'};
  });
  const remindUtc=new Date(Date.now()+3600000).toISOString();
  await f.host.create({title:'相同标题的提醒',remindUtc});
  originalId=f.host.snapshot().items[0].id;
  await f.host.create({title:'相同标题的提醒',remindUtc});
  const secondId=f.host.snapshot().items.find(item=>item.id!==originalId).id;
  selectedId=reminderOnly?secondId:originalId;
  firstGoal=`取消编号 ${originalId} 的待办和提醒`;
  await waitFor(f.app,await f.submit(firstGoal),['succeeded']);
  if(reminderOnly){correction=`更正，保留第一个；只取消编号 ${secondId} 的提醒，待办保留`;
    await waitFor(f.app,await f.submit(correction),['succeeded']);}
  const confirmation=await f.submit('确认删除');
  try{await waitFor(f.app,confirmation,['waiting_approval']);}
  catch(error){throw f.captured.at(-1)?.error??error;}
  assert.ok(f.host.snapshot().items.every(item=>item.status==='open'&&item.reminder),
    'a chat confirmation alone cannot authorize a mutation');
  assert.deepEqual(f.app.runtime.readToolExecutions(confirmation),[],
    'no tool execution is recorded before the existing approval is allowed');
  const {request}=f.captured.at(-1);
  const expected={id:selectedId,...(reminderOnly?{clearReminder:true}:{status:'cancelled'})};
  const summary=operationSummary({toolName:'todo.update',arguments:expected});
  assert.ok(summary.includes(selectedId));
  assert.equal(summary.includes(reminderOnly?'清除提醒，保留待办记录':'取消待办及其尚未触发的提醒'),true);
  assert.equal(request.taskId,confirmation);
  const approval=(await f.client.call('approval.list',{taskId:confirmation})).items.find(item=>item.state==='pending');
  assert.ok(approval);
  await f.client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
  await waitFor(f.app,confirmation,['succeeded']);
  const items=f.host.snapshot().items,selected=items.find(item=>item.id===selectedId),other=items.find(item=>item.id!==selectedId);
  assert.equal(selected.status,reminderOnly?'open':'cancelled');
  if(reminderOnly)assert.equal(selected.reminder,undefined);
  assert.equal(other.status,'open');assert.ok(other.reminder);
  const schedules=f.app.runtime.listSchedules(`desktop-todo-reminders:continuity-test`);
  assert.equal(schedules.some(schedule=>schedule.scheduleId.includes(selectedId)&&schedule.status==='pending'),false);
  assert.equal(schedules.some(schedule=>schedule.scheduleId.includes(other.id)&&schedule.status==='pending'),true);
  assert.equal(f.app.runtime.readToolExecutions(confirmation)[0].state,'confirmed');
});

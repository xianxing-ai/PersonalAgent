import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {createRuntimeApplication,createReminderDeliveryHost,AuthorizationQuestions} from '@personal-agent/runtime/application';
import {createDesktopTodoHost} from '../electron/todo-host.js';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';

const pause=()=>new Promise(resolve=>setTimeout(resolve,5));
async function until(read){for(let i=0;i<1000;i++){const value=read();if(value)return value;await pause();}throw Error('Original state did not arrive');}
async function fixture(t){
  const cache=new URL('../../../.cache/todo-revision-approval/',import.meta.url);mkdirSync(cache,{recursive:true});
  const userData=mkdtempSync(new URL('case-',cache));let app;
  const question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>app,
    namespace:'revision',resolveConversation:taskId=>app.readToolConversation(taskId)??app.runtime.getTask(taskId).conversationId,
    available:()=>true,profiles:[{ref:'bounded',revision:1,mode:'workspace-write',available:true,label:'Fixture policy'}],defaultProfileRef:'bounded'});
  const host=createDesktopTodoHost({userData,namespace:'revision',question,createDeliveryHost:createReminderDeliveryHost,
    safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>Buffer.from(value).toString()}});
  app=createRuntimeApplication({path:path.join(userData,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'revision',tools:host.tools,
    requiresToolAuthorization:()=>true,requestToolAuthorization:async scope=>{
      const intent=app.runtime.loadCheckpoint(scope.taskId,'host-tool-intent');
      host.prepareExport({...scope,phase:'preflight',proposal:{kind:'tool_proposal',proposalId:intent.commandId,
        toolName:intent.toolName,toolVersion:intent.toolVersion,arguments:intent.arguments}});
      return question.requestToolAuthorization(scope);
    }});
  host.bindApplication(app);
  t.after(async()=>{for(const task of app.runtime.listTasks({limit:100}).items)if(!['succeeded','failed','cancelled'].includes(task.state))app.runtime.requestCancel(task.taskId);
    question.close();await host.close();for(let i=0;i<300&&app.activeTaskCount;i++)await pause();app.close();});
  await host.create({title:'Original travel reminder',remindUtc:new Date(Date.now()+120000).toISOString()});
  const original=host.snapshot().items[0],schedule=app.runtime.listSchedules('desktop-todo-reminders:revision')[0];
  async function propose(args){
    const tool=host.tools.find(item=>item.descriptor.name==='todo.update');
    const {task}=app.submitHostToolTask({commandId:crypto.randomUUID(),toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
      arguments:args,deadline:new Date(Date.now()+60000).toISOString()});
    const card=await until(()=>question.snapshot().find(item=>item.state==='pending'&&app.runtime.getApproval(item.sourceApprovalId).taskId===task.taskId));
    return {task,card};
  }
  async function approve({task,card}){
    const response=question.respond({questionId:card.questionId,expectedRevision:card.revision,decision:'allow_once'},card.conversationId);
    assert.equal(response.accepted,true);
    await until(()=>!['created','queued','running','waiting_approval'].includes(app.runtime.getTask(task.taskId).state));
    return app.readHostToolTask(task.taskId);
  }
  return {app,host,original,schedule,propose,approve};
}

test('original revision conditional clear crosses actual question/Policy and cancels only its schedule',async t=>{
  const f=await fixture(t),pending=await f.propose({id:f.original.id,expectedRevision:1,clearReminder:true});
  const result=await f.approve(pending);assert.equal(result.task.state,'succeeded');
  assert.equal(result.confirmed.result.item.revision,2);assert.equal(result.confirmed.result.item.reminder,undefined);
  assert.equal(f.app.runtime.getSchedule(f.schedule.scheduleId).status,'cancelled');
  assert.equal(f.app.runtime.readToolExecutions(pending.task.taskId)[0].policyDecision,'allow');
});

for(const change of ['edit','reschedule','cancel'])test('old clear approval cannot consume a reminder changed during the question: '+change,async t=>{
  const f=await fixture(t),pending=await f.propose({id:f.original.id,expectedRevision:1,clearReminder:true});
  if(change==='reschedule'){
    const edit=await f.propose({id:f.original.id,expectedRevision:1,remindUtc:new Date(Date.now()+240000).toISOString()});
    assert.equal((await f.approve(edit)).task.state,'succeeded');
  }else await f.host.update({id:f.original.id,...(change==='cancel'?{status:'cancelled'}:{title:'User edited this reminder'})});
  const current=structuredClone(f.host.snapshot().items[0]),schedules=structuredClone(f.app.runtime.listSchedules('desktop-todo-reminders:revision'));
  const result=await f.approve(pending);assert.notEqual(result.task.state,'succeeded');
  assert.match(result.task.error?.message??'',/REVISION_CONFLICT/);
  assert.deepEqual(f.host.snapshot().items[0],current);assert.ok(current.reminder);
  assert.deepEqual(f.app.runtime.listSchedules('desktop-todo-reminders:revision'),schedules);
  if(change==='reschedule'){
    assert.equal(f.app.runtime.getSchedule(f.schedule.scheduleId).status,'cancelled');
    assert.equal(schedules.find(item=>item.runAt===current.reminder.remindAt.utc).status,'pending');
  }
});

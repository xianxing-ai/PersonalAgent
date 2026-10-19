import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopProactiveConversationTools} from '../electron/proactive-conversation-tools.js';

function fixture() {
  const deadline=new Date(Date.now()+60_000).toISOString(),calls=[];
  const tasks=new Map([['source',{taskId:'source',conversationId:'desktop-panel:public-fixture',state:'running'}],
    ['session',{taskId:'session',conversationId:'desktop-panel:public-fixture',state:'running'}],
    ['foreign',{taskId:'foreign',conversationId:'desktop-panel:other',state:'running'}]]);
  const application={runtime:{getTask:id=>{if(!tasks.has(id))throw Error('not found');return tasks.get(id);},
    loadCheckpoint:(_,key)=>key==='application-deadline'?deadline:undefined}};
  const summary={taskId:'session',mode:'attended',controlRevision:2,taskState:'running',items:0};
  const host={snapshot:()=>({state:'configured_not_verified'}),
    listConversation:id=>{calls.push(['list',id]);return {sessions:[summary],truncated:false};},
    start:async(input,lifetime)=>{calls.push(['start',input,lifetime]);return {accepted:true,taskId:'session',sessionId:'public-session'};},
    control:async(input,lifetime)=>{calls.push(['control',input,lifetime]);return {checkpoint:'SECRET_NOT_FOR_MODEL'};},
    readSummary:async(id,lifetime)=>{calls.push(['read',id,lifetime]);return summary;}};
  const adapter=createDesktopProactiveConversationTools({getApplication:()=>application,getHost:()=>host,
    isConversationAllowed:id=>id==='desktop-panel:public-fixture'});
  const context={taskId:'source',runId:'public-proposal',deadline,signal:new AbortController().signal,scopes:['proactive:control']};
  const tool=name=>adapter.tools.find(item=>item.descriptor.name==='proactive.workflow.'+name);
  return {adapter,context,tool,calls,tasks,host};
}

test('Synthetic conversation tool surface publishes executable bounded schemas without host-only parameters',async()=>{
  const {adapter,context,tool,calls}=fixture();
  assert.deepEqual(adapter.tools.map(item=>item.descriptor.name),[
    'proactive.workflow.list','proactive.workflow.start','proactive.workflow.read','proactive.workflow.control']);
  for(const descriptor of adapter.tools.map(item=>item.descriptor)) {
    assert.equal(descriptor.inputSchema.additionalProperties,false);
    assert.equal(JSON.stringify(descriptor.inputSchema).includes('sourceTaskId'),false);
    assert.equal(JSON.stringify(descriptor.inputSchema).includes('commandId'),false);
    assert.equal(JSON.stringify(descriptor).includes('receiptSecret'),false);
  }
  assert.equal(tool('start').descriptor.sideEffect,'local_write');
  assert.equal(tool('control').descriptor.sideEffect,'local_write');
  assert.deepEqual(adapter.competitionToolAvailability.find(item=>item.toolName.endsWith('.control')).publicEnumPaths,['/action']);
  assert.equal(adapter.competitionToolAvailability[0].available(context),true);
  await tool('start').execute({taskDeadline:context.deadline},context);
  const first=calls.at(-1)[1];assert.equal(first.sourceTaskId,'source');assert.match(first.commandId,/^conversation-[a-f0-9]{64}$/);
  await tool('start').execute({taskDeadline:context.deadline},context);
  assert.equal(calls.at(-1)[1].commandId,first.commandId,'retry preserves original command identity');
  const result=await tool('control').execute({taskId:'session',action:'return',expectedControlRevision:2},context);
  assert.equal(calls.find(item=>item[0]==='control')[1].sourceTaskId,'source');
  assert.equal(JSON.stringify(result).includes('SECRET'),false);
  const projected=adapter.competitionToolExports.find(item=>item.toolName.endsWith('.control')).project({
    taskId:'source',result,signal:context.signal});
  assert.deepEqual(projected,result);
  assert.notEqual(projected,result);
});

test('Synthetic current-conversation checks reject foreign session, cancellation, expiry and missing host',async()=>{
  const {adapter,context,tool,tasks,host}=fixture();
  await assert.rejects(tool('control').execute({taskId:'foreign',action:'cancel',expectedControlRevision:0},context),/当前对话/);
  await assert.rejects(tool('read').execute({taskId:'foreign'},context),/当前对话/);
  tasks.get('source').cancelRequested=true;
  assert.equal(adapter.competitionToolAvailability[0].available(context),false);
  await assert.rejects(tool('start').execute({taskDeadline:context.deadline},context),/指令不可用/);
  tasks.get('source').cancelRequested=false;
  await assert.rejects(tool('list').execute({}, {...context,deadline:'2020-01-01T00:00:00.000Z'}),/过期/);
  const abort=new AbortController();abort.abort();
  await assert.rejects(tool('list').execute({}, {...context,signal:abort.signal}),/取消/);
  host.snapshot=()=>({state:'unavailable'});
  assert.equal(adapter.competitionToolAvailability[0].available(context),false);
});

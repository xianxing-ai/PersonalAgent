import test from 'node:test';
import assert from 'node:assert/strict';
import {projectSubagentActivity,openTaskConversation,readSubagentConversation} from '../electron/subagent-activity.js';
import {liveWorkFeedbackText} from '../src/app/live-voice-controls.js';

test('workspace shows voice children from another conversation; panel remains conversation scoped',()=>{
  const tasks=[{taskId:'voice-parent',surface:'panel'},{taskId:'workspace-parent',surface:'workspace'}];
  const children={ 'voice-parent':[{parentTaskId:'voice-parent',taskId:'voice-child',state:'succeeded'}],
    'workspace-parent':[{parentTaskId:'workspace-parent',taskId:'workspace-child',state:'running'}]};
  const options={tasks,visible:(task,surface)=>task.surface===surface,readChildren:id=>children[id],sourceSurface:task=>task.surface};
  assert.deepEqual(projectSubagentActivity({...options,surface:'workspace'}).map(t=>[t.taskId,t.sourceSurface]),
    [['voice-child','panel'],['workspace-child','workspace']]);
  assert.deepEqual(projectSubagentActivity({...options,surface:'panel'}).map(t=>t.taskId),['voice-child']);
  assert.equal(children['voice-parent'][0].sourceSurface,undefined,'do not mutate Runtime readback');
  assert.deepEqual(projectSubagentActivity({...options,readChildren:()=>undefined,surface:'workspace'}),[]);
});

test('activity order uses actual Runtime mutation times for recent records and completion notices',()=>{
  const tasks=[{taskId:'parent',surface:'panel'}];
  const records=projectSubagentActivity({tasks,surface:'workspace',visible:()=>true,sourceSurface:t=>t.surface,
    readChildren:()=>[{parentTaskId:'parent',taskId:'older'},{parentTaskId:'parent',taskId:'recent'}],
    readTask:taskId=>({updatedAt:taskId==='older'?'2026-10-18T00:00:00Z':'2026-10-18T01:00:00Z'})});
  assert.deepEqual(records.map(t=>t.taskId),['recent','older']);
  assert.equal(records[0].updatedAt,'2026-10-18T01:00:00Z');
});

test('opening a parent navigates its original surface and never submits or reruns work',async()=>{
  const events=[];const tasks=new Map([['parent',{taskId:'parent',surface:'panel'}]]);
  const options={tasks,payload:{taskId:'parent'},sourceSurface:t=>t.surface,
    conversations:{conversationIdForTask:()=> 'voice-conversation',switch:(...args)=>events.push(['switch',...args])},
    openPanel:async()=>events.push(['panel']),openWorkspace:async()=>events.push(['workspace']),publish:()=>events.push(['publish'])};
  assert.deepEqual(await openTaskConversation(options),{taskId:'parent',surface:'panel',conversationId:'voice-conversation'});
  assert.deepEqual(events,[['switch','panel','voice-conversation'],['panel'],['publish']]);
  events.length=0;
  await assert.rejects(openTaskConversation({...options,payload:{taskId:'missing'}}),/原始任务不可用/);
  await assert.rejects(openTaskConversation({...options,payload:{taskId:'parent',surface:'workspace'}}),/参数无效/);
  await assert.rejects(openTaskConversation({...options,conversations:{...options.conversations,switch(){throw Error('已归档');}}}),/已归档/);
  assert.deepEqual(events,[],'rejected navigation must not open windows or fabricate a task');
});

function conversationOptions() {
  return {payload:{parentTaskId:'parent',taskId:'child'},tasks:new Map([['parent',{taskId:'parent'}]]),
    readChildren:()=>[{parentTaskId:'parent',taskId:'child',role:'researcher',modelId:'selected-model',reasoningEffort:'high',
      state:'running',resultSummary:'stale summary',evidenceRefs:['private-child-ref']}],
    readTask:()=>({taskId:'child',conversationId:'desktop-subtask:parent',state:'succeeded',goal:'Investigate the requested issue',
      resultSummary:'Readback result',steps:[{stepId:'private-step-id',label:'Read sources',state:'succeeded'}],
      evidenceRefs:['private-evidence-ref'],attachmentRefs:['private-attachment'],
      error:{code:'EXTERNAL_FAILURE',message:'Authorization: Bearer private-secret',retryable:false},
      messages:[{role:'assistant',content:'not a public transcript'}]})};
}

test('child conversation reads fresh public task fields and strips raw evidence, errors and transcript data',async()=>{
  const options=conversationOptions(); const task=options.readTask();
  const detail=await readSubagentConversation({...options,readTask:()=>task});
  assert.deepEqual(detail,{parentTaskId:'parent',taskId:'child',role:'researcher',modelId:'selected-model',reasoningEffort:'high',
    state:'succeeded',goal:'Investigate the requested issue',resultSummary:'Readback result',
    error:{code:'EXTERNAL_FAILURE',retryable:false,message:'子任务返回错误，详细错误信息已隐藏'},
    evidenceRefCount:1,steps:[{label:'Read sources',state:'succeeded'}],transcriptAvailable:false});
  assert.doesNotMatch(JSON.stringify(detail),/private-|not a public transcript|stale summary/);
  detail.steps[0].label='changed in view';
  assert.equal(task.steps[0].label,'Read sources','do not mutate Runtime readback');
});

test('child conversation rejects forged parents and unknown children before reading child details',async()=>{
  const options=conversationOptions(); let readCount=0;
  const readTask=()=>{readCount++;return options.readTask();};
  for (const payload of [null,[],{parentTaskId:'parent',taskId:''},{parentTaskId:'parent',taskId:' child'},
    {...options.payload,goal:'forged'},{parentTaskId:'missing',taskId:'child'},{parentTaskId:'parent',taskId:'missing'}]) {
    await assert.rejects(readSubagentConversation({...options,payload,readTask}));
  }
  await assert.rejects(readSubagentConversation({...options,readTask,
    readChildren:()=>[{parentTaskId:'other-parent',taskId:'child'}]}),/不属于/);
  await assert.rejects(readSubagentConversation({...options,readTask,readChildren:()=>undefined}),/不属于/);
  assert.equal(readCount,0,'unrelated tasks must not be read even if their ID is known');
});

test('child conversation rejects missing or mismatched Runtime snapshots without leaking failures',async()=>{
  const options=conversationOptions();
  await assert.rejects(readSubagentConversation({...options,readTask:()=>{throw Error('private database path');}}),
    {message:'子任务详情不可用，请刷新任务列表'});
  await assert.rejects(readSubagentConversation({...options,readChildren:()=>{throw Error('private checkpoint');}}),
    {message:'子任务列表不可用，请刷新任务列表'});
  await assert.rejects(readSubagentConversation({...options,readTask:()=>({...options.readTask(),taskId:'other-child'})}),/不匹配/);
  await assert.rejects(readSubagentConversation({...options,readTask:()=>({...options.readTask(),conversationId:'desktop-subtask:other-parent'})}),/不匹配/);
  await assert.rejects(readSubagentConversation({...options,readTask:()=>undefined}),/不匹配/);
});

test('child conversation with no result or full messages stays explicitly unavailable',async()=>{
  const options=conversationOptions();
  const detail=await readSubagentConversation({...options,readChildren:async()=>options.readChildren(),
    readTask:async()=>({taskId:'child',conversationId:'desktop-subtask:parent',state:'waiting_reconciliation',steps:[],evidenceRefs:[]})});
  assert.equal(detail.transcriptAvailable,false);
  assert.equal(detail.state,'waiting_reconciliation');
  assert.equal(detail.resultSummary,undefined);
  assert.equal(detail.goal,undefined);
  assert.equal(detail.error,undefined);
  assert.equal(detail.evidenceRefCount,0);
  assert.deepEqual(detail.steps,[]);
  assert.equal(Object.hasOwn(detail,'messages'),false);
});

test('Live feedback distinguishes submitting, accepted, returned and unknown results without claiming child success',()=>{
  assert.match(liveWorkFeedbackText({workRequests:[{state:'submitting'}]}),/尚未确认受理/);
  assert.match(liveWorkFeedbackText({workRequests:[{state:'accepted',taskId:'task-1'}]}),/task-1.*等待结果/);
  assert.match(liveWorkFeedbackText({workRequests:[{state:'awaiting_result',taskId:'task-1'}]}),/尚待核实/);
  const returned=liveWorkFeedbackText({workRequests:[{state:'result_returned',taskId:'task-1'}]});
  assert.match(returned,/回执已返回/);assert.match(returned,/不代表子任务成功/);
  assert.match(liveWorkFeedbackText({workRequests:[{state:'failed'}]}),/未确认/);
});

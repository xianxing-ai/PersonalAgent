import test from 'node:test';import assert from 'node:assert/strict';import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {Conversations} from '../electron/conversations.js';import {handleSessionManagementApi,SESSION_MANAGEMENT_API_REVISION,SESSION_MANAGEMENT_OPERATIONS,SESSION_UNAVAILABLE_OPERATIONS,SessionApiError} from '../electron/session-management-api.js';

function store(){
  const cache=fileURLToPath(new URL('../.cache/session-management-api/',import.meta.url));
  mkdirSync(cache,{recursive:true});
  const folder=mkdtempSync(path.join(cache,'run-'));
  const conversations=new Conversations(path.join(folder,'conversations.json'));
  return {conversations,folder};
}
function rig(overrides={}){
  const tasks=overrides.tasks??new Map();
  const state={published:0};
  return {tasks,
    taskSurface:overrides.taskSurface??(task=>task.surface??'panel'),
    submitting:overrides.submitting??new Set(),
    publish:()=>{state.published++;},
    state,...overrides};
}
const call=(conversations,rigg,name,payload,surface)=>handleSessionManagementApi({name,payload,surface,conversations,tasks:rigg.tasks,taskSurface:rigg.taskSurface,submitting:rigg.submitting,publish:rigg.publish});
const code=fn=>{try{fn();}catch(error){if(error instanceof SessionApiError)return error.code;throw error;}throw Error('expected SessionApiError');};

test('session catalog is published with revision and explicit unavailable marker',()=>{
  assert.ok(SESSION_MANAGEMENT_OPERATIONS.includes('session.delete'));
  assert.deepEqual(SESSION_UNAVAILABLE_OPERATIONS,['session.delete']);
  assert.equal(SESSION_MANAGEMENT_API_REVISION,1);
});

test('session.list and session.active expose the published envelope',()=>{
  const {conversations,folder}=store();
  try{
    const rigg=rig();
    const listed=call(conversations,rigg,'session.list',null,'workspace');
    assert.equal(listed.apiRevision,1);
    assert.equal(listed.activeId,'desktop-workspace');
    assert.equal(listed.sessions.length,1);
    assert.equal(listed.draft,'');
    const active=call(conversations,rigg,'session.active',null,'workspace');
    assert.equal(active.conversationId,'desktop-workspace');
    assert.equal(active.title,'原工作区对话');
  }finally{conversations.close();rmSync(folder,{recursive:true,force:true});}
});

test('create/activate/rename round trip with optimistic concurrency and publish',()=>{
  const {conversations,folder}=store();
  try{
    const rigg=rig();
    const created=call(conversations,rigg,'session.create',{title:'评审对话'},'workspace');
    const id=created.createdId;
    assert.equal(created.activeId,id);
    assert.equal(rigg.state.published,1);
    assert.equal(call(conversations,rigg,'session.rename',{conversationId:id,title:'改名'},'workspace').title,'改名');
    assert.equal(rigg.state.published,2);
    const switched=call(conversations,rigg,'session.activate',{conversationId:'desktop-workspace'},'workspace');
    assert.equal(switched.activeId,'desktop-workspace');
    assert.equal(rigg.state.published,3);
    // Optimistic concurrency: a stale expected id must conflict instead of switching.
    assert.equal(code(()=>call(conversations,rigg,'session.activate',{conversationId:id,expectedConversationId:id},'workspace')),'SESSION_REVISION_CONFLICT');
    const same=call(conversations,rigg,'session.activate',{conversationId:'desktop-workspace',expectedConversationId:'desktop-workspace'},'workspace');
    assert.equal(same.activeId,'desktop-workspace');
    assert.equal(rigg.state.published,3);
  }finally{conversations.close();rmSync(folder,{recursive:true,force:true});}
});

test('activate rejects unknown, cross-surface and archived sessions with explicit codes',()=>{
  const {conversations,folder}=store();
  try{
    const rigg=rig();
    const created=call(conversations,rigg,'session.create',null,'workspace');
    const id=created.createdId;
    assert.equal(code(()=>call(conversations,rigg,'session.activate',{conversationId:'desktop-panel'},'workspace')),'SESSION_NOT_FOUND');
    assert.equal(code(()=>call(conversations,rigg,'session.activate',{conversationId:id},'panel')),'SESSION_SURFACE_LIMITED');
    conversations.archive('workspace',id,true);
    assert.equal(code(()=>call(conversations,rigg,'session.activate',{conversationId:id},'workspace')),'SESSION_ARCHIVED');
  }finally{conversations.close();rmSync(folder,{recursive:true,force:true});}
});

test('panel surface keeps its single-conversation policy in the explicit API',()=>{
  const {conversations,folder}=store();
  try{
    const rigg=rig();
    for(const name of ['session.create','session.activate','session.archive','session.restore']) {
      const payload=name==='session.create'?null:{conversationId:'desktop-panel'};
      assert.equal(code(()=>call(conversations,rigg,name,payload,'panel')),'SESSION_SURFACE_LIMITED');
    }
    // read/write/list/rename stay available on panel.
    assert.equal(call(conversations,rigg,'session.writeDraft',{conversationId:'desktop-panel',text:'草稿'},'panel').saved,true);
    assert.equal(call(conversations,rigg,'session.readDraft',{conversationId:'desktop-panel'},'panel').text,'草稿');
    assert.equal(call(conversations,rigg,'session.rename',{conversationId:'desktop-panel',title:'主对话'},'panel').title,'主对话');
    assert.equal(call(conversations,rigg,'session.list',null,'panel').sessions.length,1);
  }finally{conversations.close();rmSync(folder,{recursive:true,force:true});}
});

test('archive is guarded by submitting and non-terminal tasks, then auto-switches active',()=>{
  const {conversations,folder}=store();
  try{
    const rigg=rig();
    const created=call(conversations,rigg,'session.create',null,'workspace');
    const id=created.createdId;
    conversations.add('task-1','workspace','目标',id);
    const running=rig({tasks:new Map([['task-1',{taskId:'task-1',surface:'workspace',state:'running'}]])});
    assert.equal(code(()=>call(conversations,running,'session.archive',{conversationId:id},'workspace')),'SESSION_TASK_ACTIVE');
    const busy=rig({tasks:new Map([['task-1',{taskId:'task-1',surface:'workspace',state:'running'}]]),submitting:new Set([id])});
    assert.equal(code(()=>call(conversations,busy,'session.archive',{conversationId:id},'workspace')),'SESSION_TASK_SUBMITTING');
    const done=rig({tasks:new Map([['task-1',{taskId:'task-1',surface:'workspace',state:'succeeded'}]])});
    const archived=call(conversations,done,'session.archive',{conversationId:id},'workspace');
    assert.equal(archived.sessions.find(session=>session.id===id).archived,true);
    assert.notEqual(archived.activeId,id);
    const restored=call(conversations,done,'session.restore',{conversationId:id},'workspace');
    assert.equal(restored.sessions.find(session=>session.id===id).archived,false);
  }finally{conversations.close();rmSync(folder,{recursive:true,force:true});}
});

test('draft read/write persists across reopen and rejects archived targets',()=>{
  const folder=store().folder;
  const file=path.join(folder,'conversations.json');
  let conversations=new Conversations(file);
  try{
    const rigg=rig();
    assert.equal(call(conversations,rigg,'session.writeDraft',{conversationId:'desktop-workspace',text:'未发送的问题'},'workspace').saved,true);
    assert.equal(rigg.state.published,0,'draft writes do not publish per keystroke');
  }finally{conversations.close();}
  let reopened;
  try{
    reopened=new Conversations(file);
    const rigg=rig();
    assert.equal(call(reopened,rigg,'session.readDraft',{conversationId:'desktop-workspace'},'workspace').text,'未发送的问题');
    const created=call(reopened,rigg,'session.create',null,'workspace');
    reopened.archive('workspace',created.createdId,true);
    assert.equal(code(()=>call(reopened,rigg,'session.writeDraft',{conversationId:created.createdId,text:'x'},'workspace')),'SESSION_ARCHIVED');
  }finally{reopened?.close();rmSync(folder,{recursive:true,force:true});}
});

test('session.delete is explicitly unavailable, never a silent success',()=>{
  const {conversations,folder}=store();
  try{
    const rigg=rig();
    assert.equal(code(()=>call(conversations,rigg,'session.delete',{conversationId:'desktop-panel'},'panel')),'SESSION_DELETE_UNAVAILABLE');
    assert.equal(rigg.state.published,0);
  }finally{conversations.close();rmSync(folder,{recursive:true,force:true});}
});

test('malformed input fails closed with coded errors',()=>{
  const {conversations,folder}=store();
  try{
    const rigg=rig();
    assert.equal(code(()=>call(conversations,rigg,'session.unknown',null,'workspace')),'SESSION_OPERATION_UNSUPPORTED');
    assert.equal(code(()=>call(conversations,rigg,'session.list',null,'orb')),'SESSION_SURFACE_INVALID');
    assert.equal(code(()=>call(conversations,rigg,'session.list',{extra:1},'workspace')),'SESSION_ARGUMENT_INVALID');
    assert.equal(code(()=>call(conversations,rigg,'session.list',[],'workspace')),'SESSION_ARGUMENT_INVALID');
    assert.equal(code(()=>call(conversations,rigg,'session.activate',{conversationId:'../escape'},'workspace')),'SESSION_ARGUMENT_INVALID');
    assert.equal(code(()=>call(conversations,rigg,'session.activate',{conversationId:'desktop-workspace:00000000-0000-0000-0000-000000000000'},'workspace')),'SESSION_NOT_FOUND');
    assert.equal(code(()=>call(conversations,rigg,'session.writeDraft',{conversationId:'desktop-workspace',text:5},'workspace')),'SESSION_ARGUMENT_INVALID');
    assert.equal(code(()=>call(conversations,rigg,'session.create',{title:'   '},'workspace')),'SESSION_ARGUMENT_INVALID');
    assert.equal(code(()=>handleSessionManagementApi({name:'session.list',payload:null,surface:'workspace',conversations:null})),'SESSION_STORE_UNAVAILABLE');
  }finally{conversations.close();rmSync(folder,{recursive:true,force:true});}
});

test('list envelope omits draft bodies and keeps published metadata',()=>{
  const {conversations,folder}=store();
  try{
    const rigg=rig();
    const created=call(conversations,rigg,'session.create',{title:'快照'},'workspace');
    call(conversations,rigg,'session.writeDraft',{conversationId:created.createdId,text:'仅本人可见'},'workspace');
    const listed=call(conversations,rigg,'session.list',null,'workspace');
    assert.ok(listed.sessions.every(session=>session.draft===undefined),'list omits draft bodies');
    assert.equal(listed.sessions.find(session=>session.id===created.createdId).title,'快照');
    assert.equal(listed.draft,'仅本人可见');
  }finally{conversations.close();rmSync(folder,{recursive:true,force:true});}
});

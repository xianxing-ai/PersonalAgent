import test from 'node:test';import assert from 'node:assert/strict';import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';import path from 'node:path';import {Conversations} from '../electron/conversations.js';import {handleConversationAction} from '../electron/conversation-actions.js';
import {errorDisplay} from '../src/shared/error-display.js';
function file(){const cache=new URL('../../../.cache/conversation-sessions/',import.meta.url);mkdirSync(cache,{recursive:true});return path.join(mkdtempSync(new URL('run-',cache)),'conversations.json');}

test('workspace recents rank content across accessible sessions and normalize dated legacy turns', () => {
  const seed = new Conversations();
  const first = seed.create('workspace', '保留的名称');
  const older = seed.create('workspace', '更早的对话');
  seed.create('workspace', '只有名称');
  const data = {version:4, ...seed.stateSnapshot()};
  data.turns = [
    {taskId:'original', surface:'workspace', goal:'旧版记录', createdAt:'2026-11-24T18:00:00+08:00'},
    {taskId:'first', surface:'workspace', conversationId:first.id, goal:'私密内容', createdAt:'2026-11-24T20:00:00+08:00'},
    {taskId:'older', surface:'workspace', conversationId:older.id, goal:'旧消息', createdAt:'2026-11-20T00:00:00Z'},
    {taskId:'undated', surface:'workspace', goal:'无时间戳'},
  ];
  data.messages = [{id:'spoken', sessionId:'voice', role:'user', text:'语音内容', surface:'panel', createdAt:'2026-11-24T11:00:00Z'}];
  const target = file();
  writeFileSync(target, JSON.stringify(data));
  const shared = new Conversations(target, {sharedMain:true});
  assert.deepEqual(shared.snapshot('workspace').recentSessions, [
    {id:first.id, title:'保留的名称', lastActivityAt:'2026-11-24T12:00:00.000Z'},
    {id:'desktop-panel', title:'主对话', lastActivityAt:'2026-11-24T11:00:00.000Z'},
    {id:'desktop-workspace', title:'原工作区对话', lastActivityAt:'2026-11-24T10:00:00.000Z'},
  ]);
  assert.equal(shared.snapshot('panel').recentSessions, undefined);
  const separate = new Conversations(target);
  assert.deepEqual(separate.snapshot('workspace').recentSessions.map(row => row.id), [first.id,'desktop-workspace',older.id]);
});

test('recent rows follow content, renames, archiving and restoration while drafts stay private', () => {
  const journal = new Conversations(undefined, {sharedMain:true});
  const session = journal.create('workspace', '聊天');
  const recent = () => journal.snapshot('workspace').recentSessions;
  journal.setDraft('workspace', session.id, '未发送的草稿');
  assert.deepEqual(recent(), []);
  const message = {id:'one', sessionId:'voice', role:'user', text:'你好', conversationId:session.id, createdAt:'2025-01-05T04:00:00Z'};
  journal.addLiveMessage(message);
  assert.deepEqual(recent(), [{id:session.id, title:'聊天', lastActivityAt:'2025-01-05T04:00:00.000Z'}]);
  journal.addLiveMessage({...message, text:'修订的文字', createdAt:'2025-02-01T04:00:00Z'});
  journal.rename('workspace', session.id, '修改后的名称');
  assert.deepEqual(recent(), [{id:session.id, title:'修改后的名称', lastActivityAt:'2025-01-05T04:00:00.000Z'}]);
  journal.add('turn', 'workspace', '另一条消息', 'desktop-workspace');
  assert.equal(recent()[0].id, 'desktop-workspace');
  journal.archive('workspace', 'desktop-workspace');
  assert.deepEqual(recent().map(row => row.id), [session.id]);
  journal.archive('workspace', 'desktop-workspace', false);
  assert.equal(recent()[0].id, 'desktop-workspace');
});

test('v3 migration preserves original history, models, live messages and independent new-session state',()=>{const target=file();const old={version:3,turns:[{taskId:'old',surface:'panel',goal:'old goal',createdAt:'2026-01-01T00:00:00Z'}],messages:[{id:'voice',sessionId:'voice-1',role:'user',text:'original voice',createdAt:'2026-01-01T00:00:01Z',surface:'panel'}],preferences:[['desktop-panel',{depth:4,fast:false,modelId:'old-model'}]]};writeFileSync(target,JSON.stringify(old));const journal=new Conversations(target);assert.deepEqual(JSON.parse(readFileSync(target)),old,'read alone never rewrites old data');const session=journal.create('panel','new topic');journal.setDraft('panel',session.id,'new draft');journal.setPreference(session.id,{depth:1,fast:true,modelId:'new-model'});journal.add('new-task','panel','new goal',session.id);const reload=new Conversations(target);assert.equal(reload.activeConversationId('panel'),session.id);assert.equal(reload.session(session.id).draft,'new draft');assert.equal(reload.preference('desktop-panel').modelId,'old-model');assert.equal(reload.preference(session.id).modelId,'new-model');assert.equal(reload.goal('old'),'old goal');assert.equal(reload.messagesFor('panel','desktop-panel').length,1);assert.equal(reload.messagesFor('panel',session.id).length,0);assert.deepEqual(reload.history([{taskId:'old',state:'succeeded',resultSummary:'old answer'}],'new-task'),[]);reload.switch('panel','desktop-panel');assert.equal(reload.preference(reload.activeConversationId('panel')).depth,4);assert.equal(JSON.parse(readFileSync(target)).version,5);const backups=readdirSync(path.dirname(target)).filter(name=>name.endsWith('.bak'));assert.equal(backups.length,1);assert.deepEqual(JSON.parse(readFileSync(path.join(path.dirname(target),backups[0]))),old);reload.close();journal.close();});
test('rename/archive/restore retain records and drafts and reject wrong surface',()=>{const journal=new Conversations(file());const first=journal.create('panel','first');journal.setDraft('panel',first.id,'keep');journal.add('task','panel','goal',first.id);journal.rename('panel',first.id,'renamed');journal.archive('panel',first.id);assert.notEqual(journal.activeConversationId('panel'),first.id);assert.equal(journal.session(first.id).archived,true);assert.equal(journal.goal('task'),'goal');assert.throws(()=>journal.switch('workspace',first.id));assert.throws(()=>journal.switch('panel',first.id));journal.archive('panel',first.id,false);journal.switch('panel',first.id);assert.equal(journal.snapshot('panel').draft,'keep');assert.equal(journal.session(first.id).title,'renamed');});
test('metadata save failure does not change in-memory active session or overwrite legacy file',()=>{const target=file();const journal=new Conversations(target);journal.setDraft('panel','desktop-panel','safe');const before=readFileSync(target,'utf8');journal.save=()=>{throw Error('disk denied');};assert.throws(()=>journal.create('panel'),/disk denied/);assert.equal(journal.activeConversationId('panel'),'desktop-panel');assert.equal(journal.sessions.size,2);assert.equal(readFileSync(target,'utf8'),before);assert.throws(()=>journal.setDraft('panel','desktop-panel','lost'),/disk denied/);assert.equal(journal.snapshot('panel').draft,'safe');});
test('invalid migration metadata fails closed without rewriting user history',()=>{const target=file();const data={version:4,turns:[],messages:[],preferences:[],sessions:[],activeSessions:{panel:'foreign',workspace:'foreign'}};writeFileSync(target,JSON.stringify(data));const before=readFileSync(target,'utf8');assert.throws(()=>new Conversations(target));assert.equal(readFileSync(target,'utf8'),before);});
test('desktop actions never archive live tasks, accept another surface, or route stale edits to a new conversation',()=>{const conversations=new Conversations(file());const args={name:'conversation.new',payload:{},surface:'workspace',conversations,tasks:new Map(),taskSurface:t=>t.surface,submitting:new Set(),publish(){}};const old=conversations.activeConversationId('workspace');handleConversationAction(args);assert.throws(()=>handleConversationAction({...args,name:'conversation.rename',payload:{expectedConversationId:old,conversationId:old,title:'stale'}}));assert.throws(()=>handleConversationAction({...args,name:'conversation.switch',surface:'panel',payload:{conversationId:conversations.activeConversationId('workspace')}}));args.tasks.set('task',{taskId:'task',surface:'workspace',conversationId:old,state:'waiting_reconciliation'});assert.throws(()=>handleConversationAction({...args,name:'conversation.archive',payload:{conversationId:old}}),error=>{const shown=errorDisplay(error,'ipc');assert.equal(shown.code,'EBUSY');assert.match(shown.message,/任务尚未结束，请先停止或核实后归档/);return true;});assert.equal(conversations.session(old).archived,false);args.tasks.set('task',{taskId:'task',surface:'workspace',conversationId:old,state:'waiting_reconciliation',cancelRequested:true});args.tasks.set('host',{taskId:'host',surface:'workspace',conversationId:'host-tool:desktop-user-v1:1',state:'waiting_reconciliation'});handleConversationAction({...args,name:'conversation.archive',payload:{conversationId:old}});assert.equal(conversations.session(old).archived,true);});
test('original-task visibility follows exact active conversation rather than merely its window',()=>{const journal=new Conversations(file());journal.add('old','panel','old','desktop-panel');const fresh=journal.create('panel');journal.add('new','panel','new',fresh.id);const source=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');const fn=source.match(/function visibleConversationTask\(task,surface\)\{[\s\S]*?\r?\n\}/)?.[0];assert.ok(fn);const visible=new Function('connectorChangeHost','conversations','taskSurface','return '+fn)(undefined,journal,t=>t.surface);assert.equal(visible({taskId:'old',surface:'panel'},'panel'),false);assert.equal(visible({taskId:'new',surface:'panel'},'panel'),true);assert.equal(visible({taskId:'new',surface:'panel'},'workspace'),false);assert.equal(visible({taskId:'old',surface:'panel'},undefined),true);});

test('legacy host registration never adopts the active chat or reassigns an existing task owner',()=>{const journal=new Conversations(file()),fresh=journal.create('panel');journal.add('background','panel','legacy host task');assert.equal(journal.conversationIdForTask({taskId:'background'}),'desktop-panel');journal.add('known','panel','known owner',fresh.id);journal.switch('panel','desktop-panel');journal.add('known','panel','repeat host notification');assert.equal(journal.conversationIdForTask({taskId:'known'}),fresh.id);assert.throws(()=>journal.add('known','panel','wrong owner','desktop-panel'),/归属不可更改/);assert.equal(journal.conversationIdForTask({taskId:'known'}),fresh.id);});

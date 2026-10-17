import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Conversations} from '../electron/conversations.js';
import {conversationTimeline} from '../src/features/conversation/timeline.js';

test('Live messages survive restart with legacy tasks, deduplicate and remain panel-only',()=>{
  const cache=fileURLToPath(new URL('../.cache/',import.meta.url));mkdirSync(cache,{recursive:true});
  const folder=mkdtempSync(path.join(cache,'conversation-live-'));
  try {
    const file=path.join(folder,'turns.json');
    writeFileSync(file,JSON.stringify({version:1,turns:[
      {taskId:'old',surface:'panel',goal:'旧文字',createdAt:'2026-01-01T00:00:00Z'},
      {taskId:'next',surface:'panel',goal:'继续',createdAt:'2026-01-01T00:00:03Z'},
      {taskId:'workspace',surface:'workspace',goal:'私有窗口',createdAt:'2026-01-01T00:00:04Z'},
    ]}));
    const journal=new Conversations(file);
    const user={id:'voice-user',sessionId:'s1',role:'user',text:'语音问题 <b>',createdAt:'2026-01-01T00:00:01Z'};
    journal.addLiveMessage(user);journal.addLiveMessage(user);
    assert.equal(journal.addLiveMessage({...user,createdAt:'2026-01-01T00:00:06Z'}).createdAt,'2026-01-01T00:00:01.000Z');
    journal.addLiveMessage({...user,id:'voice-answer',role:'assistant',text:'语音回答',createdAt:'2026-01-01T00:00:02Z'});
    journal.addLiveMessage({...user,id:'future',text:'之后说的话',createdAt:'2026-01-01T00:00:05Z'});
    assert.equal(journal.addLiveMessage({...user,text:'修订后的问题'}).text,'修订后的问题');
    assert.equal(journal.messagesFor('panel').find(m=>m.id===user.id).text,'修订后的问题');
    assert.throws(()=>journal.addLiveMessage({...user,sessionId:'different-session'}),/冲突/);
    assert.throws(()=>journal.addLiveMessage({...user,role:'assistant'}),/冲突/);
    for (const invalid of [{role:'system'},{surface:'workspace'},{text:' '},{createdAt:'bad'},{extra:true},{sessionId:''}]) assert.throws(()=>journal.addLiveMessage({...user,...invalid}),/无效/);
    const reloaded=new Conversations(file);
    assert.equal(reloaded.messagesFor('panel').length,3);
    assert.deepEqual(reloaded.messagesFor(),reloaded.messagesFor('panel'));
    assert.equal(reloaded.messagesFor('panel')[0].createdAt,'2026-01-01T00:00:01.000Z');
    assert.deepEqual(reloaded.messagesFor('workspace'),[]);
    const copy=reloaded.messagesFor('panel');copy[0].text='改写副本';
    assert.equal(reloaded.messagesFor('panel')[0].text,'修订后的问题');
    assert.equal(reloaded.goal('old'),'旧文字');
    const tasks=[{taskId:'old',state:'succeeded',resultSummary:'旧回答'},{taskId:'next',state:'running'},{taskId:'workspace',state:'running'}];
    assert.deepEqual(reloaded.history(tasks,'next'),[{role:'user',content:'旧文字'},{role:'assistant',content:'旧回答'},{role:'user',content:'修订后的问题'},{role:'assistant',content:'语音回答'}]);
    assert.deepEqual(reloaded.history(tasks,'workspace'),[]);
    assert.equal(JSON.parse(readFileSync(file,'utf8')).version,4);
    assert.deepEqual(conversationTimeline([{taskId:'old',createdAt:'2026-01-01T00:00:00Z'},{taskId:'next',createdAt:'2026-01-01T00:00:03Z'}],reloaded.messagesFor('panel')).map(entry=>entry.value.id??entry.value.taskId),['old','voice-user','voice-answer','next','future']);
    // A failed atomic replacement must not add a phantom in-memory record.
    const blocked=path.join(folder,'directory');mkdirSync(blocked);reloaded.file=blocked;
    assert.throws(()=>reloaded.addLiveMessage({...user,id:'failed'}));
    assert.equal(reloaded.messagesFor('panel').length,3);
    assert.equal(new Conversations(file).messagesFor('panel').length,3);
  } finally {rmSync(folder,{recursive:true,force:true});}
});

test('two conversations retain independent metadata and context after restart',()=>{
  const cache=fileURLToPath(new URL('../.cache/',import.meta.url));mkdirSync(cache,{recursive:true});
  const folder=mkdtempSync(path.join(cache,'conversation-test-'));
  try{
    const file=path.join(folder,'turns.json');
    const journal=new Conversations(file);
    journal.add('small-1','panel','我的小窗口信息');
    journal.add('big-1','workspace','我的大窗口信息');
    journal.add('small-2','panel','继续');
    journal.add('big-2','workspace','继续');
    const reloaded=new Conversations(file);
    const tasks=[{taskId:'small-1',state:'succeeded',resultSummary:'小窗口回答 [model=p/a/b; verification=mock; tokens=unknown]'},{taskId:'big-1',state:'succeeded',resultSummary:'大窗口回答'},{taskId:'small-2',state:'running'},{taskId:'big-2',state:'running'}];
    assert.deepEqual(reloaded.history(tasks,'small-2'),[{role:'user',content:'我的小窗口信息'},{role:'assistant',content:'小窗口回答 [model=p/a/b; verification=mock; tokens=unknown]'}]);
    assert.deepEqual(reloaded.history(tasks,'big-2'),[{role:'user',content:'我的大窗口信息'},{role:'assistant',content:'大窗口回答'}]);
    assert.equal(reloaded.goal('small-1'),'我的小窗口信息');
    assert.equal(reloaded.surface('legacy-record'),'panel');
  }finally{rmSync(folder,{recursive:true,force:true});}
});

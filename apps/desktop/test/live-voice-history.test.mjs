import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import {createLiveVoiceHistory} from '../electron/live-voice-history.js';
import {Conversations} from '../electron/conversations.js';

const message = (id, text = id, role = 'user') => ({id, sessionId:'session-a', role, text,
  createdAt:'2026-09-30T10:00:00.000Z'});

test('failed records survive the display limit and are replayed once when storage recovers', () => {
  let failed = true;
  const saved = [];
  const history = createLiveVoiceHistory({recentLimit:2, save:value=>{
    if (failed) throw Error('disk unavailable');
    saved.push(value);
  }});
  for (let i=0;i<5;i++) history.record(message(`u${i}`));
  assert.equal(history.snapshot().pendingCount,5);
  assert.equal(history.snapshot().transcripts.length,2);
  failed=false;
  history.record(message('a1','回答','assistant'));
  assert.deepEqual(saved.map(value=>value.id),['u0','u1','u2','u3','u4','a1']);
  assert.equal(history.snapshot().degraded,false);
  history.flush();
  history.record(message('a1','回答','assistant'));
  assert.equal(saved.length,6);
});

test('transcript corrections replace queued content and keep original chronology', () => {
  let failed=true;
  const saved=[];
  const history=createLiveVoiceHistory({save:value=>{
    if(failed) throw Error('disk unavailable');
    saved.push(value);
  }});
  history.record(message('u1','原转写'));
  history.record({...message('u1','修正转写'),createdAt:'2026-09-30T10:01:00.000Z'});
  failed=false;
  history.flush();
  assert.equal(saved.length,1);
  assert.equal(saved[0].text,'修正转写');
  assert.equal(saved[0].createdAt,message('u1').createdAt);
  assert.throws(()=>history.record({...message('u1'),sessionId:'other'}),/标识冲突/);
});

test('shared context merges persisted and unsaved voice by identity without executing history', () => {
  const voice=message('u1','同一句话');
  const history=createLiveVoiceHistory({save:()=>{throw Error('disk unavailable');},readContext:()=>JSON.stringify({
    tasks:[{goal:'文字问题',state:'succeeded',result:'文字回答',createdAt:'2026-09-30T09:00:00Z'},
      {goal:'未完成任务',state:'running',result:'不可当成完成',createdAt:'2026-09-30T09:01:00Z'}],
    messages:[voice,message('u2','同一句话')],
  })});
  history.record({...voice,text:'已修正话语'});
  assert.deepEqual(history.context().map(value=>value.text),['文字问题','文字回答','未完成任务','已修正话语','同一句话']);
  assert.equal(history.snapshot().pendingCount,1);
});

test('store read failures still retain unsaved history and snapshots cannot mutate it', () => {
  const history=createLiveVoiceHistory({save:()=>{throw Error('disk unavailable');},readContext:()=>{throw Error('read unavailable');}});
  history.record(message('u1'));
  history.snapshot().transcripts[0].text='changed';
  assert.equal(history.context()[0].text,'u1');
  assert.equal(history.snapshot().contextDegraded,true);
});

test('canonical history retains early user constraints and long final conditions beyond the former window',()=>{
 const canonical=[{id:'first',role:'user',content:'不要皮革，预算500元'},
  ...Array.from({length:25},(_,i)=>({id:'u'+i,role:'user',content:'补充'+i})),
  {id:'long',role:'user',content:'x'.repeat(17000)+'结尾条件不能丢失'}];
 const history=createLiveVoiceHistory({save:()=>{},readContext:()=>({contextMessages:canonical,tasks:[{goal:'不要重复任务',state:'succeeded'}]})});
 const context=history.context();assert.equal(context.length,27);
 assert.equal(context[0].text,'不要皮革，预算500元');assert.match(context.at(-1).text,/结尾条件不能丢失$/);
 assert.equal(context.some(m=>m.text==='不要重复任务'),false);
});

test('critical Live context overflow is explicit instead of silently trimming user statements',()=>{
 const history=createLiveVoiceHistory({save:()=>{},readContext:()=>({contextMessages:[{id:'long',role:'user',content:'条件'.repeat(64001)}]})});
 assert.throws(()=>history.context(),/无法完整发送/);
});

test('recovered user and assistant transcripts persist in the same real Conversations file and reload once', () => {
  const cache=path.resolve('apps/desktop/.cache');
  mkdirSync(cache,{recursive:true});
  const directory=mkdtempSync(path.join(cache,'live-history-'));
  try {
    const file=path.join(directory,'conversations.json');
    const conversations=new Conversations(file);
    conversations.add('text-task','panel','已有文字问题');
    let failed=true;
    const history=createLiveVoiceHistory({save:value=>{
      if(failed) throw Error('simulated write failure');
      conversations.addLiveMessage(value);
    }});
    history.record(message('u1','语音问题'));
    history.record(message('a1','语音回答','assistant'));
    failed=false;
    assert.equal(history.flush(),true);
    history.record(message('a1','修正语音回答','assistant'));
    const restored=new Conversations(file);
    assert.equal(restored.goal('text-task'),'已有文字问题');
    assert.deepEqual(restored.messagesFor('panel').map(value=>[value.id,value.role,value.text]),
      [['u1','user','语音问题'],['a1','assistant','修正语音回答']]);
    const restarted=createLiveVoiceHistory({save:value=>restored.addLiveMessage(value),
      readContext:()=>({messages:restored.messagesFor('panel')})});
    assert.deepEqual(restarted.context().map(value=>value.text),['语音问题','修正语音回答']);
  } finally {
    if(path.dirname(directory)!==cache) throw Error('test fixture escaped cache');
    rmSync(directory,{recursive:true,force:true});
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoryPages,compareHistoryKeys,HISTORY_PAGE_SIZE} from '../electron/history-pages.js';
import {TaskProjectionCache,readSafeTaskProjection} from '../electron/task-projection-cache.js';
import {createConversationDelivery} from '../electron/conversation-delivery.js';

function fixture(size=1000) {
  let active='desktop-panel',taskRevision=0;
  const all=Array.from({length:size},(_,index)=>({taskId:`task-${index.toString().padStart(5,'0')}`,conversationId:index%3?'desktop-panel':'desktop-workspace',
    state:'succeeded',revision:1,createdAt:new Date(Date.UTC(2026,0,1)+Math.floor(index/2)*1000).toISOString()}));
  const messages=new Map(all.filter((_,index)=>index%5===0).map((task,index)=>[String(index),{id:String(index),conversationId:task.conversationId,createdAt:task.createdAt,text:'Synthetic live message',role:'assistant'}]));
  let pages;const cache=new TaskProjectionCache({terminalLimit:20,pinned:()=>pages?.pinned()??new Set()});
  const keyed=task=>({createdAt:task.createdAt,key:`task:${task.taskId}`});
  let reads=0;
  pages=createHistoryPages({conversationId:surface=>surface?active:undefined,readMessages:()=>messages,readRevision:()=>`${cache.version}:${taskRevision}`,
    now:()=>new Date(Date.UTC(2027,0,1)).toISOString(),onTasks:items=>items.forEach(task=>cache.set(task.taskId,task)),
    readTasks:({conversationId,before,after,limit,snapshotSequence=all.length})=>{
      reads++;
      const matches=all.slice(0,snapshotSequence).filter(task=>(!conversationId||task.conversationId===conversationId)
        &&(!before||compareHistoryKeys(keyed(task),before)<0)&&(!after||compareHistoryKeys(keyed(task),after)>0)).sort((a,b)=>compareHistoryKeys(keyed(a),keyed(b)));
      return {items:after?matches.slice(0,limit):matches.slice(-limit),snapshotSequence,hasMore:matches.length>limit};
    }});
  return {pages,cache,all,messages,readCount:()=>reads,switchTo:id=>active=id,changed:()=>taskRevision++};
}

test('mixed task/live history pages reach every original record exactly once with bounded residency',()=>{
  const f=fixture(10000),seen=new Set();let page=f.pages.get('panel'),pages=0;
  const watermark=page.snapshotSequence;
  do {
    pages++;assert.ok(page.entries.length<=HISTORY_PAGE_SIZE);assert.equal(page.snapshotSequence,watermark);
    for(const entry of page.entries){assert.equal(seen.has(entry.key),false);seen.add(entry.key);}
    assert.ok(f.cache.size<=20+HISTORY_PAGE_SIZE,'old pages are evictable projections');
    if(!page.hasOlder)break;page=f.pages.load('panel','older');
  } while(pages<1000);
  assert.equal(seen.size,f.all.filter(task=>task.conversationId==='desktop-panel').length+[...f.messages.values()].filter(message=>message.conversationId==='desktop-panel').length);
  assert.equal(f.all.length,10000);assert.ok(pages>100);
  const oldest=page.entries.map(entry=>entry.key),newer=f.pages.load('panel','newer');
  assert.ok(newer.entries.every(entry=>!oldest.includes(entry.key)));
  assert.equal(f.pages.load('panel','latest').viewingLatest,true);
});

test('no-change snapshots reuse the selected page; a session switch never exposes the other conversation',()=>{
  const f=fixture(),first=f.pages.get('panel'),reads=f.readCount();
  for(let i=0;i<30;i++)assert.equal(f.pages.get('panel'),first);
  assert.equal(f.readCount(),reads);
  f.switchTo('desktop-workspace');const next=f.pages.get('panel');
  assert.equal(next.conversationId,'desktop-workspace');
  for(const entry of next.entries)assert.equal(entry.kind==='task'?f.cache.get(entry.id).conversationId:f.messages.get(entry.id).conversationId,'desktop-workspace');
});

test('active, unknown and pinned tasks survive terminal eviction without changing source records',()=>{
  const pinned=new Set(['old']);const cache=new TaskProjectionCache({terminalLimit:10,pinned:()=>pinned});
  cache.set('old',{taskId:'old',revision:1,state:'failed'});
  cache.set('active',{taskId:'active',revision:1,state:'running'});
  cache.set('unknown',{taskId:'unknown',revision:1,state:'waiting_reconciliation'});
  for(let index=0;index<10000;index++)cache.set(`done-${index}`,{taskId:`done-${index}`,revision:2,state:'succeeded'});
  assert.ok(cache.size<=13);for(const key of ['old','active','unknown'])assert.ok(cache.has(key));
  cache.set('unknown',{taskId:'unknown',revision:0,state:'succeeded'});assert.equal(cache.get('unknown').state,'waiting_reconciliation');
  const ordered=cache.ordered(task=>task.taskId);assert.equal(cache.ordered(task=>task.taskId),ordered);
  pinned.clear();cache.prune();assert.ok(cache.size<=12);
});

test('new tasks do not shift an older page; returning to latest reads the new watermark',()=>{
  const f=fixture(100);f.pages.get('panel');const old=f.pages.load('panel','older'),keys=old.entries.map(entry=>entry.key);
  f.all.push({taskId:'new-task',conversationId:'desktop-panel',state:'running',revision:1,createdAt:'2026-12-01T00:00:00.000Z'});f.changed();
  assert.deepEqual(f.pages.get('panel').entries.map(entry=>entry.key),keys);
  let forward=f.pages.load('panel','newer');
  while(forward.hasNewer)forward=f.pages.load('panel','newer');
  assert.equal(forward.viewingLatest,false,'the end of a fixed old snapshot must not disable return-to-latest');
  assert.equal(forward.entries.some(entry=>entry.id==='new-task'),false);
  const latest=f.pages.load('panel','latest');assert.ok(latest.entries.some(entry=>entry.id==='new-task'));assert.equal(latest.snapshotSequence,101);
});

test('active references do not enlarge the terminal budget and equal timestamps keep cursor order',()=>{
  const cache=new TaskProjectionCache({terminalLimit:2,pinned:()=>new Set(['active'])});
  cache.set('active',{taskId:'active',revision:1,state:'running',createdAt:'2026-01-01'});
  for(const taskId of ['z','b','a'])cache.set(taskId,{taskId,revision:1,state:'succeeded',createdAt:'2026-01-01'});
  assert.equal(cache.terminals.size,2);assert.ok(cache.has('active'));assert.equal(cache.has('z'),false);
  assert.deepEqual(cache.ordered(task=>task.createdAt).map(task=>task.taskId),['a','active','b']);
});

test('same-revision erasure refreshes a pinned older page and cannot be undone by a late cached reply',()=>{
  const f=fixture(100);f.pages.get('panel');const page=f.pages.load('panel','older');
  const id=page.entries.find(entry=>entry.kind==='task').id,original={...f.cache.get(id),goal:'private goal',resultSummary:'private answer',steps:[]};
  f.cache.set(id,original);const delivery=createConversationDelivery(new Set());delivery.truncate(original);
  const goals=new Map([[id,original.goal]]),masked={...original,goal:'[private-derived body withheld]'};delete masked.resultSummary;
  const runtime={loadCheckpoint:()=>({state:'withheld'}),getTask:()=>masked};
  const first=readSafeTaskProjection(original,{runtime,delivery,cache:f.cache,goals});
  assert.equal(first.bodyWithheld,true);assert.equal(first.resultSummary,undefined);assert.equal(goals.has(id),false);
  assert.equal(f.cache.get(id).resultSummary,undefined);assert.equal(f.cache.get(id).revision,original.revision);
  assert.equal(delivery.project(masked).resultSummary,undefined,'cutoff body must also be dropped');
  f.cache.set(id,original);
  assert.equal(readSafeTaskProjection(f.cache.get(id),{runtime,delivery,cache:f.cache,goals}).resultSummary,undefined);
  assert.deepEqual(f.pages.get('panel').entries,page.entries,'privacy refresh does not move the selected page');
});

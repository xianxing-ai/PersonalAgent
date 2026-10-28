import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {Conversations} from '../electron/conversations.js';
import {createHistoryPages,compareHistoryKeys} from '../electron/history-pages.js';

const key=message=>({createdAt:message.createdAt,key:'message:'+message.id});
function journal(size=180){
  const template=new Conversations(null),other=template.create('panel','Synthetic other conversation').id;
  const messages=Array.from({length:size},(_,n)=>({id:'message-'+String(n).padStart(5,'0'),sessionId:'synthetic-session',
    role:n%2?'user':'assistant',text:'Public synthetic message '+n,createdAt:new Date(Date.UTC(2026,0,1)+Math.floor(n/3)*1000).toISOString(),
    surface:'panel',conversationId:n%3?'desktop-panel':other}));
  const base=resolve('.cache/large-history-message-page-tests');mkdirSync(base,{recursive:true});
  const folder=mkdtempSync(join(base,'case-')),file=join(folder,'conversations.json');
  writeFileSync(file,JSON.stringify({version:4,sessions:[...template.sessions.values()],activeSessions:template.activeSessions,
    turns:[],messages,preferences:[]}));
  return {value:new Conversations(file),file,folder,other};
}

test('an indexed page never falls back to enumerating the complete Live message map',()=>{
  let indexedReads=0;
  const pages=createHistoryPages({conversationId:()=> 'desktop-panel',readMessages(){assert.fail('A bounded port must not enumerate all messages');},
    readMessagePage:()=>{indexedReads++;return [{id:'voice',createdAt:'2026-01-01T00:00:00.000Z'}];},
    readTasks:()=>({items:[],snapshotSequence:0,hasMore:false}),onTasks(){},now:()=> '2027-01-01T00:00:00.000Z'});
  assert.deepEqual(pages.get('panel').entries.map(entry=>entry.id),['voice']);assert.equal(indexedReads,1);
});

test('a missing or oversized indexed result fails without a full-history fallback',()=>{
  for(const result of [undefined,Array.from({length:42},(_,n)=>({id:String(n),createdAt:'2026-01-01T00:00:00.000Z'}))]){
    const pages=createHistoryPages({conversationId:()=> 'desktop-panel',readMessages(){assert.fail('A broken indexed port must not trigger a full scan');},
      readMessagePage:()=>result,readTasks:()=>({items:[],snapshotSequence:0,hasMore:false}),onTasks(){}});
    assert.throws(()=>pages.get('panel'),/历史消息读页超出约定/);
  }
});

test('message metadata pages preserve original tie keys, boundaries, ownership and persisted content',()=>{
  const f=journal(),j=f.value,original=readFileSync(f.file,'utf8');
  const expected=[...j.messages.values()].filter(message=>message.conversationId==='desktop-panel').sort((a,b)=>compareHistoryKeys(key(a),key(b)));
  const options={conversationId:'desktop-panel',limit:41,messageThrough:'2027-01-01T00:00:00.000Z'};
  const latest=j.readMessageDisplayPage(options);
  assert.deepEqual(latest,expected.slice(-41).map(({id,createdAt})=>({id,createdAt})));
  assert.ok(latest.every(item=>Object.keys(item).sort().join(',')==='createdAt,id'),'the index never returns a message body');
  const boundary={createdAt:expected[50].createdAt,key:'task:same-timestamp-task'};
  assert.deepEqual(j.readMessageDisplayPage({...options,before:boundary}),expected.filter(message=>compareHistoryKeys(key(message),boundary)<0).slice(-41).map(({id,createdAt})=>({id,createdAt})));
  assert.deepEqual(j.readMessageDisplayPage({...options,after:boundary}),expected.filter(message=>compareHistoryKeys(key(message),boundary)>0).slice(0,41).map(({id,createdAt})=>({id,createdAt})));
  const through=expected[51].createdAt;
  assert.deepEqual(j.readMessageDisplayPage({...options,messageThrough:through}),expected.filter(message=>message.createdAt<=through).slice(-41).map(({id,createdAt})=>({id,createdAt})));
  latest[0].id='substituted';assert.notEqual(j.readMessageDisplayPage(options)[0].id,'substituted');
  assert.deepEqual(j.readMessageDisplayPage({...options,conversationId:'unknown-conversation'}),[]);
  assert.equal(j.readMessageDisplayPage({...options,conversationId:undefined}).length,41);
  assert.throws(()=>j.readMessageDisplayPage({...options,limit:1000000}));
  assert.equal(readFileSync(f.file,'utf8'),original,'reading never rewrites persisted history or preferences');
});

test('mixed indexed task and Live pages reach every original key once under the fixed watermark',()=>{
  const f=journal(),j=f.value;let now='2026-06-01T00:00:00.000Z',active='desktop-panel';
  const tasks=Array.from({length:91},(_,n)=>({taskId:'task-'+String(n).padStart(4,'0'),createdAt:new Date(Date.UTC(2026,0,1)+n*1000).toISOString(),conversationId:'desktop-panel'}));
  const taskKey=task=>({createdAt:task.createdAt,key:'task:'+task.taskId});
  const pages=createHistoryPages({conversationId:()=>active,readMessages(){assert.fail('Full Live enumeration must not run');},
    readMessagePage:input=>j.readMessageDisplayPage(input),readRevision:()=>j.messageRevision,onTasks(){},now:()=>now,
    readTasks:({conversationId,before,after,limit,snapshotSequence=91})=>{
      const all=tasks.slice(0,snapshotSequence).filter(task=>task.conversationId===conversationId
        &&(!before||compareHistoryKeys(taskKey(task),before)<0)&&(!after||compareHistoryKeys(taskKey(task),after)>0));
      return {items:after?all.slice(0,limit):all.slice(-limit),snapshotSequence,hasMore:all.length>limit};}});
  const seen=new Set();let page=pages.get('panel');
  j.addLiveMessage({id:'future-live',sessionId:'synthetic-later',role:'assistant',text:'Public late message',createdAt:'2026-06-02T00:00:00.000Z'});
  for(let n=0;n<30;n++){
    assert.ok(page.entries.length<=40);assert.equal(page.messageThrough,'2026-06-01T00:00:00.000Z');
    for(const entry of page.entries){assert.equal(seen.has(entry.key),false);seen.add(entry.key);}
    if(!page.hasOlder)break;page=pages.load('panel','older');
  }
  assert.equal(seen.size,91+[...j.messages.values()].filter(message=>message.conversationId==='desktop-panel'&&message.id!=='future-live').length);
  assert.equal(seen.has('message:future-live'),false);
  const forward=new Set(page.entries.map(entry=>entry.key));
  for(let n=0;n<30&&page.hasNewer;n++){
    page=pages.load('panel','newer');
    for(const entry of page.entries){assert.equal(forward.has(entry.key),false);forward.add(entry.key);}
  }
  assert.deepEqual([...forward].sort(),[...seen].sort());
  assert.equal(page.viewingLatest,false,'the end of a fixed watermark is not the current latest page');
  now='2027-01-01T00:00:00.000Z';assert.ok(pages.load('panel','latest').entries.some(entry=>entry.id==='future-live'));
  active=f.other;assert.ok(pages.get('panel').entries.every(entry=>entry.kind==='message'&&j.messages.get(entry.id).conversationId===f.other));
});

test('successful inserts and body revisions update the index without rescanning, while a failed save adds nothing',()=>{
  const f=journal(),j=f.value,originalValues=j.messages.values.bind(j.messages);let enumerations=0;
  j.messages.values=function(){enumerations++;return originalValues();};
  const options={conversationId:'desktop-panel',limit:41,messageThrough:'2027-01-01T00:00:00.000Z'};
  j.readMessageDisplayPage(options);assert.equal(enumerations,1);
  const message={...j.messages.get('message-00001')};
  j.addLiveMessage({...message,text:'Public changed body',createdAt:'2026-12-01T00:00:00.000Z'});
  j.messages.values=()=>{assert.fail('Body updates must reuse metadata order');};
  assert.ok(j.readMessageDisplayPage({...options,before:{createdAt:'2026-01-01T00:00:01.000Z',key:'task:boundary'}}).some(item=>item.id===message.id));
  j.addLiveMessage({...message,id:'inserted-first',text:'Public earlier message',createdAt:'2025-12-01T00:00:00.000Z'});
  assert.equal(j.readMessageDisplayPage({...options,after:{createdAt:'2025-01-01T00:00:00.000Z',key:'task:boundary'}})[0].id,'inserted-first');
  const before=j.readMessageDisplayPage(options);j.file=f.folder;
  assert.throws(()=>j.addLiveMessage({...message,id:'phantom',createdAt:'2026-12-01T00:00:00.000Z'}));
  assert.deepEqual(j.readMessageDisplayPage(options),before);assert.equal(j.messages.has('phantom'),false);
  const restarted=new Conversations(f.file);assert.equal(restarted.messages.get(message.id).text,'Public changed body');
  assert.equal(restarted.messages.get(message.id).createdAt,message.createdAt);
  assert.equal(restarted.messages.has('inserted-first'),true);assert.equal(restarted.messages.has('phantom'),false);
});

test('a body revision releases the previous authoritative Map and body after indexed paging',()=>{
  const module=new URL('../electron/conversations.js',import.meta.url).href;
  const source=`
    import {Conversations} from ${JSON.stringify(module)};
    const journal=new Conversations(null);
    const input={id:'retired-body',sessionId:'synthetic-session',role:'assistant',text:'Original public body',createdAt:'2026-01-01T00:00:00.000Z'};
    journal.addLiveMessage(input);journal.readMessageDisplayPage();
    const oldMap=new WeakRef(journal.messages),oldBody=new WeakRef(journal.messages.get(input.id));
    journal.addLiveMessage({...input,text:'Updated public body'});journal.readMessageDisplayPage();
    for(let n=0;n<5;n++){await new Promise(setImmediate);globalThis.gc();}
    await new Promise(setImmediate);
    console.log(JSON.stringify({oldMapRetained:oldMap.deref()!==undefined,oldBodyRetained:oldBody.deref()!==undefined,
      body:journal.messages.get(input.id).text,metadata:journal.readMessageDisplayPage()}));
  `;
  const result=spawnSync(process.execPath,['--expose-gc','--input-type=module','-e',source],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
  const readback=JSON.parse(result.stdout.trim());
  assert.equal(readback.oldMapRetained,false);assert.equal(readback.oldBodyRetained,false);
  assert.equal(readback.body,'Updated public body');
  assert.deepEqual(readback.metadata,[{id:'retired-body',createdAt:'2026-01-01T00:00:00.000Z'}]);
});

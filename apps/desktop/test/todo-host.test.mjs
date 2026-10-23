import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication,createReminderDeliveryHost} from '@personal-agent/runtime/application';
import {createDesktopTodoHost} from '../electron/todo-host.js';
import {mountTodoControls} from '../src/app/todo-controls.js';

test('todo controls retain open completion and show terminal items without reopening actions',async()=>{
  const previous=globalThis.document,fields=new Map(),calls=[];
  const node=()=>({children:[],append(...values){this.children.push(...values);},replaceChildren(){this.children=[];},
    querySelector(selector){if(!fields.has(selector))fields.set(selector,node());return fields.get(selector);}});
  globalThis.document={createElement:()=>node()};
  try{
    const state={available:true,items:[{id:'active',title:'Active',status:'open'},
      {id:'finished',title:'Finished',status:'done'},{id:'cancelled',title:'Cancelled',status:'cancelled'}]};
    const controls=mountTodoControls(node(),async(name,input)=>{calls.push({name,input});return state;});
    controls.render(state);
    const rows=fields.get('[data-todo="items"]').children;
    for(const row of rows.slice(1)){
      assert.equal(row.children.length,1);assert.equal(row.children.some(child=>typeof child?.onclick==='function'),false);
    }
    assert.match(rows[1].children[0].textContent,/已完成/);assert.match(rows[2].children[0].textContent,/已取消/);
    await rows[0].children[2].onclick();
    assert.deepEqual(calls,[{name:'todo.update',input:{id:'active',status:'done'}}]);
  }finally{globalThis.document=previous;}
});

const cache=new URL('../../../.cache/todo-host-tests/',import.meta.url);mkdirSync(cache,{recursive:true});
const encryption={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),
  decryptString:value=>Buffer.from(value).reverse().toString()};
async function until(predicate){for(let n=0;n<100;n++){if(await predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('State did not arrive');}
async function fixture(t,options={}){
  const userData=mkdtempSync(new URL('run-',cache));let now=Date.parse('2026-09-27T10:00:00.000Z'),host,app,client;
  function open(){
    host=createDesktopTodoHost({userData,safeStorage:encryption,namespace:'test-user',now:()=>now,createDeliveryHost:createReminderDeliveryHost,...options});
    app=createRuntimeApplication({path:path.join(userData,'runtime.sqlite'),now:()=>new Date(now),
      profile:'huawei_ict_agentarts',hostUserNamespace:'test-user',tools:host.tools});
    host.bindApplication(app);client=new Client(app,()=>now);
  }
  open();await client.connect();
  async function close(){await host.close();await until(()=>app.activeTaskCount===0);app.close();}
  t.after(close);
  return {get host(){return host;},get app(){return app;},userData,advance:ms=>{now+=ms;},
    async restart(){await close();open();await client.connect();},
    async tool(name,args){
      host.authorize({readAndCloudConsent:true});
      const commandId=crypto.randomUUID(),tool=host.tools.find(t=>t.descriptor.name===name);
      const task=app.prepareHostToolTask({commandId,toolName:name,toolVersion:tool.descriptor.version,deadline:new Date(now+30_000).toISOString()});
      assert.equal(host.competitionToolAvailability.find(t=>t.toolName===name).available({taskId:task.taskId,signal:new AbortController().signal}),true);
      app.finalizeHostToolTask({commandId,taskId:task.taskId,expectedTaskRevision:task.revision,arguments:args});
      await until(()=>app.readHostToolTask(task.taskId).approval?.state==='pending');
      const approval=app.readHostToolTask(task.taskId).approval;
      await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
      await until(()=>app.runtime.getTask(task.taskId).state==='succeeded');
      const page=app.readHostToolTask(task.taskId);
      assert.equal(app.runtime.readToolExecutions(task.taskId)[0].state,'confirmed');
      return {taskId:task.taskId,page};
    }};
}

test('unchanged reminder polls do not broadcast; item changes and due delivery still do',async t=>{
  let broadcasts=0;const f=await fixture(t,{onUpdate:()=>{broadcasts++;}});
  await f.host.tick(true);const baseline=broadcasts;
  for(let n=0;n<5;n++){f.advance(1000);await f.host.tick(true);}
  assert.equal(broadcasts,baseline);
  await f.host.create({title:'Synthetic reminder',remindUtc:'2026-09-27T10:01:00.000Z'});
  assert.equal(broadcasts,baseline+1);
  await f.host.tick(true);assert.equal(broadcasts,baseline+1);
  f.advance(60_000);await f.host.tick(true);
  assert.equal(f.host.snapshot().notifications.length,1);assert.equal(broadcasts,baseline+2);
});

test('real Runtime/Policy todo changes cancel old schedules, deliver locally and survive restart without duplicates',async t=>{
  const f=await fixture(t);
  await f.tool('todo.create',{title:'Original',remindUtc:'2026-09-27T10:01:00.000Z'});
  const id=f.host.snapshot().items[0].id;
  await f.tool('todo.update',{id,title:'Rescheduled',remindUtc:'2026-09-27T10:02:00.000Z'});
  f.advance(65_000);await f.host.tick(true);assert.equal(f.host.snapshot().notifications.length,0);
  f.advance(60_000);await f.host.tick(true);
  const notice=f.host.snapshot().notifications[0];assert.equal(notice.summary,'提醒待办：Rescheduled');
  assert.equal(f.app.runtime.getTask(notice.taskId).state,'succeeded');
  const toolScope=f.host.competitionToolExports.find(t=>t.toolName==='todo.list');
  f.host.revoke();assert.equal(toolScope.accepts({taskId:'unbound'}),false);
  await f.restart();await f.host.tick(true);
  assert.equal(f.host.snapshot().sessionAllowed,false);
  assert.deepEqual(f.host.snapshot().notifications.map(n=>n.notificationId),[notice.notificationId]);
  f.host.dismiss({id:notice.notificationId});await f.restart();await f.host.tick(true);
  assert.equal(f.host.snapshot().notifications.length,0);
  assert.doesNotMatch(readFileSync(path.join(f.userData,'productivity-state.json'),'utf8'),/Rescheduled/);
});

test('cancelled reminders do not fire; missed skip stays skipped; other scheduler owners are untouched',async t=>{
  const f=await fixture(t);
  await f.tool('todo.create',{title:'Cancel',remindUtc:'2026-09-27T10:01:00.000Z'});
  const id=f.host.snapshot().items[0].id;await f.tool('todo.update',{id,status:'cancelled'});
  await f.tool('todo.create',{title:'Skip while closed',remindUtc:'2026-09-27T10:01:00.000Z',missedPolicy:'skip'});
  f.app.runtime.createSchedule({scheduleId:'another-owner',goal:'Untouched',conversationId:'other',runAt:'2026-09-27T10:01:00.000Z',timeZone:'UTC',missedRunPolicy:'run_once',taskIdempotencyKey:'other'});
  f.advance(120_000);await f.restart();await f.host.tick(true);
  assert.equal(f.host.snapshot().notifications.length,0);
  assert.equal(f.host.snapshot().items.find(i=>i.title==='Skip while closed').reminder.state,'missed');
  assert.equal(f.app.runtime.getSchedule('another-owner').status,'pending');
});

test('notification pause persists and queues until expiry without losing due reminders',async t=>{
  const f=await fixture(t);
  f.host.configureNotifications({pauseUntilUtc:'2026-09-27T10:03:00.000Z'});
  assert.equal(f.host.snapshot().notificationStatus.pausedUntil,'2026-09-27T10:03:00.000Z');
  const status=await f.tool('notifications.status',{});
  assert.equal(status.page.confirmed.result.pausedUntil,'2026-09-27T10:03:00.000Z');
  await f.tool('todo.create',{title:'Held',remindUtc:'2026-09-27T10:01:00.000Z'});
  f.advance(65_000);await f.host.tick(true);assert.equal(f.host.snapshot().notifications.length,0);
  assert.equal(f.host.snapshot().notificationStatus.pending,1);
  await f.restart();f.advance(120_000);await f.host.tick(true);
  assert.equal(f.host.snapshot().notifications.length,1);
  assert.equal(f.host.snapshot().notificationStatus.pausedUntil,null);
});

test('direct product entry todo.create and todo.update persist to storage and read back in snapshot', async t => {
  const f = await fixture(t);
  const created = await f.host.create({ title: 'Synthetic Task from UI', remindUtc: '2026-09-27T10:05:00.000Z' });
  assert.equal(created.items.length, 1);
  assert.equal(created.items[0].title, 'Synthetic Task from UI');
  assert.equal(created.items[0].status, 'open');

  const id = created.items[0].id;
  const updated = await f.host.update({ id, status: 'done' });
  assert.equal(updated.items.find(i => i.id === id).status, 'done');

  // Verify persistence across restart
  await f.restart();
  const loaded = f.host.snapshot();
  const target = loaded.items.find(i => i.id === id);
  assert.ok(target, 'target item should persist across restart');
  assert.equal(target.title, 'Synthetic Task from UI');
  assert.equal(target.status, 'done');
});


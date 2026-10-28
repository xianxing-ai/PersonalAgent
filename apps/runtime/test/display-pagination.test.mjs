import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {openStorage} from '@personal-agent/storage';
import {TaskRuntime,RUNTIME_MIGRATIONS} from '../dist/index.js';
import {createRuntimeApplication} from '../dist/application.js';

test('host display pages bound parsed tasks and preserve forward/backward history at a fixed snapshot', t=>{
  let id=0;const runtime=new TaskRuntime(':memory:',{idFactory:()=>`display-${String(++id).padStart(6,'0')}`,now:()=>new Date('2026-01-01T00:00:00Z')});
  t.after(()=>runtime.close());
  for(let index=0;index<215;index++)runtime.submitTask({goal:'Synthetic history',conversationId:index%2?'other':'panel',idempotencyKey:`display-${index}`});
  const first=runtime.readTaskDisplayPage({conversationId:'panel',limit:7}),seen=new Set();let page=first;
  const snapshotSequence=first.snapshotSequence;
  runtime.submitTask({goal:'After watermark',conversationId:'panel',idempotencyKey:'later'});
  do {
    assert.ok(page.items.length<=7);
    for(const task of page.items){assert.equal(task.conversationId,'panel');assert.equal(seen.has(task.taskId),false);seen.add(task.taskId);}
    if(!page.hasMore)break;
    const oldest=page.items.at(-1);
    page=runtime.readTaskDisplayPage({conversationId:'panel',limit:7,snapshotSequence,before:{createdAt:oldest.createdAt,key:`task:${oldest.taskId}`}});
  } while(true);
  assert.equal(seen.size,108);
  const oldest=page.items[0];
  const newer=runtime.readTaskDisplayPage({conversationId:'panel',limit:7,snapshotSequence,after:{createdAt:oldest.createdAt,key:`task:${oldest.taskId}`}});
  assert.ok(newer.items.length>0);assert.ok(newer.items.every(task=>task.taskId>oldest.taskId));
  assert.equal(runtime.listTasks({limit:100}).snapshotSequence,snapshotSequence+1);
  for(const input of [{limit:0},{limit:101},{snapshotSequence:-1},{snapshotSequence:snapshotSequence+999},
    {before:{createdAt:'bad',key:'task:bad'}},{before:{createdAt:'2026-01-01',key:'x'},after:{createdAt:'2026-01-01',key:'x'}}])
    assert.throws(()=>runtime.readTaskDisplayPage(input));
});

test('checkpoint candidates page before hydration while application still rejects forged bindings',()=>{
  const application=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts'}),runtime=application.runtime;
  try {
    const ids=[];
    for(let i=0;i<120;i++) {
      const task=runtime.submitTask({goal:'Synthetic ordinary history',conversationId:'panel',idempotencyKey:`candidate-${i}`});
      if(i%10===0){ids.push(task.taskId);runtime.saveCheckpoint(task.taskId,'subtask-parent',{parentTaskId:'forged',subtaskId:'forged',role:'worker'});}
    }
    const first=runtime.listTaskCheckpointPage({limit:5},['subtask-parent']),seen=new Set(first.items.map(task=>task.taskId));
    let page=first;
    while(page.nextBeforeSequence!==undefined){page=runtime.listTaskCheckpointPage({limit:5,snapshotSequence:first.snapshotSequence,beforeSequence:page.nextBeforeSequence},['subtask-parent']);for(const item of page.items)seen.add(item.taskId);}
    assert.deepEqual([...seen].sort(),ids.sort());
    assert.deepEqual(application.listSubagentConversations(),{items:[]},'an indexed marker is never an authorization proof');
    for(const keys of [[],[''],Array(9).fill('key'),[null]])assert.throws(()=>runtime.listTaskCheckpointPage({},keys));
  } finally {application.close();}
});

test('index migration preserves version 10 records and rolls back an interrupted index set',()=>{
  const root=fileURLToPath(new URL('../../../.cache/runtime-tests/',import.meta.url));mkdirSync(root,{recursive:true});
  const file=path.join(mkdtempSync(path.join(root,'performance-migration-')),'runtime.sqlite');
  const old=RUNTIME_MIGRATIONS.slice(0,10),db=openStorage(file,old);
  const now='2026-01-01T00:00:00.000Z';
  db.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('preserved','original goal','panel','[]','succeeded',2,now,'[]','[]','original answer',null,0);
  db.prepare('INSERT INTO task_events(event_id,stream_id,task_id,type,occurred_at,payload_json) VALUES (?,?,?,?,?,?)').run('created','tasks','preserved','task.created',now,'{}');
  db.close();
  assert.throws(()=>openStorage(file,[...old,{version:11,sql:'CREATE INDEX partial_failure ON tasks(state); SELECT * FROM missing_fixture_table;'}]));
  const afterFailure=new DatabaseSync(file);
  assert.equal(afterFailure.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name='partial_failure'").get().count,0);
  assert.equal(afterFailure.prepare('SELECT count(*) AS count FROM schema_migrations').get().count,10);afterFailure.close();
  const runtime=new TaskRuntime(file);
  assert.equal(runtime.getTask('preserved').resultSummary,'original answer');
  assert.equal(runtime.readTaskDisplayPage().items[0].goal,'original goal');runtime.close();
  assert.throws(()=>openStorage(file,old),/newer than/,'old binaries need the pre-upgrade backup, not a fabricated down migration');
});

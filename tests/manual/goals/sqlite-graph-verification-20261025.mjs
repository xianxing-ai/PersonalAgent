import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bindCoordinationStore} from '../../../apps/runtime/src/coordination-store.ts';
import {eraseDependentGraphHistory} from '../../../apps/runtime/src/fact-erasure.ts';
import {createGoalTools} from '@personal-agent/goals/tool';
import {currentNodes, parseGraph} from '@personal-agent/goals';
const temporary = mkdtempSync(join(tmpdir(), 'pa-mod27-synthetic-'));
const db = new DatabaseSync(join(temporary, 'graph.sqlite'));
// Synthetic adapter table only: this does not verify Runtime migrations.
try {
  db.exec('CREATE TABLE coordination_graphs(namespace TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL)');
  const store = bindCoordinationStore(db, 'synthetic-person', true);
  const [create, revise] = createGoalTools(store);
  const context = {scopes: ['goals:write']};
  const input = {id:'goal', summary:'Synthetic plan', sourceRef:'fixture/mod27',
    validFrom:'2026-10-25T00:00:00.000Z',validUntil:'2026-10-26T00:00:00.000Z',
    sensitivity:'public',state:'active',reason:'synthetic verification',dependencies:[]};
  assert.equal((await create.execute({expectedGraphRevision:0, goal:input},context)).kind,'applied');
  store.appendBatch(1,[{...input,id:'decision',kind:'decision',dependencies:[{id:'goal',revision:1}]},
    {...input,id:'plan',kind:'plan',dependencies:[{id:'decision',revision:1}]}]);
  assert.equal((await revise.execute({expectedGraphRevision:3,expectedGoalRevision:1,
    goal:{...input,summary:'Corrected',sourceRef:'fixture/correction'}},context)).kind,'applied');
  assert.deepEqual(store.read().history[1].dependencies,[{id:'goal',revision:1}]);
  assert.equal((await revise.execute({expectedGraphRevision:3,expectedGoalRevision:1,goal:input},context)).kind,'conflict');
  const before=store.read();
  assert.throws(()=>store.appendBatch(4,[{...input,id:'independent',kind:'fact'},
    {...input,id:'bad',kind:'plan',dependencies:[{id:'missing',revision:1}]}]),{code:'INVALID_ARGUMENT'});
  assert.deepEqual(store.read(),before);
  await revise.execute({expectedGraphRevision:4,expectedGoalRevision:2,
    goal:{...input,state:'withdrawn',reason:'retracted'}},context);
  assert.equal(currentNodes(store.read()).find(n=>n.id==='goal').state,'withdrawn');
  assert.equal(store.read(1).history[0].state,'active');
  const erased=eraseDependentGraphHistory(store.read(),'goal');
  assert.equal(erased.history.length,0);
  assert.deepEqual(erased.erasedGraphRevisions,[1,2,3,4,5]);
  db.prepare('UPDATE coordination_graphs SET snapshot_json=? WHERE namespace=?').run(JSON.stringify(erased),'synthetic-person');
  assert.deepEqual(store.read(3),{namespace:'synthetic-person',revision:3,history:[],erasedGraphRevisions:[1,2,3]});
  const next=store.append(5,{...input,id:'survivor',kind:'fact'});
  assert.equal(next.history[0].graphRevision,6);
  assert.throws(()=>store.append(6,{...input,id:'dangling',kind:'plan',dependencies:[{id:'goal',revision:1}]}),{code:'INVALID_ARGUMENT'});
  assert.deepEqual(parseGraph(JSON.parse(db.prepare('SELECT snapshot_json FROM coordination_graphs').get().snapshot_json)),store.read());
  console.log('PASS: production SQLite adapter + goal tools; pinned dependencies, conflict, batch rollback, withdrawal/history, trusted erasure, high-water mark, dangling rejection and SQL readback.');
} finally {db.close(); rmSync(temporary, {recursive:true, force:true});}

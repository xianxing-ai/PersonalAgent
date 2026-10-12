import assert from 'node:assert/strict';
import {copyFile, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import test from 'node:test';
import {openSqliteMemoryHost} from '@personal-agent/memory/sqlite';
import {openSqliteLearningHost} from '@personal-agent/learning';
import {TaskRuntime} from '@personal-agent/runtime';
import {createWorkflowLearningApplication, LEARNING_BINDING_CHECKPOINT} from '@personal-agent/runtime/application';
import {createReferenceSummarySkill} from '@personal-agent/skills';
import {createPrivateMemoryController} from '../electron/private-memory.js';
import {createMemoryLearningHost} from '../electron/memory-learning-host.js';
import {memoryLearningControlsHtml, mountMemoryLearningControls} from '../src/features/admin/memory-learning-controls.js';

const context = () => ({deadline: new Date(Date.now() + 60_000).toISOString(), signal: new AbortController().signal});

test('unchanged learning host snapshots preserve the native form and its draft',()=>{
  const draft={value:'reference-a.md'};
  let replacements=0,html='';
  const root={get innerHTML(){return html;},set innerHTML(value){
    replacements++;html=value;draft.value='';
  },addEventListener(){}};
  const status={learningAvailable:true};
  const controls=mountMemoryLearningControls(root,{status,refs:[],invoke:async()=>{}});
  draft.value='reference-a.md';
  for(let i=0;i<3;i++)controls.update({status:{...status},refs:[]});
  assert.equal(replacements,1);
  assert.equal(draft.value,'reference-a.md');
  controls.update({status:{learningAvailable:false},refs:[]});
  assert.equal(replacements,2);
  controls.dispose();
});

test('changed learning host snapshots preserve form drafts and input focus',()=>{
  const document={activeElement:null};
  let html='',inputs=new Map();
  const root={ownerDocument:document,addEventListener(){},contains:element=>[...inputs.values()].includes(element),
    querySelector:selector=>inputs.get(selector.match(/name="([^"]+)"/)?.[1]),
    get innerHTML(){return html;},set innerHTML(value){
      html=value;inputs=new Map();document.activeElement=null;
      for(const [,attributes] of value.matchAll(/<input\b([^>]*)>/g)) {
        const name=/\bname="([^"]+)"/.exec(attributes)?.[1];
        if(!name) continue;
        const input={name,value:/\bvalue="([^"]*)"/.exec(attributes)?.[1]??'',
          focus(){document.activeElement=this;},setSelectionRange(start,end,direction){
            this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;
          }};
        inputs.set(name,input);
      }
    }};
  const controls=mountMemoryLearningControls(root,{status:{learningAvailable:true},refs:[],invoke:async()=>{}});
  inputs.get('ml-path').value='reference-a.md';
  inputs.get('ml-summary').value='Draft summary';
  inputs.get('ml-summary').selectionStart=5;
  inputs.get('ml-summary').selectionEnd=12;
  inputs.get('ml-summary').selectionDirection='forward';
  inputs.get('ml-summary').focus();

  controls.update({status:{learningAvailable:true,writeEnabled:true},refs:[]});

  assert.equal(inputs.get('ml-path').value,'reference-a.md');
  assert.equal(inputs.get('ml-summary').value,'Draft summary');
  assert.equal(document.activeElement,inputs.get('ml-summary'));
  assert.deepEqual([document.activeElement.selectionStart,document.activeElement.selectionEnd,
    document.activeElement.selectionDirection],[5,12,'forward']);
  controls.dispose();
});
async function fixture(t, options = {}) {
  const parent = fileURLToPath(new URL('../../../.cache/memory-learning-tests/', import.meta.url));
  await mkdir(parent, {recursive: true});
  const base = await mkdtemp(join(parent, 'case-'));
  const root = join(base, 'vault');
  const database = join(base, 'private.sqlite');
  await mkdir(root);
  await writeFile(join(root, 'note.md'), 'Synthetic preference: read the plan first.\n');
  const controller = createPrivateMemoryController(database, options.confirm ?? (async () => true),
    async () => true, {confirmWithdraw: async () => true, authorizeConsumption: options.authorize ?? (async () => false)});
  t.after(async () => {controller.close(); await rm(base, {recursive: true, force: true});});
  await controller.selectVault(root);
  const source = (await controller.search('Synthetic preference')).hits[0].source;
  return {base, root, database, controller, source};
}

test('production bridge enables only authoritative no-copy/unbound deletion readiness; exact baselines are enforced', async t => {
  const f = await fixture(t);
  const disabled = createMemoryLearningHost({profile: 'huawei_ict_agentarts', privateMemory: f.controller});
  assert.equal(disabled.snapshot().writeEnabled, false);
  await assert.rejects(disabled.invoke('memory.save', {source: f.source, summary: 'Read plan'}), /副本/);
  const host = createMemoryLearningHost({profile: 'huawei_ict_agentarts', privateMemory: f.controller, managedPrivateCopies: []});
  assert.equal(host.snapshot().writeEnabled, true);
  const payload = {source: f.source, summary: 'Read plan', baseline: {expectedRevision: null, configurationRevision: 1}};
  assert.equal((await host.invoke('memory.save', payload)).revision, 1);
  await assert.rejects(host.invoke('memory.save', {...payload, summary: 'Stale overwrite'}), /版本已变化/);
  assert.equal((await host.invoke('memory.save', {...payload, summary: 'Corrected plan',
    baseline: {expectedRevision: 1, configurationRevision: 1}})).revision, 2);
  const memory = openSqliteMemoryHost(f.database);
  memory.bindFeed('desktop-private', {consumerId: 'synthetic-illegal-binding', allowedSensitivities: ['private']});
  memory.close();
  assert.equal(host.snapshot().writeEnabled, false);
});

test('withdrawal survives restart, never exposes old preference, and cloud requires exact per-task consent', async t => {
  let allow = false;
  let onConsent;
  const f = await fixture(t, {authorize: async request => {await onConsent?.(request); return allow;}});
  await f.controller.save(f.source, 'Read plan');
  const ref = (await f.controller.listSaved()).facts[0].ref;
  const request = {refs: [ref], taskId: 'synthetic-task', destination: 'agentarts', ...context()};
  assert.deepEqual(await f.controller.consumeConfirmed(request), {state: 'declined', facts: []});
  allow = true;
  const consumed = await f.controller.consumeConfirmed(request);
  assert.deepEqual(consumed.facts, [{ref, summary: 'Read plan'}]);
  assert.equal(JSON.stringify(consumed).includes(f.source.path), false);
  onConsent = async () => {await f.controller.withdraw(ref);};
  await assert.rejects(f.controller.consumeConfirmed(request), /版本已变化/);
  assert.deepEqual((await f.controller.listSaved()).facts.map(fact => fact.state), ['withdrawn']);
  const withdrawn = {id: ref.id, revision: 2};
  await assert.rejects(f.controller.consumeConfirmed({...request, refs: [withdrawn]}), /撤回/);
  f.controller.close();
  const restarted = createPrivateMemoryController(f.database, async () => false, async () => true);
  try {
    assert.deepEqual((await restarted.listSaved()).facts.map(fact => fact.ref), [withdrawn]);
    assert.equal((await restarted.delete(withdrawn)).state, 'deleted');
  } finally {restarted.close();}
});

test('source reconfiguration during confirmation refuses the formerly selected citation', async t => {
  let onConfirm;
  const f = await fixture(t, {confirm: async () => {await onConfirm(); return true;}});
  onConfirm = async () => {await f.controller.selectVault(f.root);};
  await assert.rejects(f.controller.save(f.source, 'Should not be saved'), /配置已变化/);
  assert.equal((await f.controller.listSaved()).facts.length, 0);
});

test('application restore filter removes old deleted revisions and preserves an independent fact', async t => {
  const f = await fixture(t);
  await f.controller.save(f.source, 'Synthetic secret v1');
  await writeFile(join(f.root, 'other.md'), 'Synthetic independent note.\n');
  const other = (await f.controller.search('Synthetic independent')).hits[0].source;
  await f.controller.save(other, 'Keep independent');
  const backup = join(f.base, 'synthetic-application-copy.sqlite');
  f.controller.close();
  await copyFile(f.database, backup);
  const controller = createPrivateMemoryController(f.database, async () => true, async () => true);
  try {
    await controller.selectVault(f.root);
    await controller.save(f.source, 'Synthetic secret v2');
    const ref = (await controller.listSaved()).facts.find(fact => fact.summary === 'Synthetic secret v2').ref;
    await controller.delete(ref);
    const restored = openSqliteMemoryHost(backup);
    try {
      assert.equal(controller.filterRestoredHost(restored).state, 'filtered');
      assert.equal(restored.readUserFactHead('desktop-private', ref.id), undefined);
      assert.equal(restored.listFactErasures('desktop-private', {limit: 100, ...context()})[0].expectedRevision, 2);
      const facts = await restored.bind('desktop-private', {allowedSensitivities: ['private']})
        .listCurrent({at: new Date().toISOString(), limit: 10, ...context()});
      assert.deepEqual(facts.facts.map(fact => fact.summary), ['Keep independent']);
    } finally {restored.close();}
    const reopened = openSqliteMemoryHost(backup);
    try {assert.equal(reopened.readUserFactHead('desktop-private', ref.id), undefined);}
    finally {reopened.close();}
  } finally {controller.close();}
});

test('independent control projection escapes text and has no private values or raw Evidence', () => {
  const html = memoryLearningControlsHtml({status: {writeEnabled: true, learningAvailable: true},
    refs: [{id: 'opaque-id', revision: 2}], version: {workflowId: '<script>', revision: 1,
      validation: 'failed', hasEvidence: false, sourceRef: 'must-not-display'}, message: '<img onerror=alert(1)>'});
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('data-ml-action="activate" disabled'));
  assert.equal(html.includes('must-not-display'), false);
  assert.equal(html.includes('opaque-id'), false);
});

test('memory controls refresh exact references after confirmed changes but preserve cancelled actions', async () => {
  for (const action of ['withdraw', 'delete']) for (const state of ['declined', action === 'withdraw' ? 'withdrawn' : 'deleted',
    ...(action === 'delete' ? ['pending'] : [])]) {
    let click;
    let refreshes = 0;
    const calls = [];
    const root = {innerHTML: '', contains: () => true, querySelector: () => ({value: ''}),
      addEventListener: (name, handler) => {click = handler;}};
    const controls = mountMemoryLearningControls(root, {status: {}, refs: [{id: 'exact-fact', revision: 2}],
      invoke: async (name, payload) => {calls.push([name, payload]); return {state, revision: 3, phase: 'private_copy_erasure'};},
      onMemoryChanged: async () => {refreshes += 1; controls.update({refs: []});}});
    const button = {dataset: {[action === 'withdraw' ? 'mlWithdraw' : 'mlDelete']: '0'}, disabled: false};
    await click({target: {closest: () => button}});
    assert.deepEqual(calls, [[`memory.${action}`, {ref: {id: 'exact-fact', revision: 2}}]]);
    assert.equal(refreshes, state === 'declined' ? 0 : 1);
    assert.equal(root.innerHTML.includes('data-ml-use="0"'), state === 'declined');
    controls.dispose();
  }
});

test('learning controls retain a real Runtime task until cancellation finishes without cancelling independent work',
  {timeout: 10_000}, async t => {
  let release;
  const cleanup = new Promise(resolve => {release = resolve;});
  let running, learning, runtime, skill;
  t.after(async () => {release(); await running; skill?.dispose(); learning?.close(); runtime?.close();});
  const f = await fixture(t);
  learning = openSqliteLearningHost(join(f.base, 'learning.sqlite'));
  runtime = new TaskRuntime(join(f.base, 'runtime.sqlite'));
  skill = createReferenceSummarySkill(); // Manifest only; no tool or model invocation.
  const submitted = [];
  const app = createWorkflowLearningApplication({profile: 'huawei_ict_agentarts', namespace: 'desktop-learning',
    learning, runtime, skillManifest: () => skill.manifest(),
    submitSkillTask: binding => {
      const task = runtime.submitTaskWithCheckpoint({goal: 'Synthetic cancellation acceptance',
        conversationId: 'learning:desktop-learning', idempotencyKey: binding.operationId},
      LEARNING_BINDING_CHECKPOINT, binding);
      submitted.push(task.taskId);
      return task.taskId;
    }, confirmActivation: async () => false, confirmDeletion: async () => false});
  const host = createMemoryLearningHost({profile: 'huawei_ict_agentarts', privateMemory: f.controller,
    learningApplication: app});
  let click;
  const fields = {workflow: 'reference-review', revision: '1', path: 'note.md', summary: 'Synthetic workflow'};
  const root = {innerHTML: '', contains: () => true,
    querySelector: selector => ({value: fields[selector.match(/ml-(\w+)/)[1]]}),
    addEventListener: (_name, handler) => {click = handler;}};
  const controls = mountMemoryLearningControls(root, {status: host.snapshot(),
    invoke: (name, payload) => host.invoke(name, payload)});
  t.after(() => controls.dispose());
  const action = name => click({target: {closest: () => ({dataset: {mlAction: name}, disabled: false})}});
  await action('propose');
  await action('startValidation');
  const taskId = submitted[0];
  const independent = await host.invoke('learning.startValidation', {workflowId: 'reference-review', revision: 1});
  let started;
  const entered = new Promise(resolve => {started = resolve;});
  // Explicit synthetic worker delays completion; Runtime and its durable state are real.
  running = runtime.runTask(taskId, async () => {started(); await cleanup; return {resultSummary: 'Synthetic cleanup'};},
    {deadline: context().deadline, sideEffect: 'read'});
  await entered;
  await action('stop');
  assert.equal(runtime.getTask(taskId).state, 'cancelling');
  assert.equal(runtime.getTask(taskId).cancelRequested, true);
  assert.match(root.innerHTML, /尚未确认停止/);
  assert.match(root.innerHTML, /任务仍为正在取消/);
  assert.ok(root.innerHTML.includes(`可停止任务：${taskId}`));
  fields.workflow = 'unrelated-draft'; fields.revision = '99';
  await action('stop');
  assert.match(root.innerHTML, /尚未确认停止/);
  release();
  assert.equal((await running).state, 'cancelled');
  await action('stop');
  assert.match(root.innerHTML, /任务当前为已取消/);
  assert.doesNotMatch(root.innerHTML, /可停止任务：/);
  assert.match(root.innerHTML, /data-ml-action="stop" disabled/);
  assert.equal(runtime.getTask(independent.taskId).state, 'created');
  assert.equal(runtime.getTask(independent.taskId).cancelRequested, undefined);
  assert.equal(app.readVersion('reference-review', 1).validation, 'candidate');
  assert.equal(app.readActive('reference-review'), null);
  assert.equal((await f.controller.listSaved()).facts.length, 0);
});

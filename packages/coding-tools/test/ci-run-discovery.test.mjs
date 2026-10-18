import test from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {setImmediate} from 'node:timers/promises';
import {createCiRunDiscoveryWorkflow} from '../dist/dev-workflows/ci-run-discovery.js';

const run = {id: 42, name: 'Foundation', status: 'completed', conclusion: 'failure', headSha: 'a'.repeat(40),
  url: 'https://github.com/owner/repo/actions/runs/42', createdAt: '2026-10-05T00:00:00Z'};
function fixture() {
  const checkpoints = new Map(), calls = [];
  const context = {taskId: 'ci-discovery', deadline: '2099-01-01T00:00:00Z', signal: new AbortController().signal,
    saveCheckpoint(k, v) {checkpoints.set(k, structuredClone(v));}, loadCheckpoint(k) {return structuredClone(checkpoints.get(k));},
    reportProgress() {throw Error('unused');}};
  const response = {state: 'confirmed', result: {items: [structuredClone(run)], page: 1, nextPage: 2, hasMore: true}, evidenceRefs: ['read-evidence']};
  const tools = {list: () => [{name: 'github.actions.run.list', version: '0.1.0-alpha.1', sideEffect: 'read'}],
    async invoke(input) {calls.push(input); return structuredClone(response);}};
  const options = {tools, maxSteps: 1, authorizationRefFor: () => 'runtime-authorized'};
  return {context, checkpoints, calls, response, tools, options, request: {repo: 'owner/repo'}};
}
test('discovery lists one bounded failed-run page without model, workspace or Git', async () => {
  const f = fixture(), workflow = createCiRunDiscoveryWorkflow(f.options);
  const result = await workflow.listFailedRuns(f.context, f.request);
  assert.deepEqual(result, {state: 'listed', items: [run], page: 1, nextPage: 2, hasMore: true, evidenceRefs: ['read-evidence']});
  assert.deepEqual(f.calls[0].arguments, {repo: 'owner/repo', page: 1, perPage: 30, status: 'failure'});
  assert.equal(f.calls.length, 1); assert.equal(f.context.loadCheckpoint('ci-run-discovery-v1').steps, 1);
  result.items[0].name = 'mutated';
  assert.equal((await workflow.listFailedRuns(f.context, f.request)).items[0].name, 'Foundation');
  assert.equal(f.calls.length, 1);
});
test('explicit next page and branch remain host-selected and do not poll or submit repairs', async () => {
  const f = fixture(); f.request = {repo: 'owner/repo', page: 2, perPage: 1, branch: 'repair/failed-build'};
  f.response.result = {items: [], page: 2, nextPage: null, hasMore: false};
  const result = await createCiRunDiscoveryWorkflow(f.options).listFailedRuns(f.context, f.request);
  assert.equal(result.state, 'listed'); assert.equal(result.page, 2); assert.equal(result.hasMore, false);
  assert.deepEqual(f.calls[0].arguments, {...f.request, status: 'failure'}); assert.equal(f.calls.length, 1);
});
test('unapproved reads and repeated pending approvals retain the original one-read reservation', async () => {
  const f = fixture(); let authorized = false;
  f.options.authorizationRefFor = () => authorized ? 'runtime-authorized' : undefined;
  const workflow = createCiRunDiscoveryWorkflow(f.options);
  assert.equal((await workflow.listFailedRuns(f.context, f.request)).state, 'waiting_approval'); assert.equal(f.calls.length, 0);
  authorized = true; f.response.state = 'pending'; delete f.response.result;
  for (let i = 0; i < 3; i++) assert.equal((await workflow.listFailedRuns(f.context, f.request)).state, 'waiting_approval');
  assert.equal(new Set(f.calls.map(c => c.runId)).size, 1);
  assert.equal(f.context.loadCheckpoint('ci-run-discovery-v1').steps, 1);
  f.response.state = 'confirmed'; f.response.result = {items: [run], page: 1, nextPage: null, hasMore: false};
  const restarted = createCiRunDiscoveryWorkflow(f.options);
  assert.equal((await restarted.listFailedRuns({...f.context}, f.request)).state, 'listed');
  assert.equal(new Set(f.calls.map(c => JSON.stringify(c.arguments))).size, 1);
});
test('unknown reads never redispatch before the original confirmed Runtime cache is ready', async () => {
  const f = fixture(); f.response.state = 'unknown'; delete f.response.result;
  const workflow = createCiRunDiscoveryWorkflow(f.options);
  assert.equal((await workflow.listFailedRuns(f.context, f.request)).state, 'waiting_reconciliation');
  const original = f.calls[0];
  for (let i = 0; i < 2; i++) assert.equal((await workflow.listFailedRuns(f.context, f.request)).state, 'waiting_reconciliation');
  assert.equal(f.calls.length, 1);
  f.options.confirmedReplayReady = (id, context) => id === original.runId && context.taskId === f.context.taskId;
  f.tools.invoke = async input => {f.calls.push(input); assert.equal(input.runId, original.runId); assert.deepEqual(input.arguments, original.arguments);
    return {state: 'confirmed', result: {items: [run], page: 1, nextPage: null, hasMore: false}, evidenceRefs: ['cached-original']};};
  assert.equal((await workflow.listFailedRuns(f.context, f.request)).state, 'listed');
  assert.equal(f.calls.length, 2);
});
test('a missing replay authorization cannot downgrade an unknown read to an ordinary pending read', async () => {
  const f = fixture(); f.response.state = 'unknown'; delete f.response.result;
  const workflow = createCiRunDiscoveryWorkflow(f.options);
  await workflow.listFailedRuns(f.context, f.request);
  f.options.confirmedReplayReady = () => true; f.options.authorizationRefFor = () => undefined;
  assert.equal((await workflow.listFailedRuns(f.context, f.request)).state, 'waiting_approval');
  f.options.confirmedReplayReady = () => false; f.options.authorizationRefFor = () => 'runtime-authorized';
  assert.equal((await workflow.listFailedRuns(f.context, f.request)).state, 'waiting_reconciliation');
  assert.equal(f.calls.length, 1); assert.equal(f.context.loadCheckpoint('ci-run-discovery-v1').phase, 'unknown');
});
test('a changed page or step budget cannot replace a persisted original read', async () => {
  const f = fixture(), workflow = createCiRunDiscoveryWorkflow(f.options);
  await workflow.listFailedRuns(f.context, f.request);
  await assert.rejects(workflow.listFailedRuns(f.context, {...f.request, page: 2}), e => e.code === 'INVALID_ARGUMENT');
  await assert.rejects(createCiRunDiscoveryWorkflow({...f.options, maxSteps: 2}).listFailedRuns(f.context, f.request), e => e.code === 'INVALID_ARGUMENT');
  assert.equal(f.calls.length, 1);
});
test('illegal requests cannot dispatch a read', async t => {
  for (const patch of [{repo: '../repo'}, {page: 0}, {page: 10001}, {perPage: 31}, {branch: ['main']}, {status: 'success'}, {shell: 'command'}]) {
    await t.test(JSON.stringify(patch), async () => {
      const f = fixture(); await assert.rejects(createCiRunDiscoveryWorkflow(f.options).listFailedRuns(f.context, {...f.request, ...patch}), e => e.code === 'INVALID_ARGUMENT');
      assert.equal(f.calls.length, 0); assert.equal(f.checkpoints.size, 0);
    });
  }
});
test('invalid run identities, nonfailure results and broken page cursors never become candidates', async t => {
  const mutations = [page => {page.page = 2;}, page => {page.nextPage = 1;}, page => {page.hasMore = false;},
    page => {page.items[0].status = 'in_progress';}, page => {page.items[0].conclusion = 'success';},
    page => {page.items[0].id = '42';}, page => {page.items[0].headSha = 'not-sha';},
    page => {page.items[0].url = 'https://github.com/other/repo/actions/runs/42';},
    page => {page.items[0].url = 'https://user:secret@github.com/owner/repo/actions/runs/42';},
    page => {page.items[0].createdAt = 'not-a-date';}, page => {page.items.push({...page.items[0]});}];
  for (const [i, mutate] of mutations.entries()) await t.test(String(i), async () => {
    const f = fixture(); mutate(f.response.result);
    await assert.rejects(createCiRunDiscoveryWorkflow(f.options).listFailedRuns(f.context, f.request), e => e.code === 'INVALID_ARGUMENT');
    assert.notEqual(f.context.loadCheckpoint('ci-run-discovery-v1').phase, 'listed');
  });
});
test('missing or writable discovery tools fail closed without invocation', async () => {
  for (const list of [[], [{name: 'github.actions.run.list', version: '1', sideEffect: 'external_write'}]]) {
    const f = fixture(); f.tools.list = () => list;
    await assert.rejects(createCiRunDiscoveryWorkflow(f.options).listFailedRuns(f.context, f.request), e => e.code === 'UNSUPPORTED_CAPABILITY');
    assert.equal(f.calls.length, 0);
  }
});
async function mustSettle(promise) {
  let timer;
  try {return await Promise.race([promise, new Promise((_, reject) => {timer = setTimeout(() => reject(Error('discovery did not settle')), 100);})]);}
  finally {clearTimeout(timer);}
}
test('expired and cancelled contexts cannot return cached pages or invoke tools', async () => {
  for (const cached of [false, true]) {
    const f = fixture(), workflow = createCiRunDiscoveryWorkflow(f.options);
    if (cached) await workflow.listFailedRuns(f.context, f.request);
    const count = f.calls.length, controller = new AbortController(); controller.abort();
    await assert.rejects(workflow.listFailedRuns({...f.context, signal: controller.signal}, f.request), e => e.code === 'CANCELLED');
    await assert.rejects(workflow.listFailedRuns({...f.context, deadline: '2000-01-01T00:00:00Z'}, f.request), e => e.code === 'TIMEOUT');
    assert.equal(f.calls.length, count);
  }
});
test('a cancelled ignoring read cannot settle a late page or reset its original reservation', async () => {
  const f = fixture(), controller = new AbortController(), started = Promise.withResolvers(), response = Promise.withResolvers();
  f.context.signal = controller.signal;
  f.tools.invoke = async input => {f.calls.push(input); started.resolve(input); return response.promise;};
  const workflow = createCiRunDiscoveryWorkflow(f.options), pending = workflow.listFailedRuns(f.context, f.request);
  const input = await started.promise; controller.abort();
  await assert.rejects(mustSettle(pending), e => e.code === 'CANCELLED');
  assert.equal(input.signal.aborted, true); assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  const checkpoint = f.context.loadCheckpoint('ci-run-discovery-v1');
  response.resolve(f.response); await setImmediate(); assert.deepEqual(f.context.loadCheckpoint('ci-run-discovery-v1'), checkpoint);
  f.context.signal = new AbortController().signal;
  assert.equal((await workflow.listFailedRuns(f.context, f.request)).state, 'waiting_reconciliation'); assert.equal(f.calls.length, 1);
});
test('deadline bounds an ignoring read and synchronous late settlement cannot be cached', async t => {
  t.mock.timers.enable({apis: ['Date', 'setTimeout'], now: Date.parse('2026-10-05T00:00:00Z')});
  const f = fixture(), started = Promise.withResolvers(); f.context.deadline = new Date(Date.now() + 5000).toISOString();
  f.tools.invoke = async input => {f.calls.push(input); started.resolve(); return new Promise(() => {});};
  const pending = createCiRunDiscoveryWorkflow(f.options).listFailedRuns(f.context, f.request);
  const rejected = assert.rejects(pending, e => e.code === 'TIMEOUT');
  await started.promise; t.mock.timers.tick(5000); await rejected;
  assert.equal(f.context.loadCheckpoint('ci-run-discovery-v1').phase, 'inflight');
  const late = fixture(); let clock = 0; late.options.now = () => clock; late.context.deadline = new Date(5000).toISOString();
  late.tools.invoke = async input => {late.calls.push(input); clock = 5000; return late.response;};
  await assert.rejects(createCiRunDiscoveryWorkflow(late.options).listFailedRuns(late.context, late.request), e => e.code === 'TIMEOUT');
  assert.notEqual(late.context.loadCheckpoint('ci-run-discovery-v1').phase, 'listed');
});

test('started discovery binds the factory port while new factories accept new configuration',async()=>{
  const f=fixture(),workflow=createCiRunDiscoveryWorkflow(f.options);let otherCalls=0;
  const running=workflow.listFailedRuns(f.context,f.request);
  f.options.tools={list:f.tools.list,invoke:async()=>{otherCalls++;return {state:'confirmed',
    result:{items:[{...run,name:'Second provider'}],page:1,nextPage:null,hasMore:false},evidenceRefs:['second-port']};}};
  const result=await running;
  assert.equal(otherCalls,0);assert.equal(f.calls.length,1);assert.equal(result.items[0].name,'Foundation');
  const fresh=createCiRunDiscoveryWorkflow(f.options),checkpoints=new Map();
  const context={...f.context,taskId:'next-factory',loadCheckpoint:key=>checkpoints.get(key),saveCheckpoint:(key,value)=>checkpoints.set(key,structuredClone(value))};
  assert.equal((await fresh.listFailedRuns(context,f.request)).items[0].name,'Second provider');assert.equal(otherCalls,1);
});
test('bound discovery port retains live method replacement and capability withdrawal',async()=>{
  const f=fixture(),workflow=createCiRunDiscoveryWorkflow(f.options);let replacements=0;
  f.tools.invoke=async()=>{replacements++;return structuredClone(f.response);};
  assert.equal((await workflow.listFailedRuns(f.context,f.request)).state,'listed');assert.equal(replacements,1);
  f.tools.list=()=>[];
  await assert.rejects(workflow.listFailedRuns(f.context,f.request),error=>error.code==='UNSUPPORTED_CAPABILITY');
  assert.equal(replacements,1);
});
test('unknown discovery retains original port through live exact replay readiness',async()=>{
  const f=fixture();f.response.state='unknown';delete f.response.result;
  const workflow=createCiRunDiscoveryWorkflow(f.options);
  assert.equal((await workflow.listFailedRuns(f.context,f.request)).state,'waiting_reconciliation');
  const original=f.calls[0];let otherCalls=0;
  f.options.tools={list:f.tools.list,invoke:async()=>{otherCalls++;throw Error('next port');}};
  f.options.confirmedReplayReady=()=>false;
  assert.equal((await workflow.listFailedRuns(f.context,f.request)).state,'waiting_reconciliation');
  f.options.confirmedReplayReady=id=>id===original.runId;
  f.tools.invoke=async input=>{f.calls.push(input);assert.equal(input.runId,original.runId);assert.deepEqual(input.arguments,original.arguments);
    return {state:'confirmed',result:{items:[run],page:1,nextPage:null,hasMore:false},evidenceRefs:['original-cache']};};
  const result=await workflow.listFailedRuns(f.context,f.request);
  assert.equal(result.state,'listed');assert.ok(result.evidenceRefs.includes('original-cache'));assert.equal(otherCalls,0);
  assert.equal(f.context.loadCheckpoint('ci-run-discovery-v1').steps,1);
});

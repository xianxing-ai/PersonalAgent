import assert from 'node:assert/strict';
import test from 'node:test';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {ToolGateway, toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createTrustedKnowledgeTools} from '../dist/application/knowledge-tools.js';

function fixture(projectionPort) {
  let reads = 0, writes = 0, reconciliations = 0;
  let binding = {sourceId: 'synthetic', namespace: 'admin', configRevision: 1, available: true,
    writeAvailable: true, dataLevel: 'private', cloudExportAllowed: false, publicQueries: ['公开查询'], allowedNotePaths: ['demo.md']};
  const checkpoints = new Map();
  const source = {snapshot: () => ({...binding}), acquire(expected, signal) {
    if (expected.sourceId !== binding.sourceId || expected.configRevision !== binding.configRevision || !binding.available) throw Error('revoked');
    const initial = binding.configRevision;
    return {binding: {...binding}, signal, release() {}, assertCurrent() {if (initial !== binding.configRevision) throw Error('revoked');},
      reconcileWrite: async original => {reconciliations++; return {state: 'not_applied', operationId: 'c'.repeat(64),
        backupId: 'local-only', currentSha256: 'a'.repeat(64), lockRetained: false, original};},
      read: {search: async () => {reads++; return {hits: [{source: {vaultId: binding.sourceId, path: 'demo.md', line: 1,
        revision: 'a'.repeat(64)}, excerpt: '合成资料'}], truncated: false};}},
      write: {apply: async input => {writes++; return {sourceId: input.sourceId, configRevision: input.configRevision,
        path: input.path, beforeSha256: input.expectedSha256, afterSha256: 'b'.repeat(64), operationId: 'c'.repeat(64),
        backupId: 'local-only', state: 'verified', changed: true};}}};
  }};
  const factory = createTrustedKnowledgeTools(source,projectionPort);
  factory.bindApplication({runtime: {loadCheckpoint: (task, key) => checkpoints.get(task + key),
    saveCheckpoint: (task, key, value) => checkpoints.set(task + key, value)}});
  const policy = new InMemoryAuthorizationPolicy(), gateway = new ToolGateway({policy});
  factory.register(gateway);
  const read = factory.tools[0], write = factory.tools[1];
  const input = {query: '公开查询', limit: 1, sourceId: 'synthetic', configRevision: 1};
  function invocation(tool, args, taskId = 'task', grant = true) {
    const deadline = new Date(Date.now() + 30000).toISOString(), authorizationRef = 'grant-' + taskId;
    if (grant) policy.grant({authorizationRef, taskId, toolName: tool.descriptor.name,
      scopes: tool.descriptor.requiredScopes, expiresAt: deadline, maxUses: 1, argumentsDigest: toolArgumentsDigest(args)});
    return {toolName: tool.descriptor.name, toolVersion: tool.descriptor.version, arguments: args,
      taskId, runId: 'run-' + taskId, authorizationRef, deadline, signal: new AbortController().signal};
  }
  return {factory, gateway, policy, read, write, input, invocation, checkpoints, counts: () => ({reads, writes, reconciliations}),
    change: patch => {binding = {...binding, ...patch};}, binding: () => binding};
}

test('private local search needs Policy and exports no cloud content, including shortened excerpts', async () => {
  const f = fixture();
  await assert.rejects(f.gateway.invoke(f.invocation(f.read, f.input, 'no-grant', false)), error => error.code === 'UNAUTHORIZED');
  assert.equal(f.counts().reads, 0);
  const result = await f.gateway.invoke(f.invocation(f.read, f.input)); assert.equal(f.counts().reads, 1);
  const exported = f.factory.competitionToolExports[0];
  assert.equal(exported.accepts({taskId: 'task', proposalId: 'p', arguments: f.input}), false);
  assert.throws(() => exported.project({taskId: 'task', proposalId: 'p', result,
    signal: new AbortController().signal}), error => error.code === 'SCOPE_DENIED');
  assert.equal(await f.factory.competitionToolAvailability[0].available({taskId: 'task', signal: new AbortController().signal}), false);
});

test('host-only unknown-result readback neither executes a tool nor grants scopes or changes task state', async () => {
  const f = fixture();
  const original = {sourceId: 'synthetic', configRevision: 1, taskId: 'original-task', runId: 'original-run',
    argumentsDigest: 'd'.repeat(64)};
  const context = {signal: new AbortController().signal, deadline: new Date(Date.now() + 30000).toISOString()};
  const result = await f.factory.reconcileWrite(original, context);
  assert.equal(result.state, 'not_applied');
  assert.deepEqual(result.original, {taskId: original.taskId, runId: original.runId, argumentsDigest: original.argumentsDigest});
  assert.deepEqual(f.counts(), {reads: 0, writes: 0, reconciliations: 1});
  await assert.rejects(f.factory.reconcileWrite({...original, execute: true}, context));
  f.change({configRevision: 2});
  await assert.rejects(f.factory.reconcileWrite(original, context));
});

test('public exact query/source revision projects bounded data; switch rejects old approvals and export', async () => {
  const f = fixture(); f.change({dataLevel: 'public', cloudExportAllowed: true});
  assert.equal(await f.factory.competitionToolAvailability[0].available({taskId: 'task', signal: new AbortController().signal}), true);
  assert.deepEqual(f.read.descriptor.inputSchema.properties.sourceId.enum, ['synthetic']);
  const exported = f.factory.competitionToolExports[0];
  assert.equal(exported.accepts({taskId: 'task', proposalId: 'p', arguments: {...f.input, query: '私人查询'}}), false);
  const invocation = f.invocation(f.read, f.input);
  const result = await f.gateway.invoke(invocation);
  assert.equal(exported.project({taskId: 'task', proposalId: 'p', result, signal: invocation.signal}).hits[0].excerpt, '合成资料');
  f.factory.bindTask('task-old-approval');
  f.change({configRevision: 2});
  assert.throws(() => exported.project({taskId: 'task', proposalId: 'p', result, signal: invocation.signal}));
  await assert.rejects(f.gateway.invoke(f.invocation(f.read, {...f.input, configRevision: 2}, 'task-old-approval')));
});

test('write stays behind one-use Policy with the exact operation digest and redacts backup/Evidence identity', async () => {
  const f = fixture(); f.change({dataLevel: 'public', cloudExportAllowed: true});
  const args = {sourceId: 'synthetic', configRevision: 1, path: 'demo.md', expectedSha256: 'a'.repeat(64),
    edits: [{oldText: 'old', newText: 'new'}]};
  const unauthorized = f.invocation(f.write, args);
  await assert.rejects(f.gateway.invoke({...unauthorized, arguments: {...args, edits: [{oldText: 'old', newText: 'swapped'}]}}), error => error.code === 'SCOPE_DENIED');
  assert.equal(f.counts().writes, 0);
  const result = await f.gateway.invoke(unauthorized); assert.equal(f.counts().writes, 1);
  await assert.rejects(f.gateway.invoke(unauthorized), error => error.code === 'UNAUTHORIZED');
  const exported = f.factory.competitionToolExports[1];
  assert.deepEqual(exported.project({taskId: 'task', proposalId: 'p', result, signal: unauthorized.signal}), {state: 'verified', changed: true});
  assert.equal(exported.accepts({taskId: 'task', proposalId: 'p', arguments: {...args, path: 'unselected.md'}}), false);
});

test('actual tool composition pins original write SHA and stores the host Fact readback without exporting it',async()=>{
  let request;
  const f=fixture({revalidate:async input=>{
    request=input;return {version:1,sourceId:input.sourceId,configRevision:input.configRevision,path:input.path,
      sourceRevision:input.expectedSha256,memoryNamespace:'synthetic-memory',coverage:'observed_active_heads',facts:[{
        previous:{id:'synthetic-fact',revision:1},current:{id:'synthetic-fact',revision:2},sourceDigest:'d'.repeat(64),
        sourceRevision:'a'.repeat(64),state:'withdrawn',appended:true}]};
  }});
  f.change({dataLevel:'public',cloudExportAllowed:true});
  const args={sourceId:'synthetic',configRevision:1,path:'demo.md',expectedSha256:'a'.repeat(64),edits:[{oldText:'old',newText:'new'}]};
  const invocation=f.invocation(f.write,args),result=await f.gateway.invoke(invocation);
  assert.deepEqual(request,{sourceId:'synthetic',configRevision:1,path:'demo.md',expectedSha256:result.afterSha256});
  const saved=f.checkpoints.get('taskknowledge-write-projections-v1')[0];
  assert.equal(saved.runId,invocation.runId);assert.equal(saved.argumentsDigest,toolArgumentsDigest(args));
  assert.equal(saved.operationId,result.operationId);assert.equal(saved.factReadback.facts[0].current.revision,2);
  assert.deepEqual(f.factory.competitionToolExports[1].project({taskId:'task',proposalId:'p',result,signal:invocation.signal}),
    {state:'verified',changed:true});
  await f.factory.recoverProjection('task',{deadline:invocation.deadline,signal:invocation.signal});
  assert.equal(f.counts().writes,1);
});

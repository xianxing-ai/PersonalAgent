import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {FakeModelProvider} from '@personal-agent/models';
import {GhCliProvider, FakeGitHubProvider, githubRepairCheckName} from '@personal-agent/github';
import {createDevWorkflowsRuntime} from '@personal-agent/runtime/dev-workflows';
import {ProtocolError} from '@personal-agent/contracts';
import {createWorkspaceReadTool, createWorkspacePatchPreviewTool} from '@personal-agent/coding-tools';

const issue = {number: 7, title: 'Improve docs', body: 'Please improve docs', state: 'open', labels: [],
  url: 'https://github.com/example/project/issues/7', updatedAt: '2026-10-01T00:00:00.000Z'};
function readTool(count) {
  return {descriptor: {name: 'github.issue.get', version: '0.1.0-alpha.1',
    inputSchema: {type: 'object', properties: {repo: {type: 'string'}, number: {type: 'integer'}},
      required: ['repo', 'number'], additionalProperties: false},
    outputSchema: {type: 'object'}, requiredScopes: ['github:read'], sideEffect: 'read',
    requiresPresence: false, idempotencySupport: true, recoverySupport: true}, async execute() { count.calls++; return structuredClone(issue); }};
}
function model() {
  return new FakeModelProvider([{kind: 'final', text: JSON.stringify({kind: 'docs', confidence: 0.95,
    evidence: [{field: 'title', quote: 'Improve docs'}]})}], {
    provider: 'fake', deployment: 'dev-workflows-test', model: 'fake', verification: 'mock',
    capabilities: {text: true, streaming: false, toolCalling: false, structuredOutput: false, vision: false},
  });
}
async function fixture(run, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dev-workflows-'));
  const count = {calls: 0};
  const host = createDevWorkflowsRuntime({path: path.join(directory, 'runtime.sqlite'), model: model(),
    tools: [readTool(count)], maxSteps: 16, maxTokens: 1024, ...options});
  try { await run(host, count); }
  finally { await host.close(); await rm(directory, {recursive: true, force: true}); }
}
const submission = () => ({request: {kind: 'issue_triage', input: {repo: 'example/project', number: 7}},
  conversationId: 'dev-tests', idempotencyKey: 'same-work', deadline: new Date(Date.now() + 60_000).toISOString()});

test('default issue repair bridge retains trusted goal and PR body through SQLite approval restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dev-issue-default-'));
  const source = 'const value = 1;\n', digest = (await import('node:crypto')).createHash('sha256').update(source).digest('hex');
  const original = {...issue, title: 'Crash on save', body: 'Saving crashes the app.'};
  const head = 'a'.repeat(40), fixed = 'b'.repeat(40), prompts = [], writes = [];
  const provider = new FakeModelProvider([{kind: 'final', text: JSON.stringify({kind: 'bug', confidence: .95,
    evidence: [{field: 'title', quote: 'Crash on save'}]})}, {kind: 'final', text: JSON.stringify({diagnosis: 'Repair crash',
    patches: [{path: 'app.js', expectedSha256: digest, edits: [{oldText: 'value = 1', newText: 'value = 2'}]}]})}]);
  const complete = provider.complete.bind(provider); provider.complete = async input => {prompts.push(input); return complete(input);};
  const values = {'github.issue.get': original, 'workspace.git.head': {headSha: head, workspaceClean: true, clean: true},
    'workspace.read_text': {path: 'app.js', content: source, sha256: digest},
    'workspace.apply_text_patch': {path: 'app.js', beforeSha256: digest, afterSha256: 'c'.repeat(64), applied: true, changed: true},
    'workspace.run_allowed_command': {recipeId: 'check', exitCode: 0}, 'workspace.git.commit': {headSha: fixed, parentSha: head},
    'workspace.git.push': {headSha: fixed, pushed: true},
    'github.pr.create': {state: 'confirmed', externalId: '9', url: 'https://github.com/example/project/pull/9'},
    'github.pr.comment': {state: 'confirmed'}, 'github.issue.comment': {state: 'confirmed'}};
  const writeNames = new Set(['workspace.apply_text_patch', 'workspace.run_allowed_command', 'workspace.git.commit',
    'workspace.git.push', 'github.pr.create', 'github.pr.comment', 'github.issue.comment']);
  const tools = Object.entries(values).map(([name, value]) => ({descriptor: {name, version: '1.0.0',
    inputSchema: {type: 'object'}, outputSchema: {type: 'object'}, requiredScopes: ['synthetic:fixture'],
    sideEffect: writeNames.has(name) ? 'local_write' : 'read', requiresPresence: false,
    idempotencySupport: true, recoverySupport: true}, async execute(input) {
      if (writeNames.has(name)) writes.push({name, input: structuredClone(input)}); return structuredClone(value);
    }}));
  const open = () => createDevWorkflowsRuntime({path: path.join(directory, 'runtime.sqlite'), model: provider, tools,
    maxSteps: 32, maxTokens: 64_000, ciFix: {expectedHeadSha: head, sourcePaths: ['app.js'], verifyRecipeId: 'check',
      headBranch: 'repair', baseBranch: 'main', gitTools: {head: 'workspace.git.head', commit: 'workspace.git.commit',
        push: 'workspace.git.push', pullRequest: 'github.pr.create', backlink: 'github.pr.comment'}}});
  let host = open();
  try {
    const goal = 'Preserve data and fix the save crash';
    const task = host.submit({request: {kind: 'issue_triage', input: {repo: 'example/project', number: 7, repairBug: true,
      repairGoal: goal}}, conversationId: 'default-repair', idempotencyKey: 'one-repair', deadline: new Date(Date.now()+60_000).toISOString()});
    let state = await host.start(task.taskId), restarted = false;
    for (let i=0; i<32 && state.state === 'waiting_approval'; i++) {
      let approval = host.runtime.listApprovals({taskId: task.taskId, state: 'pending'}).items[0]; assert.ok(approval);
      if (approval.action === 'github.pr.create' && !restarted) {
        const id = approval.approvalId; await host.close(); host = open(); restarted = true;
        approval = host.runtime.listApprovals({taskId: task.taskId, state: 'pending'}).items[0]; assert.equal(approval.approvalId,id);
      }
      host.runtime.respondApproval(approval.approvalId,'allow_once',approval.revision); state = await host.resume(task.taskId);
    }
    assert.equal(restarted,true); assert.equal(state.state,'succeeded'); assert.equal(host.readResult(task.taskId).state,'repair_requested');
    assert.equal(prompts.length,2); assert.equal(JSON.parse(prompts[1].messages[1].content).repairGoal,goal);
    const prs = writes.filter(item=>item.name==='github.pr.create'); assert.equal(prs.length,1);
    assert.match(prs[0].input.body,/Related issue: https:\/\/github.com\/example\/project\/issues\/7/);
    assert.match(prs[0].input.body,/Automatic close and merge are disabled\./);
    assert.match(prs[0].input.body,/Issue fingerprint: [a-f0-9]{64}/); assert.ok(prs[0].input.body.length<=65536);
    assert.equal(writes.filter(item=>item.name==='workspace.git.commit').length,1);
    assert.equal(writes.filter(item=>item.name==='github.issue.comment').length,1);
  } finally {await host.close(); await rm(directory,{recursive:true,force:true});}
});

test('repair association tools require explicit opt-in and retain the original provider lifecycle', async () => {
  for (const enabled of [false, true]) {
    let disposed = 0;
    const github = {verification: 'mock', async execute() {throw Error('unused');}, dispose() {disposed++;}};
    const host = createDevWorkflowsRuntime({path: ':memory:', model: model(), github, githubRepairLinks: enabled,
      maxSteps: 1, maxTokens: 1024});
    const names = host.tools.list().map(tool => tool.name);
    assert.equal(names.length, enabled ? 15 : 13);
    assert.equal(names.includes('github.actions.repair.link'), enabled);
    assert.equal(names.includes('github.actions.repair.get'), enabled);
    await host.close(); assert.equal(disposed, 1);
  }
  for (const githubRepairLinks of [true, 'true', 1]) {
    assert.throws(() => createDevWorkflowsRuntime({path: ':memory:', model: model(), githubRepairLinks,
      maxSteps: 1, maxTokens: 1024}), /explicit GitHub provider and boolean opt-in/i);
  }
});

test('an explicit original-check readback retains approval across SQLite restart without confirming or repeating writes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dev-repair-readback-'));
  const identity = {repo: 'example/project', runId: 42, expectedRunAttempt: 3, sourceSha: 'a'.repeat(40),
    repairPrNumber: 9, repairHeadSha: 'b'.repeat(40), workflowExecutionId: 'c'.repeat(64)};
  const receipt = {...identity, checkRunId: 11, externalId: '11', url: 'https://github.com/example/project/runs/11',
    name: githubRepairCheckName(identity), detailsUrl: 'https://github.com/example/project/pull/9',
    status: 'completed', conclusion: 'neutral', evidenceRefs: []};
  let host, calls = 0, disposed = 0;
  const open = () => {
    const github = new FakeGitHubProvider({'actions.repair.get': input => {
      calls++; assert.deepEqual(input, {...identity, checkRunId: 11}); return structuredClone(receipt);
    }});
    github.dispose = () => {disposed++;};
    return createDevWorkflowsRuntime({path: path.join(directory, 'runtime.sqlite'), model: model(), github,
      githubRepairLinks: true, maxSteps: 1, maxTokens: 1024});
  };
  try {
    host = open();
    const input = {request: {kind: 'ci_link_readback', input: {...identity, checkRunId: 11}},
      conversationId: 'repair-readback', idempotencyKey: 'original-check-11', deadline: new Date(Date.now() + 60_000).toISOString()};
    const task = host.submit(input);
    assert.equal((await host.start(task.taskId)).state, 'waiting_approval'); assert.equal(calls, 0);
    const original = host.runtime.listApprovals({taskId: task.taskId, state: 'pending'}).items[0];
    assert.equal(original.action, 'github.actions.repair.get');
    await host.close(); assert.equal(disposed, 1); host = open();
    assert.equal(host.submit(input).taskId, task.taskId);
    assert.throws(() => host.submit({...input, request: {...input.request, input: {...input.request.input, checkRunId: 12}}}),
      /request|checkpoint|binding/i);
    const approval = host.runtime.listApprovals({taskId: task.taskId, state: 'pending'}).items[0];
    assert.equal(approval.approvalId, original.approvalId);
    host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
    assert.equal((await host.resume(task.taskId)).state, 'succeeded');
    assert.deepEqual(host.readResult(task.taskId).receipt, receipt);
    assert.equal(host.readResult(task.taskId).state, 'checked'); assert.equal(calls, 1);
    const records = host.runtime.readToolExecutions(task.taskId);
    assert.equal(records.length, 1); assert.equal(records[0].toolName, 'github.actions.repair.get');
    assert.equal(records[0].state, 'confirmed');
    await host.close(); assert.equal(disposed, 2); host = open();
    assert.deepEqual(host.readResult(task.taskId).receipt, receipt); assert.equal(calls, 1);
    await assert.rejects(host.resume(task.taskId), /not ready to start/i);
    assert.equal(calls, 1);
  } finally {await host?.close(); await rm(directory, {recursive: true, force: true});}
});

test('an unapproved GitHub read pauses the original task without execution', async () => {
  await fixture(async (host, count) => {
    const task = host.submit(submission());
    const paused = await host.start(task.taskId);
    assert.equal(paused.state, 'waiting_approval');
    assert.equal(count.calls, 0);
    assert.equal(host.runtime.readToolExecutions(task.taskId).length, 0);
  });
});

test('cached repair hints are never displayed without a currently bound unknown execution', async () => {
  await fixture(async host => {
    const task = host.submit(submission());
    const cached = {state: 'pending', evidenceRefs: [], sourceRunLinkHint: {state: 'unverified',
      toolRunId: 'unbound', input: {repo: 'other/repository', checkRunId: 999}}};
    host.runtime.saveCheckpoint(task.taskId, 'dev-workflows-result-v1', cached);
    assert.deepEqual(host.readResult(task.taskId), {state: 'pending', evidenceRefs: []});
    assert.deepEqual(host.runtime.loadCheckpoint(task.taskId, 'dev-workflows-result-v1'), cached);
    assert.equal(host.runtime.readToolExecutions(task.taskId).length, 0);
    assert.equal(host.runtime.getTask(task.taskId).state, 'created');
  });
});

test('idempotent submissions retain request and deadline binding', async () => {
  await fixture(async host => {
    const input = submission();
    const first = host.submit(input);
    assert.equal(host.submit(input).taskId, first.taskId);
    assert.throws(() => host.submit({...input, request: {...input.request, input: {repo: 'example/project', number: 8}}}));
    assert.throws(() => host.submit({...input, deadline: new Date(Date.parse(input.deadline) + 1000).toISOString()}));
  });
});

test('approval resumes the original task and records a confirmed GitHub read', async () => {
  await fixture(async (host, count) => {
    const task = host.submit(submission());
    await host.start(task.taskId);
    const approval = host.runtime.listApprovals({taskId: task.taskId, state: 'pending'}).items[0];
    assert.ok(approval);
    host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
    const completed = await host.resume(task.taskId);
    assert.equal(completed.taskId, task.taskId);
    assert.equal(completed.state, 'succeeded');
    assert.equal(host.readResult(task.taskId).state, 'classified');
    assert.equal(count.calls, 1);
    const records = host.runtime.readToolExecutions(task.taskId);
    assert.equal(records.length, 1);
    assert.equal(records[0].state, 'confirmed');
    assert.equal(records[0].policyDecision, 'allow');
  });
});

test('CI discovery retains its approved page across SQLite restart and explicitly selects a separate repair task', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dev-ci-discovery-'));
  let host, listCalls = 0, modelCalls = 0;
  const provider = model(), complete = provider.complete.bind(provider);
  provider.complete = async request => {modelCalls++; return complete(request);};
  const run = {id: 42, name: 'Foundation', status: 'completed', conclusion: 'failure',
    headSha: 'a'.repeat(40), url: 'https://github.com/example/project/actions/runs/42', createdAt: '2026-10-05T00:00:00Z'};
  const list = {descriptor: {...readTool({calls: 0}).descriptor, name: 'github.actions.run.list', inputSchema: {type: 'object'}},
    async execute(input) {
      listCalls++;
      assert.deepEqual(input, {repo: 'example/project', status: 'failure', page: 2, perPage: 1, branch: 'main'});
      return {items: [structuredClone(run)], page: 2, nextPage: 3, hasMore: true};
    }};
  const open = () => createDevWorkflowsRuntime({path: path.join(directory, 'runtime.sqlite'), model: provider,
    tools: [list], maxSteps: 1, maxTokens: 1024});
  try {
    host = open();
    const input = {request: {kind: 'ci_list', input: {repo: 'example/project', page: 2, perPage: 1, branch: 'main'}},
      conversationId: 'ci-discovery', idempotencyKey: 'failed-main-page-2', deadline: new Date(Date.now() + 60_000).toISOString()};
    const task = host.submit(input);
    assert.equal((await host.start(task.taskId)).state, 'waiting_approval');
    const originalApproval = host.runtime.listApprovals({taskId: task.taskId, state: 'pending'}).items[0];
    assert.equal(originalApproval.action, 'github.actions.run.list');
    assert.equal(listCalls, 0); assert.equal(modelCalls, 0);
    await host.close(); host = open();
    assert.equal(host.submit(input).taskId, task.taskId);
    for (const changed of [{page: 3}, {branch: 'other'}, {repo: 'example/other'}, {perPage: 2}]) {
      assert.throws(() => host.submit({...input, request: {...input.request, input: {...input.request.input, ...changed}}}),
        /request|checkpoint|binding/i);
    }
    const approval = host.runtime.listApprovals({taskId: task.taskId, state: 'pending'}).items[0];
    assert.equal(approval.approvalId, originalApproval.approvalId);
    host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
    assert.equal((await host.resume(task.taskId)).state, 'succeeded');
    const page = host.readResult(task.taskId);
    assert.equal(page.state, 'listed'); assert.equal(page.page, 2); assert.equal(page.nextPage, 3); assert.equal(page.hasMore, true);
    assert.deepEqual(page.items, [run]); assert.equal(page.evidenceRefs.length, 1);
    assert.equal(listCalls, 1); assert.equal(modelCalls, 0);
    const records = host.runtime.readToolExecutions(task.taskId);
    assert.equal(records.length, 1); assert.equal(records[0].state, 'confirmed');
    await host.close(); host = open();
    assert.deepEqual(host.readResult(task.taskId), page);
    await assert.rejects(host.start(task.taskId), /not ready to start/i);
    assert.equal(listCalls, 1); assert.equal(modelCalls, 0);
    // Discovery does not schedule repairs. A trusted host selects and submits one independently.
    const selected = page.items[0], repairInput = {request: {kind: 'ci_fix', repository: input.request.input.repo, runId: String(selected.id)},
      conversationId: input.conversationId, idempotencyKey: `discovery-${task.taskId}-run-${selected.id}`, deadline: input.deadline};
    const repair = host.submit(repairInput);
    assert.notEqual(repair.taskId, task.taskId); assert.equal(repair.state, 'created');
    assert.equal(host.submit(repairInput).taskId, repair.taskId);
    assert.equal(listCalls, 1); assert.equal(modelCalls, 0);
    const nextInput = {...input, request: {...input.request, input: {...input.request.input, page: page.nextPage}},
      idempotencyKey: 'failed-main-page-3'};
    const next = host.submit(nextInput);
    assert.notEqual(next.taskId, task.taskId); assert.equal(next.state, 'created');
  } finally {await host?.close(); await rm(directory, {recursive: true, force: true});}
});

test('issue discovery resumes its approved SQLite page and feeds existing independent triage tasks', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dev-issue-discovery-'));
  let host, listCalls = 0, modelCalls = 0;
  const provider = model(), complete = provider.complete.bind(provider);
  provider.complete = async request => {modelCalls++; return complete(request);};
  const list = {descriptor: {...readTool({calls: 0}).descriptor, name: 'github.issue.list', inputSchema: {type: 'object'}},
    async execute(input) {
      listCalls++; assert.equal(input.page, 2);
      return {items: [structuredClone(issue)], page: 2, nextPage: 3, hasMore: true};
    }};
  const open = () => createDevWorkflowsRuntime({path: path.join(directory, 'runtime.sqlite'), model: provider,
    tools: [list, readTool({calls: 0})], maxSteps: 16, maxTokens: 1024});
  try {
    host = open();
    const input = {request: {kind: 'issue_list', input: {repo: 'example/project', page: 2, perPage: 1, state: 'open'}},
      conversationId: 'discovery', idempotencyKey: 'repo-open-page-2', deadline: new Date(Date.now() + 60_000).toISOString()};
    const task = host.submit(input);
    assert.equal((await host.start(task.taskId)).state, 'waiting_approval');
    assert.equal(listCalls, 0); assert.equal(modelCalls, 0);
    await host.close(); host = open();
    assert.equal(host.submit(input).taskId, task.taskId);
    assert.throws(() => host.submit({...input, request: {...input.request, input: {...input.request.input, page: 3}}}),
      /request|checkpoint|binding/i);
    const approval = host.runtime.listApprovals({taskId: task.taskId, state: 'pending'}).items[0];
    assert.equal(approval.action, 'github.issue.list');
    host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
    assert.equal((await host.resume(task.taskId)).state, 'succeeded');
    const page = host.readResult(task.taskId);
    assert.equal(page.state, 'listed'); assert.equal(page.page, 2); assert.equal(page.nextPage, 3);
    assert.equal(listCalls, 1); assert.equal(modelCalls, 0);
    const selected = page.items[0];
    const triage = host.submit({request: {kind: 'issue_triage', input: {repo: 'example/project', number: selected.number}},
      conversationId: 'discovery', idempotencyKey: `discovery-${task.taskId}-issue-${selected.number}`, deadline: input.deadline});
    assert.notEqual(triage.taskId, task.taskId);
    assert.equal((await host.start(triage.taskId)).state, 'waiting_approval');
    const readApproval = host.runtime.listApprovals({taskId: triage.taskId, state: 'pending'}).items[0];
    host.runtime.respondApproval(readApproval.approvalId, 'allow_once', readApproval.revision);
    assert.equal((await host.resume(triage.taskId)).state, 'succeeded');
    assert.equal(host.readResult(triage.taskId).classification.kind, 'docs');
    assert.equal(listCalls, 1); assert.equal(modelCalls, 1);
    assert.equal(host.runtime.readToolExecutions(task.taskId).every(record => record.toolName === 'github.issue.list'), true);
  } finally {if (host) await host.close(); await rm(directory, {recursive: true, force: true});}
});

test('repair approvals re-read current Issue after SQLite restart without changing the original delegate input', async t => {
  for (const changed of [false, true]) await t.test(changed ? 'closed changed Issue blocks original repair' : 'metadata-only change resumes original repair', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dev-issue-repair-fresh-'));
    let host, reads = 0, writes = 0, modelCalls = 0;
    const requests = [];
    let current = {...issue, title: 'Crash', body: 'Application crashes'};
    const provider = new FakeModelProvider([{kind: 'final', text: JSON.stringify({kind: 'bug', confidence: .99,
      evidence: [{field: 'title', quote: 'Crash'}]})}]), complete = provider.complete.bind(provider);
    provider.complete = async request => {modelCalls++; return complete(request);};
    const read = {...readTool({calls: 0}), async execute() {reads++; return structuredClone(current);}};
    const write = {descriptor: {name: 'synthetic.repair.step', version: '1.0.0', inputSchema: {type: 'object'},
      outputSchema: {type: 'object'}, requiredScopes: ['github:write'], sideEffect: 'external_write',
      requiresPresence: true, idempotencySupport: true, recoverySupport: true},
      async execute() {writes++; return {ok: true};}};
    const open = () => createDevWorkflowsRuntime({path: path.join(directory, 'runtime.sqlite'), model: provider,
      tools: [read, write], maxSteps: 20, maxTokens: 1024, isUserPresent: () => true,
      issueTriage: {repair: {async repairIssue(context, request) {
        requests.push(structuredClone(request));
        const outcome = await host.tools.invoke({toolName: write.descriptor.name, toolVersion: write.descriptor.version,
          arguments: {repo: request.repo, number: request.number}, taskId: context.taskId,
          runId: `${context.taskId}:synthetic-repair`, authorizationRef: context.taskId,
          deadline: context.deadline, signal: context.signal});
        return {state: outcome.state === 'pending' ? 'waiting_approval' : 'succeeded',
          resultSummary: 'Synthetic repair', evidenceRefs: outcome.evidenceRefs};
      }}}});
    try {
      host = open();
      const task = host.submit({request: {kind: 'issue_triage', input: {repo: 'example/project', number: 7,
        repairBug: true, repairGoal: 'Authorized repair'}}, conversationId: 'fresh-repair',
        idempotencyKey: 'original-repair', deadline: new Date(Date.now() + 60_000).toISOString()});
      let snapshot = await host.start(task.taskId), approval;
      for (let i = 0; snapshot.state === 'waiting_approval' && i < 8; i++) {
        approval = host.runtime.listApprovals({taskId: task.taskId, state: 'pending'}).items[0];
        assert.ok(approval);
        if (approval.action === write.descriptor.name) break;
        host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
        snapshot = await host.resume(task.taskId);
      }
      assert.equal(approval.action, write.descriptor.name);
      assert.equal(reads, 3); assert.equal(requests.length, 1); assert.equal(writes, 0);
      await host.close(); host = undefined;
      current = {...current, labels: ['bug'], updatedAt: '2026-10-01T01:00:00.000Z',
        ...(changed ? {state: 'closed', body: 'Changed after repair approval'} : {})};
      host = open();
      approval = host.runtime.listApprovals({taskId: task.taskId, state: 'pending'}).items[0];
      host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
      assert.equal((await host.resume(task.taskId)).state, 'waiting_approval');
      const fresh = host.runtime.listApprovals({taskId: task.taskId, state: 'pending'}).items[0];
      assert.equal(fresh.action, 'github.issue.get');
      assert.equal(reads, 3); assert.equal(requests.length, 1); assert.equal(writes, 0);
      await host.close(); host = open();
      assert.equal((await host.resume(task.taskId)).state, 'waiting_approval');
      approval = host.runtime.listApprovals({taskId: task.taskId, state: 'pending'}).items[0];
      assert.equal(approval.approvalId, fresh.approvalId);
      host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
      snapshot = await host.resume(task.taskId);
      assert.equal(snapshot.taskId, task.taskId); assert.equal(snapshot.state, 'succeeded');
      assert.equal(reads, 4); assert.equal(modelCalls, 1);
      assert.equal(requests.length, changed ? 1 : 2); assert.equal(writes, changed ? 0 : 1);
      if (!changed) assert.deepEqual(requests[1], requests[0]);
      assert.equal(host.readResult(task.taskId).reason, changed ? 'issue_changed_before_repair' : 'repair_delegated');
    } finally {if (host) await host.close(); await rm(directory, {recursive: true, force: true});}
  });
});

test('unknown tasks cannot be reopened without original confirmed Evidence', async () => {
  await fixture(async host => {
    const task = host.submit(submission());
    await host.start(task.taskId);
    assert.throws(() => host.resumeConfirmed(task.taskId, {runId: 'invented', toolName: 'github.issue.get',
      toolVersion: '0.1.0-alpha.1', arguments: {repo: 'example/project', number: 7}}), /confirmed receipt/);
  });
});

test('a larger CI budget does not prevent other workflows from starting', async () => {
  await fixture(async (host, count) => {
    const task = host.submit(submission());
    assert.equal((await host.start(task.taskId)).state, 'waiting_approval');
    const approval = host.runtime.listApprovals({taskId: task.taskId, state: 'pending'}).items[0];
    host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
    assert.equal((await host.resume(task.taskId)).state, 'succeeded');
    assert.equal(host.readResult(task.taskId).state, 'classified');
    assert.equal(count.calls, 1);
  }, {maxTokens: 64_000});
});

test('issue classification survives SQLite restart before prewrite approval without another model call', async t => {
  for (const timing of ['unchanged', 'before_prewrite', 'during_label_approval', 'during_resume_read_approval']) {
    const changed = timing !== 'unchanged';
    await t.test(changed ? `changed facts at ${timing} reject every label` : 'original facts label once', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dev-triage-restart-'));
    let host, reads = 0, labels = 0, modelCalls = 0, current = structuredClone(issue);
    const provider = model(), complete = provider.complete.bind(provider);
    provider.complete = async request => {modelCalls++; return complete(request);};
    const read = {...readTool({calls: 0}), async execute() {reads++; return structuredClone(current);}};
    const label = {descriptor: {name: 'github.issue.label', version: '0.1.0-alpha.1',
      inputSchema: {type: 'object'}, outputSchema: {type: 'object'}, requiredScopes: ['github:write'],
      sideEffect: 'external_write', requiresPresence: true, idempotencySupport: false, recoverySupport: true},
      async execute(input) {
        labels++; assert.deepEqual(input.labels, ['documentation']);
        assert.equal(input.expectedUpdatedAt, issue.updatedAt);
        return {state: 'confirmed', evidenceRefs: []};
      }};
    const open = () => createDevWorkflowsRuntime({path: path.join(directory, 'runtime.sqlite'), model: provider,
      tools: [read, label], maxSteps: 16, maxTokens: 1024, isUserPresent: () => true});
    try {
      host = open();
      const input = submission(); input.request.input.writeLabel = true;
      const task = host.submit(input);
      assert.equal((await host.start(task.taskId)).state, 'waiting_approval');
      let approval = host.runtime.listApprovals({taskId: task.taskId, state: 'pending'}).items[0];
      host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
      assert.equal((await host.resume(task.taskId)).state, 'waiting_approval');
      assert.equal(modelCalls, 1); assert.equal(labels, 0);
      assert.equal(reads, 1);
      await host.close(); host = undefined;
      if (timing === 'before_prewrite') current = {...current, body: 'Changed after classification at the same timestamp'};
      host = open();
      assert.equal(host.runtime.getTask(task.taskId).state, 'waiting_approval');
      approval = host.runtime.listApprovals({taskId: task.taskId, state: 'pending'}).items[0];
      assert.equal(approval.action, 'github.issue.get');
      host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
      let snapshot = await host.resume(task.taskId);
      if (timing !== 'before_prewrite') {
        assert.equal(snapshot.state, 'waiting_approval');
        approval = host.runtime.listApprovals({taskId: task.taskId, state: 'pending'}).items[0];
        assert.equal(approval.action, 'github.issue.label');
        if (timing === 'during_label_approval') current = {...current, body: 'Changed during label approval at the same timestamp'};
        host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
        snapshot = await host.resume(task.taskId);
        assert.equal(snapshot.state, 'waiting_approval');
        assert.equal(labels, 0, 'label approval cannot bypass the fresh Issue read');
        const readApproval = host.runtime.listApprovals({taskId: task.taskId, state: 'pending'}).items[0];
        assert.equal(readApproval.action, 'github.issue.get');
        await host.close(); host = undefined; host = open();
        approval = host.runtime.listApprovals({taskId: task.taskId, state: 'pending'}).items[0];
        assert.equal(approval.approvalId, readApproval.approvalId, 'the pending read retains its original approval after restart');
        if (timing === 'during_resume_read_approval') current = {...current, body: 'Changed during resume read approval at the same timestamp'};
        host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
        snapshot = await host.resume(task.taskId);
      }
      assert.equal(snapshot.taskId, task.taskId); assert.equal(snapshot.state, 'succeeded',
        JSON.stringify(host.runtime.readToolExecutions(task.taskId)));
      assert.equal(modelCalls, 1); assert.equal(labels, changed ? 0 : 1);
      assert.equal(reads, timing === 'before_prewrite' ? 2 : 3, 'each approved read executes once');
      assert.equal(host.readResult(task.taskId).reason, changed ? 'issue_changed' : 'label_confirmed');
      assert.equal(host.runtime.readToolExecutions(task.taskId).filter(record => record.toolName === 'github.issue.label').length,
        changed ? 0 : 1);
    } finally {if (host) await host.close(); await rm(directory, {recursive: true, force: true});}
    });
  }
});

test('failed workflow construction disposes registered GitHub providers and closes SQLite', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dev-init-rollback-'));
  const database = path.join(directory, 'runtime.sqlite');
  let disposed = 0;
  const github = {verification: 'mock', async execute() {throw Error('unused');}, dispose() {disposed++;}};
  try {
    assert.throws(() => createDevWorkflowsRuntime({path: database, model: model(), github,
      maxSteps: 16, maxTokens: 1024, issueTriage: {minConfidence: 2}}), /INVALID_TRIAGE_OPTIONS/);
    assert.equal(disposed, 1);
    // Windows rejects deleting a SQLite file if a leaked connection still owns it.
    await rm(database);
    const host = createDevWorkflowsRuntime({path: database, model: model(), tools: [readTool({calls: 0})],
      maxSteps: 16, maxTokens: 1024});
    await host.close();
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('provider disposal failure does not hide the original workflow construction error', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dev-dispose-error-'));
  const database = path.join(directory, 'runtime.sqlite');
  let disposed = 0;
  const github = {verification: 'mock', async execute() {throw Error('unused');},
    dispose() {disposed++; throw Error('dispose interrupted');}};
  try {
    assert.throws(() => createDevWorkflowsRuntime({path: database, model: model(), github,
      maxSteps: 16, maxTokens: 1024, issueTriage: {minConfidence: 2}}), /INVALID_TRIAGE_OPTIONS/);
    assert.equal(disposed, 1);
    await rm(database);
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('Unicode pre-review survives SQLite approval restarts and publishes its original comment once', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dev-review-unicode-restart-'));
  const headSha = 'a'.repeat(40), baseSha = 'b'.repeat(40);
  const file = 'src/中文.ts';
  const quoted = '\\344\\270\\255\\346\\226\\207.ts';
  const diff = `diff --git "a/src/${quoted}" "b/src/${quoted}"\n--- "a/src/${quoted}"\n+++ "b/src/${quoted}"\n@@ -1 +1 @@\n-old\n+new\n`;
  let host, writes = 0, modelCalls = 0;
  const makeGithub = () => new GhCliProvider({repositories: ['example/project'], readToken: async () => 'synthetic-token',
    runner: {async run(command) {
      if (command.args[command.args.indexOf('--method') + 1] === 'POST') {
        writes++; const body = JSON.parse(command.stdin);
        assert.equal(body.path, file); assert.equal(body.commit_id, headSha);
        return {exitCode: 0, stdout: JSON.stringify({id: 10,
          html_url: 'https://github.com/example/project/pull/7#discussion_r10'}), stderr: ''};
      }
      if (command.args.includes('Accept: application/vnd.github.diff')) return {exitCode: 0, stdout: diff, stderr: ''};
      return {exitCode: 0, stdout: JSON.stringify({number: 7, title: '中文 change', body: '', state: 'open', draft: false,
        base: {ref: 'main', sha: baseSha}, head: {ref: 'feature', sha: headSha},
        html_url: 'https://github.com/example/project/pull/7'}), stderr: ''};
    }}});
  const provider = new FakeModelProvider([{kind: 'final', text: JSON.stringify({findings: [
    {kind: 'question', ruleId: 'rule', path: file, line: 1, side: 'RIGHT', body: 'Explain this change'},
  ]})}]), complete = provider.complete.bind(provider);
  provider.complete = async request => {modelCalls++; return complete(request);};
  const open = () => createDevWorkflowsRuntime({path: path.join(directory, 'runtime.sqlite'), model: provider,
    github: makeGithub(), isUserPresent: () => true, maxSteps: 20, maxTokens: 1024});
  try {
    host = open();
    const task = host.submit({request: {kind: 'code_review', publish: true, input: {repo: 'example/project', number: 7,
      rules: [{id: 'rule', text: 'Explain meaningful changes'}]}}, conversationId: 'unicode-review',
      idempotencyKey: 'one-unicode-review', deadline: new Date(Date.now() + 60_000).toISOString()});
    let snapshot = await host.start(task.taskId), sawCommentApproval = false;
    for (let i = 0; snapshot.state === 'waiting_approval' && i < 12; i++) {
      await host.close(); host = open();
      const approval = host.runtime.listApprovals({taskId: task.taskId, state: 'pending'}).items[0];
      assert.ok(approval); sawCommentApproval ||= approval.action === 'github.pr.review.comment';
      host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
      snapshot = await host.resume(task.taskId);
    }
    assert.equal(sawCommentApproval, true); assert.equal(snapshot.taskId, task.taskId);
    assert.equal(snapshot.state, 'succeeded'); assert.equal(modelCalls, 1); assert.equal(writes, 1);
    assert.equal(host.runtime.readToolExecutions(task.taskId).filter(record => record.toolName === 'github.pr.review.comment').length, 1);
    const diffReads = host.runtime.readToolExecutions(task.taskId).filter(record => record.toolName === 'github.pr.diff');
    assert.equal(diffReads.length, 1);
    assert.ok(host.readResult(task.taskId).report.evidenceRefs.includes(diffReads[0].evidenceId));
  } finally {if (host) await host.close(); await rm(directory, {recursive: true, force: true});}
});

test('pre-review report and confirmed publication evidence remain visible when a later finding cannot publish', async t => {
  for (const outcome of ['unsupported', 'pending', 'unknown']) await t.test(outcome, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dev-review-visible-'));
    const headSha = 'a'.repeat(40), baseSha = 'b'.repeat(40);
    const paths = ['src/a.ts', outcome === 'unsupported' ? 'src/a..ts' : 'src/b.ts'];
    const diff = paths.map(file => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-old\n+new\n`).join('');
    const writes = []; let host, modelCalls = 0;
    const github = () => new GhCliProvider({repositories: ['example/project'], readToken: async () => 'synthetic-token',
      runner: {async run(command) {
        if (command.args[command.args.indexOf('--method') + 1] === 'POST') {
          const body = JSON.parse(command.stdin); writes.push(body.path);
          if (outcome === 'unknown' && body.path === paths[1]) return {exitCode: 1, stdout: '', stderr: 'Synthetic uncertain write'};
          return {exitCode: 0, stdout: JSON.stringify({id: 10,
            html_url: 'https://github.com/example/project/pull/7#discussion_r10'}), stderr: ''};
        }
        if (command.args.includes('Accept: application/vnd.github.diff')) return {exitCode: 0, stdout: diff, stderr: ''};
        return {exitCode: 0, stdout: JSON.stringify({number: 7, title: 'Change', body: '', state: 'open', draft: false,
          base: {ref: 'main', sha: baseSha}, head: {ref: 'feature', sha: headSha},
          html_url: 'https://github.com/example/project/pull/7'}), stderr: ''};
      }}});
    const provider = new FakeModelProvider([{kind: 'final', text: JSON.stringify({findings: paths.map(file =>
      ({kind: 'question', ruleId: 'rule', path: file, line: 1, side: 'RIGHT', body: `Explain ${file}`}))})}]);
    const complete = provider.complete.bind(provider);
    provider.complete = async input => {modelCalls++; return complete(input);};
    const open = () => createDevWorkflowsRuntime({path: path.join(directory, 'runtime.sqlite'), model: provider,
      github: github(), isUserPresent: () => true, maxSteps: 20, maxTokens: 2048});
    try {
      host = open();
      const task = host.submit({request: {kind: 'code_review', publish: true, input: {repo: 'example/project', number: 7,
        rules: [{id: 'rule', text: 'Explain meaningful changes'}]}}, conversationId: 'visible-review',
        idempotencyKey: 'one-visible-review', deadline: new Date(Date.now() + 60_000).toISOString()});
      let snapshot = await host.start(task.taskId);
      for (let i = 0; snapshot.state === 'waiting_approval' && i < 16; i++) {
        const approval = host.runtime.listApprovals({taskId: task.taskId, state: 'pending'}).items[0];
        assert.ok(approval);
        if (outcome === 'pending' && approval.action === 'github.pr.review.comment' && writes.length === 1) break;
        host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
        snapshot = await host.resume(task.taskId);
      }
      assert.equal(snapshot.state, outcome === 'unsupported' ? 'failed' : outcome === 'pending' ? 'waiting_approval' : 'waiting_reconciliation');
      const result = host.readResult(task.taskId);
      assert.equal(result.state, outcome);
      assert.deepEqual(result.report.findings.map(finding => finding.path), paths);
      assert.deepEqual(result.publication, {findingIndex: 1, totalFindings: 2, confirmedFindingIndexes: [0]});
      const first = host.runtime.readToolExecutions(task.taskId).find(record => record.toolName === 'github.pr.review.comment' && record.state === 'confirmed');
      assert.ok(first); assert.ok(result.evidenceRefs.includes(first.evidenceId));
      assert.equal(modelCalls, 1); assert.equal(writes.length, outcome === 'unknown' ? 2 : 1);
      await host.close(); host = open();
      assert.deepEqual(host.readResult(task.taskId), result);
      if (outcome === 'pending') {
        assert.equal((await host.resume(task.taskId)).state, 'waiting_approval');
        assert.equal(writes.length, 1); assert.equal(modelCalls, 1);
        const approval = host.runtime.listApprovals({taskId: task.taskId, state: 'pending'}).items[0];
        host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
        assert.equal((await host.resume(task.taskId)).state, 'succeeded');
        const completed = host.readResult(task.taskId);
        assert.equal(completed.state, 'confirmed'); assert.deepEqual(completed.report, result.report);
        assert.deepEqual(completed.publication.confirmedFindingIndexes, [0, 1]);
        assert.equal(writes.length, 2); assert.equal(modelCalls, 1);
      } else {
        await assert.rejects(host.resume(task.taskId), /not ready to start/i);
        assert.equal(writes.length, outcome === 'unknown' ? 2 : 1);
      }
    } finally {await host?.close(); await rm(directory, {recursive: true, force: true});}
  });
});

test('PR base drift during approval cannot publish a cached pre-review', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dev-review-base-'));
  const headSha = 'a'.repeat(40), baseSha = 'b'.repeat(40);
  let currentBase = baseSha, writes = 0;
  const diff = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n';
  // Exercise the production gh adapter with a synthetic transport; no network/account writes.
  const github = new GhCliProvider({repositories: ['example/project'], readToken: async () => 'synthetic-token',
    runner: {async run(command) {
      const method = command.args[command.args.indexOf('--method') + 1];
      if (method === 'POST') {
        writes++;
        return {exitCode: 0, stdout: JSON.stringify({id: 10,
          html_url: 'https://github.com/example/project/pull/7#discussion_r10'}), stderr: ''};
      }
      if (command.args.includes('Accept: application/vnd.github.diff')) return {exitCode: 0, stdout: diff, stderr: ''};
      return {exitCode: 0, stdout: JSON.stringify({number: 7, title: 'Change', body: '', state: 'open', draft: false,
        base: {ref: 'main', sha: currentBase}, head: {ref: 'feature', sha: headSha},
        html_url: 'https://github.com/example/project/pull/7'}), stderr: ''};
    }}});
  const model = new FakeModelProvider([{kind: 'final', text: JSON.stringify({findings: [
    {kind: 'question', ruleId: 'rule', path: 'src/a.ts', line: 1, side: 'RIGHT', body: 'Explain this change'},
  ]})}]);
  const host = createDevWorkflowsRuntime({path: path.join(directory, 'runtime.sqlite'), model, github,
    isUserPresent: () => true, maxSteps: 20, maxTokens: 1024});
  try {
    const task = host.submit({request: {kind: 'code_review', publish: true, input: {repo: 'example/project', number: 7,
      rules: [{id: 'rule', text: 'Explain meaningful changes'}]}}, conversationId: 'review-base',
      idempotencyKey: 'one-review', deadline: new Date(Date.now() + 60_000).toISOString()});
    let snapshot = await host.start(task.taskId), reachedWriteApproval = false;
    for (let i = 0; snapshot.state === 'waiting_approval' && i < 12; i++) {
      const approval = host.runtime.listApprovals({taskId: task.taskId, state: 'pending'}).items[0];
      assert.ok(approval);
      if (approval.action === 'github.pr.review.comment') {currentBase = 'c'.repeat(40); reachedWriteApproval = true;}
      host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
      snapshot = await host.resume(task.taskId);
      if (reachedWriteApproval) break;
    }
    assert.equal(reachedWriteApproval, true);
    assert.equal(writes, 0);
    assert.equal(snapshot.state, 'waiting_reconciliation');
    const record = host.runtime.readToolExecutions(task.taskId).find(record => record.toolName === 'github.pr.review.comment');
    assert.equal(record.state, 'unknown');
    assert.equal(record.errorCode, 'RESULT_UNKNOWN');
  } finally {await host.close(); await rm(directory, {recursive: true, force: true});}
});

async function patchFixture(t, {confirmApply = false, previewFailure, invalidPreview = false, intentSaveFailure = false,
  sourceRunBacklink = false, sourceLinkUnknown = false, registeredSourceLink = false, candidateId = 11,
  invalidCandidate = false, candidatePersistenceFailure = false, candidateConflict = false} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dev-patch-recovery-'));
  await writeFile(path.join(directory, 'app.js'), 'const value = 1;\n');
  const {createHash} = await import('node:crypto');
  const before = createHash('sha256').update('const value = 1;\n').digest('hex');
  const preflightFailure = !!previewFailure || invalidPreview || intentSaveFailure;
  const calls = {apply: 0, polls: [], outcome: 'unknown', bindingId: 'd'.repeat(64), marker: !preflightFailure,
    sourceLinks: 0, sourceReadbacks: 0, checkGets: 0, modelCalls: 0};
  const read = createWorkspaceReadTool({rootPath: directory});
  const trustedPreview = createWorkspacePatchPreviewTool({rootPath: directory});
  const preview = {...trustedPreview, async execute(input, context) {
    if (previewFailure) throw previewFailure;
    const result = await trustedPreview.execute(input, context);
    return invalidPreview ? {...result, afterSha256: 'invalid'} : result;
  }};
  const descriptor = (name, sideEffect = 'read') => ({name, version: '1.0.0', inputSchema: {type: 'object'},
    outputSchema: {type: 'object'}, requiredScopes: [sideEffect === 'read' ? 'workspace:read' : 'workspace:write'],
    sideEffect, requiresPresence: false, idempotencySupport: false, recoverySupport: false});
  const values = {
    'github.actions.run.list': {items: [{id: 1, conclusion: 'failure', headSha: 'a'.repeat(40), url: 'https://github.com/example/project/actions/runs/1'}]},
    'github.actions.job.list': {items: [{id: 2, conclusion: 'failure'}]},
    'github.actions.log.read': {text: 'synthetic failing build', truncated: false},
    'workspace.git.head': {headSha: 'a'.repeat(40), clean: true, workspaceClean: true},
    'workspace.run_allowed_command': {recipeId: 'check', exitCode: 0},
    'workspace.git.commit': {headSha: 'b'.repeat(40), parentSha: 'a'.repeat(40)},
    'workspace.git.push': {headSha: 'b'.repeat(40), pushed: true},
    'github.pr.create': {state: 'confirmed', externalId: '9', url: 'https://github.com/example/project/pull/9'},
    'github.pr.comment': {state: 'confirmed'},
  };
  const tools = [read, preview, ...Object.entries(values).filter(([name]) => !registeredSourceLink || !name.startsWith('github.')).map(([name, result]) => ({descriptor: descriptor(name),
    async execute() {return structuredClone(result);}})),
    ...(sourceRunBacklink && !registeredSourceLink ? [{descriptor: {...descriptor('synthetic.source.link', 'external_write'),
      requiredScopes: ['github:write'], requiresPresence: true}, async execute(input) {
        calls.sourceLinks++; calls.sourceArguments = structuredClone(input);
        if (sourceLinkUnknown) throw new ProtocolError('RESULT_UNKNOWN', 'Synthetic uncertain Check creation');
        return {state: 'confirmed', ...input, checkRunId: 11, externalId: '11',
          url: 'https://github.com/example/project/runs/11', name: githubRepairCheckName(input),
          detailsUrl: 'https://github.com/example/project/pull/9', status: 'completed', conclusion: 'neutral', evidenceRefs: []};
      }}] : []),
    {descriptor: {...descriptor('workspace.apply_text_patch', 'local_write'), requiredScopes: ['workspace:read','workspace:write']},
      async execute(input, context) {
        calls.apply++;
        if (confirmApply) return host.runtime.loadCheckpoint(context.taskId, `dev-patch-intent:${context.runId}`).expected;
        throw new ProtocolError('RESULT_UNKNOWN', 'Workspace patch helper identity is unavailable');
      }}];
  const provider = new FakeModelProvider([{kind: 'final', text: JSON.stringify({diagnosis: 'synthetic repair',
    patches: [{path: 'app.js', expectedSha256: before, edits: [{oldText: 'value = 1', newText: 'value = 2'}]}]})}]);
  const complete = provider.complete.bind(provider);
  provider.complete = async input => {calls.modelCalls++; return complete(input);};
  let host;
  const repairReceipt = input => ({...input, checkRunId: candidateId, externalId: String(candidateId),
    url: `https://github.com/example/project/runs/${candidateId}`, name: githubRepairCheckName(input),
    detailsUrl: 'https://github.com/example/project/pull/9', status: 'completed', conclusion: 'neutral', evidenceRefs: []});
  const github = () => {
    const fake = new FakeGitHubProvider({
    'actions.run.list': {...values['github.actions.run.list'], items: [{...values['github.actions.run.list'].items[0],
      name: 'Synthetic failing build', status: 'completed', createdAt: '2026-10-01T00:00:00.000Z'}], page: 1, nextPage: null, hasMore: false},
    'actions.job.list': {items: [{id: 2, runId: 1, name: 'Synthetic job', status: 'completed', conclusion: 'failure',
      url: 'https://github.com/example/project/actions/runs/1/job/2'}], page: 1, nextPage: null, hasMore: false},
    'actions.log.read': {...values['github.actions.log.read'], offset: 0, nextOffset: null},
    'pr.create': {...values['github.pr.create'], evidenceRefs: []},
    'pr.comment': {...values['github.pr.comment'], evidenceRefs: []},
    'actions.repair.link': input => {
      calls.sourceLinks++; calls.sourceArguments = structuredClone(input);
      return {state: 'unknown', ...(candidateId == null ? {} : {checkRunId: candidateId}),
        evidenceRefs: [], ...(invalidCandidate ? {untrustedExtra: 'invalid'} : {})};
    },
    'actions.repair.get': input => {calls.sourceReadbacks++; assert.equal(input.checkRunId, candidateId);
      const {checkRunId: _id, ...identity} = input; return repairReceipt(identity);},
    });
    if (registeredSourceLink !== 'gh') return fake;
    // Real GhCliProvider logic with an explicit synthetic transport, never a real account.
    const gh = new GhCliProvider({repositories: ['example/project'], readToken: async () => 'synthetic-check-token',
      runner: {async run(command) {
        const methodAt = command.args.indexOf('--method'), method = command.args[methodAt + 1], endpoint = command.args[methodAt + 2];
        let result;
        if (endpoint === 'repos/example/project/actions/runs/1') result = {id: 1, repository: {full_name: 'example/project'},
          run_attempt: 3, head_sha: 'a'.repeat(40), status: 'completed', conclusion: 'failure'};
        else if (endpoint === 'repos/example/project/pulls/9') result = {number: 9, state: 'open', base: {repo: {full_name: 'example/project'}},
          head: {repo: {full_name: 'example/project'}, sha: 'b'.repeat(40)}, html_url: 'https://github.com/example/project/pull/9'};
        else if (endpoint === 'repos/example/project/check-runs' && method === 'POST') {
          calls.sourceLinks++;
          calls.syntheticCheck = {id: 11, url: 'https://api.github.com/repos/example/project/check-runs/11',
            html_url: 'https://github.com/example/project/runs/11', ...JSON.parse(command.stdin)};
          result = calls.syntheticCheck;
        } else if (endpoint === 'repos/example/project/check-runs/11' && method === 'GET') {
          calls.checkGets++;
          if (calls.checkGets === 1) throw new ProtocolError('EXTERNAL_FAILURE', 'Synthetic post-write GET failure');
          calls.sourceReadbacks++; result = calls.syntheticCheck;
        } else assert.fail('unexpected synthetic Check endpoint');
        return {exitCode: 0, stdout: JSON.stringify(result), stderr: ''};
      }}});
    return {verification: 'mock', execute(op, input, context) {
      if (op === 'actions.repair.link') calls.sourceArguments = structuredClone(input);
      return op.startsWith('actions.repair.') ? gh.execute(op, input, context) : fake.execute(op, input, context);
    }, dispose() {fake.dispose?.(); gh.dispose();}};
  };
  const create = () => createDevWorkflowsRuntime({path: path.join(directory, 'runtime.sqlite'), model: provider,
    tools, maxSteps: 32, maxTokens: 64_000, ...(sourceRunBacklink ? {isUserPresent: () => true} : {}),
    ...(registeredSourceLink ? {github: github(), githubRepairLinks: true} : {}),
    ciFix: {sourcePaths: ['app.js'], verifyRecipeId: 'check', headBranch: 'repair', baseBranch: 'main',
      ...(sourceRunBacklink ? {sourceRunBacklink: {toolName: registeredSourceLink ? 'github.actions.repair.link' : 'synthetic.source.link', runAttempt: 3}} : {}),
      gitTools: {head: 'workspace.git.head', commit: 'workspace.git.commit', push: 'workspace.git.push',
        pullRequest: 'github.pr.create', backlink: 'github.pr.comment'}},
    workspacePatchReconciliation: {get bindingId() {return calls.bindingId;}, async reconcile(input) {
      calls.polls.push(input);
      if (!calls.marker) return {path: input.relativePath, state: 'clear'};
      const intent = host.runtime.loadCheckpoint(input.expectedRunId.split(':ci-fix:')[0], `dev-patch-intent:${input.expectedRunId}`);
      const result = {path: input.relativePath, runId: input.expectedRunId, argumentsDigest: input.expectedArgumentsDigest,
        beforeSha256: intent.expected.beforeSha256, afterSha256: intent.expected.afterSha256};
      if (calls.outcome === 'in_progress') return {...result, state: 'in_progress', pid: 123};
      if (input.retainMarker !== true) calls.marker = false;
      const observed = {...result, state: 'reconciled', outcome: calls.outcome,
        currentSha256: calls.outcome === 'applied' ? result.afterSha256 : calls.outcome === 'not_applied' ? result.beforeSha256 : 'f'.repeat(64)};
      if (!calls.reuseReadback) return observed;
      calls.sharedReadback ??= {};
      Object.assign(calls.sharedReadback, observed);
      if (input.retainMarker !== true && calls.mutateAcknowledgement) {
        calls.sharedReadback.outcome = 'applied'; calls.sharedReadback.currentSha256 = result.afterSha256;
      }
      return calls.sharedReadback;
    }},
  });
  host = create();
  if (candidatePersistenceFailure || candidateConflict) {
    const saveOnce = host.runtime.saveCheckpointOnce.bind(host.runtime);
    host.runtime.saveCheckpointOnce = (taskId, key, value) => {
      if (key.startsWith('dev-repair-link-unknown:') && !key.endsWith(':conflict')) {
        if (candidatePersistenceFailure) throw new ProtocolError('EXTERNAL_FAILURE', 'Synthetic candidate persistence failure');
        saveOnce(taskId, key, {...value, checkRunId: 12});
      }
      return saveOnce(taskId, key, value);
    };
  }
  if (intentSaveFailure) {
    const saveOnce = host.runtime.saveCheckpointOnce.bind(host.runtime);
    host.runtime.saveCheckpointOnce = (taskId, key, value) => {
      if (key.startsWith('dev-patch-intent:')) throw new ProtocolError('EXTERNAL_FAILURE', 'Synthetic intent persistence failure');
      return saveOnce(taskId, key, value);
    };
  }
  t.after(async () => {await host.close(); await rm(directory, {recursive: true, force: true});});
  const task = host.submit({request: {kind: 'ci_fix', repository: 'example/project', runId: '1'},
    conversationId: 'patch-recovery', idempotencyKey: 'same-repair', deadline: new Date(Date.now() + 120_000).toISOString()});
  let snapshot = await host.start(task.taskId);
  for (let index = 0; snapshot.state === 'waiting_approval' && index < 10; index++) {
    const approval = host.runtime.listApprovals({taskId: task.taskId, state: 'pending'}).items[0];
    host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
    snapshot = await host.resume(task.taskId);
  }
  if (!confirmApply) assert.equal(snapshot.state, 'waiting_reconciliation');
  assert.equal(calls.apply, preflightFailure ? 0 : 1);
  const record = host.runtime.readToolExecutions(task.taskId).find(item => item.toolName === 'workspace.apply_text_patch');
  assert.ok(record);
  return {get host() {return host;}, taskId: task.taskId, runId: record.evidenceId, calls,
    async restart() {await host.close(); host = create();}};
}

test('patch preview preflight failures retain the original unknown run with fixed local diagnostics', async t => {
  for (const [name, options, code] of [
    ['preview rejection', {previewFailure: new ProtocolError('REVISION_CONFLICT', 'Synthetic private /unshared/source.js token ghp_fixture_secret')}, 'REVISION_CONFLICT'],
    ['invalid preview', {invalidPreview: true}, 'REVISION_CONFLICT'],
    ['intent persistence', {intentSaveFailure: true}, 'EXTERNAL_FAILURE'],
  ]) await t.test(name, async t => {
    const f = await patchFixture(t, options);
    const record = f.host.runtime.readToolExecutions(f.taskId).find(item => item.evidenceId === f.runId);
    assert.equal(record.state, 'unknown'); assert.equal(record.errorCode, 'RESULT_UNKNOWN');
    assert.equal(record.policyDecision, 'allow'); assert.equal(record.executionStarted, true);
    assert.equal(record.reconciliationOutcome, undefined);
    assert.ok(f.runId.startsWith(`${f.taskId}:ci-fix:`));
    assert.equal(f.host.runtime.getTask(f.taskId).state, 'waiting_reconciliation');
    assert.equal(f.calls.apply, 0); assert.equal(f.calls.marker, false); assert.equal(f.calls.polls.length, 0);
    for (const key of [`dev-patch-intent:${f.runId}`, `dev-patch-readback:${f.runId}`, `tool-result-${f.runId}`]) {
      assert.equal(f.host.runtime.loadCheckpoint(f.taskId, key), undefined);
    }
    const diagnostic = f.host.runtime.loadCheckpoint(f.taskId, `dev-patch-diagnostic:${f.runId}`);
    assert.deepEqual(diagnostic, {stage: 'preview', code});
    await f.restart();
    assert.deepEqual(f.host.runtime.loadCheckpoint(f.taskId, `dev-patch-diagnostic:${f.runId}`), diagnostic);
    await assert.rejects(f.host.reconcileWorkspacePatchTask(f.taskId, f.runId), /original workflow/);
    assert.equal(f.calls.apply, 0); assert.equal(f.calls.polls.length, 0);
    assert.equal(f.host.runtime.getTask(f.taskId).state, 'waiting_reconciliation');
  });
});

test('workflow patch polls preserve unknown markers across restart without repeating apply', async t => {
  const f = await patchFixture(t);
  const diagnostic = f.host.runtime.loadCheckpoint(f.taskId, `dev-patch-diagnostic:${f.runId}`);
  assert.deepEqual(diagnostic, {stage: 'process_identity', code: 'RESULT_UNKNOWN'});
  for (const outcome of ['unknown','in_progress']) {
    f.calls.outcome = outcome;
    const observed = await f.host.reconcileWorkspacePatchTask(f.taskId, f.runId);
    assert.equal(observed.task.state, 'waiting_reconciliation'); assert.equal(observed.receipt, undefined);
  }
  assert.equal(f.calls.marker, true); await f.restart();
  f.calls.outcome = 'unknown'; await f.host.reconcileWorkspacePatchTask(f.taskId, f.runId);
  assert.equal(f.calls.apply, 1); assert.ok(f.calls.polls.every(input => input.retainMarker === true));
  assert.equal(f.host.runtime.readToolExecutions(f.taskId).find(item => item.evidenceId === f.runId).reconciliationOutcome, undefined);
});

test('source repair association retains its independent SQLite approval and never repeats an unknown write', async t => {
  for (const unknown of [false, true]) await t.test(unknown ? 'unknown original execution' : 'confirmed neutral association', async t => {
    const f = await patchFixture(t, {confirmApply: true, sourceRunBacklink: true, sourceLinkUnknown: unknown});
    let snapshot = f.host.runtime.getTask(f.taskId), sourceApproval;
    for (let i = 0; snapshot.state === 'waiting_approval' && i < 32; i++) {
      const approval = f.host.runtime.listApprovals({taskId: f.taskId, state: 'pending'}).items[0];
      assert.ok(approval);
      if (approval.action === 'synthetic.source.link') {sourceApproval = approval; break;}
      f.host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
      snapshot = await f.host.resume(f.taskId);
    }
    assert.ok(sourceApproval); assert.equal(f.calls.sourceLinks, 0);
    assert.equal(f.host.readResult(f.taskId).pullRequestUrl, 'https://github.com/example/project/pull/9');
    await f.restart();
    assert.equal((await f.host.resume(f.taskId)).state, 'waiting_approval');
    const approval = f.host.runtime.listApprovals({taskId: f.taskId, state: 'pending'}).items[0];
    assert.equal(approval.approvalId, sourceApproval.approvalId); assert.equal(f.calls.sourceLinks, 0);
    f.host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
    snapshot = await f.host.resume(f.taskId);
    assert.equal(snapshot.state, unknown ? 'waiting_reconciliation' : 'succeeded');
    assert.equal(f.calls.sourceLinks, 1); assert.equal(f.calls.apply, 1); assert.equal(f.calls.modelCalls, 1);
    const records = f.host.runtime.readToolExecutions(f.taskId), original = records.find(record => record.toolName === 'synthetic.source.link');
    assert.ok(original); assert.equal(original.state, unknown ? 'unknown' : 'confirmed');
    const {createHash} = await import('node:crypto');
    assert.equal(f.calls.sourceArguments.workflowExecutionId, createHash('sha256').update(original.evidenceId).digest('hex'));
    assert.equal(f.calls.sourceArguments.expectedRunAttempt, 3);
    assert.equal(records.filter(record => record.toolName === 'workspace.git.commit').length, 1);
    if (!unknown) {
      assert.equal(f.host.readResult(f.taskId).sourceRunLink.conclusion, 'neutral');
      assert.equal(f.host.readResult(f.taskId).sourceRunLink.checkRunId, 11);
    }
    await f.restart();
    await assert.rejects(f.host.resume(f.taskId), /not ready to start/i);
    assert.equal(f.calls.sourceLinks, 1); assert.equal(f.calls.modelCalls, 1); assert.equal(f.calls.apply, 1);
  });
});

test('registered unknown repair candidates survive SQLite restart and support only an explicitly approved readback', async t => {
  const f = await patchFixture(t, {confirmApply: true, sourceRunBacklink: true, registeredSourceLink: 'gh'});
  let snapshot = f.host.runtime.getTask(f.taskId);
  for (let i = 0; snapshot.state === 'waiting_approval' && i < 32; i++) {
    assert.equal(f.host.readResult(f.taskId)?.sourceRunLinkHint, undefined);
    const approval = f.host.runtime.listApprovals({taskId: f.taskId, state: 'pending'}).items[0];
    f.host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
    snapshot = await f.host.resume(f.taskId);
  }
  assert.equal(snapshot.state, 'waiting_reconciliation');
  const hint = f.host.readResult(f.taskId).sourceRunLinkHint;
  assert.equal(hint.state, 'unverified'); assert.equal(hint.input.checkRunId, 11);
  assert.deepEqual(hint.input, {...f.calls.sourceArguments, checkRunId: 11});
  assert.equal(f.calls.sourceReadbacks, 0); assert.equal(f.calls.sourceLinks, 1);
  assert.equal(f.calls.checkGets, 1);
  assert.equal(f.host.readResult(f.taskId).sourceRunLink, undefined);
  await f.restart();
  assert.deepEqual(f.host.readResult(f.taskId).sourceRunLinkHint, hint);
  await assert.rejects(f.host.resume(f.taskId), /not ready to start/i);
  const readTask = f.host.submit({request: {kind: 'ci_link_readback', input: hint.input},
    conversationId: 'candidate-readback', idempotencyKey: 'candidate-check-11', deadline: new Date(Date.now() + 60_000).toISOString()});
  assert.equal((await f.host.start(readTask.taskId)).state, 'waiting_approval');
  assert.equal(f.calls.sourceReadbacks, 0);
  const approval = f.host.runtime.listApprovals({taskId: readTask.taskId, state: 'pending'}).items[0];
  assert.equal(approval.action, 'github.actions.repair.get');
  f.host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
  assert.equal((await f.host.resume(readTask.taskId)).state, 'succeeded');
  assert.equal(f.host.readResult(readTask.taskId).receipt.checkRunId, 11);
  assert.equal(f.host.runtime.getTask(f.taskId).state, 'waiting_reconciliation');
  assert.equal(f.calls.sourceReadbacks, 1); assert.equal(f.calls.sourceLinks, 1);
  assert.equal(f.calls.checkGets, 2);
  assert.equal(f.calls.apply, 1); assert.equal(f.calls.modelCalls, 1);
  assert.equal(f.host.runtime.readToolExecutions(f.taskId).filter(r => r.toolName === 'workspace.git.commit').length, 1);
  const key = `dev-repair-link-unknown:${hint.toolRunId}`;
  const original = f.host.runtime.loadCheckpoint(f.taskId, key);
  const savedResult = f.host.runtime.loadCheckpoint(f.taskId, 'dev-workflows-result-v1');
  f.host.runtime.saveCheckpoint(f.taskId, 'dev-workflows-result-v1', {...savedResult,
    sourceRunLinkHint: {state: 'unverified', toolRunId: 'unbound', input: {repo: 'other/repository', checkRunId: 999}}});
  for (const change of [{taskId: 'other-task'}, {toolRunId: 'other-run'}, {toolVersion: 'changed'},
    {argumentsDigest: '0'.repeat(64)}, {checkRunId: 0},
    {arguments: {...original.arguments, repo: 'other/repository'}},
    {arguments: {...original.arguments, workflowExecutionId: '0'.repeat(64)}},
    {arguments: {...original.arguments, sourceSha: 'f'.repeat(40)}}]) {
    f.host.runtime.saveCheckpoint(f.taskId, key, {...original, ...change});
    assert.equal(f.host.readResult(f.taskId).sourceRunLinkHint, undefined);
  }
  f.host.runtime.saveCheckpoint(f.taskId, key, original);
  assert.deepEqual(f.host.readResult(f.taskId).sourceRunLinkHint, hint);
  f.host.cancel(f.taskId, 'Explicit candidate task cancellation');
  assert.equal(f.host.readResult(f.taskId).sourceRunLinkHint, undefined);
});

test('unknown repair writes stay unknown without a usable candidate or when candidate persistence fails', async t => {
  for (const [name, options] of [['no ID', {candidateId: null}], ['invalid provider result', {invalidCandidate: true}],
    ['persistence failure', {candidatePersistenceFailure: true}], ['conflicting original candidate', {candidateConflict: true}]]) await t.test(name, async t => {
    const f = await patchFixture(t, {confirmApply: true, sourceRunBacklink: true, registeredSourceLink: true, ...options});
    let snapshot = f.host.runtime.getTask(f.taskId);
    for (let i = 0; snapshot.state === 'waiting_approval' && i < 32; i++) {
      const approval = f.host.runtime.listApprovals({taskId: f.taskId, state: 'pending'}).items[0];
      f.host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
      snapshot = await f.host.resume(f.taskId);
    }
    assert.equal(snapshot.state, 'waiting_reconciliation');
    assert.equal(f.host.readResult(f.taskId).sourceRunLinkHint, undefined);
    assert.equal(f.calls.sourceLinks, 1); assert.equal(f.calls.sourceReadbacks, 0);
    assert.equal(f.host.runtime.readToolExecutions(f.taskId).find(r => r.toolName === 'github.actions.repair.link').state, 'unknown');
    if (options.candidateConflict) {
      const original = f.host.runtime.readToolExecutions(f.taskId).find(r => r.toolName === 'github.actions.repair.link');
      const key = `dev-repair-link-unknown:${original.evidenceId}`;
      assert.equal(f.host.runtime.loadCheckpoint(f.taskId, key).checkRunId, 12);
      assert.equal(f.host.runtime.loadCheckpoint(f.taskId, key + ':conflict'), true);
    }
    await f.restart(); await assert.rejects(f.host.resume(f.taskId), /not ready to start/i);
    assert.equal(f.host.readResult(f.taskId).sourceRunLinkHint, undefined);
    assert.equal(f.calls.sourceLinks, 1); assert.equal(f.calls.modelCalls, 1); assert.equal(f.calls.apply, 1);
  });
});

test('each Runtime approval resumes the same precommit head read and reaches the original repair commit', async t => {
  const f = await patchFixture(t, {confirmApply: true});
  let snapshot = f.host.runtime.getTask(f.taskId);
  const pendingActions = [];
  for (let index = 0; snapshot.state === 'waiting_approval' && index < 32; index++) {
    const approval = f.host.runtime.listApprovals({taskId: f.taskId, state: 'pending'}).items[0];
    assert.ok(approval); pendingActions.push(approval.action);
    f.host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
    snapshot = await f.host.resume(f.taskId);
  }
  assert.equal(snapshot.state, 'succeeded', JSON.stringify({pendingActions, result: f.host.readResult(f.taskId)}));
  const records = f.host.runtime.readToolExecutions(f.taskId);
  assert.equal(records.filter(record => record.toolName === 'workspace.git.commit').length, 1);
  assert.equal(records.filter(record => record.toolName === 'workspace.git.head').length, 2);
  assert.equal(f.calls.apply, 1); assert.equal(f.host.readResult(f.taskId).status, 'succeeded');
});

test('applied workflow recovery persists the original result and resumes after restart', async t => {
  const f = await patchFixture(t); f.calls.outcome = 'applied';
  const recovered = await f.host.reconcileWorkspacePatchTask(f.taskId, f.runId);
  assert.equal(recovered.task.state, 'waiting_reconciliation');
  assert.equal(recovered.result.outcome, 'applied');
  assert.ok(recovered.receipt);
  assert.equal(f.calls.marker, false);
  assert.equal(f.calls.apply, 1);
  const record = f.host.runtime.readToolExecutions(f.taskId).find(item => item.evidenceId === f.runId);
  assert.equal(record.state, 'confirmed');
  assert.equal(record.reconciliationOutcome, 'applied');
  assert.ok(f.host.runtime.loadCheckpoint(f.taskId, `tool-result-${f.runId}`));

  await f.restart();
  const replay = await f.host.reconcileWorkspacePatchTask(f.taskId, f.runId);
  assert.ok(replay.receipt);
  let snapshot = await f.host.resumeConfirmed(f.taskId, replay.receipt);
  for (let index = 0; snapshot.state === 'waiting_approval' && index < 32; index++) {
    const approval = f.host.runtime.listApprovals({taskId: f.taskId, state: 'pending'}).items[0];
    assert.ok(approval);
    f.host.runtime.respondApproval(approval.approvalId, 'allow_once', approval.revision);
    snapshot = await f.host.resume(f.taskId);
  }
  assert.equal(snapshot.state, 'succeeded');
  assert.equal(f.host.readResult(f.taskId).status, 'succeeded');
  assert.equal(f.calls.apply, 1);
  assert.equal(f.host.runtime.readToolExecutions(f.taskId).filter(item => item.toolName === 'workspace.git.commit').length, 1);
});

test('not-applied readback persists the original failed run before acknowledging its marker', async t => {
  const f = await patchFixture(t); f.calls.outcome = 'not_applied';
  const observed = await f.host.reconcileWorkspacePatchTask(f.taskId, f.runId);
  assert.equal(observed.task.state, 'failed'); assert.equal(observed.receipt, undefined);
  assert.equal(f.calls.marker, false); assert.equal(f.calls.apply, 1);
  assert.equal(f.host.runtime.readToolExecutions(f.taskId).find(item => item.evidenceId === f.runId).reconciliationOutcome, 'not_applied');
  await f.restart(); await f.host.reconcileWorkspacePatchTask(f.taskId, f.runId);
  assert.equal(f.calls.apply, 1);
});

test('a reused readback object cannot rewrite the persisted outcome or return an applied receipt', async t => {
  const f = await patchFixture(t);
  f.calls.outcome = 'not_applied'; f.calls.reuseReadback = true; f.calls.mutateAcknowledgement = true;
  await assert.rejects(f.host.reconcileWorkspacePatchTask(f.taskId, f.runId), /marker changed before acknowledgement/);
  const saved = f.host.runtime.loadCheckpoint(f.taskId, `dev-patch-readback:${f.runId}`);
  assert.equal(saved.outcome, 'not_applied'); assert.equal(saved.currentSha256, saved.beforeSha256);
  assert.equal(f.calls.sharedReadback.outcome, 'applied');
  const core = f.host.runtime.loadCheckpoint(f.taskId, `tool-reconciliation-${f.runId}`);
  assert.deepEqual(core.result, saved);
  assert.equal(f.host.runtime.getTask(f.taskId).state, 'failed');
  assert.equal(f.host.runtime.readToolExecutions(f.taskId).find(item => item.evidenceId === f.runId).reconciliationOutcome, 'not_applied');
  // A port acknowledgement can remove its own marker; the original bound facts
  // must survive that removal and a restart without adopting its later mutation.
  await f.restart();
  const observed = await f.host.reconcileWorkspacePatchTask(f.taskId, f.runId);
  assert.deepEqual(observed.result, saved); assert.equal(observed.receipt, undefined);
  assert.equal(f.calls.apply, 1);
});

test('missing persisted patch observation prevents marker acknowledgement', async t => {
  const f = await patchFixture(t); f.calls.outcome = 'not_applied';
  const save = f.host.runtime.saveCheckpoint.bind(f.host.runtime);
  f.host.runtime.saveCheckpoint = (taskId, key, value) => {
    if (key !== `dev-patch-readback:${f.runId}`) save(taskId, key, value);
  };
  await assert.rejects(f.host.reconcileWorkspacePatchTask(f.taskId, f.runId), /persistence could not be read back/);
  assert.equal(f.calls.marker, true); assert.equal(f.calls.polls.length, 1);
  assert.equal(f.host.runtime.loadCheckpoint(f.taskId, `dev-patch-readback:${f.runId}`), undefined);
  assert.equal(f.calls.apply, 1);
});

test('a mismatched persisted core receipt prevents marker acknowledgement', async t => {
  const f = await patchFixture(t); f.calls.outcome = 'not_applied';
  const reconcile = f.host.runtime.reconcileToolExecution.bind(f.host.runtime);
  f.host.runtime.reconcileToolExecution = (taskId, runId, outcome, result) => {
    const task = reconcile(taskId, runId, outcome, result);
    f.host.runtime.saveCheckpoint(taskId, `tool-reconciliation-${runId}`, {result: {...result, path: 'another.js'}});
    return task;
  };
  await assert.rejects(f.host.reconcileWorkspacePatchTask(f.taskId, f.runId), /persistence could not be read back/);
  assert.equal(f.calls.marker, true); assert.equal(f.calls.polls.length, 1);
  assert.equal(f.calls.apply, 1);
});

test('workflow recovery rejects changed workspace, original inputs and absent markers', async t => {
  const f = await patchFixture(t); f.calls.bindingId = 'e'.repeat(64);
  await assert.rejects(f.host.reconcileWorkspacePatchTask(f.taskId, f.runId), /workspace/);
  assert.equal(f.calls.polls.length, 0); f.calls.bindingId = 'd'.repeat(64);
  const original = f.host.runtime.loadCheckpoint(f.taskId, `dev-patch-intent:${f.runId}`);
  f.host.runtime.saveCheckpoint(f.taskId, `dev-patch-intent:${f.runId}`, {...original,
    arguments: {...original.arguments, path: 'another.js'}});
  await assert.rejects(f.host.reconcileWorkspacePatchTask(f.taskId, f.runId), /input/);
  assert.equal(f.calls.polls.length, 0);
  f.host.runtime.saveCheckpoint(f.taskId, `dev-patch-intent:${f.runId}`, original); f.calls.marker = false;
  await assert.rejects(f.host.reconcileWorkspacePatchTask(f.taskId, f.runId), /marker is absent/);
  assert.equal(f.host.runtime.getTask(f.taskId).state, 'waiting_reconciliation'); assert.equal(f.calls.apply, 1);
});

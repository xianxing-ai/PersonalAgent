import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CrewError,
  CrewKernel,
  CREW_PARENT_AGENT_ID,
  MAX_AUTO_DISPATCHES_PER_ROOT_REQUEST,
  MAX_CONCURRENT_TASKS_PER_AGENT,
} from '../dist/index.js';

const root = fileURLToPath(new URL('../../../.cache/crew-tests/', import.meta.url));
mkdirSync(root, {recursive: true});
const dbFile = () => join(mkdtempSync(join(root, 'e2e-')), 'crew.sqlite');

function open(options = {}) {
  let clock = 1700000000000;
  const now = () => (clock += 1000);
  return CrewKernel.open(dbFile(), {...options, now: options.now ?? now});
}

test('端到端：父派两个子，子间互发消息并交接文件，父收到两份汇总回执', () => {
  const workspaceRoot = mkdtempSync(join(root, 'e2e-ws-'));
  const kernel = open({workspaceRoot});
  try {
    kernel.registerAgent({agentId: 'coder-x', displayName: '编码者', driver: 'codex', instructions: '完成编码并发布补丁。', workspacePath: '/workspace/crew/coder-x'});
    kernel.registerAgent({agentId: 'reviewer-y', displayName: '评审者', driver: 'opencode', instructions: '审查补丁并汇报结论。', workspacePath: '/workspace/crew/reviewer-y'});

    // 父在同一根请求下给两个子各派一个任务：正好用满每 agent 并发额度。
    assert.equal(MAX_CONCURRENT_TASKS_PER_AGENT, 2);
    // 根请求 id 由 store 依据 taskId 推导（root-<taskId>），调用方不能自报。
    kernel.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't-code', assignedAgentId: 'coder-x', goal: '生成修复补丁', timeoutMs: 600_000});
    kernel.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't-review', assignedAgentId: 'reviewer-y', goal: '审查补丁并给出结论', timeoutMs: 600_000});
    assert.deepEqual(kernel.listTasks({actorId: CREW_PARENT_AGENT_ID}).map(t => t.status), ['queued', 'queued']);

    // coder 领任务，把补丁写进共享目录并登记 SHA-256 清单。
    const codeInbox = kernel.receiveMessages('coder-x');
    assert.equal(codeInbox.length, 1);
    assert.equal(codeInbox[0].senderAgentId, CREW_PARENT_AGENT_ID);
    assert.equal(kernel.claimNextTask('coder-x').taskId, 't-code');
    const patchPath = kernel.resolveHandoffPath({actorId: 'coder-x', relativePath: 'patches/fix-0001.diff'});
    mkdirSync(dirname(patchPath), {recursive: true});
    writeFileSync(patchPath, 'patch body v1');
    const handoff = kernel.publishHandoff({actorId: 'coder-x', handoffId: 'handoff:fix-0001', filePath: 'patches/fix-0001.diff'});

    // coder → reviewer 子间消息：携带清单引用；hop 由 store 推导（新消息为 0），
    // 自报不属于自己任务的根请求会被拒绝。
    assert.throws(
      () => kernel.sendMessage({actorId: 'coder-x', fromAgentId: 'coder-x', toAgentId: 'reviewer-y', text: '请审查 fix-0001', rootRequestId: 'root-other'}),
      error => error instanceof CrewError && error.code === 'NOT_PERMITTED',
    );
    const sent = kernel.sendMessage({actorId: 'coder-x', fromAgentId: 'coder-x', toAgentId: 'reviewer-y', text: '请审查 fix-0001，清单已登记', expectsReply: true, attachmentRefs: [handoff.handoffId]});
    assert.equal(sent.hop, 0);

    // coder 按固定格式交回执，父即可收集该子任务的结果。
    kernel.submitReceipt({actorId: 'coder-x', taskId: 't-code', receipt: {status: 'succeeded', result: '补丁已发布到共享目录', evidenceRefs: [handoff.handoffId], unblock: ''}});
    const collectedCode = kernel.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't-code'});
    assert.equal(collectedCode.status, 'succeeded');
    assert.deepEqual([...collectedCode.receipt.evidenceRefs], ['handoff:fix-0001']);

    // reviewer 领任务，从子间消息里取清单引用并校验接收文件。
    const reviewInbox = kernel.receiveMessages('reviewer-y');
    assert.equal(reviewInbox.length, 2, 'the parent task message and coder’s message both sit in the mailbox');
    assert.equal(reviewInbox[1].senderAgentId, 'coder-x');
    assert.equal(kernel.claimNextTask('reviewer-y').taskId, 't-review');
    const delivery = kernel.receiveHandoff({actorId: 'reviewer-y', handoffId: reviewInbox[1].attachmentRefs[0]});
    assert.equal(delivery.handoff.sha256, handoff.sha256);
    // reviewer 用 reply 路径回 coder，再交自己的回执。
    kernel.replyToMessage({actorId: 'reviewer-y', inReplyToMessageId: reviewInbox[1].messageId, text: '已审查通过：补丁与清单一致'});
    kernel.submitReceipt({actorId: 'reviewer-y', taskId: 't-review', receipt: {status: 'succeeded', result: '补丁审查通过', evidenceRefs: ['handoff:fix-0001'], unblock: ''}});

    // 父收集全部汇总回执，且两个任务都已终结。
    const summary = kernel.listTasks({actorId: CREW_PARENT_AGENT_ID});
    assert.deepEqual(summary.map(t => [t.taskId, t.status]), [['t-code', 'succeeded'], ['t-review', 'succeeded']]);
    assert.deepEqual(summary.map(t => t.receipt.status), ['succeeded', 'succeeded']);
    assert.ok(summary.every(t => t.receipt.result), 'every receipt carries its result');
    assert.deepEqual(kernel.receiveParentNotifications({actorId: CREW_PARENT_AGENT_ID}), [], 'no timeout notifications when everything finished in time');
    const coderInbox = kernel.receiveMessages('coder-x');
    assert.equal(coderInbox.length, 2, 'coder’s mailbox keeps the parent task and reviewer’s reply (non-destructive read)');
    assert.equal(coderInbox[1].senderAgentId, 'reviewer-y');
    assert.equal(MAX_AUTO_DISPATCHES_PER_ROOT_REQUEST, 8);
  } finally { kernel.close(); }
});

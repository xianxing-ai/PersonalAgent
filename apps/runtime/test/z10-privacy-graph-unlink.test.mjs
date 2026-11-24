import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {openSqliteMemoryHost} from '@personal-agent/memory/sqlite';
import {TaskRuntime, verifyPhysicalErasureGraphUnlink} from '../dist/index.js';
import {createSqliteFactProjectionHost} from '../dist/application.js';

const memoryNamespace = 'synthetic-z10-memory';
const graphNamespace = 'synthetic-z10-graph';
const consumerKey = 'synthetic-z10-consumer';
const scope = () => ({
  deadline: new Date(Date.now() + 60_000).toISOString(),
  signal: new AbortController().signal,
});

test('SQLite physical erasure unlinks target and transitive dependents across restart without aliasing revisions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pa-z10-erasure-unlink-'));
  const memoryPath = join(directory, 'memory.sqlite');
  const runtimePath = join(directory, 'runtime.sqlite');
  let memory = openSqliteMemoryHost(memoryPath);
  let runtime = new TaskRuntime(runtimePath);
  try {
    memory.provision(memoryNamespace);
    const appendPublic = (factId, sourceRevision, summary, expectedFactRevision = null) =>
      memory.appendPublicSource(memoryNamespace, {
        vaultId: 'synthetic-demo',
        path: `${factId}.md`,
        factId,
        sourceRevision: sourceRevision.repeat(64),
        line: 1,
        summary,
        observedAt: '2026-10-01T00:00:00.000Z',
        validFrom: '2026-10-01T00:00:00.000Z',
        validUntil: '2027-10-01T00:00:00.000Z',
        expectedFactRevision,
        ...scope(),
      });

    appendPublic('secret/fact', 'a', 'Sensitive secret v1');
    appendPublic('unrelated/fact', 'b', 'Keep unrelated sibling');
    const host = createSqliteFactProjectionHost({memory, runtime, memoryNamespace, graphNamespace, consumerKey});
    await host.drain({limit: 10, maxBatches: 2, ...scope()});

    const coordination = runtime.bindCoordinationStore(graphNamespace);
    const receiptsBefore = host.listImpactReceipts({afterGraphRevision: 0, limit: 10});
    const secretNodeRef = receiptsBefore[0].projection.links.find(link => link.fact.id === 'secret/fact').node;
    const siblingNodeRef = receiptsBefore[0].projection.links.find(link => link.fact.id === 'unrelated/fact').node;

    // Derive goal -> plan chain on top of target node (graph revisions 3 and 4).
    const withGoal = coordination.append(2, {
      id: 'derived-goal',
      kind: 'goal',
      summary: 'Derived goal depending on secret',
      sourceRef: 'synthetic/goal',
      validFrom: '2026-10-01T00:00:00.000Z',
      validUntil: '2027-10-01T00:00:00.000Z',
      sensitivity: 'private',
      state: 'active',
      reason: 'Goal derives from target fact',
      dependencies: [secretNodeRef],
    });
    assert.equal(withGoal.revision, 3);
    coordination.append(3, {
      id: 'derived-plan',
      kind: 'plan',
      summary: 'Transitive plan depending on derived goal',
      sourceRef: 'synthetic/plan',
      validFrom: '2026-10-01T00:00:00.000Z',
      validUntil: '2027-10-01T00:00:00.000Z',
      sensitivity: 'private',
      state: 'active',
      reason: 'Plan derives transitively from target fact',
      dependencies: [{id: 'derived-goal', revision: 1}],
    });

    // Revise target fact once more so multiple versions (rev 1 & rev 5) are unlinked.
    appendPublic('secret/fact', 'c', 'Sensitive secret v2', 1);
    await host.drain({limit: 10, maxBatches: 2, ...scope()});

    const beforeErasure = coordination.read();
    assert.equal(beforeErasure.revision, 5);
    assert.equal(beforeErasure.history.length, 5);

    const operationId = 'z10-unlink-erase-1';
    memory.beginFactErasure(memoryNamespace, {factId: 'secret/fact', expectedRevision: 2, operationId, ...scope()});
    const inspection = await host.preflightErasure('secret/fact', scope());
    assert.equal(inspection.targetVersions, 2);
    assert.deepEqual(inspection.dependentNodes.map(n => n.id), ['derived-goal', 'derived-plan']);
    assert.deepEqual(inspection.untracedTextNodes, []);

    await host.resumeFactErasure({
      factId: 'secret/fact',
      expectedRevision: 2,
      operationId,
      expectedGraphRevision: inspection.graphRevision,
      ...scope(),
    });

    memory.close();
    runtime.close();

    // Restart readback from fresh SQLite connections.
    memory = openSqliteMemoryHost(memoryPath);
    runtime = new TaskRuntime(runtimePath);
    const restartedGraph = runtime.bindCoordinationStore(graphNamespace).read();
    assert.equal(restartedGraph.revision, 5);
    assert.deepEqual(restartedGraph.erasedGraphRevisions, [1, 3, 4, 5]);
    assert.deepEqual(restartedGraph.history.map(node => [node.id, node.graphRevision]), [[siblingNodeRef.id, 2]]);
    assert.equal(JSON.stringify(restartedGraph).includes('Sensitive secret'), false);
    assert.equal(JSON.stringify(restartedGraph).includes('derived-goal'), false);
    assert.equal(JSON.stringify(restartedGraph).includes('derived-plan'), false);

    const compliantReceipt = {
      receiptId: 'rcpt-z10-erase-1',
      namespace: graphNamespace,
      targetId: secretNodeRef.id,
      action: 'privacy_deletion',
      graphRevision: beforeErasure.revision,
      physicalErasure: true,
      erasedGraphRevisions: [1, 3, 4, 5],
      reason: 'Z-10 synthetic SQLite unlink readback test',
      timestamp: '2026-10-01T01:00:00.000Z',
      evidenceLevel: 'conditional',
    };
    const report = verifyPhysicalErasureGraphUnlink({
      before: beforeErasure,
      after: restartedGraph,
      targetId: secretNodeRef.id,
      receipt: compliantReceipt,
    });
    assert.equal(report.verified, true);
    assert.deepEqual(report.newlyErasedRevisions, [1, 3, 4, 5]);
    assert.deepEqual(report.totalErasedGraphRevisions, [1, 3, 4, 5]);
    assert.equal(report.remainingNodes, 1);

    // Subsequent appends stay strictly monotonic at revision 6 without aliasing erased slots [1, 3, 4, 5].
    appendPublic('fresh/after-erase', 'd', 'Fresh survivor after erasure');
    const hostAfter = createSqliteFactProjectionHost({memory, runtime, memoryNamespace, graphNamespace, consumerKey});
    await hostAfter.drain({limit: 10, maxBatches: 2, ...scope()});
    const afterAppend = runtime.bindCoordinationStore(graphNamespace).read();
    assert.equal(afterAppend.revision, 6);
    assert.deepEqual(afterAppend.erasedGraphRevisions, [1, 3, 4, 5]);
    assert.equal(afterAppend.history.at(-1).graphRevision, 6);

    // Negative failure paths: logical withdrawal, stale dependent link, and mismatched revisions must fail closed.
    assert.throws(() => verifyPhysicalErasureGraphUnlink({
      before: beforeErasure,
      after: restartedGraph,
      targetId: secretNodeRef.id,
      receipt: {
        receiptId: 'rcpt-withdrawal',
        namespace: graphNamespace,
        targetId: secretNodeRef.id,
        action: 'withdrawal',
        graphRevision: beforeErasure.revision,
        physicalErasure: false,
      },
    }), {code: 'INVALID_ARGUMENT'});

    assert.throws(() => verifyPhysicalErasureGraphUnlink({
      before: beforeErasure,
      after: restartedGraph,
      targetId: secretNodeRef.id,
      receipt: {...compliantReceipt, erasedGraphRevisions: [1, 3, 4]},
    }), {code: 'REVISION_CONFLICT'});

    assert.throws(() => verifyPhysicalErasureGraphUnlink({
      before: beforeErasure,
      after: beforeErasure,
      targetId: secretNodeRef.id,
      receipt: compliantReceipt,
    }), {code: 'REVISION_CONFLICT'});
  } finally {
    memory.close();
    runtime.close();
    await rm(directory, {recursive: true, force: true});
  }
});

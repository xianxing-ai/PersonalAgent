import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {Client} from '@personal-agent/client';
import {
  OwnedAgentOrchestrator,
  OwnedWorkflowEngine,
  createOwnedWorkflowAdapter,
  createOwnedWorkflowReceiptVerifier,
  deriveOwnedWorkflowKeys,
  getOwnedWorkflowTemplate,
} from '@personal-agent/agentarts';
import {FakeModelProvider} from '@personal-agent/models';
import {createAgentServer} from '@personal-agent/agentarts-runtime';
import {
  Z10_PRIORITY_WORKFLOW_IDS,
  createRuntimeApplication,
  createRuntimeF13DiagnosticControlHost,
  createRuntimeF13SystemProbeHost,
  createRuntimeF14DeviceControlHost,
  createRuntimeF14ObservationHost,
  createRuntimeF22ShadowObservationHost,
  createRuntimeF26DeploymentReadbackHost,
  createRuntimeF28NativeConfigHost,
  createRuntimeOwnedWorkflowHost,
  createRuntimeOwnedWorkflowImageAdapter,
  createZ10PriorityGraphProviders,
} from '@personal-agent/runtime/application';
import {createF09FeedGraphHost} from '../../apps/desktop/electron/f09-feed-graph-host.js';

const obj = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
});
const str = {type: 'string', minLength: 1, maxLength: 512};
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function approvePendingHostTasks(app, client, parentTaskId) {
  const hostTasks = app.runtime
    .listTasks({limit: 100})
    .items.filter(item => item.conversationId?.startsWith('host-tool:'));
  for (const hostTask of hostTasks) {
    const binding = app.runtime.loadCheckpoint(hostTask.taskId, 'coding-repair:parent');
    if (binding?.taskId !== parentTaskId) continue;
    const approvals = await client.call('approval.list', {taskId: hostTask.taskId});
    for (const approval of approvals.items) {
      if (approval.state === 'pending') {
        await client.call('authorization.respond', {
          approvalId: approval.approvalId,
          expectedRevision: approval.revision,
          decision: 'allow_once',
        });
      }
    }
  }
}

async function driveWorkflowToSettled({
  app,
  client,
  adapter,
  workflowId,
  input,
  tools,
  sessionId,
  executionEpoch = 0,
}) {
  const deadline = new Date(Date.now() + 60_000).toISOString();
  const rootTask = app.runtime.submitTask({
    goal: `Z10 priority graph ${workflowId}`,
    conversationId: `z10-conv-${workflowId}`,
    idempotencyKey: `z10-run-${workflowId}`,
  });
  const availableTools = tools.map(tool => ({
    name: tool.descriptor.name,
    version: tool.descriptor.version,
    inputSchema: tool.descriptor.inputSchema,
  }));

  let finalAdvance;
  const snap = await app.runtime.runTask(
    rootTask.taskId,
    async worker => {
      const bridge = createRuntimeOwnedWorkflowHost(app, {
        receiptSecret: await adapter.receiptSecret(worker.signal),
        parentTaskId: worker.taskId,
        assertActive: (taskId, controlRevision) => {
          const current = app.runtime.getTask(taskId);
          assert.ok(!current.cancelRequested);
          assert.ok(current.revision >= controlRevision);
        },
      });
      let checkpoint;
      let receipts = [];
      let round = 0;
      const trace = [];
      while (round < 20) {
        round += 1;
        const result = await adapter.advance(
          {
            workflowId,
            input,
            taskId: worker.taskId,
            controlRevision: 1,
            sessionId,
            requestId: `z10-${workflowId.toLowerCase()}-${round}`,
            deadline,
            taskDeadline: deadline,
            signal: worker.signal,
            availableTools,
            ...(checkpoint ? {checkpoint} : {}),
            ...(receipts.length ? {receipts} : {}),
          },
          {
            executionEpoch,
            assertCurrent: () => app.runtime.assertExecutionEpoch(worker.taskId, executionEpoch),
          },
        );
        checkpoint = result.checkpoint;
        trace.push(result.state);
        if (result.state === 'settled') {
          finalAdvance = {result, trace, taskId: worker.taskId};
          return {resultSummary: `${workflowId} settled`, evidenceRefs: []};
        }
        if (result.state === 'progress') {
          receipts = [];
          continue;
        }
        assert.equal(
          result.state,
          'awaiting_host',
          `${workflowId} expected awaiting_host, progress, or settled, got ${result.state}: ${JSON.stringify(result)}`,
        );
        const toolProposals = result.proposals.filter(item => item.kind === 'tool_proposal');
        assert.ok(toolProposals.length > 0, `${workflowId} awaiting_host without tool proposals: ${JSON.stringify(result.proposals)}`);
        const nextReceipts = [];
        for (const proposal of toolProposals) {
          const binding = {
            taskId: worker.taskId,
            sessionId,
            workflowId,
            controlRevision: 1,
            deadline,
          };
          const handle = bridge.submit(binding, proposal);
          for (let attempt = 0; attempt < 200; attempt += 1) {
            await approvePendingHostTasks(app, client, worker.taskId);
            const currentLocal = app.runtime.getTask(handle.localTaskId);
            if (['succeeded', 'failed', 'cancelled', 'waiting_reconciliation'].includes(currentLocal.state)) break;
            if (currentLocal.state === 'waiting_approval') {
              await new Promise(resolve => setTimeout(resolve, 5));
              continue;
            }
            await app.waitForHostToolTask(handle.localTaskId);
          }
          const localSnap = app.runtime.getTask(handle.localTaskId);
          const receipt = bridge.readReceipt(binding, proposal);
          assert.ok(
            receipt && receipt.state === 'confirmed',
            `${workflowId}:${proposal.nodeId} localState=${localSnap.state} localErr=${JSON.stringify(localSnap.error)} receiptState=${receipt?.state}`,
          );
          nextReceipts.push(receipt);
        }
        receipts = nextReceipts;
      }
      throw new Error(`${workflowId} did not settle within 20 rounds: ${JSON.stringify(trace)}`);
    },
    {deadline, sideEffect: 'local_write'},
  );
  assert.equal(snap.state, 'succeeded', `${workflowId} task failed: ${JSON.stringify(snap.error)}`);
  return finalAdvance;
}

test('28-graph wiring includes F20 coding.repair.trial and F24 recovery order before N02/N09', async () => {
  const wiringText = await readFile(new URL('../../docs/competition/workflow-wiring.json', import.meta.url), 'utf8');
  const wiring = JSON.parse(wiringText);
  assert.equal(wiring.workflows.length, 28);

  const f20 = getOwnedWorkflowTemplate('F20');
  const f20n03 = f20.nodes.find(node => node.id === 'F20_N03');
  assert.ok(f20n03);
  assert.deepEqual(f20n03.capabilities.map(cap => cap.name), ['coding.repair.trial']);

  const f24 = getOwnedWorkflowTemplate('F24');
  for (const target of ['F24_N02', 'F24_N09']) {
    const node = f24.nodes.find(item => item.id === target);
    assert.deepEqual(
      node?.dependencies.find(dep => dep.nodeId === 'F24_N11'),
      {nodeId: 'F24_N11', required: false},
      `${target} must depend on F24_N11`,
    );
  }
});

test('createZ10PriorityGraphProviders fails closed without ports and composes PR-#681 compatible entries when provided', () => {
  const failClosed = createZ10PriorityGraphProviders();
  assert.deepEqual(
    failClosed.map(item => item.workflowId),
    [...Z10_PRIORITY_WORKFLOW_IDS],
  );
  for (const provider of failClosed) {
    assert.equal(provider.available(), false);
    const composed = provider.compose({getApplication: () => ({runtime: null}), now: () => new Date()});
    assert.deepEqual(composed.tools, []);
    assert.equal(composed.entry, undefined);
    assert.deepEqual(composed.unavailable, [provider.unavailableReason]);
  }

  const dummyApp = createRuntimeApplication({path: ':memory:', profile: 'local'});
  try {
    const fakeWorkerImage = {
      bindingId: 'z10-provider-fixture-binding',
      advance: async () => ({workflowId: 'F20', workflowVersion: '1.0.0', state: 'settled', checkpoint: '1', nodes: {}, proposals: [], unavailable: []}),
      receiptSecret: async () => 'z10-provider-secret-at-least-32-chars',
    };
    const configuredF09 = {
      image: fakeWorkerImage,
      available: () => true,
      resolveInput: async () => ({subscriptionId: 'feed-1'}),
      assertCurrent: () => {},
      authorizeInput: async () => true,
      authorizeSource: async () => true,
      authorizeReceipt: async () => true,
      assertFrontier: () => true,
    };
    const configuredF20 = {
      image: fakeWorkerImage,
      available: () => true,
      resolveInput: async () => ({
        schemaFile: 'a.json',
        codeFile: 'a.ts',
        recipeId: 'r1',
        docTemplate: 'tpl',
        targetDoc: 'doc.md',
        sourceVersion: 'v1',
      }),
      assertCurrent: () => {},
      authorizeInput: async () => true,
      authorizeReceipt: async () => true,
      assertFrontier: () => true,
      authorizeExport: async () => true,
      verifyCompletion: async () => ({candidateDigest: sha('ok'), reviewReceiptDigest: sha('ok'), resultSummary: 'ok'}),
    };
    const configuredF26 = {
      workflowId: 'F26',
      toolName: 'workflow.f26.verify',
      toolVersion: '1.0.0',
      configurationVersion: '1.0.0',
      requestSchema: obj({operation: {const: 'verify'}}),
      inputSchema: obj({tag: str}),
      resultSchema: obj({ok: {type: 'boolean'}}),
      publicEnumPaths: [],
      requiredTools: [{name: 'workflow.host.f26_n03', version: '1.0.0'}],
      sideEffect: 'read',
      image: fakeWorkerImage,
      available: () => true,
      resolveInput: async () => ({tag: 'z10'}),
      assertCurrent: () => {},
      assertFrontier: () => true,
      authorizeExport: async () => true,
      verifyCompletion: async () => ({result: {ok: true}, resultSummary: 'ok'}),
    };
    const systemObserve = {
      descriptor: {
        name: 'computer.system.observe',
        version: '1.0.0',
        inputSchema: obj({}),
        outputSchema: obj({ok: {type: 'boolean'}}),
        sideEffect: 'read',
        requiredScopes: ['system:observe'],
        idempotencySupport: false,
        recoverySupport: false,
        requiresPresence: false,
      },
      execute: async () => ({ok: true}),
    };
    const browserObserve = {
      descriptor: {
        name: 'browser.observe',
        version: '1.0.0',
        inputSchema: obj({url: str}),
        outputSchema: obj({elementsFound: {type: 'integer'}}),
        sideEffect: 'read',
        requiredScopes: ['browser:observe'],
        idempotencySupport: false,
        recoverySupport: false,
        requiresPresence: false,
      },
      execute: async () => ({elementsFound: 1}),
    };
    const providers = createZ10PriorityGraphProviders({
      F09: {worker: configuredF09},
      F13: {
        systemProbe: {
          systemObserve,
          requiredScopes: ['workflow:diagnostics'],
          invokeSystemObserve: async () => ({ok: true}),
          resolveProbeOutcome: async () => ({cloudAlive: true, quotaNormal: true, staleLockFound: false}),
        },
        diagnosticControl: {
          recover: async () => ({lockReleased: true, taskResumed: true}),
        },
      },
      F14: {
        observation: {
          browserObserve,
          invokeObservation: async () => ({localTaskId: 't1', operationId: 'op1'}),
          authorizeExport: async () => true,
        },
        deviceControl: {
          invoke: async () => ({elementsFound: 1}),
          guard: async () => 'selected',
        },
      },
      F20: {worker: configuredF20},
      F22: {
        shadowObservation: {
          requiredScopes: ['workflow:shadow'],
          readVersionedSnapshot: async () => ({frozenComparisonInput: {case: 'z10'}}),
          authorizeExport: async () => true,
        },
      },
      F26: {
        deploymentReadback: {
          requiredScopes: ['workflow:deployment'],
          readDeploymentRuntime: async () => ({podRunning: true, readinessProbe: true}),
          authorizeExport: async () => true,
        },
        configuredWorker: configuredF26,
      },
      F28: {
        nativeConfig: {
          requiredScopes: ['workflow:native'],
          readNativeConfig: async (_scope, input) => ({check: input.check, research: true, analysis: true, coder: true}),
          authorizeExport: async () => true,
        },
      },
    });
    for (const provider of providers) {
      assert.equal(provider.available(), true, `${provider.workflowId} should be available`);
      const composed = provider.compose({
        getApplication: () => dummyApp,
        assertCurrent: () => {},
        now: () => new Date(),
      });
      assert.equal(composed.unavailable, undefined, `${provider.workflowId} should not report unavailable`);
      if (['F09', 'F20', 'F26'].includes(provider.workflowId)) {
        assert.ok(composed.entry?.name && composed.entry?.version, `${provider.workflowId} should publish entry`);
      }
      if (['F13', 'F14', 'F22', 'F26', 'F28'].includes(provider.workflowId)) {
        assert.ok(composed.tools.length > 0, `${provider.workflowId} should compose host tools`);
      }
    }
  } finally {
    dummyApp.close();
  }
});

test('Z-10 priority graphs F09/F13/F14/F15/F20/F22/F26/F28 execute end-to-end against live agentarts-runtime HTTP server with SQLite Runtime and executionEpochVersion=1', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'z10-image28-'));
  const authToken = 'z10-inbound-token-at-least-32-characters';
  const wssAuthToken = 'z10-wss-receipt-token-at-least-32-chars';
  const workflowKeys = deriveOwnedWorkflowKeys({transportToken: wssAuthToken});
  const readbacks = [];
  let app;

  const engine = new OwnedWorkflowEngine({
    externalHost: true,
    allowIsolatedProposals: true,
    selector: {select: async request => request.candidates[0].id},
    checkpointSecret: workflowKeys.checkpointKey,
    receiptVerifier: createOwnedWorkflowReceiptVerifier({secret: workflowKeys.receiptSecret}),
    prepareCandidates: async context => {
      const nodeId = context.node.id;
      const wfId = context.template.workflowId;
      const abstain = {id: 'review', description: 'Abstain for review', value: null, abstain: true};
      let value;
      switch (wfId) {
        case 'F13':
          if (nodeId === 'F13_N02') value = {arguments: {checks: ['cloud', 'quota', 'lock']}};
          else if (nodeId === 'F13_N03') {
            return [{
              id: 'recover',
              description: 'Execute confirmed lock recovery',
              value: {recover: true},
            }, abstain];
          } else if (nodeId === 'F13_N04') value = {arguments: {targetLock: 'lock-z10-1'}};
          break;
        case 'F14':
          if (nodeId === 'F14_N01') value = {arguments: {url: 'https://example.test/form'}};
          else if (nodeId === 'F14_N02') value = {arguments: {lockKey: 'desktop_input_lock'}};
          else if (nodeId === 'F14_N03') value = {arguments: {values: [{label: 'title', text: 'Z10-report'}]}};
          else if (nodeId === 'F14_N04') {
            return [{
              id: 'submit',
              description: 'Confirm and submit form',
              branches: [{nodeId: 'F14_N05', state: 'selected'}, {nodeId: 'F14_N06', state: 'selected'}],
              value: {submit: true},
            }, abstain];
          } else if (nodeId === 'F14_N05') value = {arguments: {question: 'Submit Z10 report?'}};
          else if (nodeId === 'F14_N06') value = {arguments: {clickTarget: 'submit-btn'}};
          break;
        case 'F15':
          if (nodeId === 'F15_N01') value = {toolName: 'workspace.read_text', toolVersion: '1.0.0', arguments: {path: 'src/app.ts'}};
          else if (nodeId === 'F15_N02') {
            return [{id: 'repair', description: 'Apply scoped repair', value: {repair: true}}, abstain];
          } else if (nodeId === 'F15_N04') value = {arguments: {path: 'src/app.ts'}};
          else if (nodeId === 'F15_N05') value = {arguments: {patchId: 'patch-f15-1'}};
          else if (nodeId === 'F15_N06') value = {arguments: {summary: 'F15 verified patch'}};
          break;
        case 'F20':
          if (nodeId === 'F20_N01') value = {toolName: 'workspace.read_text', toolVersion: '1.0.0', arguments: {path: 'docs/spec.md'}};
          else if (nodeId === 'F20_N02') {
            value = {version: 1, docMarkdown: '# Z10 Doc', sampleSnippet: 'const example: Record<string, string> = {};'};
          } else if (nodeId === 'F20_N03') {
            value = {toolName: 'coding.repair.trial', toolVersion: '1.0.0', arguments: {trialId: 'trial-f20-1'}};
          } else if (nodeId === 'F20_N04') {
            value = {version: 1, docMarkdown: '# Z10 Doc Verified', sampleSnippet: 'const verified: Record<string, string> = {};'};
          }
          break;
        case 'F22':
          if (nodeId === 'F22_N09') value = {arguments: {trigger: 'z10-shadow'}};
          else if (nodeId === 'F22_N01') value = {arguments: {}};
          else if (nodeId === 'F22_N02') {
            return [{
              id: 'replay-shadow',
              description: 'Run isolated trace replay shadow',
              branches: [
                {nodeId: 'F22_N03', state: 'skipped'},
                {nodeId: 'F22_N04', state: 'selected'},
                {nodeId: 'F22_N05', state: 'skipped'},
                {nodeId: 'F22_N06', state: 'selected'},
                {nodeId: 'F22_N07', state: 'selected'},
              ],
              value: {mode: 'trace_replay'},
            }, abstain];
          } else if (nodeId === 'F22_N04') value = {arguments: {traceId: 'trace-1'}};
          else if (nodeId === 'F22_N06') value = {arguments: {baselineId: 'base-1'}};
          break;
        case 'F26':
          if (nodeId === 'F26_N02') value = {arguments: {imageTag: 'personal-agent:z10'}};
          else if (nodeId === 'F26_N03') value = {arguments: {}};
          else if (nodeId === 'F26_N04') value = {arguments: {toolName: 'research.search'}};
          else if (nodeId === 'F26_N05') value = {arguments: {coverageDigest: 'cov-z10'}};
          break;
        case 'F28':
          if (nodeId === 'F28_N02') {
            return [{
              id: 'role-plan',
              description: 'Run native role plan without optional loop',
              branches: [{nodeId: 'F28_N03', state: 'selected'}, {nodeId: 'F28_N12', state: 'skipped'}],
              value: {plan: true},
            }, abstain];
          } else if (nodeId === 'F28_N03') value = {arguments: {check: 'models-z10'}};
          else if (nodeId === 'F28_N10') value = {arguments: {workspaceDigest: 'ws-z10'}};
          else if (nodeId === 'F28_N05') {
            return [{id: 'accept', description: 'Verify final completion', value: {accept: true}}, abstain];
          } else if (nodeId === 'F28_N11') value = {arguments: {finalDigest: 'final-z10'}};
          break;
        case 'F09':
          if (nodeId === 'F09_N01') value = {toolName: 'feeds.collect', toolVersion: '1.0.0', arguments: {subscriptionId: 'z10-feed'}};
          else if (nodeId === 'F09_N02') value = {arguments: {sourceOperationId: context.predecessorOperations?.F09_N01?.operationId}};
          else if (nodeId === 'F09_N03') {
            return [{id: 'enqueue', description: 'Route deduped signal to F10', value: {forwardToFeature: 'F10'}}, abstain];
          } else if (nodeId === 'F09_N04') value = {arguments: {signalCount: 1}};
          break;
      }
      if (value === undefined) value = {completed: true, nodeId};
      return [{id: 'supported', description: `Z10 advance ${nodeId}`, value}, abstain];
    },
  });

  const unused = new FakeModelProvider([]);
  const orchestrator = new OwnedAgentOrchestrator(
    {fast: unused, world: unused, plan: unused, review: unused},
    2048,
    undefined,
    undefined,
    engine,
  );
  const server = createAgentServer({
    mode: 'agentarts',
    authToken,
    wssAuthToken,
    orchestrator,
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  let adapter;
  t.after(async () => {
    app?.close();
    adapter?.close();
    await new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    });
    await rm(dir, {recursive: true, force: true});
  });

  const getApplication = () => app;
  const assertCurrent = () => {};
  const now = () => new Date();

  const systemObserve = {
    descriptor: {
      name: 'computer.system.observe',
      version: '1.0.0',
      inputSchema: obj({}),
      outputSchema: obj({ok: {type: 'boolean'}}),
      sideEffect: 'read',
      requiredScopes: ['system:observe'],
      idempotencySupport: false,
      recoverySupport: false,
      requiresPresence: false,
    },
    execute: async () => ({ok: true}),
  };
  const f13Probe = createRuntimeF13SystemProbeHost({
    getApplication,
    systemObserve,
    requiredScopes: ['system:observe'],
    invokeSystemObserve: async () => ({ok: true}),
    resolveProbeOutcome: async () => ({cloudAlive: true, quotaNormal: true, staleLockFound: true}),
    assertCurrent,
    now,
  });
  const f13Control = createRuntimeF13DiagnosticControlHost({
    getApplication,
    assertCurrent,
    recover: async () => ({lockReleased: true, taskResumed: true}),
    now,
  });
  const f14Device = createRuntimeF14DeviceControlHost({
    getApplication,
    assertCurrent,
    invoke: async nodeId => {
      if (nodeId === 'F14_N01') return {elementsFound: 3};
      if (nodeId === 'F14_N02') return {lockAcquired: true};
      if (nodeId === 'F14_N03') return {fieldsPopulated: 1};
      if (nodeId === 'F14_N05') return {confirmed: true};
      return {receiptId: 'f14-submit-1', lockReleased: true};
    },
    guard: async () => 'selected',
    now,
  });
  const feedsCollectTool = {
    descriptor: {
      name: 'feeds.collect',
      version: '1.0.0',
      sideEffect: 'read',
      requiredScopes: ['feeds:read'],
      inputSchema: obj({subscriptionId: str}),
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['items', 'hasMore', 'nextCursor'],
        properties: {
          items: {type: 'array', maxItems: 10, items: obj({id: str})},
          hasMore: {type: 'boolean'},
          nextCursor: {type: 'string'},
        },
      },
      idempotencySupport: false,
      recoverySupport: false,
      requiresPresence: false,
    },
    execute: async () => ({items: [{id: 'feed-item-1'}, {id: 'feed-item-1'}], hasMore: false, nextCursor: ''}),
  };

  const extraHostTools = [
    systemObserve,
    feedsCollectTool,
    {
      descriptor: {
        name: 'workspace.read_text',
        version: '1.0.0',
        sideEffect: 'read',
        requiredScopes: ['workspace:read'],
        inputSchema: obj({path: str}),
        outputSchema: obj({content: str}),
        idempotencySupport: true,
        recoverySupport: false,
        requiresPresence: false,
      },
      execute: async ({path: filePath}) => ({content: `content:${filePath}`}),
    },
    {
      descriptor: {
        name: 'coding.repair.trial',
        version: '1.0.0',
        sideEffect: 'local_write',
        requiredScopes: ['coding:trial'],
        inputSchema: obj({trialId: str}),
        outputSchema: obj({passed: {type: 'boolean'}}),
        idempotencySupport: true,
        recoverySupport: true,
        requiresPresence: false,
      },
      execute: async () => ({passed: true}),
    },
    ...f14Device.tools,
    createOwnedWorkflowAdapter({
      nodeId: 'F09_N04',
      kind: 'host',
      sideEffect: 'local_write',
      requiredScopes: ['feeds:enqueue'],
      inputSchema: obj({signalCount: {type: 'integer'}}),
      outputSchema: obj({queued: {type: 'boolean'}}),
      execute: async () => ({queued: true}),
    }),
    createOwnedWorkflowAdapter({
      nodeId: 'F15_N04',
      kind: 'host',
      sideEffect: 'read',
      requiredScopes: ['workspace:read'],
      inputSchema: obj({path: str}),
      outputSchema: obj({scopeReady: {type: 'boolean'}}),
      execute: async () => ({scopeReady: true}),
    }),
    createOwnedWorkflowAdapter({
      nodeId: 'F15_N05',
      kind: 'host',
      sideEffect: 'local_write',
      requiredScopes: ['workspace:write'],
      inputSchema: obj({patchId: str}),
      outputSchema: obj({applied: {type: 'boolean'}}),
      execute: async () => ({applied: true}),
    }),
    createOwnedWorkflowAdapter({
      nodeId: 'F15_N06',
      kind: 'host',
      sideEffect: 'local_write',
      requiredScopes: ['workspace:write'],
      inputSchema: obj({summary: str}),
      outputSchema: obj({delivered: {type: 'boolean'}}),
      execute: async () => ({delivered: true}),
    }),
    createOwnedWorkflowAdapter({
      nodeId: 'F22_N09',
      kind: 'host',
      sideEffect: 'read',
      requiredScopes: ['workflow:shadow'],
      inputSchema: obj({trigger: str}),
      outputSchema: obj({triggered: {type: 'boolean'}}),
      execute: async () => ({triggered: true}),
    }),
    createOwnedWorkflowAdapter({
      nodeId: 'F22_N04',
      kind: 'host',
      sideEffect: 'read',
      requiredScopes: ['workflow:shadow'],
      inputSchema: obj({traceId: str}),
      outputSchema: obj({replayed: {type: 'boolean'}}),
      execute: async () => ({replayed: true}),
    }),
    createOwnedWorkflowAdapter({
      nodeId: 'F22_N06',
      kind: 'host',
      sideEffect: 'read',
      requiredScopes: ['workflow:shadow'],
      inputSchema: obj({baselineId: str}),
      outputSchema: obj({status: str}),
      execute: async () => ({status: 'unknown'}),
    }),
    createOwnedWorkflowAdapter({
      nodeId: 'F26_N02',
      kind: 'host',
      sideEffect: 'local_write',
      requiredScopes: ['workflow:deployment'],
      inputSchema: obj({imageTag: str}),
      outputSchema: obj({built: {type: 'boolean'}}),
      execute: async () => ({built: true}),
    }),
    createOwnedWorkflowAdapter({
      nodeId: 'F26_N04',
      kind: 'host',
      sideEffect: 'read',
      requiredScopes: ['workflow:deployment'],
      inputSchema: obj({toolName: str}),
      outputSchema: obj({verified: {type: 'boolean'}}),
      execute: async () => ({verified: true}),
    }),
    createOwnedWorkflowAdapter({
      nodeId: 'F26_N05',
      kind: 'host',
      sideEffect: 'local_write',
      requiredScopes: ['workflow:deployment'],
      inputSchema: obj({coverageDigest: str}),
      outputSchema: obj({published: {type: 'boolean'}}),
      execute: async () => ({published: true}),
    }),
    createOwnedWorkflowAdapter({
      nodeId: 'F28_N02',
      kind: 'guard',
      sideEffect: 'read',
      requiredScopes: ['workflow:native'],
      inputSchema: {type: 'object'},
      outputSchema: obj({state: {const: 'selected'}}),
      execute: async () => ({state: 'selected'}),
    }),
    createOwnedWorkflowAdapter({
      nodeId: 'F28_N10',
      kind: 'host',
      sideEffect: 'read',
      requiredScopes: ['workflow:native'],
      inputSchema: obj({workspaceDigest: str}),
      outputSchema: obj({matched: {type: 'boolean'}}),
      execute: async () => ({matched: true}),
    }),
    createOwnedWorkflowAdapter({
      nodeId: 'F28_N11',
      kind: 'host',
      sideEffect: 'read',
      requiredScopes: ['workflow:native'],
      inputSchema: obj({finalDigest: str}),
      outputSchema: obj({completed: {type: 'boolean'}}),
      execute: async () => ({completed: true}),
    }),
  ];

  // Compose Z-10 priority hosts directly via createZ10PriorityGraphProviders (matching PR #681)
  const providers = createZ10PriorityGraphProviders({
    F13: {
      systemProbe: {
        systemObserve,
        requiredScopes: ['system:observe'],
        invokeSystemObserve: async () => ({ok: true}),
        resolveProbeOutcome: async () => ({cloudAlive: true, quotaNormal: true, staleLockFound: true}),
      },
      diagnosticControl: {recover: async () => ({lockReleased: true, taskResumed: true})},
    },
    F22: {
      shadowObservation: {
        requiredScopes: ['workflow:shadow'],
        readVersionedSnapshot: async () => ({frozenComparisonInput: {case: 'z10-live'}}),
        authorizeExport: async () => true,
      },
    },
    F26: {
      deploymentReadback: {
        requiredScopes: ['workflow:deployment'],
        readDeploymentRuntime: async () => ({podRunning: true, readinessProbe: true}),
        authorizeExport: async () => true,
      },
    },
    F28: {
      nativeConfig: {
        requiredScopes: ['workflow:native'],
        readNativeConfig: async (_scope, input) => ({check: input.check, research: true, analysis: true, coder: true}),
        authorizeExport: async () => true,
      },
    },
  });

  // Boot temporary app to obtain F09 host tool cleanly using the actual app reference
  const placeholderTools = [
    ...extraHostTools,
    ...f13Probe.tools,
    ...f13Control.tools,
  ];
  const f09Host = createF09FeedGraphHost({
    getApplication,
    collectTool: feedsCollectTool,
    assertFeedAccess: async () => true,
  });
  const lazyRuntime = new Proxy(
    {},
    {
      get(_target, prop) {
        const rt = getApplication().runtime;
        const val = Reflect.get(rt, prop, rt);
        return typeof val === 'function' ? val.bind(rt) : val;
      },
    },
  );
  const lazyApplication = {runtime: lazyRuntime};
  const f22Host = createRuntimeF22ShadowObservationHost({
    application: lazyApplication,
    requiredScopes: ['workflow:shadow'],
    readVersionedSnapshot: async () => ({frozenComparisonInput: {case: 'z10-live'}}),
    authorizeExport: async () => true,
    assertCurrent,
    now,
  });
  const f26Host = createRuntimeF26DeploymentReadbackHost({
    application: lazyApplication,
    requiredScopes: ['workflow:deployment'],
    readDeploymentRuntime: async () => ({podRunning: true, readinessProbe: true}),
    authorizeExport: async () => true,
    assertCurrent,
    now,
  });
  const f28Host = createRuntimeF28NativeConfigHost({
    application: lazyApplication,
    requiredScopes: ['workflow:native'],
    readNativeConfig: async (_scope, input) => ({check: input.check, research: true, analysis: true, coder: true}),
    authorizeExport: async () => true,
    assertCurrent,
    now,
  });

  assert.equal(f09Host.unavailable, null);
  assert.equal(f13Probe.unavailable, null);
  assert.equal(f22Host.unavailable, null);
  assert.equal(f26Host.unavailable, null);
  assert.equal(f28Host.unavailable, null);
  assert.ok(providers.some(p => p.workflowId === 'F13' && p.available()));

  const allTools = [
    ...placeholderTools,
    ...f09Host.tools,
    ...f22Host.tools,
    ...f26Host.tools,
    ...f28Host.tools,
  ];
  app = createRuntimeApplication({
    path: path.join(dir, 'z10-image28.sqlite'),
    profile: 'huawei_ict_agentarts',
    hostUserNamespace: 'z10-image28-owner',
    coordinationBinding: 'z10-local-agentarts-server',
    tools: allTools,
  });

  adapter = createRuntimeOwnedWorkflowImageAdapter({
    gatewayUrl: 'https://synthetic-agentarts.test',
    runtimeName: 'owned',
    deploymentVersion: 'z10-v1',
    authorizationProvider: {read: async () => `Bearer ${authToken}`},
    websocketAuthorizationProvider: {read: async () => `Bearer ${wssAuthToken}`},
    fetchImpl: async (url, init) => {
      const target = new URL(String(url));
      return fetch(`http://127.0.0.1:${port}/invocations${target.search}`, init);
    },
    onInvocationReadback: value => readbacks.push(value),
  });

  const client = new Client(app);
  await client.connect();

  const cases = [
    {workflowId: 'F13', input: {symptom: 'stalled'}},
    {workflowId: 'F14', input: {target: 'web-form'}},
    {workflowId: 'F15', input: {issue: 'null-guard'}},
    {workflowId: 'F20', input: {spec: 'docs/spec.md'}},
    {workflowId: 'F22', input: {baseline: 'v1'}},
    {workflowId: 'F26', input: {release: 'z10'}},
    {workflowId: 'F28', input: {task: 'multi-role'}},
    {workflowId: 'F09', input: {subscriptionId: 'z10-feed'}},
  ];

  for (const item of cases) {
    const settled = await driveWorkflowToSettled({
      app,
      client,
      adapter,
      workflowId: item.workflowId,
      input: item.input,
      tools: allTools,
      sessionId: `z10-sess-${item.workflowId.toLowerCase()}`,
      executionEpoch: 0,
    });
    assert.equal(settled.result.state, 'settled', `${item.workflowId} did not settle`);
  }
  assert.ok(readbacks.some(item => item.workflowId === 'F26' && item.transport === 'https'));

  // Verify stale executionEpoch is fenced with REVISION_CONFLICT over real server response
  const staleTask = app.runtime.submitTask({
    goal: 'Z10 stale epoch fence check',
    conversationId: 'z10-stale-conv',
    idempotencyKey: 'z10-stale-epoch',
  });
  app.runtime.advanceExecutionEpoch(staleTask.taskId, {requestId: 'z10-stop', reason: 'stop'});
  const available = allTools.map(tool => ({
    name: tool.descriptor.name,
    version: tool.descriptor.version,
    inputSchema: tool.descriptor.inputSchema,
  }));
  await assert.rejects(
    adapter.advance(
      {
        workflowId: 'F13',
        input: {symptom: 'stale'},
        taskId: staleTask.taskId,
        controlRevision: 1,
        sessionId: 'z10-sess-stale',
        requestId: 'z10-f13-stale',
        deadline: new Date(Date.now() + 60_000).toISOString(),
        signal: new AbortController().signal,
        availableTools: available,
      },
      {
        executionEpoch: 0,
        assertCurrent: () => app.runtime.assertExecutionEpoch(staleTask.taskId, 0),
      },
    ),
    {code: 'REVISION_CONFLICT'},
  );
});

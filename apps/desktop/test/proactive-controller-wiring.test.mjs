/**
 * Desktop proactive host must forward a production controller consumer
 * into createProactiveWorkflowHost (not leave controller_consumer unavailable).
 * Without controller, composition must omit the option (honest unavailable).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDesktopProactiveWorkflowApplication} from '../electron/proactive-workflow-host.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const deadline = () => new Date(Date.now() + 60_000).toISOString();

function fixture({controller} = {}) {
  const captured = [];
  const taskDeadline = deadline();
  const contractRef = 'contract-1';
  const adapter = {
    endpoint: 'https://example.test',
    config: {
      gatewayUrl: 'https://example.test',
      runtimeName: 'pa',
      deploymentVersion: 'v1',
    },
  };
  const imageBinding = digest({
    contractRef,
    gatewayUrl: adapter.config.gatewayUrl,
    runtimeName: adapter.config.runtimeName,
    deploymentVersion: adapter.config.deploymentVersion,
    invokeMode: 'published',
    workflowGoalInput: undefined,
  });
  const application = {
    runtime: {
      loadCheckpoint: () => ({
        version: 1,
        taskId: 'task-1',
        sessionId: 'session-1',
        taskDeadline,
        contractRef,
        contractVersion: '1',
        sourceTaskId: 'source-1',
        imageBinding,
      }),
      getTask: () => ({state: 'running'}),
      listTaskCheckpointPage: () => ({items: [], snapshotSequence: 0}),
    },
    createProactiveWorkflowHost: options => {
      captured.push(options);
      return {
        binding: {controlRevision: 0},
        subscribe: () => {},
        inspect: () => ({application: {state: {lastResult: null}}}),
      };
    },
    resumeProactiveTask: () => {},
  };
  const host = createDesktopProactiveWorkflowApplication({
    application,
    readConfiguration: () => ({contractRef, adapter}),
    ...(controller ? {controller} : {}),
    localDeviceAvailable: () => true,
    createAdapter: () => ({
      describe: async () => ({contracts: [{id: contractRef, version: '1'}]}),
      advancePort: async () => ({}),
      verifyAdvance: async () => true,
      sign: (kind, value) => value,
    }),
  });
  return {host, captured, taskDeadline};
}

test('optional controller is passed through to Runtime proactive host options', async () => {
  const controller = {
    consume: async report => ({action: 'request_controller', receiptRef: 'fixture:' + report.eventId}),
    readReceipt: async () => undefined,
  };
  const {host, captured} = fixture({controller});
  await host.acquireMaintenance('task-1', {deadline: deadline(), signal: new AbortController().signal});
  assert.equal(captured.length, 1);
  assert.equal(captured[0].controller, controller);
  assert.equal(typeof captured[0].controller.consume, 'function');
  assert.equal(typeof captured[0].controller.readReceipt, 'function');
});

test('without controller, composition must not invent a Fake consumer', async () => {
  const {host, captured} = fixture();
  await host.acquireMaintenance('task-1', {deadline: deadline(), signal: new AbortController().signal});
  assert.equal(captured.length, 1);
  assert.equal('controller' in captured[0], false);
  assert.equal(captured[0].controller, undefined);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDesktopWorkflowGraphComposition} from '../electron/workflow-graph-composition.js';
import {createImageWorkflowCatalogHost} from '../electron/image-workflow-catalog.js';

test('registered mail and local observation tools do not substitute for trusted graph ports', () => {
  let factories = 0;
  const runtimeModule = {
    createRuntimeF08OperationScopeHost: () => { factories++; return {tools: [{descriptor: {name: 'workflow.host.f08_n10'}}]}; },
    createRuntimeF13SystemProbeHost: () => { factories++; return {tools: [{descriptor: {name: 'workflow.host.f13_n02'}}]}; },
  };
  const composed = createDesktopWorkflowGraphComposition({
    runtimeModule,
    getApplication: () => ({}),
    mailHost: {tools: [{descriptor: {name: 'mail.inbox'}}]},
    systemObserveTool: {descriptor: {name: 'computer.system.observe', requiredScopes: ['computer:system:read']}, execute: () => assert.fail('direct execute')},
  });
  assert.equal(factories, 0);
  assert.deepEqual(composed.tools, []);
  assert.ok(composed.unavailable.includes('f08_operation_scope_mail_host_unavailable'));
  assert.ok(composed.unavailable.includes('f13_system_probe_observation_unavailable'));
  composed.close();
});

test('graph composition forwards trusted operation checks and gateway invocation without fabricating probe facts', async () => {
  let mail, probe, cancelled = false;
  const runtimeModule = {
    createRuntimeF08OperationScopeHost: options => { mail = options; return {tools: []}; },
    createRuntimeF13SystemProbeHost: options => { probe = options; return {tools: []}; },
  };
  const verifyMailOperationScope = async () => ({ready: false, blockingReason: 'exact_scope_denied'});
  const invokeSystemObserve = async () => ({cpu: 1});
  const resolveSystemProbeOutcome = async () => { throw Error('cloud probe unavailable'); };
  const composed = createDesktopWorkflowGraphComposition({
    runtimeModule,
    getApplication: () => ({runtime: {getTask: () => ({state: 'running', cancelRequested: cancelled})}}),
    mailHost: {tools: [{descriptor: {name: 'mail.inbox'}}]}, verifyMailOperationScope,
    systemObserveTool: {descriptor: {name: 'computer.system.observe', requiredScopes: ['computer:system:read']}},
    invokeSystemObserve, resolveSystemProbeOutcome,
  });
  assert.equal(mail.verifyOperationScope, verifyMailOperationScope);
  assert.equal(probe.invokeSystemObserve, invokeSystemObserve);
  assert.equal(probe.resolveProbeOutcome, resolveSystemProbeOutcome);
  const scope = {parentTaskId: 'parent', localTaskId: 'child'};
  mail.assertCurrent(scope); probe.assertCurrent(scope);
  cancelled = true;
  assert.throws(() => mail.assertCurrent(scope), /no longer current/);
  assert.throws(() => probe.assertCurrent(scope), /no longer current/);
  composed.close();
});

test('dynamic graphProviders register trusted entries and tools into image-workflow-catalog while failing closed on missing ports (S531-L1)', () => {
  let disposed = 0;
  const composed = createDesktopWorkflowGraphComposition({
    runtimeModule: {},
    getApplication: () => ({runtime: {getTask: () => ({state: 'running', cancelRequested: false})}}),
    graphProviders: [
      {
        workflowId: 'F20',
        available: () => true,
        compose: () => ({
          entry: {name: 'workflow.f20.entry', version: '1.0.0'},
          tools: [{descriptor: {name: 'workflow.f20.entry', version: '1.0.0'}}],
          competitionToolAvailability: [{toolName: 'workflow.f20.entry', toolVersion: '1.0.0', available: () => true}],
          competitionToolExports: [{toolName: 'workflow.f20.entry', toolVersion: '1.0.0'}],
          close: () => { disposed += 1; },
        }),
      },
      {
        workflowId: 'F09',
        available: () => false,
        unavailableReason: 'f09_feed_host_unavailable',
        compose: () => assert.fail('unavailable provider must not compose'),
      },
      {
        workflowId: 'F17',
        available: () => true,
        compose: () => ({
          // Claiming an entry without actually producing the matching tool descriptor must not publish it.
          entry: {name: 'workflow.f17.forged', version: '1.0.0'},
          tools: [],
          unavailable: 'f17_entry_tool_missing',
        }),
      },
    ],
  });
  assert.deepEqual(composed.workflowEntries.F20, {name: 'workflow.f20.entry', version: '1.0.0'});
  assert.equal(composed.workflowEntries.F09, undefined);
  assert.equal(composed.workflowEntries.F17, undefined);
  assert.ok(composed.unavailable.includes('f09_feed_host_unavailable'));
  assert.ok(composed.unavailable.includes('f17_entry_tool_missing'));
  assert.equal(composed.competitionToolAvailability.length, 1);
  assert.equal(composed.competitionToolExports.length, 1);

  const descriptors = [
    ...composed.tools.map(tool => tool.descriptor),
    {name: 'workspace.read_text', version: '1.0.0'},
    {name: 'workspace.run_allowed_command', version: '1.0.0'},
  ];
  const catalog = createImageWorkflowCatalogHost({
    getApplication: () => ({runtime: {}, tools: {list: () => descriptors}}),
    readWorkflowEntries: () => composed.workflowEntries,
  });
  try {
    const f20 = catalog.snapshot({workflowId: 'F20'}).workflows[0];
    assert.equal(f20.state, 'entry_registered_requires_task_authorization');
    assert.equal(f20.entry.name, 'workflow.f20.entry');
    const f09 = catalog.snapshot({workflowId: 'F09'}).workflows[0];
    assert.equal(f09.state, 'unavailable');
    assert.ok(f09.unavailableReasons.includes('conversation_entry_not_registered'));
  } finally {
    catalog.close();
  }

  composed.close();
  composed.close();
  assert.equal(disposed, 1, 'close() must dispose each graph provider once');

  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  assert.match(main, /createDesktopWorkflowGraphComposition\(/);
  assert.match(main, /readWorkflowEntries:\(\)=>workflowGraphComposition\?\.workflowEntries/);
  assert.match(main, /workflowGraphComposition\?\.close\?\.\(\)/);
});

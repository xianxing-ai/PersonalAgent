import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import {
  createAgentArtsRuntimeApplication,
  createRuntimeOwnedWorkflowTools,
} from '@personal-agent/runtime/application';
import {resolveDesktopWorkflowShadowRelease} from '../electron/workflow-shadow-release-host.js';

const F23 = ['workflow.host.f23_n04', 'workflow.host.f23_n05'];

function trustedBinding(overrides = {}) {
  const port = {
    async read() { return undefined; },
    async readOperation() { return {state: 'not_started'}; },
    async compareAndSet() { return {state: 'rejected', reason: 'test-only'}; },
  };
  return {
    sideEffect: 'local_write',
    requiredScopes: ['configuration:test-only'],
    configurationPort: port,
    acceptance: {
      policyId: 'fixture',
      revision: 1,
      configurationId: 'fixture-config',
      taskClass: 'fixture-class',
      validFrom: new Date(0).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      baseline: {
        revision: 1,
        version: 'v1',
        parametersDigest: 'a'.repeat(64),
        resultBaselineSha256: 'b'.repeat(64),
      },
      candidate: {version: 'v2', parametersDigest: 'c'.repeat(64)},
      conditionsDigest: 'd'.repeat(64),
      qualityMetricId: 'fixture-quality',
      metricRules: [{metric: 'qualityScore', bound: 'min_delta', value: 0}],
      requiredChecks: ['unit'],
    },
    verifyBranch: async () => true,
    verifyComparable: async () => true,
    verifyTestEvidence: async () => true,
    ...overrides,
  };
}

test('host factory stays unavailable without complete trusted ports; never invents Fake', () => {
  assert.equal(resolveDesktopWorkflowShadowRelease(), undefined);
  assert.equal(resolveDesktopWorkflowShadowRelease(undefined), undefined);
  assert.equal(resolveDesktopWorkflowShadowRelease({}), undefined);
  assert.equal(resolveDesktopWorkflowShadowRelease({
    sideEffect: 'local_write',
    requiredScopes: ['configuration:test-only'],
  }), undefined);
  assert.equal(resolveDesktopWorkflowShadowRelease({
    ...trustedBinding(),
    configurationPort: {read: async () => undefined},
  }), undefined);
  assert.equal(resolveDesktopWorkflowShadowRelease({
    ...trustedBinding(),
    verifyComparable: undefined,
  }), undefined);
});

test('complete trusted binding resolves options that register F23 write and readback tools', () => {
  const options = resolveDesktopWorkflowShadowRelease(trustedBinding());
  assert.ok(options);
  assert.equal(options.sideEffect, 'local_write');
  const empty = createRuntimeOwnedWorkflowTools({});
  assert.deepEqual(empty, []);
  const tools = createRuntimeOwnedWorkflowTools({shadowRelease: options});
  assert.deepEqual(tools.map(tool => tool.descriptor.name), F23);
  assert.deepEqual(tools.map(tool => tool.descriptor.sideEffect), ['local_write', 'read']);
});

test('Competition application registers F23 only when workflowShadowRelease is injected', () => {
  const cloud = {
    gatewayUrl: 'https://agentarts.example.test',
    runtimeName: 'shadow-release-fixture',
    authorizationProvider: {read: async () => 'Bearer synthetic-no-real-credential'},
  };
  const without = createAgentArtsRuntimeApplication({path: ':memory:', ...cloud});
  try {
    assert.ok(!without.tools?.list().some(tool => F23.includes(tool.name)));
  } finally {
    without.close();
  }

  const options = resolveDesktopWorkflowShadowRelease(trustedBinding());
  const withRelease = createAgentArtsRuntimeApplication({
    path: ':memory:',
    ...cloud,
    hostUserNamespace: 'synthetic-shadow-release',
    workflowShadowRelease: options,
  });
  try {
    const names = withRelease.tools.list().map(tool => tool.name);
    assert.ok(F23.every(name => names.includes(name)));
  } finally {
    withRelease.close();
  }
});

test('Desktop Competition composition optionally spreads resolved workflowShadowRelease', async () => {
  const source = await readFile(new URL('../electron/main.js', import.meta.url), 'utf8');
  assert.match(source, /resolveDesktopWorkflowShadowRelease/);
  assert.match(source, /\.\.\.\(workflowShadowRelease\s*\?\s*\{workflowShadowRelease\}\s*:\s*\{\}\)/);
  const ast = ts.createSourceFile('main.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let composition;
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'createAgentArtsRuntimeApplication') {
      assert.equal(composition, undefined, 'Desktop has one Competition composition');
      composition = node.arguments[0];
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(composition && ts.isObjectLiteralExpression(composition));
  const texts = composition.properties.map(property => property.getText(ast));
  assert.ok(texts.some(text => /workflowShadowRelease/.test(text)),
    'createAgentArtsRuntimeApplication must receive optional workflowShadowRelease');
});

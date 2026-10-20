import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// publish() runs on every runtime event and on the 120 ms poll. The orb and the panel read the same
// 'panel' surface, so each broadcast must build that surface once instead of once per window.

const source = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let publishSource;
(function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'publish') publishSource = node.getText(ast);
  ts.forEachChild(node, visit);
})(ast);

function run(t) {
  const sent = [];
  const surfaces = [];
  const window = name => ({name, isDestroyed: () => false, webContents: {send: (channel, payload) => sent.push({name, channel, payload})}});
  const context = vm.createContext({
    runtimeClosed: false,
    orb: window('orb'),
    panel: window('panel'),
    admin: window('admin'),
    workspace: window('workspace'),
    subagentWindows: new Map(),
    snapshot(surface) {
      surfaces.push(surface);
      return {surface, tasks: []};
    },
  });
  vm.runInContext(publishSource, context);
  return {context, sent, surfaces};
}

test('one broadcast builds each surface once even when four windows are open', t => {
  const {context, sent, surfaces} = run(t);
  vm.runInContext('publish()', context);

  assert.deepEqual(surfaces, ['panel', undefined, 'workspace'], 'orb and panel share a single panel build');
  assert.deepEqual(sent.map(item => item.name), ['orb', 'panel', 'admin', 'workspace'], 'every open window still receives an update');
  assert.equal(sent.every(item => item.channel === 'desktop:update'), true);
  assert.equal(sent[0].payload, sent[1].payload, 'orb and panel receive the same built snapshot');
  assert.notEqual(sent[0].payload, sent[2].payload, 'a different surface is a different build');
  assert.equal(sent[2].payload.surface, undefined);
  assert.equal(sent[3].payload.surface, 'workspace');
});

test('a destroyed window neither receives an update nor forces a build', t => {
  const {context, sent, surfaces} = run(t);
  context.admin.isDestroyed = () => true;
  vm.runInContext('publish()', context);

  assert.deepEqual(surfaces, ['panel', 'workspace'], 'the admin-only surface is not built when admin is gone');
  assert.deepEqual(sent.map(item => item.name), ['orb', 'panel', 'workspace']);
});

test('a closed runtime publishes nothing at all', t => {
  const {context, sent, surfaces} = run(t);
  context.runtimeClosed = true;
  vm.runInContext('publish()', context);

  assert.deepEqual(surfaces, []);
  assert.deepEqual(sent, []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {Orb} from '../src/features/orb/orb.js';
import {visualOrbState} from '../src/features/conversation/state.js';

const source = await readFile(new URL('../src/features/workspace/view.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('view.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let motion, visibility, update;
const registrations = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'syncMotion') motion = node.initializer.getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'visibility') visibility = node.initializer.getText(ast);
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'update') {
    const statements = [...node.body.statements];
    const index = statements.findIndex(item => item.getText(ast).startsWith('orb.setLevel('));
    assert.ok(index >= 0);
    const selected = statements.slice(index, index + 2);
    if (ts.isIfStatement(statements[index + 2]) && statements[index + 2].expression.getText(ast) === 'document.hidden') selected.push(statements[index + 2]);
    update = selected.map(item => item.getText(ast)).join('\n');
  }
  if (ts.isExpressionStatement(node) && /^(window|document)\.addEventListener\(/.test(node.getText(ast)) && /'preferences-changed'|'visibilitychange'|'unload'/.test(node.getText(ast))) registrations.push(node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(motion && visibility && update);
assert.equal(registrations.length, 3);
function fixture() {
  const listeners = new Map(), cleared = [];
  const target = name => ({addEventListener: (event, fn) => listeners.set(`${name}:${event}`, fn), removeEventListener: (event, fn) => {
    if (listeners.get(`${name}:${event}`) === fn) listeners.delete(`${name}:${event}`);
  }});
  const orb = Object.assign(Object.create(Orb.prototype), {state: 'idle', calm: false, running: true, mix: 1, time: 10, breathUntil: null,
    start() { if (!this.calm) this.running = true; }, _draw() {}, _params() { return {}; }, _observer: {disconnect() { cleared.push('observer'); }},
  });
  const document = Object.assign(target('document'), {hidden: false, documentElement: {dataset: {calm: 'false'}}});
  const context = vm.createContext({orb, document, window: target('window'), visualOrbState, activationTimer: 42, clearTimeout: timer => cleared.push(timer)});
  vm.runInContext(`const syncMotion=${motion};const visibility=${visibility};${registrations.join('\n')}`, context);
  const dispatch = (name, event) => listeners.get(`${name}:${event}`)?.();
  const render = vm.runInContext(`data=>{${update}}`, context);
  return {orb, document, listeners, cleared, render, dispatch};
}

test('hidden subscribed Task and Live updates keep the real visual state without restarting animation', () => {
  const f = fixture(); f.document.hidden = true; f.dispatch('document', 'visibilitychange');
  for (const data of [{tasks: [{taskId: 'fake', state: 'waiting_approval'}]}, {tasks: [{taskId: 'fake', state: 'failed'}]}, {tasks: [], live: {active: true, status: 'speaking'}}]) {
    f.render(data);
    assert.equal(f.orb.state, visualOrbState(data));
    assert.equal(f.orb.running, false);
  }
});

test('hidden preference changes cannot start animation and reveal uses the latest calm preference', () => {
  for (const calm of ['true', 'false']) {
    const f = fixture(); f.document.hidden = true; f.dispatch('document', 'visibilitychange');
    f.document.documentElement.dataset.calm = calm; f.dispatch('window', 'preferences-changed');
    assert.equal(f.orb.running, false);
    f.document.hidden = false; f.dispatch('document', 'visibilitychange');
    assert.equal(f.orb.calm, calm === 'true');
    assert.equal(f.orb.running, calm === 'false');
  }
});

test('visible preference changes retain the existing reduced motion behavior', () => {
  const f = fixture();
  f.document.documentElement.dataset.calm = 'true'; f.dispatch('window', 'preferences-changed');
  assert.equal(f.orb.running, false);
  f.document.documentElement.dataset.calm = 'false'; f.dispatch('window', 'preferences-changed');
  assert.equal(f.orb.running, true);
});

test('unload disposes the orb, clears the click timer and removes preference and visibility listeners', () => {
  const f = fixture(); f.dispatch('window', 'unload');
  assert.equal(f.orb.running, false);
  assert.ok(f.cleared.includes(42)); assert.ok(f.cleared.includes('observer'));
  assert.equal(f.listeners.has('window:preferences-changed'), false);
  assert.equal(f.listeners.has('document:visibilitychange'), false);
  f.dispatch('window', 'preferences-changed'); f.dispatch('document', 'visibilitychange');
  assert.equal(f.orb.running, false);
});

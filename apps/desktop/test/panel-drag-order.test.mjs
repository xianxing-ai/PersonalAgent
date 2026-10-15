import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../src/app/renderer.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('renderer.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const statements = [];
function visit(node) {
  if (ts.isBlock(node) && node.statements.some(statement => statement.getText(ast).startsWith("const header=root.querySelector('header')"))) {
    for (const statement of node.statements) {
      const text = statement.getText(ast);
      if (/^(const header=|let panelDragStart|const panelDragCurrent=|const panelDragReport=|const finishPanelDrag=|header\.addEventListener\('pointer|header\.addEventListener\('lostpointercapture)/.test(text)
        || text.startsWith("window.addEventListener('unload'") && text.includes('panelDragClosed')) statements.push(text);
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(statements.length, 11, 'extract the actual complete panel gesture and unload handlers');
const hostSource = await readFile(new URL('../electron/main.js', import.meta.url), 'utf8');
const hostAST = ts.createSourceFile('main.js', hostSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const branches = [];
function hostVisit(node) {
  if (ts.isIfStatement(node) && /^name === 'panel\.drag(Start|Move|End)' && sender === panel/.test(node.expression.getText(hostAST))) branches.push(node.getText(hostAST));
  ts.forEachChild(node, hostVisit);
}
hostVisit(hostAST);
assert.equal(branches.length, 3);
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};}
function fixture() {
  // Actual renderer/Host branches, explicit Fake header/window/IPC responses. No Runtime writes.
  const listeners = {}, captures = [], calls = [], starts = [], errors = [], moves = [], receipts = new Map();
  const header = {addEventListener: (name, handler) => {listeners[name] = handler;}, setPointerCapture: id => captures.push(id)};
  const panel = {}, orb = {getBounds: () => ({x: 10, y: 20})};
  const host = vm.createContext({panel, orb, dragging: false, panelDragOrigin: undefined, orbDragRevision: 0, away: 0, Date, movePanelGroup: payload => moves.push(payload)});
  const dispatch = vm.runInContext(`async(name,payload)=>{const sender=panel;${branches.join('\n')}}`, host);
  const context = vm.createContext({window: {addEventListener: (name, handler) => {listeners[name] = handler;}}, Math, root: {querySelector: () => header}, report: error => errors.push(error.message),
    invoke: async (name, payload) => {
      calls.push({name, payload});
      await dispatch(name, payload);
      if (name === 'panel.dragStart') {const receipt = deferred(); starts.push(receipt); return receipt.promise;}
      if (receipts.has(name)) return receipts.get(name).promise;
    }});
  vm.runInContext(statements.join('\n'), context);
  const emit = (name, x = 100, y = 200, targetButton = false, button = 0) => listeners[name]({button, screenX: x, screenY: y, pointerId: 1, target: {closest: () => targetButton}});
  return {host, context, emit, calls, starts, errors, moves, receipts, captures};
}

test('released panel pointer waits for current start then ends once without replaying queued movement', async () => {
  const f = fixture(); f.emit('pointerdown'); f.emit('pointermove', 130, 220); await settle();
  f.emit('pointerup'); f.emit('lostpointercapture');
  f.starts[0].resolve(); await settle();
  assert.deepEqual(f.calls.map(call => call.name), ['panel.dragStart', 'panel.dragEnd']);
  assert.equal(f.host.dragging, false); assert.equal(f.moves.length, 0);
});

test('old panel reply cannot move or end a newer active gesture', async () => {
  for (const oldFirst of [true, false]) {
    const f = fixture(); f.emit('pointerdown'); f.emit('pointermove', 130, 220); await settle(); f.emit('pointerup');
    f.emit('pointerdown', 200, 300); f.emit('pointermove', 230, 320); await settle();
    if (oldFirst) {f.starts[0].resolve(); await settle(); assert.equal(f.host.dragging, 'panel'); assert.equal(f.moves.length, 0);}
    f.starts[1].resolve(); await settle();
    f.starts[0].resolve(); await settle();
    assert.equal(f.host.dragging, 'panel'); assert.deepEqual(f.moves.map(move => [move.x, move.y]), [[230, 320]]);
    assert.equal(f.calls.filter(call => call.name === 'panel.dragEnd').length, 0);
    f.emit('pointermove', 240, 330); await settle(); f.emit('pointerup'); await settle();
    assert.deepEqual(f.moves.map(move => [move.x, move.y]), [[230, 320], [240, 330]]);
    assert.equal(f.host.dragging, false); assert.equal(f.calls.filter(call => call.name === 'panel.dragEnd').length, 1);
  }
});

test('a subsequent ordinary click cannot prevent cleanup of an already released Host drag', async () => {
  for (const releaseWhileClickHeld of [false, true]) {
    const f = fixture(); f.emit('pointerdown'); f.emit('pointermove', 130, 220); await settle(); f.emit('pointerup');
    f.emit('pointerdown', 200, 300); f.emit('pointermove', 202, 301);
    if (!releaseWhileClickHeld) f.emit('pointerup');
    f.starts[0].resolve(); await settle();
    assert.equal(f.host.dragging, false);
    assert.deepEqual(f.calls.map(call => call.name), ['panel.dragStart', 'panel.dragEnd']);
    assert.equal(f.moves.length, 0);
    if (releaseWhileClickHeld) f.emit('pointerup');
    await settle(); assert.equal(f.calls.length, 2);
  }
});

test('old feedback is suppressed after a new ordinary click while released Host cleanup is retained', async () => {
  const f = fixture(); f.emit('pointerdown'); f.emit('pointermove', 130, 220); await settle(); f.emit('pointerup');
  f.emit('pointerdown', 200, 300); f.emit('pointermove', 202, 301); f.emit('pointerup');
  f.starts[0].reject(Error('Older released gesture failure')); await settle();
  assert.equal(f.errors.length, 0); assert.equal(f.host.dragging, false);
  assert.deepEqual(f.calls.map(call => call.name), ['panel.dragStart', 'panel.dragEnd']);
});

test('current rejected start skips movement but release still cleans up and the next gesture can retry', async () => {
  const f = fixture(); f.emit('pointerdown'); f.emit('pointermove', 130, 220); await settle();
  f.starts[0].reject(Error('Fake start failure')); await settle(); f.emit('pointerup'); await settle();
  assert.deepEqual(f.errors, ['Fake start failure']); assert.equal(f.moves.length, 0);
  assert.equal(f.calls.filter(call => call.name === 'panel.dragEnd').length, 1);
  assert.equal(f.host.dragging, false, 'a lost start response may follow Host activation, so release must still end it');
  f.emit('pointerdown'); f.emit('pointermove', 140, 230); await settle(); f.starts[1].resolve(); await settle();
  f.emit('pointercancel'); await settle(); assert.equal(f.host.dragging, false); assert.equal(f.moves.length, 1);
});

test('older start, move and end failures cannot overwrite newer gesture feedback', async () => {
  for (const operation of ['panel.dragStart', 'panel.dragMove', 'panel.dragEnd']) {
    const f = fixture(); f.emit('pointerdown'); f.emit('pointermove', 130, 220); await settle();
    let old;
    if (operation === 'panel.dragStart') old = f.starts[0];
    else {old = deferred(); f.receipts.set(operation, old); f.starts[0].resolve(); await settle();}
    f.emit('pointerup'); await settle();
    f.emit('pointerdown'); f.emit('pointermove', 150, 240); await settle();
    f.starts[1].reject(Error('Current failure')); await settle();
    old.reject(Error('Older failure')); await settle();
    assert.deepEqual(f.errors, ['Current failure']);
  }
});

test('unloaded panel ignores delayed start and error callbacks', async () => {
  for (const reject of [false, true]) {
    const f = fixture(); f.emit('pointerdown'); f.emit('pointermove', 130, 220); await settle(); f.emit('pointerup'); f.emit('unload');
    if (reject) f.starts[0].reject(Error('Late unload error')); else f.starts[0].resolve();
    await settle(); assert.equal(f.calls.length, 1); assert.equal(f.errors.length, 0); assert.equal(f.moves.length, 0);
  }
});

test('header controls, non-left clicks and sub-threshold movement do not start a drag', async () => {
  const f = fixture(); f.emit('pointerdown', 100, 200, true); f.emit('pointermove', 150, 220); f.emit('pointerup');
  f.emit('pointerdown', 100, 200, false, 2); f.emit('pointermove', 150, 220); f.emit('pointerup');
  f.emit('pointerdown'); f.emit('pointermove', 102, 202); f.emit('pointerup'); await settle();
  assert.equal(f.calls.length, 0); assert.equal(f.captures.length, 1);
});

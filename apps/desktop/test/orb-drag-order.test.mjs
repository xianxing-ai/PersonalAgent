import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../electron/main.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const branches = [], lifecycle = [];
function visit(node) {
  if (ts.isIfStatement(node)) {
    if (/^name === '(orb|panel)\.drag(Start|End)' && sender === (orb|panel)$/.test(node.expression.getText(ast))) branches.push(node.getText(ast));
    if (node.expression.getText(ast) === "mode === 'orb'" && node.getText(ast).includes('const invalidateDrag')) lifecycle.push(node.getText(ast));
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(branches.length, 4);
assert.equal(lifecycle.length, 1);
function fakeWindow() {
  const win = new EventEmitter();
  win.webContents = new EventEmitter();
  win.destroyed = false;
  win.isDestroyed = () => win.destroyed;
  win.getBounds = () => ({x: 10, y: 20});
  return win;
}
function fixture() {
  const reads = [], snaps = [], orb = fakeWindow(), panel = fakeWindow();
  const context = vm.createContext({orb, panel, dragging: false, orbDragRevision: 0, dragOffset: undefined, panelDragOrigin: undefined, away: 0, Date,
    screen: {getCursorScreenPoint: () => ({x: 100, y: 200})}, desktopHost: {snap: win => snaps.push(win)},
    hidePanel: () => new Promise((resolve, reject) => reads.push({resolve, reject})),
  });
  const invoke = vm.runInContext(`(async(name,sender,payload)=>{${branches.join('\n')}})`, context);
  const register = vm.runInContext(`(win)=>{const mode='orb';${lifecycle[0]}}`, context);
  register(orb);
  return {context, reads, snaps, orb, panel, invoke, register};
}

test('released pointer cannot be revived by a late Host drag start', async () => {
  const f = fixture(), pending = f.invoke('orb.dragStart', f.orb);
  await f.invoke('orb.dragEnd', f.orb);
  f.reads[0].resolve(); await pending;
  assert.equal(f.context.dragging, false);
  assert.equal(f.snaps.length, 1);
});

test('current drag starts normally with the original cursor offset', async () => {
  const f = fixture(), pending = f.invoke('orb.dragStart', f.orb);
  f.reads[0].resolve(); await pending;
  assert.equal(f.context.dragging, true);
  assert.equal(f.context.dragOffset.x, 90);
  assert.equal(f.context.dragOffset.y, 180);
});

test('a previous gesture completion cannot take ownership from the next gesture', async () => {
  for (const oldFirst of [true, false]) {
    const f = fixture(), old = f.invoke('orb.dragStart', f.orb);
    await f.invoke('orb.dragEnd', f.orb);
    const current = f.invoke('orb.dragStart', f.orb);
    if (oldFirst) { f.reads[0].resolve(); await old; assert.equal(f.context.dragging, false); }
    f.reads[1].resolve(); await current;
    const offset = f.context.dragOffset;
    f.reads[0].resolve(); await old;
    assert.equal(f.context.dragging, true);
    assert.equal(f.context.dragOffset, offset);
  }
});

test('panel ownership survives old orb completion and release', async () => {
  const f = fixture(), pending = f.invoke('orb.dragStart', f.orb);
  await f.invoke('panel.dragStart', f.panel, {x: 30, y: 40});
  f.reads[0].resolve(); await pending;
  await f.invoke('orb.dragEnd', f.orb);
  assert.equal(f.context.dragging, 'panel');
  assert.equal(f.snaps.length, 0);
  await f.invoke('panel.dragEnd', f.panel);
  assert.equal(f.context.dragging, false);
});

test('panel release also invalidates a pending orb start', async () => {
  const f = fixture(), pending = f.invoke('orb.dragStart', f.orb);
  await f.invoke('panel.dragEnd', f.panel);
  f.reads[0].resolve(); await pending;
  assert.equal(f.context.dragging, false);
});

test('actual orb lifecycle handlers invalidate pending and active gestures', async () => {
  for (const event of ['did-start-navigation', 'render-process-gone', 'destroyed', 'closed']) {
    for (const active of [false, true]) {
      const f = fixture(), pending = f.invoke('orb.dragStart', f.orb);
      if (active) { f.reads[0].resolve(); await pending; }
      const emitter = event === 'closed' ? f.orb : f.orb.webContents;
      emitter.emit(event, {}, 'file:///orb', false, true);
      f.reads[0].resolve(); await pending;
      assert.equal(f.context.dragging, false, `${event}, active=${active}`);
    }
  }
});

test('subframe navigation does not cancel the current gesture', async () => {
  const f = fixture(), pending = f.invoke('orb.dragStart', f.orb);
  f.orb.webContents.emit('did-start-navigation', {}, 'file:///frame', false, false);
  f.reads[0].resolve(); await pending;
  assert.equal(f.context.dragging, true);
});

test('destroyed or replaced windows cannot activate an old pending start', async () => {
  for (const replace of [false, true]) {
    const f = fixture(), pending = f.invoke('orb.dragStart', f.orb);
    if (replace) f.context.orb = fakeWindow(); else f.orb.destroyed = true;
    f.reads[0].resolve(); await pending;
    assert.equal(f.context.dragging, false);
  }
});

test('old window lifecycle cannot cancel a replacement window gesture', async () => {
  const f = fixture(), replacement = fakeWindow();
  f.context.orb = replacement; f.register(replacement);
  const pending = f.invoke('orb.dragStart', replacement);
  f.reads[0].resolve(); await pending;
  f.orb.emit('closed');
  assert.equal(f.context.dragging, true);
});

test('initial hide rejection permits a new explicit gesture retry', async () => {
  const f = fixture(), pending = f.invoke('orb.dragStart', f.orb);
  f.reads[0].reject(Error('Fake hide failure'));
  await assert.rejects(pending, /Fake hide failure/);
  assert.equal(f.context.dragging, false);
  const retry = f.invoke('orb.dragStart', f.orb);
  f.reads[1].resolve(); await retry;
  assert.equal(f.context.dragging, true);
});

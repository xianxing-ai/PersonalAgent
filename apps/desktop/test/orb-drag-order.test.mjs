import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import ts from 'typescript';
import {clampOrb, placeOrb} from '../electron/placement.js';

const source = await readFile(new URL('../electron/main.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const branches = [], lifecycle = [], dragHelpers = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && ['stopOrbDrag', 'moveOrbDrag'].includes(node.name?.text)) dragHelpers.push(node.getText(ast));
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
  win.bounds = {x: 10, y: 20, width: 112, height: 112};
  win.moves = [];
  win.getBounds = () => ({...win.bounds});
  win.getContentBounds = win.getBounds;
  win.setPosition = (x, y) => { win.bounds = {...win.bounds, x, y}; win.moves.push({x, y}); };
  win.setContentBounds = bounds => { win.bounds = {...bounds}; win.moves.push({...bounds}); };
  return win;
}
function fixture(area = {x: 0, y: 0, width: 1920, height: 1080}) {
  const reads = [], snaps = [], orb = fakeWindow(), panel = fakeWindow();
  const pointer = {x: 100, y: 200};
  const timers = new Map();
  const context = vm.createContext({orb, panel, dragging: false, orbDragRevision: 0, dragOffset: undefined, orbDragPoll: undefined, panelDragOrigin: undefined, away: 0, Date, clampOrb, placeOrb,
    setInterval: (fn, delay) => { const timer = {}; timers.set(timer, {fn, delay}); return timer; }, clearInterval: timer => timers.delete(timer),
    screen: {getCursorScreenPoint: () => ({...pointer}), getDisplayNearestPoint: point => ({workArea: typeof area === 'function' ? area(point) : area})}, desktopHost: {snap: win => snaps.push(win)},
    hidePanel: () => new Promise((resolve, reject) => reads.push({resolve, reject})),
  });
  const invoke = vm.runInContext(`${dragHelpers.join('\n')}\n(async(name,sender,payload)=>{${branches.join('\n')}})`, context);
  const register = vm.runInContext(`(win)=>{const mode='orb';${lifecycle[0]}}`, context);
  register(orb);
  return {context, reads, snaps, orb, panel, invoke, register, pointer, timers,
    tick: () => { for (const {fn} of [...timers.values()]) fn(); }};
}

test('movement while the panel is hiding preserves the original grab offset', async () => {
  const f = fixture(), pending = f.invoke('orb.dragStart', f.orb);
  f.pointer.x = 1000; f.pointer.y = 800;
  f.reads[0].resolve(); await pending;
  assert.equal(f.context.dragOffset.x, 90);
  assert.equal(f.context.dragOffset.y, 180);
});

test('pointer-down offset reaches every corner without changing the native orb size', async () => {
  for (const area of [{x: 0, y: 0, width: 1920, height: 1080}, {x: -1280, y: -720, width: 1280, height: 720}]) {
    for (const [right, bottom] of [[false, false], [true, false], [false, true], [true, true]]) {
      const f = fixture(area), pending = f.invoke('orb.dragStart', f.orb, {x: 28, y: 37});
      f.pointer.x = area.x + (right ? area.width - 1 : 0);
      f.pointer.y = area.y + (bottom ? area.height - 1 : 0);
      f.reads[0].resolve(); await pending;
      await f.invoke('orb.dragEnd', f.orb);
      assert.deepEqual(f.orb.bounds, {x: right ? area.x + area.width - 112 : area.x,
        y: bottom ? area.y + area.height - 112 : area.y, width: 112, height: 112});
      assert.equal(f.timers.size, 0);
    }
  }
});

test('active dragging samples the latest cursor at 16ms and skips unchanged positions', async () => {
  const f = fixture(), pending = f.invoke('orb.dragStart', f.orb, {x: 28, y: 37});
  f.reads[0].resolve(); await pending;
  assert.deepEqual([...f.timers.values()].map(timer => timer.delay), [16]);
  f.pointer.x = 400; f.pointer.y = 500; f.tick();
  assert.equal(f.orb.bounds.x, 372); assert.equal(f.orb.bounds.y, 463);
  const count = f.orb.moves.length;
  f.tick(); assert.equal(f.orb.moves.length, count);
  f.pointer.x = 600; f.pointer.y = 700;
  await f.invoke('orb.dragEnd', f.orb);
  assert.equal(f.orb.bounds.x, 572); assert.equal(f.orb.bounds.y, 663);
  assert.equal(f.timers.size, 0);
  f.pointer.x = 900; f.tick(); assert.equal(f.orb.bounds.x, 572);
});

test('one gesture follows the pointer across differently sized displays and changed work areas', async () => {
  const displays = [{x: -1280, y: -720, width: 1280, height: 720},
    {x: 0, y: 0, width: 2560, height: 1400}];
  const f = fixture(point => displays[point.x < 0 ? 0 : 1]);
  const pending = f.invoke('orb.dragStart', f.orb, {x: 28, y: 37});
  f.reads[0].resolve();await pending;
  for (const [point, expected] of [
    [{x: -500, y: -300}, {x: -528, y: -337}],
    [{x: 800, y: 600}, {x: 772, y: 563}],
    [{x: -1, y: -1}, {x: -112, y: -112}],
    [{x: 2559, y: 1399}, {x: 2448, y: 1288}],
  ]) {
    Object.assign(f.pointer, point);f.tick();
    assert.deepEqual(f.orb.bounds, {...expected, width: 112, height: 112});
  }
  // Resolution/taskbar changes are read live instead of cached at drag start.
  displays[1] = {x: 0, y: 0, width: 800, height: 560};f.tick();
  assert.deepEqual(f.orb.bounds, {x: 688, y: 448, width: 112, height: 112});
  await f.invoke('orb.dragEnd', f.orb);
});

test('rounded native outer bounds cannot shrink the reachable area or grow the orb', async () => {
  const f = fixture();
  f.orb.getBounds = () => ({...f.orb.bounds, width: 600, height: 500});
  const pending = f.invoke('orb.dragStart', f.orb, {x: 28, y: 37});
  f.pointer.x = 1919; f.pointer.y = 1079;
  f.reads[0].resolve(); await pending;
  for (let i = 0; i < 20; i++) f.tick();
  assert.deepEqual(f.orb.bounds, {x: 1808, y: 968, width: 112, height: 112});
  await f.invoke('orb.dragEnd', f.orb);
});

test('invalid or out-of-window pointer anchors are rejected before panel cleanup', async () => {
  for (const payload of [null, {x: NaN, y: 1}, {x: -1, y: 0}, {x: 113, y: 0}, {x: 1, y: 113}]) {
    const f = fixture();
    await assert.rejects(f.invoke('orb.dragStart', f.orb, payload), /拖动坐标无效/);
    assert.equal(f.reads.length, 0); assert.equal(f.timers.size, 0); assert.equal(f.orb.moves.length, 0);
  }
});

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
  assert.equal(f.timers.size, 0);
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
      assert.equal(f.timers.size, 0);
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

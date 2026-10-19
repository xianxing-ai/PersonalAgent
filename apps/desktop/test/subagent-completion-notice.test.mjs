import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSubagentCompletionNotice} from '../src/features/conversation/subagent-completion-notice.js';

function fixture(t, invoke) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {if (original) Object.defineProperty(globalThis, 'document', original); else delete globalThis.document;});
  class Element {
    constructor(tag) {this.tag = tag; this.children = []; this.attrs = {}; this.style = {};}
    append(...children) {this.children.push(...children);}
    setAttribute(name, value) {this.attrs[name] = value;}
    set textContent(value) {this.text = value;}
    get textContent() {return (this.text || '') + this.children.map(child => child.textContent).join('');}
    set innerHTML(value) {throw Error(`Unexpected HTML: ${value}`);}
  }
  globalThis.document = {createElement: tag => new Element(tag)};
  let clock = Date.parse('2026-10-18T10:00:00Z'), nextTimer = 0;
  const timers = new Map(), calls = [], root = new Element('main');
  const control = mountSubagentCompletionNotice(root, invoke && (async (...args) => {
    calls.push(args); return invoke(...args);
  }), {now: () => clock, setTimeout(fn, delay) {const id = ++nextTimer; timers.set(id, {fn, at: clock + delay}); return id;},
    clearTimeout: id => timers.delete(id)});
  const notice = root.children[0], [open, feedback, dismiss] = notice.children;
  return {...control, notice, open, feedback, dismiss, calls, timers, get now() {return new Date(clock).toISOString();},
    tick(ms) {clock += ms; for (const [id, timer] of [...timers]) if (timer.at <= clock) {timers.delete(id); timer.fn();}}};
}
const child = (taskId, state, extra = {}) => ({taskId, parentTaskId: 'parent', role: '研究子智能体', state, ...extra});

test('initial successes form a restart baseline, with no list or replay across later snapshots', t => {
  const ui = fixture(t);
  const old = child('old', 'succeeded', {createdAt: ui.now});
  ui.update([old]); assert.equal(ui.notice.hidden, true);
  ui.update([]); ui.update([old]);
  ui.update([old, child('historical', 'succeeded', {createdAt: '2026-10-17T10:00:00Z'})]);
  ui.update([old, child('unknown-age', 'succeeded')]);
  assert.equal(ui.notice.hidden, true); assert.equal(ui.timers.size, 0);
  assert.equal(ui.notice.children.length, 3, 'there is no persistent task list');
});

test('observed active work completes once, safely renders its label and disappears after eight seconds', t => {
  const ui = fixture(t);
  const role = '<img src=x onerror=alert(1)>子智能体';
  ui.update([child('a', 'running', {role})]); assert.equal(ui.notice.hidden, true);
  ui.update([child('a', 'succeeded', {role})]);
  assert.equal(ui.notice.hidden, false); assert.equal(ui.open.textContent, `${role}已完成 ✓`);
  assert.equal(ui.notice.attrs['aria-live'], 'polite');
  ui.tick(7999); assert.equal(ui.notice.hidden, false);
  ui.update([child('a', 'succeeded')]); ui.tick(1); assert.equal(ui.notice.hidden, true);
  ui.update([]); ui.update([child('a', 'running')]); ui.update([child('a', 'succeeded')]);
  assert.equal(ui.notice.hidden, true, 'same ID never replays even if state regresses');
});

test('only fresh directly appearing successes notify; failed and cancelled records never become success notices', t => {
  const ui = fixture(t); ui.update([]); ui.tick(1);
  ui.update([child('failed', 'failed'), child('cancelled', 'cancelled')]); assert.equal(ui.notice.hidden, true);
  ui.update([child('failed', 'succeeded'), child('cancelled', 'succeeded')]); assert.equal(ui.notice.hidden, true);
  ui.update([child('fresh', 'succeeded', {createdAt: ui.now})]); assert.equal(ui.notice.hidden, false);
  ui.dismiss.onclick(); assert.equal(ui.notice.hidden, true);
});

test('persisted Runtime update time distinguishes missed fresh completions from old successes', t => {
  const ui = fixture(t); ui.update([]); ui.tick(1);
  ui.update([child('old', 'succeeded', {updatedAt: '2026-10-17T10:00:00Z'}),
    child('future', 'succeeded', {updatedAt: '2026-10-19T10:00:00Z'})]);
  assert.equal(ui.notice.hidden, true);
  const fresh = child('fresh', 'succeeded', {updatedAt: ui.now, createdAt: '2026-10-17T10:00:00Z'});
  ui.update([fresh]); assert.equal(ui.notice.hidden, false);
  ui.dismiss.onclick(); ui.update([fresh]); assert.equal(ui.notice.hidden, true);
});

test('several first completions queue, dismiss and navigation use the exact child, without raw error disclosure', async t => {
  let fail = true;
  const ui = fixture(t, async () => {if (fail) throw Error('private path and credential');});
  ui.update([child('a', 'running'), child('b', 'running', {role: '核验子智能体'})]);
  const done = [child('a', 'succeeded'), child('b', 'succeeded', {role: '核验子智能体'})];
  ui.update(done); await ui.open.onclick();
  assert.deepEqual(ui.calls[0], ['task.openSubagentConversation', {parentTaskId: 'parent', taskId: 'a'}]);
  assert.match(ui.feedback.textContent, /无法打开/); assert.doesNotMatch(ui.notice.textContent, /private|credential/);
  fail = false; await ui.open.onclick();
  assert.equal(ui.open.textContent, '核验子智能体已完成 ✓');
  ui.update(done); ui.dismiss.onclick(); assert.equal(ui.notice.hidden, true);
  ui.update(done); assert.equal(ui.notice.hidden, true);
});

test('leaving the task scope hides notices and stale navigation failures cannot overwrite a later completion', async t => {
  let reject;
  const ui = fixture(t, () => new Promise((_, no) => {reject = no;}));
  ui.update([child('a', 'running'), child('b', 'running')]);
  ui.update([child('a', 'succeeded'), child('b', 'succeeded')]);
  const pending = ui.open.onclick(); ui.dismiss.onclick();
  reject(Error('stale secret')); await pending;
  assert.equal(ui.open.textContent, '研究子智能体已完成 ✓'); assert.equal(ui.feedback.textContent, '');
  ui.update([]); assert.equal(ui.notice.hidden, true); assert.equal(ui.timers.size, 0);
  ui.dispose(); ui.update([child('new', 'succeeded', {createdAt: ui.now})]);
  assert.equal(ui.notice.hidden, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';

// Tiny deterministic DOM surface: exercises the real mountAdmin/render code,
// not an Electron/device test. No external dependencies or real timers.
function element() {
  return {dataset: {}, listeners: new Map(), textContent: '', disabled: false,
    addEventListener(name, listener) { this.listeners.set(name, listener); },
    setAttribute() {}, insertBefore() {}};
}
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

 test('approval render crossing expiry still refreshes and stale clicks never submit', async t => {
  const globals = ['window', 'document', 'matchMedia'];
  const originals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const key of globals) {
      const descriptor = originals.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  globalThis.window = {addEventListener() {}};
  globalThis.document = {createElement: element};
  globalThis.matchMedia = () => ({matches: false, addEventListener() {}});
  const {mountAdmin} = await import('../src/features/admin/view.js');
  const expires = Date.parse('2026-09-17T12:00:00.000Z');
  let now = expires - 1;
  const timers = new Map();
  let timerId = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    const id = ++timerId; timers.set(id, {callback, delay}); return id;
  });
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));

  function harness() {
    const nodes = new Map(['.admin-bar', '#admin-close', 'nav', '#admin-search',
      '.main', '#page-title', '#connection', '#content', '#error'].map(key => [key, element()]));
    let html = '';
    let buttons = [];
    let crossOnWrite = true;
    Object.defineProperty(nodes.get('#content'), 'innerHTML', {
      get: () => html,
      set(value) {
        html = value;
        buttons = [...value.matchAll(/data-approval="([^"]+)" data-id="([^"]+)" data-task="([^"]+)" data-revision="([^"]+)"/g)]
          .map(([, approval, id, task, revision]) => ({...element(), dataset: {approval, id, task, revision}}));
        if (crossOnWrite) { now = expires + 1; crossOnWrite = false; }
      },
    });
    const root = {innerHTML: '', querySelector: key => nodes.get(key) ?? null,
      querySelectorAll: key => key === '[data-approval]' ? buttons : []};
    const calls = [];
    const render = mountAdmin(root, async (...args) => {
      if(args[0]==='authorization.sandbox.read')return {selected:{label:'Synthetic unavailable',mode:'unavailable',revision:0},profiles:[],rules:[]};
      if (args[0] === 'approval.history') return {items: []};
      calls.push(args);
    }, escape);
    const data = {tasks: [], capabilities: [], health: [], connection: 'fixture',
      adminNavigation: {page: 'authorizations', revision: 1}, approvals: [{
        approvalId: 'a', taskId: 't', revision: 1, state: 'pending', action: 'fixture.read',
        scopes: ['fixture:read'], argumentSummary: 'redacted', expiresAt: new Date(expires).toISOString(),
      }]};
    render(data);
    return {calls, data, render, buttons: () => buttons, html: () => html};
  }

  const first = harness();
  assert.match(first.html(), /data-approval=/);
  assert.equal(timers.size, 1, 'crossing expiry must not drop the only timer');
  const [id, timer] = timers.entries().next().value;
  assert.ok(timer.delay >= 0 && timer.delay <= 25);
  timers.delete(id);
  now = expires + 30;
  timer.callback();
  assert.doesNotMatch(first.html(), /data-approval=/);
  assert.match(first.html(), /已失效/);
  assert.equal(timers.size, 0, 'expired snapshots must not create a refresh loop');
  assert.equal(first.calls.length, 0);

  now = expires - 1;
  const second = harness();
  const stale = second.buttons()[0];
  await stale.listeners.get('click')();
  assert.equal(second.calls.length, 0, 'expiry is checked again before invoking');
  assert.doesNotMatch(second.html(), /data-approval=/);
  assert.equal(timers.size, 0);
});

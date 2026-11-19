import test from 'node:test';
import assert from 'node:assert/strict';
import {adminAuxiliaryDocument, recordFollowingNodes} from '../test-support/admin-history-dom.mjs';

test('capabilities page retains DOM across background snapshots, preserves developer-fold state, and deduplicates catalog loads', async t => {
  const original = new Map(['window', 'document', 'matchMedia'].map(key =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  let contentWrites = 0;
  let contentHtml = '';
  const listeners = new Map();
  const makeNode = () => {
    const handlers = new Map();
    return {
      dataset: {},
      textContent: '',
      value: '',
      open: false,
      disabled: false,
      isConnected: true,
      addEventListener(type, fn) {
        if (!handlers.has(type)) handlers.set(type, []);
        handlers.get(type).push(fn);
      },
      dispatch(type, event = {}) {
        for (const fn of handlers.get(type) ?? []) fn(event);
      },
      setAttribute() {},
      insertBefore() {},
      after: recordFollowingNodes,
    };
  };

  globalThis.window = {addEventListener() {}};
  globalThis.document = adminAuxiliaryDocument();
  globalThis.matchMedia = () => ({matches: false, addEventListener() {}});

  const {mountAdmin} = await import('../src/features/admin/view.js');
  const nodes = new Map(['.admin-bar', '#admin-close', 'nav', '#admin-search', '.advanced-nav',
    '.main', '#page-title', '#connection', '#error'].map(key => [key, makeNode()]));
  const contentNode = makeNode();
  Object.defineProperty(contentNode, 'innerHTML', {
    get() { return contentHtml; },
    set(value) { contentWrites += 1; contentHtml = value; },
  });
  nodes.set('#content', contentNode);

  let loadClickHandler;
  const loadButton = {
    disabled: false,
    addEventListener(type, fn) {
      if (type === 'click') loadClickHandler = fn;
    },
  };

  const root = {
    innerHTML: '',
    isConnected: true,
    querySelector: key => {
      if (key === '#load-image-catalog') return loadButton;
      return nodes.get(key) ?? null;
    },
    querySelectorAll: () => [],
  };
  const escape = value => String(value).replace(/[&<>"']/g,
    char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));

  let catalogCalls = 0;
  let resolveCatalog;
  const invoke = async name => {
    if (name === 'workflow.image.catalog') {
      catalogCalls += 1;
      return new Promise(resolve => { resolveCatalog = resolve; });
    }
    return {};
  };

  const render = mountAdmin(root, invoke, escape);
  const base = {
    tasks: [],
    approvals: [],
    capabilities: [{name: 'workspace.read_text', version: '1.0.0', sideEffect: 'read', requiredScopes: ['workspace:read']}],
    health: [{id: 'workspace.read_text', state: 'ready'}],
    capabilityDirectory: {state: 'loaded', reason: '已公布 1 项'},
    connection: 'fixture',
  };

  render({...base, adminNavigation: {page: 'capabilities', revision: 1}});
  assert.equal(contentWrites, 1);

  // Background snapshots with unchanged capabilities must not rewrite #content DOM.
  render({...base, resources: {tick: 1}, adminNavigation: {page: 'capabilities', revision: 1}});
  render({...base, resources: {tick: 2}, adminNavigation: {page: 'capabilities', revision: 1}});
  assert.equal(contentWrites, 1, 'unchanged background snapshots must retain capabilities DOM');

  // Record developer-fold toggle open state.
  contentNode.dispatch('toggle', {target: {isConnected: true, dataset: {developerFold: 'capabilities'}, open: true}});

  // Trigger catalog load and attempt duplicate click while in flight.
  const firstClick = loadClickHandler();
  const secondClick = loadClickHandler();
  assert.equal(catalogCalls, 1, 'in-flight catalog load must reject concurrent duplicate clicks');
  assert.match(contentHtml, /正在读取 28 图工作流目录/);
  assert.match(contentHtml, /data-developer-fold="capabilities" open/);

  // Background refresh during loading must retain DOM and loading indicator.
  const writesDuringLoad = contentWrites;
  render({...base, resources: {tick: 3}, adminNavigation: {page: 'capabilities', revision: 1}});
  assert.equal(contentWrites, writesDuringLoad);

  resolveCatalog({
    designWorkflowCount: 28,
    designNodeCount: 185,
    adapterRequirementCount: 152,
    workflows: [{workflowId: 'F01', name: '主动监测', nodeCount: 6, state: 'unavailable', unavailableReasons: ['missing_port']}],
  });
  await Promise.all([firstClick, secondClick]);

  assert.match(contentHtml, /F01/);
  assert.match(contentHtml, /主动监测/);
  assert.match(contentHtml, /missing_port/);
  assert.match(contentHtml, /data-developer-fold="capabilities" open/);

  // Subsequent background snapshots must preserve loaded catalog without rewriting DOM.
  const writesAfterLoad = contentWrites;
  render({...base, resources: {tick: 4}, adminNavigation: {page: 'capabilities', revision: 1}});
  assert.equal(contentWrites, writesAfterLoad);
});

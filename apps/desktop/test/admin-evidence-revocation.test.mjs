import test from 'node:test';
import assert from 'node:assert/strict';

const escape = value => String(value).replace(/[&<>"']/g,
  char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));

function element() {
  return {dataset: {}, listeners: new Map(), textContent: '', disabled: false,
    addEventListener(name, listener) { this.listeners.set(name, listener); },
    setAttribute() {}, insertBefore() {}};
}

async function harness(t, invoke) {
  const globals = ['window', 'document', 'matchMedia'];
  const originals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const key of globals) {
      const descriptor = originals.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const windowListeners = new Map();
  globalThis.window = {addEventListener(name, listener) {
    const listeners = windowListeners.get(name) ?? [];listeners.push(listener);windowListeners.set(name, listeners);
  }};
  globalThis.document = {createElement: element};
  globalThis.matchMedia = () => ({matches: false, addEventListener() {}});
  const {mountAdmin} = await import('../src/features/admin/view.js');
  const nodes = new Map(['.admin-bar', '#admin-close', 'nav', '#admin-search',
    '.main', '#page-title', '#connection', '#content', '#error'].map(key => [key, element()]));
  const root = {innerHTML: '', querySelector: key => nodes.get(key) ?? null,
    querySelectorAll: key => key === '[data-revoke]' ? revokeButtons : []};
  let revokeButtons = [];
  let html = '';
  Object.defineProperty(nodes.get('#content'), 'innerHTML', {
    get: () => html,
    set(value) {
      html = value;
      if(value.includes('id="quit"'))nodes.set('#quit',element());else nodes.delete('#quit');
      revokeButtons = [...value.matchAll(/data-revoke="([^"]+)" data-task="([^"]+)" data-revision="([^"]+)"/g)]
        .map(([, revoke, task, revision]) => ({...element(), dataset: {revoke, task, revision}}));
    },
  });
  const render = mountAdmin(root, (...args)=>args[0]==='authorization.sandbox.read'
    ?Promise.resolve({selected:{label:'Synthetic unavailable',mode:'unavailable',revision:0},profiles:[],rules:[]})
    :invoke(...args), escape);
  const base = {tasks: [], approvals: [], capabilities: [], health: [], connection: 'fixture'};
  return {render, base, root, html: () => html, content: nodes.get('#content'), buttons: () => revokeButtons, quitButton:()=>nodes.get('#quit'),
    unload: () => {for (const listener of windowListeners.get('unload') ?? []) listener();}};
}

test('Evidence detail keeps the latest selection and its failure when older requests settle', async t => {
  const requests = [];
  const ui = await harness(t, async (action, payload) => {
    if (action === 'evidence.list') return {items: [{evidenceId:'a'}, {evidenceId:'b'}]};
    assert.equal(action, 'evidence.get');
    return new Promise((resolve,reject) => requests.push({id:payload.evidenceId,resolve,reject}));
  });
  const data = {...ui.base, tasks:[{taskId:'task-1',conversationId:'desktop-panel',state:'waiting_reconciliation',
    revision:2,evidenceRefs:['opaque']}],adminNavigation:{page:'tasks',revision:1}};
  const click = (dataset, panelTaskId) => ui.content.listeners.get('click')({target:{closest:()=>({dataset,
    closest:()=>panelTaskId ? {dataset:{evidencePanel:panelTaskId}} : null,hasAttribute:()=>false})}});
  ui.render(data);await click({evidenceTask:'task-1'});
  for (const latest of ['success','failure']) for (const earlier of ['success','failure']) {
    const a=click({evidenceId:'a'},'task-1'),requestA=requests.at(-1);
    const b=click({evidenceId:'b'},'task-1'),requestB=requests.at(-1);
    if(latest==='success') requestB.resolve({evidenceId:'b',summary:'latest B',verification:'conditional'});
    else requestB.reject(Error('private B failure'));
    await b;const settled=ui.html();
    if(latest==='success') assert.match(settled,/latest B/);else assert.match(settled,/详情读取失败/);
    if(earlier==='success') requestA.resolve({evidenceId:'a',summary:'stale A'});
    else requestA.reject(Error('private A failure'));
    await a;assert.equal(ui.html(),settled,'late success/error cannot replace the last selected detail');
    assert.doesNotMatch(ui.html(),/stale A|private [AB] failure/);
  }
  assert.equal(requests.length,8);
});

test('replaced Evidence list, removed task, detached card and unloaded admin reject old detail completion', async t => {
  let finish;
  const ui=await harness(t,async action=> action==='evidence.list'
    ? {items:[{evidenceId:'a',summary:'fresh list'}]} : new Promise(resolve=>{finish=resolve;}));
  const data={...ui.base,tasks:[{taskId:'task-1',conversationId:'desktop-panel',state:'waiting_reconciliation',
    revision:2,evidenceRefs:['opaque']}],adminNavigation:{page:'tasks',revision:1}};
  const click=(dataset,panelTaskId)=>ui.content.listeners.get('click')({target:{closest:()=>({dataset,
    closest:()=>panelTaskId?{dataset:{evidencePanel:panelTaskId}}:null,hasAttribute:()=>false})}});
  for(const departure of ['list','task','conversation','detached','unload']) {
    ui.root.isConnected=true;ui.render(data);await click({evidenceTask:'task-1'});
    const pending=click({evidenceId:'a'},'task-1');
    if(departure==='list')await click({evidenceTask:'task-1'});
    if(departure==='task'){ui.render({...data,tasks:[]});ui.render(data);}
    if(departure==='conversation')ui.render({...data,tasks:[{...data.tasks[0],conversationId:'desktop-workspace'}]});
    if(departure==='detached')ui.root.isConnected=false;
    if(departure==='unload')ui.unload();
    const expected=ui.html();finish({evidenceId:'a',summary:'stale removed detail'});await pending;
    assert.equal(ui.html(),expected,departure);assert.doesNotMatch(ui.html(),/stale removed detail/);
  }
});

test('task Evidence detail uses host-only metadata actions and never renders raw values', async t => {
  const calls = [];
  const ui = await harness(t, async (action, payload) => {
    calls.push([action, payload]);
    if (action === 'evidence.list') return {items: [{evidenceId: 'ev-1', summary: 'Tool execution confirmed',
      verification: 'conditional', rawResult: 'secret-canary'}]};
    if (action === 'evidence.get') return {evidenceId: 'ev-1', kind: 'execution',
      sourceRef: 'runtime:tool-execution', capturedAt: '2026-09-25T00:00:00.000Z',
      summary: 'Tool execution confirmed', verification: 'conditional', sensitivity: 'internal',
      rawResult: 'secret-canary'};
    throw Error('unexpected action');
  });
  ui.render({...ui.base, tasks: [{taskId: 'task-1', state: 'succeeded', revision: 2,
    evidenceRefs: ['opaque-ref']}], adminNavigation: {page: 'tasks', revision: 1}});
  assert.doesNotMatch(ui.html(), /opaque-ref/);
  const click = async (dataset, panelTaskId) => ui.content.listeners.get('click')({target: {
    closest(selector) {
      if (selector === '[data-evidence-panel]') return panelTaskId ? {dataset: {evidencePanel: panelTaskId}} : null;
      return {dataset, closest: () => panelTaskId ? {dataset: {evidencePanel: panelTaskId}} : null,
        hasAttribute: name => name === 'data-evidence-more' && 'evidenceMore' in dataset};
    },
  }});
  await click({evidenceTask: 'task-1'});
  assert.deepEqual(calls[0], ['evidence.list', {taskId: 'task-1', limit: 10}]);
  assert.match(ui.html(), /<details data-task-details="task-1" open>/, 'readback remains visible after rerender');
  assert.match(ui.html(), /Tool execution confirmed/);
  await click({evidenceId: 'ev-1'}, 'task-1');
  assert.deepEqual(calls[1], ['evidence.get', {taskId: 'task-1', evidenceId: 'ev-1'}]);
  assert.match(ui.html(), /runtime:tool-execution/);
  assert.match(ui.html(), /conditional 不表示目标系统已核实/);
  assert.doesNotMatch(ui.html(), /secret-canary|opaque-ref/);
});

test('Evidence list ignores older page success/error after the latest refresh settles and preserves its cursor', async t => {
  const requests=[];
  const ui=await harness(t,(action,payload)=>{
    assert.equal(action,'evidence.list');
    return new Promise((resolve,reject)=>requests.push({payload,resolve,reject}));
  });
  const data={...ui.base,tasks:[{taskId:'task-1',conversationId:'desktop-panel',state:'waiting_reconciliation',
    revision:2,evidenceRefs:['opaque']}],adminNavigation:{page:'tasks',revision:1}};
  const click=(more=false)=>ui.content.listeners.get('click')({target:{closest:()=>({
    dataset:more?{}:{evidenceTask:'task-1'},closest:()=>more?{dataset:{evidencePanel:'task-1'}}:null,
    hasAttribute:name=>more && name==='data-evidence-more'})}});
  ui.render(data);
  for(const latest of ['success','failure']) for(const earlier of ['success','failure']) {
    const seed=click(),seedRequest=requests.at(-1);seedRequest.resolve({items:[{evidenceId:'seed'}],nextBeforeEvidenceId:'seed-cursor'});await seed;
    const a=click(true),requestA=requests.at(-1);assert.equal(requestA.payload.beforeEvidenceId,'seed-cursor');
    const b=click(),requestB=requests.at(-1);assert.equal(Object.hasOwn(requestB.payload,'beforeEvidenceId'),false);
    if(latest==='success')requestB.resolve({items:[{evidenceId:'latest',summary:'latest refresh'}],nextBeforeEvidenceId:'latest-cursor'});
    else requestB.reject(Error('private latest list error'));
    await b;const expected=ui.html();
    if(latest==='success')assert.match(expected,/latest refresh/);else assert.match(expected,/执行元数据未读取/);
    if(earlier==='success')requestA.resolve({items:[{evidenceId:'old',summary:'stale older page'}],nextBeforeEvidenceId:'old-cursor'});
    else requestA.reject(Error('private older list error'));
    await a;assert.equal(ui.html(),expected);assert.doesNotMatch(ui.html(),/stale older page|private.*list error/);
    if(latest==='success') {
      const more=click(true),request=requests.at(-1);assert.equal(request.payload.beforeEvidenceId,'latest-cursor');
      request.resolve({items:[]});await more;
    }
  }
  assert.equal(requests.length,14);
});

test('Evidence list completion cannot revive removed tasks, replaced conversations, detached cards or unload', async t => {
  let settle;
  const ui=await harness(t,()=>new Promise(resolve=>{settle=resolve;}));
  const data={...ui.base,tasks:[{taskId:'task-1',conversationId:'desktop-panel',state:'waiting_reconciliation',
    revision:2,evidenceRefs:['opaque']}],adminNavigation:{page:'tasks',revision:1}};
  const click=()=>ui.content.listeners.get('click')({target:{closest:()=>({dataset:{evidenceTask:'task-1'},
    closest:()=>null,hasAttribute:()=>false})}});
  for(const departure of ['task','conversation','detached','unload']) {
    ui.root.isConnected=true;ui.render(data);const pending=click();
    if(departure==='task'){ui.render({...data,tasks:[]});ui.render(data);}
    if(departure==='conversation')ui.render({...data,tasks:[{...data.tasks[0],conversationId:'desktop-workspace'}]});
    if(departure==='detached')ui.root.isConnected=false;
    if(departure==='unload')ui.unload();
    const expected=ui.html();settle({items:[{evidenceId:'old',summary:'stale departing list'}]});await pending;
    assert.equal(ui.html(),expected,departure);assert.doesNotMatch(ui.html(),/stale departing list/);
  }
});

test('unavailable Evidence bridge leaves an explicit retry state without leaking host errors', async t => {
  const ui = await harness(t, async () => { throw Error('private-host-secret'); });
  ui.render({...ui.base, tasks: [{taskId: 'task-1', state: 'succeeded', revision: 2,
    evidenceRefs: ['opaque-ref']}], adminNavigation: {page: 'tasks', revision: 1}});
  await ui.content.listeners.get('click')({target: {closest: () => ({dataset: {evidenceTask: 'task-1'},
    closest: () => null, hasAttribute: () => false})}});
  assert.match(ui.html(), /宿主接口不可用或本次访问未获授权/);
  assert.match(ui.html(), /data-evidence-retry/);
  assert.doesNotMatch(ui.html(), /private-host-secret|opaque-ref/);
});

test('revocation receipt requires absent grant readback; failure stays unconfirmed', async t => {
  let result = {revoked: true, grantPresent: true, approvalRevision: 2};
  const calls = [];
  const ui = await harness(t, async (action, payload) => {
    if (action === 'approval.history') return {items: []};
    calls.push([action, payload]);
    return result;
  });
  ui.render({...ui.base, approvals: [{approvalId: 'approval-1', taskId: 'task-1',
    revision: 2, state: 'allowed', action: 'fixture.write', scopes: ['fixture:write'],
    argumentSummary: 'redacted', expiresAt: '2026-09-25T12:00:00.000Z'}],
  adminNavigation: {page: 'authorizations', revision: 1}});
  await ui.buttons()[0].listeners.get('click')();
  assert.deepEqual(calls[0], ['authorization.revoke', {taskId: 'task-1',
    authorizationRef: 'approval-1', expectedApprovalRevision: 2}]);
  assert.match(ui.html(), /撤销未获确认/);
  assert.doesNotMatch(ui.html(), /已撤销（授权存储读回）/);
  result = {revoked: true, grantPresent: false, approvalRevision: 2};
  await ui.buttons()[0].listeners.get('click')();
  assert.match(ui.html(), /已撤销（授权存储读回）/);
  assert.doesNotMatch(ui.html(), /data-revoke=/);
});

test('allowed approval history reaches revoke and shows only persisted readback', async t => {
  const calls = [];
  const allowed = {approvalId: 'history-1', taskId: 'task-1', revision: 2,
    state: 'allowed', action: 'fixture.write', scopes: ['fixture:write'],
    argumentSummary: 'redacted', expiresAt: '2026-09-25T12:00:00.000Z'};
  const ui = await harness(t, async (action, payload) => {
    calls.push([action, payload]);
    if (action === 'approval.history') return {items: [allowed]};
    if (action === 'authorization.revoke') return {revoked: true,
      grantPresent: false, approvalRevision: 2};
    throw Error('unexpected action');
  });
  ui.render({...ui.base, adminNavigation: {page: 'authorizations', revision: 1}});
  await new Promise(resolve => setImmediate(resolve));
  assert.match(ui.html(), /history-1/);
  assert.match(ui.html(), /data-revoke="history-1"/);
  await ui.buttons()[0].listeners.get('click')();
  assert.deepEqual(calls.at(-1), ['authorization.revoke', {taskId: 'task-1',
    authorizationRef: 'history-1', expectedApprovalRevision: 2}]);
  assert.match(ui.html(), /已撤销（授权存储读回）/);
  assert.doesNotMatch(ui.html(), /data-revoke=/);
});

test('visible general settings exposes the existing normal app quit action',async t=>{
  const calls=[],ui=await harness(t,async(...args)=>{calls.push(args);});
  ui.render({...ui.base,adminNavigation:{page:'settings',revision:1}});
  assert.ok(ui.html().includes('<h2>常规</h2>'));assert.ok(ui.html().includes('id="quit">退出应用</button>'));
  assert.deepEqual(calls,[],'rendering must not quit the application');
  await ui.quitButton().listeners.get('click')();assert.deepEqual(calls,[['app.quit']]);
  ui.render({...ui.base,adminNavigation:{page:'settings',revision:2}});
  await ui.quitButton().listeners.get('click')();assert.deepEqual(calls,[['app.quit'],['app.quit']],'one click invokes the existing action once after refresh');
});

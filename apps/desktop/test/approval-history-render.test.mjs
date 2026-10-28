import test from 'node:test';
import assert from 'node:assert/strict';
import {adminAuxiliaryDocument,recordFollowingNodes} from '../test-support/admin-history-dom.mjs';

function element() {
  return {dataset: {}, listeners: new Map(), textContent: '', disabled: false,
    addEventListener(name, listener) { this.listeners.set(name, listener); },
    setAttribute() {}, insertBefore() {},after:recordFollowingNodes};
}
const escape = value => String(value).replace(/[&<>"']/g,
  character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
const settle = () => new Promise(resolve => setImmediate(resolve));

test('admin history paging reports the original safe error and releases navigation for retry',async t=>{
  const originals=new Map(['window','document','matchMedia'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  t.after(()=>{for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  globalThis.window={addEventListener(){}};
  globalThis.document=adminAuxiliaryDocument();
  globalThis.matchMedia=()=>({matches:false,addEventListener(){}});
  const {mountAdmin}=await import('../src/features/admin/view.js');
  const nodes=new Map(['.admin-bar','#admin-close','nav','#admin-search','.main','#page-title','#connection','#content','#error']
    .map(key=>[key,element()]));
  const root={innerHTML:'',querySelector:key=>nodes.get(key)??null,querySelectorAll:()=>[]},calls=[];
  const render=mountAdmin(root,async(name,payload)=>{
    if(name==='authorization.sandbox.read')return {selected:{label:'Synthetic unavailable',mode:'unavailable',revision:0},profiles:[],rules:[]};
    calls.push({name,payload});assert.equal(name,'conversation.page');
    throw Object.assign(Error('PRIVATE_HISTORY_PROVIDER_BODY'),{code:'CURSOR_EXPIRED'});
  },escape);
  render({tasks:[],capabilities:[],health:[],approvals:[],connection:'本地 Runtime · 已连接',
    adminNavigation:{page:'tasks',revision:1},historyPage:{conversationId:'desktop-panel',pageRevision:1,
      hasOlder:true,hasNewer:false,viewingLatest:true}});
  const slot=nodes.get('#connection').followingNodes[0],navigation=slot.children[0];
  const older=navigation.querySelector('[data-history="older"]');assert.equal(older.disabled,false);
  await navigation.onclick({target:older});
  assert.deepEqual(calls,[{name:'conversation.page',payload:{direction:'older',conversationId:'desktop-panel'}}]);
  assert.match(nodes.get('#error').textContent,/CURSOR_EXPIRED/);
  assert.doesNotMatch(nodes.get('#error').textContent,/PRIVATE_HISTORY_PROVIDER_BODY|ReferenceError/);
  assert.equal(older.disabled,false,'failure releases the real navigation controller');
  await navigation.onclick({target:older});assert.equal(calls.length,2,'the same page remains explicitly retryable');
});

test('admin loads redacted history by explicit pages and rereads after approval', async t => {
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
  globalThis.document = adminAuxiliaryDocument();
  globalThis.matchMedia = () => ({matches: false, addEventListener() {}});
  t.mock.method(globalThis, 'setTimeout', () => 1);
  t.mock.method(globalThis, 'clearTimeout', () => {});
  const {mountAdmin} = await import('../src/features/admin/view.js');
  const nodes = new Map(['.admin-bar', '#admin-close', 'nav', '#admin-search',
    '.main', '#page-title', '#connection', '#content', '#error'].map(key => [key, element()]));
  const controls = new Map();
  let html = '';
  Object.defineProperty(nodes.get('#content'), 'innerHTML', {
    get: () => html,
    set(value) {
      html = value;
      controls.clear();
      for (const id of ['approval-history-more', 'approval-history-retry']) {
        if (html.includes(`id="${id}"`)) controls.set(`#${id}`, element());
      }
    },
  });
  const root = {innerHTML: '', querySelector: key => controls.get(key) ?? nodes.get(key) ?? null,
    querySelectorAll: () => []};
  const calls = [];
  const publicApproval = (id, state) => ({approvalId: id, taskId: 'task-' + id,
    revision: 2, state, action: 'workspace.read_text', scopes: ['workspace:read'],
    argumentSummary: 'redacted', expiresAt: '2099-01-01T00:00:00.000Z'});
  const invoke = async (name, payload) => {
    if(name==='authorization.sandbox.read')return {selected:{label:'Synthetic unavailable',mode:'unavailable',revision:0},profiles:[],rules:[]};
    calls.push({name, payload});
    if (name === 'approval.history') {
      if (calls.filter(call => call.name === name).length === 1)
        return {items: [publicApproval('older-1', 'allowed')], nextBeforeRowId: 17};
      if (payload.beforeRowId === 17)
        return {items: [publicApproval('older-2', 'denied')]};
      return {items: [publicApproval('newly-allowed', 'allowed')]};
    }
    if (name === 'authorization.respond') return {accepted: true, approvalState: 'allowed'};
    throw Error('Unexpected Desktop action');
  };
  const render = mountAdmin(root, invoke, escape);
  render({tasks: [], capabilities: [], health: [], connection: '本地 Runtime · 已连接',
    adminNavigation: {page: 'authorizations', revision: 1},
    approvals: [publicApproval('newly-allowed', 'pending')]});
  await settle();
  assert.match(html, /older-1/);
  assert.match(html, /加载更早记录/);
  assert.deepEqual(calls[0], {name: 'approval.history', payload: {}});
  controls.get('#approval-history-more').listeners.get('click')();
  await settle();
  assert.match(html, /older-1/);
  assert.match(html, /older-2/);
  assert.deepEqual(calls[1], {name: 'approval.history', payload: {beforeRowId: 17}});

  const decision = [...html.matchAll(/data-approval="(allow_once|deny)" data-id="([^"]+)" data-task="([^"]+)" data-revision="([^"]+)"/g)]
    .find(match => match[1] === 'allow_once');
  assert.ok(decision);
  const button = {...element(), dataset: {approval: decision[1], id: decision[2],
    task: decision[3], revision: decision[4]}};
  // Re-render with this one pending control represented by the minimal DOM.
  root.querySelectorAll = key => key === '[data-approval]' ? [button] : [];
  render({tasks: [], capabilities: [], health: [], connection: '本地 Runtime · 已连接',
    adminNavigation: {page: 'authorizations', revision: 1},
    approvals: [publicApproval('newly-allowed', 'pending')]});
  await button.listeners.get('click')();
  await settle();
  assert.equal(calls.at(-2).name, 'authorization.respond');
  assert.deepEqual(calls.at(-1), {name: 'approval.history', payload: {}});
  assert.match(html, /newly-allowed/);
  assert.match(html, /已允许/);
});

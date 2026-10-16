import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {stateNames} from '../src/features/conversation/state.js';

const source = await readFile(new URL('../src/features/workspace/view.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('view.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declarations = [];
let projection;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'mountWorkspace') {
    for (const statement of node.body.statements) {
      const text = statement.getText(ast);
      if (/^(let feedbackRevision=|let preferenceEditing=|const report=|const reportPreference=|const preferenceRequests=|const syncPreferenceBusy=|const projectPreferenceControls=|const requestPreference=|modelChoice\.onchange=|const editThinking=|depth\.oninput=|fast\.oninput=|const saveThinking=|depth\.onchange=|fast\.onchange=)/.test(text)) declarations.push(text);
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === 'update') {
        const end = statement.body.statements.findIndex(part => part.getText(ast).startsWith('orb.setLevel('));
        assert.ok(end > 0);
        projection = statement.body.statements.slice(0, end).map(part => part.getText(ast)).join('\n');
      }
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(declarations.length, 15);
assert.ok(projection.includes('projectPreferenceControls()'), 'the actual snapshot consumer must use the same projection');
const settle = () => new Promise(resolve => setImmediate(resolve));
const observed = (modelId = 'fake-A', depth = 1, fast = false) => ({tasks: [],
  modelChoices: [{id: 'fake-A', displayName: 'Fake A', available: true}, {id: 'fake-B', displayName: 'Fake B', available: true}],
  conversationPreference: {modelId, depth, fast}, thinking: {depth, fast}});
function fixture() {
  // Actual handlers/snapshot prefix. Controls, bridge and option DOM are explicit Fake.
  const control = value => ({value, checked: false, attrs: {}, setAttribute(name, value) {this.attrs[name] = value;}, replaceChildren(...options) {this.options = options;}});
  const modelChoice = control(''), depth = control(''), fast = control(''), error = {textContent: ''}, label = {}, calls = [];
  const children={hidden:true,innerHTML:''};
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const context = vm.createContext({sessionControls:{update(){}},nativeReasoning:{update(){},setBusy(){}},composer:{update(){}},children,escape,stateNames,current: {tasks: []}, updateRevision: 0, preferenceSignature: undefined,
    modelChoice, depth, fast, preferences: {querySelector: () => label}, root: {querySelector: () => error},
    Option: function(text, value) {this.text = text; this.value = value;},
    invoke: (name, payload) => new Promise((resolve, reject) => calls.push({name, payload, resolve, reject})),
  });
  vm.runInContext(declarations.join('\n'), context);
  const update = vm.runInContext(`data=>{${projection}}`, context);
  update(observed());
  return {context,children,modelChoice, depth, fast, error, calls, update, report: vm.runInContext('report', context)};
}
const pair = f => [f.depth.value, f.fast.checked];

test('current preference rejections restore observed model and the full thinking pair with no extra IPC', async () => {
  const f = fixture(); f.modelChoice.value = 'fake-B'; const model = f.modelChoice.onchange();
  assert.equal(f.modelChoice.attrs['aria-busy'], 'true');
  f.calls[0].reject(Error('Fake model persistence failure')); await model;
  assert.equal(f.modelChoice.value, 'fake-A'); assert.match(f.error.textContent, /model persistence failure/);
  f.depth.value = '5'; const thinking = f.depth.onchange();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[1].payload)), {depth: 5, fast: false});
  f.calls[1].reject(Error('Fake thinking persistence failure')); await thinking;
  assert.deepEqual(pair(f), ['1', false]);
  assert.equal(f.depth.attrs['aria-busy'], 'false'); assert.equal(f.fast.attrs['aria-busy'], 'false');
  assert.deepEqual(f.calls.map(call => call.name), ['conversation.model', 'thinking.update']);
});

test('older model rejection cannot revert a newer pending or accepted model selection', async () => {
  for (const accepted of [false, true]) {
    const f = fixture(); f.modelChoice.value = 'fake-B'; const old = f.modelChoice.onchange();
    f.modelChoice.value = ''; const current = f.modelChoice.onchange();
    if (accepted) {f.update(observed('')); f.calls[1].resolve(); await current;}
    f.calls[0].reject(Error('Older model failure')); await old;
    assert.equal(f.modelChoice.value, ''); assert.equal(f.error.textContent, '');
    assert.equal(f.modelChoice.attrs['aria-busy'], String(!accepted));
    if (!accepted) {f.update(observed('')); f.calls[1].resolve(); await current;}
  }
});

test('depth and fast share the latest complete pair intent across old rejection, audio and current success', async () => {
  const f = fixture(); f.depth.value = '4'; const old = f.depth.onchange();
  f.fast.checked = true; const current = f.fast.onchange();
  assert.deepEqual(f.calls.map(call => JSON.parse(JSON.stringify(call.payload))), [{depth: 4, fast: false}, {depth: 4, fast: true}]);
  f.update({...observed(), audioLevel: .3});
  assert.deepEqual(pair(f), ['4', true]); assert.equal(f.depth.attrs['aria-busy'], 'true');
  f.calls[0].reject(Error('Older depth failure')); await old;
  assert.deepEqual(pair(f), ['4', true]); assert.equal(f.error.textContent, '');
  f.update(observed('fake-A', 4, true)); f.calls[1].resolve(); await current;
  assert.deepEqual(pair(f), ['4', true]); assert.equal(f.fast.attrs['aria-busy'], 'false');
});

test('current thinking failure restores the latest observed pair while an independent model remains pending', async () => {
  const f = fixture(); f.modelChoice.value = 'fake-B'; const model = f.modelChoice.onchange();
  f.depth.value = '5'; f.fast.checked = true; const thinking = f.fast.onchange();
  f.update(observed('fake-A', 2, false));
  assert.deepEqual(pair(f), ['5', true]); assert.equal(f.modelChoice.value, 'fake-B');
  f.calls[1].reject(Error('Current pair failure')); await thinking;
  assert.deepEqual(pair(f), ['2', false]); assert.equal(f.modelChoice.value, 'fake-B');
  assert.equal(f.modelChoice.attrs['aria-busy'], 'true');
  f.update(observed('fake-B', 2, false)); f.calls[0].resolve(); await model;
});

test('older accepted readback cannot overwrite a newer pending thinking pair and its later failure restores that readback', async () => {
  const f = fixture(); f.depth.value = '3'; const old = f.depth.onchange();
  f.depth.value = '5'; f.fast.checked = true; const current = f.fast.onchange();
  f.update(observed('fake-A', 3, false)); f.calls[0].resolve(); await old;
  assert.deepEqual(pair(f), ['5', true]); assert.equal(f.depth.attrs['aria-busy'], 'true');
  f.calls[1].reject(Error('Latest pair failure')); await current;
  assert.deepEqual(pair(f), ['3', false]); assert.match(f.error.textContent, /Latest pair failure/);
});

test('a failed model request preserves independently accepted thinking and subsequent requests can retry', async () => {
  const f = fixture(); f.modelChoice.value = 'fake-B'; const model = f.modelChoice.onchange();
  f.depth.value = '4'; const thinking = f.depth.onchange();
  f.update(observed('fake-A', 4, false)); f.calls[1].resolve(); await thinking;
  f.calls[0].reject(Error('Model failed')); await model;
  assert.deepEqual(pair(f), ['4', false]); assert.equal(f.modelChoice.value, 'fake-A');
  f.modelChoice.value = 'fake-B'; const retry = f.modelChoice.onchange();
  f.update(observed('fake-B', 4, false)); f.calls[2].resolve(); await retry;
  assert.equal(f.modelChoice.value, 'fake-B'); assert.equal(f.modelChoice.attrs['aria-busy'], 'false');
  assert.equal(f.error.textContent, '', 'explicit current retry success clears only its previous preference failure');
  assert.equal(f.calls.length, 3); await settle();
});

test('successful preference retry cannot clear a newer workspace or other preference group error', async () => {
  for (const otherPreference of [false, true]) {
    const f = fixture(); f.modelChoice.value = 'fake-B'; const failed = f.modelChoice.onchange();
    f.calls[0].reject(Error('Previous model failure')); await failed;
    f.modelChoice.value = 'fake-B'; const retry = f.modelChoice.onchange();
    if (otherPreference) {
      f.depth.value = '4'; const thinking = f.depth.onchange();
      f.calls[2].reject(Error('New thinking failure')); await thinking;
    } else f.report(Error('New workspace failure'));
    f.update(observed('fake-B')); f.calls[1].resolve(); await retry;
    assert.equal(f.error.textContent, otherPreference ? 'New thinking failure' : 'New workspace failure');
  }
});

test('an unchanged audio snapshot preserves native range input before its change commit and emits no write', () => {
  const f = fixture(); f.depth.value = '4'; f.depth.oninput();
  f.update({...observed(), audioLevel: .4});
  assert.deepEqual(pair(f), ['4', false]); assert.equal(f.calls.length, 0);
});

test('previous preference rejection cannot discard newer native range input before change commit', async () => {
  for (const group of ['model', 'thinking']) {
    const f = fixture(); let previous;
    if (group === 'model') {f.modelChoice.value = 'fake-B'; previous = f.modelChoice.onchange();}
    else {f.depth.value = '5'; previous = f.depth.onchange();}
    f.depth.value = '4'; f.depth.oninput();
    f.update(observed('fake-A', 2, false));
    f.calls[0].reject(Error('Previous request rejected')); await previous;
    assert.deepEqual(pair(f), ['4', false]);
    const committed = f.depth.onchange();
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls[1].payload)), {depth: 4, fast: false});
    f.update(observed('fake-A', 4, false)); f.calls[1].resolve(); await committed;
    assert.deepEqual(pair(f), ['4', false]);
  }
});

test('real child projection renders independently while a preference request is pending',async()=>{const f=fixture();assert.equal(f.children.hidden,true);f.modelChoice.value='fake-B';const pending=f.modelChoice.onchange();f.update({...observed(),subagentTasks:[{parentTaskId:'parent-1',taskId:'child-1',role:'<worker>',modelId:'cloud-child',reasoningEffort:'high',state:'running',resultSummary:'<untrusted>',evidenceRefs:['evidence-1']}]});assert.equal(f.children.hidden,false);assert.match(f.children.innerHTML,/parent-1/);assert.match(f.children.innerHTML,/child-1/);assert.match(f.children.innerHTML,/cloud-child/);assert.match(f.children.innerHTML,/&lt;worker&gt;/);assert.match(f.children.innerHTML,/&lt;untrusted&gt;/);assert.match(f.children.innerHTML,/evidence-1/);assert.equal(f.modelChoice.value,'fake-B');assert.equal(f.modelChoice.attrs['aria-busy'],'true');assert.equal(f.calls.length,1);f.calls[0].reject(Error('Current persistence failure'));await pending;assert.equal(f.modelChoice.value,'fake-A');f.update(observed());assert.equal(f.children.hidden,true);assert.equal(f.calls.length,1);});

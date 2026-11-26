import test from 'node:test';
import assert from 'node:assert/strict';
import {mountComputerControls,mountBrowserConnections} from '../src/app/computer-controls.js';
import {authorizationDom} from '../test-support/authorization-dom.mjs';

const status = (extra={}) => ({enabled:true,preferenceRevision:1,observationPreference:false,...extra});
function preferences(invoke) {
  const {root} = authorizationDom();
  const controls = mountComputerControls(root,invoke);
  const section = root.querySelector('section');
  return {controls,section,enabled:section.querySelector('[name="enabled"]'),
    observation:section.querySelector('[name="allowObservationExport"]'),feedback:section.querySelector('[role="status"]')};
}

test('permissions wait for a revision and expose no task form or execution buttons', () => {
  const ui=preferences(assert.fail);
  ui.controls.render(undefined);
  assert.equal(ui.enabled.disabled,true);
  ui.controls.render(status());
  assert.equal(ui.enabled.disabled,false);
  assert.equal(ui.section.querySelector('form'),null);
  assert.equal(ui.section.querySelector('button'),null);
  ui.controls.show(false);
  assert.equal(ui.section.hidden,true);
});

test('changing only the selected preference uses the original revision and authoritative readback', async () => {
  const calls=[];
  const ui=preferences(async (name,payload)=>{
    calls.push({name,payload});
    return {computerControl:status({enabled:false,preferenceRevision:2})};
  });
  ui.controls.render(status());
  ui.enabled.checked=false;
  await ui.section.fire('change',ui.enabled);
  assert.deepEqual(calls,[{name:'computer.control.configure',payload:{expectedRevision:1,enabled:false}}]);
  assert.equal(ui.enabled.checked,false);
  assert.equal(ui.observation.disabled,true);
});

test('observation changes bind their exact field and a later host publication wins over a delayed reply', async () => {
  let finish;
  const calls=[];
  const ui=preferences((name,payload)=>{calls.push({name,payload});return new Promise(resolve=>{finish=resolve;});});
  ui.controls.render(status());
  ui.observation.checked=true;
  const pending=ui.section.fire('change',ui.observation);
  assert.deepEqual(calls,[{name:'computer.control.configure',payload:{expectedRevision:1,allowObservationExport:true}}]);
  assert.equal(ui.observation.disabled,true);
  ui.controls.render(status({preferenceRevision:3,enabled:false}));
  finish({computerControl:status({preferenceRevision:2,observationPreference:true})});
  await pending;
  assert.equal(ui.enabled.checked,false);
  assert.equal(ui.observation.checked,false);
});

test('preference failure preserves the prior setting and redacts private diagnostics', async () => {
  const ui=preferences(async()=>{throw Error('token=private-value');});
  ui.controls.render(status());
  ui.enabled.checked=false;
  await ui.section.fire('change',ui.enabled);
  assert.equal(ui.enabled.checked,true);
  assert.match(ui.feedback.textContent,/凭据已遮蔽/);
  assert.doesNotMatch(ui.feedback.textContent,/private-value/);
  ui.controls.dispose();
  await ui.section.fire('change',ui.enabled);
});

test('browser connections expose independent readiness and probe the existing extension without submitting work', async () => {
  const {root}=authorizationDom();
  const calls=[];
  const controls=mountBrowserConnections(root,async(name,payload)=>{
    calls.push({name,payload});
    return {computerControl:status({browser:{available:true,connected:{extension:{connected:true}}}})};
  });
  controls.render(status({browser:{available:true,connected:{guide:'请启用 OpenCLI 扩展'}}}));
  assert.match(root.querySelector('[data-managed]').textContent,/已就绪/);
  assert.match(root.querySelector('[data-connected]').textContent,/OpenCLI/);
  await root.querySelector('button').onclick();
  assert.match(root.querySelector('[data-connected]').textContent,/已连通/);
  assert.deepEqual(calls,[{name:'computer.control.probeConnectedBrowser',payload:{}}]);
  controls.dispose();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mountComputerVisionControls,readComputerVisionDiagnostic} from '../src/app/computer-vision-controls.js';
import {authorizationDom} from '../test-support/authorization-dom.mjs';

const state=extra=>({revision:'synthetic-revision',source:'agentarts-proxy',baseUrl:'https://synthetic.huaweicloud-agentarts.com/inference/v1',
  model:'synthetic-vision',enabled:false,configured:true,available:false,keyConfigured:true,reason:'可选视觉已关闭；默认 AgentArts 文本规划继续使用',...extra});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function harness(t,handler){
  const {root,document}=authorizationDom(),calls=[];
  const controls=mountComputerVisionControls(root,async(name,payload)=>{calls.push({name,payload:{...payload}});
    return handler?handler(name,payload):state({revision:'saved-revision',enabled:payload.enabled,source:payload.source,baseUrl:payload.baseUrl,model:payload.model});});
  t.after(()=>controls.dispose());
  const section=root.querySelector('.computer-vision-controls'),form=section.querySelector('form'),field=name=>section.querySelector(`[data-vision="${name}"]`);
  return {controls,root,section,document,calls,field,render:controls.render,
    edit(name,value){if(name==='enabled')field(name).checked=value;else field(name).value=value;return form.fire('input',field(name));},
    save:()=>form.fire('submit',form),reload:()=>section.fire('click',field('reload'))};
}

test('optional visual settings default off, wait for host and never probe a model while rendering',t=>{
  const ui=harness(t);assert.equal(ui.field('source').value,'agentarts-proxy');assert.equal(ui.field('save').disabled,true);
  assert.equal(ui.field('apiKey').value,'');assert.equal(ui.calls.length,0);
  ui.render(state());assert.equal(ui.field('save').disabled,false);assert.equal(ui.field('enabled').checked,false);
  assert.match(ui.section.html,/原图会发送/u);assert.match(ui.section.html,/不会替换默认 AgentArts/u);assert.match(ui.section.html,/不代表操作成功/u);
  assert.equal(ui.field('apiKey').attributes.get('type'),'password');assert.equal(ui.field('apiKey').attributes.get('autocomplete'),'new-password');
  ui.controls.show(false);assert.equal(ui.section.hidden,true);ui.controls.show(true);assert.equal(ui.section.hidden,false);
});

test('save submits only exact vision configure fields and CAS; successful save clears the write-only key',async t=>{
  const ui=harness(t);ui.render(state());await ui.edit('enabled',true);await ui.edit('apiKey','synthetic-private-key');
  await ui.save();assert.deepEqual(ui.calls,[{name:'computer.vision.configure',payload:{expectedRevision:'synthetic-revision',enabled:true,
    source:'agentarts-proxy',baseUrl:'https://synthetic.huaweicloud-agentarts.com/inference/v1',model:'synthetic-vision',apiKey:'synthetic-private-key'}}]);
  assert.equal(ui.field('apiKey').value,'');assert.match(ui.field('feedback').textContent,/已保存/u);assert.doesNotMatch(ui.field('feedback').textContent,/已验证|识别成功/u);
  ui.render(state({apiKey:'host-must-never-return-this'}));assert.equal(ui.field('apiKey').value,'');
});

test('pending save preserves input identity, edits and focus; late receipt cannot erase a new draft',async t=>{
  const reply=deferred(),ui=harness(t,()=>reply.promise);ui.render(state());await ui.edit('apiKey','original-secret');
  const input=ui.field('model');input.focus();const saving=ui.save();assert.equal(ui.field('save').disabled,true);
  await ui.save();assert.equal(ui.calls.length,1);
  await ui.edit('model','new-user-draft');await ui.edit('apiKey','new-user-secret');
  ui.render(state({revision:'saved-revision'}));reply.resolve(state({revision:'saved-revision'}));await saving;
  assert.equal(ui.field('model'),input);assert.equal(ui.document.activeElement,input);assert.equal(input.value,'new-user-draft');assert.equal(ui.field('apiKey').value,'new-user-secret');
});

test('technical failures keep exact safe detail/code/stage and preserve the draft for retry',async t=>{
  const ui=harness(t,()=>{throw Object.assign(Error('write failed EISDIR; token=private-token; C:\\Users\\private\\settings; body="private body"'),{code:'EISDIR',stage:'computer.vision.configure'});});
  ui.render(state());await ui.edit('model','retained-draft');await ui.edit('apiKey','retained-secret');await ui.save();
  assert.equal(ui.field('model').value,'retained-draft');assert.equal(ui.field('apiKey').value,'retained-secret');
  const text=ui.field('feedback').textContent;assert.match(text,/EISDIR/u);assert.match(text,/computer\.vision\.configure/u);assert.match(text,/write failed/u);
  assert.doesNotMatch(text,/private-token|Users|private body|retained-secret|未获授权/u);assert.equal(ui.field('save').disabled,false);
});

test('editing a destination clears a typed old key and requires explicit re-entry for that destination',async t=>{
  const ui=harness(t);ui.render(state());await ui.edit('apiKey','old-destination-secret');await ui.edit('source','openai-compatible');
  assert.equal(ui.field('apiKey').value,'');assert.match(ui.field('keyHint').textContent,/旧目的地凭据不会自动转移/u);
  await ui.edit('baseUrl','https://custom.example/v1');await ui.edit('apiKey','new-destination-secret');await ui.save();
  assert.equal(ui.calls[0].payload.source,'openai-compatible');assert.equal(ui.calls[0].payload.apiKey,'new-destination-secret');
});

test('new host state wins over a stale successful reply while old draft CAS cannot silently overwrite it',async t=>{
  const reply=deferred();let calls=0;
  const ui=harness(t,()=>++calls===1?reply.promise:Promise.reject(Object.assign(Error('版本已经变化'),{code:'REVISION_CONFLICT'})));ui.render(state());await ui.edit('model','old-draft');
  const saving=ui.save();ui.render(state({revision:'newest-revision',model:'newest-host',enabled:false}));
  reply.resolve(state({revision:'stale-success',model:'old-draft',enabled:true}));await saving;
  assert.match(ui.field('feedback').textContent,/没有覆盖/u);assert.equal(ui.field('model').value,'old-draft');
  await ui.save();assert.equal(ui.calls[1].payload.expectedRevision,'synthetic-revision');
  await ui.reload();assert.equal(ui.field('model').value,'newest-host');assert.equal(ui.field('apiKey').value,'');
});

test('invalid receipts and host storage diagnostics remain visible, and dispose clears keys and late replies',async t=>{
  const ui=harness(t,()=>({accepted:true}));ui.render(state({failure:{code:'ENOSPC',stage:'computer.vision.restore',message:'disk full; C:\\private\\file'}}));
  assert.match(ui.field('status').textContent,/ENOSPC/u);assert.doesNotMatch(ui.field('status').textContent,/C:\\/u);
  await ui.save();assert.match(ui.field('feedback').textContent,/PROTOCOL_MISMATCH/u);
  const held=deferred(),late=harness(t,()=>held.promise);late.render(state());await late.edit('apiKey','secret-to-clear');const saving=late.save();
  late.controls.dispose();held.resolve(state());await saving;assert.equal(late.field('apiKey').value,'');assert.equal(late.root.querySelector('.computer-vision-controls'),null);
});

test('only exact Main diagnostic action/kind may preserve safe detailed IPC failures',()=>{
  const value={kind:'computer-vision',stage:'computer.vision.configure',code:'EISDIR',message:'specific disk error; token=secret'};
  assert.deepEqual(readComputerVisionDiagnostic(value,'computer.vision.configure'),{stage:'computer.vision.configure',code:'EISDIR',message:'specific disk error; token=[凭据已遮蔽]'});
  assert.equal(readComputerVisionDiagnostic({...value,kind:'untrusted'},'computer.vision.configure'),undefined);
  assert.equal(readComputerVisionDiagnostic(value,'computer.control.configure'),undefined);
  assert.equal(readComputerVisionDiagnostic({...value,stage:'other'},'computer.vision.configure'),undefined);
});

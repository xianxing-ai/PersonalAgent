import test from 'node:test';
import assert from 'node:assert/strict';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function snapshot(settings={}){return {settings:{language:'zh-CN',theme:'system',fontScale:1,calm:false,alwaysOnTop:true,snap:true,hover:true,shortcut:false,...settings},
  locale:'zh-CN',version:'synthetic',electron:'synthetic',platform:'linux',arch:'synthetic',displays:[],logs:'synthetic logs',windows:[]};}

async function fixture(t,invoke){
  const keys=['window','document','matchMedia'];
  const originals=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  t.after(()=>{for(const key of keys){const value=originals.get(key);if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}});
  const node=()=>({disabled:false,textContent:'',dataset:{},children:[],append(value){this.children.push(value);},replaceChildren(){this.children=[];}});
  const fields=Object.fromEntries(Object.entries(snapshot().settings).map(([key,value])=>[key,{...node(),type:typeof value==='boolean'?'checkbox':'select',value:'system',checked:false}]));
  const button=node(),controls=[...Object.values(fields),button];
  const form={elements:{namedItem:name=>fields[name]},querySelector:()=>button,querySelectorAll:()=>controls};
  const nodes=Object.fromEntries(['status','info','log','windows','refresh','logs'].map(key=>[key,node()]));
  let unload,themeChange;
  globalThis.document={title:'Desktop settings',documentElement:{lang:'zh-CN',dataset:{}},querySelector:selector=>selector==='form'?form:nodes[selector.slice(1)],
    querySelectorAll:()=>[],createElement:node};
  globalThis.window={localDesktop:{call:invoke},addEventListener:(type,listener)=>{if(type==='unload')unload=listener;}};
  globalThis.matchMedia=()=>({matches:false,addEventListener:(_type,listener)=>{themeChange=listener;}});
  await import(`../src/desktop-settings/settings.js?fixture=${Math.random()}`);
  return {fields,button,controls,nodes,submit:()=>form.onsubmit({preventDefault(){}}),refresh:()=>nodes.refresh.onclick(),
    unload:()=>unload?.(),themeChange:()=>themeChange()};
}

test('pending initial read disables form and queued submission cannot save',async t=>{
  const initial=deferred(),calls=[];
  const f=await fixture(t,(action,payload)=>{calls.push({action,payload});return initial.promise;});
  for(const control of f.controls)assert.equal(control.disabled,true);
  await f.submit();assert.deepEqual(calls.map(call=>call.action),['read']);
  initial.resolve(snapshot({fontScale:1.2,alwaysOnTop:false}));await settle();
  for(const control of f.controls)assert.equal(control.disabled,false);
  assert.equal(f.fields.fontScale.value,1.2);assert.equal(f.fields.alwaysOnTop.checked,false);
});

test('failed initial read remains unavailable and refresh initializes controls for retry',async t=>{
  const initial=deferred(),retry=deferred();let reads=0;
  const f=await fixture(t,action=>{assert.equal(action,'read');return ++reads===1?initial.promise:retry.promise;});
  initial.reject(Error('synthetic read failure'));await settle();assert.equal(f.nodes.status.textContent,'synthetic read failure');
  await f.submit();assert.equal(reads,1);assert.equal(f.button.disabled,true);
  const refreshing=f.refresh();retry.resolve(snapshot({language:'en',snap:false}));await refreshing;
  assert.equal(f.fields.language.value,'en');assert.equal(f.fields.snap.checked,false);
  assert.equal(f.button.disabled,false);assert.equal(f.nodes.status.textContent,'');
});

test('ready settings preserve the save protocol and later readback does not erase a new draft',async t=>{
  const saving=deferred(),calls=[];
  const f=await fixture(t,(action,payload)=>{calls.push({action,payload});return action==='save'?saving.promise:Promise.resolve(snapshot());});
  await settle();f.fields.fontScale.value='1.3';f.fields.hover.checked=false;
  const submitted=f.submit();assert.equal(f.button.disabled,true);
  const duplicate=f.submit();assert.equal(calls.filter(call=>call.action==='save').length,1);
  assert.deepEqual(calls.find(call=>call.action==='save').payload,{...snapshot().settings,fontScale:1.3,hover:false});
  f.fields.language.value='en';saving.resolve();await Promise.all([submitted,duplicate]);
  assert.equal(f.fields.language.value,'en');assert.equal(f.button.disabled,false);assert.equal(f.nodes.status.textContent,'已保存');
});

test('save failure keeps editable draft and restores the save button',async t=>{
  const f=await fixture(t,action=>action==='read'?Promise.resolve(snapshot()):Promise.reject(Error('synthetic save failure')));
  await settle();f.fields.language.value='en';await f.submit();
  assert.equal(f.fields.language.value,'en');assert.equal(f.button.disabled,false);
  assert.equal(f.nodes.status.textContent,'synthetic save failure');
});

test('unload ignores initial read, queued actions and system theme updates',async t=>{
  const initial=deferred(),calls=[];
  const f=await fixture(t,action=>{calls.push(action);return initial.promise;});
  f.unload();initial.resolve(snapshot({language:'en'}));await settle();
  await f.submit();await f.refresh();await f.nodes.logs.onclick();f.themeChange();
  assert.deepEqual(calls,['read']);assert.equal(f.fields.language.value,'system');assert.equal(f.button.disabled,true);
  assert.equal(f.nodes.info.textContent,'');assert.equal(f.nodes.status.textContent,'');
});

test('unload during save prevents a follow-up read and late UI feedback',async t=>{
  const saving=deferred(),calls=[];
  const f=await fixture(t,action=>{calls.push(action);return action==='read'?Promise.resolve(snapshot()):saving.promise;});
  await settle();const submitted=f.submit();f.unload();saving.resolve();await submitted;
  assert.deepEqual(calls,['read','save']);assert.equal(f.nodes.status.textContent,'');assert.equal(f.button.disabled,true);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../src/features/workspace/view.js',import.meta.url),'utf8');
const handler=source.split('form.onsubmit = ')[1]?.split('\n    };')[0];
const revision=source.match(/let updateRevision=0;/)?.[0];
const increment=source.match(/function update\(data\)\{\s*(updateRevision\+\+;)/)?.[1];
assert.ok(handler&&revision&&increment,'production city submit handler and update revision');
function fixture(){
  const calls=[],updates=[],submit={disabled:false},status={textContent:''};let closed=0;
  const context=vm.createContext({form:{querySelector:()=>submit},status,close:()=>closed++,
    FormData:class {get(){return ' 青岛 ';}},
    invoke:(name,payload)=>new Promise((resolve,reject)=>calls.push({name,payload,resolve,reject}))});
  vm.runInContext(revision,context);
  context.update=data=>{vm.runInContext(increment,context);updates.push(data);};
  const run=()=>vm.runInContext(`(${handler}})`,context)({preventDefault(){}});
  return {calls,updates,submit,status,run,update:context.update,closed:()=>closed};
}
const tick=()=>new Promise(setImmediate);
async function reading(f){const run=f.run();assert.equal(f.calls[0].name,'weather.configure');assert.equal(f.calls[0].payload.location,'青岛');f.calls[0].resolve();await tick();assert.equal(f.calls[1].name,'snapshot');return {run};}
test('weather readback cannot overwrite a newer subscription snapshot',async()=>{
  const f=fixture(),{run}=await reading(f);f.update('new subscribed city');f.calls[1].resolve('old city');await run;
  assert.deepEqual(f.updates,['new subscribed city']);assert.equal(f.closed(),1);
});
test('weather readback before subscription still updates, and later subscription wins',async()=>{
  const f=fixture(),{run}=await reading(f);f.calls[1].resolve('configured city');await run;f.update('new subscribed city');
  assert.deepEqual(f.updates,['configured city','new subscribed city']);
});
test('subscription during configuration does not discard the subsequent fresh readback',async()=>{
  const f=fixture(),run=f.run();f.update('during configure');f.calls[0].resolve();await tick();f.calls[1].resolve('fresh readback');await run;
  assert.deepEqual(f.updates,['during configure','fresh readback']);
});

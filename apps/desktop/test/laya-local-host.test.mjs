import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdir,mkdtemp,writeFile,rm,utimes} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalLayaHost} from '../electron/laya-local-host.js';

async function artifacts(t) {
  const cache=fileURLToPath(new URL('../../../.cache/laya-identity-test/',import.meta.url));
  await mkdir(cache,{recursive:true});const directory=await mkdtemp(path.join(cache,'case-'));
  const model=path.join(directory,'model'),script=path.join(directory,'batch-server.py');
  await mkdir(model);await writeFile(path.join(model,'model.safetensors'),'synthetic weights');
  await writeFile(path.join(model,'rl_agent_config.json'),'{"synthetic":true}');
  await writeFile(script,'# synthetic batch implementation');
  t.after(()=>rm(directory,{recursive:true,force:true}));
  return {python:'synthetic-python',model,script};
}
const healthy=()=>({ok:true,json:async()=>({status:'ok',model:'multilingual',capabilities:['multi_state'],maxStates:4})});
function fakeChild() {
  const child=new EventEmitter();child.kill=()=>{queueMicrotask(()=>child.emit('exit',0));return true;};return child;
}

test('local Laya requires free memory, owns one child, and revokes classification on stop', async t => {
  const config=await artifacts(t);
  let launches = 0, options, inferenceSignal, choiceSignal;
  const child = new EventEmitter();
  child.kill = () => {queueMicrotask(() => child.emit('exit', 0)); return true;};
  const setup = {projectRoot:'project', discover:() => config,
    launch:(_exe,_args,value) => {launches++; options=value; return child;},
    request:async (_url, value) => {assert.match(value.headers.authorization, /^Bearer [a-f0-9]{64}$/);
      return {ok:true, json:async () => ({status:'ok', model:'multilingual', capabilities:['multi_state'], maxStates:4})};},
    createService:() => ({classify:async value => {inferenceSignal=value.signal; return ['local'];}}),
    createChooser:()=>({choose:async value=>{choiceSignal=value.signal;return {state:'selected',selected:{id:'recheck',revision:1}};}})};
  const low = createLocalLayaHost({...setup, freeMemory:() => 512 * 1024 ** 2});
  assert.equal((await low.start()).state, 'memory_insufficient'); assert.equal(launches,0);
  const host = createLocalLayaHost({...setup, freeMemory:() => 8 * 1024 ** 3});
  assert.equal(host.readClassifierIdentity(),undefined);
  const [first, second] = await Promise.all([host.start(), host.start()]);
  assert.equal(first.ready,true); assert.equal(second.ready,true); assert.equal(launches,1);
  assert.match(host.readClassifierIdentity(),/^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(host.snapshot()),/synthetic-python|safetensors|batch-server|[a-f0-9]{64}/);
  assert.equal(options.windowsHide,true); assert.equal(options.shell,false);
  assert.equal(options.env.PA_AGENTARTS_AUTHORIZATION,undefined);
  assert.equal(options.env.HF_HUB_OFFLINE,'1');
  assert.deepEqual(await host.classify({signal:new AbortController().signal}), ['local']);
  assert.equal((await host.choose({signal:new AbortController().signal})).selected.id,'recheck');
  assert.equal((await host.stop()).state,'stopped'); assert.equal(inferenceSignal.aborted,true);
  assert.equal(choiceSignal.aborted,true);
  assert.equal(host.readClassifierIdentity(),undefined);
  await assert.rejects(host.classify({signal:new AbortController().signal}), /尚未就绪/);
  await assert.rejects(host.choose({signal:new AbortController().signal}), /尚未就绪/);
});

test('loaded identity is content-stable across restart and changes with weights, config or server',async t=>{
  const config=await artifacts(t);
  const host=createLocalLayaHost({projectRoot:'project',discover:()=>config,freeMemory:()=>8*1024**3,
    launch:fakeChild,request:async()=>healthy(),createService:()=>({classify:async()=>[]})});
  t.after(()=>host.stop());
  await host.start();const first=host.readClassifierIdentity();
  await host.stop();await host.start();assert.equal(host.readClassifierIdentity(),first);
  for(const location of [path.join(config.model,'model.safetensors'),path.join(config.model,'rl_agent_config.json'),config.script]) {
    const before=host.readClassifierIdentity();
    await writeFile(location,`synthetic changed ${path.basename(location)}`);
    assert.equal(host.readClassifierIdentity(),undefined);
    assert.equal(host.snapshot().state,'identity_changed');
    await assert.rejects(host.classify({signal:new AbortController().signal}),/尚未就绪/);
    await host.stop();await host.start();assert.notEqual(host.readClassifierIdentity(),before);
  }
  // Metadata-only changes revoke readiness conservatively, but a new explicit load keeps content identity stable.
  const unchanged=host.readClassifierIdentity();
  await utimes(config.script,new Date(1000),new Date(1000));
  assert.equal(host.snapshot().ready,false);await host.stop();await host.start();
  assert.equal(host.readClassifierIdentity(),unchanged);
});

test('cancellation and unknown or changed startup artifacts cannot publish an identity',async t=>{
  const config=await artifacts(t);let launches=0;
  const setup={projectRoot:'project',discover:()=>config,freeMemory:()=>8*1024**3,
    launch:()=>{launches++;return fakeChild();},request:async()=>healthy(),createService:()=>({classify:async()=>[]})};
  const cancelled=createLocalLayaHost(setup);
  const startup=cancelled.start();await cancelled.stop();await startup;
  assert.equal(launches,0);assert.equal(cancelled.snapshot().state,'stopped');
  assert.equal(cancelled.readClassifierIdentity(),undefined);
  const changed=createLocalLayaHost({...setup,sleep:async()=>{},request:async()=>{
    await writeFile(config.script,'# replaced during model load');return healthy();}});
  assert.equal((await changed.start()).state,'error');assert.equal(changed.readClassifierIdentity(),undefined);
  const missing=createLocalLayaHost({...setup,discover:()=>({...config,model:path.join(config.model,'missing')})});
  assert.equal((await missing.start()).state,'error');assert.equal(missing.readClassifierIdentity(),undefined);
  const exited=createLocalLayaHost({...setup,launch:()=>{const child=fakeChild();queueMicrotask(()=>child.emit('exit',1));return child;}});
  assert.equal((await exited.start()).ready,false);assert.equal(exited.readClassifierIdentity(),undefined);
});

async function inferenceFixture(t){
  const config=await artifacts(t),calls=[],releases=[];let active=0,peak=0,generation=0;
  const invoke=kind=>async input=>{active++;peak=Math.max(peak,active);calls.push({kind,generation,signal:input.signal});
    try{return await new Promise(resolve=>releases.push(()=>resolve(kind)));}finally{active--;}};
  const host=createLocalLayaHost({projectRoot:'project',discover:()=>config,freeMemory:()=>8*1024**3,
    launch:()=>{generation++;return fakeChild();},request:async()=>healthy(),
    createService:()=>({classify:invoke('classify')}),createChooser:()=>({choose:invoke('choose')})});
  t.after(async()=>{releases.splice(0).forEach(release=>release());await host.stop();});await host.start();
  return{host,calls,releases,get peak(){return peak;}};
}
const inferenceInput=()=>({signal:new AbortController().signal,deadline:new Date(Date.now()+60_000).toISOString()});
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('classify and choose share one generation-scoped inference admission',async t=>{
  const f=await inferenceFixture(t),first=f.host.classify(inferenceInput());await turn();
  const second=f.host.choose(inferenceInput()),third=f.host.classify(inferenceInput());await turn();
  assert.deepEqual(f.calls.map(c=>c.kind),['classify']);
  f.releases.shift()();assert.equal(await first,'classify');await turn();assert.equal(f.calls[1].kind,'choose');
  f.releases.shift()();assert.equal(await second,'choose');await turn();
  f.releases.shift()();assert.equal(await third,'classify');assert.equal(f.peak,1);
});
test('waiting caller cancellation returns without releasing the active inference slot',async t=>{
  const f=await inferenceFixture(t),first=f.host.classify(inferenceInput());await turn();
  const controller=new AbortController(),second=f.host.choose({...inferenceInput(),signal:controller.signal});
  const rejected=assert.rejects(second,{name:'AbortError'});controller.abort();await rejected;
  const third=f.host.choose(inferenceInput());await turn();assert.equal(f.calls.length,1);
  f.releases.shift()();await first;await turn();assert.equal(f.calls.length,2);
  f.releases.shift()();await third;assert.equal(f.peak,1);
});
test('waiting deadlines expire without provider dispatch and invalid deadlines fail before admission',async t=>{
  const f=await inferenceFixture(t),first=f.host.classify(inferenceInput());await turn();
  await assert.rejects(f.host.choose({...inferenceInput(),deadline:new Date(Date.now()+25).toISOString()}),{code:'TIMEOUT'});
  await assert.rejects(f.host.choose({...inferenceInput(),deadline:'invalid'}),{code:'INVALID_ARGUMENT'});
  await assert.rejects(f.host.choose({...inferenceInput(),deadline:new Date(0).toISOString()}),{code:'TIMEOUT'});
  assert.equal(f.calls.length,1);f.releases.shift()();await first;
});
test('stop cancels old waiters and restart cannot route them into the next model generation',async t=>{
  const f=await inferenceFixture(t),first=f.host.classify(inferenceInput());await turn();
  const firstRejected=assert.rejects(first,{name:'AbortError'});
  const waiting=f.host.choose(inferenceInput()),rejected=assert.rejects(waiting,{name:'AbortError'});
  await f.host.stop();await rejected;assert.equal(f.calls[0].signal.aborted,true);
  // Deliberately ignore active cancellation; its queued waiter still belongs to the old generation.
  await f.host.start();const fresh=f.host.choose(inferenceInput());await turn();
  assert.deepEqual(f.calls.map(c=>[c.kind,c.generation]),[['classify',1],['choose',2]]);
  f.releases.shift()();await firstRejected;await turn();assert.equal(f.calls.length,2);
  f.releases.shift()();await fresh;
});

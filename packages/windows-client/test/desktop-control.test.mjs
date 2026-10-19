import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {validateContract, validateToolValue} from '@personal-agent/contracts';
import {createWindowsDesktopControlHost, WINDOWS_DESKTOP_SCOPE, WINDOWS_DESKTOP_UPSTREAM} from '../dist/index.js';

const clock=Date.parse('2026-10-18T20:00:00.000Z');
const canonical=value=>value!==null&&typeof value==='object'?(Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`):JSON.stringify(value);
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const context=(input={},overrides={})=>({taskId:'task-1',runId:'run-1',authorizationRef:'grant-1',
  scopes:[WINDOWS_DESKTOP_SCOPE],signal:new AbortController().signal,deadline:new Date(clock+60000).toISOString(),argumentsDigest:digest(input),...overrides});
// v0.8.8 _snapshot_helpers.py emits list[str]; locked FastMCP serializes it as
// one text block containing a JSON array. This is not an invented structured UI object.
const snapshot=(title='Editor',handle='1234',tree='Button: Save (100,200)')=>({content:[{type:'text',text:JSON.stringify([
  `Cursor Position: (100,200)\nActive Desktop:\nName\n------\nDesktop 1\n\nAll Desktops:\nName\n------\nDesktop 1\n\nFocused Window:\nName      Depth  Status      Width  Height  Handle\n------  -------  --------  -------  ------  ------\n${title}       0  Normal        800     600    ${handle}\n\nOpened Windows:\nName      Depth  Status      Width  Height  Handle\n------  -------  --------  -------  ------  ------\n${title}       0  Normal        800     600    ${handle}\n\nUI Tree:\n${tree}`])}]});
function fixture(overrides={}){
  const calls=[],attempts=[];
  const backend={source:'synthetic',async start(){},async close(){},async call(name,args){calls.push({name,args});return name==='Snapshot'?snapshot():{content:[{type:'text',text:'Action sent.'}]};},...overrides.backend};
  const host=createWindowsDesktopControlHost({backend,now:()=>clock,authorizePresence:async()=>true,
    attempts:{async record(identity){if(attempts.some(item=>item.runId===identity.runId))throw Error('duplicate');attempts.push(identity);}},...overrides,backend});
  return {host,calls,attempts,tool:name=>host.tools.find(item=>item.descriptor.name===`computer.desktop.${name}`)};
}

test('missing configuration and Linux platform never advertise usable Windows controls',async()=>{
  const host=createWindowsDesktopControlHost({now:()=>clock});
  assert.deepEqual(host.tools,[]);assert.equal(host.health().state,'unavailable');
  await assert.rejects(host.start(context()),{code:'UNSUPPORTED_CAPABILITY'});
  if(process.platform!=='win32'){
    const configured=createWindowsDesktopControlHost({pythonExecutable:'/fake/python',attempts:{record:async()=>{}},authorizePresence:async()=>true});
    assert.deepEqual(configured.tools,[]);assert.equal(configured.health().configured,false);
  }
});
test('public descriptors expose only pinned UI controls, exact schemas, lifecycle and truthful recovery',async()=>{
  const f=fixture();assert.deepEqual(f.host.tools,[]);await f.host.start(context());
  assert.equal(WINDOWS_DESKTOP_UPSTREAM.version,'0.8.8');
  assert.deepEqual(f.host.tools.map(tool=>tool.descriptor.name.split('.').at(-1)),['observe','click','type','scroll','move','shortcut']);
  for(const tool of f.host.tools){validateContract('tool',tool.descriptor);assert.equal(tool.descriptor.requiresPresence,true);assert.equal(tool.descriptor.recoverySupport,false);}
  assert.throws(()=>validateToolValue(f.tool('click').descriptor.inputSchema,{targetRef:'f74ab5a9-51ee-4c14-b592-33b60fb443dd',label:1}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>validateToolValue(f.tool('observe').descriptor.inputSchema,{shell:'private'}),{code:'INVALID_ARGUMENT'});
  const registered=[];const release=f.host.register({register:tool=>{registered.push(tool);return()=>registered.splice(registered.indexOf(tool),1);}});
  assert.equal(registered.length,6);release();assert.equal(registered.length,0);
  await f.host.dispose();assert.deepEqual(f.host.tools,[]);
});
test('one original task observation authorizes only its bound arguments and returns action readback without goal success',async()=>{
  const f=fixture();await f.host.start(context());
  const observation=await f.tool('observe').execute({},context());
  validateToolValue(f.tool('observe').descriptor.outputSchema,observation);
  assert.equal(observation.source,'synthetic');assert.equal(observation.goalVerified,false);
  const args={targetRef:observation.targetRef,loc:[100,200],text:'do not echo this'};
  const output=await f.tool('type').execute(args,context(args));
  validateToolValue(f.tool('type').descriptor.outputSchema,output);
  assert.equal(output.state,'action_observed');assert.equal(output.goalVerified,false);
  assert.deepEqual(f.calls.map(item=>item.name),['Snapshot','Snapshot','Type','Snapshot']);
  assert.deepEqual(f.calls[2].args,{loc:[100,200],text:'do not echo this'});
  assert.deepEqual(f.attempts[0],{taskId:'task-1',runId:'run-1',toolName:'computer.desktop.type',toolVersion:'1.0.0',authorizationRef:'grant-1',argumentsDigest:digest(args),targetRef:observation.targetRef,observationDigest:observation.observationDigest});
  assert.doesNotMatch(JSON.stringify(output),/do not echo this/);
  await assert.rejects(f.tool('type').execute(args,context(args,{runId:'run-2'})),{code:'UNAUTHORIZED'});
  assert.equal(f.calls.filter(item=>item.name==='Type').length,1);
});
test('missing actual presence or a foreign task performs zero upstream calls',async()=>{
  const denied=fixture({authorizePresence:async()=>false});await denied.host.start(context());
  await assert.rejects(denied.tool('observe').execute({},context()),{code:'UNAUTHORIZED'});assert.equal(denied.calls.length,0);
  const f=fixture();await f.host.start(context());const seen=await f.tool('observe').execute({},context());
  const args={targetRef:seen.targetRef,loc:[1,2]};
  await assert.rejects(f.tool('click').execute(args,context(args,{taskId:'task-2'})),{code:'UNAUTHORIZED'});
  await assert.rejects(f.tool('click').execute(args,context(args,{argumentsDigest:'a'.repeat(64)})),{code:'UNAUTHORIZED'});
  assert.equal(f.attempts.length,0);assert.equal(f.calls.some(call=>call.name==='Click'),false);
});
test('ordinary text Snapshot errors, malformed snapshots and known protected windows fail closed',async()=>{
  for(const raw of [{content:[{type:'text',text:JSON.stringify(['Error capturing desktop state: private path'])}]},
    {content:[{type:'text',text:'Everything succeeded'}]},snapshot('Windows Security'),snapshot('PowerShell'),snapshot('登录'),
    snapshot('Editor','1234','Input: secret [password] [value:"private-password"]')]){
    const f=fixture({backend:{async call(){return raw;}}});await f.host.start(context());
    await assert.rejects(f.tool('observe').execute({},context()),error=>['EXTERNAL_FAILURE','UNAUTHORIZED'].includes(error.code)&&!error.message.includes('private path')&&!error.message.includes('private-password'));
    assert.equal(f.attempts.length,0);
  }
});
test('changed focused identity, stale UI tree and host target guard reject before writes',async()=>{
  for(const changed of [snapshot('Other','5678'),snapshot('Editor','1234','Button: Delete (10,20)')]){
    let reads=0;const f=fixture({backend:{async call(){return ++reads===1?snapshot():changed;}}});await f.host.start(context());
    const seen=await f.tool('observe').execute({},context());const args={targetRef:seen.targetRef,loc:[1,2]};
    await assert.rejects(f.tool('click').execute(args,context(args)),{code:'UNAUTHORIZED'});assert.equal(f.attempts.length,0);
  }
  const f=fixture({verifyTarget:async()=>false});await f.host.start(context());const seen=await f.tool('observe').execute({},context());
  const args={targetRef:seen.targetRef,loc:[1,2]};await assert.rejects(f.tool('click').execute(args,context(args)),{code:'UNAUTHORIZED'});assert.equal(f.attempts.length,0);
});
test('unknown dispatched results quarantine the provider and prohibit even a new target/run',async()=>{
  const f=fixture({backend:{async call(name){if(name==='Click')throw Error('private backend detail');return snapshot();}}});await f.host.start(context());
  const observe=f.tool('observe'),click=f.tool('click');const seen=await observe.execute({},context());const args={targetRef:seen.targetRef,loc:[1,2]};
  await assert.rejects(click.execute(args,context(args)),{code:'RESULT_UNKNOWN'});
  assert.equal(f.host.health().state,'blocked');assert.deepEqual(f.host.tools,[]);
  await assert.rejects(observe.execute({},context({}, {runId:'new-run'})),{code:'UNSUPPORTED_CAPABILITY'});
  await assert.rejects(f.host.start(context()),{code:'UNSUPPORTED_CAPABILITY'});assert.equal(f.attempts.length,1);
});
test('cancellation and expired deadlines do not dispatch and preserve their typed errors',async()=>{
  const f=fixture();await f.host.start(context());const controller=new AbortController();controller.abort();
  await assert.rejects(f.tool('observe').execute({},context({},{signal:controller.signal})),{code:'CANCELLED'});
  await assert.rejects(f.tool('observe').execute({},context({},{deadline:new Date(clock).toISOString()})),{code:'TIMEOUT'});assert.equal(f.calls.length,0);
});
test('a concurrent operation cannot share input ownership and disposed startup cannot resurrect tools',async()=>{
  let release;const wait=new Promise(resolve=>{release=resolve;});
  const f=fixture({backend:{async call(){await wait;return snapshot();}}});await f.host.start(context());
  const first=f.tool('observe').execute({},context());await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(f.tool('observe').execute({},context({},{runId:'run-2'})),{code:'REVISION_CONFLICT'});release();await first;
  let open;const starting=fixture({backend:{async start(){await new Promise(resolve=>{open=resolve;});}}});
  const startup=starting.host.start(context());await starting.host.dispose();open();
  await assert.rejects(startup,{code:'CANCELLED'});assert.deepEqual(starting.host.tools,[]);assert.equal(starting.host.health().state,'disposed');
});

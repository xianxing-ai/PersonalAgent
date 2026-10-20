import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import ts from 'typescript';
import {createDesktopVoiceStartupHost} from '../electron/voice-startup-host.js';
import {createLiveVoiceConfig} from '../electron/live-voice-config.js';

function fixture(overrides={}) {
  const calls=[];let active=false;
  let settings={configured:true,audioConsent:true,startupGreeting:true,continuousListening:true,...overrides};
  const liveVoice={async start(){calls.push('live-start');active=true;return {status:'listening'};},
    async stop(){calls.push('live-stop');active=false;},hasActive:()=>active};
  const host=createDesktopVoiceStartupHost({config:{snapshot:()=>({...settings})},liveVoice,
    output:{speak(){calls.push('greet');return {result:Promise.resolve(),async stop(){calls.push('greet-stop');}};}},
    async prepare(){calls.push('prepare');},async disposeOutput(){calls.push('output-dispose');}});
  return {host,calls,change:patch=>Object.assign(settings,patch)};
}

test('persistent flags default off, strict booleans survive real config reload without plaintext keys',t=>{
  const userData=mkdtempSync(path.join(os.tmpdir(),'pa-voice-startup-'));t.after(()=>rmSync(userData,{recursive:true,force:true}));
  const options={userData,safeStorage:{},competitionMode:true,readAgentArtsState:()=>({configured:true})};
  const config=createLiveVoiceConfig(options);
  assert.equal(config.snapshot().startupGreeting,false);assert.equal(config.snapshot().continuousListening,false);
  config.configure({hotkey:'F8',audioConsent:true,startupGreeting:true,continuousListening:true});
  const restored=createLiveVoiceConfig(options);
  assert.equal(restored.snapshot().continuousListening,true);assert.equal(restored.snapshot().startupGreeting,true);
  assert.throws(()=>restored.configure({continuousListening:'true'}));
  assert.equal(readFileSync(path.join(userData,'live-voice-config.json'),'utf8').includes('apiKey'),false);
});

test('saved startup consumes original output and Live; suspend/resume never repeats greeting',async()=>{
  const f=fixture();
  try {
    await f.host.start();await f.host.suspend();await f.host.resume();
    assert.equal(f.calls.filter(x=>x==='greet').length,1);
    assert.equal(f.calls.filter(x=>x==='live-start').length,2);
    await f.host.stop();await f.host.resume();
    assert.equal(f.calls.filter(x=>x==='live-start').length,2);
  }finally{await f.host.dispose();}
});

test('resume reads current disabled settings and never restores prior consent',async()=>{
  const f=fixture();
  try{await f.host.start();await f.host.suspend();f.change({continuousListening:false,startupGreeting:false});
    await f.host.resume();assert.equal(f.calls.filter(x=>x==='live-start').length,1);
  }finally{await f.host.dispose();}
});

test('unconfigured or audio-consent-missing startup never prepares or acquires',async()=>{
  for(const patch of [{configured:false},{audioConsent:false}]){
    const f=fixture(patch);
    await assert.rejects(f.host.start(),/启动语音未就绪/);assert.deepEqual(f.calls,[]);await f.host.dispose();
  }
});

test('disabled-by-default host never opens even a configured Live host',async()=>{
  const f=fixture({startupGreeting:false,continuousListening:false});
  await f.host.start();await f.host.resume();assert.deepEqual(f.calls,[]);await f.host.dispose();
});

test('main live.configure persists explicit opt-in, starts after save, and disables an owned active listener',async t=>{
  const source=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
  const ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  let route;
  function visit(node){if(ts.isIfStatement(node)&&node.expression.getText(ast)==="name === 'live.configure'")route=node.getText(ast);ts.forEachChild(node,visit);}
  visit(ast);assert.ok(route);
  const userData=mkdtempSync(path.join(os.tmpdir(),'pa-startup-action-'));t.after(()=>rmSync(userData,{recursive:true,force:true}));
  const config=createLiveVoiceConfig({userData,safeStorage:{},competitionMode:true,readAgentArtsState:()=>({configured:true})});
  const f=fixture({startupGreeting:false,continuousListening:false}), panel={},admin={};
  // The main route uses the actual config port, and its read side supplies current policy to the host.
  const originalConfigure=config.configure;
  config.configure=input=>{const result=originalConfigure(input);f.change(result);return result;};
  const context=vm.createContext({panel,admin,competitionMode:true,voiceConfigurationPending:false,
    voiceStartupHost:f.host,liveConfig:config,liveVoice:{hasActive:()=>false},voiceInput:undefined,
    stopWakeVoice:async()=>{},registerLiveShortcut(){},publish(){},queueMicrotask,
    reportPanelVoiceFailure:()=>assert.fail('configure startup failed'),Object,Error});
  const action=vm.runInContext(`(async function(sender,name,payload){${route}})`,context);
  await action(admin,'live.configure',{hotkey:'F8',audioConsent:true,startupGreeting:true,continuousListening:true});
  await new Promise(setImmediate);
  assert.equal(f.calls.filter(x=>x==='live-start').length,1);
  await action(admin,'live.configure',{hotkey:'F8',audioConsent:true,startupGreeting:false,continuousListening:false});
  await new Promise(setImmediate);await f.host.resume();
  assert.equal(f.calls.filter(x=>x==='live-start').length,1);
  assert.equal(config.snapshot().continuousListening,false);
  await assert.rejects(action({},'live.configure',{hotkey:'F8',audioConsent:true}),/可信/);
  await f.host.dispose();
});

test('main production lifecycle hooks call the actual startup host; hidden-panel aggregate stop reaches it',async()=>{
  const source=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
  const ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const hooks=[];
  function visit(node){
    if(ts.isCallExpression(node)&&node.expression.getText(ast)==='powerMonitor.on')hooks.push(node.getText(ast));
    if(ts.isCallExpression(node)&&node.expression.getText(ast)==='panel.webContents.once'&&node.arguments[0]?.text==='did-finish-load')hooks.push(node.getText(ast));
    ts.forEachChild(node,visit);
  }
  visit(ast);assert.equal(hooks.length,3);
  const f=fixture(), handlers=new Map();
  const context=vm.createContext({voiceStartupHost:f.host,reportPanelVoiceFailure:()=>assert.fail('lifecycle failed'),
    powerMonitor:{on:(name,callback)=>handlers.set(name,callback)},
    panel:{webContents:{once:(name,callback)=>handlers.set(name,callback)}}});
  vm.runInContext(hooks.join('\n'),context);
  handlers.get('did-finish-load')();await new Promise(setImmediate);
  handlers.get('suspend')();await new Promise(setImmediate);
  handlers.get('resume')();await new Promise(setImmediate);
  assert.equal(f.calls.filter(x=>x==='live-start').length,2);
  assert.equal(f.calls.filter(x=>x==='greet').length,1);
  const stop=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='stopPanelVoice');
  Object.assign(context,{stopWakeVoice:async()=>{},voiceInput:undefined,liveVoice:undefined,sisPlaybackHost:undefined,
    microphoneCaptureHost:undefined,Promise,Error,publish(){}});
  vm.runInContext(stop.getText(ast),context);await context.stopPanelVoice();
  handlers.get('resume')();await new Promise(setImmediate);
  assert.equal(f.calls.filter(x=>x==='live-start').length,2);await f.host.dispose();
});

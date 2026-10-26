import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createDesktopVoiceStartupHost} from '../electron/voice-startup-host.js';

const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.js', main, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let preparation;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'createDesktopVoiceStartupHost') {
    preparation = node.arguments[0].properties.find(property => property.name?.getText(ast) === 'prepare').getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(preparation, 'exercise the production startup preparation callback');

function deferred() {
  let resolve;
  const promise = new Promise(yes => {resolve = yes;});
  return {promise, resolve};
}

for (const operation of ['stop', 'suspend', 'dispose']) {
  test(`Local/Synthetic ${operation} during Wake preparation cannot reopen the panel`, async () => {
    const wakeRelease = deferred(), entered = deferred(), opened = [];
    const context = vm.createContext({voiceConfigurationPending:false, panelHiding:false,
      app:{isQuitting:false}, voiceInput:{hasActive:()=>false}, wakeVoice:{hasActive:()=>false},
      pinned:false, stopWakeVoice:()=>{entered.resolve();return wakeRelease.promise;},
      openPanel:value=>opened.push(value), publish(){}, Error});
    const prepare = vm.runInContext(`({${preparation}}).prepare`, context);
    const calls = [];
    const host = createDesktopVoiceStartupHost({
      config:{snapshot:()=>({configured:true,audioConsent:true,startupGreeting:true,continuousListening:true})},
      liveVoice:{hasActive:()=>false,async start(){calls.push('listen');return {status:'listening'};},async stop(){}},
      output:{speak(){calls.push('greet');return {result:Promise.resolve(),async stop(){}};}},
      prepare,
    });
    const starting = host.start();
    try {
      await entered.promise;
      await host[operation]();
      wakeRelease.resolve();
      await starting;
      assert.deepEqual(opened, [], 'cancelled preparation must not reopen a hidden or suspended panel');
      assert.deepEqual(calls, [], 'cancelled preparation must not greet or acquire Live');
    } finally {wakeRelease.resolve();await host.dispose();}
  });
}

test('Local/Synthetic current startup preparation still opens the panel and starts listening', async () => {
  const opened = [], calls = [];
  let active = false;
  const context = vm.createContext({voiceConfigurationPending:false, panelHiding:false,
    app:{isQuitting:false}, voiceInput:{hasActive:()=>false}, wakeVoice:{hasActive:()=>false},
    pinned:false, async stopWakeVoice(){}, openPanel:value=>opened.push(value), publish(){}, Error});
  const prepare = vm.runInContext(`({${preparation}}).prepare`, context);
  const host = createDesktopVoiceStartupHost({
    config:{snapshot:()=>({configured:true,audioConsent:true,startupGreeting:true,continuousListening:true})},
    liveVoice:{hasActive:()=>active,async start(){active=true;calls.push('listen');return {status:'listening'};},
      async stop(){active=false;}},
    output:{speak(){calls.push('greet');return {result:Promise.resolve(),async stop(){}};}}, prepare,
  });
  try {
    await host.start();
    assert.deepEqual(opened, [true]);
    assert.deepEqual(calls, ['greet', 'listen']);
    assert.equal(host.snapshot().state, 'listening');
  } finally {await host.dispose();}
});

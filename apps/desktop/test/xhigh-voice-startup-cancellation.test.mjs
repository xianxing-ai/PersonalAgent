import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createDesktopVoiceStartupHost} from '../electron/voice-startup-host.js';

const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.js', main, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const reportSource = ast.statements.find(node => ts.isFunctionDeclaration(node)
  && node.name?.text === 'reportPanelVoiceFailure').getText(ast);

function deferred() {
  let resolve;
  const promise = new Promise(yes => {resolve = yes;});
  return {promise, resolve};
}

function fixture({releaseFailure = false} = {}) {
  const entered = deferred(), greeting = deferred();
  const context = vm.createContext({runtimeError:'',publish(){}});
  vm.runInContext(reportSource, context);
  let releases = 0;
  const host = createDesktopVoiceStartupHost({
    config:{snapshot:()=>({configured:true,audioConsent:true,startupGreeting:true,continuousListening:true})},
    liveVoice:{hasActive:()=>false,async start(){assert.fail('cancelled greeting must not begin Live');},async stop(){}},
    output:{speak(){entered.resolve();return {result:greeting.promise,async stop(){
      releases++;
      if (releaseFailure) throw Error('synthetic output release failure');
    }};}}, async prepare(){},
  });
  return {host, entered, context, get releases(){return releases;}};
}

for (const operation of ['stop', 'suspend', 'dispose']) {
  test(`Local/Synthetic confirmed ${operation} of greeting does not report an unknown release`, async () => {
    const f = fixture();
    const starting = f.host.start().catch(f.context.reportPanelVoiceFailure);
    await f.entered.promise;
    const stopped = await f.host[operation]();
    await starting;
    assert.equal(stopped.resourcesReleased, true);
    assert.equal(f.releases, 1);
    assert.equal(f.context.runtimeError, '', 'successful cancellation must not publish the main resource-release failure');
    await f.host.dispose();
  });
}

test('Local/Synthetic cancellation still reports a genuinely unconfirmed greeting release', async () => {
  const f = fixture({releaseFailure:true});
  const starting = f.host.start().catch(f.context.reportPanelVoiceFailure);
  await f.entered.promise;
  await assert.rejects(f.host.stop(), /释放未确认/);
  await starting;
  assert.equal(f.host.snapshot().resourcesReleased, false);
  assert.equal(f.host.snapshot().state, 'release_unconfirmed');
  assert.match(f.context.runtimeError, /释放未确认/);
  assert.equal(f.releases, 1);
  await assert.rejects(f.host.dispose(), /释放未确认/);
});

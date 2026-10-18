import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {createLiveVoiceHost} from '../electron/live-voice-host.js';

const source = await readFile(new URL('../electron/main.js',import.meta.url),'utf8');
const ast = ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let quitBranch;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'app.on'
    && node.arguments[0]?.getText(ast) === "'before-quit'") {
    function find(branch) {
      if (ts.isIfStatement(branch) && branch.expression.getText(ast) === 'liveVoice?.hasActive()') quitBranch = branch.getText(ast);
      ts.forEachChild(branch,find);
    }
    find(node.arguments[1]);
  }
  ts.forEachChild(node,visit);
}
visit(ast);
assert.ok(quitBranch);

function fixture({releaseFails = false} = {}) {
  let live, quitCalls = 0, prevented = 0, publishes = 0, sessionCloses = 0;
  const contents = {mainFrame:{},isDestroyed:()=>false,send(_channel,message) {
    if (message.type === 'stop' && releaseFails) throw Error('synthetic playback stop delivery failure');
    if (['start','stop'].includes(message.type)) queueMicrotask(()=>live.receive(
      {sender:contents,senderFrame:contents.mainFrame},{token:message.token,type:message.type === 'start' ? 'ready' : 'stopped'}));
  }};
  live = createLiveVoiceHost({getPanel:()=>({webContents:contents,isDestroyed:()=>false,isVisible:()=>true}),
    config:{snapshot:()=>({configured:true}),current:()=>({})},microphoneHost:{authorize(){},async revoke(){}},
    createSource:()=>({subscribe:()=>({ready:Promise.resolve(),closed:Promise.resolve(),unsubscribe(){}}),async dispose(){}}),
    createGateway:()=>({async connect(){return {sendAudio(){},interrupt(){},async close(){sessionCloses++;}};}}),
    createConsumer:()=>({}),readContext:()=>'',client:{}});
  const event = {preventDefault(){prevented++;}};
  const context = vm.createContext({liveVoice:live,app:{quit(){quitCalls++;}},runtimeError:'',publish(){publishes++;},Error});
  const beforeQuit = vm.runInContext(`(event)=>{${quitBranch}}`,context);
  return {live,context,quit:()=>beforeQuit(event),get quitCalls(){return quitCalls;},get prevented(){return prevented;},
    get publishes(){return publishes;},get sessionCloses(){return sessionCloses;}};
}
const tick = () => new Promise(setImmediate);

test('unconfirmed Live release blocks exit without recursively retrying app.quit', async () => {
  const f = fixture({releaseFails:true});
  await f.live.start();
  f.quit(); await tick();
  assert.equal(f.prevented,1);
  assert.equal(f.quitCalls,0);
  assert.equal(f.live.hasActive(),true);
  assert.match(f.context.runtimeError,/释放未确认/);
  assert.equal(f.publishes,1);
  f.quit(); await tick();
  assert.equal(f.quitCalls,0,'repeated user quit cannot restart the recursive quit path');
  assert.equal(f.sessionCloses,1,'already attempted resource release is not retried');
  await f.live.dispose();
});

test('confirmed Live release resumes app.quit after closing the session once', async () => {
  const f = fixture();
  await f.live.start();
  f.quit(); await tick();
  assert.equal(f.prevented,1);
  assert.equal(f.quitCalls,1);
  assert.equal(f.live.hasActive(),false);
  assert.equal(f.context.runtimeError,'');
  assert.equal(f.sessionCloses,1);
  await f.live.dispose();
});

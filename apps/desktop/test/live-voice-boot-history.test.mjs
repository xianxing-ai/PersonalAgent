import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {Conversations} from '../electron/conversations.js';
import {createLiveVoiceHistory} from '../electron/live-voice-history.js';
import {createLiveVoiceHost} from '../electron/live-voice-host.js';
import {createLiveHistoryFileStore} from '../electron/live-history-file-store.js';

const mainText = await readFile(new URL('../electron/main.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.js', mainText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const initializer = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'initializeLiveVoice');
assert.ok(initializer);
// Only the dynamic package import is an explicit Fake seam. The original main
// initializer, including its Host construction and Conversations sink, is retained.
const source = initializer.getText(ast).replace("await import('@personal-agent/voice')", 'voicePorts');
const message = {id:'synthetic-recovered-voice',sessionId:'synthetic-prior-live',role:'assistant',
  text:'Synthetic local history',createdAt:'2026-10-07T12:00:00.000Z'};

async function fixture(t) {
  const directory = await mkdtemp(path.resolve('.cache/live-boot-history-test-'));
  const cacheFile = path.join(directory, 'live-history-recovery.json');
  const conversationFile = path.join(directory, 'conversations.json');
  const store = createLiveHistoryFileStore(cacheFile);
  let resourceCalls = 0, taskCalls = 0, publications = 0, failSink = false;
  const noResource = () => {resourceCalls++; assert.fail('Boot recovery cannot open voice resources');};
  const pendingTimers = new Set();
  const schedule = callback => {const token={callback,unref(){}};pendingTimers.add(token);return token;};
  const hosts = [];
  const boot = async () => {
    const conversations = new Conversations(conversationFile);
    const originalSink = conversations.addLiveMessage.bind(conversations);
    conversations.addLiveMessage = value => {
      if (failSink) throw Error('Synthetic history sink unavailable');
      return originalSink(value);
    };
    const context = vm.createContext({competitionMode:true,client:{call(){taskCalls++;assert.fail('No task at boot');}},
      // Voice package factories, microphone and Gateway are explicit Fakes that
      // reject any use. History, FileStore, Conversations and Host remain real.
      voicePorts:{createVoicePcmFrameSourcePort:noResource,createRuntimeClientTranscriptConsumer:noResource},
      liveVoice:undefined,panel:undefined,liveConfig:{snapshot:()=>({configured:false}),current:()=>undefined},
      microphoneCaptureHost:{get binding(){return noResource();},snapshot:()=>({busy:false})},
      runtimeApplication:{createLiveVoiceModel:noResource},conversations,taskGoals:new Map(),path,
      app:{getPath:name=>{assert.equal(name,'userData');return directory;}},createLiveHistoryFileStore,
      createLiveVoiceHost:options=>{const host=createLiveVoiceHost({...options,schedule,unschedule:token=>pendingTimers.delete(token)});hosts.push(host);return host;},
      publish(){publications++;},noteVoiceLevel(){}});
    vm.runInContext(source, context);
    await context.initializeLiveVoice();
    return {host:context.liveVoice,conversations};
  };
  t.after(async()=>{for(const host of hosts)await host.dispose();assert.equal(pendingTimers.size,0);});
  return {store,cacheFile,conversationFile,boot,pendingTimers,seed(value=message){
    createLiveVoiceHistory({save(){throw Error('Synthetic prior process sink failure');},recoveryStore:store}).record(value);
  },setFailSink(value){failSink=value;},counts:()=>({resourceCalls,taskCalls,publications})};
}

test('original Desktop boot restores durable pending history without a Live session', async t => {
  const f=await fixture(t);f.seed();
  const {host,conversations}=await f.boot();
  assert.deepEqual(conversations.messagesFor('panel').map(value=>value.id),[message.id]);
  assert.equal(new Conversations(f.conversationFile).messagesFor('panel')[0].text,message.text);
  assert.deepEqual(JSON.parse(await readFile(f.cacheFile,'utf8')).messages,[]);
  assert.equal(host.snapshot().active,false);assert.equal(host.snapshot().historyPersistence.pending,0);
  assert.equal(host.snapshot().historyPersistence.durable,true);
  assert.deepEqual(f.counts(),{resourceCalls:0,taskCalls:0,publications:1});
});

test('boot recovery deduplicates repeated disk reopen and preserves existing transcript chronology on revision', async t => {
  const f=await fixture(t);const original=new Conversations(f.conversationFile);original.addLiveMessage(message);
  f.seed({...message,text:'Synthetic revised transcript',createdAt:'2026-10-08T12:00:00.000Z'});
  const first=await f.boot();const second=await f.boot();
  for(const {conversations} of [first,second]) {
    const messages=conversations.messagesFor('panel');assert.equal(messages.length,1);
    assert.equal(messages[0].id,message.id);assert.equal(messages[0].text,'Synthetic revised transcript');
    assert.equal(messages[0].createdAt,message.createdAt);
  }
  assert.deepEqual(new Conversations(f.conversationFile).messagesFor('panel'),second.conversations.messagesFor('panel'));
  assert.equal(f.counts().resourceCalls,0);assert.equal(f.counts().taskCalls,0);
});

test('failed boot history sink retains durable cache and permits local recovery without opening audio', async t => {
  const f=await fixture(t);f.seed();f.setFailSink(true);
  const {host,conversations}=await f.boot();
  assert.equal(conversations.messagesFor('panel').length,0);
  assert.equal(host.snapshot().historyPersistence.pending,1);assert.equal(host.snapshot().historyPersistence.durable,true);
  assert.equal(JSON.parse(await readFile(f.cacheFile,'utf8')).messages[0].id,message.id);
  assert.equal(f.pendingTimers.size,1,'failed local flush schedules its existing bounded retry');
  f.setFailSink(false);host.flushHistory();
  assert.equal(f.pendingTimers.size,0);assert.equal(conversations.messagesFor('panel')[0].id,message.id);
  assert.equal(host.snapshot().historyPersistence.pending,0);assert.equal(host.snapshot().active,false);
  assert.equal(f.counts().resourceCalls,0);assert.equal(f.counts().taskCalls,0);
});

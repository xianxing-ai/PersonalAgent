import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {EventEmitter} from 'node:events';
import {createSnapshotPublisher} from '../electron/snapshot-publisher.js';

// publish() now marks the original coalescing publisher. The orb has its own tiny
// projection; windows sharing a surface still share one build within a flush.

const source = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let publishSource;
(function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'publish') publishSource = node.getText(ast);
  ts.forEachChild(node, visit);
})(ast);

function run(t) {
  const sent = [];
  const surfaces = [];
  const window = name => Object.assign(new EventEmitter(),{name,isVisible:()=>true,isMinimized:()=>false,isDestroyed:()=>false,
    webContents:Object.assign(new EventEmitter(),{send:(channel,payload)=>sent.push({name,channel,payload})})});
  const publisher=createSnapshotPublisher({project(surface){surfaces.push(surface);return surface==='orb'?{orb:true}:{surface,tasks:[]};},schedule:()=>0});
  t.after(()=>publisher.close());
  const context = vm.createContext({
    snapshotPublisher:publisher,runtimeClosed: false,draftQuitPreflight:undefined,runtimeError:'',
    orb: window('orb'),
    panel: window('panel'),
    admin: window('admin'),
    workspace: window('workspace'),
    subagentWindows: new Map(),
    snapshot(surface) {
      surfaces.push(surface);
      return {surface, tasks: []};
    },
  });
  for(const [name,surface]of [['orb','orb'],['panel','panel'],['admin',undefined],['workspace','workspace']])publisher.attach(context[name],surface);
  vm.runInContext(publishSource, context);
  return {context, sent, surfaces,publisher,window};
}

test('one coalesced broadcast builds each surface once while the orb stays lightweight', t => {
  const {context, sent, surfaces,publisher,window} = run(t);
  publisher.attach(window('panel-mirror'),'panel');
  vm.runInContext('publish()', context);
  assert.deepEqual(sent,[],'marking a topic does not synchronously publish full snapshots');publisher.flush();

  assert.deepEqual(surfaces, ['orb','panel', undefined, 'workspace'], 'two panel windows share a single panel build');
  assert.deepEqual(sent.map(item => item.name), ['orb', 'panel', 'admin', 'workspace','panel-mirror'], 'every open window still receives an update');
  assert.equal(sent.every(item => item.channel === 'desktop:update'), true);
  assert.equal(sent[1].payload.tasks, sent[4].payload.tasks, 'panel windows receive the same built projection');
  assert.equal(sent[0].payload.orb,true);assert.equal(sent[0].payload.tasks,undefined);
  assert.notEqual(sent[0].payload, sent[2].payload, 'a different surface is a different build');
  assert.equal(sent[2].payload.surface, undefined);
  assert.equal(sent[3].payload.surface, 'workspace');
});

test('a destroyed window neither receives an update nor forces a build', t => {
  const {context, sent, surfaces,publisher} = run(t);
  context.admin.isDestroyed = () => true;
  vm.runInContext('publish()', context);
  publisher.flush();

  assert.deepEqual(surfaces, ['orb','panel', 'workspace'], 'the admin-only surface is not built when admin is gone');
  assert.deepEqual(sent.map(item => item.name), ['orb', 'panel', 'workspace']);
});

test('a closed runtime publishes nothing at all', t => {
  const {context, sent, surfaces,publisher} = run(t);
  publisher.flush();
  for(const item of sent)publisher.ack(context[item.name],item.payload.delivery);
  sent.length=0;surfaces.length=0;
  const revision=publisher.revision();
  context.runtimeClosed = true;
  vm.runInContext('publish()', context);
  publisher.flush();

  assert.equal(publisher.revision(),revision,'closed Runtime cannot mark a later publication');
  assert.deepEqual(surfaces, []);
  assert.deepEqual(sent, []);
});

test('unrelated runtime errors never unlock a prepared quit during ordinary publishing', t => {
  const {context}=run(t);
  context.draftQuitPreflight={cancel(){assert.fail('ordinary runtime feedback must not cancel quit');}};
  context.runtimeError='unrelated configuration feedback';
  vm.runInContext('publish()',context);
});

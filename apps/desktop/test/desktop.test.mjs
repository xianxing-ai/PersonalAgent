import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@personal-agent/client';
import {FakeRuntime} from '@personal-agent/testkit';
import {panelBounds,clampOrb,draggedGroupBounds} from '../electron/placement.js';
import {orbState} from '../src/features/conversation/state.js';
import {submitConversationTask} from '../electron/runtime.js';

test('competition conversation gives Runtime a cloud execution deadline without changing query deadlines', async () => {
  const runtime = new FakeRuntime({mode: 'test', scenario: 'cancel'});
  const requests = [];
  const client = new Client({send(request, signal) {
    requests.push(request);
    return runtime.send(request, signal);
  }}, () => runtime.clock.now());
  await client.connect();
  const {taskId} = await submitConversationTask(client,
    {goal: '输出九九乘法表', conversationId: 'desktop-panel'}, {competition: true});
  const submitted = requests.at(-1);
  assert.equal(Date.parse(submitted.deadline) - runtime.clock.now(), 180_000);
  assert.ok(submitted.idempotencyKey);
  await client.call('task.get', {taskId});
  assert.equal(Date.parse(requests.at(-1).deadline) - runtime.clock.now(), 10_000);
});
test('configured context compaction reserves bounded task time without extending ordinary tasks', async () => {
  const calls=[];
  const client={call:async(...args)=>{calls.push(args);return {taskId:'synthetic'};}};
  await submitConversationTask(client,{goal:'ordinary continuation',conversationId:'synthetic'},
    {competition:true,contextCompaction:true});
  assert.equal(calls.at(-1)[2].timeoutMs,600_000);
  await submitConversationTask(client,{goal:'/压缩',conversationId:'synthetic'},{contextCompaction:true});
  assert.equal(calls.at(-1)[2].timeoutMs,undefined);
});
test('panel stays within negative-origin and small display work areas',()=>{
  for(const area of [{x:-1920,y:0,width:1920,height:1080},{x:0,y:-800,width:1280,height:800},{x:0,y:0,width:320,height:480}]) {
    const orb=clampOrb({x:area.x+area.width-112,y:area.y+area.height-112,width:112,height:112},area);
    const panel=panelBounds(orb,area);
    assert.ok(panel.x>=area.x&&panel.y>=area.y);
    assert.ok(panel.x+panel.width<=area.x+area.width&&panel.y+panel.height<=area.y+area.height);
    assert.equal(panel.width,Math.min(420,area.width));
  }
});
test('dragged panel and orb reach right corners while panel automatically flips left',()=>{
  const area={x:0,y:0,width:1920,height:1080};
  const orbStart={x:500,y:400,width:112,height:112};
  const pointerStart={x:550,y:450};
  for(const point of [{x:2500,y:-500},{x:2500,y:1800}]) {
    const next=draggedGroupBounds(orbStart,pointerStart,point,area);
    assert.equal(next.orb.x,1808);
    assert.equal(next.panel.x,1380);
    assert.ok(next.panel.x+next.panel.width<=next.orb.x);
    assert.ok(next.orb.y===0||next.orb.y===968);
    assert.ok(next.panel.y>=area.y&&next.panel.y+next.panel.height<=area.height);
  }
});
test('public client cancel remains waiting until runtime confirms terminal state',async()=>{
  const runtime=new FakeRuntime({mode:'test',scenario:'cancel'});
  const client=new Client(runtime,()=>runtime.clock.now()); await client.connect();
  const {taskId}=await client.call('task.submit',{goal:'桌面联调',conversationId:'test'},{idempotencyKey:'desktop-test'});
  const result=await client.call('task.cancel',{taskId});assert.equal(result.state,'cancelling');
  assert.equal(orbState(result),'waiting');runtime.advance(taskId);
  const task=await client.call('task.get',{taskId});assert.equal(task.state,'cancelled');assert.equal(orbState(task),'idle');
});
test('thinking configuration is applied to Runtime Application and affects task execution steps', async () => {
  const {createRuntimeApplication} = await import('@personal-agent/runtime/application');
  const app = createRuntimeApplication({
    path: ':memory:',
    text: {mode: 'fake'},
  });
  const state = app.configureThinking({depth: 3, fast: true});
  assert.equal(state.applied, true);
  assert.equal(state.depth, 3);
  assert.equal(state.fast, true);
  assert.equal(state.maxSteps, 6);
  assert.match(state.reason, /思考深度已传入 Runtime/);
  app.close();
});

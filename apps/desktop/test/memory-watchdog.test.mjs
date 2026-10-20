import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {selectOverLimitRenderer, createMemoryWatchdog, DEFAULT_MEMORY_LIMIT_BYTES} from '../electron/memory-watchdog.js';

/** Electron reports workingSetSize in kilobytes. */
const megabytes = value => value * 1024;
const limit = 1.5 * 1024 ** 3;

test('selects only the heaviest renderer above the limit', () => {
  const metrics = [
    {pid: 1, type: 'Tab', memory: {workingSetSize: megabytes(900)}},
    {pid: 2, type: 'Tab', memory: {workingSetSize: megabytes(2000)}},
    {pid: 3, type: 'Tab', memory: {workingSetSize: megabytes(1700)}},
    {pid: 4, type: 'Browser', memory: {workingSetSize: megabytes(3000)}},
  ];
  assert.deepEqual(selectOverLimitRenderer(metrics, limit), {pid: 2, bytes: megabytes(2000) * 1024});
});

test('healthy or malformed metrics never trigger a reload', () => {
  assert.equal(selectOverLimitRenderer([{pid: 1, type: 'Tab', memory: {workingSetSize: megabytes(800)}}], limit), undefined);
  assert.equal(selectOverLimitRenderer([], limit), undefined);
  assert.equal(selectOverLimitRenderer(undefined, limit), undefined);
  assert.equal(selectOverLimitRenderer([{pid: 1, type: 'Tab', memory: {workingSetSize: 'big'}}], limit), undefined);
  assert.equal(selectOverLimitRenderer([{pid: 1, type: 'Tab', memory: {workingSetSize: -1}}], limit), undefined);
  assert.equal(DEFAULT_MEMORY_LIMIT_BYTES, 1.5 * 1024 ** 3);
});

test('reloads once, honours the cooldown and never reloads while work is running', async () => {
  let reloads = 0, busy = false, now = 1_000;
  const contents = {isDestroyed: () => false, reload: () => {reloads++;}};
  const watchdog = createMemoryWatchdog({
    getMetrics: () => [{pid: 9, type: 'Tab', memory: {workingSetSize: megabytes(2_000)}}],
    resolveTarget: pid => pid === 9 ? contents : undefined,
    isBusy: () => busy, now: () => now, cooldownMs: 1_000,
    intervalMs: 60_000, setInterval: () => 0, clearInterval: () => {},
  });
  assert.deepEqual(await watchdog.tick(), {pid: 9, bytes: megabytes(2_000) * 1024});
  assert.equal(reloads, 1);
  assert.equal(await watchdog.tick(), undefined, 'the cooldown prevents a reload loop');
  now += 1_001;
  busy = true;
  assert.equal(await watchdog.tick(), undefined, 'an active task suppresses reclamation');
  assert.equal(reloads, 1);
  busy = false;
  assert.equal((await watchdog.tick()).pid, 9);
  assert.equal(reloads, 2);
});

test('a pid that is not one of our windows is never reloaded', async () => {
  let reloads = 0;
  const watchdog = createMemoryWatchdog({
    getMetrics: () => [{pid: 7, type: 'Tab', memory: {workingSetSize: megabytes(2_000)}}],
    resolveTarget: () => undefined,
    now: () => 1_000, setInterval: () => 0, clearInterval: () => {},
  });
  assert.equal(await watchdog.tick(), undefined);
  assert.equal(reloads, 0);
});

test('a destroyed renderer is skipped instead of throwing', async () => {
  const watchdog = createMemoryWatchdog({
    getMetrics: () => [{pid: 8, type: 'Tab', memory: {workingSetSize: megabytes(2_000)}}],
    resolveTarget: () => ({isDestroyed: () => true, reload: () => {throw Error('must not reload');}}),
    now: () => 1_000, setInterval: () => 0, clearInterval: () => {},
  });
  assert.equal(await watchdog.tick(), undefined);
});

test('a task starting during the asynchronous renderer check prevents reload',async()=>{
  let ready,busy=false,reloads=0;
  const watchdog=createMemoryWatchdog({getMetrics:()=>[{pid:1,type:'Tab',memory:{workingSetSize:megabytes(2000)}}],
    resolveTarget:()=>new Promise(resolve=>{ready=resolve;}),isBusy:()=>busy,
    now:()=>2_000_000});
  const pending=watchdog.tick();busy=true;
  ready({reload:()=>reloads++});await pending;assert.equal(reloads,0);
});
test('renderer inspection failure and overlapping ticks cannot reload an unchecked page',async()=>{
  let reject,checks=0,reloads=0;
  const watchdog=createMemoryWatchdog({getMetrics:()=>[{pid:1,type:'Tab',memory:{workingSetSize:megabytes(2000)}}],
    resolveTarget:()=>{checks++;return new Promise((_,no)=>{reject=no;});},now:()=>2_000_000});
  const pending=watchdog.tick();await watchdog.tick();assert.equal(checks,1);
  reject(Error('inspection unavailable'));assert.equal(await pending,undefined);assert.equal(reloads,0);
});

const hostSource=await readFile(new URL('../electron/main.js',import.meta.url),'utf8');
const hostAst=ts.createSourceFile('main.js',hostSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let hostOptions;
function capture(node){
  if(ts.isCallExpression(node)&&node.expression.getText(hostAst)==='createMemoryWatchdog')hostOptions=node.arguments[0];
  ts.forEachChild(node,capture);
}
capture(hostAst);assert.ok(hostOptions,'actual host watchdog composition');
const hostProperty=name=>hostOptions.properties.find(node=>node.name?.getText(hostAst)===name).initializer.getText(hostAst);
function hostFixture({empty=true,inspectionFails=false,live=false}={}){
  let inspections=0;
  const window=pid=>({isDestroyed:()=>false,webContents:{getOSProcessId:()=>pid,executeJavaScript:async script=>{
    inspections++;assert.match(script,/\.composer textarea/);if(inspectionFails)throw Error('unavailable');return empty;
  }}});
  const panel=window(1),admin=window(2),child=window(3),workspace=window(4),orb=window(5);
  const context=vm.createContext({panel,admin,workspace,orb,subagentWindows:new Map([['child',{window:child}]]),
    console:{warn(){}},runtimeClosed:false,runtimeStartup:{snapshot:()=>({state:'ready'})},runtimeApplication:{activeTaskCount:0},
    submitting:new Set(),voiceConfigurationPending:false,panelHiding:false,liveVoice:{hasActive:()=>live},
    voiceInput:undefined,wakeVoice:undefined,microphoneCaptureHost:undefined});
  return {panel,orb,context,resolve:vm.runInContext('('+hostProperty('resolveTarget')+')',context),
    busy:vm.runInContext('('+hostProperty('isBusy')+')',context),get inspections(){return inspections;}};
}
test('actual host retains all editable surfaces and reclaims only the stateless orb',async()=>{
  const f=hostFixture();
  for(const pid of [1,2,3,4])assert.equal(await f.resolve(pid),undefined);
  assert.equal(f.inspections,0);assert.equal(await f.resolve(5),f.orb.webContents);
});
test('actual host suppresses recycling during Live, microphone and accepted-task submission',()=>{
  assert.equal(hostFixture({live:true}).busy(),true);
  const f=hostFixture();assert.equal(f.busy(),false);f.context.submitting.add('conversation');assert.equal(f.busy(),true);
  f.context.submitting.clear();f.context.microphoneCaptureHost={snapshot:()=>({busy:true})};assert.equal(f.busy(),true);
});
test('stopping the watchdog invalidates an in-flight renderer check',async()=>{
  let ready,reloads=0;
  const watchdog=createMemoryWatchdog({getMetrics:()=>[{pid:1,type:'Tab',memory:{workingSetSize:megabytes(2000)}}],
    resolveTarget:()=>new Promise(resolve=>{ready=resolve;}),now:()=>2_000_000});
  const pending=watchdog.tick();watchdog.stop();ready({reload:()=>reloads++});await pending;
  assert.equal(reloads,0);assert.equal(watchdog.reloadedAt.size,0);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, mkdir, writeFile, readFile, rm, rename, link, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWikiImportHost} from '../electron/wiki-import-host.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'personal-agent-wiki-host-'));
  t.after(() => rm(root, {recursive:true,force:true}));
  const input = join(root,'input'), library = join(root,'library'), userData = join(root,'user-data');
  await mkdir(input); await mkdir(library);
  const file = join(input,'公开测试.md'); await writeFile(file, '# 合成资料\n蓝色海豚项目，预算 2500 元。');
  const picks = {files:[file],folder:input,library};
  // Explicit Fake security storage. No real credentials or user data are used by these tests.
  const safeStorage = {isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()};
  const calls = []; let taskState = 'waiting_approval', result, capabilities = {available:true,modelLabel:'合成 AgentArts Wiki'};
  const runtime = {capabilities:()=>capabilities,
    async start(input) {calls.push({name:'start',input}); return {task:{taskId:'wiki-task',state:taskState,revision:1}};},
    async read(taskId) {calls.push({name:'read',taskId});return {task:{taskId,state:taskState,revision:2},...(result ? {confirmed:{result}} : {})};},
    async cancel(taskId) {taskState='cancelled';return runtime.read(taskId);},
    async recover(taskId) {calls.push({name:'recover',taskId});taskState='waiting_approval';return runtime.read(taskId);},
    async search(input) {calls.push({name:'search',input});return {hits:[]};},
    async readPage(input) {calls.push({name:'readPage',input});return {content:'# 合成页面'};},
    async readSource(input) {calls.push({name:'readSource',input});return {text:'合成原文'};}};
  const options = {userData,safeStorage,namespace:'synthetic',hostIdentity:'synthetic-host',
    selectFiles:async()=>picks.files,selectFolder:async()=>picks.folder,selectLibrary:async()=>picks.library};
  const host = await createWikiImportHost(options); t.after(()=>host.close()); host.bind(runtime);
  return {root,input,library,userData,file,picks,calls,options,host,runtime,
    state(value) {taskState=value;}, result(value) {result=value;}, capabilities(value) {capabilities=value;}};
}
async function select(f) {await f.host.action('selectFiles');await f.host.action('selectLibrary');return f.host.snapshot();}
const input = snapshot => ({selectionId:snapshot.selection.selectionId,revision:snapshot.selection.revision,libraryId:snapshot.library.libraryId});
const context = () => ({signal:new AbortController().signal,deadline:new Date(Date.now()+60000).toISOString()});
const start = snapshot => ({selectionId:snapshot.selection.selectionId,revision:snapshot.selection.revision,maxCalls:32,maxTokens:128000,timeoutMinutes:60});

test('native selection exposes metadata and opaque IDs; task arguments never contain paths or document bodies', async t => {
  const f = await fixture(t), snapshot = await select(f);
  assert.equal(snapshot.available,true); assert.equal(snapshot.selection.files.length,1);
  assert.equal(JSON.stringify(snapshot).includes(f.root),false);
  assert.equal(JSON.stringify(snapshot).includes('2500'),false);
  const stored = await readFile(join(f.userData,'wiki-import-config.json'),'utf8');
  assert.equal(stored.includes(f.root),false);
  const lease = await f.host.runtimeOptions.source.acquire(input(snapshot),context());
  assert.equal(Buffer.from(lease.sources[0].bytes).toString().includes('2500'),true);
  assert.match(lease.manifestDigest,/^[a-f0-9]{64}$/); assert.match(lease.libraryBinding,/^[a-f0-9]{64}$/);
  lease.release(); assert.throws(()=>lease.assertCurrent(),/失效/);
  const accepted = await f.host.action('start',start(snapshot));
  assert.equal(accepted.batch.state,'waiting_approval');
  assert.equal(f.calls.filter(call=>call.name==='start').length,1);
  assert.equal(JSON.stringify(f.calls).includes(f.root),false);
  assert.equal(JSON.stringify(f.calls).includes('2500'),false);
});

test('unavailable workflow disables generation even when files and library are configured', async t => {
  const f = await fixture(t), snapshot = await select(f);
  f.capabilities({available:false,reason:'固定 Wiki 工作流版本尚未发布',modelLabel:'AgentArts'});
  assert.equal(f.host.snapshot().available,false);
  assert.match(f.host.snapshot().reason,/尚未发布/);
  await assert.rejects(f.host.action('start',start(snapshot)),/尚未发布/);
  assert.equal(f.calls.some(call=>call.name==='start'),false);
});

test('renderer cannot inject file paths, switch selection identities or exceed budget bounds', async t => {
  const f = await fixture(t), snapshot = await select(f);
  await assert.rejects(f.host.action('selectFiles',{path:f.file}),/选择器/);
  await assert.rejects(f.host.action('start',{...start(snapshot),path:f.file}),/参数/);
  await assert.rejects(f.host.action('start',{...start(snapshot),selectionId:'other'}),/改变/);
  await assert.rejects(f.host.action('start',{...start(snapshot),timeoutMinutes:121}),/期限/);
  await assert.rejects(f.host.action('start',{...start(snapshot),maxTokens:NaN}),/预算/);
  await assert.rejects(f.host.action('readPage',{pageId:'x',path:f.file}),/参数/);
  assert.equal(f.calls.some(call=>call.name==='start'),false);
});

test('changed source bytes and replaced library identity invalidate exact input lease', async t => {
  const f = await fixture(t), snapshot = await select(f);
  const lease = await f.host.runtimeOptions.source.acquire(input(snapshot),context());
  await writeFile(f.file,'资料已经改变');
  assert.throws(()=>lease.assertCurrent(),/改变/); lease.release();
  await assert.rejects(f.host.runtimeOptions.source.acquire(input(snapshot),context()),/改变/);
  const original = join(f.root,'old-library'); await rename(f.library,original); await mkdir(f.library);
  assert.throws(()=>f.host.runtimeOptions.source.openLibrary(snapshot.library.libraryId),/失效/);
});

test('file links and directory junctions cannot enter an input or output scope', async t => {
  const f = await fixture(t);
  const hardlink = join(f.root,'linked.md');await link(f.file,hardlink);f.picks.files=[hardlink];
  await assert.rejects(f.host.action('selectFiles'),/普通文件/);
  const junction = join(f.root,'junction');await symlink(f.library,junction,process.platform==='win32'?'junction':'dir');
  f.picks.library=junction;
  await assert.rejects(f.host.action('selectLibrary'),/链接/);
});

test('folder selection accounts for unsupported files and prevents recursive generated-library imports', async t => {
  const f = await fixture(t); await writeFile(join(f.input,'legacy.doc'),'synthetic unsupported');
  await f.host.action('selectFolder');
  assert.equal(f.host.snapshot().selection.files.length,2);
  assert.match(f.host.snapshot().selection.files.find(file=>file.name==='legacy.doc').reason,/不支持/);
  f.picks.library=f.input;
  await assert.rejects(f.host.action('selectLibrary'),/资料目录/);
});

test('planning and verifying tasks retain selection; cancellation is read back from Runtime', async t => {
  const f = await fixture(t), snapshot = await select(f);
  await f.host.action('start',start(snapshot));
  for (const state of ['planning','verifying']) {
    f.state(state); await assert.rejects(f.host.action('selectFiles'),/当前 Wiki 批次/);
  }
  const cancelled = await f.host.action('cancel',{taskId:'wiki-task'});
  assert.equal(cancelled.batch.state,'cancelled');
  await assert.rejects(f.host.action('recover',{taskId:'other'}),/当前已绑定/);
  assert.equal((await readFile(f.file,'utf8')).includes('2500'),true);
});

test('unreconciled batches retain their original selection and cannot start another batch', async t => {
  const f = await fixture(t), snapshot = await select(f);
  await f.host.action('start', start(snapshot));
  f.state('waiting_reconciliation');
  for (const action of ['selectFiles','selectFolder','selectLibrary']) {
    await assert.rejects(f.host.action(action), /先核实原 Wiki 批次/);
  }
  await assert.rejects(f.host.action('start', start(snapshot)), /先核实原 Wiki 批次/);
  assert.equal(f.host.snapshot().batch.taskId, 'wiki-task');
  assert.equal(f.host.snapshot().selection.selectionId, snapshot.selection.selectionId);
  assert.equal(f.calls.filter(call => call.name === 'start').length, 1);
  const recovered = await f.host.action('recover', {taskId:'wiki-task'});
  assert.equal(recovered.batch.state, 'waiting_approval');
  assert.equal(f.calls.filter(call => call.name === 'recover').length, 1);
});

test('partial content is reported separately from the authoritative succeeded task state', async t => {
  const f = await fixture(t), snapshot = await select(f);
  await f.host.action('start',start(snapshot));
  f.state('succeeded');f.result({generationId:'g1',pages:[{pageId:'index',title:'首页',path:'index.md'}],complete:false,issues:[{message:'扫描页待核实'}]});
  const current = await f.host.action('status');
  assert.equal(current.batch.state,'succeeded');assert.equal(current.batch.completion,'partial');
  assert.equal(current.published.pages[0].pageId,'index');
  assert.match(current.batch.issues[0].message,/待核实/);
});

test('restart restores picker identities and task reference without starting or granting the task', async t => {
  const f = await fixture(t), snapshot = await select(f);await f.host.action('start',start(snapshot));f.host.close();
  const restarted = await createWikiImportHost(f.options);t.after(()=>restarted.close());restarted.bind(f.runtime);
  assert.equal(restarted.snapshot().batch.state,'interrupted');
  assert.equal(restarted.snapshot().selection.selectionId,snapshot.selection.selectionId);
  assert.equal(f.calls.filter(call=>call.name==='start').length,1);
  const source = await restarted.action('openSource',{sourceId:'source',revision:'hash',unitId:'unit',generationId:'g1'});
  assert.equal(source.text,'合成原文');
  assert.equal(f.calls.find(call=>call.name==='readSource').input.libraryId,snapshot.library.libraryId);
});

test('incremental batch includes prior selected sources and invalidates a changed original',async t=>{
  const f=await fixture(t),first=await select(f),selection=input(first),scope={...context(),taskId:'original',
    runId:'host-tool-original',argumentsDigest:'a'.repeat(64)};
  const source=f.host.runtimeOptions.source,original=await source.acquire(selection,scope);
  const previous=original.sources[0];original.registerSources();original.release();
  const other=join(f.input,'第二份.md');await writeFile(other,'合成的第二份资料');f.picks.files=[other];
  const second=await f.host.action('selectFiles');assert.equal(second.selection.existingSourceCount,1);
  const union=await source.acquire(input(second),scope);
  assert.deepEqual(new Set(union.sources.map(item=>item.name)),new Set(['公开测试.md','第二份.md']));
  const recorded=f.host.snapshot().librarySources.find(item=>item.sourceId===previous.sourceId);
  source.assertSourcesCurrent(second.library.libraryId,[{sourceId:previous.sourceId,revision:recorded.revision}]);
  await writeFile(f.file,'原始资料被修改');
  assert.throws(()=>union.assertCurrent(),/改变/);union.release();
});

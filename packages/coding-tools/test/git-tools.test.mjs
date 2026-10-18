import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, mkdirSync, writeFileSync, realpathSync, cpSync, renameSync, statSync, symlinkSync, readFileSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createGitTools, registerGitTools, readGitWorkspaceFingerprint} from '../dist/dev-workflows/git-tools.js';

function fixture() {
  const rootPath=mkdtempSync(join(tmpdir(),'git-tools-contract-'));
  const options={rootPath,repository:'owner/repo',sourceBranch:'agent/fix',remoteName:'origin',remoteUrl:'https://example.com/owner/repo.git',allowedPaths:['src/main.ts'],authorName:'Agent',authorEmail:'agent@example.com',readVerification:async()=>undefined};
  return {options,dispose:()=>rmSync(rootPath,{recursive:true,force:true})};
}
test('Git writes require presence, distinct scopes and no automatic recovery',()=>{
  const f=fixture(); try {
    const tools=createGitTools(f.options);
    assert.equal(tools.head.descriptor.name,'workspace.git.head');
    assert.equal(tools.head.descriptor.requiresPresence,false);
    for(const tool of [tools.commit,tools.push]) {
      assert.equal(tool.descriptor.requiresPresence,true);
      assert.equal(tool.descriptor.idempotencySupport,false);
      assert.equal(tool.descriptor.recoverySupport,false);
    }
    assert.equal(tools.push.descriptor.sideEffect,'external_write');
    assert.equal(tools.commit.descriptor.inputSchema.additionalProperties,false);
  } finally {f.dispose();}
});
test('Host binding rejects traversal, credentials and branch injection',()=>{
  const f=fixture(); try {
    for(const override of [{allowedPaths:['../secret']},{remoteUrl:'https://user:secret@example.com/repo'},{sourceBranch:'../main'},{remoteName:'--all'}]) {
      assert.throws(()=>createGitTools({...f.options,...override}));
    }
  } finally {f.dispose();}
});
test('Model cannot submit verification evidence or select another repository',async()=>{
  const f=fixture(); try {
    const tools=createGitTools(f.options);
    const c={taskId:'task',runId:'commit',authorizationRef:'auth',scopes:['workspace:git:commit'],signal:new AbortController().signal,deadline:new Date(Date.now()+10000).toISOString()};
    await assert.rejects(tools.commit.execute({repository:'owner/repo',expectedHeadSha:'a'.repeat(40),paths:['src/main.ts'],message:'fix',verificationRunId:'verify',receipt:{exitCode:0}},c));
    await assert.rejects(tools.head.execute({repository:'other/repo'},c));
  } finally {f.dispose();}
});
test('Partial registration rolls back previously acquired registrations',()=>{
  const f=fixture(); try {
    let registered=0; let disposed=0;
    const host={register(){registered++; if(registered===3) throw new Error('registration rejected'); return ()=>{disposed++;};}};
    assert.throws(()=>registerGitTools(host,f.options),/registration rejected/u);
    assert.equal(registered,3);
    assert.equal(disposed,2);
  } finally {f.dispose();}
});

function repositoryFixture(rootName) {
  const f=fixture();
  if (rootName !== undefined) {
    f.options.rootPath = join(f.options.rootPath, rootName); mkdirSync(f.options.rootPath);
    f.options.rootPath = realpathSync.native(f.options.rootPath);
  }
  const git=args=>execFileSync('git',args,{cwd:f.options.rootPath,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['init','-b',f.options.sourceBranch]);
  mkdirSync(join(f.options.rootPath,'src'));
  writeFileSync(join(f.options.rootPath,'src/main.ts'),'export const value = 1;\n');
  git(['add','src/main.ts']);
  git(['-c','user.name=Fixture','-c','user.email=fixture@example.com','-c','core.hooksPath=/dev/null','commit','-m','initial fixture']);
  git(['remote','add',f.options.remoteName,f.options.remoteUrl]);
  return {...f,git,headSha:git(['rev-parse','HEAD'])};
}
async function settles(promise) {
  let timer;
  try {return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('host wait did not settle')),300);})]);}
  finally {clearTimeout(timer);}
}
for(const phase of ['verification','credentials']) {
  for(const reason of ['cancel','deadline','long deadline']) {
    test(`Git ${phase} host wait settles on ${reason} before any write`,async t=>{
      const f=repositoryFixture();
      try {
        const controller=new AbortController(); let clock=Date.now();
        const delay=reason==='long deadline'?2_147_483_647+1000:60000;
        const deadline=new Date(clock+delay).toISOString();
        let calls=0,entered,resolvePort,boundedContext;
        const ready=new Promise(resolve=>{entered=resolve;});
        const pending=bounded=>{calls++;boundedContext=bounded;entered();return new Promise(resolve=>{resolvePort=resolve;});};
        const tools=createGitTools({...f.options,now:()=>clock,
          ...(phase==='verification'?{readVerification:pending}:{getCredentials:pending})});
        const context={taskId:'task',runId:phase,authorizationRef:'auth',scopes:[phase==='verification'?'workspace:git:commit':'workspace:git:push'],signal:controller.signal,deadline};
        if(reason!=='cancel') t.mock.timers.enable({apis:['setTimeout']});
        const input=phase==='verification'?{repository:f.options.repository,expectedHeadSha:f.headSha,paths:['src/main.ts'],message:'fix',verificationRunId:'verify'}:{repository:f.options.repository,expectedHeadSha:f.headSha};
        const operation=(phase==='verification'?tools.commit:tools.push).execute(input,context);
        await ready;
        if(reason==='cancel') controller.abort();
        else {
          if(reason==='long deadline') {
            clock+=2_147_483_647;t.mock.timers.tick(2_147_483_647);
            assert.equal(boundedContext.signal.aborted,false);
          }
          clock=Date.parse(deadline);t.mock.timers.tick(reason==='long deadline'?1000:delay);t.mock.timers.reset();
        }
        await assert.rejects(settles(operation),error=>error.code===(reason==='cancel'?'CANCELLED':'TIMEOUT'));
        assert.equal(boundedContext.signal.aborted,true);
        assert.equal(boundedContext.taskId,context.taskId);
        assert.equal(boundedContext.authorizationRef,context.authorizationRef);
        assert.equal(boundedContext.deadline,context.deadline);
        resolvePort(phase==='credentials'?{token:'fake-fixture-token'}:undefined);
        await Promise.resolve();await Promise.resolve();
        assert.equal(calls,1);
        assert.equal(f.git(['rev-parse','HEAD']),f.headSha);
        assert.equal(f.git(['status','--porcelain']),'');
        // The interrupted callback no longer holds the repository's serial slot.
        const read=await tools.head.execute({repository:f.options.repository},{...context,scopes:['workspace:git:read'],signal:new AbortController().signal,deadline:new Date(clock+60000).toISOString()});
        assert.equal(read.headSha,f.headSha);
      } finally {f.dispose();}
    });
  }
  test(`Git ${phase} preserves an ordinary host read error`,async()=>{
    const f=repositoryFixture();
    try {
      const expected=new Error('explicit host failure');
      const reject=async()=>{throw expected;};
      const tools=createGitTools({...f.options,...(phase==='verification'?{readVerification:reject}:{getCredentials:reject})});
      const context={taskId:'task',runId:phase,authorizationRef:'auth',scopes:[phase==='verification'?'workspace:git:commit':'workspace:git:push'],signal:new AbortController().signal,deadline:new Date(Date.now()+60000).toISOString()};
      const input=phase==='verification'?{repository:f.options.repository,expectedHeadSha:f.headSha,paths:['src/main.ts'],message:'fix',verificationRunId:'verify'}:{repository:f.options.repository,expectedHeadSha:f.headSha};
      await assert.rejects((phase==='verification'?tools.commit:tools.push).execute(input,context),error=>error===expected);
      assert.equal(f.git(['rev-parse','HEAD']),f.headSha);
      assert.equal(f.git(['status','--porcelain']),'');
    } finally {f.dispose();}
  });
}
for(const reason of ['cancel','deadline']) {
  test(`Git verification rejects a synchronous result after ${reason}`,async()=>{
    const f=repositoryFixture();
    try {
      const controller=new AbortController();let clock=Date.now();
      const deadline=new Date(clock+60000).toISOString();
      const tools=createGitTools({...f.options,now:()=>clock,readVerification:async()=>{
        if(reason==='cancel') controller.abort();else clock=Date.parse(deadline);
        return undefined;
      }});
      const context={taskId:'task',runId:'commit',authorizationRef:'auth',scopes:['workspace:git:commit'],signal:controller.signal,deadline};
      await assert.rejects(tools.commit.execute({repository:f.options.repository,expectedHeadSha:f.headSha,paths:['src/main.ts'],message:'fix',verificationRunId:'verify'},context),error=>error.code===(reason==='cancel'?'CANCELLED':'TIMEOUT'));
      assert.equal(f.git(['rev-parse','HEAD']),f.headSha);
      assert.equal(f.git(['status','--porcelain']),'');
    } finally {f.dispose();}
  });
}
test('Git bounded host read retains trusted verification and normal local commit',async()=>{
  const f=repositoryFixture();
  try {
    writeFileSync(join(f.options.rootPath,'src/main.ts'),'export const value = 2;\n');
    const {files}=await readGitWorkspaceFingerprint(f.options.rootPath,f.options.allowedPaths);
    const tools=createGitTools({...f.options,readVerification:async(context,runId)=>({taskId:context.taskId,runId,toolName:'workspace.run_allowed_command',status:'confirmed',exitCode:0,headSha:f.headSha,files})});
    const context={taskId:'task',runId:'commit',authorizationRef:'auth',scopes:['workspace:git:commit'],signal:new AbortController().signal,deadline:new Date(Date.now()+60000).toISOString()};
    const result=await tools.commit.execute({repository:f.options.repository,expectedHeadSha:f.headSha,paths:['src/main.ts'],message:'verified fixture change',verificationRunId:'verify'},context);
    assert.equal(result.parentSha,f.headSha);
    assert.equal(f.git(['rev-parse','HEAD']),result.headSha);
    assert.equal(f.git(['show','HEAD:src/main.ts']),'export const value = 2;');
    assert.equal(f.git(['status','--porcelain']),'');
  } finally {f.dispose();}
});

function replaceRepositoryRoot(f, replacement = 'directory') {
  const root = f.options.rootPath, parent = mkdtempSync(join(tmpdir(), 'git-root-replacement-'));
  const saved = join(parent, 'preserved'), copy = join(parent, 'copy');
  const original = statSync(root, {bigint: true});
  cpSync(root, copy, {recursive: true});
  renameSync(root, saved);
  if (replacement === 'directory') {
    // A freshly copied Windows fixture may briefly retain an open file handle.
    for (let attempt = 0; ; attempt++) {
      try { renameSync(copy, root); break; }
      catch (error) {
        if (process.platform !== 'win32' || error.code !== 'EPERM' || attempt >= 19) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
  } else symlinkSync(copy, root, process.platform === 'win32' ? 'junction' : 'dir');
  const current = statSync(root, {bigint: true});
  assert.notEqual(`${current.dev}:${current.ino}`, `${original.dev}:${original.ino}`);
  const git = args => execFileSync('git', args, {cwd: saved, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  return {saved, git, dispose: () => rmSync(parent, {recursive: true, force: true})};
}

for (const replacement of ['directory', 'symlink']) {
  for (const operation of ['head', 'commit', 'push']) {
    test(`Git ${operation} rejects a replaced ${replacement} root before any process or host port`, async t => {
      const f = repositoryFixture(); let swapped;
      let processes = 0, receipts = 0, credentials = 0;
      const originalSpawn = childProcess.spawn;
      t.mock.method(childProcess, 'spawn', (...args) => {processes++; return originalSpawn(...args);});
      syncBuiltinESMExports();
      try {
        const tools = createGitTools({...f.options, readVerification: async () => {receipts++; return undefined;},
          getCredentials: async () => {credentials++; return {token: 'explicit-synthetic-token'};}});
        const originalIndex = readFileSync(join(f.options.rootPath, '.git/index'));
        swapped = replaceRepositoryRoot(f, replacement);
        const scope = operation === 'head' ? 'workspace:git:read' : `workspace:git:${operation}`;
        const context = {taskId: 'synthetic-root', runId: operation, authorizationRef: 'synthetic-auth', scopes: [scope],
          signal: new AbortController().signal, deadline: new Date(Date.now() + 60_000).toISOString()};
        const input = operation === 'head' ? {repository: f.options.repository} : operation === 'commit'
          ? {repository: f.options.repository, expectedHeadSha: f.headSha, paths: ['src/main.ts'], message: 'synthetic change', verificationRunId: 'verify'}
          : {repository: f.options.repository, expectedHeadSha: f.headSha};
        await assert.rejects(tools[operation].execute(input, context), error => error.code === 'SCOPE_DENIED');
        assert.equal(processes, 0); assert.equal(receipts, 0); assert.equal(credentials, 0);
        assert.equal(swapped.git(['rev-parse', 'HEAD']), f.headSha);
        assert.equal(f.git(['rev-parse', 'HEAD']), f.headSha);
        assert.deepEqual(readFileSync(join(f.options.rootPath, '.git/index')), originalIndex);
        assert.deepEqual(readFileSync(join(swapped.saved, '.git/index')), originalIndex);
      } finally {t.mock.restoreAll(); syncBuiltinESMExports(); f.dispose(); swapped?.dispose();}
    });
  }
}

for (const phase of ['verification', 'credentials']) {
  test(`Git rejects root replacement while awaiting ${phase} before any write`, async t => {
    const f = repositoryFixture(); let swapped;
    let processes = [], hostCalls = 0;
    const originalSpawn = childProcess.spawn;
    t.mock.method(childProcess, 'spawn', (executable, args, options) => {
      processes.push([...args]);
      // The regression must never contact a remote even on the unsafe old implementation.
      if (args.includes('ls-remote') || args.includes('push')) {
        const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
        child.kill = () => true;
        child.stdin = {end() {queueMicrotask(() => {child.stdout.end(); child.stderr.end(); child.emit('close', 0);});}};
        return child;
      }
      return originalSpawn(executable, args, options);
    });
    syncBuiltinESMExports();
    try {
      writeFileSync(join(f.options.rootPath, 'src/main.ts'), 'export const value = 2;\n');
      const {files} = await readGitWorkspaceFingerprint(f.options.rootPath, f.options.allowedPaths);
      const originalIndex = readFileSync(join(f.options.rootPath, '.git/index'));
      const replace = async (context, runId) => {
        hostCalls++; swapped = replaceRepositoryRoot(f);
        return phase === 'credentials' ? {token: 'explicit-synthetic-token'} : {taskId: context.taskId, runId,
          toolName: 'workspace.run_allowed_command', status: 'confirmed', exitCode: 0, headSha: f.headSha, files};
      };
      const tools = createGitTools({...f.options, ...(phase === 'verification' ? {readVerification: replace} : {getCredentials: replace})});
      const context = {taskId: 'synthetic-host-root', runId: phase, authorizationRef: 'synthetic-auth',
        scopes: [phase === 'verification' ? 'workspace:git:commit' : 'workspace:git:push'],
        signal: new AbortController().signal, deadline: new Date(Date.now() + 60_000).toISOString()};
      const input = phase === 'verification' ? {repository: f.options.repository, expectedHeadSha: f.headSha,
        paths: ['src/main.ts'], message: 'synthetic replacement commit', verificationRunId: 'verify'}
        : {repository: f.options.repository, expectedHeadSha: f.headSha};
      await assert.rejects((phase === 'verification' ? tools.commit : tools.push).execute(input, context), error => error.code === 'SCOPE_DENIED');
      assert.equal(hostCalls, 1);
      assert.equal(processes.some(args => args.includes('read-tree') || args.includes('hash-object') || args.includes('commit-tree')
        || args.includes('update-ref') || args.includes('ls-remote') || args.includes('push')), false);
      assert.equal(swapped.git(['rev-parse', 'HEAD']), f.headSha); assert.equal(f.git(['rev-parse', 'HEAD']), f.headSha);
      assert.deepEqual(readFileSync(join(f.options.rootPath, '.git/index')), originalIndex);
      assert.deepEqual(readFileSync(join(swapped.saved, '.git/index')), originalIndex);
    } finally {t.mock.restoreAll(); syncBuiltinESMExports(); f.dispose(); swapped?.dispose();}
  });
}

test('Git retains unknown ref outcome and does not remove a replacement index lock', async t => {
  const f = repositoryFixture(); let swapped;
  const originalSpawn = childProcess.spawn, unrelatedLock = Buffer.from('synthetic unrelated index lock');
  t.mock.method(childProcess, 'spawn', (executable, args, options) => {
    const child = originalSpawn(executable, args, options);
    if (args.includes('update-ref')) child.once('close', () => {
      swapped = replaceRepositoryRoot(f);
      writeFileSync(join(f.options.rootPath, '.git/index.lock'), unrelatedLock);
    });
    return child;
  });
  syncBuiltinESMExports();
  try {
    writeFileSync(join(f.options.rootPath, 'src/main.ts'), 'export const value = 2;\n');
    const {files} = await readGitWorkspaceFingerprint(f.options.rootPath, f.options.allowedPaths);
    const originalIndex = readFileSync(join(f.options.rootPath, '.git/index'));
    const tools = createGitTools({...f.options, readVerification: async (context, runId) => ({taskId: context.taskId,
      runId, toolName: 'workspace.run_allowed_command', status: 'confirmed', exitCode: 0, headSha: f.headSha, files})});
    const context = {taskId: 'synthetic-late-root', runId: 'commit', authorizationRef: 'synthetic-auth',
      scopes: ['workspace:git:commit'], signal: new AbortController().signal, deadline: new Date(Date.now() + 60_000).toISOString()};
    await assert.rejects(tools.commit.execute({repository: f.options.repository, expectedHeadSha: f.headSha, paths: ['src/main.ts'],
      message: 'synthetic original commit', verificationRunId: 'verify'}, context), error => error.code === 'RESULT_UNKNOWN');
    assert.ok(swapped); assert.notEqual(swapped.git(['rev-parse', 'HEAD']), f.headSha);
    assert.equal(existsSync(join(swapped.saved, '.git/index.lock')), true);
    assert.deepEqual(readFileSync(join(swapped.saved, '.git/index')), originalIndex);
    assert.deepEqual(readFileSync(join(f.options.rootPath, '.git/index')), originalIndex);
    assert.deepEqual(readFileSync(join(f.options.rootPath, '.git/index.lock')), unrelatedLock);
  } finally {t.mock.restoreAll(); syncBuiltinESMExports(); f.dispose(); swapped?.dispose();}
});

test('Git keeps a canonical registration alias and ordinary directory edits valid', async () => {
  const f = repositoryFixture(), parent = mkdtempSync(join(tmpdir(), 'git-root-alias-'));
  try {
    const alias = join(parent, 'alias');
    symlinkSync(f.options.rootPath, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const tools = createGitTools({...f.options, rootPath: alias});
    mkdirSync(join(f.options.rootPath, 'ordinary-edit'));
    rmSync(join(f.options.rootPath, 'ordinary-edit'), {recursive: true});
    const context = {taskId: 'synthetic-alias', runId: 'read', authorizationRef: 'synthetic-auth', scopes: ['workspace:git:read'],
      signal: new AbortController().signal, deadline: new Date(Date.now() + 60_000).toISOString()};
    const result = await tools.head.execute({repository: f.options.repository}, context);
    assert.equal(result.headSha, f.headSha); assert.equal(result.workspaceClean, true);
  } finally {f.dispose(); rmSync(parent, {recursive: true, force: true});}
});

test('Git rejects a missing registered root without leaking filesystem details', async () => {
  const f = repositoryFixture(), parent = mkdtempSync(join(tmpdir(), 'git-root-missing-'));
  try {
    const tools = createGitTools(f.options);
    renameSync(f.options.rootPath, join(parent, 'preserved'));
    const context = {taskId: 'synthetic-missing', runId: 'read', authorizationRef: 'synthetic-auth', scopes: ['workspace:git:read'],
      signal: new AbortController().signal, deadline: new Date(Date.now() + 60_000).toISOString()};
    await assert.rejects(tools.head.execute({repository: f.options.repository}, context), error =>
      error.code === 'SCOPE_DENIED' && !error.message.includes(f.options.rootPath) && !error.message.includes('ENOENT'));
    const controller = new AbortController(); controller.abort();
    await assert.rejects(tools.head.execute({repository: f.options.repository}, {...context, signal: controller.signal}), error => error.code === 'CANCELLED');
    await assert.rejects(tools.head.execute({repository: f.options.repository}, {...context, deadline: new Date(0).toISOString()}), error => error.code === 'TIMEOUT');
  } finally {f.dispose(); rmSync(parent, {recursive: true, force: true});}
});

test('Git preserves literal spaces in a canonical working-tree root', async () => {
  // Win32 strips/rejects trailing directory spaces; keep that actual regression on Linux.
  const f = repositoryFixture(process.platform === 'win32' ? '中文 工作区' : '中文工作区 ');
  try {
    const tools = createGitTools(f.options);
    const context = {taskId: 'synthetic-root-read', runId: 'synthetic-root-read', authorizationRef: 'synthetic-root-read',
      scopes: ['workspace:git:read'], signal: new AbortController().signal, deadline: new Date(Date.now() + 60_000).toISOString()};
    const result = await tools.head.execute({repository: f.options.repository}, context);
    assert.equal(result.headSha, f.headSha); assert.equal(result.workspaceClean, true);
    assert.equal(f.git(['status', '--porcelain']), '');
  } finally {f.dispose();}
});

function stdoutFixture(t, {invalidUtf8 = false, oversized = false} = {}) {
  const f = fixture(), requestedRoot = join(f.options.rootPath, '中文工作区');
  mkdirSync(join(requestedRoot, 'src'), {recursive: true});
  // Windows TMP can contain an 8.3 alias; assert the same canonical root as the factory.
  const rootPath = realpathSync.native(requestedRoot);
  writeFileSync(join(rootPath, 'src/中文.ts'), 'export const value = 1;\n');
  const calls = []; let kills = 0;
  t.after(() => {t.mock.restoreAll(); syncBuiltinESMExports(); f.dispose();});
  t.mock.method(childProcess, 'spawn', (executable, args, options) => {
    assert.equal(executable, 'git'); assert.equal(options.cwd, rootPath);
    const command = args[8]; calls.push(command);
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let closed = false;
    child.kill = () => {
      kills++; if (!closed) {closed = true; queueMicrotask(() => child.emit('close', null));}
      return true;
    };
    child.stdin = {end() {queueMicrotask(() => {
      let text;
      if (args.includes('--show-toplevel')) text = rootPath + '\n';
      else if (command === 'symbolic-ref') text = 'agent/fix\n';
      else if (args.includes('get-url')) text = f.options.remoteUrl + '\n';
      else if (command === 'rev-parse') text = 'a'.repeat(40) + '\n';
      else if (command === 'status') text = ' M src/中文.ts\0';
      else assert.fail('unexpected synthetic read command');
      const bytes = oversized ? Buffer.alloc(1024 * 1024 + 1, 97)
        : invalidUtf8 ? Buffer.concat([Buffer.from(text), Buffer.from([0xff])]) : Buffer.from(text);
      // A flowing stream delivers each write separately, including split UTF-8 code points.
      if (invalidUtf8 || oversized) child.stdout.write(bytes);
      else for (const byte of bytes) child.stdout.write(Buffer.from([byte]));
      child.stdout.end(); child.stderr.end();
      if (!closed) {closed = true; child.emit('close', 0);}
    });}};
    return child;
  });
  syncBuiltinESMExports();
  const tools = createGitTools({...f.options, rootPath, allowedPaths: ['src/中文.ts']});
  const context = {taskId: 'synthetic-read', runId: 'synthetic-read', authorizationRef: 'synthetic-read',
    scopes: ['workspace:git:read'], signal: new AbortController().signal, deadline: new Date(Date.now() + 60_000).toISOString()};
  return {tools, context, calls, get kills() {return kills;}};
}

test('Git output retains UTF-8 paths across arbitrary stdout chunk boundaries', async t => {
  const f = stdoutFixture(t);
  const result = await f.tools.head.execute({repository: 'owner/repo'}, f.context);
  assert.equal(result.headSha, 'a'.repeat(40)); assert.equal(result.clean, true); assert.equal(result.workspaceClean, false);
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/u);
  assert.deepEqual(f.calls, ['rev-parse', 'symbolic-ref', 'remote', 'rev-parse', 'status']); assert.equal(f.kills, 0);
});

test('Git rejects malformed stdout UTF-8 with a fixed read failure before any write', async t => {
  const f = stdoutFixture(t, {invalidUtf8: true});
  await assert.rejects(f.tools.head.execute({repository: 'owner/repo'}, f.context), error => error.code === 'EXTERNAL_FAILURE');
  assert.deepEqual(f.calls, ['rev-parse']); assert.equal(f.kills, 0);
});

test('Git UTF-8 buffering retains its byte ceiling and interrupts oversized output', async t => {
  const f = stdoutFixture(t, {oversized: true});
  await assert.rejects(f.tools.head.execute({repository: 'owner/repo'}, f.context), error => error.code === 'RESULT_UNKNOWN');
  assert.deepEqual(f.calls, ['rev-parse']); assert.equal(f.kills, 1);
});

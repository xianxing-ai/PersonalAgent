import assert from 'node:assert/strict';
import {existsSync, realpathSync} from 'node:fs';
import {mkdir, mkdtemp, rename, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {createWindowsNativeSandboxExecutor, readWindowsNativeHelperAttestation} from '../dist/windows-native-sandbox.js';
import {verifyWindowsNativeSandbox} from '../dist/native-sandbox-probe.js';
import {nativeTokenDiagnostic,unsupportedPsec} from './native-sandbox-fixture.mjs';

const helperPath = process.env.PA_TEST_JOB_HOST_EXE;
const available = process.platform === 'win32' && helperPath && existsSync(helperPath);

test('requested native sandbox fails closed on unsupported platforms', {skip: process.platform === 'win32'}, async () => {
  const executor = createWindowsNativeSandboxExecutor({helperPath: '/missing/WindowsJobProcessHost.exe', helperSha256:'a'.repeat(64), helperFilesSha256:{}, assertCurrent:()=>{}});
  const result = await executor.execute({profile:{backend:'windows-psec'}});
  assert.equal(result.outcome,'unavailable');assert.equal(result.executionStarted,false);assert.equal(result.enforced,false);
});

test('real Windows PSEC boundary, generation guards and lifecycle', {skip: !available && 'Explicit trusted PA_TEST_JOB_HOST_EXE unavailable'}, async t => {
  t.diagnostic('Native probe inherited token: '+JSON.stringify(nativeTokenDiagnostic()));
  const base = realpathSync.native(await mkdtemp(join(tmpdir(), 'personal-agent-psec-')));
  const pins = readWindowsNativeHelperAttestation(realpathSync.native(helperPath));
  const node = realpathSync.native(process.execPath), systemRoot = realpathSync.native(process.env.SystemRoot);
  const capabilities = await verifyWindowsNativeSandbox(pins, {probeRootPath:base,nodeExecutable:node,systemRoot,signal:new AbortController().signal});
  if (unsupportedPsec(capabilities) && process.env.PA_TEST_NATIVE_SANDBOX_REQUIRED!=='1') {
    t.skip('Actual baseline passed; PSEC API unavailable: '+JSON.stringify(capabilities.results));return;
  }
  assert.equal(capabilities.available,true,JSON.stringify(capabilities));
  assert.equal(capabilities.networkDeny,true);assert.equal(capabilities.descendants,true);assert.equal(capabilities.reparse,true);
  const workspace=join(base,'focused-workspace'), outside=join(base,'focused-outside');await mkdir(workspace);await mkdir(outside);
  function request(code, overrides={}) {
    return {sandboxRef:'focused',revision:1,taskId:'focused',runId:'focused',authorizationRef:'focused',argumentsDigest:'a'.repeat(64),
      deadline:new Date(Date.now()+5000).toISOString(),signal:new AbortController().signal,maxOutputBytes:4096,
      profile:{sandboxRef:'focused',revision:1,mode:'workspace-write',backend:'windows-psec',readRoots:[dirname(node),systemRoot],writeRoots:[workspace],
        executableAllowlist:[node],network:{mode:'deny'}}, executable:node,argv:['-e',code],env:{SystemRoot:systemRoot,LOCALAPPDATA:workspace},cwd:workspace,...overrides};
  }
  const executor = createWindowsNativeSandboxExecutor({...pins,assertCurrent:()=>{}});
  await t.test('rejects ambiguous grants, volume grants, writeable helper, env secrets and unavailable network policy', async () => {
    const valid=request('process.exit(91)');
    for(const changes of [
      {profile:{...valid.profile,readRoots:[...valid.profile.readRoots,workspace]}},
      {profile:{...valid.profile,readRoots:['D:\\']}},
      {profile:{...valid.profile,writeRoots:[dirname(pins.helperPath)]}},
      {env:{...valid.env,API_TOKEN:'synthetic-secret'}},
      {profile:{...valid.profile,network:{mode:'allowlist',hosts:['example.invalid']}}},
    ]) {const result=await executor.execute({...valid,...changes});assert.equal(result.executionStarted,false);assert.equal(result.outcome,'unavailable');}
  });
  await t.test('runtime-created junction cannot grant outside file write', async () => {
    const code=`const fs=require('fs');let created=false;try{fs.symlinkSync(${JSON.stringify(outside)},'runtime-escape','junction');created=true}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e}if(created){try{fs.writeFileSync('runtime-escape/escaped','synthetic');process.exit(21)}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e}}`;
    const result=await executor.execute(request(code));assert.equal(result.outcome,'exited');assert.equal(result.exitCode,0);
    assert.equal(existsSync(join(outside,'escaped')),false);
  });
  await t.test('root and ancestor handles prevent replacement before resume', async () => {
    let calls=0,blocked=false;
    const guarded=createWindowsNativeSandboxExecutor({...pins,assertCurrent:async()=>{if(++calls===2){try{await rename(workspace,workspace+'-moved')}catch(e){blocked=['EPERM','EACCES','EBUSY'].includes(e.code)}}}});
    const result=await guarded.execute(request('process.exit(0)'));
    if(existsSync(workspace+'-moved')&&!existsSync(workspace))await rename(workspace+'-moved',workspace);
    assert.equal(blocked,true);assert.equal(calls,2);assert.equal(result.exitCode,0);
  });
  await t.test('revoked original lease never resumes target', async () => {
    let calls=0;const guarded=createWindowsNativeSandboxExecutor({...pins,assertCurrent:()=>{if(++calls===2)throw Error('revoked')}});
    const result=await guarded.execute(request("require('fs').writeFileSync('revoked-marker','bad')"));
    assert.equal(calls,2);assert.equal(result.executionStarted,false);assert.equal(result.outcome,'unavailable');assert.equal(existsSync(join(workspace,'revoked-marker')),false);
  });
  await t.test('timeout kills descendants and output overflow stays unknown', async () => {
    const code="require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});setInterval(()=>{},1000)";
    const timeout=await executor.execute(request(code,{deadline:new Date(Date.now()+400).toISOString()}));
    assert.equal(timeout.outcome,'timeout');assert.equal(timeout.stopped,true);
    const overflow=await executor.execute(request("process.stdout.write('x'.repeat(20000));setInterval(()=>{},1000)",{maxOutputBytes:128}));
    assert.equal(overflow.outcome,'unknown');assert.equal(overflow.stopped,true);assert.ok(Buffer.byteLength(overflow.stdout)<=128);
  });
  await t.test('junction root is rejected before target start',async()=>{
    const alias=join(base,'root-alias');await symlink(workspace,alias,'junction');
    const valid=request('process.exit(91)');const result=await executor.execute({...valid,cwd:alias,profile:{...valid.profile,writeRoots:[alias]}});
    assert.equal(result.executionStarted,false);assert.equal(result.outcome,'unavailable');
  });
  // Retain bounded synthetic fixtures for diagnosis; no recursive deletion of user data.
});

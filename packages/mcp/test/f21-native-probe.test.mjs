import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {readReadonlyMcpInstallation} from '../dist/index.js';
import {readWindowsNativeHelperAttestation,createWindowsNativeSandboxExecutor} from '@personal-agent/coding-tools';

test('fixed F21 probe uses the actual MCP protocol only inside enforced Windows PSEC',
  {skip:!process.env.PA_TEST_JOB_HOST_EXE&&'Explicit current native helper not configured'},async t=>{
    const installation=readReadonlyMcpInstallation(),pins=readWindowsNativeHelperAttestation(process.env.PA_TEST_JOB_HOST_EXE);
    const base=realpathSync.native(await mkdtemp(join(tmpdir(),'pa-f21-protocol-'))),root=join(base,'workspace'),outside=join(base,'outside.txt');await mkdir(root);
    await writeFile(join(root,'reference.txt'),'PersonalAgent F21 bounded MCP protocol probe.\n');await writeFile(outside,'Controlled outside canary');
    const node=realpathSync.native(process.execPath),systemRoot=realpathSync.native(process.env.SystemRoot);
    const result=await createWindowsNativeSandboxExecutor({...pins,assertCurrent(){}}).execute({sandboxRef:'f21-test',revision:1,taskId:'f21-test',runId:'f21-test',
      authorizationRef:'f21-test',argumentsDigest:'a'.repeat(64),deadline:new Date(Date.now()+20000).toISOString(),signal:new AbortController().signal,maxOutputBytes:65536,
      profile:{sandboxRef:'f21-test',revision:1,mode:'read-only',backend:'windows-psec',readRoots:[root,systemRoot,dirname(node),dirname(pins.helperPath),
        dirname(installation.probePath),resolve(installation.packageRoot,'../..')],writeRoots:[],executableAllowlist:[node],network:{mode:'deny'}},
      executable:node,argv:['--preserve-symlinks','--preserve-symlinks-main',installation.probePath,installation.entryPath,root,outside],cwd:root,env:{SystemRoot:systemRoot,LOCALAPPDATA:base}});
    t.diagnostic(JSON.stringify({backend:result.backend,enforced:result.enforced,outcome:result.outcome,executionStarted:result.executionStarted,stopped:result.stopped,exitCode:result.exitCode,reason:result.reason}));
    assert.equal(result.enforced,true);assert.equal(result.stopped,true);assert.equal(result.outcome,'exited');assert.equal(result.exitCode,0,result.stderr);
    const value=JSON.parse(result.stdout);assert.equal(value.protocolVersion,'2025-11-25');assert.equal(value.filesReturned,1);
    assert.equal(value.osReadDenied,true);assert.equal(value.osWriteDenied,true);
  });

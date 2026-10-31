import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopNativeExecutionHost} from '../electron/native-execution-host.js';
import {readFileSync,mkdtempSync,rmSync,mkdirSync,writeFileSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runInNewContext} from 'node:vm';

test('an unprepared native backend reports lossless JSON so an ordinary application card can be persisted',async()=>{
  const host=createDesktopNativeExecutionHost({coding:{},question:{},getApplication:()=>({readAuthorizationQuestionInvocation:()=>undefined}),readConfiguration:()=>undefined,
    ensureHelper:async()=>{throw Error('No native command was requested');}});
  try{
    for(const mode of ['read-only','workspace-write','full-access']){
      const readiness=host.describeExecution({toolName:'desktop.authorization.intent',requirements:[]},{mode});
      assert.equal(readiness.required,false);assert.equal(readiness.available,false);assert.equal(readiness.enforced,false);
      assert.deepEqual(JSON.parse(JSON.stringify(readiness)),readiness,'trusted CAS must not discard undefined fields');
    }
    const required=host.describeExecution({toolName:'workspace.npm_test',requirements:[]},{mode:'workspace-write'});
    assert.equal(required.required,true);assert.equal(required.available,false);assert.equal(required.enforced,false);
    assert.equal(host.describeExecution({toolName:'coding.repair.trial',requirements:[]},{mode:'workspace-write'}).required,true);
    await assert.rejects(host.prepare({toolName:'workspace.npm_test'}),/未降级/);
  }finally{host.close();}
});

test('production Main supplies the pinned workspace and Node binding to native command preparation',async()=>{
  const root=mkdtempSync(path.join(tmpdir(),'pa-native-main-binding-'));
  const binding=Object.freeze({rootPath:root,nodeExecutable:process.execPath,bindingId:'synthetic-live-generation'});
  const source=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
  const begin=source.indexOf('nativeExecutionHost=createDesktopNativeExecutionHost(');
  const end=source.indexOf('const createWorkspaceCommandTool=',begin);
  assert.ok(begin>=0&&end>begin,'actual Main native composition must exist');
  let prepared=0,probeNode,host;
  const scope={taskId:'synthetic-task',runId:'synthetic-run',toolName:'workspace.npm_test',argumentsDigest:'a'.repeat(64),
    deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal};
  const context={createDesktopNativeExecutionHost:options=>(host=createDesktopNativeExecutionHost(options)),
    codingModule:{readWindowsNativeHelperAttestation:helperPath=>({helperPath,helperSha256:'b'.repeat(64)}),
      verifyWindowsNativeSandbox:async(_pins,options)=>{probeNode=options.nodeExecutable;return{available:true,enforced:true,helperSha256:'b'.repeat(64)};}},
    authorizationQuestionHost:{prepare:(_scope,input)=>{prepared++;assert.equal(input.assertCurrent(),true);}},
    runtimeApplication:{readAuthorizationQuestionInvocation:()=>({})},codingWorkspace:{readWorkspaceBinding:()=>binding,
      readDeveloperConfiguration:()=>{throw Error('developer metadata is not a native process binding');}},
    app:{getPath:()=>root,isPackaged:false},path,process,publish(){},existsSync:()=>true};
  try {
    runInNewContext(source.slice(begin,end),context);
    await host.prepare(scope);
    assert.equal(probeNode,process.execPath);assert.equal(prepared,1);
    assert.equal(host.describeExecution({toolName:scope.toolName,requirements:[]},{mode:'workspace-write'}).available,true);
  }finally{host?.close();rmSync(root,{recursive:true,force:true});}
});

test('a project-only helper recipe can read its exact pinned Node without a node-check recipe',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'pa-native-project-child-'));
  const locations=Object.fromEntries(['workspace','helper','node','system','compiler'].map(name=>{
    const folder=path.join(directory,name);mkdirSync(folder);return[name,realpathSync.native(folder)];}));
  const helper=path.join(locations.helper,'WindowsJobProcessHost.exe'),node=path.join(locations.node,'node.exe');
  writeFileSync(helper,'explicit synthetic helper');writeFileSync(node,'explicit synthetic Node');
  const canonicalHelper=realpathSync.native(helper),canonicalNode=realpathSync.native(node);
  const policy={ref:'synthetic-project-sandbox',revision:1,mode:'read-only'};
  const scope={taskId:'synthetic-project-task',runId:'synthetic-project-run',toolName:'workspace.npm_test',
    argumentsDigest:'a'.repeat(64),deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal};
  let bindingId='synthetic-workspace-generation';
  const host=createDesktopNativeExecutionHost({systemRoot:locations.system,localAppData:directory,probeRootPath:directory,
    readConfiguration:()=>({rootPath:locations.workspace,nodeExecutable:canonicalNode,bindingId}),
    ensureHelper:async()=>canonicalHelper,coding:{
      readWindowsNativeHelperAttestation:helperPath=>({helperPath,helperSha256:'b'.repeat(64)}),
      verifyWindowsNativeSandbox:async()=>({available:true,enforced:true,helperSha256:'b'.repeat(64)}),
      createWorkspaceCommandTool:options=>options},
    getApplication:()=>({readAuthorizationQuestionInvocation:()=>({}),runtime:{getTask:()=>({state:'running'})}}),
    question:{prepare(){},readExecutionPolicy:()=>policy,currentRequirement:()=>({})}});
  try {
    await host.prepare(scope);
    const context={...scope,authorizationRef:scope.runId};
    const recipe={id:'npm-test',executable:canonicalHelper,args:['--cwd',locations.workspace,'--exe',canonicalNode,'--','--test']};
    const command=host.createCommandTool({rootPath:locations.workspace,recipes:[recipe]});
    const profile=command.trustedSandbox.bind(context,scope.deadline).profile;
    assert.deepEqual(profile.executableAllowlist,[canonicalHelper,canonicalNode]);
    assert.ok(profile.readRoots.includes(locations.node));assert.deepEqual(profile.writeRoots,[]);
    assert.equal(profile.network.mode,'deny');assert.ok(!profile.readRoots.includes(directory),'Do not grant the common parent');
    const compiler=host.createCommandTool({rootPath:locations.workspace,recipes:[{id:'f20-typescript-sample',executable:canonicalNode,args:['fixed-check.cjs']}],
      trustedReadRoots:[locations.compiler]});
    const compiledProfile=compiler.trustedSandbox.bind(context,scope.deadline).profile;
    assert.ok(compiledProfile.readRoots.includes(locations.compiler));assert.deepEqual(compiledProfile.writeRoots,[]);
    assert.deepEqual(compiledProfile.executableAllowlist,[canonicalNode]);
    assert.throws(()=>host.createCommandTool({rootPath:locations.workspace,recipes:[recipe],trustedReadRoots:[locations.workspace]}),{code:'UNSUPPORTED_CAPABILITY'});
    rmSync(locations.compiler,{recursive:true});mkdirSync(locations.compiler);
    assert.throws(()=>compiler.trustedSandbox.bind(context,scope.deadline),{code:'UNSUPPORTED_CAPABILITY'});
    const foreign=host.createCommandTool({rootPath:locations.workspace,recipes:[{...recipe,args:[...recipe.args.slice(0,3),canonicalHelper,'--','--test']}]});
    assert.ok(!foreign.trustedSandbox.bind(context,scope.deadline).profile.readRoots.includes(locations.node),
      'An arbitrary nested target cannot acquire the selected Node root');
    bindingId='changed-workspace-generation';
    assert.throws(()=>command.trustedSandbox.bind(context,scope.deadline),{code:'UNSUPPORTED_CAPABILITY'});
  }finally{host.close();rmSync(directory,{recursive:true,force:true});}
});

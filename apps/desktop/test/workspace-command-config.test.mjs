import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import * as coding from '@personal-agent/coding-tools';
import {createWorkspaceCommandRecipeTool} from '../electron/workspace-command-recipes.js';
import {createWorkspaceConfigHost} from '../electron/workspace-config-host.js';

const cache=new URL('../../../.cache/workspace-command-config-tests/',import.meta.url);
mkdirSync(cache,{recursive:true});
const safeStorage={isEncryptionAvailable:()=>true,
  encryptString:value=>Buffer.from(value).reverse(),
  decryptString:value=>Buffer.from(value).reverse().toString()};
const createCommandRecipeTool=options=>createWorkspaceCommandRecipeTool({
  ...options,createWorkspaceCommandTool:coding.createWorkspaceCommandTool});

test('encrypted legacy workspace adds fixed Node check without granting writes or project scripts',async()=>{
  const root=mkdtempSync(new URL('root-',cache));
  const userData=mkdtempSync(new URL('data-',cache));
  const target=path.join(root,'syntax.js');writeFileSync(target,'const answer = 42;\n');
  const outside=path.join(userData,'outside.js');writeFileSync(outside,'const x = 1;\n');
  writeFileSync(path.join(root,'node.exe'),'not executable');
  let host=createWorkspaceConfigHost({userData,safeStorage,selectDirectory:async()=>root,
    selectNodeExecutable:async()=>process.execPath,selectCheckFile:async()=>target,createCommandRecipeTool});
  assert.equal(host.snapshot().configured,false);
  await host.select();await host.selectNode();
  await host.selectCheckFile();
  const record=readFileSync(path.join(userData,'coding-workspace.json'),'utf8');
  assert.equal(JSON.parse(record).version,1);
  for (const plain of [root,process.execPath,'syntax.js']) assert.equal(record.includes(plain),false);
  host.close();

  host=createWorkspaceConfigHost({userData,safeStorage,selectDirectory:async()=>undefined,
    selectNodeExecutable:async()=>path.join(root,'node.exe'),
    selectCheckFile:async()=>outside,createCommandRecipeTool});
  const checkpoints=new Map();
  host.bindApplication({runtime:{loadCheckpoint:(id,key)=>checkpoints.get(`${id}:${key}`),
    saveCheckpoint:(id,key,value)=>checkpoints.set(`${id}:${key}`,value)}});
  try {
    assert.equal(host.snapshot().configured,true);
    assert.equal(host.snapshot().nodeConfigured,true);
    assert.equal(host.snapshot().checkFileName,'syntax.js');
    const tool=host.tools.find(item=>item.descriptor.name==='workspace.node_check');
    assert.ok(tool);
    assert.deepEqual(tool.descriptor.inputSchema,{type:'object',properties:{},additionalProperties:false});
    const binding=host.competitionToolAvailability.find(item=>item.toolName==='workspace.node_check');
    const request={taskId:'node-task',signal:new AbortController().signal,
      deadline:new Date(Date.now()+30_000).toISOString()};
    assert.equal(binding.available(request),false);
    await host.authorize({cloudExportAllowed:true,writeAllowed:false,commandAllowed:true,projectCodeAllowed:false});
    assert.equal(host.snapshot().writeAvailable,false);
    assert.equal(host.snapshot().nodeCheckAvailable,true);
    assert.equal(host.snapshot().projectScriptsAvailable,false);
    assert.equal(binding.available(request),true);
    const result=await tool.execute({}, {...request,runId:'node-run',authorizationRef:'node-run',
      scopes:['workspace:execute']});
    assert.deepEqual([result.recipeId,result.exitCode],['node-check',0]);
    assert.equal(result.stderr,'');
    const cloud=host.competitionToolExports.find(item=>item.toolName==='workspace.node_check');
    assert.equal(cloud.accepts(request),true);
    assert.deepEqual(cloud.project({...request,result:{...result,stderr:`${root} private source`,stdout:'secret'}}),
      {recipeId:'node-check',exitCode:0,passed:true});
    host.revoke();assert.equal(binding.available(request),false);
    await assert.rejects(()=>host.authorize({cloudExportAllowed:true,writeAllowed:false,
      commandAllowed:true,projectCodeAllowed:true}),/尚未准备好/);
    await assert.rejects(host.selectNode(),/Node/);
    await assert.rejects(host.selectCheckFile(),/工作区/);
    assert.equal(host.snapshot().checkFileName,'syntax.js');
  } finally {host.close();}
});

test('project scripts need a trusted helper, factory receipt and separate session consent',async()=>{
  const root=mkdtempSync(new URL('project-',cache));
  const userData=mkdtempSync(new URL('project-data-',cache));
  const source=path.join(root,'syntax.js');writeFileSync(source,'const ready = true;\n');
  const npmCli=path.join(userData,'npm-cli.js');writeFileSync(npmCli,'// local fixture\n');
  const helper=path.join(userData,'WindowsJobProcessHost.exe');writeFileSync(helper,'fixture');
  const options={userData,safeStorage,selectDirectory:async()=>root,
    selectNodeExecutable:async()=>process.execPath,selectCheckFile:async()=>source,
    selectNpmCli:async()=>npmCli,jobHelperExecutable:helper};
  let host=createWorkspaceConfigHost(options);
  await host.select();await host.selectNode();await host.selectCheckFile();await host.selectNpmCli();host.close();
  const fakeFactory=input=>{
    assert.equal(input.allowProjectScripts,true);
    assert.equal(input.npmCliPath,npmCli);
    assert.equal(input.jobHelperExecutable,helper);
    const recipes=[{id:'node-check',executable:input.nodeExecutable,args:['--check','syntax.js']},
      {id:'npm-build',executable:helper,args:['--cwd',root,'--exe',input.nodeExecutable,'--',npmCli,'run','build']}];
    const tool={descriptor:coding.createWorkspaceCommandTool({rootPath:root,recipes}).descriptor,
    execute:async({recipeId})=>({recipeId,exitCode:0,stdout:'private source',stderr:`${root} private path`})};
    return {tool,recipes,diagnostics:{projectScriptsExposed:true}};
  };
  host=createWorkspaceConfigHost({...options,createCommandRecipeTool:fakeFactory});
  const checkpoints=new Map();host.bindApplication({runtime:{
    loadCheckpoint:(id,key)=>checkpoints.get(`${id}:${key}`),
    saveCheckpoint:(id,key,value)=>checkpoints.set(`${id}:${key}`,value)}});
  try {
    assert.equal(host.snapshot().projectScriptsAvailable,true);
    assert.deepEqual(host.snapshot().projectCommands,['build']);
    const binding=host.competitionToolAvailability.find(item=>item.toolName==='workspace.npm_build');
    const request={taskId:'project-task',signal:new AbortController().signal};
    assert.equal(binding.available(request),false);
    await assert.rejects(()=>host.authorize({cloudExportAllowed:true,writeAllowed:false,
      commandAllowed:false,projectCodeAllowed:true}),/不能授权/);
    await host.authorize({cloudExportAllowed:true,writeAllowed:false,commandAllowed:true,projectCodeAllowed:false});
    assert.equal(binding.available(request),false);
    await host.authorize({cloudExportAllowed:true,writeAllowed:false,commandAllowed:true,projectCodeAllowed:true});
    assert.equal(binding.available(request),true);
    const output=await host.tools.find(item=>item.descriptor.name==='workspace.npm_build')
      .execute({}, {...request,scopes:['workspace:execute']});
    assert.deepEqual(host.competitionToolExports.find(item=>item.toolName==='workspace.npm_build')
      .project({...request,result:output}),{recipeId:'npm-build',exitCode:0,passed:true});
    host.revoke();assert.equal(binding.available(request),false);
  } finally {host.close();}
});

test('current recipe readiness gates Node/project status, consent and Competition operations',async t=>{
  const root=mkdtempSync(new URL('readiness-',cache));
  const userData=mkdtempSync(new URL('readiness-data-',cache));
  t.after(()=>{rmSync(root,{recursive:true,force:true});rmSync(userData,{recursive:true,force:true});});
  const source=path.join(root,'syntax.js');writeFileSync(source,'const ready = true;\n');
  const npmCli=path.join(userData,'npm-cli.js');writeFileSync(npmCli,'// fixture npm\n');
  const helper=path.join(userData,'WindowsJobProcessHost.exe');writeFileSync(helper,'fixture helper');
  const node=path.join(userData,process.platform==='win32'?'node.exe':'node');writeFileSync(node,'fixture node');
  const packageFile=path.join(root,'package.json');
  const packageContent=JSON.stringify({scripts:{build:'echo synthetic',test:'echo synthetic'}});
  writeFileSync(packageFile,packageContent);mkdirSync(path.join(root,'node_modules'));
  const options={userData,safeStorage,selectDirectory:async()=>root,
    selectNodeExecutable:async()=>node,selectCheckFile:async()=>source,
    selectNpmCli:async()=>npmCli,jobHelperExecutable:helper};
  let host=createWorkspaceConfigHost(options);
  await host.select();await host.selectNode();await host.selectCheckFile();await host.selectNpmCli();host.close();
  let executions=0,readinessOverride;
  host=createWorkspaceConfigHost({...options,createCommandRecipeTool:options=>{
    const recipe=createWorkspaceCommandRecipeTool({...options,createWorkspaceCommandTool:input=>({
      ...coding.createWorkspaceCommandTool(input),execute:async({recipeId})=>{
        executions++;return {recipeId,exitCode:0,stdout:'',stderr:''};
      },
    })});
    return {...recipe,available:()=>readinessOverride?readinessOverride():recipe.available()};
  }});
  t.after(()=>host.close());
  const checkpoints=new Map();host.bindApplication({runtime:{
    loadCheckpoint:(id,key)=>checkpoints.get(`${id}:${key}`),
    saveCheckpoint:(id,key,value)=>checkpoints.set(`${id}:${key}`,value)}});
  const consent={cloudExportAllowed:true,writeAllowed:false,commandAllowed:true,projectCodeAllowed:true};
  await host.authorize(consent);
  const request={taskId:'ready-task',signal:new AbortController().signal};
  const names=['workspace.node_check','workspace.npm_build','workspace.npm_test'];
  for(const name of names) assert.equal(host.competitionToolAvailability.find(item=>item.toolName===name)
    .available(request),true);
  for(const read of [()=>false,()=>undefined,()=>'true',()=>{throw Error('private diagnostic');}]) {
    readinessOverride=read;
    assert.equal(host.snapshot().nodeCheckAvailable,false);
    assert.equal(host.snapshot().projectScriptsAvailable,false);
    await assert.rejects(()=>host.authorize(consent),/尚未准备好/);
    assert.doesNotMatch(JSON.stringify(host.snapshot()),/private diagnostic/);
  }
  readinessOverride=undefined;
  assert.equal(host.snapshot().nodeCheckAvailable,true);
  for(const [file,content] of [[packageFile,packageContent],[npmCli,'// fixture npm\n'],
    [helper,'fixture helper'],[source,'const ready = true;\n'],[node,'fixture node']]) {
    if(file===source) rmSync(file);else writeFileSync(file,`${content} changed`);
    assert.equal(host.snapshot().nodeCheckAvailable,false);
    assert.equal(host.snapshot().projectScriptsAvailable,false);
    assert.equal(host.snapshot().commandAvailable,
      host.tools.some(tool=>tool.descriptor.name==='workspace.git_diff_check'));
    assert.equal(host.snapshot().readAvailable,true,'command changes preserve read permission');
    assert.match(host.snapshot().commandReason,/重新装配/);
    assert.match(host.snapshot().projectReason,/重新装配/);
    await assert.rejects(()=>host.authorize(consent),/尚未准备好/);
    for(const name of names) {
      const binding=host.competitionToolAvailability.find(item=>item.toolName===name);
      const exported=host.competitionToolExports.find(item=>item.toolName===name);
      assert.equal(binding.available(request),false);
      assert.equal(exported.accepts(request),false);
      await assert.rejects(host.tools.find(item=>item.descriptor.name===name).execute({},request),/许可已撤销|绑定已改变/);
      assert.throws(()=>exported.project({...request,result:{recipeId:name==='workspace.node_check'?'node-check':'npm-build',exitCode:0}}),/consent changed/);
    }
    assert.equal(executions,0);
    if(file===node) break; // Metadata pin cannot be restored by rewriting a binary.
    writeFileSync(file,content);
    assert.equal(host.snapshot().nodeCheckAvailable,true);
    assert.equal(host.snapshot().projectScriptsAvailable,true);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {PROTOCOL_VERSION} from '@personal-agent/contracts';
import {createWorkspaceConfigHost} from '../electron/workspace-config-host.js';

async function workspaceBindingFixture(t) {
  const cache=path.resolve(fileURLToPath(new URL('../../../.cache/',import.meta.url)));
  await mkdir(cache,{recursive:true});
  const base=await mkdtemp(path.join(cache,'p6-workspace-binding-'));
  const root=path.join(base,'workspace'),otherRoot=path.join(base,'other-workspace');
  const userData=path.join(base,'user-data'),nodeDir=path.join(base,'node-a'),otherNodeDir=path.join(base,'node-b');
  await Promise.all([root,otherRoot,userData,nodeDir,otherNodeDir].map(dir=>mkdir(dir)));
  const nodeName=process.platform==='win32'?'node.exe':'node';
  const node=path.join(nodeDir,nodeName),otherNode=path.join(otherNodeDir,nodeName);
  // Metadata fixtures only: neither selected executable is ever launched.
  await writeFile(node,'synthetic node A');await writeFile(otherNode,'synthetic node B');
  const configuration=path.join(userData,'coding-workspace.json');
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
  await writeFile(configuration,JSON.stringify({version:1,encrypted:Buffer.from(root).toString('base64'),
    encryptedNode:Buffer.from(node).toString('base64')}));
  const hosts=[];
  const open=(options={})=> {
    const host=createWorkspaceConfigHost({userData,safeStorage,
      selectDirectory:async()=>otherRoot,selectNodeExecutable:async()=>otherNode,...options});
    hosts.push(host);return host;
  };
  t.after(async()=> {
    for(const host of hosts) host.close();
    assert.equal(path.dirname(base),cache); // Only this newly created cache fixture is removed.
    assert.ok(path.basename(base).startsWith('p6-workspace-binding-'));
    await rm(base,{recursive:true,force:true});
  });
  return {root,node,configuration,open};
}
const allowWorkspaceRead=host=>host.authorize({cloudExportAllowed:true,writeAllowed:false,commandAllowed:false});

test('local read consent permits MCP binding without granting AgentArts availability or export',async t=>{
  const {root,open}=await workspaceBindingFixture(t);
  const host=open();
  assert.equal(host.readWorkspaceBinding(),undefined);
  host.authorize({cloudExportAllowed:false,writeAllowed:false,commandAllowed:false});
  const binding=host.readWorkspaceBinding();
  assert.equal(binding.rootPath,root);
  host.bindApplication({runtime:{loadCheckpoint:(_taskId,key)=>
    key==='desktop-coding-scope'?binding.bindingId:undefined}});
  assert.equal(host.snapshot().readAvailable,true);
  assert.equal(host.snapshot().cloudExportAllowed,false);
  assert.equal(host.snapshot().writeAvailable,false);
  assert.equal(host.snapshot().commandAvailable,false);
  assert.equal(host.readWorkspaceExportConfigurationRef(),undefined);
  for(const entry of host.competitionToolAvailability) {
    assert.equal(await entry.available({taskId:'local-only',signal:new AbortController().signal}),false);
  }
  for(const entry of host.competitionToolExports) {
    assert.equal(entry.accepts({taskId:'local-only'}),false);
    assert.throws(()=>entry.project({taskId:'local-only',signal:new AbortController().signal}),
      error=>error.code==='UNAUTHORIZED');
  }
  host.revoke();
  assert.equal(host.readWorkspaceBinding(),undefined);
  assert.equal(host.isWorkspaceBindingCurrent(binding),false);
  assert.equal(host.snapshot().readAvailable,false);
  assert.equal(open().readWorkspaceBinding(),undefined);
});

test('native selector cancellation receipts are explicit and never persist into snapshots or authorization',async t=>{
  const {root,configuration,open}=await workspaceBindingFixture(t);
  const host=open({selectDirectory:async()=>undefined,selectNodeExecutable:async()=>undefined,
    selectCheckFile:async()=>undefined,selectNpmCli:async()=>undefined});
  const before=await readFile(configuration,'utf8');
  for(const method of ['select','selectNode','selectCheckFile','selectNpmCli']) {
    const snapshot=host.snapshot(),result=await host[method]();
    assert.deepEqual(result,{...snapshot,selectionCancelled:true});
    assert.deepEqual(host.snapshot(),snapshot);
    assert.equal(Object.hasOwn(host.snapshot(),'selectionCancelled'),false);
    assert.equal(await readFile(configuration,'utf8'),before);
  }
  assert.equal(Object.hasOwn(host.authorize({cloudExportAllowed:true,writeAllowed:false,commandAllowed:false}),'selectionCancelled'),false);
  assert.equal(Object.hasOwn(host.revoke(),'selectionCancelled'),false);
  const selected=await open({selectDirectory:async()=>root}).select();
  assert.equal(Object.hasOwn(selected,'selectionCancelled'),false);
  assert.equal(Object.hasOwn(JSON.parse(await readFile(configuration,'utf8')),'selectionCancelled'),false);
});

test('native selections cannot persist late results after their workspace host closes',async t=>{
  for(const [method,selector] of [['select','selectDirectory'],['selectNode','selectNodeExecutable'],
    ['selectCheckFile','selectCheckFile'],['selectNpmCli','selectNpmCli']]) {
    await t.test(method,async t=>{
      const {root,node,configuration,open}=await workspaceBindingFixture(t);
      const choices={select:path.join(path.dirname(root),'other-workspace'),
        selectNode:path.join(path.dirname(root),'node-b',path.basename(node)),
        selectCheckFile:path.join(root,'synthetic.js'),selectNpmCli:path.join(path.dirname(root),'npm-cli.js')};
      await writeFile(choices.selectCheckFile,'const synthetic = true;\n');
      await writeFile(choices.selectNpmCli,'// synthetic npm fixture\n');
      let settle,calls=0;
      const host=open({[selector]:()=>{calls++;return new Promise(done=>{settle=done;});}});
      const before=await readFile(configuration,'utf8');
      const pending=host[method]();host.close();
      const rejected=assert.rejects(pending,/选择已失效|宿主已关闭/);
      settle(choices[method]);await rejected;
      assert.equal(await readFile(configuration,'utf8'),before,'the closed host must not replace persisted selections');
      await assert.rejects(host[method](),/宿主已关闭/);
      assert.equal(calls,1,'closed hosts cannot reopen native selectors');
    });
  }
});

test('revocation invalidates an outstanding native choice before it can overwrite settings',async t=>{
  const {configuration,open}=await workspaceBindingFixture(t);
  let settle;
  const host=open({selectDirectory:()=>new Promise(done=>{settle=done;})});
  allowWorkspaceRead(host);
  const before=await readFile(configuration,'utf8');
  const pending=host.select();host.revoke();
  const rejected=assert.rejects(pending,/选择已失效/);
  settle(path.join(path.dirname(configuration),'..','other-workspace'));await rejected;
  assert.equal(await readFile(configuration,'utf8'),before);
  assert.equal(host.snapshot().cloudExportAllowed,false);
});

test('an older native choice cannot overwrite a newer confirmed selection',async t=>{
  const {root,configuration,open}=await workspaceBindingFixture(t);
  const choices=[];
  const host=open({selectDirectory:()=>new Promise(done=>{choices.push(done);})});
  const older=host.select(),newer=host.select();
  choices[1](path.join(path.dirname(root),'other-workspace'));await newer;
  const confirmed=await readFile(configuration,'utf8');
  const rejected=assert.rejects(older,/选择已失效/);
  choices[0](root);await rejected;
  assert.equal(await readFile(configuration,'utf8'),confirmed);
  assert.equal(host.snapshot().displayName,'other-workspace');
});

test('trusted workspace binding requires session consent and invalidates old generations', async t=> {
  const {root,node,configuration,open}=await workspaceBindingFixture(t);
  const host=open();
  assert.equal(host.readWorkspaceBinding(),undefined);
  const stored=await readFile(configuration,'utf8');
  allowWorkspaceRead(host);
  const binding=host.readWorkspaceBinding();
  assert.deepEqual(Object.keys(binding),['rootPath','nodeExecutable','bindingId']);
  assert.equal(binding.rootPath,root);assert.equal(binding.nodeExecutable,node);assert.ok(Object.isFrozen(binding));
  assert.equal(host.isWorkspaceBindingCurrent({...binding}),true);
  assert.equal(host.isWorkspaceBindingCurrent({...binding,bindingId:'old'}),false);
  assert.equal(host.isWorkspaceBindingCurrent({...binding,extra:true}),false);
  let getterReads=0;
  assert.equal(host.isWorkspaceBindingCurrent({nodeExecutable:node,bindingId:binding.bindingId,
    get rootPath(){getterReads++;return root;}}),false);
  assert.equal(getterReads,0);
  const visible=JSON.stringify(host.snapshot());
  for(const privateValue of [root,node,binding.bindingId]) assert.equal(visible.includes(privateValue),false);
  assert.equal(await readFile(configuration,'utf8'),stored);
  host.revoke();assert.equal(host.readWorkspaceBinding(),undefined);
  assert.equal(host.isWorkspaceBindingCurrent(binding),false);
  allowWorkspaceRead(host);
  const renewed=host.readWorkspaceBinding();
  assert.notEqual(renewed.bindingId,binding.bindingId);assert.equal(host.isWorkspaceBindingCurrent(binding),false);
  host.close();assert.equal(host.readWorkspaceBinding(),undefined);
  assert.equal(host.isWorkspaceBindingCurrent(renewed),false);
  assert.equal(open().readWorkspaceBinding(),undefined); // Encrypted settings never restore consent.
});

test('trusted workspace binding rejects changed selections until reassembly', async t=> {
  const {open}=await workspaceBindingFixture(t);
  let host=open();allowWorkspaceRead(host);
  const original=host.readWorkspaceBinding();
  await host.selectNode();
  assert.equal(host.readWorkspaceBinding(),undefined);assert.equal(host.isWorkspaceBindingCurrent(original),false);
  assert.throws(()=>allowWorkspaceRead(host),/重启/);assert.equal(host.readWorkspaceBinding(),undefined);
  host.close();host=open();allowWorkspaceRead(host);
  const rebound=host.readWorkspaceBinding();assert.ok(rebound);
  await host.select();
  assert.equal(host.readWorkspaceBinding(),undefined);assert.equal(host.isWorkspaceBindingCurrent(rebound),false);
  assert.throws(()=>allowWorkspaceRead(host),/重启/);
});

test('changed command selections require reassembly instead of authorizing startup inputs',async t=>{
  for(const method of ['selectNode','selectCheckFile','selectNpmCli']) {
    await t.test(method,async t=>{
      const {root,node,configuration,open}=await workspaceBindingFixture(t);
      const first=path.join(root,'first.js'),second=path.join(root,'second.js');
      const firstNpm=path.join(path.dirname(node),'node_modules','npm','bin','npm-cli.js');
      const secondNpm=path.join(path.dirname(root),'npm-b','npm-cli.js');
      const helper=path.join(path.dirname(root),'WindowsJobProcessHost.exe');
      await Promise.all([mkdir(path.dirname(firstNpm),{recursive:true}),mkdir(path.dirname(secondNpm))]);
      await Promise.all([first,second,firstNpm,secondNpm,helper].map(file=>writeFile(file,'// synthetic metadata only\n')));
      const record=JSON.parse(await readFile(configuration,'utf8'));
      record.encryptedCheckFile=Buffer.from('first.js').toString('base64');
      record.encryptedNpmCli=Buffer.from(firstNpm).toString('base64');
      await writeFile(configuration,JSON.stringify(record));
      let selection;
      let executionCount=0;
      let executedBinding;
      const factory=options=>({
        tool:{descriptor:{name:'workspace.run_allowed_command',version:'1.0.0',sideEffect:'local_write',
          requiredScopes:['workspace:execute']},execute:async({recipeId})=>{
            executionCount++;
            executedBinding={node:options.nodeExecutable,file:options.checkFiles[0].path,npm:options.npmCliPath};
            return {recipeId,exitCode:0};
          }},
        recipes:[{id:'node-check',executable:options.nodeExecutable,args:['--check',options.checkFiles[0].path]},
          ...(options.allowProjectScripts?[{id:'npm-build',executable:helper,args:['--cwd',root,'--exe',options.nodeExecutable,
            '--',options.npmCliPath,'run','build']}]:[])],
        diagnostics:{projectScriptsExposed:options.allowProjectScripts},
      });
      const selectors={selectNode:'selectNodeExecutable',selectCheckFile:'selectCheckFile',selectNpmCli:'selectNpmCli'};
      const options={jobHelperExecutable:helper,createCommandRecipeTool:factory,
        [selectors[method]]:async()=>selection};
      let host=open(options);
      const checkpoints=new Map();
      const application={runtime:{loadCheckpoint:(id,key)=>checkpoints.get(`${id}:${key}`),
        saveCheckpoint:(id,key,value)=>checkpoints.set(`${id}:${key}`,value)}};
      host.bindApplication(application);
      const permission={cloudExportAllowed:true,writeAllowed:false,commandAllowed:true,projectCodeAllowed:true};
      host.authorize(permission);
      const request={taskId:'before-selection',signal:new AbortController().signal};
      const available=name=>host.competitionToolAvailability.find(tool=>tool.toolName===name).available(request);
      assert.equal(available('workspace.node_check'),true);
      await host[method](); // Cancel leaves the existing authorization untouched.
      assert.equal(host.snapshot().cloudExportAllowed,true);
      selection={selectNode:node,selectCheckFile:first,selectNpmCli:firstNpm}[method];
      await host[method]();
      assert.equal(host.snapshot().authorizationAvailable,true);
      host.authorize(permission);
      assert.equal(available('workspace.node_check'),false,'renewing consent never revives an old task binding');
      request.taskId='after-unchanged-selection';
      assert.equal(available('workspace.node_check'),true);
      selection={selectNode:path.join(path.dirname(root),'node-b',path.basename(node)),
        selectCheckFile:second,selectNpmCli:secondNpm}[method];
      await host[method]();
      assert.equal(host.snapshot().authorizationAvailable,false);
      assert.equal(host.snapshot().cloudExportAllowed,false);
      assert.equal(host.snapshot().projectScriptsAvailable,false);
      assert.match(host.snapshot().reason,/重启/);
      assert.throws(()=>host.authorize(permission),/重启/);
      assert.equal(available('workspace.node_check'),false);
      assert.equal(available('workspace.npm_build'),false);
      await assert.rejects(host.tools.find(tool=>tool.descriptor.name==='workspace.node_check').execute({},request),/许可已撤销|绑定已改变/);
      assert.equal(executionCount,0,'stale command closures must not execute');
      host.close();host=open(options);host.bindApplication(application);
      host.authorize({...permission,projectCodeAllowed:method!=='selectNode'});
      assert.equal(host.snapshot().authorizationAvailable,true);
      assert.equal(host.snapshot().nodeCheckAvailable,true);
      if(method==='selectCheckFile') assert.equal(host.snapshot().checkFileName,'second.js');
      assert.equal(available('workspace.node_check'),false,'reassembly keeps previous task bindings invalid');
      request.taskId='after-reassembly';
      assert.equal(available('workspace.node_check'),true);
      await host.tools.find(tool=>tool.descriptor.name==='workspace.node_check').execute({},request);
      assert.equal(executionCount,1);
      assert.equal(executedBinding.node,method==='selectNode'?selection:node);
      assert.equal(executedBinding.file,method==='selectCheckFile'?'second.js':'first.js');
      assert.equal(executedBinding.npm,method==='selectNode'?undefined:method==='selectNpmCli'?secondNpm:firstNpm);
    });
  }
});

test('trusted workspace binding rejects root or Node replacement at the same path', async t=> {
  for(const changed of ['root','node']) {
    const {root,node,open}=await workspaceBindingFixture(t);
    const host=open();allowWorkspaceRead(host);
    const binding=host.readWorkspaceBinding();
    if(changed==='node') {await rename(node,node+'.previous');await writeFile(node,'synthetic node C');}
    else {await rename(root,root+'-previous');await mkdir(root);}
    assert.equal(host.readWorkspaceBinding(),undefined);assert.equal(host.isWorkspaceBindingCurrent(binding),false);
  }
});

// Prepared for the final unified suite. These do not grant PUBLIC export consent.
test('workspace export gate keeps source local and redacts non-content result projections', async t=> {
  const {root,open}=await workspaceBindingFixture(t);
  const host=open();
  const checkpoints=new Map();
  host.bindApplication({runtime:{loadCheckpoint:(id,key)=>checkpoints.get(id+key),
    saveCheckpoint:(id,key,value)=>checkpoints.set(id+key,value)}});
  await writeFile(path.join(root,'private.js'),'const privateValue="LOCAL_ONLY";\n');
  host.authorize({cloudExportAllowed:true,writeAllowed:true,commandAllowed:false});
  const request={taskId:'export-private',proposalId:'proposal-private',
    signal:new AbortController().signal,deadline:new Date(Date.now()+30000).toISOString()};
  const local=async(name,args,scopes)=> {
    assert.equal(host.competitionToolAvailability.find(item=>item.toolName===name).available(request),true);
    return host.tools.find(item=>item.descriptor.name===name).execute(args,{...request,scopes});
  };
  const read=await local('workspace.read_text',{path:'private.js'},['workspace:read']);
  assert.match(read.content,/LOCAL_ONLY/); // The real local result is preserved.
  const readExport=host.competitionToolExports.find(item=>item.toolName==='workspace.read_text');
  assert.throws(()=>readExport.project({...request,result:read}),{code:'UNSUPPORTED_CAPABILITY'});
  const list=await local('workspace.list_entries',{path:'.'},['workspace:list']);
  const listExport=host.competitionToolExports.find(item=>item.toolName==='workspace.list_entries');
  assert.deepEqual(listExport.project({...request,result:list}),{listed:true,truncated:false});
  const preview=await local('workspace.preview_text_patch',{path:'private.js',expectedSha256:read.sha256,
    edits:[{oldText:'LOCAL_ONLY',newText:'STILL_LOCAL'}]},['workspace:read']);
  const previewExport=host.competitionToolExports.find(item=>item.toolName==='workspace.preview_text_patch');
  const safe=previewExport.project({...request,result:preview});
  assert.deepEqual(safe,{previewed:true,changed:true});
  for(const privateValue of ['private.js','LOCAL_ONLY','STILL_LOCAL',read.sha256]) {
    assert.equal(JSON.stringify(safe).includes(privateValue),false);
  }
  assert.throws(()=>previewExport.project({...request,result:{...preview,unexpected:'private'}}),{code:'INVALID_ARGUMENT'});
  const cancelled=new AbortController();cancelled.abort();
  assert.throws(()=>previewExport.project({...request,signal:cancelled.signal,result:preview}),{code:'CANCELLED'});
  host.revoke();assert.throws(()=>previewExport.project({...request,result:preview}),{code:'UNAUTHORIZED'});
});

test('selected workspace binds tasks, keeps consent session-only and rejects reuse after revocation', async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'pa-coding-selected-'));
  const userData=await mkdtemp(path.join(os.tmpdir(),'pa-coding-config-'));
  await writeFile(path.join(root,'hello.js'),'console.log("hello");\n');
  const largerSource='// Synthetic source above the old demo limit\n'.repeat(256);
  await writeFile(path.join(root,'larger.js'),largerSource);
  // Explicit in-memory crypto stand-in; no actual account configuration is accessed.
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
  let host=createWorkspaceConfigHost({userData,safeStorage,selectDirectory:async()=>root});
  assert.equal(host.snapshot().configured,false);
  await host.select();assert.equal(host.snapshot().configured,true);
  assert.match(host.snapshot().reason,/重启/);host.close();
  host=createWorkspaceConfigHost({userData,safeStorage,selectDirectory:async()=>undefined});
  const checkpoints=new Map();
  host.bindApplication({runtime:{loadCheckpoint:(id,key)=>checkpoints.get(id+key),
    saveCheckpoint:(id,key,value)=>checkpoints.set(id+key,value)}});
  const request={taskId:'task-one',signal:new AbortController().signal,deadline:new Date(Date.now()+30000).toISOString()};
  const binding=host.competitionToolAvailability.find(item=>item.toolName==='workspace.read_text');
  const read=host.tools.find(item=>item.descriptor.name==='workspace.read_text');
  const context={...request,scopes:['workspace:read']};
  try {
    assert.equal(binding.available(request),false);
    host.authorize({cloudExportAllowed:true,writeAllowed:false,commandAllowed:false});
    assert.equal(binding.available(request),true);
    const result=await read.execute({path:'hello.js'},context);
    assert.equal(result.content,'console.log("hello");\n');
    const policy=host.competitionToolExports.find(item=>item.toolName==='workspace.read_text');
    const larger=await read.execute({path:'larger.js'},context);
    assert.equal(larger.content,largerSource);
    assert.throws(()=>policy.project({...request,result:larger}),{code:'UNSUPPORTED_CAPABILITY'});
    assert.equal(policy.accepts(request),false); // Local consent supplies no exact PUBLIC grant.
    host.revoke();assert.equal(policy.accepts(request),false);
    await assert.rejects(read.execute({path:'hello.js'},context),/撤销|绑定/);
    host.authorize({cloudExportAllowed:true,writeAllowed:false,commandAllowed:false});
    assert.equal(binding.available(request),false);
    assert.equal(binding.available({...request,taskId:'task-two'}),true);
  } finally {host.close();}
});

// Prepared unit fixtures only, not real Runtime/Policy/Evidence acceptance.
// The export implementation itself is imported from its public cloud package.
async function confirmedExportFixture(t) {
  const {createWorkspaceReferenceExport}=await import('@personal-agent/mcp');
  const {open,root}=await workspaceBindingFixture(t);
  const taskId='prepared-workspace-task',proposalId='prepared-original-proposal';
  const runId=`competition-tool-${taskId}-1`,args={path:'public-reference.js',maxBytes:1024};
  const content='// Explicit synthetic PUBLIC reference\r\n';
  const result={path:args.path,encoding:'utf-8',byteLength:Buffer.byteLength(content),content,
    sha256:createHash('sha256').update(content).digest('hex')};
  const deadline=new Date(Date.now()+60000).toISOString();
  const proposal={kind:'tool_proposal',proposalId,toolName:'workspace.read_text',toolVersion:'1.0.0',
    arguments:structuredClone(args),verification:'unverified'};
  const finishedAt=new Date(Date.now()-100).toISOString();
  const data={task:{taskId,state:'running',evidenceRefs:[runId]},
    record:{evidenceId:runId,taskId,protocolVersion:PROTOCOL_VERSION,requestId:'original-runtime-request',
      toolName:proposal.toolName,toolVersion:proposal.toolVersion,policyDecision:'allow',executionStarted:true,
      state:'confirmed',startedAt:new Date(Date.now()-200).toISOString(),finishedAt},
    evidence:[{evidenceId:runId,kind:'execution',sourceRef:proposal.toolName,capturedAt:finishedAt}],
    result:structuredClone(result),loop:{step:1,pending:proposal,evidenceRefs:[],receipts:[]},
    preflight:{authorizationId:'prepared-native-public-grant',expiresAt:deadline,sensitivity:'PUBLIC',
      purpose:'coding-reference',maxExportBytes:1024}};
  data.permission={...data.preflight,contentDigest:result.sha256};
  const checkpoints=new Map([[`${taskId}:application-profile`,'huawei_ict_agentarts'],
    [`${taskId}:application-deadline`,deadline]]);
  const runtime={getTask:()=>structuredClone(data.task),
    loadCheckpoint:(id,key)=>key==='competition-loop'?structuredClone(data.loop)
      :key===`tool-result-${runId}`?{result:structuredClone(data.result)}:checkpoints.get(`${id}:${key}`),
    saveCheckpoint:(id,key,value)=>checkpoints.set(`${id}:${key}`,value),
    readToolExecutions:()=>[structuredClone(data.record)],readEvidence:()=>structuredClone(data.evidence),
    matchesToolExecutionInput:(_record,input)=>input.scopeRef===runId && isDeepStrictEqual(input.arguments,args)};
  const host=open({createWorkspaceReferenceExport,readWorkspaceExportPreflight:query=> {
    data.onPreflight?.(query);return data.preflight;
  },readWorkspaceExportAuthorization:query=> {
    data.onAuthorization?.(query);return data.permission;
  }});
  host.bindApplication({runtime});allowWorkspaceRead(host);
  const signal=new AbortController();
  host.competitionToolAvailability.find(item=>item.toolName==='workspace.read_text')
    .available({taskId,signal:signal.signal});
  const query={taskId,proposalId,path:args.path,configurationRef:host.readWorkspaceExportConfigurationRef()};
  const request={taskId,proposalId,arguments:structuredClone(args),phase:'preflight'};
  const exporter=host.competitionToolExports.find(item=>item.toolName==='workspace.read_text');
  return {host,root,data,checkpoints,query,request,exporter,result,runId,signal,deadline};
}

test('native PUBLIC workspace export consumes original confirmed result and pins its proposal/run', async t=> {
  const f=await confirmedExportFixture(t);
  const candidate=f.host.readWorkspaceExportCandidate(f.query);
  assert.equal(candidate.runId,f.runId);assert.equal(candidate.contentDigest,f.result.sha256);
  assert.deepEqual(candidate.arguments,f.request.arguments);assert.ok(Object.isFrozen(candidate));
  assert.equal(Object.hasOwn(candidate,'content'),false);
  assert.equal(f.exporter.exportPolicyVersion,'workspace-reference-3.0.0');
  assert.equal(f.exporter.accepts(f.request),true);
  const projected=f.exporter.project({...f.request,result:f.result,signal:f.signal.signal});
  assert.deepEqual(projected,{source:'approved-workspace-reference',content:f.result.content,
    byteLength:f.result.byteLength,contentDigest:f.result.sha256,truncated:false,readConfirmed:true});
  for(const localOnly of [f.root,f.query.path,f.runId,f.data.permission.authorizationId]) {
    assert.equal(JSON.stringify(projected).includes(localOnly),false);
    assert.equal(JSON.stringify(f.host.snapshot()).includes(localOnly),false);
  }
  assert.throws(()=>f.exporter.project({...f.request,result:{...f.result,content:'swapped'},signal:f.signal.signal}),
    {code:'UNAUTHORIZED'});
  assert.equal(f.exporter.accepts({...f.request,arguments:{...f.request.arguments,maxBytes:512}}),false);
  const originalProposal=f.data.loop.pending;
  f.data.loop={step:2,evidenceRefs:[f.runId],receipts:[{proposal:originalProposal,
    continuation:{proposalId:f.query.proposalId,state:'confirmed',result:projected},
    exportPolicyVersion:f.exporter.exportPolicyVersion}]};
  assert.equal(f.exporter.accepts(f.request),true); // Uses the already pinned original mapping.
  assert.deepEqual(f.host.readConfirmedWorkspaceExport({...f.query,arguments:f.request.arguments,contentDigest:f.result.sha256}),
    {runId:f.runId,result:f.result});
  f.data.result={...f.result,content:'another confirmed-looking result',
    byteLength:Buffer.byteLength('another confirmed-looking result'),
    sha256:createHash('sha256').update('another confirmed-looking result').digest('hex')};
  assert.equal(f.host.readWorkspaceExportCandidate(f.query),undefined);
});

test('workspace confirmed reader rejects wrong original identity, input, execution and Evidence', async t=> {
  const changes={
    taskSnapshot:data=>{data.task.taskId='other-task';},
    task:data=>{data.record.taskId='other-task';},
    run:data=>{data.record.evidenceId='other-run';},
    tool:data=>{data.record.toolName='mcp.workspace.read_text';},
    version:data=>{data.record.toolVersion='2.0.0';},
    protocol:data=>{data.record.protocolVersion='0.0.0';},
    scopeAndArguments:data=>{data.loop.pending.arguments.maxBytes=512;},
    policy:data=>{data.record.policyDecision='deny';},
    unknown:data=>{data.record.state='unknown';},
    notExecuted:data=>{data.record.executionStarted=false;},
    unfinished:data=>{delete data.record.finishedAt;},
    taskEvidence:data=>{data.task.evidenceRefs=[];},
    evidence:data=>{data.evidence[0].sourceRef='other-tool';},
    historicResult:data=>{delete data.result.sha256;},
    invalidBytes:data=>{data.result.byteLength++;},
    proposal:data=>{data.loop.pending.proposalId='another-proposal';},
    noOriginalMapping:data=>{data.loop.receipts=[{proposal:data.loop.pending}];delete data.loop.pending;},
    cancelled:data=>{data.task.cancelRequested=true;},
  };
  for(const [name,change] of Object.entries(changes)) await t.test(name,async sub=> {
    const f=await confirmedExportFixture(sub);change(f.data);
    assert.equal(f.host.readWorkspaceExportCandidate(f.query),undefined);
    assert.equal(f.host.readConfirmedWorkspaceExport({...f.query,arguments:f.request.arguments,contentDigest:f.result.sha256}),undefined);
    assert.equal(f.exporter.accepts({...f.request,phase:'final',projection:{source:'approved-workspace-reference',
      content:f.result.content,byteLength:f.result.byteLength,contentDigest:f.result.sha256,
      truncated:false,readConfirmed:true}}),false);
  });
});

test('workspace export rechecks native revocation, grant replacement, deadline and cancellation', async t=> {
  const f=await confirmedExportFixture(t);
  assert.equal(f.exporter.accepts(f.request),true);
  const permission=f.data.permission;
  const preflight=f.data.preflight;
  f.data.preflight={...preflight,authorizationId:'replacement-grant'};
  assert.equal(f.exporter.accepts(f.request),false);
  f.data.preflight=preflight;f.data.permission=permission;
  f.data.onAuthorization=()=>f.signal.abort();
  assert.throws(()=>f.exporter.project({...f.request,result:f.result,signal:f.signal.signal}),{code:'CANCELLED'});
  f.data.onAuthorization=undefined;
  f.checkpoints.set(`${f.query.taskId}:application-deadline`,new Date(Date.now()-1).toISOString());
  assert.equal(f.exporter.accepts(f.request),false);
  f.checkpoints.set(`${f.query.taskId}:application-deadline`,f.deadline);
  f.data.onPreflight=()=>f.host.revoke();
  assert.equal(f.exporter.accepts(f.request),false);
  assert.equal(f.host.readWorkspaceExportConfigurationRef(),undefined);
  allowWorkspaceRead(f.host);
  assert.notEqual(f.host.readWorkspaceExportConfigurationRef(),f.query.configurationRef);
  assert.equal(f.host.readWorkspaceExportCandidate(f.query),undefined);
});

test('first PUBLIC preflight never claims confirmation and final checks require the original read', async t=> {
  const f=await confirmedExportFixture(t);
  const confirmedRecord=f.data.record,confirmedResult=f.data.result;
  f.data.record={...confirmedRecord,state:'started',policyDecision:'not_evaluated',executionStarted:false};
  delete f.data.result;
  const target=f.host.readWorkspaceExportPreflightCandidate(f.query);
  assert.ok(target);assert.deepEqual(target.arguments,f.request.arguments);
  assert.equal(Object.hasOwn(target,'contentDigest'),false);assert.equal(Object.hasOwn(target,'byteLength'),false);
  assert.equal(f.host.readWorkspaceExportCandidate(f.query),undefined);
  assert.equal(f.exporter.accepts(f.request),true);
  assert.equal(f.exporter.accepts({...f.request,phase:'final'}),false);
  f.data.loop.step=2;
  assert.equal(f.host.readWorkspaceExportPreflightCandidate(f.query),undefined); // Cannot swap the original run.
  f.data.loop.step=1;
  assert.throws(()=>f.exporter.project({...f.request,result:f.result,signal:f.signal.signal}),{code:'UNAUTHORIZED'});
  f.data.record=confirmedRecord;f.data.result=confirmedResult;
  const projection=f.exporter.project({...f.request,result:f.result,signal:f.signal.signal});
  assert.equal(f.exporter.accepts({...f.request,phase:'final',projection}),true);
  assert.equal(f.exporter.accepts({...f.request,phase:'final',projection:{...projection,content:'swapped'}}),false);
  f.data.permission=undefined;
  assert.equal(f.exporter.accepts({...f.request,phase:'final',projection}),false);
});

test('PUBLIC export requires native purpose, byte bound and exact post-read scope', async t=> {
  const f=await confirmedExportFixture(t);
  const scope=f.data.preflight;
  f.data.preflight=undefined;assert.equal(f.exporter.accepts(f.request),false);
  f.data.preflight={...scope,sensitivity:'PRIVATE'};assert.equal(f.exporter.accepts(f.request),false);
  f.data.preflight={...scope,purpose:'arbitrary-send'};assert.equal(f.exporter.accepts(f.request),false);
  f.data.preflight={...scope,expiresAt:new Date(Date.parse(f.deadline)+60000).toISOString()};
  assert.equal(f.exporter.accepts(f.request),false);
  f.data.preflight={...scope,maxExportBytes:1};assert.equal(f.exporter.accepts(f.request),true);
  assert.throws(()=>f.exporter.project({...f.request,result:f.result,signal:f.signal.signal}),{code:'UNAUTHORIZED'});
  // A fresh task/host has a separate original permission binding; do not replace it.
  const other=await confirmedExportFixture(t);
  assert.equal(other.exporter.accepts(other.request),true);
  other.data.permission={...other.data.permission,purpose:'reference-summary'};
  assert.throws(()=>other.exporter.project({...other.request,result:other.result,signal:other.signal.signal}),{code:'UNAUTHORIZED'});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createDeveloperSettingsHost} from '../electron/developer-settings-host.js';

// Explicit Fake of the original Runtime checkpoint port. The same instance
// survives settings-host reconstruction; it is not a second task store.
function runtimeFixture(){
  let sequence=0;const tasks=new Map(),checkpoints=new Map();
  return {checkpoints,failSave:false,lieAboutSave:false,
    add(taskId){if(!tasks.has(taskId))tasks.set(taskId,{taskId,conversationId:'synthetic',sequence:++sequence});return taskId;},
    getTask(id){const task=tasks.get(id);if(!task)throw Error('unknown synthetic task');return task;},
    listTasks({limit=100,snapshotSequence=sequence,beforeSequence=Infinity,conversationId}={}){
      const rows=[...tasks.values()].filter(task=>task.sequence<=snapshotSequence&&task.sequence<beforeSequence
        &&(!conversationId||task.conversationId===conversationId)).sort((a,b)=>b.sequence-a.sequence);
      const items=rows.slice(0,limit);return {items,snapshotSequence,
        ...(rows.length>limit?{nextBeforeSequence:items.at(-1).sequence}:{})};
    },
    loadCheckpoint(id,key){return checkpoints.get(id+'|'+key);},
    saveCheckpointOnce(id,key,value){if(this.failSave)throw Error('synthetic-token-must-not-leak');
      const marker=id+'|'+key;if(checkpoints.has(marker))return false;
      if(!this.lieAboutSave)checkpoints.set(marker,structuredClone(value));return true;},
  };
}

test('repairLinks remains explicit boolean opt-in across configure, encrypted restore and safe snapshot',async t=>{
  const base=path.resolve('.cache');mkdirSync(base,{recursive:true});
  const userData=mkdtempSync(path.join(base,'developer-repairlinks-'));
  t.after(()=>rmSync(userData,{recursive:true,force:true}));
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),
    decryptString:value=>Buffer.from(value).reverse().toString()};
  const sources=[],options={userData,safeStorage,readWorkspace:()=>({bindingId:'original',rootPath:userData}),
    readToolDescriptors:async()=>[],createDeployment:async({configurationSource})=>{
      sources.push(JSON.parse(configurationSource.readConfiguration()));
      return {host:{tools:[],competitionToolAvailability:[],competitionToolExports:[],runtimeOptions:{},bind(){},close(){}},
        snapshot:()=>({configured:true}),close(){}};
    }};
  let host=createDeveloperSettingsHost(options);t.after(()=>host.close());
  await host.createDeployment({});
  const config=flag=>({version:1,repository:'synthetic/repository',github:{executable:'synthetic-gh',
    ...(flag===undefined?{}:{repairLinks:flag})},git:{}});
  await host.configure({enabled:false,configuration:config(undefined),token:'synthetic-private-token'});
  assert.equal(host.snapshot().configuration.github.repairLinks,undefined);
  for(const invalid of ['true',1,null,{}])await assert.rejects(host.configure({enabled:false,configuration:config(invalid)}),/字段无效/);
  await assert.rejects(host.configure({enabled:false,configuration:{...config(true),
    github:{...config(true).github,tokenFile:'must-not-read-token-file'}}}),/字段无效/);
  for(const value of [true,false]){
    await host.configure({enabled:false,configuration:config(value)});
    assert.equal(sources.at(-1).github.repairLinks,value);
    assert.equal(host.snapshot().configuration.github.repairLinks,value);
    assert.equal(JSON.stringify(host.snapshot()).includes('synthetic-private-token'),false);
    host.close();host=createDeveloperSettingsHost(options);
    assert.equal(host.snapshot().configuration.github.repairLinks,value);
    await host.createDeployment({});
  }
  assert.equal(readFileSync(path.join(userData,'developer-settings.json'),'utf8').includes('synthetic-private-token'),false);
  const target=path.join(userData,'developer-settings.json'),envelope=JSON.parse(readFileSync(target,'utf8'));
  const saved=JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted,'base64')));
  for(const invalid of ['true',1,null,{}]){
    saved.configuration.github.repairLinks=invalid;host.close();
    writeFileSync(target,JSON.stringify({version:1,encrypted:safeStorage.encryptString(JSON.stringify(saved)).toString('base64')}));
    host=createDeveloperSettingsHost(options);assert.equal(host.snapshot().state,'restore_failed');
    assert.equal(host.snapshot().configuration,undefined);
  }
  saved.configuration.github.repairLinks=false;saved.configuration.github.tokenFile='must-not-read-token-file';host.close();
  writeFileSync(target,JSON.stringify({version:1,encrypted:safeStorage.encryptString(JSON.stringify(saved)).toString('base64')}));
  host=createDeveloperSettingsHost(options);assert.equal(host.snapshot().state,'restore_failed');
});

test('encrypted product settings switch original deployments behind fixed tools and revoke old task bindings',async t=>{
  const base=path.resolve('.cache');mkdirSync(base,{recursive:true});
  const userData=mkdtempSync(path.join(base,'developer-settings-fixture-'));
  t.after(()=>{assert.equal(path.dirname(userData),base);rmSync(userData,{recursive:true,force:true});});
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),
    decryptString:value=>Buffer.from(value).reverse().toString()};
  const descriptor={name:'fixture.write',version:'1.0.0',sideEffect:'external_write',inputSchema:{type:'object'},outputSchema:{type:'object'},requiredScopes:['fixture:write']};
  const sources=[],created=[];let finish,execution;
  const readWorkspace=()=>({bindingId:'original-workspace',rootPath:userData});
  const settings=createDeveloperSettingsHost({userData,safeStorage,readWorkspace,
    readToolDescriptors:async()=>[descriptor],createDeployment:async options=>{
      const source=options.configurationSource;sources.push(source);const configuration=JSON.parse(source.readConfiguration());
      assert.equal(options.configPath,undefined);assert.equal('tokenFile' in configuration.github,false);
      const id=configuration.repository;created.push(id);
      const deployment={host:{tools:[{descriptor,async execute(){
        if(execution)return new Promise(resolve=>{finish=()=>resolve({repository:id});});return {repository:id};
      }}],competitionToolAvailability:[{toolName:descriptor.name,toolVersion:'1.0.0',available:async()=>source.current()}],
      competitionToolExports:[],runtimeOptions:{developerWorkflows:{bindingId:id}},bind(){},close(){}},
      prepareExport:async()=>{},snapshot:()=>({configured:true,state:'configured'}),close(){}};
      return deployment;
    }});
  t.after(()=>settings.close());
  const proxy=await settings.createDeployment({cacheRootPath:userData,configPath:'NEVER_READ_LEGACY_CREDENTIAL_FILE'});
  const runtime=runtimeFixture();proxy.host.bind({runtime});
  const tool=proxy.host.tools[0],scope=id=>({taskId:runtime.add(id),signal:new AbortController().signal,deadline:new Date(Date.now()+60_000).toISOString()});
  await assert.rejects(tool.execute({},scope('unconfigured')),{code:'UNSUPPORTED_CAPABILITY'});
  const configuration=repository=>({version:1,repository,github:{executable:'Synthetic-gh.exe'},git:{}});
  await assert.rejects(settings.configure({enabled:true,configuration:{...configuration('fixture/first'),
    git:{authorName:'prefix-synthetic-"token-suffix'}},token:'synthetic-"token'}),/包含凭据/u);
  await settings.configure({enabled:true,configuration:configuration('fixture/first'),token:'synthetic-token-only'});
  assert.equal(sources[0].current(),true);assert.equal(settings.snapshot().available,true);
  assert.equal(JSON.stringify(settings.snapshot()).includes('synthetic-token-only'),false);
  assert.equal(readFileSync(path.join(userData,'developer-settings.json'),'utf8').includes('synthetic-token-only'),false);
  const first=scope('task-before-change');assert.deepEqual(await tool.execute({},first),{repository:'fixture/first'});
  await settings.configure({enabled:true,configuration:configuration('fixture/second')});
  assert.equal(proxy.host.tools[0],tool);assert.equal(sources[0].current(),false);
  await assert.rejects(tool.execute({},first),{code:'UNSUPPORTED_CAPABILITY'});
  assert.deepEqual(await tool.execute({},scope('new-task')),{repository:'fixture/second'});
  execution=true;const writing=tool.execute({},scope('write-before-disable'));
  await settings.setEnabled({enabled:false});finish();
  await assert.rejects(writing,{code:'RESULT_UNKNOWN'});
  assert.equal(settings.snapshot().available,false);assert.deepEqual(created,['fixture/first','fixture/second']);
});

async function persistentFixture(t){
  const base=path.resolve('.cache');mkdirSync(base,{recursive:true});
  const userData=mkdtempSync(path.join(base,'developer-settings-restart-')),runtime=runtimeFixture();
  const hosts=[],preflight={};let executions=0,preparations=0;
  t.after(()=>{hosts.forEach(host=>host.close());rmSync(userData,{recursive:true,force:true});});
  const descriptor={name:'fixture.read',version:'1.0.0',sideEffect:'read'};
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),
    decryptString:value=>Buffer.from(value).reverse().toString()};
  async function open(){
    const host=createDeveloperSettingsHost({userData,safeStorage,readWorkspace:()=>({bindingId:'workspace',rootPath:userData}),
      readToolDescriptors:async()=>[descriptor],createDeployment:async({configurationSource:source})=>({
        host:{tools:[{descriptor,async execute(){executions++;return {observed:true};}}],
          competitionToolAvailability:[{toolName:descriptor.name,toolVersion:descriptor.version,available:async()=>source.current()}],
          competitionToolExports:[],runtimeOptions:{developerWorkflows:{bindingId:JSON.parse(source.readConfiguration()).repository}},bind(){}},
        prepareExport:async scope=>{preparations++;await preflight.prepare?.(scope);},snapshot:()=>({configured:true}),close(){}})});
    hosts.push(host);const proxy=await host.createDeployment({cacheRootPath:userData});proxy.host.bind({runtime});return {host,proxy};
  }
  const configure=(host,repository='fixture/one')=>host.configure({enabled:true,
    configuration:{version:1,repository,github:{executable:'synthetic-gh'},git:{}},token:'synthetic-token-only'});
  const scope=id=>({taskId:id,signal:new AbortController().signal,deadline:new Date(Date.now()+60000).toISOString()});
  return {runtime,open,configure,scope,userData,preflight,executions:()=>executions,preparations:()=>preparations};
}

test('export preflight ignores tools outside the stable developer catalog without binding their tasks',async t=>{
  const f=await persistentFixture(t),{host,proxy}=await f.open();
  const scope={...f.scope(f.runtime.add('ordinary-chat')),proposal:{toolName:'subagent.dispatch',toolVersion:'1.0.0'}};
  for(const phase of ['preflight','projection'])await proxy.prepareExport({...scope,phase});
  assert.equal(f.runtime.checkpoints.size,0);
  await f.configure(host);
  for(const phase of ['preflight','projection'])await proxy.prepareExport({...scope,phase});
  assert.equal(f.runtime.checkpoints.size,0);
  await host.setEnabled({enabled:false});
  for(const phase of ['preflight','projection'])await proxy.prepareExport({...scope,phase});
  host.close();for(const phase of ['preflight','projection'])await proxy.prepareExport({...scope,phase});
  assert.equal(f.runtime.checkpoints.size,0);assert.equal(f.preparations(),0);
});

test('developer export preflight retains configuration and original revision gates by tool name',async t=>{
  const f=await persistentFixture(t),{host,proxy}=await f.open();
  const scope={...f.scope(f.runtime.add('developer-export')),proposal:{toolName:'fixture.read',toolVersion:'1.0.0'}};
  await assert.rejects(proxy.prepareExport(scope),{code:'UNSUPPORTED_CAPABILITY'});
  await assert.rejects(proxy.prepareExport({...scope,proposal:{...scope.proposal,toolVersion:'unsupported'}}),{code:'UNSUPPORTED_CAPABILITY'});
  await f.configure(host);await proxy.prepareExport(scope);
  assert.equal(f.preparations(),1);assert.equal(f.runtime.checkpoints.size,1);
  await f.configure(host,'fixture/replacement');
  await assert.rejects(proxy.prepareExport(scope),{code:'UNSUPPORTED_CAPABILITY'});
  await host.setEnabled({enabled:false});
  await assert.rejects(proxy.prepareExport(scope),{code:'UNSUPPORTED_CAPABILITY'});
  host.close();await assert.rejects(proxy.prepareExport(scope),{code:'UNSUPPORTED_CAPABILITY'});
  assert.equal(f.preparations(),1);
});

test('developer export preflight propagates original denial and rechecks revocation after consent',async t=>{
  const f=await persistentFixture(t),{host,proxy}=await f.open();await f.configure(host);
  const scope={...f.scope(f.runtime.add('export-consent')),proposal:{toolName:'fixture.read',toolVersion:'1.0.0'}};
  const denial=Object.assign(Error('synthetic export denied'),{code:'UNAUTHORIZED'});
  f.preflight.prepare=async()=>{throw denial;};
  await assert.rejects(proxy.prepareExport(scope),error=>error===denial);
  f.preflight.prepare=async()=>{await host.setEnabled({enabled:false});};
  await assert.rejects(proxy.prepareExport(scope),{code:'REVISION_CONFLICT'});
  assert.equal(f.preparations(),2);
});

test('failed encrypted restore still ignores unrelated exports and denies developer exports',async t=>{
  const f=await persistentFixture(t);writeFileSync(path.join(f.userData,'developer-settings.json'),'invalid encrypted settings');
  const {host,proxy}=await f.open();assert.equal(host.snapshot().state,'restore_failed');
  const scope=f.scope(f.runtime.add('restore-failure'));
  await proxy.prepareExport({...scope,proposal:{toolName:'subagent.dispatch',toolVersion:'1.0.0'}});
  await assert.rejects(proxy.prepareExport({...scope,proposal:{toolName:'fixture.read',toolVersion:'unsupported'}}),{code:'UNSUPPORTED_CAPABILITY'});
  assert.equal(f.runtime.checkpoints.size,0);assert.equal(f.preparations(),0);
});

test('original Runtime revision binding survives same-settings restart and rejects replacement settings after restart',async t=>{
  const f=await persistentFixture(t);let current=await f.open();await f.configure(current.host);
  const scope=f.scope(f.runtime.add('original-task'));
  await current.proxy.host.tools[0].execute({},scope);current.host.close();
  current=await f.open();await current.proxy.host.tools[0].execute({},scope);
  await f.configure(current.host,'fixture/two');current.host.close();current=await f.open();
  assert.equal(await current.proxy.host.competitionToolAvailability[0].available(scope),false);
  assert.equal(current.host.readDeveloperWorkflows(scope),undefined);
  await assert.rejects(current.proxy.host.tools[0].execute({},scope),{code:'UNSUPPORTED_CAPABILITY'});
  assert.equal(f.executions(),2);
  await current.proxy.host.tools[0].execute({},f.scope(f.runtime.add('new-task')));assert.equal(f.executions(),3);
});

test('legacy tasks without a marker fail closed while preview and newly created tasks remain usable',async t=>{
  const f=await persistentFixture(t),legacy=f.scope(f.runtime.add('legacy-task'));
  const {host,proxy}=await f.open();await f.configure(host);
  assert.ok(host.readDeveloperWorkflows(),'host-only configuration preview remains available');
  assert.equal(await proxy.host.competitionToolAvailability[0].available(legacy),false);
  await assert.rejects(proxy.host.tools[0].execute({},legacy),{code:'UNSUPPORTED_CAPABILITY'});
  await proxy.host.tools[0].execute({},f.scope(f.runtime.add('fresh-task')));assert.equal(f.executions(),1);
});

for(const failure of ['failSave','lieAboutSave'])test(`checkpoint ${failure} prevents execution and exposes no storage error`,async t=>{
  const f=await persistentFixture(t),{host,proxy}=await f.open();await f.configure(host);f.runtime[failure]=true;
  await assert.rejects(proxy.host.tools[0].execute({},f.scope(f.runtime.add('uncommitted'))),error=>
    error.code==='UNSUPPORTED_CAPABILITY'&&!error.message.includes('synthetic-token'));
  assert.equal(f.executions(),0);assert.equal(f.runtime.checkpoints.size,0);
});

test('bounded startup scan exhaustion denies instead of treating an unknown old task as new',async t=>{
  const f=await persistentFixture(t);for(let index=0;index<1001;index++)f.runtime.add('legacy-'+index);
  const {host,proxy}=await f.open();await f.configure(host);
  await assert.rejects(proxy.host.tools[0].execute({},f.scope(f.runtime.add('new-after-large-history'))),{code:'UNSUPPORTED_CAPABILITY'});
  assert.equal(f.executions(),0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {createDeveloperSettingsHost} from '../electron/developer-settings-host.js';

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
  const tool=proxy.host.tools[0],scope=id=>({taskId:id,signal:new AbortController().signal,deadline:new Date(Date.now()+60_000).toISOString()});
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

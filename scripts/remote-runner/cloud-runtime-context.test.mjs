import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createCloudRuntimeContext} from './cloud-runtime-context.mjs';

test('cloud context consumes original public stores and exact authorized filesystem queries',async()=>{
  mkdirSync('.cache',{recursive:true});const directory=resolve(mkdtempSync(join('.cache','cloud-context-'))),root=join(directory,'public-vault');
  mkdirSync(root);writeFileSync(join(root,'weather.md'),'Public weather observation\n');
  const app=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts'});
  let current=true,time=Date.now();const owner={runtimeId:'cloud-context-fixture'};
  const check=()=>{if(!current)throw Object.assign(Error('fixture owner changed'),{code:'REVISION_CONFLICT'});};
  const knowledge={vaultId:'public-cloud-fixture',rootPath:root,publicQueries:['weather'],authorizationRef:'fixture:explicit-public',
    expiresAt:new Date(time+60_000).toISOString()};
  const host=await createCloudRuntimeContext({application:app,dataDirectory:directory,owner,knowledge,assertCurrent:check,now:()=>time});
  const context={deadline:new Date(time+30_000).toISOString(),signal:new AbortController().signal};
  try {
    assert.deepEqual(host.context.goals.read(),app.runtime.provisionCoordinationStore(owner.runtimeId).read());
    assert.deepEqual((await host.context.publicMemory.listCurrent({...context,at:new Date(time).toISOString(),limit:10})).facts,[]);
    const result=await host.context.publicKnowledge.search({...context,query:'weather',limit:5});
    assert.equal(result.hits.length,1);assert.equal(result.hits[0].source.path,'weather.md');
    await assert.rejects(host.context.publicKnowledge.search({...context,query:'private',limit:5}),{code:'SCOPE_DENIED'});
    time+=60_001;await assert.rejects(host.context.publicKnowledge.search({...context,query:'weather',limit:5}),{code:'SCOPE_DENIED'});
    current=false;assert.throws(()=>host.context.goals.read(),{code:'REVISION_CONFLICT'});
    await assert.rejects(host.context.publicMemory.listCurrent({...context,at:new Date(time).toISOString(),limit:10}),{code:'REVISION_CONFLICT'});
  }finally{host.close();app.close();}
});

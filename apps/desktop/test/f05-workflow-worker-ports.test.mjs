import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createTrustedKnowledgeTools} from '../../runtime/dist/application/knowledge-tools.js';
import {createF05WorkflowWorkerPorts} from '../../runtime/dist/application/workflow-f05-worker.js';
import {createDesktopF05WorkflowWorkerPorts} from '../electron/f05-workflow-worker-ports.js';
import {createKnowledgeSourceConfig} from '../electron/knowledge-source-config.js';

// Real configured local source/SQLite; encryption and native user confirmation are explicit test substitutes.
test('Desktop F05 uses the original configured public source and fixed public Fact reader',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'pa-f05-desktop-')),vault=join(directory,'vault');await mkdir(vault);
  await writeFile(join(vault,'note.md'),'Synthetic original public line.\n');
  const source=await createKnowledgeSourceConfig({userData:join(directory,'host'),namespace:'synthetic-source',hostIdentity:randomUUID(),
    safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from('synthetic:'+value),decryptString:value=>value.toString().slice(10)},
    selectDirectory:async()=>vault,selectNoteFiles:async()=>[],confirmPermissions:async()=>true});
  const app=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts'});
  const facts=app.createCompetitionFactHost({memoryPath:join(directory,'memory.sqlite'),memoryNamespace:'synthetic-public',graphNamespace:'synthetic-graph',consumerKey:'synthetic-f05'});
  const knowledgeTools=createTrustedKnowledgeTools(source);knowledgeTools.bindApplication(app);
  let provider={memoryNamespace:'synthetic-public',facts},ports;
  try{
    await source.select();
    const bundle=createDesktopF05WorkflowWorkerPorts({getApplication:()=>app,getKnowledgeSourceConfig:()=>source,getPublicFactHost:()=>provider,
      authorizeExport:async()=>true,knowledgeToolExports:knowledgeTools.competitionToolExports,prepareCompetitionToolExport:async()=>{},
      runtimeModule:{createF05WorkflowWorkerPorts(options){ports=options;return createF05WorkflowWorkerPorts(options);}}});
    assert.equal(bundle.configuredWorkflowWorkerPorts[0].workflowId,'F05');assert.equal(ports.sourceConfiguration(),undefined,'private source is unavailable');
    const initial=source.snapshot();await source.configure({sourceId:initial.sourceId,configRevision:initial.configRevision,enabled:true,dataLevel:'public',
      writeAllowed:false,cloudExportAllowed:true,publicQueries:['synthetic']});
    const configuration=ports.sourceConfiguration(),scope={taskId:'synthetic-ports',deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal};
    const lease=source.acquire(configuration,scope.signal);let hit;
    try{hit=(await lease.read.search({query:'synthetic',limit:1,...scope})).hits[0];}finally{lease.release();}
    assert.equal(await ports.readCitation({source:hit.source,configuration},scope),hit.excerpt);
    assert.equal(ports.assertCitationCurrent({source:hit.source,configuration},scope),undefined);
    facts.recordPublicSource({vaultId:hit.source.vaultId,path:hit.source.path,factId:'original-fact',sourceRevision:hit.source.revision,line:hit.source.line,
      summary:'Versioned Fact summary.',observedAt:new Date().toISOString(),validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z',expectedFactRevision:null},scope);
    const page=await ports.memory.listCurrent({factId:'original-fact',limit:1,at:new Date().toISOString(),deadline:scope.deadline,signal:scope.signal});
    assert.deepEqual(ports.readCurrentFact(page.facts[0].ref),page.facts[0]);
    await assert.rejects(ports.readCitation({source:{...hit.source,vaultId:'foreign'},configuration},scope),{code:'UNSUPPORTED_CAPABILITY'});
    await writeFile(join(vault,'note.md'),'Later source version.\n');
    await assert.rejects(ports.readCitation({source:hit.source,configuration},scope),{code:'SOURCE_CHANGED'});
    assert.throws(()=>ports.assertCitationCurrent({source:hit.source,configuration},scope),{code:'SOURCE_CHANGED'});
    provider={memoryNamespace:'different-public',facts};
    await assert.rejects(ports.readCitation({source:hit.source,configuration},scope),{code:'UNSUPPORTED_CAPABILITY'});
    await source.revoke();assert.equal(ports.sourceConfiguration(),undefined);
  }finally{source.close();facts.close();app.close();await rm(directory,{recursive:true,force:true});}
});
test('Desktop F05 does not register an incomplete factory',()=>{
  const result=createDesktopF05WorkflowWorkerPorts({});assert.deepEqual(result.tools,[]);assert.deepEqual(result.configuredWorkflowWorkerPorts,[]);
});

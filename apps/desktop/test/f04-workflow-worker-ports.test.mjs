import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createTrustedKnowledgeTools} from '../../runtime/dist/application/knowledge-tools.js';
import {createF04WorkflowWorkerPorts} from '../../runtime/dist/application/workflow-f04-worker.js';
import {createDesktopF04WorkflowWorkerPorts} from '../electron/f04-workflow-worker-ports.js';
import {createKnowledgeSourceConfig} from '../electron/knowledge-source-config.js';

// Actual source configuration and files. Native selection and safe storage are Synthetic.
test('Desktop F04 uses only the selected original public note scope and current source revision',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'pa-f04-desktop-')),vault=join(directory,'vault');await mkdir(vault);
  const note=join(vault,'note.md');await writeFile(note,'Synthetic original public line.\n');
  const source=await createKnowledgeSourceConfig({userData:join(directory,'host'),namespace:'synthetic-source',hostIdentity:randomUUID(),
    safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from('synthetic:'+value),decryptString:value=>value.toString().slice(10)},
    selectDirectory:async()=>vault,selectNoteFiles:async()=>[note],confirmPermissions:async()=>true});
  const app=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts'});
  const facts=app.createCompetitionFactHost({memoryPath:join(directory,'memory.sqlite'),memoryNamespace:'synthetic-public',graphNamespace:'synthetic-graph',consumerKey:'synthetic-f04'});
  const knowledge=createTrustedKnowledgeTools(source);knowledge.bindApplication(app);let provider={memoryNamespace:'synthetic-public',facts},ports;
  try{
    await source.select();
    const bundle=createDesktopF04WorkflowWorkerPorts({getApplication:()=>app,getKnowledgeSourceConfig:()=>source,getPublicFactHost:()=>provider,
      authorizeExport:async()=>true,knowledgeToolExports:knowledge.competitionToolExports,prepareCompetitionToolExport:async()=>{},
      runtimeModule:{createF04WorkflowWorkerPorts(options){ports=options;return createF04WorkflowWorkerPorts(options);}}});
    assert.equal(bundle.configuredWorkflowWorkerPorts[0].workflowId,'F04');assert.equal(ports.sourceConfiguration(),undefined);
    await source.selectNotes(source.snapshot());const selected=source.snapshot();
    await source.configure({sourceId:selected.sourceId,configRevision:selected.configRevision,enabled:true,dataLevel:'public',
      writeAllowed:false,cloudExportAllowed:true,publicQueries:['synthetic']});
    const configuration=ports.sourceConfiguration();assert.deepEqual(configuration.allowedNotePaths,['note.md']);assert.equal(configuration.writeAvailable,false);
    const scope={taskId:'synthetic-f04',deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal},lease=source.acquire(configuration,scope.signal);
    let hit;try{hit=(await lease.read.search({query:'synthetic',limit:1,deadline:scope.deadline,signal:scope.signal})).hits[0];}finally{lease.release();}
    assert.equal(await ports.readCitation({source:hit.source,configuration},scope),hit.excerpt);ports.assertCitationCurrent({source:hit.source,configuration},scope);
    ports.clearIndex(configuration,scope);assert.equal(await ports.readCitation({source:hit.source,configuration},scope),hit.excerpt);
    await writeFile(note,'Later source version.\n');assert.throws(()=>ports.assertCitationCurrent({source:hit.source,configuration},scope),{code:'SOURCE_CHANGED'});
    provider={memoryNamespace:'other-public',facts};await assert.rejects(ports.readCitation({source:hit.source,configuration},scope),{code:'UNSUPPORTED_CAPABILITY'});
    await source.revoke();assert.equal(ports.sourceConfiguration(),undefined);
  }finally{source.close();facts.close();app.close();await rm(directory,{recursive:true,force:true});}
});
test('Desktop F04 does not register missing original source or policy ports',()=>{
  assert.deepEqual(createDesktopF04WorkflowWorkerPorts({}).configuredWorkflowWorkerPorts,[]);
  assert.deepEqual(createF04WorkflowWorkerPorts({}).configuredWorkflowWorkerPorts,[]);
});

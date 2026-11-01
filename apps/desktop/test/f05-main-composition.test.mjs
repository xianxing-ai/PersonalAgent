import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createDesktopF05WorkflowWorkerPorts} from '../electron/f05-workflow-worker-ports.js';

const source=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
test('actual Main F05 reads the current original public Fact host and original knowledge export',async()=>{
  const begin=source.indexOf('const f05Workflow='),end=source.indexOf('const f13Workflow=',begin);
  assert.ok(begin>=0&&end>begin);let queries=0,prepares=0;
  const configuration={configured:true,available:true,enabled:true,dataLevel:'public',cloudExportAllowed:true,
    sourceId:'public-vault',configRevision:1,publicQueries:['public query']};
  const policy={toolName:'knowledge.search',toolVersion:'1.0.0',exportPolicyVersion:'original-public'};
  const context={syntheticMvp:false,agentArtsPinned:true,namespace:'original-user',runtimeApplication:{},proactiveHost:undefined,
    knowledgeTools:{competitionToolExports:[policy]},knowledgeSourceConfig:{snapshot:()=>configuration,
      acquire:()=>({assertCurrent(){},release(){},read:{readCitation(){},assertCitationCurrent(){}}})},
    createDesktopF05WorkflowWorkerPorts,runtimeModule:{createF05WorkflowWorkerPorts:options=>options},
    prepareWorkflowToolExport:scope=>{prepares++;assert.equal(scope.taskId,'original-child');},authorizeWorkflowExport:async()=>true};
  const ports=runInNewContext(source.slice(begin,end)+'\nf05Workflow;',context);
  assert.equal(ports.sourceConfiguration(),undefined,'construction does not invent an uninitialized Fact source');
  const request={factId:'original-fact'},page={snapshot:'original-revision',facts:[]};
  context.proactiveHost={publicMemory:{listCurrent:async value=>{queries++;assert.equal(value,request);return page;}},
    readCurrentPublicFact:ref=>({ref,source:'original'})};
  assert.equal(ports.sourceConfiguration().memoryNamespace,'original-user:proactive-public');
  assert.equal(await ports.memory.listCurrent(request),page);assert.equal(queries,1);
  assert.equal(ports.knowledgeToolExport,policy);
  await ports.prepareCompetitionToolExport({taskId:'original-child'});assert.equal(prepares,1);
  const ref={id:'original-fact',revision:1};assert.deepEqual(ports.readCurrentFact(ref),{ref,source:'original'});
  configuration.dataLevel='private';assert.equal(ports.sourceConfiguration(),undefined);
  await assert.rejects(ports.memory.listCurrent(request),/unavailable/);assert.equal(queries,1);
});
test('actual Main gives F05 and business hosts precedence over duplicate optional generic hosts',()=>{
  const begin=source.indexOf('const configuredHostNames='),end=source.indexOf('let conversationTools=',begin);
  assert.ok(begin>=0&&end>begin);
  const tool=name=>({descriptor:{name}}),f05=['f05_n02','f05_n05','f05_n06','f05_n07'].map(id=>tool('workflow.host.'+id));
  f05.push(tool('workflow.guard.f05_n04'),tool('workflow.guard.f05_n06'));
  const business=tool('workflow.host.f08_n09'),other=tool('workflow.host.unrelated');
  const result=runInNewContext(source.slice(begin,end)+'\ngenericWorkflowTools;',{
    f01Workflow:undefined,f04Workflow:undefined,f05Workflow:{tools:f05},businessWorkflow:{tools:[business]},workflowGraphComposition:{tools:[...f05,business,other]}});
  assert.deepEqual([...result],[other]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runInNewContext} from 'node:vm';
import {createDesktopF04WorkflowWorkerPorts} from '../electron/f04-workflow-worker-ports.js';
import {createDesktopProactiveHost} from '../electron/proactive-host.js';

const main=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
test('actual F04 Main and Proactive host preserve the original Fact port, namespace and write context',()=>{
  const directory=mkdtempSync(join(tmpdir(),'pa-f04-main-')),calls=[];
  const methods=['readCurrentPublicFact','readPublicSourceHead','recordPublicSource','drain','processImpacts','listImpactReceipts','readCompletedImpact'];
  const facts={publicMemory:{listCurrent:async()=>[],listHistory:async()=>[]},close(){},
    ...Object.fromEntries(methods.map(name=>[name,(...args)=>{calls.push({name,args});return {original:name};}]))};
  const application={profile:'huawei_ict_agentarts',createCompetitionFactHost(options){
    assert.equal(options.memoryNamespace,'original:proactive-public');return facts;}};
  const host=createDesktopProactiveHost({application,userData:directory,namespace:'original'});
  try{
    const config={configured:true,available:true,enabled:true,dataLevel:'public',cloudExportAllowed:true,
      sourceId:'vault',configRevision:1,publicQueries:['public'],allowedNotePaths:['note.md'],writeAvailable:true};
    const originalPolicies=[{toolName:'knowledge.search'},{toolName:'knowledge.apply_note_patch'}];
    const context={f04Workflow:undefined,syntheticMvp:false,agentArtsPinned:true,namespace:'original',runtimeApplication:application,
      proactiveHost:host,knowledgeTools:{competitionToolExports:originalPolicies},
      knowledgeSourceConfig:{snapshot:()=>config,acquire:()=>({assertCurrent(){},release(){},read:{readCitation(){},assertCitationCurrent(){}}})},
      createDesktopF04WorkflowWorkerPorts,runtimeModule:{createF04WorkflowWorkerPorts:options=>options},
      authorizeWorkflowExport:async()=>true,prepareWorkflowToolExport(){}};
    const start=main.indexOf('f04Workflow=!syntheticMvp'),end=main.indexOf('const f05Workflow=',start);
    assert.ok(start>=0&&end>start);const ports=runInNewContext(main.slice(start,end)+'\nf04Workflow;',context);
    assert.equal(ports.sourceConfiguration().memoryNamespace,'original:proactive-public');
    assert.equal(ports.knowledgeToolExports,originalPolicies);
    const source={factId:'original'},scope={taskId:'original-host',signal:new AbortController().signal,deadline:'2099-01-01T00:00:00.000Z'};
    ports.facts.recordPublicSource(source,scope);assert.equal(calls[0].args[0],source);assert.equal(calls[0].args[1],scope);
    for(const method of methods.filter(name=>name!=='recordPublicSource'))assert.deepEqual(ports.facts[method](source),{original:method});
    config.dataLevel='private';assert.equal(ports.sourceConfiguration(),undefined);
    assert.throws(()=>ports.facts.recordPublicSource(source,scope),{code:'UNSUPPORTED_CAPABILITY'});
    assert.equal(calls.length,methods.length);
  }finally{host.close();rmSync(directory,{recursive:true,force:true});}
});

test('actual Main notification host resolves the current Live session lazily',()=>{
  const start=main.indexOf('notificationApplicationHost = createDesktopNotificationApplicationHost('),end=main.indexOf('});',start)+3;
  assert.ok(start>=0&&end>start);
  const context={notificationApplicationHost:undefined,namespace:'original',channel:{},authorizationQuestionPort:{},publish(){},liveVoice:undefined,
    createDesktopNotificationApplicationHost:options=>options};
  const options=runInNewContext(main.slice(start,end)+'\nnotificationApplicationHost;',context);
  assert.equal(options.getVoiceHost(),undefined);context.liveVoice={session:'original'};assert.equal(options.getVoiceHost(),context.liveVoice);
});

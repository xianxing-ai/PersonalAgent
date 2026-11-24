import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';

const main=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const start=main.indexOf('prepareCompetitionToolExport:prepareWorkflowToolExport=async ');
const end=main.indexOf('},\n        ...(codingWorkspace.patchReconciliation',start);
const callback=main.slice(start+'prepareCompetitionToolExport:prepareWorkflowToolExport='.length,end+1);

test('actual Main requests fresh F04 recovery export consent and retains ordinary knowledge requirements',async()=>{
  assert.ok(start>=0&&end>start);
  for(const phase of ['preflight','projection'])for(const recovery of [false,true,'denied']){
    const calls=[],scope={phase,taskId:'original-child',runId:'original-run',deadline:'2099-01-01T00:00:00.000Z',
      signal:new AbortController().signal,proposal:{toolName:'knowledge.apply_note_patch',arguments:{},proposalId:'original'}};
    const binding={available:true,sourceId:'public-source',configRevision:4,dataLevel:'public',cloudExportAllowed:true};
    const context={createHash,remoteMcpCompetition:{prepare:async()=>{}},runtimeApplication:{},prepareConfiguredWorkflowDecisionQuestion:()=>false,
      computerControlConfig:undefined,windowsControlHost:undefined,computerVisionHost:undefined,todoHost:undefined,feedsHost:undefined,
      developerDeployment:undefined,connectorConversationTools:undefined,authorizationQuestionHost:undefined,codingWorkspace:undefined,goalCloudHost:undefined,
      knowledgeSourceConfig:{snapshot:()=>binding},authorizationQuestionPort:{prepareExport:()=>calls.push('original-preflight'),currentRequirement:()=>calls.push('original-requirement')},
      f04RecoveryExport:{prepare:async value=>{assert.equal(value.signal,scope.signal);assert.equal(value.proposal,scope.proposal);calls.push('fresh-recovery');
        if(recovery==='denied')throw Error('fresh consent denied');return recovery;}}};
    const run=runInNewContext('('+callback+')',context);
    if(phase==='projection'&&recovery==='denied')await assert.rejects(run(scope),/fresh consent denied/);else await run(scope);
    assert.deepEqual(calls,phase==='preflight'?['original-preflight']:['fresh-recovery',...(recovery===false?['original-requirement']:[])]);
  }
});

test('actual Main recovery export and normal workflow export share the same current fixed deployment binding',()=>{
  const first=main.indexOf('const readWorkflowDeploymentBinding='),last=main.indexOf('f02Workflow=',first),factories=[];
  const selected={runtimeReady:true,deploymentSelection:'pinned',deploymentVersion:'version-1'};
  const context={createHash,runtimeApplication:{},confirmApplicationAuthorization(){},agentArtsConfig:{snapshot:()=>selected,binding:()=>({runtime:'original'}),readTransportPreferences:()=>({transport:'https'})},
    createWorkflowExportConsent:options=>{factories.push(options);return ()=>{};},createF04RecoveryExportConsent:options=>{factories.push(options);return {};}};
  assert.ok(first>=0&&last>first);runInNewContext(main.slice(first,last),context);
  assert.equal(factories.length,2);assert.equal(factories[0].readDeploymentBinding,factories[1].readDeploymentBinding);
  const original=factories[0].readDeploymentBinding();selected.deploymentVersion='version-2';assert.notEqual(factories[1].readDeploymentBinding(),original);
  selected.deploymentSelection='latest';assert.equal(factories[1].readDeploymentBinding(),undefined);
});

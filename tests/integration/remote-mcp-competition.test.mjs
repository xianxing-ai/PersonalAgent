import assert from 'node:assert/strict';
import test from 'node:test';
import {Client} from '@personal-agent/client';
import {AuthorizationQuestions,createRuntimeApplication} from '@personal-agent/runtime/application';
import {createBoundRemoteReadonlyMcpHost,remoteMcpDirectoryDigest} from '@personal-agent/mcp';
import {fixture,descriptor,directory,endpoint} from '../../packages/mcp/test/remote-http-fixture.mjs';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRemoteMcpConfig} from '../../apps/desktop/electron/remote-mcp-config.js';
import {createDesktopRemoteMcpHost} from '../../apps/desktop/electron/remote-mcp-host.js';
import {createRemoteMcpCompetition,createRemoteMcpCompetitionComposition} from '../../apps/desktop/electron/remote-mcp-competition.js';
import {createRemoteMcpRegistry} from '../../apps/desktop/electron/remote-mcp-registry.js';
import {createDesktopRemoteMcpServices} from '../../apps/desktop/electron/remote-mcp-services.js';
import {createDesktopAuthorizationQuestionHost} from '../../apps/desktop/electron/authorization-question-host.js';

async function until(app,id,states){
  for(let i=0;i<1000;i++){const task=app.runtime.getTask(id);if(states.includes(task.state))return task;await new Promise(r=>setTimeout(r,10));}
  throw Error('Synthetic task did not reach expected state');
}

for(const scenario of ['approved','denied','cancelled','directory-changed','export-revoked','result-unknown']) test(`synthetic Competition MCP ${scenario} retains original authorization boundary`,async()=>{
  const f=await fixture(),calls=[],revoked=new AbortController();let app;
  const binding={configurationRef:'synthetic-cloud-config',revision:1,directoryDigest:remoteMcpDirectoryDigest(directory())};
  const host=createBoundRemoteReadonlyMcpHost({endpoint,server:{name:'synthetic-reference',version:'1.0.0'},
    tool:{remoteName:'reference',descriptor},binding,readCurrentBinding:()=>binding,revocationSignal:revoked.signal,enabled:true,fetch:f.fetch});
  try{
    await host.start({signal:new AbortController().signal,deadline:new Date(Date.now()+60000).toISOString()});
    const args={bindingRef:host.currentConfigurationRef(),arguments:{key:'public'}};
    const proposal={kind:'tool_proposal',proposalId:'public-reference',toolName:descriptor.name,
      toolVersion:descriptor.version,arguments:args,verification:'unverified'};
    const exportPolicy={toolName:descriptor.name,toolVersion:descriptor.version,exportPolicyVersion:'synthetic-public-v1',
      accepts:input=>input.arguments.bindingRef===args.bindingRef&&input.arguments.arguments?.key==='public'
        &&(input.phase!=='final'||input.projection?.text==='public synthetic reference'),
      project:({taskId,result})=>{
        const records=app.runtime.readToolExecutions(taskId);
        assert.equal(records.length,1);assert.equal(records[0].state,'confirmed');assert.equal(records[0].policyDecision,'allow');
        assert.equal(records[0].toolName,descriptor.name);assert.equal(records[0].toolVersion,descriptor.version);
        assert.equal(app.runtime.matchesToolExecutionInput(records[0],{arguments:args,scopeRef:records[0].evidenceId}),true);
        assert.deepEqual(app.runtime.loadCheckpoint(taskId,'tool-result-'+records[0].evidenceId).result,result);
        if(scenario==='export-revoked')throw new Error('Synthetic export permission revoked');
        assert.equal(result.text,'public synthetic reference');return {text:result.text};
      }};
    app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',tools:host.tools,
      competitionToolExports:[exportPolicy],competitionToolAvailability:[{toolName:descriptor.name,toolVersion:descriptor.version,
        publicEnumPaths:['/bindingRef'],available:()=>host.currentConfigurationRef()===args.bindingRef}],
      coordination:{execute:async request=>{calls.push(structuredClone(request.continuation));return request.continuation
        ?{kind:'text',text:'Synthetic reference returned',verification:'unverified'}:proposal;}}});
    const client=new Client(app,Date.now);await client.connect();
    const {taskId}=await client.call('task.submit',{goal:'Read synthetic public reference',conversationId:'synthetic-mcp-cloud'},
      {idempotencyKey:'synthetic-mcp-cloud'});
    assert.equal((await until(app,taskId,['waiting_approval','failed'])).state,'waiting_approval');
    assert.equal(f.calls().length,0);
    const approval=(await client.call('approval.list',{taskId})).items.find(item=>item.state==='pending');
    if(scenario==='cancelled')await client.call('task.cancel',{taskId,reason:'synthetic cancellation'});
    else {
      if(scenario==='directory-changed')f.mode.schema={type:'object'};
      if(scenario==='result-unknown')f.mode.drop=true;
      await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,
        decision:scenario==='denied'?'deny':'allow_once'});
    }
    const task=await until(app,taskId,['succeeded','failed','cancelled','waiting_reconciliation']);
    if(scenario==='export-revoked'||scenario==='result-unknown'){
      assert.notEqual(task.state,'succeeded');assert.equal(f.calls().length,1);assert.equal(calls.length,1);return;
    }
    if(scenario!=='approved'){
      assert.notEqual(task.state,'succeeded');assert.equal(f.calls().length,0);assert.equal(calls.length,1);return;
    }
    assert.equal(task.state,'succeeded');
    assert.equal(f.calls().length,1);assert.equal(calls.length,2);
    assert.deepEqual(calls[1],{proposalId:proposal.proposalId,state:'confirmed',result:{text:'public synthetic reference'}});
    assert.equal(app.runtime.readToolExecutions(taskId).length,1);
  }finally{if(app){for(let i=0;i<200&&app.activeTaskCount;i++)await new Promise(r=>setTimeout(r,10));app.close();}await host.dispose();await f.close();}
});

for(const decision of ['allow_once','deny'])test(`production Competition export uses the original Desktop authorization card: ${decision}`,async()=>{
  const f=await fixture(),parent=fileURLToPath(new URL('../../.cache/remote-mcp-competition/',import.meta.url));
  mkdirSync(parent,{recursive:true});const userData=mkdtempSync(path.join(parent,'card-'));
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()};
  const registry=createRemoteMcpRegistry({userData,safeStorage});registry.add('reference',{endpoint,server:{name:'synthetic-reference',version:'1.0.0'},
    tool:{remoteName:'reference',descriptor},directoryDigest:remoteMcpDirectoryDigest(directory()),publicExport:{sensitivity:'PUBLIC',arguments:{key:'public'},maxBytes:1024}});
  let app;const continuations=[];
  const services=await createDesktopRemoteMcpServices({registry,fetchFor:()=>f.fetch,confirmConnection:async()=>true,readRuntime:()=>app?.runtime});
  const host=services.get('reference').host;
  const question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>app,
    namespace:'Synthetic',resolveConversation:()=> 'Synthetic conversation',available:()=>true,
    profiles:[{ref:'application',label:'Synthetic policy',mode:'workspace-write',revision:1,available:true}],defaultProfileRef:'application'});
  try{
    await services.connect('reference',{signal:new AbortController().signal,deadline:new Date(Date.now()+60000).toISOString()});
    const args=host.arguments({key:'public'}),competition=createRemoteMcpCompetitionComposition({services,readApplication:()=>app,question});
    app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',tools:services.tools,competitionToolDiscovery:true,
      competitionToolExports:competition.competitionToolExports,competitionToolAvailability:competition.competitionToolAvailability,
      prepareCompetitionToolExport:competition.prepare,requiresToolAuthorization:scope=>competition.ownsTool(scope.toolName),requestToolAuthorization:scope=>question.requestToolAuthorization(scope),
      coordination:{execute:async request=>{
        if(!request.continuation)return {kind:'tool_proposal',proposalId:'discovery',toolName:'capability.search',toolVersion:'1.0.0',arguments:{query:'mcp.remote'},verification:'unverified'};
        if(request.continuation.proposalId==='discovery'){
          assert.ok(request.continuation.result.selectedTools.some(item=>item.name===descriptor.name));
          return {kind:'tool_proposal',proposalId:'card-proposal',toolName:descriptor.name,toolVersion:descriptor.version,arguments:args,verification:'unverified'};
        }
        continuations.push(request.continuation);return {kind:'text',text:'Synthetic completion',verification:'unverified'};
      }}});
    const client=new Client(app,Date.now);await client.connect();
    const {taskId}=await client.call('task.submit',{goal:'Public reference',conversationId:'Synthetic conversation'},{idempotencyKey:'original-card'});
    let card;for(let i=0;i<400&&!card;i++){card=question.snapshot().find(item=>item.state==='pending');if(!card)await new Promise(r=>setTimeout(r,10));}
    assert.ok(card);assert.equal(f.calls().length,0);assert.deepEqual(card.requirements.map(item=>item.kind),['tool','export']);
    question.respond({questionId:card.questionId,expectedRevision:card.revision,decision},card.conversationId);
    const final=await until(app,taskId,['succeeded','failed','waiting_reconciliation','cancelled']);
    if(decision==='deny'){assert.equal(final.state,'cancelled');assert.equal(f.calls().length,0);assert.equal(continuations.length,0);return;}
    assert.equal(final.state,'succeeded',JSON.stringify(final.error));assert.equal(f.calls().length,1);assert.equal(continuations.length,1);
    assert.deepEqual(continuations[0].result,{text:'public synthetic reference'});
    const record=app.runtime.readToolExecutions(taskId).find(item=>item.toolName===descriptor.name);
    assert.match(app.runtime.loadCheckpoint(taskId,`authorization-question-export:${record.evidenceId}:remote-mcp-public-export`).resultDigest,/^[a-f0-9]{64}$/);
  }finally{question.close();if(app){for(let i=0;i<200&&app.activeTaskCount;i++)await new Promise(r=>setTimeout(r,10));app.close();}await services.dispose();await f.close();}
});

for(const scenario of ['approved','no-export','export-revoked','final-revoked','private-result','secret-result','argument-changed','configuration-changed','directory-changed','directory-changed-before-export','result-unknown']) test(`production Desktop Competition export ${scenario}`,async()=>{
  const f=await fixture(),parent=fileURLToPath(new URL('../../.cache/remote-mcp-competition/',import.meta.url));
  mkdirSync(parent,{recursive:true});const userData=mkdtempSync(path.join(parent,'case-'));
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()};
  const config=createRemoteMcpConfig({userData,safeStorage});
  config.configure({endpoint,server:{name:'synthetic-reference',version:'1.0.0'},tool:{remoteName:'reference',descriptor},directoryDigest:remoteMcpDirectoryDigest(directory()),
    publicExport:{sensitivity:'PUBLIC',arguments:{key:'public'},maxBytes:1024}});
  let app;const calls=[];
  const host=createDesktopRemoteMcpHost({config,fetch:f.fetch,confirmConnection:async()=>true,readRuntime:()=>app?.runtime});
  try{
    await host.connect({signal:new AbortController().signal,deadline:new Date(Date.now()+60000).toISOString()});
    const args=host.arguments({key:'public'});
    const proposal={kind:'tool_proposal',proposalId:'production-host-test',toolName:descriptor.name,toolVersion:descriptor.version,
      arguments:scenario==='argument-changed'?host.arguments({key:'other'}):args,verification:'unverified'};
    let prepared=0,authorized=0,checks=0;
    const question={prepareExport:()=>{prepared++;if(scenario==='no-export')throw Error('synthetic denial');},
      authorizeExport:()=>{authorized++;if(scenario==='export-revoked')throw Error('synthetic revocation');if(scenario==='directory-changed-before-export')f.mode.schema={type:'object'};},
      currentRequirement:()=>scenario!=='final-revoked'||++checks===1}; // Synthetic question adapter; real Desktop supplies its original card host.
    const competition=createRemoteMcpCompetition({host,config,readApplication:()=>app,question});
    app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',tools:host.tools,competitionToolExports:competition.competitionToolExports,
      competitionToolAvailability:competition.competitionToolAvailability,prepareCompetitionToolExport:competition.prepare,
      coordination:{execute:async request=>{calls.push(request.continuation);return request.continuation
        ?{kind:'text',text:'Synthetic reference returned',verification:'unverified'}:proposal;}}});
    const client=new Client(app,Date.now);await client.connect();
    const {taskId}=await client.call('task.submit',{goal:'Read synthetic public reference',conversationId:'production-host-test'},{idempotencyKey:'production-host-test'});
    const waiting=await until(app,taskId,['waiting_approval','failed']);
    if(['no-export','argument-changed'].includes(scenario)){assert.equal(waiting.state,'failed');assert.equal(f.calls().length,0);assert.equal(calls.length,1);return;}
    assert.equal(waiting.state,'waiting_approval');assert.equal(f.calls().length,0);
    if(scenario==='directory-changed')f.mode.schema={type:'object'};
    if(scenario==='configuration-changed')config.configure({endpoint,server:{name:'synthetic-reference',version:'1.0.0'},tool:{remoteName:'reference',descriptor},
      directoryDigest:remoteMcpDirectoryDigest(directory()),publicExport:{sensitivity:'PUBLIC',arguments:{key:'public'},maxBytes:1024}});
    if(scenario==='result-unknown')f.mode.drop=true;
    if(scenario==='private-result')f.mode.result={content:[{type:'text',text:'private'}],structuredContent:{text:'C:\\Users\\private\\secret.txt'}};
    if(scenario==='secret-result')f.mode.result={content:[{type:'text',text:'private'}],structuredContent:{text:'api_key=synthetic-secret-value'}};
    const approval=(await client.call('approval.list',{taskId})).items.find(item=>item.state==='pending');
    await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    const final=await until(app,taskId,['succeeded','failed','waiting_reconciliation']);
    if(scenario!=='approved'){
      assert.notEqual(final.state,'succeeded');assert.equal(f.calls().length,['directory-changed','configuration-changed'].includes(scenario)?0:1);
      assert.equal(calls.length,1);return;
    }
    assert.equal(final.state,'succeeded');assert.equal(f.calls().length,1);assert.equal(calls.length,2);
    assert.equal(prepared,1);assert.equal(authorized,1);
  }finally{if(app){for(let i=0;i<200&&app.activeTaskCount;i++)await new Promise(r=>setTimeout(r,10));app.close();}await host.dispose();config.dispose();await f.close();}
});

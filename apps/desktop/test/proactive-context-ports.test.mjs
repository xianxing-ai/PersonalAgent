import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createProactiveHostProofs,ProactiveWorkflowEngine} from '@personal-agent/agentarts';
import {createDesktopProactiveContextPorts} from '../electron/proactive-context-ports.js';

test('Desktop reuses original public Memory/Goal and exact public authorized knowledge lease',async()=>{
  const memory={listCurrent(){}},goals={read(){}};let released=0,reads=0;
  const binding={available:true,dataLevel:'public',cloudExportAllowed:true,sourceId:'public-vault',configRevision:2,publicQueries:['original quote']};
  const source={snapshot:()=>structuredClone(binding),acquire:(_binding,signal)=>({signal,assertCurrent(){},
    read:{search:async request=>{reads++;assert.equal(request.query,'original quote');return {hits:[{source:{revision:'r2'}}],truncated:false};}},release(){released++;}})};
  const ports=createDesktopProactiveContextPorts({readMemory:()=>memory,readGoals:()=>goals,readKnowledgeSource:()=>source,limit:20});
  assert.equal(ports.publicMemory,memory);assert.equal(ports.goals,goals);
  const request={query:'original quote',limit:20,signal:new AbortController().signal,deadline:new Date(Date.now()+60000).toISOString()};
  assert.equal((await ports.publicKnowledge.search(request)).hits[0].source.revision,'r2');assert.equal(released,1);
  await assert.rejects(ports.publicKnowledge.search({...request,query:'unapproved'}),{code:'SCOPE_DENIED'});assert.equal(reads,1);
  binding.configRevision++;await assert.rejects(ports.publicKnowledge.search(request),{code:'SOURCE_CHANGED'});assert.equal(reads,1);
});

test('private or unapproved Knowledge is not injected into proactive cloud context',()=>{
  for(const value of [{dataLevel:'private',cloudExportAllowed:true},{dataLevel:'public',cloudExportAllowed:false}]) {
    const ports=createDesktopProactiveContextPorts({readKnowledgeSource:()=>({snapshot:()=>({available:true,...value})}),limit:20});
    assert.equal(ports.publicKnowledge,undefined);
  }
});

test('an in-flight source withdrawal rejects its late result and releases the original lease',async()=>{
  const binding={available:true,dataLevel:'public',cloudExportAllowed:true,sourceId:'public-vault',configRevision:2,publicQueries:['original quote']};
  let released=0;
  const ports=createDesktopProactiveContextPorts({limit:20,readKnowledgeSource:()=>({snapshot:()=>structuredClone(binding),
    acquire:(_binding,signal)=>({signal,assertCurrent(){},read:{search:async()=>{
      binding.cloudExportAllowed=false;return {hits:[],truncated:false};}},release(){released++;}})})});
  await assert.rejects(ports.publicKnowledge.search({query:'original quote',limit:20,signal:new AbortController().signal,
    deadline:new Date(Date.now()+60000).toISOString()}),{code:'SCOPE_DENIED'});
  assert.equal(released,1);
});

for(const change of ['withdraw','reconfigure','unavailable','network'])test('Runtime current context after Desktop knowledge '+change+' preserves the actual failure boundary',async()=>{
  const root=resolve('.cache','desktop-proactive-context-fixtures');await mkdir(root,{recursive:true});
  const folder=await mkdtemp(join(root,'context-')),deadline=new Date(Date.now()+60000).toISOString();
  const binding={available:true,dataLevel:'public',cloudExportAllowed:true,sourceId:'public-vault',configRevision:2,publicQueries:['original quote']};
  const hit={source:{vaultId:'public-vault',path:'source.md',line:1,revision:'r2'},excerpt:'Public source excerpt'};
  const networkError=Error('Explicit offline network fixture');let readError,reads=0,released=0;
  const ports=createDesktopProactiveContextPorts({limit:20,readKnowledgeSource:()=>({snapshot:()=>structuredClone(binding),
    acquire:(_binding,signal)=>({signal,assertCurrent(){},read:{search:async()=>{
      reads++;if(readError)throw readError;return {hits:[structuredClone(hit)],truncated:false};}},release(){released++;}})})});
  const secret='explicit-offline-desktop-context-proof-key-32',proofs=createProactiveHostProofs(secret);
  const contract={id:'context-fixture',version:'1',qualifiedForMain:false,batchIndependent:true,criteria:'Read only original public context',
    candidates:[{id:'continue',description:'Continue assigned responsibility',action:'continue'},{id:'defer',description:'Keep pending',action:'defer'}]};
  const engine=new ProactiveWorkflowEngine({checkpointSecret:secret,decisionContracts:[contract],
    verifyEvent:async(value,input)=>proofs.verify('event',value,input),
    verifyResponsibility:async(value,input)=>proofs.verify('responsibility',value,input),
    verifyReceipt:async(value,_proposal,input)=>proofs.verify('receipt',value,input),verifyControl:async(value,input)=>proofs.verify('control',value,input)});
  const app=createRuntimeApplication({path:join(folder,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'desktop-context-fixture',
    proactiveWorkflows:true,automaticTools:[{toolName:'proactive.retrieve_context',toolVersion:'1.0.0'}]});
  try{
    const task=app.runtime.submitTask({goal:'Keep this original responsibility pending',conversationId:'context-fixture',idempotencyKey:'parent'});
    const source=app.runtime.submitTask({goal:'original quote',conversationId:'context-fixture',idempotencyKey:'source'});
    const host=app.createProactiveWorkflowHost({taskId:task.taskId,sessionId:'context-session',taskDeadline:deadline,contractRef:contract.id,
      advancePort:async input=>proofs.sign('advance_result',{requestId:input.requestId,...await engine.advance(input)},input),
      verifyAdvance:(result,input)=>proofs.verify('advance_result',result,input),sign:(kind,value,input)=>proofs.sign(kind,value,input),
      localDeviceAvailable:()=>true,context:ports});
    const context={deadline,signal:new AbortController().signal};host.ingestUserInstruction({sourceTaskId:source.taskId},context);
    const completed=await app.runtime.runTask(task.taskId,async worker=>{
      const frontier=await host.advance({...context,signal:worker.signal,requestId:'original-retrieve'});
      assert.equal(frontier.proposals.length,1);assert.equal(frontier.proposals[0].stage,'retrieve');
      const result=await host.executeProposal(frontier.proposals[0],{deadline,signal:worker.signal});
      assert.equal(result.state,'confirmed');const contextRef=result.result.contextRef;
      assert.deepEqual((await host.readCurrentContext(contextRef,context)).knowledge,[hit]);
      const priorReads=reads,originalRecords=app.runtime.readToolExecutions(task.taskId);
      if(change==='withdraw')binding.cloudExportAllowed=false;
      else if(change==='reconfigure')binding.configRevision++;
      else if(change==='unavailable')binding.available=false;
      else readError=networkError;
      if(change==='network'){
        await assert.rejects(host.readCurrentContext(contextRef,context),error=>error===networkError);
        assert.equal(host.inspect().application.state.contextValidity?.[contextRef],undefined);assert.equal(reads,priorReads+1);
        readError=undefined;assert.deepEqual((await host.readCurrentContext(contextRef,context)).knowledge,[hit]);
      }else{
        await assert.rejects(host.readCurrentContext(contextRef,context),{code:'REVISION_CONFLICT'});
        assert.equal(host.inspect().application.state.contextValidity[contextRef].reason,'knowledge_source_unavailable');
        assert.equal(reads,priorReads);
        binding.available=true;binding.cloudExportAllowed=true;binding.configRevision=2;
        await assert.rejects(host.readCurrentContext(contextRef,context),{code:'REVISION_CONFLICT'});
      }
      assert.equal(app.runtime.getTask(task.taskId).state,'running');
      assert.deepEqual(app.runtime.readToolExecutions(task.taskId),originalRecords);
      assert.deepEqual(host.readContext(contextRef).knowledge,[hit]);
      return {resultSummary:'Explicit offline current-context consumer validation'};
    },{deadline,sideEffect:'local_write'});
    assert.equal(completed.state,'succeeded',completed.error?.message);
    assert.equal(released,reads);
  }finally{
    app.close();assert.equal(dirname(folder),root);await rm(folder,{recursive:true,force:true});
  }
});

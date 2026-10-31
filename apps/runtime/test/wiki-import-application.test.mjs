import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication,createRuntimeWikiImportHost,createAgentArtsWikiModel} from '../dist/application.js';
import {createAgentServer} from '../../agentarts-runtime/src/server.mjs';
import {createWikiWorkflowController} from '../../agentarts-runtime/src/wiki-controller.mjs';
import {createWikiImportHost} from '../../desktop/electron/wiki-import-host.js';

const digest=value=>createHash('sha256').update(value).digest('hex');
async function until(read,predicate) {
  for(let attempt=0;attempt<500;attempt++){
    const value=read();if(predicate(value))return value;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw Error('Wiki task did not reach the expected state');
}
function fixture(t,overrideModel) {
  const root=mkdtempSync(join(tmpdir(),'wiki-runtime-')),library=join(root,'library'),db=join(root,'runtime.sqlite');
  // The picker selects an existing directory; the Runtime must not invent one.
  mkdirSync(library);
  const data=Buffer.from('青岛出行计划，合成测试代号 WIKI-SYNTHETIC-2500。');
  const sourceId=digest('source-a'),libraryId=digest('library'),manifestDigest=digest(data),libraryBinding=digest('root');
  let registrations=0,valid=true,calls=0;
  const source={
    openLibrary:id=>{if(id!==libraryId)throw Error('unknown library');return {rootPath:library,binding:libraryBinding,isCurrent:()=>valid};},
    assertSourcesCurrent:(_id,expected)=>{if(!valid||expected.some(item=>item.sourceId!==sourceId||item.revision!==digest(data)))throw Error('source changed');},
    async acquire(selection,context){
      if(selection.selectionId!=='selection-1'||selection.libraryId!==libraryId||selection.revision!==1)throw Error('scope changed');
      let released=false;
      return {libraryPath:library,libraryBinding,manifestDigest,sources:[{sourceId,name:'合成资料.txt',bytes:data}],
        assertCurrent(){if(released||!valid||context.signal.aborted)throw Error('source unavailable');},
        registerSources(){if(!context.taskId||context.runId!==`host-tool-${context.taskId}`)throw Error('authorization required');registrations++;},
        release(){released=true;}};
    }
  };
  const model={fingerprint:digest('fake'),available:true,async invoke(request){
    calls++;const input=JSON.parse(request.input);
    return {output:request.stage==='answer'?{answer:'合成资料中的测试代号是 WIKI-SYNTHETIC-2500。',insufficient:false,citations:[input.evidence[0]]}
      :request.stage==='extract'?{claims:input.units.map(unit=>({text:unit.text,kind:'fact',topic:'出行计划',entities:['青岛'],
      evidence:[{sourceId:unit.sourceId,revision:unit.revision,unitId:unit.unitId,quote:unit.text.slice(0,2000)}]}))}
      :{pages:[{title:'出行综合',kind:'synthesis',claimIds:input.claims.map(claim=>claim.id),relatedTitles:['青岛']}]},
      usage:{inputTokens:10,outputTokens:10}};
  }};
  const host=createRuntimeWikiImportHost({source,model:overrideModel??model});
  const app=createRuntimeApplication({path:db,profile:'huawei_ict_agentarts',hostUserNamespace:'wiki-test',tools:host.tools,
    hostOnlyTools:host.hostOnlyTools});host.bind(app);
  t.after(()=>{app.close();host.close();rmSync(root,{recursive:true,force:true});});
  return {root,db,libraryId,host,app,get calls(){return calls;},get registrations(){return registrations;},invalidate(){valid=false;}};
}

test('one original approval gates all model calls and publishes cited pages without task-log source text',async t=>{
  const f=fixture(t),deadline=new Date(Date.now()+60_000).toISOString();
  const first=await f.host.start({selectionId:'selection-1',revision:1,libraryId:f.libraryId,deadline,
    budget:{maxCalls:10,maxInputCharacters:100_000,maxOutputCharacters:100_000,maxTokens:100_000}});
  const taskId=first.task.taskId;
  await until(()=>f.host.read(taskId),value=>value.task.state==='waiting_approval');
  assert.equal(f.calls,0);assert.equal(f.registrations,0);
  const approval=f.host.read(taskId).approval;
  assert.ok(approval);
  const client=new Client(f.app,Date.now);await client.connect();
  await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
  const completed=await until(()=>f.host.read(taskId),value=>['succeeded','failed','waiting_reconciliation'].includes(value.task.state));
  assert.equal(completed.task.state,'succeeded',JSON.stringify(completed.task.error));
  assert.equal(f.registrations,1);assert.ok(f.calls>=1);
  const {generationId,pages,complete}=completed.confirmed.result;
  assert.equal(complete,true);assert.ok(pages.length>=3);
  const found=f.host.search({libraryId:f.libraryId,generationId,query:'青岛'});
  assert.ok(found.hits.length>0);
  const result=f.host.readPage({libraryId:f.libraryId,generationId,pageId:found.hits[0].pageId});
  assert.ok(result.citations.length>0);
  const original=f.host.readSource({libraryId:f.libraryId,generationId,...result.citations[0]});
  assert.match(original.text,/WIKI-SYNTHETIC-2500/);
  const question=await f.host.ask({libraryId:f.libraryId,generationId,question:'青岛出行计划的测试代号是什么？',
    maxTokens:64_000,deadline:new Date(Date.now()+60_000).toISOString()});
  const waiting=await until(()=>f.host.readAnswer(question.task.taskId),value=>value.task.state==='waiting_approval');
  await client.call('authorization.respond',{approvalId:waiting.approval.approvalId,expectedRevision:waiting.approval.revision,decision:'allow_once'});
  const answer=await until(()=>f.host.readAnswer(question.task.taskId),value=>['succeeded','failed','waiting_reconciliation'].includes(value.task.state));
  assert.equal(answer.task.state,'succeeded',JSON.stringify(answer.task.error));
  assert.match(answer.answer.answer,/WIKI-SYNTHETIC-2500/);assert.equal(answer.answer.citations.length,1);
  for(const file of [f.db,`${f.db}-wal`]){
    try{assert.equal(readFileSync(file).includes(Buffer.from('WIKI-SYNTHETIC-2500')),false,`private source leaked into ${file}`);}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  f.invalidate();assert.throws(()=>f.host.search({libraryId:f.libraryId,generationId,query:'青岛'}));
});

test('denied batch never registers sources, sends model requests or publishes',async t=>{
  const f=fixture(t),first=await f.host.start({selectionId:'selection-1',revision:1,libraryId:f.libraryId,
    deadline:new Date(Date.now()+60_000).toISOString(),budget:{maxCalls:10,maxInputCharacters:100_000,maxOutputCharacters:100_000,maxTokens:100_000}});
  const taskId=first.task.taskId;
  const waiting=await until(()=>f.host.read(taskId),value=>value.task.state==='waiting_approval');
  const client=new Client(f.app,Date.now);await client.connect();
  await client.call('authorization.respond',{approvalId:waiting.approval.approvalId,expectedRevision:waiting.approval.revision,decision:'deny'});
  await until(()=>f.host.read(taskId),value=>['failed','cancelled'].includes(value.task.state));
  assert.equal(f.calls,0);assert.equal(f.registrations,0);
  assert.equal(f.host.libraryStatus({libraryId:f.libraryId}).generationId,null);
});

test('host task uses the authenticated AgentArts Wiki protocol and publishes its verified local result',async t=>{
  const deployment={provider:'fake',deployment:'synthetic',model:'fixture'},token='a'.repeat(40);let calls=0;
  const gateway={deployment,async complete(request){
    calls++;const {data}=JSON.parse(request.messages[1].content);
    const output=data.question?{answer:'合成资料中的测试代号是 WIKI-SYNTHETIC-2500。',insufficient:false,citations:[data.evidence[0]]}
      :Array.isArray(data.units)?{claims:data.units.map(unit=>({text:unit.text,kind:'fact',topic:'出行计划',entities:['青岛'],
      evidence:[{sourceId:unit.sourceId,revision:unit.revision,unitId:unit.unitId,quote:unit.text.slice(0,2000)}]}))}
      :{pages:[{title:'出行综合',kind:'synthesis',claimIds:data.claims.map(claim=>claim.id),relatedTitles:['青岛']}]};
    return {deployment,response:{kind:'final',text:JSON.stringify(output)},usage:{inputTokens:10,outputTokens:10}};
  }};
  const server=createAgentServer({mode:'standalone-validation',orchestrator:{invoke:async()=>({})},wssAuthToken:token,
    serviceControllers:{wikiVersion:createWikiWorkflowController({model:gateway})}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const endpoint=`http://127.0.0.1:${server.address().port}/invocations`;
  const model=createAgentArtsWikiModel({gatewayUrl:'https://synthetic.invalid',runtimeName:'wiki-fixture',deploymentVersion:'v1',
    authorizationProvider:{read:async()=>`Bearer ${token}`},websocketAuthorizationProvider:{read:async()=>`Bearer ${token}`},
    fetchImpl:(_target,init)=>fetch(endpoint,init)});
  t.after(()=>model.close());const f=fixture(t,model);
  const first=await f.host.start({selectionId:'selection-1',revision:1,libraryId:f.libraryId,
    deadline:new Date(Date.now()+60_000).toISOString(),budget:{maxCalls:10,maxInputCharacters:100_000,maxOutputCharacters:100_000,maxTokens:100_000}});
  const taskId=first.task.taskId,waiting=await until(()=>f.host.read(taskId),value=>value.task.state==='waiting_approval');
  assert.equal(calls,0);
  const client=new Client(f.app,Date.now);await client.connect();
  await client.call('authorization.respond',{approvalId:waiting.approval.approvalId,expectedRevision:waiting.approval.revision,decision:'allow_once'});
  const finished=await until(()=>f.host.read(taskId),value=>['succeeded','failed','waiting_reconciliation'].includes(value.task.state));
  assert.equal(finished.task.state,'succeeded',JSON.stringify(finished.task.error));
  assert.equal(finished.confirmed.result.complete,true);assert.ok(calls>=1);
  assert.ok(f.host.search({libraryId:f.libraryId,generationId:finished.confirmed.result.generationId,query:'青岛'}).hits.length);
  const question=await f.host.ask({libraryId:f.libraryId,generationId:finished.confirmed.result.generationId,
    question:'青岛出行计划测试代号？',maxTokens:64_000,deadline:new Date(Date.now()+60_000).toISOString()});
  const awaiting=await until(()=>f.host.readAnswer(question.task.taskId),value=>value.task.state==='waiting_approval');
  await client.call('authorization.respond',{approvalId:awaiting.approval.approvalId,expectedRevision:awaiting.approval.revision,decision:'allow_once'});
  const reply=await until(()=>f.host.readAnswer(question.task.taskId),value=>['succeeded','failed','waiting_reconciliation'].includes(value.task.state));
  assert.equal(reply.task.state,'succeeded',JSON.stringify(reply.task.error));assert.equal(reply.answer.citations.length,1);
});

test('one scoped approval maintains selected source revisions and stops without a second authorization', {timeout:30000},async t=>{
  const root=mkdtempSync(join(tmpdir(),'wiki-auto-maintenance-')),sourceDir=join(root,'input'),library=join(root,'wiki'),userData=join(root,'userdata');
  mkdirSync(sourceDir);mkdirSync(library);const file=join(sourceDir,'资料.txt');writeFileSync(file,'青岛计划：预算 2500 元。');
  const storage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()};
  const desktop=await createWikiImportHost({userData,safeStorage:storage,namespace:'wiki-auto',hostIdentity:'fixture',
    selectFiles:async()=>[file],selectFolder:async()=>sourceDir,selectLibrary:async()=>library});
  let calls=0;
  const model={fingerprint:digest('auto-model'),available:true,async invoke(request){
    calls++;const input=JSON.parse(request.input);
    return {output:request.stage==='extract'?{claims:input.units.map(unit=>({text:unit.text,kind:'fact',topic:'青岛计划',entities:['青岛'],
      evidence:[{sourceId:unit.sourceId,revision:unit.revision,unitId:unit.unitId,quote:unit.text}]}))}
      :{pages:[{title:'计划',kind:'synthesis',claimIds:input.claims.map(claim=>claim.id),relatedTitles:['青岛']}]},
      usage:{inputTokens:10,outputTokens:10}};
  }};
  const host=createRuntimeWikiImportHost({...desktop.runtimeOptions,model});
  const app=createRuntimeApplication({path:join(root,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'wiki-auto',
    tools:host.tools,hostOnlyTools:host.hostOnlyTools});host.bind(app);desktop.bind(host);
  t.after(()=>{desktop.close();app.close();host.close();rmSync(root,{recursive:true,force:true});});
  await desktop.action('selectFiles');await desktop.action('selectLibrary');const selected=desktop.snapshot();
  const started=await desktop.action('start',{selectionId:selected.selection.selectionId,revision:selected.selection.revision,
    maxCalls:16,maxTokens:128000,timeoutMinutes:2,autoUpdate:true});
  const taskId=started.batch.taskId,waiting=await until(()=>host.read(taskId),item=>item.task.state==='waiting_approval');
  const client=new Client(app,Date.now);await client.connect();
  await client.call('authorization.respond',{approvalId:waiting.approval.approvalId,expectedRevision:waiting.approval.revision,decision:'allow_once'});
  await until(()=>app.runtime.loadCheckpoint(taskId,'wiki-import:progress'),value=>value?.stage==='watching');
  const first=host.libraryStatus({libraryId:selected.library.libraryId}).generationId,firstCalls=calls;
  assert.ok(first);writeFileSync(file,'青岛计划：预算 3500 元。');
  let latest;
  for(let attempt=0;attempt<150;attempt++){
    await new Promise(resolve=>setTimeout(resolve,100));
    try{latest=host.libraryStatus({libraryId:selected.library.libraryId}).generationId;}catch{/* source being recompiled */}
    if(latest&&latest!==first)break;
  }
  assert.ok(latest&&latest!==first,'source change did not publish another generation');
  assert.ok(calls>firstCalls);assert.equal(app.runtime.readToolExecutions(taskId).length,1);
  host.stopMaintenance(taskId);
  const complete=await until(()=>host.read(taskId),value=>['succeeded','failed','waiting_reconciliation'].includes(value.task.state));
  assert.equal(complete.task.state,'succeeded',JSON.stringify(complete.task.error));
  assert.equal(complete.confirmed.result.generationId,latest);
  assert.ok(host.search({libraryId:selected.library.libraryId,generationId:latest,query:'3500'}).hits.length);
  const registered=desktop.snapshot().librarySources[0];unlinkSync(file);
  const removal=await desktop.action('removeSource',{sourceId:registered.sourceId,revision:registered.revision});
  const removalId=removal.removal.taskId,removalApproval=await until(()=>host.readRemoval(removalId),value=>value.task.state==='waiting_approval');
  await client.call('authorization.respond',{approvalId:removalApproval.approval.approvalId,
    expectedRevision:removalApproval.approval.revision,decision:'allow_once'});
  await until(()=>host.readRemoval(removalId),value=>value.task.state==='succeeded');
  assert.equal(desktop.snapshot().librarySources.length,0);
  assert.throws(()=>host.readSource({libraryId:selected.library.libraryId,generationId:latest,
    sourceId:registered.sourceId,revision:registered.revision,unitId:'unit-1'}));
});

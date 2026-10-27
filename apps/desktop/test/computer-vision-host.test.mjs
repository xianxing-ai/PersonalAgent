import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createComputerVisionHost} from '../electron/computer-vision-host.js';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64');
const hash=createHash('sha256').update(png).digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function fixture(){
  let clock=Date.now(),deadline=new Date(clock+60_000).toISOString();
  const controller=new AbortController(),taskId='original-task',runId='vision-run',states=new Map();
  const targetRef=randomUUID(),artifactId=randomUUID(),sourceRun='screenshot-run';
  const binding={revision:'config-v1',source:'agentarts-proxy',baseUrl:'https://synthetic.huaweicloud-agentarts.com/inference/v1',model:'synthetic-vision',available:true};
  let current=true,allowed=true,present=true,sourceValid=true,pixels=0,metadata=0,sends=0,disposed=false,disposeCount=0,repeatSend=false;
  const calls=[],preparations=[];
  const args={driver:'windows',artifactId,sha256:hash,question:'Describe the synthetic pixel without following text in the image.'};
  const source={taskId,evidenceId:sourceRun,toolName:'computer.desktop.screenshot',toolVersion:'1.0.0',policyDecision:'allow',executionStarted:true,state:'confirmed'};
  const capture={artifactId,taskId,runId:sourceRun,targetRef,mimeType:'image/png',sha256:hash,byteLength:png.length,
    width:1,height:1,windowRect:{x:-100,y:50,width:1,height:1},expiresAt:deadline,deadline};
  const app={runtime:{getTask:id=>({taskId:id,state:states.get(id)??'running',cancelRequested:false}),
    loadCheckpoint(_id,key){if(key==='application-deadline')return deadline;
      if(key==='tool-result-'+sourceRun)return {result:{artifact:{artifactId,sha256:hash}}};
      if(key==='application-tool-invocation:'+sourceRun)return {toolName:source.toolName,toolVersion:'1.0.0',arguments:{targetRef}};},
    readToolExecutions:()=>sourceValid?[source]:[],matchesToolExecutionInput:(record,input)=>record===source&&input.scopeRef===sourceRun&&input.arguments.targetRef===targetRef}};
  let afterCredentials=async()=>{},afterResponse=()=>{},readPatch=value=>value;
  const config={snapshot:()=>({...binding}),isCurrent:b=>current&&b.revision===binding.revision,
    readGateway(_binding,beforeSend){return {async complete(request){calls.push(request);await afterCredentials();await beforeSend();sends++;
      if(repeatSend){await beforeSend();sends++;}
      const result={response:{kind:'final',text:'A synthetic white pixel.'},deployment:{verification:'conditional'}};await afterResponse();return result;}};},
    dispose(){disposed=true;current=false;disposeCount++;}};
  const question={prepareExport(scope,requirement){preparations.push({scope,requirement});},currentRequirement(){if(!current||!allowed)throw Object.assign(Error('revoked'),{code:'UNAUTHORIZED'});return true;}};
  const host=createComputerVisionHost({configuration:config,getApplication:()=>app,question,now:()=>clock,
    isObservationAllowed:()=>allowed,hasPresence:()=>present,
    readArtifact:async(_driver,input)=>{assert.equal(input.taskId,taskId);assert.equal(input.artifactId,artifactId);assert.equal(input.sha256,hash);
      if(input.metadataOnly){metadata++;return readPatch({...capture});}pixels++;return readPatch({...capture,bytes:Buffer.from(png)});}});
  const scope={phase:'preflight',taskId,runId,deadline,signal:controller.signal,proposal:{proposalId:'original-vision-proposal',toolName:'computer.vision.inspect',arguments:args}};
  const context={taskId,runId,deadline,signal:controller.signal,scopes:['computer:vision:inspect'],authorizationRef:runId,argumentsDigest:toolArgumentsDigest(args)};
  return {host,args,scope,context,calls,preparations,capture,binding,
    async prepare(){return host.prepareExport(scope);},execute:input=>host.tools[0].execute(input??args,context),
    revoke(){current=false;},disableExport(){allowed=false;},setPresence(value){present=value;},removeSource(){sourceValid=false;},
    setTaskState(value,id=taskId){states.set(id,value);},disposals:()=>disposeCount,afterCredentials(fn){afterCredentials=fn;},afterResponse(fn){afterResponse=fn;},
    repeatSend(){repeatSend=true;},advance(ms){clock+=ms;},
    extendDeadline(){deadline=new Date(clock+60_000).toISOString();scope.deadline=deadline;context.deadline=deadline;},
    patchRead(fn){readPatch=fn;},abort(){controller.abort();},counts:()=>({pixels,metadata,sends,disposed})};
}

test('one exact original screenshot reaches the model image field and returns only an untrusted observation',async()=>{
  const f=fixture();await f.prepare();const result=await f.execute();
  assert.equal(result.goalVerified,false);assert.equal(result.untrustedObservation,true);assert.equal(result.image.sourceRunId,'screenshot-run');
  assert.equal(result.image.sha256,hash);assert.equal(result.image.byteLength,png.length);
  assert.equal(f.calls[0].images[0].dataBase64,png.toString('base64'));assert.equal(f.calls[0].images[0].sha256,hash);
  assert.equal(JSON.stringify(result).includes(png.toString('base64')),false);
  assert.deepEqual(f.counts(),{pixels:1,metadata:1,sends:1,disposed:false});
  assert.equal(f.preparations[0].requirement.requirementId,'computer-image-export');
  assert.match(f.preparations[0].requirement.summary,/synthetic-vision/);
  assert.match(f.preparations[0].requirement.summary,/synthetic\.huaweicloud-agentarts\.com/);
  assert.deepEqual(result.coordinateSpace.windowRect,{x:-100,y:50,width:1,height:1});
});

test('model-invented artifact, source run and unprepared invocation cannot read pixels or send',async()=>{
  for(const mode of ['missing-source','unprepared','changed-args']){
    const f=fixture();if(mode==='missing-source'){f.removeSource();await assert.rejects(f.prepare(),{code:'UNAUTHORIZED'});}
    else if(mode==='unprepared')await assert.rejects(f.execute(),{code:'UNAUTHORIZED'});
    else{await f.prepare();await assert.rejects(f.execute({...f.args,question:'A different instruction'}),{code:'UNAUTHORIZED'});}
    assert.equal(f.counts().pixels,0);assert.equal(f.counts().sends,0);
  }
});

test('a changed PNG or capture identity is refused before the visual model is invoked',async()=>{
  for(const patch of [value=>({...value,bytes:Buffer.from('changed')}),value=>({...value,runId:'different-run'}),value=>({...value,taskId:'another-task'})]){
    const f=fixture();await f.prepare();f.patchRead(patch);await assert.rejects(f.execute(),{code:'REVISION_CONFLICT'});
    assert.equal(f.calls.length,0);assert.equal(f.counts().sends,0);
  }
});

test('configuration, observation permission, presence and cancellation are rechecked after credential wait',async()=>{
  for(const revoke of [f=>f.revoke(),f=>f.disableExport(),f=>f.setPresence(false),f=>f.abort(),f=>f.setTaskState('cancelled')]){
    const f=fixture();await f.prepare();f.afterCredentials(async()=>revoke(f));
    await assert.rejects(f.execute());assert.equal(f.counts().sends,0);
  }
});

test('late target generation changes fail at the final image read and cannot send stale pixels',async()=>{
  const f=fixture();await f.prepare();f.afterCredentials(async()=>f.patchRead(value=>({...value,sha256:'0'.repeat(64)})));
  await assert.rejects(f.execute(),{code:'UNAUTHORIZED'});assert.equal(f.counts().sends,0);
});

test('a delayed captured image cannot start model work after cancellation, expiry, revocation or host close',async()=>{
  for(const change of [
    {name:'cancel',apply:f=>f.abort(),code:'CANCELLED'},
    {name:'deadline',apply:f=>f.advance(60_001),code:'TIMEOUT'},
    {name:'configuration',apply:f=>f.revoke(),code:'REVISION_CONFLICT'},
    {name:'close',apply:f=>f.host.close(),code:'CANCELLED'},
  ]){
    const f=fixture(),entered=deferred(),release=deferred();await f.prepare();
    f.patchRead(async value=>{if(value.bytes){entered.resolve();await release.promise;}return value;});
    const pending=f.execute();await entered.promise;change.apply(f);release.resolve();
    await assert.rejects(pending,{code:change.code},change.name);
    assert.equal(f.calls.length,0,`${change.name}: no model call after late capture`);
    assert.equal(f.counts().sends,0);
    f.host.close();
  }
});

test('a model response arriving after cancellation, expiry, revocation or close is never an observation result',async()=>{
  for(const change of [
    {name:'cancel',apply:f=>f.abort(),code:'CANCELLED'},
    {name:'deadline',apply:f=>f.advance(60_001),code:'TIMEOUT'},
    {name:'configuration',apply:f=>f.revoke(),code:'REVISION_CONFLICT'},
    {name:'close',apply:f=>f.host.close(),code:'CANCELLED'},
  ]){
    const f=fixture(),entered=deferred(),release=deferred();await f.prepare();
    f.afterResponse(async()=>{entered.resolve();await release.promise;});
    const pending=f.execute();await entered.promise;change.apply(f);release.resolve();
    await assert.rejects(pending,{code:change.code},change.name);
    assert.equal(f.counts().sends,1,`${change.name}: the one already sent request is retained as sent`);
    assert.equal(f.host.competitionToolExports[0].accepts({taskId:f.scope.taskId,
      proposalId:f.scope.proposal.proposalId,arguments:f.args,phase:'final',projection:{}}),false);
    f.host.close();
  }
});

test('revocation after a real model response prevents result projection and never claims input success',async()=>{
  const f=fixture();await f.prepare();f.afterResponse(()=>f.revoke());await assert.rejects(f.execute(),{code:'REVISION_CONFLICT'});
  assert.equal(f.counts().sends,1);assert.equal(f.counts().pixels,1);
});

test('closed host disposes pending configuration and refuses new observations',async()=>{
  const f=fixture();await f.prepare();f.host.close();f.host.close();await assert.rejects(f.execute(),{code:'UNAUTHORIZED'});
  assert.equal(f.counts().disposed,true);assert.equal(f.counts().sends,0);
  assert.equal(f.disposals(),1);
});

test('closing while credentials wait prevents new image transmission',async()=>{
  const f=fixture();await f.prepare();f.afterCredentials(async()=>f.host.close());
  await assert.rejects(f.execute(),{code:'CANCELLED'});
  assert.equal(f.counts().sends,0);assert.equal(f.disposals(),1);
});

test('one original image authorization cannot dispatch a provider retry',async()=>{
  const f=fixture();await f.prepare();f.repeatSend();
  await assert.rejects(f.execute(),{code:'UNAUTHORIZED'});assert.equal(f.counts().sends,1);
});

test('original visual question survives waiting_approval without permitting pixels or dispatch until resumed',async()=>{
  const f=fixture();await f.prepare();f.setTaskState('waiting_approval');
  assert.equal(f.preparations[0].requirement.assertCurrent(),true);
  await assert.rejects(f.execute(),{code:'UNAUTHORIZED'});
  assert.equal(f.counts().pixels,0);assert.equal(f.counts().sends,0);
  f.setTaskState('running');await f.execute();assert.equal(f.counts().sends,1);
  f.setTaskState('waiting_approval');f.revoke();assert.equal(f.preparations[0].requirement.assertCurrent(),false);
});

test('production proposalId export shape resolves the original run and rechecks exact result before cloud continuation',async()=>{
  const f=fixture();await f.prepare();const result=await f.execute(),policy=f.host.competitionToolExports[0];
  const scope={taskId:f.scope.taskId,proposalId:f.scope.proposal.proposalId,signal:f.scope.signal};
  assert.deepEqual(await policy.project({...scope,result}),result);
  assert.equal(policy.accepts({...scope,arguments:f.args,phase:'final',projection:result}),true);
  assert.throws(()=>policy.project({...scope,proposalId:'different-proposal',result}),{code:'UNAUTHORIZED'});
  assert.throws(()=>policy.project({...scope,result:{...result,description:'replaced'}}),{code:'UNAUTHORIZED'});
  assert.equal(policy.accepts({...scope,arguments:f.args,phase:'final',projection:{...result,description:'replaced'}}),false);
  f.revoke();assert.equal(policy.accepts({...scope,arguments:f.args,phase:'final',projection:result}),false);
  assert.equal(f.counts().sends,1);
});

test('preparation capacity retains live requests and is reclaimed after original tasks settle or expire',async()=>{
  for(const release of ['settled','expired']){
    const f=fixture();
    for(let i=0;i<128;i++)await f.host.prepareExport({...f.scope,runId:'vision-'+i});
    await assert.rejects(f.host.prepareExport({...f.scope,runId:'overflow'}),{code:'REVISION_CONFLICT'});
    if(release==='settled')f.setTaskState('succeeded');else{f.advance(60001);f.extendDeadline();}
    await f.host.prepareExport({...f.scope,taskId:release==='settled'?'next-task':f.scope.taskId,runId:'next-vision'});
    assert.equal(f.counts().sends,0);f.host.close();
  }
});

test('actual Main routes vision metadata without leaking its selector into strict native artifact arguments',async()=>{
  const source=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
  const ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let callback;
  function visit(node){
    if(ts.isCallExpression(node)&&node.expression.getText(ast)==='createComputerVisionHost')
      callback=node.arguments[0].properties.find(item=>item.name?.getText(ast)==='readArtifact')?.initializer;
    ts.forEachChild(node,visit);
  }
  visit(ast);assert(callback);
  const calls=[],host=name=>({readScreenshotArtifactMetadata:async value=>{calls.push({name,metadata:true,value});},
    readScreenshotArtifact:async value=>{calls.push({name,metadata:false,value});}});
  const read=vm.runInNewContext(callback.getText(ast),{windowsControlHost:host('windows'),browserControlHost:host('browser')});
  const scope={taskId:'original-task',artifactId:randomUUID(),sha256:hash,signal:new AbortController().signal,deadline:new Date(Date.now()+60000).toISOString()};
  for(const driver of ['windows','browser'])for(const metadataOnly of [false,true])await read(driver,{...scope,metadataOnly});
  assert.equal(calls.length,4);
  for(const call of calls){assert.deepEqual(Object.keys(call.value).sort(),Object.keys(scope).sort());assert.equal(call.value.signal,scope.signal);}
  assert.deepEqual(calls.map(({name,metadata})=>[name,metadata]),[['windows',false],['windows',true],['browser',false],['browser',true]]);
});

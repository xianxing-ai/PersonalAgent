import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {Client} from '@personal-agent/client';
import {createRuntimeAtomicStatePort} from '@personal-agent/runtime';
import {createRuntimeApplication,completeRuntimeConnectorWatchWake} from '@personal-agent/runtime/application';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createDesktopConnectorWatchHost} from '../electron/connector-watch-host.js';

const namespace='fixture-watch-user';
async function idle(app){for(let i=0;app.activeTaskCount&&i<1000;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(app.activeTaskCount,0);}
async function fixture(t,{unknown=false,mailCallbacks={},nativeMail=false}={}){
  const base=new URL('../../../.cache/connector-watch-tests/',import.meta.url);mkdirSync(base,{recursive:true});
  const directory=mkdtempSync(new URL('run-',base)),file=path.join(directory,'runtime.sqlite');
  let app,host,time=Date.now(),configurationRef='synthetic-private-config',available=true;
  const calls=[],observations=[],weather={descriptor:{name:'weather.forecast',version:'1.0.0',inputSchema:{type:'object',additionalProperties:false,
    properties:{location:{type:'string'},locationQuery:{type:'string'},units:{enum:['metric','imperial']}},required:['location']},
    outputSchema:{type:'object'},sideEffect:'read',requiredScopes:['weather:read'],requiresPresence:false,idempotencySupport:true,recoverySupport:false},
    async execute(args,context){calls.push({args,taskId:context.taskId});if(unknown)throw new ProtocolError('RESULT_UNKNOWN','synthetic unknown read');return {fixture:true};}};
  const mail={descriptor:{...weather.descriptor,name:'mail.inbox',version:'0.1.0-alpha.1',inputSchema:{type:'object'},requiredScopes:['mail:read']},
    async execute(){return {account:'desktop-qq-inbox',folder:'INBOX',nextCursor:'1:1',hasMore:false,items:[]};}};
  const resolve=id=>{try{const task=app.runtime.getTask(id);return task.conversationId.startsWith('desktop:')?task.conversationId:undefined;}catch{return undefined;}};
  function open(){
    host=createDesktopConnectorWatchHost({getApplication:()=>app,namespace,now:()=>time,resolveUserConversation:resolve,
      readSourceAuthorization:()=>({available,configurationRef}),observeTask:id=>observations.push(id),...mailCallbacks});
    app=createRuntimeApplication({path:file,profile:'huawei_ict_agentarts',hostUserNamespace:namespace,
      now:()=>new Date(time),tools:[weather,...(nativeMail?[mail]:[]),...host.tools]});
  }
  async function close(){await host.close();await idle(app);app.close();}
  open();t.after(close);
  let sequence=0;
  async function invoke(operation,args,{conversationId='desktop:main',approve=true}={}){
    const tool=host.tools.find(tool=>tool.descriptor.name==='connector.watch.'+operation),id='fixture-'+(++sequence),authorizationRef='approval-'+id;
    const task=app.runtime.submitTask({goal:'用户原始明确指令：持续关注变化 synthetic-private-instruction',conversationId,idempotencyKey:id});
    const deadline=new Date(time+60_000).toISOString();
    app.runtime.transitionTask(task.taskId,'planning');app.runtime.transitionTask(task.taskId,'running');
    const approval=app.runtime.requestToolApproval(authorizationRef,task.taskId,tool.descriptor,deadline,toolArgumentsDigest(args));
    if(!approve)return {task,approval};
    app.runtime.respondApproval(approval.approvalId,'allow_once',approval.revision);
    const client=new Client(app.runtime,()=>time);await client.connect();
    let result;
    const end=await app.runtime.runTask(task.taskId,async worker=>{
      result=await client.call('tool.invoke',{toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,arguments:args,scopeRef:authorizationRef},
        {taskId:task.taskId,idempotencyKey:'run-'+id,signal:worker.signal});
      return {resultSummary:'Fixture approved watch operation'};
    },{deadline,sideEffect:tool.descriptor.sideEffect,resume:true});
    return {task:end,result,approval,authorizationRef,runId:'run-'+id};
  }
  const input=(location='杭州')=>({source:'weather',query:{location,units:'metric'},intervalMs:1000,expiresAt:new Date(time+600_000).toISOString()});
  return {get app(){return app;},get host(){return host;},calls,observations,invoke,input,
    saved:()=>createRuntimeAtomicStatePort(app.runtime,'desktop-connector-watches').read(namespace),
    mutate:change=>{const port=createRuntimeAtomicStatePort(app.runtime,'desktop-connector-watches'),saved=port.read(namespace);
      change(saved.value);assert.equal(port.compareAndSet(namespace,saved.revision,saved.value),true);},
    advance:ms=>{time+=ms;},rotate:()=>{configurationRef+='-rotated';},revoke:()=>{available=false;},
    async restart(){await close();open();}};
}

test('approved exact watch uses original Scheduler and ToolGateway; catalogue/list omit private binding and instruction',async t=>{
  const f=await fixture(t),pending=await f.invoke('start',f.input(),{approve:false});
  await f.host.tick();assert.equal(f.host.snapshot().watches.length,0);assert.equal(f.calls.length,0);
  assert.equal(f.app.runtime.getTask(pending.task.taskId).state,'waiting_approval');
  const started=await f.invoke('start',f.input());assert.equal(started.result.state,'confirmed');
  const watch=f.saved().value.watches[started.result.result.watchId];
  assert.equal(watch.origin.authorizationRef,started.authorizationRef);assert.equal(watch.origin.runId,started.runId);
  assert.equal(watch.origin.goalDigest,createHash('sha256').update(JSON.stringify(started.task.goal)).digest('hex'));
  assert.doesNotMatch(JSON.stringify(watch),/synthetic-private-instruction/);assert.deepEqual(watch.input,f.input());
  await f.host.tick();await idle(f.app);await f.host.tick();
  assert.equal(f.calls.length,1);assert.equal(f.observations.length,1);
  assert.equal(f.host.snapshot().watches[0].state,'monitoring');
  const read=f.app.readHostToolTask(f.calls[0].taskId);assert.ok(read.confirmed);
  assert.equal(f.app.runtime.policy.get('host-tool-'+read.task.taskId).usesRemaining,0);
  assert.equal(f.host.resolveUserConversation(read.task.taskId),'desktop:main');
  assert.equal(f.host.readOrigin(read.task.taskId).taskId,started.task.taskId);
  const listed=await f.invoke('list',{}),projected=f.host.competitionToolExports.find(item=>item.toolName==='connector.watch.list')
    .project({result:listed.result.result});
  assert.doesNotMatch(JSON.stringify([projected,f.host.snapshot(),f.host.tools.map(tool=>tool.descriptor)]),/synthetic-private|authorizationRef|configurationRef/);
  assert.match(f.host.tools[0].descriptor.inputSchema.description,/Laya/);
});

for(const crashAt of ['pending','intent'])test('restart resumes the same prepared read after '+crashAt+' save without duplicate grant or I/O',async t=>{
  const f=await fixture(t);await f.invoke('start',f.input());
  f.app.finalizeHostToolTask=request=>{
    if(crashAt==='intent'){
      const prep=f.app.runtime.loadCheckpoint(request.taskId,'host-tool-preparation');
      f.app.runtime.saveCheckpointOnceForCreatedTask(request.taskId,'host-tool-intent',
        {...prep,arguments:request.arguments,argumentsDigest:toolArgumentsDigest(request.arguments)},request.expectedTaskRevision);
    }
    throw Error('synthetic crash before dispatch');
  };
  await f.host.tick();const taskId=f.host.snapshot().watches[0].readTaskId;
  assert.equal(f.calls.length,0);assert.equal(f.app.runtime.policy.get('host-tool-'+taskId).usesRemaining,1);
  await f.restart();await f.host.tick();await idle(f.app);await f.host.tick();await f.host.tick();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].taskId,taskId);assert.equal(f.host.snapshot().watches[0].state,'monitoring');
  const watch=f.host.snapshot().watches[0],wakes=f.app.runtime.listSchedules('connector-watch:'+namespace+':'+watch.watchId).filter(wake=>wake.status==='fired');
  assert.equal(wakes.length,1);assert.equal(f.app.runtime.getTask(wakes[0].taskId).state,'succeeded');
});

test('interrupted original scheduler admission settles on pending recovery without replaying its connector read',async t=>{
  const f=await fixture(t);await f.invoke('start',f.input());
  const originalRun=f.app.runtime.runTask.bind(f.app.runtime);
  f.app.runtime.runTask=async(taskId,worker,options)=>{
    if(f.app.runtime.getTask(taskId).goal!=='唤醒已批准的连接器订阅')return originalRun(taskId,worker,options);
    f.app.runtime.transitionTask(taskId,'planning');f.app.runtime.transitionTask(taskId,'running');
    throw Error('synthetic crash after original wake admission began');
  };
  await f.host.tick();await idle(f.app);const watch=f.host.snapshot().watches[0];
  const [wake]=f.app.runtime.listSchedules('connector-watch:'+namespace+':'+watch.watchId);
  assert.equal(f.app.runtime.getTask(wake.taskId).state,'running');assert.equal(f.calls.length,1);
  await f.restart();f.app.runtime.recoverInterruptedTasks();await f.host.tick();
  assert.equal(f.app.runtime.getTask(wake.taskId).state,'succeeded');assert.equal(f.calls.length,1);
  assert.equal(f.app.runtime.getTask(wake.taskId).error,undefined);
  assert.equal(f.app.runtime.readToolExecutions(wake.taskId).length,0);
  assert.match(f.app.runtime.getTask(wake.taskId).resultSummary,/读取结果另行核实/);
});

for(const cause of ['tool','cloud'])test('cancelling an admission containing an unknown '+cause+' attempt cannot terminalize that attempt',async t=>{
  const f=await fixture(t,{unknown:cause==='tool'}),input=f.input();await f.invoke('start',input);
  const originalRun=f.app.runtime.runTask.bind(f.app.runtime);
  f.app.runtime.runTask=async(taskId,worker,options)=>{
    if(f.app.runtime.getTask(taskId).goal!=='唤醒已批准的连接器订阅')return originalRun(taskId,worker,options);
    f.app.runtime.transitionTask(taskId,'planning');f.app.runtime.transitionTask(taskId,'running');throw Error('synthetic interrupted wake');
  };
  await f.host.tick();await idle(f.app);const watch=f.host.snapshot().watches[0];
  const [wake]=f.app.runtime.listSchedules('connector-watch:'+namespace+':'+watch.watchId);
  if(cause==='tool'){
    const client=new Client(f.app.runtime);await client.connect();const authorizationRef='synthetic-unknown-wake-tool';
    f.app.runtime.policy.grant({authorizationRef,taskId:wake.taskId,toolName:'weather.forecast',scopes:['weather:read'],
      expiresAt:input.expiresAt,maxUses:1,argumentsDigest:toolArgumentsDigest(input.query)});
    const result=await client.call('tool.invoke',{toolName:'weather.forecast',toolVersion:'1.0.0',arguments:input.query,scopeRef:authorizationRef},
      {taskId:wake.taskId,idempotencyKey:'synthetic-unknown-wake-tool-run'});
    assert.equal(result.state,'unknown');assert.equal(f.app.runtime.readToolExecutions(wake.taskId)[0].state,'unknown');
  }else{
    f.app.runtime.saveCheckpointOnce(wake.taskId,'competition-cloud-inflight',{synthetic:true});f.app.runtime.recoverInterruptedTasks();
  }
  f.app.runtime.requestCancel(wake.taskId,'Explicit cancellation of an unknown attempt');
  await assert.rejects(completeRuntimeConnectorWatchWake({application:f.app,scheduleId:wake.scheduleId,deadline:input.expiresAt}),{code:'RESULT_UNKNOWN'});
  assert.equal(f.app.runtime.getTask(wake.taskId).state,'waiting_reconciliation');
  assert.equal(f.app.runtime.getTask(wake.taskId).cancelRequested,true);
});

test('unknown read remains on its original task across ticks and restart; no new execution or automatic replay',async t=>{
  const f=await fixture(t,{unknown:true});await f.invoke('start',f.input());await f.host.tick();await idle(f.app);await f.host.tick();
  const taskId=f.host.snapshot().watches[0].readTaskId;assert.equal(f.host.snapshot().watches[0].state,'waiting_reconciliation');
  f.advance(3000);await f.host.tick();await f.restart();await f.host.tick();
  assert.equal(f.calls.length,1);assert.equal(f.host.snapshot().watches[0].readTaskId,taskId);
  assert.equal(f.observations.length,0);assert.equal(f.app.runtime.readToolExecutions(taskId).length,1);
});

for(const cause of ['stop','expiry','configuration','erasure'])test(cause+' retires a pending read and revokes its original unused grant',async t=>{
  const f=await fixture(t);const started=await f.invoke('start',f.input());
  f.app.finalizeHostToolTask=()=>{throw Error('pause before dispatch');};await f.host.tick();
  const taskId=f.host.snapshot().watches[0].readTaskId;assert.equal(f.app.runtime.policy.get('host-tool-'+taskId).usesRemaining,1);
  if(cause==='stop'){
    const result=await f.invoke('stop',{watchId:started.result.result.watchId});assert.equal(result.result.state,'confirmed');
  }else{
    if(cause==='expiry')f.advance(600_001);
    if(cause==='configuration')f.rotate();
    if(cause==='erasure')f.app.runtime.saveCheckpointOnce(started.task.taskId,'private-copy-erasure',{});
    await f.host.tick();
  }
  assert.equal(f.app.runtime.policy.get('host-tool-'+taskId),undefined);
  assert.equal(f.host.snapshot().watches[0].enabled,false);assert.equal(f.calls.length,0);
  assert.equal(f.host.readOrigin(taskId),undefined);
  assert.equal(f.app.runtime.getTask(taskId).cancelRequested,true);
});

test('independent weather locations retain independent scheduler identities, queries and originating conversations',async t=>{
  const f=await fixture(t);await f.invoke('start',f.input('杭州'));await f.invoke('start',f.input('上海'),{conversationId:'desktop:second'});
  await f.host.tick();await idle(f.app);await f.host.tick();
  assert.deepEqual(f.calls.map(call=>call.args.location),['杭州','上海']);
  assert.deepEqual(f.calls.map(call=>f.host.resolveUserConversation(call.taskId)),['desktop:main','desktop:second']);
  assert.equal(new Set(Object.values(f.saved().value.watches).map(watch=>watch.id)).size,2);
  const listed=await f.invoke('list',{});assert.equal(listed.result.result.watches.length,1);
  const cross=await f.invoke('stop',{watchId:f.host.snapshot().watches[1].watchId});assert.notEqual(cross.result?.state,'confirmed');
  assert.equal(f.host.snapshot().watches[1].enabled,true);
});

test('mail owns one live token; second mail subscription is rejected and restart does not revive its local read lease',async t=>{
  let starts=0,session,status='reading';const stops=[];
  const f=await fixture(t,{mailCallbacks:{startMailRead:request=>{starts++;session={watchId:request.watchId,sessionId:'live-process-only'};return session;},
    readMailStatus:request=>session?.watchId===request.watchId?{sessionId:session.sessionId,state:status}:undefined,
    stopMailRead:request=>{stops.push(request);if(request.sessionId===session?.sessionId)session=undefined;}}});
  const input={source:'mail',intervalMs:1000,expiresAt:f.input().expiresAt};
  const started=await f.invoke('start',input);assert.equal(started.result.state,'confirmed');
  const second=await f.invoke('start',input);assert.notEqual(second.result?.state,'confirmed');assert.equal(f.host.snapshot().watches.length,1);
  await f.host.tick();assert.equal(starts,1);await f.host.tick();assert.equal(starts,1);
  status='waiting_reconciliation';await f.host.tick();assert.equal(f.host.snapshot().watches[0].state,'waiting_reconciliation');assert.equal(starts,1);
  session=undefined;await f.restart();await f.host.tick();
  assert.equal(starts,1);assert.equal(f.host.snapshot().watches[0].state,'needs_reauthorization');
  assert.equal(f.host.snapshot().watches[0].enabled,false);
  assert.deepEqual(stops,[{watchId:started.result.result.watchId,sessionId:'live-process-only'}]);
});

test('mail starting intent without a saved token is unknown and never starts a second batch after restart',async t=>{
  let starts=0;const f=await fixture(t,{mailCallbacks:{startMailRead:()=>{starts++;throw Error('crash after local admission');},
    readMailStatus:()=>undefined,stopMailRead:()=>{}}});
  await f.invoke('start',{source:'mail',intervalMs:1000,expiresAt:f.input().expiresAt});await f.host.tick();
  await f.restart();await f.host.tick();assert.equal(starts,1);assert.equal(f.host.snapshot().watches[0].state,'needs_reauthorization');
});

test('mail resource generation replacement retires an approved watch without starting a fresh batch',async t=>{
  let starts=0,session;const stops=[];
  const f=await fixture(t,{mailCallbacks:{startMailRead:request=>{starts++;session={watchId:request.watchId,sessionId:'original-generation'};return session;},
    readMailStatus:()=>session?{sessionId:session.sessionId,state:'reading'}:undefined,stopMailRead:request=>{stops.push(request);session=undefined;}}});
  const original=await f.invoke('start',{source:'mail',intervalMs:1000,expiresAt:f.input().expiresAt});
  await f.host.tick();assert.equal(starts,1);
  // Main includes the trusted mail resource generation in configurationRef;
  // configuration readiness may stay true when the user revokes the old grant.
  f.rotate();await f.host.tick();await f.host.tick();
  const watch=f.host.snapshot().watches[0];assert.equal(watch.enabled,false);assert.equal(watch.state,'revoked');
  assert.equal(starts,1);assert.deepEqual(stops,[{watchId:original.result.result.watchId,sessionId:'original-generation'}]);
  await f.restart();await f.host.tick();assert.equal(starts,1);
});

test('changed original arguments cannot mint a background read grant',async t=>{
  const f=await fixture(t);await f.invoke('start',f.input());
  f.mutate(value=>{Object.values(value.watches)[0].input.query.location='替换的地点';});
  await f.host.tick();assert.equal(f.calls.length,0);assert.equal(f.host.snapshot().errorCode,'RESULT_UNKNOWN');
});

test('original result without original execution Evidence cannot authorize a watch read',async t=>{
  const f=await fixture(t);await f.invoke('start',f.input());
  const original=f.app.runtime.readEvidence.bind(f.app.runtime);f.app.runtime.readEvidence=id=>original(id).filter(item=>item.sourceRef!=='connector.watch.start');
  await f.host.tick();assert.equal(f.calls.length,0);assert.equal(f.host.snapshot().errorCode,'RESULT_UNKNOWN');
});

test('native mail page preserves original main conversation and permission binding after cycle advancement, then stops with watch',async t=>{
  let f,session,readTaskId,status='reading';
  f=await fixture(t,{nativeMail:true,mailCallbacks:{startMailRead:request=>{
    session={watchId:request.watchId,sessionId:'opaque-process-token'};
    const lease=f.app.startMailReadSession({accountRef:'desktop-qq-inbox',folder:'INBOX',expiresAt:request.expiresAt});
    const page=f.app.nextMailReadSession(lease.sessionId);readTaskId=page.page.task.taskId;
    f.host.bindMailRead(readTaskId,session);return session;
  },readMailStatus:()=>session?{sessionId:session.sessionId,state:status}:undefined,stopMailRead:()=>{session=undefined;}}});
  const started=await f.invoke('start',{source:'mail',intervalMs:1000,expiresAt:f.input().expiresAt});
  await f.host.tick();await idle(f.app);assert.equal(f.app.readHostToolTask(readTaskId).confirmed.result.items.length,0);
  assert.equal(f.host.resolveUserConversation(readTaskId),'desktop:main');
  assert.equal(f.host.readOrigin(readTaskId).taskId,started.task.taskId);
  status='complete';await f.host.tick();assert.equal(f.host.snapshot().watches[0].state,'monitoring');
  assert.equal(f.host.resolveUserConversation(readTaskId),'desktop:main','completed polling does not erase original notification authority');
  await f.invoke('stop',{watchId:started.result.result.watchId});assert.equal(f.host.readOrigin(readTaskId),undefined);
});

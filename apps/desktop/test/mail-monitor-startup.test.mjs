import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import {createMailMonitorPreparation} from '../electron/mail-monitor-preparation.js';
import {mountMailControls} from '../src/app/mail-controls.js';
import {authorizationDom} from '../test-support/authorization-dom.mjs';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createDesktopConnectorWatchHost} from '../electron/connector-watch-host.js';

const source=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let branch,adminClosed;
function visit(node){
  if(ts.isIfStatement(node)&&node.expression.getText(ast).includes("'mail.configure'")
    &&node.expression.getText(ast).includes("'mail.monitor.start'"))branch=node.getText(ast);
  if(ts.isCallExpression(node)&&node.expression.getText(ast)==='admin.on'&&node.arguments[0]?.text==='closed')
    adminClosed=node.arguments[1].getText(ast);
  ts.forEachChild(node,visit);
}visit(ast);assert.ok(branch&&adminClosed);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const invoke=new AsyncFunction('context','name','payload','sender','with(context){'+branch+'}');
const closeHandler=new Function('context','with(context){return ('+adminClosed+')}');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const owner=()=>Object.assign(new EventEmitter(),{destroyed:false,isDestroyed(){return this.destroyed;}});

// Execute the actual Main action with explicit synthetic service ports. No
// mailbox, cloud, model process, Policy grant or native notification is used.
function fixture(t,{ready=false,effective=true}={}){
  const preparation=createMailMonitorPreparation(),operations=[],starts=[],notifications=[],ticks=[];
  const configuration={configured:true,requiresRestart:false};
  const context={admin:owner(),competitionMode:true,runtimeClosed:false,runtimeApplication:{},mailMonitorPreparation:preparation,
    mailMonitorRequest:undefined,mailFailure:'',runtimeError:'',activeConnectorMailRead:undefined,manualMailReadConversationId:undefined,
    localServicesStopped:true,randomUUID,defaultNotificationSettings:{enabled:true},publish(){},
    conversations:{activeConversationId:()=> 'desktop-panel'},
    mailConfig:{snapshot:()=>({...configuration}),async configure(){configuration.requiresRestart=true;},async revoke(){configuration.configured=false;}},
    localLaya:{snapshot:()=>({ready}),start(){const work=deferred();starts.push(work);return work.promise;},stop(){throw Error('Shared Laya must not be stopped');}},
    mailHost:{snapshot:()=>({status:'disabled'}),retryClassification(){throw Error('Unexpected retry');}},
    notificationApplicationHost:{getInterruptionPolicy:()=>({effective,revision:1}),configureSettings(_input,control){
      const work=deferred();notifications.push({work,control});return work.promise;}},
    connectorWatchHost:{async tick(){if(ticks.length)await ticks.shift().promise;},requestFromSettings(operation,control){
      operations.push({operation,control});return {taskId:operation+'-'+operations.length,state:'created'};}},
  };
  context.mailSnapshot=()=>({configured:configuration.configured,requiresRestart:configuration.requiresRestart,
    monitoring:{state:preparation.hasPending()?'starting':'stopped',enabled:false}});
  context.admin.on('closed',closeHandler(context));
  t.after(()=>preparation.close());
  return {context,configuration,preparation,operations,starts,notifications,ticks,
    invoke:(name,payload,sender=context.admin)=>invoke(context,name,payload,sender)};
}

test('actual Main stop releases a pending model preparation and its late completion never starts a watch',async t=>{
  const f=fixture(t),starting=f.invoke('mail.monitor.start');await turn();assert.equal(f.starts.length,1);
  await f.invoke('mail.monitor.stop');await starting;
  assert.deepEqual(f.operations.map(item=>item.operation),['stop']);assert.equal(f.preparation.hasPending(),false);
  f.starts[0].resolve({ready:true});await turn();assert.deepEqual(f.operations.map(item=>item.operation),['stop']);
});

for(const stage of ['notification','tick'])test(`actual Main stop fences a late ${stage} completion`,async t=>{
  const f=fixture(t,{ready:true,effective:stage!=='notification'}),work=deferred();
  if(stage==='tick')f.ticks.push(work);
  const starting=f.invoke('mail.monitor.start');await turn();
  if(stage==='notification')assert.equal(f.notifications.length,1);
  await f.invoke('mail.monitor.stop');await starting;
  if(stage==='notification'){
    assert.equal(f.notifications[0].control.isCurrent(),false);f.notifications[0].work.resolve({state:'confirmed'});
  }else work.resolve();
  await turn();assert.deepEqual(f.operations.map(item=>item.operation),['stop']);
});

for(const action of ['mail.configure','mail.disable'])test(`${action} supersedes the original pending Main start`,async t=>{
  const f=fixture(t),starting=f.invoke('mail.monitor.start');await turn();await f.invoke(action,action==='mail.configure'?{}:undefined);await starting;
  f.starts[0].resolve({ready:true});await turn();assert.equal(f.operations.length,0);
  await f.invoke('mail.monitor.stop');assert.equal(f.operations[0].operation,'stop','Changed or revoked config cannot block stopping');
});

test('saving and revoking mail configuration do not depend on a loaded classification host',async t=>{
  const f=fixture(t);f.context.localLaya=undefined;
  await f.invoke('mail.configure',{});assert.equal(f.configuration.requiresRestart,true);
  await f.invoke('mail.disable');assert.equal(f.configuration.configured,false);
  await assert.rejects(f.invoke('mail.monitor.start'),/本地分类模型不可用/);
  await assert.rejects(f.invoke('mail.read'),/本地分类模型不可用/);
  assert.equal(f.operations.length,0);assert.equal(f.starts.length,0);
});

test('new settings cannot start the old mail configuration while an accepted save is still pending',async t=>{
  const f=fixture(t,{ready:true}),saved=deferred();
  f.context.mailConfig.configure=async()=>{await saved.promise;f.configuration.requiresRestart=true;};
  const saving=f.invoke('mail.configure',{});await turn();
  f.context.admin.destroyed=true;f.context.admin.emit('closed');f.context.admin=owner();
  let reads=0;f.context.mailHost.startBatch=()=>{reads++;};
  await assert.rejects(f.invoke('mail.read'),/配置.*更新/);assert.equal(reads,0);
  await assert.rejects(f.invoke('mail.monitor.start'),/配置.*更新/);
  assert.equal(f.operations.length,0);await f.invoke('mail.monitor.stop');const valid=f.operations[0].control.isCurrent;
  saved.resolve();await saving;assert.equal(valid(),true,'Completing a save must not revoke a later valid stop request');
  assert.equal(f.operations.some(item=>item.operation==='start'),false);
});

test('failed configuration completion releases its own busy state without clearing an unrelated error',async t=>{
  const f=fixture(t,{ready:true});f.context.mailConfig.configure=async()=>{throw Error('Synthetic configuration failure');};
  f.context.runtimeError='unrelated retained error';await assert.rejects(f.invoke('mail.configure',{}),/Synthetic configuration failure/);
  assert.equal(f.preparation.configurationPending(),false);assert.equal(f.context.runtimeError,'unrelated retained error');
  await f.invoke('mail.monitor.start');assert.equal(f.operations[0].operation,'start');
});

test('actual Main admin close cancels preparation and a replacement start retains its own pending state',async t=>{
  const f=fixture(t),first=f.invoke('mail.monitor.start');await turn();
  f.context.admin.destroyed=true;f.context.admin.emit('closed');await first;assert.equal(f.context.admin,undefined);
  f.context.admin=owner();const second=f.invoke('mail.monitor.start');await turn();assert.equal(f.starts.length,2);
  f.starts[0].reject(Error('synthetic old error'));await turn();assert.equal(f.preparation.hasPending(),true);assert.equal(f.context.mailFailure,'');
  f.starts[1].resolve({ready:true});await second;assert.deepEqual(f.operations.map(item=>item.operation),['start']);
});

test('shutdown cancels the original Main waiter without reading a closed Runtime snapshot',async t=>{
  const f=fixture(t),starting=f.invoke('mail.monitor.start');await turn();
  f.context.mailSnapshot=()=>{assert.equal(f.context.runtimeClosed,false,'Closed Runtime must not be read');return {};};
  f.context.runtimeClosed=true;f.preparation.close();
  assert.equal(await starting,undefined);f.starts[0].resolve({ready:true});await turn();assert.equal(f.operations.length,0);
});

test('actual Main request keeps its authorization fence after preparation, until stop or new intent',async t=>{
  const f=fixture(t,{ready:true});await f.invoke('mail.monitor.start');
  assert.equal(f.preparation.hasPending(),false);const first=f.operations[0].control.isCurrent;assert.equal(first(),true);
  await f.invoke('mail.monitor.start');assert.equal(first(),true,'Repeated start does not invalidate original approval');
  await f.invoke('mail.monitor.stop');assert.equal(first(),false);const stopped=f.operations.at(-1).control.isCurrent;assert.equal(stopped(),true);
  await f.invoke('mail.monitor.start');assert.equal(stopped(),false);
});

test('invalid/foreign stop cannot cancel the original preparation; valid stop needs no model or saved config',async t=>{
  const f=fixture(t),starting=f.invoke('mail.monitor.start');await turn();
  await assert.rejects(f.invoke('mail.monitor.stop',{}),/参数无效/);
  await assert.rejects(f.invoke('mail.monitor.stop',undefined,{}),/本项目设置/);assert.equal(f.preparation.hasPending(),true);
  f.context.mailConfig=undefined;f.context.localLaya=undefined;f.context.mailHost=undefined;
  await f.invoke('mail.monitor.stop');await starting;assert.equal(f.operations[0].operation,'stop');
  f.starts[0].resolve({ready:true});await turn();assert.equal(f.operations.length,1);
});

test('prepared settings start reaches original Runtime approval and confirmed watch; stop cancels a different pending start',async t=>{
  const base=resolve('.cache/mail-monitor-preparation-runtime');mkdirSync(base,{recursive:true});
  const file=join(mkdtempSync(join(base,'run-')),'runtime.sqlite'),namespace='synthetic-mail-settings-preparation';
  let app,unknownStop=false,unknownStopCalls=0;const f=fixture(t,{ready:true});
  const watches=createDesktopConnectorWatchHost({getApplication:()=>app,namespace,
    readSourceAuthorization:()=>({available:true,configurationRef:'synthetic-public-mail-config'}),
    resolveUserConversation:()=>undefined,isUserConversation:id=>['desktop-panel','desktop-alternate'].includes(id)});
  const tools=watches.tools.map(tool=>tool.descriptor.name!=='connector.watch.stop'?tool:{...tool,async execute(input,context){
    if(unknownStop){unknownStopCalls++;throw Error('Synthetic unknown stop outcome');}return tool.execute(input,context);
  }});
  app=createRuntimeApplication({path:file,profile:'huawei_ict_agentarts',hostUserNamespace:namespace,tools});
  const client=new Client(app);await client.connect();
  const until=async predicate=>{const end=Date.now()+5000;while(Date.now()<end){if(await predicate())return;await turn();}
    assert.fail('Original Runtime mail-settings task did not settle');};
  t.after(async()=>{await watches.close();await until(()=>app.activeTaskCount===0);app.close();});
  // This case checks settings/approval lifetimes; source polling is an explicit
  // no-op so it cannot read a mailbox while exercising the real watch host.
  f.context.runtimeApplication=app;f.context.connectorWatchHost={...watches,tick:async()=>{}};
  const unrelated=app.runtime.submitTask({goal:'Synthetic unrelated task',conversationId:'desktop-other',idempotencyKey:'unrelated'});
  await f.invoke('mail.monitor.start');const first=f.context.mailMonitorRequest.taskId;
  await until(()=>app.runtime.getTask(first).state==='waiting_approval');
  assert.equal(f.preparation.hasPending(),false);assert.equal(watches.snapshot().watches.length,0);
  const approval=app.runtime.listApprovals({taskId:first,state:'pending',limit:10}).items[0];assert.ok(approval);
  await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
  await until(()=>app.runtime.getTask(first).state==='succeeded');
  const record=app.runtime.readToolExecutions(first).find(item=>item.toolName==='connector.watch.start');
  assert.equal(record.state,'confirmed');assert.equal(record.policyDecision,'allow');assert.equal(record.executionStarted,true);
  assert.equal(watches.snapshot().watches.length,1);assert.equal(watches.snapshot().watches[0].enabled,true);
  assert.equal(watches.snapshot().watches[0].intervalMs,120000);
  await f.invoke('mail.monitor.stop');const stop=f.context.mailMonitorRequest.taskId;assert.ok(stop);
  await until(()=>app.runtime.getTask(stop).state==='waiting_approval');
  await f.invoke('mail.monitor.stop');assert.equal(f.context.mailMonitorRequest.taskId,stop,'Repeated Stop must reuse its original pending request');
  const stopApproval=app.runtime.listApprovals({taskId:stop,state:'pending',limit:10}).items[0];assert.ok(stopApproval);
  await client.call('authorization.respond',{approvalId:stopApproval.approvalId,expectedRevision:stopApproval.revision,decision:'allow_once'});
  await until(()=>['succeeded','failed','cancelled','waiting_reconciliation'].includes(app.runtime.getTask(stop).state));
  assert.equal(app.runtime.getTask(stop).state,'succeeded',JSON.stringify(app.runtime.getTask(stop).error));
  assert.equal(watches.snapshot().watches[0].enabled,false);
  await f.invoke('mail.monitor.start');const pending=f.context.mailMonitorRequest.taskId;
  await until(()=>app.runtime.getTask(pending).state==='waiting_approval');await f.invoke('mail.monitor.stop');
  await until(()=>app.runtime.getTask(pending).state==='cancelled');
  assert.equal(watches.snapshot().watches.some(watch=>watch.enabled),false);
  assert.equal(app.runtime.readToolExecutions(pending).some(item=>item.executionStarted),false);
  assert.equal(app.runtime.getTask(first).state,'succeeded','Stopping cannot rewrite the original confirmed task');
  await f.invoke('mail.monitor.start');const restarted=f.context.mailMonitorRequest.taskId;
  await until(()=>app.runtime.getTask(restarted).state==='waiting_approval');
  const restartApproval=app.runtime.listApprovals({taskId:restarted,state:'pending',limit:10}).items[0];
  await client.call('authorization.respond',{approvalId:restartApproval.approvalId,expectedRevision:restartApproval.revision,decision:'allow_once'});
  await until(()=>app.runtime.getTask(restarted).state==='succeeded');
  await f.invoke('mail.monitor.stop');const superseded=f.context.mailMonitorRequest.taskId;
  await until(()=>app.runtime.getTask(superseded).state==='waiting_approval');
  const oldApproval=app.runtime.listApprovals({taskId:superseded,state:'pending',limit:10}).items[0];
  await f.invoke('mail.monitor.start');await until(()=>app.runtime.getTask(superseded).state==='cancelled');
  await assert.rejects(client.call('authorization.respond',{approvalId:oldApproval.approvalId,expectedRevision:oldApproval.revision,decision:'allow_once'}));
  assert.equal(watches.snapshot().watches.some(watch=>watch.enabled),true,'A superseded Stop cannot retire the retained watch');
  assert.equal(app.runtime.readToolExecutions(superseded).some(item=>item.executionStarted),false);
  await f.invoke('mail.monitor.stop');const finalStop=f.context.mailMonitorRequest.taskId;assert.notEqual(finalStop,superseded);
  await until(()=>app.runtime.getTask(finalStop).state==='waiting_approval');
  const finalApproval=app.runtime.listApprovals({taskId:finalStop,state:'pending',limit:10}).items[0];
  await client.call('authorization.respond',{approvalId:finalApproval.approvalId,expectedRevision:finalApproval.revision,decision:'allow_once'});
  await until(()=>app.runtime.getTask(finalStop).state==='succeeded');assert.equal(watches.snapshot().watches.some(watch=>watch.enabled),false);
  await f.invoke('mail.monitor.start');const unknownOrigin=f.context.mailMonitorRequest.taskId;
  await until(()=>app.runtime.getTask(unknownOrigin).state==='waiting_approval');
  const originApproval=app.runtime.listApprovals({taskId:unknownOrigin,state:'pending',limit:10}).items[0];
  await client.call('authorization.respond',{approvalId:originApproval.approvalId,expectedRevision:originApproval.revision,decision:'allow_once'});
  await until(()=>app.runtime.getTask(unknownOrigin).state==='succeeded');unknownStop=true;
  const unknownWatchId=watches.snapshot().watches.find(watch=>watch.enabled).watchId;
  await f.invoke('mail.monitor.stop');const held=f.context.mailMonitorRequest.taskId;
  await until(()=>app.runtime.getTask(held).state==='waiting_approval');
  const heldApproval=app.runtime.listApprovals({taskId:held,state:'pending',limit:10}).items[0];
  await client.call('authorization.respond',{approvalId:heldApproval.approvalId,expectedRevision:heldApproval.revision,decision:'allow_once'});
  await until(()=>app.runtime.getTask(held).state==='waiting_reconciliation');
  const originalUnknown=app.runtime.getTask(held),originalRecords=app.runtime.readToolExecutions(held);
  await f.invoke('mail.monitor.start');
  assert.deepEqual(app.runtime.getTask(held),originalUnknown,'A new start cannot cancel or rewrite an unknown stop');
  await f.invoke('mail.monitor.stop');assert.equal(f.context.mailMonitorRequest.taskId,held);
  assert.equal(watches.requestFromSettings('stop',{conversationId:'desktop-alternate'}).taskId,held);
  assert.deepEqual(app.runtime.readToolExecutions(held),originalRecords);assert.equal(unknownStopCalls,1,'Unknown stop is never replayed');
  assert.deepEqual(app.runtime.getTask(held),originalUnknown);
  t.diagnostic('mail-monitor-cross-conversation-receipt:'+JSON.stringify({scenario:'unknown_stop_before_local_retirement',
    watchId:unknownWatchId,taskId:held,state:originalUnknown.state,stopCalls:unknownStopCalls,
    realMailboxReads:0,realModelCalls:0,originalRecordsUnchanged:true}));
  assert.equal(app.runtime.getTask(unrelated.taskId).state,'created');assert.notEqual(app.runtime.getTask(unrelated.taskId).cancelRequested,true);
  t.diagnostic('mail-monitor-runtime-receipt:'+JSON.stringify({kind:'actual_Runtime_Policy_SQLite_with_synthetic_service_ports',
    profile:'huawei_ict_agentarts',realMailboxReads:0,realModelCalls:0,unknownStopInjected:true,unknownStopCalls,
    tasks:[first,stop,pending,restarted,superseded,finalStop,unknownOrigin,held,unrelated.taskId].map(taskId=>({taskId,state:app.runtime.getTask(taskId).state,
      records:app.runtime.readToolExecutions(taskId).map(item=>({toolName:item.toolName,state:item.state,
        policyDecision:item.policyDecision,executionStarted:item.executionStarted,evidenceId:item.evidenceId}))}))}));
});

test('mail UI keeps stop and revoke available during preparation and discards stale start replies',async t=>{
  const dom=authorizationDom(),previous=globalThis.document;globalThis.document=dom.document;
  t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
  const requests=[],controls=mountMailControls(dom.root,(name,input)=>{const work=deferred();requests.push({name,input,work});return work.promise;});
  const state={configured:true,localModelReady:false,status:'disabled',monitoring:{state:'stopped',enabled:false}};
  controls.render(state);const field=name=>dom.root.querySelector(`[data-mail="${name}"]`);
  const starting=field('monitorStart').onclick();assert.equal(field('monitorStop').disabled,false);assert.equal(field('disable').disabled,false);
  const stopping=field('monitorStop').onclick();assert.equal(field('monitorStop').disabled,true);
  requests[1].work.resolve(state);await stopping;assert.equal(field('monitorStart').disabled,false);
  const fresh=field('monitorStart').onclick();requests[0].work.resolve({...state,monitoring:{state:'monitoring',enabled:true}});await starting;
  assert.equal(field('monitorStart').disabled,true,'An old finally cannot release the new start');
  requests[2].work.resolve({...state,monitoring:{state:'created',enabled:false}});await fresh;
  assert.match(field('monitorStatus').textContent,/正在准备监测/);assert.doesNotMatch(field('monitorStatus').textContent,/监测中/);
  controls.render({...state,monitoring:{state:'starting',enabled:false}});assert.equal(field('monitorStop').disabled,false);
  controls.render(state);const stale=field('monitorStart').onclick(),stopAgain=field('monitorStop').onclick();
  requests[4].work.resolve(state);await stopAgain;requests[3].work.reject(Error('SYNTHETIC_STALE_START_ERROR'));await stale;
  assert.doesNotMatch(field('status').textContent,/SYNTHETIC_STALE_START_ERROR/);assert.equal(field('monitorStart').disabled,false);
  controls.render({...state,configurationPending:true,localModelReady:true});
  assert.equal(field('monitorStart').disabled,true);assert.equal(field('save').disabled,true);assert.equal(field('read').disabled,true);
  assert.match(field('status').textContent,/配置正在更新/);
  assert.equal(field('disable').disabled,false,'Configuration preparation cannot disable revocation');
});

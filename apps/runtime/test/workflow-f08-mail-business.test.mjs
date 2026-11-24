import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@personal-agent/client';
import {QQMailProvider,register} from '@personal-agent/mail';
import {createRuntimeApplication,createRuntimeOwnedWorkflowHost,createWorkflowBusinessToolBridge} from '../dist/application.js';
import {createRuntimeF08MailSendHost,createRuntimeF08MailArchiveHost} from '../dist/application/workflow-f08-mail-graph-host.js';
import {createF08MailWorkflowPorts} from '../../desktop/electron/f08-mail-workflow-ports.js';

// Actual Runtime/SQLite/Policy/ToolGateway + registered SMTP tool and Desktop port.
// Graph input and SMTP transport are explicit fixtures; no real account/send occurs.
const wait=async check=>{for(let n=0;n<2000;n++){const value=check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,5));}
  assert.fail('Original F08 child did not settle');};
async function fixture(t,{unknown=false,archive=false}={}){
  let app,bridge,context,plan,sends=0;
  const time=Date.now(),deadline=new Date(time+60_000).toISOString(),mailTools=[];
  const provider=new QQMailProvider({user:'fixture@qq.com',authCode:'offline-never-used'});
  provider.transporter={async sendMail(input){sends++;if(unknown)throw Error('offline synthetic disconnect');return {messageId:input.messageId};},close(){}};
  const action=archive?'archive':'send',nodeId=archive?'F08_N03':'F08_N07';
  if(archive){let selected='INBOX',moved=false;
    provider.client={usable:true,capabilities:new Map([['MOVE',true],['UIDPLUS',true]]),mailbox:{uidValidity:19n},list:async()=>[{path:'Archive',specialUse:'\\Archive'}],close(){},
      async getMailboxLock(folder){selected=folder;provider.client.mailbox={uidValidity:folder==='INBOX'?19n:20n};return {release(){}};},
      async fetchOne(uid){return selected==='INBOX'&&moved?false:{uid:Number(uid),envelope:{messageId:'<original@example.invalid>'}};},
      async messageMove(){sends++;moved=true;return {path:'INBOX',destination:'Archive',uidValidity:20n,uidMap:new Map([[3,41]])};}};
  }
  register({register(tool){mailTools.push(tool);return ()=>{};}},{provider,accountRef:'fixture'});
  const args=archive?{account:'fixture',folder:'INBOX',uid:3,uidValidity:19,messageId:'<original@example.invalid>'}
    :{account:'fixture',to:'recipient@example.invalid',subject:'Fixture reply',text:'Synthetic body'};
  const ref={runtime:{loadCheckpoint:(...input)=>app.runtime.loadCheckpoint(...input),getTask:(...input)=>app.runtime.getTask(...input),
    saveCheckpointOnce:(...input)=>app.runtime.saveCheckpointOnce(...input)},readHostToolTask:(...input)=>app.readHostToolTask(...input),
    readConfiguredWorkflowBinding:()=>plan};
  const request={actionKey:'f08.mail.'+action,input:args};
  const ports=createF08MailWorkflowPorts({getApplication:()=>ref,bridge:{invoke:(...input)=>bridge.invoke(...input)},
    authorizeExport:async()=>true,now:()=>time});
  const business=mailTools.find(tool=>tool.descriptor.name==='mail.'+action),factory=archive?createRuntimeF08MailArchiveHost:createRuntimeF08MailSendHost;
  const invoke=archive?'invokeArchive':'invokeSend';
  const host=factory({...ports,application:ref,[archive?'mailArchive':'mailSend']:business,requiredScopes:['mail:'+action],now:()=>new Date(time),
    [invoke]:async(scope,input,ctx)=>{context=ctx;return ports[invoke](scope,input,ctx);}});
  assert.equal(host.unavailable,null);
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',hostUserNamespace:'f08-fixture',
    tools:[...mailTools,...host.tools],now:()=>new Date(time)});
  bridge=createWorkflowBusinessToolBridge({application:app,now:()=>new Date(time),assertCurrent:ports.assertCurrent,
    resolveTool:({actionKey,input})=>actionKey===request.actionKey?{workflowId:'F08',nodeId,hostToolName:host.tools[0].descriptor.name,
      toolName:business.descriptor.name,toolVersion:business.descriptor.version,arguments:input}:undefined});
  const client=new Client(app,()=>time);await client.connect();
  const parent=app.runtime.submitTask({goal:'Synthetic authorized email workflow',conversationId:'f08-fixture',idempotencyKey:'parent'});
  app.runtime.transitionTask(parent.taskId,'planning');app.runtime.transitionTask(parent.taskId,'running');
  plan={deadline,sessionId:'session',input:{[action]:args},confirmedOperations:archive?[{nodeId:'F08_N01',toolName:'mail.inbox',result:{items:[
    {source:'mail',accountRef:'fixture',externalId:'INBOX:3',dedupeKey:'fixture:19:INBOX:3:<original@example.invalid>'}]}}]:[]};
  const graph=createRuntimeOwnedWorkflowHost(app,{parentTaskId:parent.taskId,receiptSecret:'synthetic-f08-secret-at-least-thirty-two-characters',assertActive(){}});
  const source=graph.submit({taskId:parent.taskId,workflowId:'F08',sessionId:'session',controlRevision:0,deadline},
    {kind:'tool_proposal',nodeId,operationId:'original-'+action,originControlRevision:0,
      toolName:host.tools[0].descriptor.name,toolVersion:host.tools[0].descriptor.version,arguments:args});
  const decide=async(taskId,decision)=>{
    const read=await wait(()=>{const value=app.readHostToolTask(taskId);return value.task.state==='waiting_approval'?value:undefined;});
    await client.call('authorization.respond',{approvalId:read.approval.approvalId,expectedRevision:read.approval.revision,decision});
  };
  t.after(async()=>{for(const task of app.runtime.listTasks({limit:100}).items)if(!['succeeded','failed','cancelled'].includes(task.state))app.runtime.requestCancel(task.taskId);
    await wait(()=>app.activeTaskCount===0);app.close();await provider.dispose();});
  return {app,bridge,request,parent,source,ports,host,get context(){return context;},sends:()=>sends,async begin(){
    await decide(source.localTaskId,'allow_once');return wait(()=>context&&bridge.read(request,context));},decide,
    settle:()=>wait(()=>{const value=app.readHostToolTask(source.localTaskId);return ['succeeded','failed','cancelled','waiting_reconciliation'].includes(value.task.state)?value:undefined;})};
}

test('F08 production send waits for its own child approval and persists the exact send identity',async t=>{
  const f=await fixture(t),child=await f.begin();assert.equal(f.sends(),0);
  await f.decide(child.taskId,'allow_once');const result=await f.settle();assert.equal(result.task.state,'succeeded');assert.equal(f.sends(),1);
  assert.equal(result.confirmed.result.toolState,'confirmed');
  const original=f.app.runtime.loadCheckpoint(f.parent.taskId,'f08:original-send:session');
  assert.equal(original.taskId,child.taskId);assert.equal(original.runId,result.confirmed.result.idempotencyKey);
  assert.equal(original.messageId,result.confirmed.result.messageId);
  await f.bridge.invoke(f.request,f.context);assert.equal(f.sends(),1);
});

test('F08 denied child approval never reaches SMTP despite allowed outer graph operation',async t=>{
  const f=await fixture(t),child=await f.begin();await f.decide(child.taskId,'deny');await f.settle();assert.equal(f.sends(),0);
});

test('F08 unknown SMTP result stays bound to the original child and is not replayed',async t=>{
  const f=await fixture(t,{unknown:true}),child=await f.begin();await f.decide(child.taskId,'allow_once');
  const result=await f.settle();assert.equal(result.task.state,'succeeded');assert.equal(result.confirmed.result.toolState,'unknown');
  assert.ok(result.confirmed.result.messageId);await f.bridge.invoke(f.request,f.context);assert.equal(f.sends(),1);
});

test('F08 actual archive tool needs its own approval and reports only the MOVE readback',async t=>{
  const f=await fixture(t,{archive:true}),child=await f.begin();assert.equal(f.sends(),0);
  await f.decide(child.taskId,'allow_once');const result=await f.settle();assert.equal(result.task.state,'succeeded');
  assert.deepEqual(result.confirmed.result,{archiveOperationId:'original-archive',toolState:'confirmed'});
  await f.bridge.invoke(f.request,f.context);assert.equal(f.sends(),1);
});

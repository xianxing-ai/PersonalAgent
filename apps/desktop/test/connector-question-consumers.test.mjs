import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {HttpFeedProvider} from '@personal-agent/feeds';
import {FakeMailProvider} from '@personal-agent/mail';
import {createDesktopTodoHost} from '../electron/todo-host.js';
import {createDesktopFeedsHost} from '../electron/feeds-host.js';
import {createConnectorConversationTools} from '../electron/connector-conversation-tools.js';

const cache=new URL('../../../.cache/connector-question-consumers/',import.meta.url);mkdirSync(cache,{recursive:true});
const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()};
function runtime() {const records=new Map();return {runtime:{loadCheckpoint:(id,key)=>records.get(id+key),
  saveCheckpoint:(id,key,value)=>records.set(id+key,value),listSchedules:()=>[],getTask:()=>({state:'running',cancelRequested:false})},
  createHostStateStore:()=>({get:key=>records.get(key),set:(key,value)=>records.set(key,value)})};}

// Explicit Synthetic question service. It is not Runtime authorization or a persisted rule test.
function questions() {
  const prepared=new Map(),allowed=new Set(),resources=new Map();
  const key=scope=>JSON.stringify([scope.taskId,scope.runId]);
  const api={prepared,resources,
    prepare(scope,{requirements,assertCurrent}){const id=key(scope),entry=prepared.get(id)??{scope,requirements:[],guards:[]};
      entry.requirements.push(...requirements);if(assertCurrent)entry.guards.push(assertCurrent);prepared.set(id,entry);},
    prepareExport(scope,{requirementId}){api.prepare(scope,{requirements:[{requirementId,kind:'export'}]});},
    currentRequirement(scope,requirementId){const entry=prepared.get(key(scope));
      if(!entry||!allowed.has(key(scope))||scope.signal.aborted||scope.deadline!==entry.scope.deadline
        ||!entry.requirements.some(item=>item.requirementId===requirementId)||entry.guards.some(guard=>guard()!==true))throw Error('Synthetic exact question receipt unavailable');
      return true;},
    authorizeExport(scope,_result,id){api.currentRequirement(scope,id);},
    readResourceGeneration(resource){if(!resources.has(resource))resources.set(resource,randomUUID());return resources.get(resource);},
    rotateResourceGeneration(resource,expected){assert.equal(api.readResourceGeneration(resource),expected);const next=randomUUID();resources.set(resource,next);return next;},
    allow(scope){const entry=prepared.get(key(scope));assert.ok(entry);assert.ok(entry.guards.every(guard=>guard()===true));allowed.add(key(scope));},
    deny(scope){allowed.delete(key(scope));}};
  return api;
}
function operation(tool,args,id='synthetic-task') {
  const proposalId=randomUUID(),runId=randomUUID();return {taskId:id,runId,proposalId,toolName:tool.descriptor.name,
    toolVersion:tool.descriptor.version,deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal,
    scopes:tool.descriptor.requiredScopes,authorizationRef:'Synthetic original ToolGateway grant',
    proposal:{proposalId,toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,arguments:args}};
}

test('Synthetic Todo with old consent false can prepare one exact question but cannot execute or export before its receipt',async t=>{
  const question=questions(),host=createDesktopTodoHost({userData:mkdtempSync(new URL('todo-',cache)),safeStorage,namespace:'Synthetic',question,
    createDeliveryHost:()=>({async tick(){},async close(){}})});host.bindApplication(runtime());t.after(()=>host.close());
  const tool=host.tools.find(item=>item.descriptor.name==='todo.create'),input={title:'Synthetic laundry reminder',remindInMinutes:3},scope=operation(tool,input);
  const availability=host.competitionToolAvailability.find(item=>item.toolName===tool.descriptor.name),policy=host.competitionToolExports.find(item=>item.toolName===tool.descriptor.name);
  assert.equal(host.snapshot().sessionAllowed,false);assert.equal(availability.available(scope),true);
  host.prepareExport({...scope,phase:'preflight'});assert.equal(policy.accepts({...scope,arguments:input}),true);
  await assert.rejects(tool.execute(input,scope));assert.equal(host.snapshot().items.length,0);
  question.allow(scope);const result=await tool.execute(input,scope);assert.equal(host.snapshot().items.length,1);
  assert.equal(host.snapshot().sessionAllowed,false,'once receipt is never a global session toggle');
  assert.deepEqual(policy.project({...scope,result}),result);
  assert.equal(policy.accepts({...scope,arguments:input,phase:'final',projection:result}),true);
  assert.equal(policy.accepts({...scope,arguments:input,phase:'final',projection:{...result,extra:'not authorized'}}),false);
  await assert.rejects(tool.execute({...input,title:'Changed'},scope));
  await assert.rejects(tool.execute(input,{...scope,runId:'another-run'}));
  const previous=[...question.resources.values()][0];host.revoke();assert.notEqual([...question.resources.values()][0],previous);
  await assert.rejects(tool.execute(input,scope));assert.equal(policy.accepts({...scope,arguments:input,phase:'final',projection:result}),false);
  assert.throws(()=>host.authorize({readAndCloudConsent:true}),/提问卡/);
});

test('Synthetic Todo permanent resource identity survives normal close, while explicit revoke changes future rule binding',async()=>{
  const question=questions(),userData=mkdtempSync(new URL('todo-rule-',cache));
  const open=()=>{const host=createDesktopTodoHost({userData,safeStorage,namespace:'Synthetic stable namespace',question,
    createDeliveryHost:()=>({async tick(){},async close(){}})});host.bindApplication(runtime());return host;};
  const rule=host=>{const tool=host.tools.find(item=>item.descriptor.name==='todo.list'),scope=operation(tool,{},randomUUID());
    host.competitionToolAvailability.find(item=>item.toolName===tool.descriptor.name).available(scope);host.prepareExport({...scope,phase:'preflight'});
    return question.prepared.get(JSON.stringify([scope.taskId,scope.runId])).requirements.find(item=>item.requirementId==='todo-session').ruleBindingDigest;};
  let host=open();const first=rule(host);await host.close();host=open();assert.equal(rule(host),first);assert.equal(host.snapshot().sessionAllowed,false);
  host.revoke();assert.notEqual(rule(host),first);await host.close();
});

test('Synthetic Feeds receipt authorizes only its exact run; connector fetch stays at zero before choice and revoke blocks its result',async t=>{
  let calls=0;const question=questions(),provider=new HttpFeedProvider({fetchImpl:async()=>{
    calls++;return {status:200,headers:{get:()=>null},body:null,text:async()=>'<rss version="2.0"><channel><title>Synthetic</title><link>https://synthetic.invalid/</link><item><guid>one</guid><title>Synthetic update</title><link>https://synthetic.invalid/one</link><pubDate>Sun, 27 Sep 2026 08:00:00 GMT</pubDate><description>Synthetic summary</description></item></channel></rss>'};
  }}),host=createDesktopFeedsHost({userData:mkdtempSync(new URL('feeds-',cache)),safeStorage,provider,question});
  host.add({title:'Synthetic feed',url:'https://synthetic.invalid/feed'});host.prepare();host.bindApplication(runtime(),'Synthetic');t.after(()=>host.close());
  const tool=host.tools.find(item=>item.descriptor.name==='feeds.collect'),input={subscriptionId:host.snapshot().subscriptions[0].id,limit:1},scope=operation(tool,input);
  assert.equal(host.competitionToolAvailability.find(item=>item.toolName===tool.descriptor.name).available(scope),true);
  host.prepareExport({...scope,phase:'preflight'});await assert.rejects(tool.execute(input,scope));assert.equal(calls,0);
  question.allow(scope);const result=await tool.execute(input,scope);assert.equal(calls,1);assert.equal(result.items[0].title,'Synthetic update');
  const policy=host.competitionToolExports.find(item=>item.toolName===tool.descriptor.name);assert.deepEqual(policy.project({...scope,result}),result);
  assert.equal(host.snapshot().sessionAllowed,false);question.deny(scope);
  assert.throws(()=>policy.project({...scope,result}));await assert.rejects(tool.execute(input,scope));assert.equal(calls,1);
  question.allow(scope);host.revoke();await assert.rejects(tool.execute(input,scope));assert.equal(calls,1);
});

test('Synthetic mail/calendar conversation tools keep configuration and exact result gates without a legacy native dialog',async t=>{
  const question=questions();let providers=0;
  const host=createConnectorConversationTools({question,mail:{current:()=>({user:'synthetic@qq.com',authCode:'SyntheticPrivateAuthCode',revision:1})},
    getApplication:()=>runtime(),resolveConversation:()=> 'Synthetic canonical conversation',createMailProvider:()=>{providers++;return new FakeMailProvider();}});
  t.after(()=>host.close());const tool=host.tools.find(item=>item.descriptor.name==='mail.accounts'),scope=operation(tool,{}),policy=host.competitionToolExports.find(item=>item.toolName===tool.descriptor.name);
  assert.equal(await host.competitionToolAvailability.find(item=>item.toolName===tool.descriptor.name).available(scope),true);
  await host.prepareExport({...scope,phase:'preflight'});await assert.rejects(tool.execute({},scope));assert.equal(providers,0);
  question.allow(scope);await assert.rejects(tool.execute({extra:'different'},scope));assert.equal(providers,0);
  const result=await tool.execute({},scope);assert.equal(providers,1);assert.deepEqual(await policy.project({...scope,result}),result);
  assert.equal(policy.accepts({...scope,arguments:{},phase:'final',projection:result}),true);
  assert.equal(policy.accepts({...scope,arguments:{},phase:'final',projection:{...result,extra:'private'}}),false);
  await host.invalidate('mail');await assert.rejects(tool.execute({},scope));assert.equal(providers,1);
});

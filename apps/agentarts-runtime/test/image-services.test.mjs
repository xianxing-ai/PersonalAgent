import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentServer} from '../src/server.mjs';
import {createImageServices} from '../src/image-services.mjs';
import {OwnedWorkflowEngine,OwnedWorkflowHostBridge,createOwnedWorkflowReceiptVerifier,
 getOwnedWorkflowBindings,getOwnedWorkflowTemplate} from '@personal-agent/agentarts';
const token='public-fixture-inner-credential-at-least-32-bytes';
// Fixed test-only markers survive a native worker exit; never print request
// values, credentials, addresses, environment or command lines.
const phase=state=>process.stderr.write(JSON.stringify({phase:'image-services-fixture',state})+'\n');
phase('module-ready');
async function host(t,options={}) {
 const server=createAgentServer({orchestrator:{invoke:async()=>{throw Error('No model fallback');}},mode:'standalone-validation',
  authToken:token,wssAuthToken:token,...options});
 server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 phase('server-listening');
 t.after(()=>new Promise(resolve=>{phase('server-close');server.close(()=>{phase('server-closed');resolve();});}));
 const url='http://127.0.0.1:'+server.address().port;
 return {url,post:value=>{phase('request');return fetch(url+'/invocations',{method:'POST',headers:{'content-type':'application/json',
  'x-pa-agent-token':'Bearer '+token,'x-hw-agentarts-session-id':'fixture-session','x-request-id':'fixture-request'},
  body:JSON.stringify({query:JSON.stringify(value)})});}};
}
const answer=async response=>JSON.parse((await response.json())[0].data.text);
test('composed service entry exposes exact missing ports and never turns authenticated transport into tool permission',async t=>{
 phase('platform-case-start');
 const services=createImageServices();t.after(()=>services.close());
 const {post}=await host(t,{serviceControllers:services.controllers});
 const listed=await answer(await post({platformVersion:1,operation:'list'}));
 assert.equal(listed.verification,'unverified');assert.equal(listed.status.mcp.state,'unavailable');
 assert.equal(listed.status.knowledge.state,'unavailable');
 assert.ok(listed.status.toolExecution.missingConfiguration.includes('existing Runtime toolExecutionPort'));
 const refused=await post({platformVersion:1,operation:'knowledge.search',query:'public fixture',limit:1});
 assert.equal(refused.status,503);
 const disabled=await post({shadowVersion:1,operation:'evaluate'});assert.equal(disabled.status,503);
 const mixed=await post({platformVersion:1,testVersion:1,operation:'list'});assert.equal(mixed.status,400);
 const injection=await post({platformVersion:1,operation:'list',apiKey:'must-not-be-used'});assert.equal(injection.status,400);
});
test('actual HTTP advance forwards signed pause/controller/user controls and fixed task lifetime',async t=>{
 phase('workflow-case-start');
 const secret=token,engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:secret,
  selector:{select:async()=> 'review'},prepareCandidates:async()=>[{id:'review',description:'Explicit fixture refuses work',value:null,abstain:true}],
  receiptVerifier:createOwnedWorkflowReceiptVerifier({secret})});
 const orchestrator={invoke:async()=>{throw Error('No fallback');},getBindings:()=>[],
  invokeWorkflow:async()=>{throw Error('No legacy workflow');},invokeController:async()=>{throw Error('No legacy controller');},
  getOwnedWorkflowCatalog:getOwnedWorkflowBindings,getOwnedWorkflowTemplate,
  invokeOwnedWorkflow:request=>engine.advance(request)};
 const bridge=new OwnedWorkflowHostBridge({receiptSecret:secret,host:{},checkpoints:{},assertActive(){}});
 const {post,url}=await host(t,{orchestrator});
 const directory=await (await fetch(url+'/bindings',{headers:{'x-pa-agent-token':'Bearer '+token}})).json();
 assert.ok(directory.controls.actions.includes('request_controller'));
 const original={workflowVersion:'1.0.0',operation:'advance',workflowId:'F20',taskId:'fixture-task',controlRevision:1,
  input:{fixture:true},availableTools:[],taskDeadline:new Date(Date.now()+120000).toISOString()};
 let state=await answer(await post(original));
 for(const [index,action] of ['pause','notify_controller','resume','request_controller','continue','request_user'].entries()){
  const request={...original,sessionId:'fixture-session',checkpoint:state.checkpoint};
  const control=bridge.control(request,{commandId:'control-'+index,action});
  const response=await post({...original,checkpoint:state.checkpoint,hostControl:control});
  assert.equal(response.status,200);state=await answer(response);
  assert.equal(state.hostControl.events.at(-1).action,action);
  if(action==='pause'||action==='notify_controller')assert.equal(state.state,'paused');
  if(action==='request_controller')assert.equal(state.state,'awaiting_controller');
  if(action==='request_user')assert.equal(state.state,'awaiting_user');
 }
 const bad=await post({...original,checkpoint:state.checkpoint,taskDeadline:new Date(Date.now()+200000).toISOString()});
 assert.equal(bad.status,400);
 assert.equal(state.verification,'unverified');
});

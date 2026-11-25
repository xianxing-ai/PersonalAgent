import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflowExportConsent} from '../electron/workflow-export-consent.js';

function setup(confirm) {
  const controller=new AbortController(),deadline=new Date(Date.now()+60000).toISOString();
  const state={task:{state:'running',cancelRequested:false},proposal:{toolName:'workflow.todo.create',proposalId:'original'},
    deadline,deployment:'fixed-v1',destination:'agentarts-fixed'};
  const app={runtime:{getTask:()=>state.task,loadCheckpoint:(_id,key)=>key==='application-deadline'?state.deadline:{pending:state.proposal}},
    readAuthorizationQuestionDestination:()=>state.destination};
  const calls=[];
  const authorize=createWorkflowExportConsent({getApplication:()=>app,readDeploymentBinding:()=>state.deployment,
    confirmAuthorization:async(...args)=>{calls.push(args);return confirm?confirm(state,args):true;}});
  const request={taskId:'original',workflowId:'F06',stage:'initial',value:{todoTitle:'Synthetic task'},deadline,signal:controller.signal};
  return {authorize,request,state,calls,controller};
}

test('graph export requires the exact original destination, pending proposal and bounded payload',async()=>{
  const f=setup();assert.equal(await f.authorize(f.request),true);
  const [action,payload,options]=f.calls[0];assert.equal(action,'workflow.export');assert.deepEqual(payload,f.request.value);
  assert.equal(options.scope.taskId,'original');assert.equal(options.scope.workflowId,'F06');assert.equal(options.isCurrent(),true);
  f.state.deployment='changed';assert.equal(options.isCurrent(),false);
});

for(const mode of ['deny','truthy','cancel','terminal','deadline','destination','proposal','deployment','payload'])
test(`graph export refuses ${mode} across asynchronous consent`,async()=>{
  let f;f=setup(async(state,args)=>{
    await Promise.resolve();
    if(mode==='deny')return false;if(mode==='truthy')return {allowed:true};
    if(mode==='cancel')f.controller.abort();if(mode==='terminal')state.task.state='succeeded';
    if(mode==='deadline')state.deadline=new Date().toISOString();if(mode==='destination')state.destination='foreign';
    if(mode==='proposal')state.proposal={...state.proposal,proposalId:'foreign'};if(mode==='deployment')state.deployment='other';
    if(mode==='payload')args[1].todoTitle='replaced';return true;
  });assert.equal(await f.authorize(f.request),false);
});

test('missing fixed deployment, oversized data and foreign graph are refused before opening a card',async()=>{
  for(const mode of ['deployment','size','graph']){
    const f=setup();if(mode==='deployment')f.state.deployment='';if(mode==='size')f.request.value={data:'x'.repeat(512*1024)};
    if(mode==='graph')f.request.workflowId='F99';assert.equal(await f.authorize(f.request),false);assert.equal(f.calls.length,0);
  }
});

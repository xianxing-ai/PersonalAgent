import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AuthorizationQuestions,createRuntimeApplication} from '@personal-agent/runtime/application';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {createDesktopAuthorizationIntentHost,AUTHORIZATION_INTENT_TOOL} from '../electron/authorization-intent-host.js';
import {createF01ContextSelectionHost} from '../electron/f01-context-selection-host.js';
import {createProactiveHostProofs} from '@personal-agent/agentarts-runtime/proactive-controller';
import {createDesktopProactiveWorkflowApplication} from '../electron/proactive-workflow-host.js';

// Actual Intent/Policy/SQLite decisions. The graph/session/Fact setup is Synthetic.
test('F01 source selection requires the exact original native decision and cannot reuse it after Fact withdrawal',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'pa-f01-selection-'));let app,host,question,current=true;
  question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>app,
    namespace:'f01-selection',resolveConversation:()=> 'Synthetic original conversation',available:()=>true,
    profiles:[{ref:'app',label:'Synthetic app policy',mode:'workspace-write',revision:1,available:true}],defaultProfileRef:'app'});
  host=createDesktopAuthorizationIntentHost({getApplication:()=>app,question,openConversation(){}});
  app=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'f01-selection',
    tools:[host.tool],hostOnlyTools:[AUTHORIZATION_INTENT_TOOL],proactiveWorkflows:true,requiresToolAuthorization:()=>true,
    requestToolAuthorization:scope=>{host.prepareQuestion(scope);return question.requestToolAuthorization(scope);}});
  t.after(async()=>{host.close();question.close();app.close();await rm(directory,{recursive:true,force:true});});
  const source=app.runtime.submitTask({goal:'Synthetic original Fact selection',conversationId:'original',idempotencyKey:'source'});
  const graph=app.runtime.submitTask({goal:'Synthetic F01 graph',conversationId:'graph',idempotencyKey:'graph'});
  const deadline=new Date(Date.now()+60000).toISOString(),sessionId='original-f01';
  const proofs=createProactiveHostProofs('synthetic-f01-selection-receipt-secret-32-chars');
  const contract={id:'synthetic',version:'1',qualifiedForMain:false,batchIndependent:true,criteria:'Synthetic fixture',candidates:[{id:'defer',description:'Preserve original work',action:'defer'}]};
  app.startProactiveTask=()=>{};
  const proactive=createDesktopProactiveWorkflowApplication({application:app,localDeviceAvailable:()=>true,
    readConfiguration:()=>({contractRef:contract.id,adapter:{endpoint:'synthetic'}}),
    createAdapter:()=>({describe:async()=>({contracts:[contract]}),advancePort:async()=>{throw Error('No cloud call');},verifyAdvance:()=>false,sign:(kind,value,binding)=>proofs.sign(kind,value,binding)})});
  const target=await proactive.start({sourceTaskId:source.taskId,commandId:'start-original',taskDeadline:deadline});
  const binding={taskId:graph.taskId,sessionId,deadline,configurationDigest:'Synthetic exact configured binding',input:{context:{fact:{id:'public',revision:1},responsibilitySession:{taskId:target.taskId,sessionId:target.sessionId}}}};
  app.readF01ContextBinding=()=>({binding,user:{taskId:source.taskId,conversationId:'original',deadline},destination:'synthetic-fixed-destination'});
  app.readDelegatedUserTaskParent=()=>({taskId:source.taskId,conversationId:'original',deadline});
  const fact={ref:{id:'public',revision:1},sourceRef:'public-source',sensitivity:'public',state:'active'};
  const memory={memoryNamespace:'public-only',facts:{readCurrentPublicFact:()=>current?fact:undefined}};
  const selection=createF01ContextSelectionHost({getApplication:()=>app,getPublicFactHost:()=>memory,getAuthorizationIntentHost:()=>host,readDeploymentBinding:()=> 'fixed'});
  const scope={parentTaskId:graph.taskId,sessionId,deadline,signal:new AbortController().signal};
  const pending=selection.prepare(scope);let card;const end=Date.now()+5000;
  while(Date.now()<end&&!card){card=question.snapshot().find(item=>item.state==='pending');if(!card)await new Promise(resolve=>setTimeout(resolve,5));}
  assert.ok(card);question.respond({questionId:card.questionId,expectedRevision:card.revision,decision:'allow_once'},card.conversationId);
  assert.equal(await pending,true);const count=app.runtime.listTasks({limit:20}).items.length;
  assert.deepEqual(await selection.resolveQuery(scope),{factId:'public',sourceRef:'public-source',limit:1});
  assert.equal(await selection.prepare(scope),true);assert.equal(app.runtime.listTasks({limit:20}).items.length,count);
  current=false;assert.throws(()=>selection.assertCurrent(scope),error=>error.code==='UNAUTHORIZED');
  await assert.rejects(selection.prepare(scope),error=>error.code==='UNAUTHORIZED');assert.equal(app.runtime.listTasks({limit:20}).items.length,count);
});

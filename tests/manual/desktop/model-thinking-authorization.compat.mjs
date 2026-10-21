// Explicit cross-PR manual integration: requires the merged #491 + #484 sources.
// Run with node --test; this file is not a claim that either standalone PR CI ran it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {AuthorizationQuestions,createRuntimeApplication} from '@personal-agent/runtime/application';
import {createDesktopAuthorizationQuestionHost} from '../../../apps/desktop/electron/authorization-question-host.js';
import {createDesktopTodoHost} from '../../../apps/desktop/electron/todo-host.js';
import {createAgentArtsModelSettings,readDesktopExecutionModel} from '../../../apps/desktop/electron/agentarts-model-settings.js';
import {Conversations} from '../../../apps/desktop/electron/conversations.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const wait=async check=>{for(let n=0;n<300;n++){const value=check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Cross-PR authorization did not settle');};

test('actual default/manual task model binding scopes once, permanent and exact export leases to the original destination',async()=>{
  const cache=new URL('../../../.cache/model-picker-authorization-compat/',import.meta.url);mkdirSync(cache,{recursive:true});
  const directory=mkdtempSync(new URL('case-',cache)),namespace='Synthetic model authorization',conversationId='Synthetic-model-conversation';
  const revision='a'.repeat(64),initialPreferences={catalogRevision:revision,defaultModelId:'deepseek-v4.1-flash',defaultSubmodelId:'qwen3.8-max',reasoningEffort:'medium',submodelReasoningEffort:'max'};
  let preferences=structuredClone(initialPreferences),app,durable;
  const models=createAgentArtsModelSettings({configuration:{snapshot:()=>({gatewayUrl:'https://synthetic.invalid',runtimeName:'compat',deploymentVersion:'1'}),
    readModelPreferences:()=>preferences,saveModelPreferences:value=>{preferences=value;}},readCatalog:async()=>({version:'1.0',revision,defaultModelId:'deepseek-v4.1-flash',models:[
      {id:'deepseek-v4.1-flash',displayName:'Synthetic primary',type:'text',availability:'unverified',requestProfile:'standard',reasoningEfforts:['low','medium','high']},
      {id:'qwen3.8-max',displayName:'Synthetic submodel',type:'text',availability:'unverified',requestProfile:'standard',reasoningEfforts:['max']},
    ]})});
  await models.refresh();
  const conversations=new Conversations(),exports=[];
  conversations.setPreference(conversationId,{modelSelection:'default',depth:1,fast:false});
  const question=createDesktopAuthorizationQuestionHost({createQuestions:options=>{durable=options.store;return new AuthorizationQuestions(options);},getApplication:()=>app,
    namespace,resolveConversation:taskId=>app.runtime.getTask(taskId).conversationId,available:()=>true,
    profiles:[{ref:'application',label:'Synthetic local application policy; no native process',mode:'workspace-write',revision:1,available:true}],defaultProfileRef:'application'});
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()}; // Explicit Fake encryption only.
  const todo=createDesktopTodoHost({userData:directory,safeStorage,namespace,question,createDeliveryHost:()=>({async tick(){},async close(){}})});
  app=createRuntimeApplication({path:path.join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:namespace,tools:todo.tools,
    competitionToolAvailability:todo.competitionToolAvailability,competitionToolExports:todo.competitionToolExports,
    prepareCompetitionToolExport:scope=>todo.prepareExport(scope),requiresToolAuthorization:scope=>question.requiresAuthorization(scope),requestToolAuthorization:scope=>question.requestToolAuthorization(scope),
    readConversationPreference:id=>{const selected=conversations.preference(id);return {...selected,executionModel:readDesktopExecutionModel(models,selected)};},
    readDefaultExecutionModel:role=>readDesktopExecutionModel(models,undefined,role),resolveExecutionModel:input=>models.resolveExecutionModel(input),
    coordination:{async execute(request){
      if(request.continuation){exports.push({taskId:request.taskId,continuation:structuredClone(request.continuation)});return {kind:'text',text:'Synthetic confirmed result',verification:'mock'};}
      const name=request.goal.startsWith('list ')?'todo.list':'todo.create',tool=todo.tools.find(item=>item.descriptor.name===name);
      return {kind:'tool_proposal',proposalId:'synthetic-'+request.taskId,toolName:name,toolVersion:tool.descriptor.version,
        arguments:name==='todo.list'?{}:{title:request.goal},verification:'unverified'};
    }}});
  todo.bindApplication(app);const client=new Client(app);await client.connect();
  const submit=(goal,key)=>client.call('task.submit',{goal,conversationId},{idempotencyKey:key});
  const pending=id=>question.snapshot().find(item=>item.taskId===id&&item.state==='pending');
  const settled=id=>wait(()=>['succeeded','failed','cancelled','waiting_reconciliation'].includes(app.runtime.getTask(id).state));
  const decide=(card,decision)=>question.respond({questionId:card.questionId,expectedRevision:card.revision,decision},card.conversationId);
  const exportRequirement=id=>durable.get('state').questions.find(item=>item.taskId===id).requirements.find(item=>item.kind==='export');
  const confirmed=(id,card)=>{
    const record=app.runtime.readToolExecutions(id).find(item=>item.toolName==='todo.create');assert.equal(record.state,'confirmed');assert.equal(record.executionStarted,true);
    assert.equal(app.runtime.policy.get(record.evidenceId).usesRemaining,0);
    const lease=app.runtime.loadCheckpoint(id,'authorization-question-export:'+record.evidenceId+':todo-export');
    assert.equal(lease.questionId,card.questionId);assert.match(lease.leaseRef,/\S/);
    assert.equal(lease.resultDigest,hash(exports.find(item=>item.taskId===id).continuation.result));return lease;
  };
  try{
    assert.equal(todo.snapshot().sessionAllowed,false,'no Settings/session permission is required or silently enabled');
    const first=await submit('Synthetic default once','default-once'),firstCard=await wait(()=>pending(first.taskId));
    const qwen={catalogRevision:revision,modelId:'qwen3.8-max',reasoningEffort:'max'};
    assert.deepEqual(app.runtime.loadCheckpoint(first.taskId,'execution-model'),qwen);
    const firstDestination=app.readAuthorizationQuestionDestination(first.taskId);
    assert.equal(todo.snapshot().items.length,0);assert.equal(exports.length,0);
    assert.deepEqual(firstCard.requirements.map(item=>item.kind),['tool','connector_session','export']);
    decide(firstCard,'allow_once');await settled(first.taskId);assert.equal(app.runtime.getTask(first.taskId).state,'succeeded');confirmed(first.taskId,firstCard);

    const manual=models.resolveExecutionModel({catalogRevision:revision,modelId:'deepseek-v4.1-flash',reasoningEffort:'high'});
    conversations.setPreference(conversationId,{executionModel:manual,depth:4,fast:false});
    const second=await submit('Synthetic manual permanent','manual-permanent'),secondCard=await wait(()=>pending(second.taskId));
    assert.deepEqual(app.runtime.loadCheckpoint(second.taskId,'execution-model'),manual);
    assert.notEqual(app.readAuthorizationQuestionDestination(second.taskId),firstDestination);
    assert.equal(app.readAuthorizationQuestionDestination(first.taskId),firstDestination,'new conversation settings cannot rebind the original task');
    assert.notEqual(exportRequirement(first.taskId).ruleBindingDigest,exportRequirement(second.taskId).ruleBindingDigest);
    assert.equal(todo.snapshot().items.length,1);assert.equal(exports.length,1,'the old once decision cannot send or execute a new operation');
    assert.throws(()=>decide(firstCard,'allow_once'));decide(secondCard,'allow_always');await settled(second.taskId);assert.equal(app.runtime.getTask(second.taskId).state,'succeeded');confirmed(second.taskId,secondCard);

    const third=await submit('Synthetic same destination new exact run','manual-derived');await settled(third.taskId);
    assert.equal(app.runtime.getTask(third.taskId).state,'succeeded');assert.equal(pending(third.taskId),undefined);
    const derivedCard=question.snapshot().find(item=>item.taskId===third.taskId);confirmed(third.taskId,derivedCard);
    assert.equal(app.readAuthorizationQuestionDestination(third.taskId),app.readAuthorizationQuestionDestination(second.taskId));

    conversations.setPreference(conversationId,{modelSelection:'default',depth:1,fast:false});
    const fourth=await submit('Synthetic default after manual permanent','default-new-destination'),fourthCard=await wait(()=>pending(fourth.taskId));
    assert.deepEqual(app.runtime.loadCheckpoint(fourth.taskId,'execution-model'),qwen);
    assert.notEqual(exportRequirement(second.taskId).ruleBindingDigest,exportRequirement(fourth.taskId).ruleBindingDigest);
    assert.equal(todo.snapshot().items.length,3);assert.equal(exports.length,3,'another destination must not inherit the manual permanent export decision');
    decide(fourthCard,'deny');await settled(fourth.taskId);assert.equal(app.runtime.getTask(fourth.taskId).state,'cancelled');

    conversations.setPreference(conversationId,{executionModel:manual,depth:4,fast:false});
    const fifth=await submit('list Synthetic new tool scope','new-tool'),fifthCard=await wait(()=>pending(fifth.taskId));
    assert.equal(fifthCard.toolName,'todo.list');assert.notDeepEqual(fifthCard.requirements.find(item=>item.kind==='tool').scopes,secondCard.requirements.find(item=>item.kind==='tool').scopes);
    assert.equal(exports.length,3,'a permanent create decision cannot authorize another tool/scope');decide(fifthCard,'deny');await settled(fifth.taskId);
    assert.equal(todo.snapshot().sessionAllowed,false);assert.deepEqual(preferences,initialPreferences);
    console.log(JSON.stringify({receipt:'model-thinking-authorization-compat',realModels:0,realAccounts:0,syntheticCoordination:true,
      tasks:5,confirmedExactToolAndExportRuns:3,shownCards:4,sameDestinationPermanentDerivation:true,changedDestinationReasked:true,newToolScopeReasked:true,settingsPrecondition:false}));
  }finally{
    for(const item of app.runtime.listTasks({limit:100}).items)if(!['succeeded','failed','cancelled'].includes(item.state))app.runtime.requestCancel(item.taskId,'Synthetic cleanup');
    question.close();await wait(()=>app.activeTaskCount===0);await todo.close();app.close();
  }
});

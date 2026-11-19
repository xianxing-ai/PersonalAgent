import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {AuthorizationQuestions,createRuntimeApplication} from '@personal-agent/runtime/application';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {createDesktopAuthorizationIntentHost,AUTHORIZATION_INTENT_TOOL} from '../electron/authorization-intent-host.js';
import {createF04RecoveryExportConsent} from '../electron/f04-recovery-export-consent.js';

// Original F04 binding provider is Synthetic here; the F04 Runtime suite covers
// its real persisted source graph. Intent, native question, Runtime and Policy are actual.
async function fixture(t,afterConfirm){
  const directory=await mkdtemp(join(tmpdir(),'pa-f04-native-export-'));let app;
  const controller=new AbortController(),deadline=new Date(Date.now()+60000).toISOString(),args={sourceId:'synthetic',configRevision:1,path:'note.md'};
  const state={deployment:'fixed-deployment',binding:{workflowId:'F04',taskId:'graph',localTaskId:'host',sourceTaskId:'source',sourceRunId:'host-tool-source',
    sessionId:'session',operationId:'original-operation',proposalId:'original-child-command',argumentsDigest:toolArgumentsDigest(args),
    configurationDigest:'a'.repeat(64),sourceConfigurationDigest:'b'.repeat(64),observationDigest:'c'.repeat(64),observationEvidenceId:'readback',deadline,
    projection:{state:'applied',changed:true},rootTaskId:'original-user',rootRevision:7,conversationId:'original-chat',destination:'fixed-destination'}};
  const question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>app,
    namespace:'f04-native-export',resolveConversation:()=> 'original-chat',available:()=>true,
    profiles:[{ref:'synthetic',label:'Synthetic application profile',mode:'workspace-write',revision:1,available:true}],defaultProfileRef:'synthetic'});
  const intent=createDesktopAuthorizationIntentHost({getApplication:()=>app,question,openConversation(){}});
  app=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'f04-native-export',tools:[intent.tool],
    hostOnlyTools:[AUTHORIZATION_INTENT_TOOL],requiresToolAuthorization:()=>true,
    requestToolAuthorization:scope=>{intent.prepareQuestion(scope);return question.requestToolAuthorization(scope);}});
  app.readF04RecoveredWriteExport=()=>structuredClone(state.binding);
  const calls=[],helper=createF04RecoveryExportConsent({getApplication:()=>app,readDeploymentBinding:()=>state.deployment,
    confirmAuthorization:async(action,payload,options)=>{calls.push({action,payload,options});const allowed=await intent.request({action,payload,...options});
      await afterConfirm?.({state,payload,options,controller});return allowed;}});
  const request={phase:'projection',taskId:'source',runId:'host-tool-source',deadline,signal:controller.signal,
    proposal:{kind:'tool_proposal',proposalId:'original-child-command',toolName:'knowledge.apply_note_patch',toolVersion:'1.0.0',arguments:args,verification:'unverified'}};
  t.after(async()=>{intent.close();question.close();app.close();await rm(directory,{recursive:true,force:true});});
  async function decide(promise,decision='allow_once'){
    const settled=promise.then(value=>({value}),error=>({error}));let card;const end=Date.now()+5000;
    while(Date.now()<end&&!card){card=question.snapshot().find(item=>item.state==='pending');if(!card)await new Promise(resolve=>setTimeout(resolve,5));}
    assert.ok(card);question.respond({questionId:card.questionId,expectedRevision:card.revision,decision},card.conversationId);
    return {card,...await settled};
  }
  return {app,helper,request,state,calls,decide,controller};
}

test('fresh recovery export uses one actual native intent and records only its decision',async t=>{
  const f=await fixture(t),result=await f.decide(f.helper.prepare(f.request));assert.equal(result.value,true);assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].action,'workflow.export');assert.deepEqual(f.calls[0].payload,{state:'applied',changed:true});
  assert.equal(f.calls[0].options.scope.observationDigest,'c'.repeat(64));assert.equal(f.calls[0].options.scope.deployment,'fixed-deployment');
  assert.deepEqual(f.app.readHostToolTask(result.card.taskId).confirmed.result,{decisionRecorded:true});
  assert.equal(f.app.runtime.listTasks({limit:10}).items.length,1,'no business tool or graph was scheduled');
});
test('denied native recovery export remains rejected without a business execution',async t=>{
  const f=await fixture(t),result=await f.decide(f.helper.prepare(f.request),'deny');assert.equal(result.error.code,'UNAUTHORIZED');
  assert.equal(f.app.runtime.getTask(result.card.taskId).state,'cancelled');assert.equal(f.app.runtime.listTasks({limit:10}).items.length,1);
});
for(const mode of ['source','observation','deployment','destination','root','payload','cancel'])test('recovery export refuses '+mode+' changes after the actual native decision',async t=>{
  const f=await fixture(t,async({state,payload,controller})=>{await Promise.resolve();
    if(mode==='source')state.binding.sourceConfigurationDigest='d'.repeat(64);if(mode==='observation')state.binding.observationDigest='e'.repeat(64);
    if(mode==='deployment')state.deployment='replacement';if(mode==='destination')state.binding.destination='replacement';
    if(mode==='root')state.binding.rootRevision++;
    if(mode==='payload')payload.changed=false;if(mode==='cancel')controller.abort();});
  const result=await f.decide(f.helper.prepare(f.request));assert.equal(result.error.code,'UNAUTHORIZED');
  assert.deepEqual(f.app.readHostToolTask(result.card.taskId).confirmed.result,{decisionRecorded:true},'a recorded decision does not override the final scope fence');
});
test('ordinary tools are unchanged and substituted original source proposals open no new card',async t=>{
  const f=await fixture(t);
  assert.equal(await f.helper.prepare({...f.request,phase:'preflight'}),false);
  assert.equal(await f.helper.prepare({...f.request,proposal:{...f.request.proposal,toolName:'knowledge.search'}}),false);
  for(const proposal of [{...f.request.proposal,proposalId:'foreign'},{...f.request.proposal,toolVersion:'foreign'},
    {...f.request.proposal,arguments:{...f.request.proposal.arguments,path:'foreign.md'}}])
    await assert.rejects(f.helper.prepare({...f.request,proposal}),{code:'UNAUTHORIZED'});
  assert.equal(f.calls.length,0);assert.equal(f.app.runtime.listTasks({limit:10}).items.length,0);
});

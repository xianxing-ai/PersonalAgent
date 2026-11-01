import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier,createWorkflowDecisionTool} from '@personal-agent/agentarts';
import {FakeMailProvider} from '@personal-agent/mail';
import * as runtimeModule from '@personal-agent/runtime/application';
import {createBusinessWorkflowWorkerPorts} from '../electron/business-workflow-worker-ports.js';
import {createConnectorConversationTools} from '../electron/connector-conversation-tools.js';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {prepareWorkflowHostPreflight} from '../electron/workflow-host-preflight.js';
import {prepareConfiguredWorkflowDecisionQuestion} from '../electron/configured-workflow-decision-source.js';
import {createF08DecisionQuestionHost} from '../electron/business-workflow-question-host.js';

// Real Engine, Runtime, SQLite, connector host, public mail/knowledge tools and
// AuthorizationQuestions/Policy and original private/public knowledge export policy.
// Knowledge/mail sources, candidate selector and cloud are explicit fixtures. No real mailbox is accessed.
const pause=()=>new Promise(resolve=>setTimeout(resolve,5));
async function scenario(t,options={}){
  const cache=new URL('../../../.cache/business-f08-runtime/',import.meta.url);mkdirSync(cache,{recursive:true});
  const userData=mkdtempSync(new URL('case-',cache)),approvals=[],cloud=[],proposals=[],decisions=[],imageRequests=[],sent=new Map();
  let app,archives=0,sends=0,reads=0,knowledgeReads=0,moved=false,changed=false,decisionReply,decisionReplied=false,businessRevision=1,inboxChanged=false;
  const decisionQuestion=createF08DecisionQuestionHost({getApplication:()=>app});
  const source={vaultId:'fixture-vault',path:'source.md',line:1,revision:'a'.repeat(64)};
  const provider=new FakeMailProvider({inbox:[{uid:3,folder:'INBOX',from:'sender@example.invalid',to:'fixture@qq.com',subject:'Fixture original',
    sentAt:'2026-10-31T00:00:00.000Z',messageId:'<original@example.invalid>',seen:false}],sent:[]},{inboxUidValidity:19,pageSize:100});
  const fetchPage=provider.fetchPage.bind(provider);
  provider.fetchPage=(account,input)=>{reads++;const page=fetchPage(account,input);if(moved)page.messages=[];
    if(options.changedInbox&&reads>=2||inboxChanged)page.uidValidity=20;return page;};
  provider.archive=async(account,input)=>{assert.equal(account,'desktop-qq-inbox');assert.equal(input.uidValidity,19);assert.equal(input.messageId,'<original@example.invalid>');
    archives++;if(!options.unknownArchive)moved=true;return {actionId:'mail-archive:'+input.idempotencyKey,state:options.unknownArchive?'unknown':'confirmed',
      externalId:input.messageId,evidenceRefs:options.unknownArchive?[]:['fixture-archive-readback']};};
  provider.send=async(account,input,context)=>{sends++;const result={state:options.unknownSend?'unknown':'confirmed',messageId:'<sent-'+sends+'@example.invalid>'};
    if(options.interruptedSend)await context.beforeSend({idempotencyKey:input.idempotencyKey,messageId:result.messageId});
    sent.set(input.idempotencyKey,result);if(options.interruptedSend)throw new ProtocolError('RESULT_UNKNOWN','Fixture interrupted after SMTP dispatch');return result;};
  provider.assertSendIdentity=(_account,messageId,key)=>{if(sent.get(key)?.messageId!==messageId)throw new ProtocolError('UNAUTHORIZED','Fixture identity mismatch');};
  provider.reconcileSend=async(account,messageId,key)=>{provider.assertSendIdentity(account,messageId,key);
    return {...sent.get(key),state:options.unknownSend&&!options.reconciled?'unknown':'confirmed'};};
  const question=createDesktopAuthorizationQuestionHost({createQuestions:args=>new runtimeModule.AuthorizationQuestions(args),getApplication:()=>app,
    namespace:'f08',resolveConversation:taskId=>app.readToolConversation(taskId)??app.runtime.getTask(taskId).conversationId,available:()=>true,
    profiles:[{ref:'bounded',revision:1,mode:'workspace-write',label:'Fixture policy',available:true}],defaultProfileRef:'bounded'});
  const connector=createConnectorConversationTools({question,getApplication:()=>app,
    resolveConversation:taskId=>app.readToolConversation(taskId)??app.runtime.getTask(taskId).conversationId,
    mail:{current:()=>({user:'fixture@qq.com',authCode:'Fixture credential',revision:1})},createMailProvider:()=>provider});
  let knowledgeBinding={sourceId:source.vaultId,namespace:'f08',configRevision:1,available:true,writeAvailable:false,
    dataLevel:options.privateKnowledge?'private':'public',cloudExportAllowed:!options.privateKnowledge,publicQueries:['Fixture source'],allowedNotePaths:[]};
  const knowledge=runtimeModule.createTrustedKnowledgeTools({snapshot:()=>structuredClone(knowledgeBinding),acquire(expected,signal){
    if(expected.sourceId!==knowledgeBinding.sourceId||expected.configRevision!==knowledgeBinding.configRevision)throw Error('Fixture source changed');
    const pinned=structuredClone(knowledgeBinding);return {binding:pinned,signal,release(){},assertCurrent(){assert.deepEqual(knowledgeBinding,pinned);},
      read:{search:async()=>{knowledgeReads++;return {hits:[{source:{...source,revision:options.changedKnowledge&&knowledgeReads>=2?'b'.repeat(64):source.revision},
        excerpt:options.longExcerpt?'Public excerpt. '.repeat(15)+'PRIVATE_RAW_SUFFIX':'Fixture explicit source'}],truncated:false};}}};
  }});
  const businessTools=[...connector.tools.filter(tool=>tool.descriptor.name.startsWith('mail.')),knowledge.tools.find(tool=>tool.descriptor.name==='knowledge.search')];
  const policies=[...connector.competitionToolExports,...knowledge.competitionToolExports];
  const composition=createBusinessWorkflowWorkerPorts({runtimeModule,getApplication:()=>app,businessTools,competitionToolExports:policies,
    ...(options.answerDecision?{f08DecisionQuestion:decisionQuestion}:{}),
    prepareCompetitionToolExport:scope=>connector.prepareExport(scope),readBusinessAvailability:()=>({ready:true,bindingId:'fixture-mail-and-knowledge-'+businessRevision}),
    authorizeExport:async request=>{if(options.revokeKnowledgeExport&&request.stage==='receipt'&&request.value?.hits)knowledgeBinding={...knowledgeBinding,cloudExportAllowed:false};
      return !(options.denyCompletion&&request.stage==='completion');}});
  const worker=composition.configuredWorkflowWorkerPorts.find(item=>item.workflowId==='F08');assert.ok(worker);
  const input={inbox:{account:'desktop-qq-inbox',folder:'INBOX',limit:100},knowledge:{query:'Fixture source',limit:1,sourceId:source.vaultId,configRevision:1},knowledgeSources:[source],
    archive:{account:'desktop-qq-inbox',folder:'INBOX',uid:3,uidValidity:19,messageId:'<original@example.invalid>'},
    send:{account:'desktop-qq-inbox',to:'recipient@example.invalid',subject:'Fixture reply',text:'Explicit fixture response'}};
  const decision=createWorkflowDecisionTool({selector:{select:async()=> 'supported'}});
  const tools=[...businessTools,...composition.tools,decision,runtimeModule.createDesktopSubagentDispatchTool({competitionOnly:true,
    getRuntime:()=>app.runtime,getTools:()=>app.tools,runDefaultWorker:(subtask,context,scoped)=>app.runDefaultSubagentWorker(subtask,context,scoped)})];
  const secret='fixture-f08-original-secret-thirty-two-characters';
  const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:secret,decisionTool:{name:'decision.choose_candidate',version:'1.0.0'},
    receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),prepareCandidates:async context=>{
      decisions.push(context);
      const tool=(name,args)=>({toolName:name,toolVersion:businessTools.find(tool=>tool.descriptor.name===name).descriptor.version,arguments:args});
      const p=context.predecessorOutputs;let value;
      switch(context.node.id){
        case 'F08_N01':value=tool('mail.inbox',input.inbox);break;
        case 'F08_N02':value={archive:input.archive};break;
        case 'F08_N03':value={arguments:input.archive};break;
        case 'F08_N09':value={arguments:input.knowledge};break;
        case 'F08_N04':value=input.send;break;
        case 'F08_N05':value={send:input.send,knowledgeSources:input.knowledgeSources,requiresDecision:options.needsDecision===true};break;
        case 'F08_N10':value={arguments:{send:input.send}};break;
        case 'F08_N06':value={arguments:{send:input.send,knowledgeSources:input.knowledgeSources}};break;
        case 'F08_N07':value={arguments:input.send};break;
        case 'F08_N11':value=tool('mail.reconcile_send',{account:input.send.account,messageId:p.F08_N07.messageId,idempotencyKey:p.F08_N07.idempotencyKey});break;
        case 'F08_N12':value={arguments:{messageId:p.F08_N11.externalId,idempotencyKey:p.F08_N11.actionId.slice('mail-send:'.length)}};break;
        default:throw Error('Unexpected F08 fixture candidate '+context.node.id);
      }
      return [{id:'supported',description:'Original fixture mail plan',value},{id:'review',description:'Fixture abstention',value:null,abstain:true}];
    }});
  app=runtimeModule.createRuntimeApplication({path:path.join(userData,'runtime.sqlite'),profile:'huawei_ict_agentarts',delegateUserTasks:true,hostUserNamespace:'f08',
    coordinationBinding:'fixture-deployment',tools,configuredWorkflowWorkers:[{...worker,image:{bindingId:'fixture-f08-image',receiptSecret:async()=>secret,
      advance:async request=>{imageRequests.push(structuredClone({...request,signal:undefined}));const result=await engine.advance(request);proposals.push(...result.proposals);return result;}}}],
    coordination:{execute:async request=>{cloud.push(request);
      if(app.runtime.getTask(request.taskId).conversationId==='fixture-chat'||request.continuation)return {kind:'text',text:'Fixture result',verification:'unverified'};
      return {kind:'tool_proposal',proposalId:'original-f08',toolName:worker.toolName,toolVersion:worker.toolVersion,arguments:input,verification:'unverified'};}},
    requiresToolAuthorization:()=>true,requestToolAuthorization:async scope=>{
      if(!await connector.prepareOriginalSendReconciliationAuthorization(scope))
        await prepareWorkflowHostPreflight({application:app,scope,prepareExport:scope=>connector.prepareExport(scope)});
      prepareConfiguredWorkflowDecisionQuestion({application:app,scope,question});return question.requestToolAuthorization(scope);
    },competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,available:()=>true,
      publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
    competitionToolExports:tools.map(tool=>policies.find(policy=>policy.toolName===tool.descriptor.name)??{toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
      exportPolicyVersion:'fixture-graph',accepts:()=>true,project:({result})=>result})});
  knowledge.bindApplication(app);
  t.after(async()=>{for(const task of app.runtime.listTasks({limit:100}).items)if(!['succeeded','failed','cancelled'].includes(task.state))app.runtime.requestCancel(task.taskId);
    question.close();for(let i=0;i<300&&app.activeTaskCount;i++)await pause();await connector.close();app.close();});
  const client=new Client(app);await client.connect();
  const root=await client.call('task.submit',{goal:'Fixture explicit F08 mail reply',conversationId:'fixture-chat'},{idempotencyKey:'fixture-f08',timeoutMs:60000});
  let child;
  let recovered=false;
  for(let i=0;i<4000;i++){
    if(options.answerDecision&&!decisionReplied){const pending=decisionQuestion.readQuestion({taskId:root.taskId,conversationId:'fixture-chat'});
      if(pending){decisionReplied=true;assert.equal(pending.field,'mail.decision');assert.deepEqual(pending.draft,input.send);assert.deepEqual(pending.references,input.knowledgeSources);
        decisionReply={taskId:pending.taskId,questionId:pending.questionId,expectedRevision:pending.revision,sourceTaskId:root.taskId,
          commandId:'fixture-explicit-draft-message',decision:options.answerDecision};
        if(options.cancelDecision)app.runtime.requestCancel(pending.graphTaskId);
        else if(options.revokeDecision){app.runtime.policy.revoke('host-tool-'+pending.taskId);
          assert.throws(()=>decisionQuestion.submitReply(decisionReply,{conversationId:'fixture-chat'}),/unavailable|changed/);app.runtime.requestCancel(pending.graphTaskId);}
        else {
          assert.throws(()=>decisionQuestion.submitReply({...decisionReply,decision:'allow_once'},{conversationId:'fixture-chat'}),/invalid/);
          assert.throws(()=>decisionQuestion.submitReply({...decisionReply,expectedRevision:0},{conversationId:'fixture-chat'}),/target changed/);
          assert.throws(()=>decisionQuestion.submitReply(decisionReply,{conversationId:'foreign'}),/target changed/);
          const answered=decisionQuestion.submitReply(decisionReply,{conversationId:'fixture-chat'});assert.equal(answered.state,'answered');
          assert.deepEqual(decisionQuestion.submitReply(decisionReply,{conversationId:'fixture-chat'}),answered);
          assert.throws(()=>decisionQuestion.submitReply({...decisionReply,decision:options.answerDecision==='accept'?'decline':'accept'},
            {conversationId:'fixture-chat'}),/another explicit reply/);
          if(options.changeInboxAfterDecision)inboxChanged=true;
        }
      }
    }
    for(const card of question.snapshot().filter(item=>item.state==='pending')){approvals.push(card.toolName);
      if(card.toolName==='mail.send'&&options.revokeSend&&!changed){await connector.invalidate('mail');changed=true;}
      if(card.toolName==='mail.send'&&options.cancelSend){const graph=app.readSubagentTasks(root.taskId)[0];if(graph)app.runtime.requestCancel(graph.taskId);continue;}
      if(card.toolName==='mail.send'&&options.revokeDecisionBeforeSend)app.runtime.policy.revoke('host-tool-'+decisionReply.taskId);
      if(card.toolName==='mail.send'&&options.eraseDecisionBeforeSend)app.runtime.saveCheckpoint(root.taskId,'private-copy-erasure',{state:'withheld'});
      if(card.toolName==='mail.send'&&options.changeBindingBeforeSend)businessRevision++;
      if(card.toolName==='mail.send'&&options.replaceAnswerBeforeSend){const key='business-workflow:F08:mail-question:reply';
        app.runtime.saveCheckpoint(decisionReply.taskId,key,{...app.runtime.loadCheckpoint(decisionReply.taskId,key),decision:'decline'});}
      try{question.respond({questionId:card.questionId,expectedRevision:card.revision,decision:card.toolName===options.denyTool?'deny':'allow_once'},card.conversationId);}
      catch(error){if(!options.revokeSend)throw error;assert.match(error.message,/失效|revok|changed|expired|authoriz/i);}
    }
    [child]=app.readSubagentTasks(root.taskId);
    if(options.interruptedSend&&!recovered&&child?.state==='waiting_reconciliation'&&app.activeTaskCount===0){
      const source={taskId:root.taskId},scope={deadline:new Date(Date.now()+30000).toISOString(),signal:new AbortController().signal};
      assert.equal(connector.readOriginalSendRecoveryAvailable(root.taskId),true);
      const read=connector.readOriginalSendReconciliation(source);
      if(read.state==='unavailable'){connector.prepareOriginalSendReconciliation(source,scope);await pause();continue;}
      if(read.state==='pending'){await pause();continue;}
      assert.equal(read.state,'confirmed',JSON.stringify(read));
      const applied=connector.applyOriginalSendReconciliation(source);
      await composition.reconcileOriginalMailWorkflow({taskId:applied.task.taskId,...scope});recovered=true;await pause();continue;
    }
    if(child&&app.activeTaskCount===0&&['succeeded','failed','cancelled','waiting_reconciliation'].includes(child.state))break;await pause();
  }
  assert.ok(child);return {app,userData,child,archives,sends,reads,knowledgeReads,approvals,cloud,proposals,decisions,imageRequests,decisionReply,decisionReplied,decisionQuestion,
    diagnostics:app.runtime.listTasks({limit:100}).items.map(task=>({state:task.state,error:task.error,tool:app.runtime.loadCheckpoint(task.taskId,'host-tool-intent')?.toolName}))};
}

test('F08 actual configured graph uses original read scopes and separate archive/send approvals',async t=>{
  const f=await scenario(t);assert.equal(f.child.state,'succeeded',JSON.stringify(f.diagnostics));assert.equal(f.archives,1);assert.equal(f.sends,1);
  assert.ok(f.approvals.includes('mail.archive'));assert.ok(f.approvals.includes('mail.send'));assert.equal(f.knowledgeReads,3);
  assert.ok(f.cloud.some(request=>request.continuation?.result?.sendConfirmed===true));
});
test('F08 missing decision refuses send while retaining any original archive',async t=>{
  const f=await scenario(t,{needsDecision:true});assert.notEqual(f.child.state,'succeeded');assert.equal(f.sends,0);
});
for(const name of ['mail.archive','mail.send'])test('F08 denying '+name+' cannot borrow the graph approval',async t=>{
  const f=await scenario(t,{denyTool:name});assert.notEqual(f.child.state,'succeeded');assert.ok(f.approvals.includes(name));
  assert.equal(name==='mail.send'?f.sends:f.archives,0);
});
for(const option of ['changedInbox','changedKnowledge','cancelSend','revokeSend'])test('F08 '+option+' prevents SMTP without undoing original effects',async t=>{
  const f=await scenario(t,{[option]:true});assert.notEqual(f.child.state,'succeeded');assert.equal(f.sends,0);
  if(option==='cancelSend'||option==='revokeSend')assert.ok(f.approvals.includes('mail.send'));
});
for(const option of ['unknownSend','unknownArchive','denyCompletion'])test('F08 '+option+' retains original operations without a successful completion',async t=>{
  const f=await scenario(t,{[option]:true});assert.notEqual(f.child.state,'succeeded');assert.equal(f.sends,1);assert.equal(f.archives,1);
  assert.equal(f.cloud.some(request=>request.continuation?.result?.sendConfirmed===true),false);
});
test('F08 independently reconciles the original unknown send without a second SMTP call',async t=>{
  const f=await scenario(t,{unknownSend:true,reconciled:true});assert.equal(f.child.state,'succeeded',JSON.stringify(f.diagnostics));assert.equal(f.sends,1);
  assert.ok(f.approvals.includes('mail.reconcile_send'));assert.ok(f.cloud.some(request=>request.continuation?.result?.sendConfirmed===true));
});
test('F08 interrupted SMTP resumes the original confirmed host and configured graph without sending twice',async t=>{
  const f=await scenario(t,{interruptedSend:true});assert.equal(f.child.state,'succeeded',JSON.stringify(f.diagnostics));
  assert.equal(f.sends,1);assert.equal(f.archives,1);assert.ok(f.cloud.some(request=>request.continuation?.result?.sendConfirmed===true));
});

test('F08 consumes the original 200-character knowledge projection without exporting the raw tail',async t=>{
  const f=await scenario(t,{longExcerpt:true});assert.equal(f.child.state,'succeeded',JSON.stringify(f.diagnostics));assert.equal(f.sends,1);assert.equal(f.knowledgeReads,3);
  const knowledge=f.decisions.find(context=>context.node.id==='F08_N04').predecessorOutputs.F08_N09;
  assert.equal(knowledge.hits[0].excerpt.length,200);
  assert.equal(JSON.stringify({image:f.imageRequests,decisions:f.decisions,cloud:f.cloud}).includes('PRIVATE_RAW_SUFFIX'),false);
});
for(const option of ['privateKnowledge','revokeKnowledgeExport'])test('F08 '+option+' cannot publish knowledge or authorize a send',async t=>{
  const f=await scenario(t,{longExcerpt:true,[option]:true});assert.notEqual(f.child.state,'succeeded');assert.equal(f.sends,0);
  assert.ok(f.diagnostics.some(task=>task.tool==='knowledge.search'&&task.state==='succeeded'));
  assert.equal(f.decisions.some(context=>context.node.id==='F08_N04'),false);
  assert.equal(JSON.stringify({image:f.imageRequests,cloud:f.cloud}).includes('Public excerpt.'),false);
  assert.equal(JSON.stringify({image:f.imageRequests,cloud:f.cloud}).includes('PRIVATE_RAW_SUFFIX'),false);
});
test('F08 knowledge child denial preserves prior effects without SMTP or borrowed authority',async t=>{
  const f=await scenario(t,{denyTool:'knowledge.search'});assert.notEqual(f.child.state,'succeeded');assert.equal(f.sends,0);assert.equal(f.knowledgeReads,0);
});

test('F08 original draft accept retains separate send Policy and exports only the business answer',async t=>{
  const f=await scenario(t,{needsDecision:true,answerDecision:'accept'});assert.equal(f.child.state,'succeeded',JSON.stringify(f.diagnostics));
  assert.equal(f.archives,1);assert.equal(f.sends,1);assert.ok(f.approvals.includes('workflow.host.f08_n06'));
  assert.equal(f.approvals.filter(name=>name==='mail.send').length,1);assert.deepEqual(f.app.readHostToolTask(f.decisionReply.taskId).confirmed.result,{decision:'accept'});
});
test('F08 original draft decline preserves the confirmed archive without sending or fabricating a send identity',async t=>{
  const f=await scenario(t,{needsDecision:true,answerDecision:'decline'});assert.equal(f.child.state,'succeeded',JSON.stringify(f.diagnostics));
  assert.equal(f.archives,1);assert.equal(f.sends,0);assert.equal(f.approvals.includes('mail.send'),false);assert.equal(f.approvals.includes('mail.reconcile_send'),false);
  assert.ok(f.cloud.some(request=>JSON.stringify(request.continuation?.result)===JSON.stringify({archiveConfirmed:true,sendConfirmed:false,decision:'declined'})));
});
for(const options of [{denyTool:'mail.send'},{cancelDecision:true},{revokeDecision:true},{revokeDecisionBeforeSend:true},
  {eraseDecisionBeforeSend:true},{changeBindingBeforeSend:true},{replaceAnswerBeforeSend:true},{changeInboxAfterDecision:true},{changedKnowledge:true}])
  test('F08 original draft answer cannot authorize SMTP after refusal or source replacement '+JSON.stringify(options),async t=>{
    const f=await scenario(t,{needsDecision:true,answerDecision:'accept',...options});assert.equal(f.decisionReplied,true);
    assert.notEqual(f.child.state,'succeeded');assert.equal(f.sends,0);assert.equal(f.archives,1);
  });
test('F08 original draft answer persists without replaying an unknown SMTP outcome after SQLite reopen',async t=>{
  const f=await scenario(t,{needsDecision:true,answerDecision:'accept',unknownSend:true});assert.notEqual(f.child.state,'succeeded');assert.equal(f.sends,1);
  const key='business-workflow:F08:mail-question:reply',reply=f.app.runtime.loadCheckpoint(f.decisionReply.taskId,key);
  assert.equal(reply.decision,'accept');assert.equal(reply.origin,'desktop_explicit_text');
  const restored=runtimeModule.createRuntimeApplication({path:path.join(f.userData,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'f08'});
  try {assert.deepEqual(restored.runtime.loadCheckpoint(f.decisionReply.taskId,key),reply);const reader=createF08DecisionQuestionHost({getApplication:()=>restored});
    assert.equal(reader.readQuestion({taskId:f.decisionReply.sourceTaskId,conversationId:'fixture-chat'}),undefined);
    assert.throws(()=>reader.submitReply(f.decisionReply,{conversationId:'fixture-chat'}),/unavailable|changed/);
  }finally{restored.close();}assert.equal(f.sends,1);
});

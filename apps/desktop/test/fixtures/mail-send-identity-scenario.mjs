import {syntheticAgentArtsOptions} from '../../../../tests/helpers/synthetic-agentarts.mjs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createAgentArtsRuntimeApplication,AuthorizationQuestions} from '@personal-agent/runtime/application';
import {Client} from '@personal-agent/client';
import {QQMailProvider} from '@personal-agent/mail';
import {createConnectorConversationTools} from '../../electron/connector-conversation-tools.js';
import {createDesktopAuthorizationQuestionHost} from '../../electron/authorization-question-host.js';

export const mailArguments={to:'recipient@example.invalid',subject:'Synthetic send identity',text:'Offline fixture only'};

// Actual Runtime/Policy/SQLite and QQ implementation; cloud, approval response and SMTP transport are explicit fixtures.
export async function mailSendIdentityScenario({path=':memory:',mode='success',reconcile=false}={}) {
  let application,activeTaskId,cloudCalls=0,sends=0,reads=0,mail={user:'synthetic@example.invalid',authCode:'offline-unused',revision:1};
  const transportMessages=[];
  const conversation=id=>application.readToolConversation(id)??application.runtime.getTask(id).conversationId;
  const question=reconcile?createDesktopAuthorizationQuestionHost({createQuestions:args=>new AuthorizationQuestions(args),getApplication:()=>application,
    namespace:'smtp-identity',resolveConversation:conversation,available:()=>true,
    profiles:[{ref:'bounded',revision:1,mode:'workspace-write',label:'Fixture policy',available:true}],defaultProfileRef:'bounded'}):undefined;
  const host=createConnectorConversationTools({mail:{current:()=>mail},getApplication:()=>application,question,
    resolveConversation:conversation,confirmExport:async()=>true,
    createMailProvider:options=>{
      const provider=new QQMailProvider(options);
      provider.transporter={sendMail(envelope){
        sends++;transportMessages.push(envelope);
        if(mode==='crash')process.exit(77);
        if(mode==='cancel')return new Promise(()=>{});
        if(mode==='throw')throw Error('Synthetic socket lost after dispatch');
        return Promise.resolve({messageId:envelope.messageId});
      },close(){}};
      if(reconcile)provider.client={usable:true,mailbox:{uidValidity:1n},list:async()=>[{path:'Sent',specialUse:'\\Sent'}],
        getMailboxLock:async()=>({release(){}}),search:async()=>{reads++;return [1];},
        async *fetch(){yield {uid:1,envelope:{messageId:transportMessages[0]?.messageId}};},close(){}};
      if(mode==='omitted-hook')provider.send=async()=>({state:'confirmed',messageId:'<unbound@example.invalid>'});
      if(mode==='legacy-provider'){delete provider.sendIdentitySupport;provider.send=async()=>({state:'unknown',messageId:'<legacy@example.invalid>'});}
      return provider;
    }});
  application=createAgentArtsRuntimeApplication(syntheticAgentArtsOptions({path,gatewayUrl:'https://agentarts.example.invalid',runtimeName:'smtp-identity-fixture',
    ...(reconcile?{hostUserNamespace:'smtp-identity',requiresToolAuthorization:()=>true,requestToolAuthorization:async scope=>{
      await host.prepareOriginalSendReconciliationAuthorization(scope);return question.requestToolAuthorization(scope);}}:{}),
    initialRequestMode:'goal-with-tools-json',responseMode:'tool-proposal-json',continuationContext:'goal',
    tools:host.tools,competitionToolAvailability:host.competitionToolAvailability,competitionToolExports:host.competitionToolExports,
    prepareCompetitionToolExport:scope=>host.prepareExport(scope),authorizationProvider:{read:async()=> 'Bearer synthetic'},
    fetchImpl:async()=>{cloudCalls++;return new Response(JSON.stringify({event:'message',data:{index:0,text:JSON.stringify(cloudCalls===1
      ?{kind:'tool_proposal',proposalId:'mail-send-identity',toolName:'mail.send',toolVersion:'0.1.0-alpha.1',arguments:mailArguments}
      :{kind:'text',text:'Synthetic transport response; no actual email sent.'})}}),{headers:{'content-type':'application/json'}});}}));
  const client=new Client(application);await client.connect();
  const wait=async predicate=>{const end=Date.now()+10000;while(Date.now()<end){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}
    throw Error('Timed out: '+JSON.stringify(application.runtime.listTasks().items));};
  const close=async()=>{question?.close();await host.close();if(activeTaskId)await wait(()=>application.activeTaskCount===0);
    await new Promise(resolve=>setImmediate(resolve));await application.close();};
  const approve=async taskId=>{
    await wait(()=>application.runtime.getTask(taskId).state==='waiting_approval');
    if(question){await wait(()=>question.snapshot(conversation(taskId)).some(card=>card.taskId===taskId&&card.state==='pending'));
      const card=question.snapshot(conversation(taskId)).find(card=>card.taskId===taskId&&card.state==='pending');
      question.respond({questionId:card.questionId,expectedRevision:card.revision,decision:'allow_once'},card.conversationId);
    }else{const approval=application.runtime.listApprovals({taskId,state:'pending'}).items[0];
      await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});}
  };
  return {application,host,client,wait,close,approve,reads:()=>reads,sends:()=>sends,cloudCalls:()=>cloudCalls,transportMessages,
    rotate:()=>{mail={...mail,revision:mail.revision+1};},
    async send(){const {taskId}=await client.call('task.submit',{goal:'Run offline synthetic mail send',conversationId:'smtp-identity-fixture'},
      {idempotencyKey:'mail-send-identity',timeoutMs:10000});
      activeTaskId=taskId;await wait(()=>application.runtime.getTask(taskId).state==='waiting_approval');assert.equal(sends,0);
      await approve(taskId);
      return taskId;
    }};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const fixture=await mailSendIdentityScenario({path:process.argv[2],mode:'crash'});
  await fixture.send();await fixture.wait(()=>false);
}

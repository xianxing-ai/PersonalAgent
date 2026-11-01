import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createAgentArtsRuntimeApplication} from '@personal-agent/runtime/application';
import {Client} from '@personal-agent/client';
import {QQMailProvider} from '@personal-agent/mail';
import {createConnectorConversationTools} from '../../electron/connector-conversation-tools.js';

export const mailArguments={to:'recipient@example.invalid',subject:'Synthetic send identity',text:'Offline fixture only'};

// Actual Runtime/Policy/SQLite and QQ implementation; cloud, approval response and SMTP transport are explicit fixtures.
export async function mailSendIdentityScenario({path=':memory:',mode='success'}={}) {
  let application,activeTaskId,cloudCalls=0,sends=0,mail={user:'synthetic@example.invalid',authCode:'offline-unused',revision:1};
  const transportMessages=[];
  const host=createConnectorConversationTools({mail:{current:()=>mail},getApplication:()=>application,
    resolveConversation:id=>application.runtime.getTask(id).conversationId,confirmExport:async()=>true,
    createMailProvider:options=>{
      const provider=new QQMailProvider(options);
      provider.transporter={sendMail(envelope){
        sends++;transportMessages.push(envelope);
        if(mode==='crash')process.exit(77);
        if(mode==='cancel')return new Promise(()=>{});
        if(mode==='throw')throw Error('Synthetic socket lost after dispatch');
        return Promise.resolve({messageId:envelope.messageId});
      },close(){}};
      if(mode==='omitted-hook')provider.send=async()=>({state:'confirmed',messageId:'<unbound@example.invalid>'});
      if(mode==='legacy-provider'){delete provider.sendIdentitySupport;provider.send=async()=>({state:'unknown',messageId:'<legacy@example.invalid>'});}
      return provider;
    }});
  application=createAgentArtsRuntimeApplication({path,gatewayUrl:'https://agentarts.example.invalid',runtimeName:'smtp-identity-fixture',
    initialRequestMode:'goal-with-tools-json',responseMode:'tool-proposal-json',continuationContext:'goal',
    tools:host.tools,competitionToolAvailability:host.competitionToolAvailability,competitionToolExports:host.competitionToolExports,
    prepareCompetitionToolExport:scope=>host.prepareExport(scope),authorizationProvider:{read:async()=> 'Bearer synthetic'},
    fetchImpl:async()=>{cloudCalls++;return new Response(JSON.stringify({event:'message',data:{index:0,text:JSON.stringify(cloudCalls===1
      ?{kind:'tool_proposal',proposalId:'mail-send-identity',toolName:'mail.send',toolVersion:'0.1.0-alpha.1',arguments:mailArguments}
      :{kind:'text',text:'Synthetic transport response; no actual email sent.'})}}),{headers:{'content-type':'application/json'}});}});
  const client=new Client(application);await client.connect();
  const wait=async predicate=>{const end=Date.now()+10000;while(Date.now()<end){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}
    throw Error('Timed out: '+JSON.stringify(application.runtime.listTasks().items));};
  const close=async()=>{await host.close();if(activeTaskId)await wait(()=>!application.runtime.isTaskActive(activeTaskId));
    await new Promise(resolve=>setImmediate(resolve));await application.close();};
  return {application,host,client,wait,close,sends:()=>sends,cloudCalls:()=>cloudCalls,transportMessages,
    rotate:()=>{mail={...mail,revision:mail.revision+1};},
    async send(){const {taskId}=await client.call('task.submit',{goal:'Run offline synthetic mail send',conversationId:'smtp-identity-fixture'},
      {idempotencyKey:'mail-send-identity',timeoutMs:10000});
      activeTaskId=taskId;await wait(()=>application.runtime.getTask(taskId).state==='waiting_approval');assert.equal(sends,0);
      const approval=application.runtime.listApprovals({taskId,state:'pending'}).items[0];
      await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
      return taskId;
    }};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const fixture=await mailSendIdentityScenario({path:process.argv[2],mode:'crash'});
  await fixture.send();await fixture.wait(()=>false);
}

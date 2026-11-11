import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {AuthorizationQuestions,createRuntimeApplication} from '@personal-agent/runtime/application';
import {defaultFeedFixtures} from '@personal-agent/feeds';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {createDesktopFeedsHost} from '../electron/feeds-host.js';
import {createF09FeedGraphHost} from '../electron/f09-feed-graph-host.js';

// Real local Runtime, HostBridge, Policy and AuthorizationQuestions; source
// transport and all feed content are Synthetic fixtures, never cloud acceptance.
const cache=new URL('../../../.cache/f09-feed-runtime/',import.meta.url);mkdirSync(cache,{recursive:true});
const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),
  decryptString:value=>Buffer.from(value).reverse().toString()};
const wait=async check=>{for(let n=0;n<200;n++){const value=check();if(value)return value;await new Promise(r=>setTimeout(r,5));}throw Error('Synthetic integration did not settle');};

test('F09 original feed HostBridge receipt uses actual question, exact destination and revoked resource',async()=>{
  let app;const dir=mkdtempSync(new URL('run-',cache));
  const question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>app,
    namespace:'Synthetic-f09',resolveConversation:()=> 'Synthetic conversation',available:()=>true,
    profiles:[{ref:'app',label:'Synthetic application',mode:'workspace-write',revision:1,available:true}],defaultProfileRef:'app'});
  const provider={source:'synthetic-fixture',verification:'conditional',async fetchFeed(){return {state:'fetched',body:defaultFeedFixtures[0].body};}};
  const feeds=createDesktopFeedsHost({userData:dir,safeStorage,question,provider});
  feeds.add({title:'Synthetic',url:'https://example.invalid/feed.xml'});feeds.prepare();
  const collect=feeds.tools.find(tool=>tool.descriptor.name==='feeds.collect');
  const graph=createF09FeedGraphHost({getApplication:()=>app,collectTool:collect,assertFeedAccess:binding=>feeds.assertWorkflowFeedAccess(binding)});
  app=createRuntimeApplication({path:path.join(dir,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'Synthetic-f09',
    tools:[...feeds.tools,...graph.tools],requiresToolAuthorization:()=>true,
    requestToolAuthorization:scope=>{feeds.prepareWorkflowFeedSource(scope);return question.requestToolAuthorization(scope);}});
  feeds.bindApplication(app,'Synthetic-f09');
  const owner=app.runtime.submitTask({goal:'Synthetic graph',conversationId:'Synthetic conversation',idempotencyKey:'f09'});
  app.runtime.transitionTask(owner.taskId,'planning');app.runtime.transitionTask(owner.taskId,'running');
  const deadline=new Date(Date.now()+60000).toISOString(),signal=new AbortController().signal;
  const binding={taskId:owner.taskId,sessionId:'synthetic-session',workflowId:'F09',controlRevision:0,deadline,signal};
  const bridge=app.createOwnedWorkflowHost({receiptSecret:'synthetic-secret-more-than-32-characters',parentTaskId:owner.taskId,assertActive:()=>{}});
  const make=(nodeId,operationId,toolName,toolVersion,args)=>({kind:'tool_proposal',nodeId,operationId,proposalId:operationId,
    inputDigest:'synthetic-input-digest',originControlRevision:0,toolName,toolVersion,toolSchemaDigest:'synthetic-schema-digest',
    arguments:args,resourceKeys:[],effect:'read'});
  async function approve(){const card=await wait(()=>question.snapshot().find(value=>value.state==='pending'));
    question.respond({questionId:card.questionId,expectedRevision:card.revision,decision:'allow_once'},card.conversationId);}
  try {
    const source=make('F09_N01','source-op','feeds.collect',collect.descriptor.version,{subscriptionId:feeds.snapshot().subscriptions[0].id});
    const child=bridge.submit(binding,source);await approve();await app.waitForHostToolTask(child.localTaskId);
    const receipt=bridge.readReceipt(binding,source);assert.equal(receipt.state,'confirmed');
    assert.equal(receipt.evidenceRefs[0],'host-tool-'+child.localTaskId);
    const sourceBinding={parentTaskId:owner.taskId,sourceTaskId:child.localTaskId,sourceOperationId:source.operationId,result:receipt.result,signal};
    assert.equal(feeds.authorizeWorkflowFeedSourceExport(sourceBinding),true);
    const adapter=graph.tools[0],next=make('F09_N02','next-op',adapter.descriptor.name,adapter.descriptor.version,{sourceOperationId:source.operationId});
    const nextChild=bridge.submit(binding,next);await approve();await app.waitForHostToolTask(nextChild.localTaskId);
    const nextReceipt=bridge.readReceipt(binding,next);assert.equal(nextReceipt.state,'confirmed');
    assert.equal(nextReceipt.result.uniqueCount,2);
    feeds.revoke();assert.equal(feeds.assertWorkflowFeedAccess({...sourceBinding,context:{taskId:nextChild.localTaskId,signal}}),false);
  } finally {question.close();feeds.close();await wait(()=>app.activeTaskCount===0);app.close();}
});

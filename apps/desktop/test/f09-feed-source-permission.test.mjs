import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {defaultFeedFixtures} from '@personal-agent/feeds';
import {createDesktopFeedsHost} from '../electron/feeds-host.js';
import {createF09FeedGraphHost} from '../electron/f09-feed-graph-host.js';

// Synthetic question receipt and feed fixture; no real account or cloud access.
const cache=new URL('../../../.cache/f09-feed-source-permission/',import.meta.url);mkdirSync(cache,{recursive:true});
const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>Buffer.from(value).toString()};

test('F09 uses the exact original feed question, confirmed output and revocation',async()=>{
  let approved=false,consumed=false,generation='first';
  const question={prepare(){},prepareExport(){},readResourceGeneration:()=>generation,
    rotateResourceGeneration(){generation+='x';},currentRequirement(){if(!approved)throw Error('denied');},
    authorizeExport(){if(!approved)throw Error('denied');},
    authorizeConsumedExport(){if(!approved)throw Error('denied');consumed=true;},
    assertConsumedResult(){if(!approved||!consumed)throw Error('denied');}};
  const provider={source:'synthetic-fixture',verification:'conditional',async fetchFeed(){return {state:'fetched',body:defaultFeedFixtures[0].body};}};
  const host=createDesktopFeedsHost({userData:mkdtempSync(new URL('case-',cache)),safeStorage,question,provider});
  const checkpoints=new Map(),put=(id,key,value)=>checkpoints.set(id+'|'+key,value);
  let result,sourceDestination='same';
  const application={runtime:{loadCheckpoint:(id,key)=>checkpoints.get(id+'|'+key),saveCheckpoint:(id,key,value)=>put(id,key,value),
    getTask:()=>({state:'running',cancelRequested:false})},createHostStateStore:()=>({get(){},set(){}}),
    readAuthorizationQuestionDestination:taskId=>taskId==='source'?sourceDestination:'same',
    readHostToolTask:()=>({commandId:'source-op',toolName:'feeds.collect',toolVersion:'0.1.0-alpha.1',task:{state:'succeeded'},
      confirmed:{runId:'host-tool-source',result,evidenceRefs:['host-tool-source']}})};
  try {
    host.add({title:'Synthetic',url:'https://example.invalid/feed.xml'});host.prepare();host.bindApplication(application,'synthetic-user');
    const collect=host.tools.find(tool=>tool.descriptor.name==='feeds.collect'),subscriptionId=host.snapshot().subscriptions[0].id;
    const args={subscriptionId},proposal={nodeId:'F09_N01',operationId:'source-op',toolName:'feeds.collect',
      toolVersion:collect.descriptor.version,arguments:args};
    const signal=new AbortController().signal,deadline=new Date(Date.now()+60_000).toISOString();
    const sourceScope={taskId:'source',runId:'host-tool-source',toolName:'feeds.collect',toolVersion:collect.descriptor.version,
      scopes:['feeds:read'],authorizationRef:'synthetic',deadline,signal};
    put('source','coding-repair:parent',{taskId:'parent',operationId:'source-op'});
    put('source','host-tool-intent',{commandId:'source-op',toolName:'feeds.collect',toolVersion:collect.descriptor.version,arguments:args});
    put('parent','owned-workflow:intent:source-op',{taskId:'parent',workflowId:'F09',sessionId:'session',proposal});
    put('parent','owned-workflow:operation:source-op',{taskId:'parent',workflowId:'F09',sessionId:'session',localTaskId:'source',proposal});
    put('parent','coding-repair:host:source-op',{localTaskId:'source',request:{commandId:'source-op',toolName:'feeds.collect',arguments:args}});
    sourceDestination='different';assert.throws(()=>host.prepareWorkflowFeedSource(sourceScope),/目标不一致/);
    sourceDestination='same';
    assert.equal(host.prepareWorkflowFeedSource(sourceScope),true);
    await assert.rejects(collect.execute(args,sourceScope));approved=true;result=await collect.execute(args,sourceScope);
    const input={sourceOperationId:'source-op'},current={nodeId:'F09_N02',operationId:'next-op',toolName:'workflow.host.f09_n02',arguments:input};
    put('child','coding-repair:parent',{taskId:'parent',operationId:'next-op'});
    put('child','host-tool-intent',{commandId:'next-op',toolName:'workflow.host.f09_n02',arguments:input});
    put('parent','owned-workflow:intent:next-op',{taskId:'parent',workflowId:'F09',sessionId:'session',proposal:current});
    const binding={parentTaskId:'parent',sourceTaskId:'source',sourceOperationId:'source-op',result,signal};
    const ctx={taskId:'child',runId:'host-tool-child',deadline,signal,authorizationRef:'synthetic',scopes:['feeds:read']};
    assert.equal(host.assertWorkflowFeedAccess({...binding,context:ctx}),false);
    assert.equal(host.authorizeWorkflowFeedSourceExport(binding),true);
    const adapter=createF09FeedGraphHost({application,collectTool:collect,assertFeedAccess:value=>host.assertWorkflowFeedAccess(value)}).tools[0];
    const observed=await adapter.execute(input,ctx);assert.equal(observed.uniqueCount,result.items.length);
    assert.equal(host.assertWorkflowFeedAccess({...binding,context:{...ctx,taskId:'foreign'}}),false);
    assert.equal(host.assertWorkflowFeedAccess({...binding,result:{...result,nextCursor:'changed'},context:ctx}),false);
    sourceDestination='different';assert.equal(host.assertWorkflowFeedAccess({...binding,context:ctx}),false);
    sourceDestination='same';
    host.revoke();assert.equal(host.assertWorkflowFeedAccess({...binding,context:ctx}),false);
    await assert.rejects(adapter.execute(input,ctx));
  } finally {host.close();}
});

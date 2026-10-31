import test from 'node:test';
import assert from 'node:assert/strict';
import {FakeFeedProvider,register} from '@personal-agent/feeds';
import {createF09FeedGraphHost} from '../electron/f09-feed-graph-host.js';

// This fixture tests binding and parsing only, not a real subscription or cloud.
async function fixture() {
  const tools=[];register({register(tool){tools.push(tool);return ()=>{};}},{provider:new FakeFeedProvider(),
    subscriptions:[{id:'synthetic',url:'https://example.invalid/feed.xml'}]});
  const collectTool=tools.find(tool=>tool.descriptor.name==='feeds.collect');
  const signal=new AbortController().signal,context={taskId:'child',runId:'host-tool-child',signal,
    deadline:new Date(Date.now()+60_000).toISOString(),authorizationRef:'synthetic',scopes:['feeds:read']};
  const result=await collectTool.execute({subscriptionId:'synthetic'},context);
  // Identical items are duplicates, while changed content with the same feed
  // identity is retained as a separate version; continuation stays explicit.
  result.items=[result.items[0],structuredClone(result.items[0]),{...result.items[0],summary:'changed revision'}];
  result.hasMore=true;result.nextCursor='synthetic-next-page';
  const data=new Map(),put=(id,key,value)=>data.set(id+'|'+key,value);
  const sourceProposal={nodeId:'F09_N01',toolName:'feeds.collect',toolVersion:collectTool.descriptor.version,
    operationId:'original',arguments:{subscriptionId:'synthetic'}};
  put('child','coding-repair:parent',{taskId:'parent',operationId:'current'});
  put('child','host-tool-intent',{commandId:'current',toolName:'workflow.host.f09_n02',arguments:{sourceOperationId:'original'}});
  put('parent','owned-workflow:intent:current',{taskId:'parent',workflowId:'F09',sessionId:'session',proposal:{
    nodeId:'F09_N02',toolName:'workflow.host.f09_n02',operationId:'current',arguments:{sourceOperationId:'original'}}});
  put('parent','owned-workflow:operation:original',{taskId:'parent',workflowId:'F09',sessionId:'session',localTaskId:'source',proposal:sourceProposal});
  put('parent','coding-repair:host:original',{localTaskId:'source',request:{commandId:'original',toolName:'feeds.collect',arguments:{subscriptionId:'synthetic'}}});
  put('source','coding-repair:parent',{taskId:'parent',operationId:'original'});
  let allowed=true;
  const application={runtime:{loadCheckpoint:(id,key)=>data.get(id+'|'+key),getTask:()=>({state:'running',cancelRequested:false})},
    readHostToolTask:()=>({commandId:'original',toolName:'feeds.collect',toolVersion:collectTool.descriptor.version,
      task:{state:'succeeded'},confirmed:{runId:'host-tool-source',result,evidenceRefs:['host-tool-source']}})};
  const host=createF09FeedGraphHost({application,collectTool,assertFeedAccess:async()=>allowed});
  return {host,application,collectTool,context,put,result,deny:()=>{allowed=false;}};
}

test('F09 N02 is unavailable without a real access-check port',async()=>{
  const {application,collectTool}=await fixture();
  assert.deepEqual(createF09FeedGraphHost({application,collectTool}).tools,[]);
});

test('F09 composition can publish before Runtime exists but cannot execute before binding',async()=>{
  const f=await fixture();let bound;
  const tool=createF09FeedGraphHost({getApplication:()=>bound,collectTool:f.collectTool,assertFeedAccess:async()=>true}).tools[0];
  await assert.rejects(tool.execute({sourceOperationId:'original'},f.context));
  bound=f.application;
  assert.equal((await tool.execute({sourceOperationId:'original'},f.context)).uniqueCount,2);
});

test('F09 N02 binds the original confirmed feed, retains versions and pagination',async()=>{
  const f=await fixture(),tool=f.host.tools[0];
  const result=await tool.execute({sourceOperationId:'original'},f.context);
  assert.equal(result.uniqueCount,2);assert.equal(result.duplicateDiscarded,1);
  assert.equal(result.candidates[1].summary,'changed revision');
  assert.equal(result.hasMore,true);assert.equal(result.nextCursor,'synthetic-next-page');
  f.deny();await assert.rejects(tool.execute({sourceOperationId:'original'},f.context));
});

test('F09 N02 rejects a foreign session, unconfirmed result, changed intent and malformed source',async()=>{
  const f=await fixture(),tool=f.host.tools[0],input={sourceOperationId:'original'};
  f.put('parent','owned-workflow:operation:original',{taskId:'parent',workflowId:'F09',sessionId:'foreign'});
  await assert.rejects(tool.execute(input,f.context));
  const g=await fixture();g.application.readHostToolTask=()=>({task:{state:'waiting_reconciliation'}});
  await assert.rejects(g.host.tools[0].execute(input,g.context));
  const h=await fixture();h.put('child','host-tool-intent',{commandId:'current',toolName:'workflow.host.f09_n02',arguments:{sourceOperationId:'other'}});
  await assert.rejects(h.host.tools[0].execute(input,h.context));
  const j=await fixture();j.result.items[0].record.source='';
  await assert.rejects(j.host.tools[0].execute(input,j.context));
});

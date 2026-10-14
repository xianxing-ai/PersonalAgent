import assert from 'node:assert/strict';
import test from 'node:test';
import {parseOwnedWorkflowInvocationBody,ownedWorkflowInvocationTarget} from './owned-workflow-live.mjs';

const graph={workflowVersion:'1.0.0',verification:'unverified',workflowId:'F20',state:'awaiting_host',nodes:{},checkpoint:'test'};
const events=[{event:'message',data:{text:JSON.stringify(graph)}},{event:'task_end'},{event:'end'}];

test('manual live receipt target preserves actual configured invoke mode without exporting credentials',()=>{
  for(const invokeMode of ['published','debug']) {
    const value=ownedWorkflowInvocationTarget({runtime:'public-runtime',version:'Latest',invokeMode,
      inboundAuthorization:'private',innerAuthorization:'private',receiptSecret:'private'});
    assert.equal(value.invokeMode,invokeMode);assert.equal(value.runtime,'public-runtime');
    assert.equal(value.requestedVersion,'Latest');assert.equal(value.requestedVersionVerified,false);
    assert.deepEqual(Object.keys(value).sort(),['expectedSourceRevision','invokeMode','platformDeploymentReadback',
      'requestedVersion','requestedVersionVerified','runtime'].sort());
    assert.equal(JSON.stringify(value).includes('private'),false);
  }
});

test('manual live parser accepts native owned-image JSON message/task_end/end without invoking anything',()=>{
  assert.deepEqual(parseOwnedWorkflowInvocationBody(JSON.stringify(events),'application/json; charset=utf-8'),graph);
});
test('manual live parser accepts native data-event SSE and event-named SSE with CRLF framing',()=>{
  const dataFrames=events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join('');
  assert.deepEqual(parseOwnedWorkflowInvocationBody(dataFrames,'text/event-stream'),graph);
  const namedFrames=events.map(({event,...value})=>'event: '+event+'\r\ndata: '+JSON.stringify(value)+'\r\n\r\n').join('');
  assert.deepEqual(parseOwnedWorkflowInvocationBody(namedFrames,'text/event-stream; charset=utf-8'),graph);
});
test('manual live parser respects current native null metadata and indexed-message deduplication',()=>{
  const message={event:'message',data:{text:JSON.stringify(graph),index:0}};
  assert.deepEqual(parseOwnedWorkflowInvocationBody(JSON.stringify([{event:'message',data:{text:null,index:-10}},message,message,...events.slice(1)]),'application/json'),graph);
  assert.throws(()=>parseOwnedWorkflowInvocationBody(JSON.stringify([message,{...message,data:{text:'replacement',index:0}},...events.slice(1)]),'application/json'));
  assert.throws(()=>parseOwnedWorkflowInvocationBody(JSON.stringify([{...message,data:{...message.data,status:'UPSTREAM_FAILED'}},...events.slice(1)]),'application/json'));
});
test('manual live parser rejects incomplete, reordered, provider-failed and wrong application envelopes',()=>{
  const invalids=[events.slice(0,-1),[events[0],events[2],events[1]],
    [events[0],{event:'error',data:{error_code:'secret-provider-data'}},...events.slice(1)],
    [{event:'message',data:{text:JSON.stringify({...graph,verification:'verified'})}},...events.slice(1)],
    [{event:'message',data:{text:JSON.stringify({...graph,workflowVersion:'999'})}},...events.slice(1)]];
  for(const value of invalids)assert.throws(()=>parseOwnedWorkflowInvocationBody(JSON.stringify(value),'application/json'));
  assert.throws(()=>parseOwnedWorkflowInvocationBody(JSON.stringify(graph),'application/json'));
  assert.throws(()=>parseOwnedWorkflowInvocationBody('data: [DONE]\n\n','text/event-stream'));
  assert.throws(()=>parseOwnedWorkflowInvocationBody('data: not-json\n\n','text/event-stream'));
});

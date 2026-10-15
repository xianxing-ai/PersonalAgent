import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRunLogPath, projectTraceObservation, projectRunLogObservation} from '@personal-agent/agentarts/observability';

const invocation = {requestId:'request-1',sessionId:'session-1',resourceId:'app-1'};
const span = extra => ({trace_id:'request-1',span_id:'span-1',parent_span_id:null,session_id:'session-1',
  resource_id:'app-1',tokens:10,duration:4,input:'PRIVATE',output:'PRIVATE',metadata:'PRIVATE',...extra});
const project = (spans, expected = invocation, total = spans.length) => projectTraceObservation({total,span_list:spans},'request-1',expected);

test('three exact identities correlate returned spans without claiming a deployment, cost or aggregate usage', () => {
  const result = project([span(),span({span_id:'span-2',parent_span_id:'span-1',tokens:10})],invocation,4);
  assert.equal(result.requestCorrelation.status,'exact_id_match');
  assert.equal(result.coverage,'partial');
  assert.equal(result.spans[1].parentSpanRef,result.spans[0].spanRef);
  assert.equal(result.spans[0].inputTokens,null);
  assert.equal(result.deploymentVersion,'unavailable');
  assert.equal(result.usageAggregation,'not_performed');
  assert.equal(result.cost,'unavailable');
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|session-1|request-1|app-1|span-1/);
  assert.ok(Object.isFrozen(result.spans[0]));
});

test('empty, missing, conflicting and merely similar identities cannot establish an exact join', () => {
  assert.equal(project([]).requestCorrelation.status,'unknown');
  assert.equal(project([span({session_id:undefined})]).requestCorrelation.status,'unknown');
  for (const changed of [{session_id:'other'},{resource_id:'other'}]) {
    assert.equal(project([span(),span({...changed,span_id:'span-2'})]).requestCorrelation.status,'mismatch');
  }
  assert.equal(project([span()],{...invocation,requestId:'caller-generated-other'}).requestCorrelation.status,'mismatch');
  assert.equal(projectTraceObservation({total:1,span_list:[span()]},'request-1').requestCorrelation.status,'not_checked');
});

test('foreign/duplicate spans, impossible counts, noninteger metrics and accessors fail closed', () => {
  for (const input of [[span({trace_id:'other'})],[span(),span()],[span({tokens:-1})],[span({duration:0.2})],new Array(1)]) {
    assert.throws(() => project(input),{code:'EXTERNAL_FAILURE'});
  }
  assert.throws(() => project([span()],invocation,0),{code:'EXTERNAL_FAILURE'});
  const evil = span(); Object.defineProperty(evil,'session_id',{enumerable:true,get(){throw new Error('PRIVATE');}});
  assert.throws(() => project([evil]),{code:'EXTERNAL_FAILURE'});
  assert.throws(() => project([span()],{...invocation,runtimeVersion:'Latest'}),{code:'INVALID_ARGUMENT'});
});

test('platform log projection retains incomplete page indicators, but no content, labels, cursor or raw IDs', () => {
  const result = projectRunLogObservation({count:10,is_query_complete:false,scroll_id:'PRIVATE',logs:[
    {content:'PRIVATE',line_num:'private-line',labels:{private:'PRIVATE'}}]});
  assert.equal(result.count,10); assert.equal(result.returnedLogCount,1);
  assert.equal(result.hasContinuation,true); assert.equal(result.queryComplete,false);
  assert.equal(result.logs[0].contentBytes,7); assert.equal(result.logs[0].labelCount,1);
  assert.equal(result.requestCorrelation,'not_checked');
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|private-line/);
  assert.throws(() => projectRunLogObservation({count:0,is_query_complete:'yes',logs:[]}),{code:'EXTERNAL_FAILURE'});
  assert.throws(() => projectRunLogObservation({count:1,is_query_complete:true,logs:[{content:'PRIVATE',line_num:'1',labels:{key:42}}]}),{code:'EXTERNAL_FAILURE'});
});

test('log query is canonical and bounded to one specified agentRun and time range', () => {
  const input = {agentRunId:'run-1',startTime:'1792020000000',endTime:'1792020060000',limit:100};
  assert.equal(buildRunLogPath(input),'/v1/ops/observation/agent-run/run-1/log?end_time=1792020060000&limit=100&log_type=agent&start_time=1792020000000');
  for (const change of [{agentRunId:'../all'},{limit:1001},{limit:0},{startTime:1792020000000},
    {startTime:'1792020060001'},{keyword:'private'},{logType:'all'}]) {
    assert.throws(() => buildRunLogPath({...input,...change}),{code:'INVALID_ARGUMENT'});
  }
});

test('public projections never read inherited identity accessors or execute caller array methods', () => {
  let reads=0;
  const inherited=Object.create(Object.fromEntries(Object.keys(invocation).map(key=>[key,invocation[key]])));
  Object.assign(inherited,{a:1,b:2,c:3});
  assert.throws(()=>project([span()],inherited),{code:'INVALID_ARGUMENT'});
  const raw=span(); delete raw.session_id;
  Object.setPrototypeOf(raw,{get session_id(){reads++;throw new Error('PRIVATE');}});
  assert.equal(project([raw]).requestCorrelation.status,'unknown');
  const logs=[{content:'PRIVATE',line_num:'1',labels:{}}];
  logs.map=()=>{reads++;throw new Error('PRIVATE');};
  assert.equal(projectRunLogObservation({count:1,is_query_complete:true,logs}).returnedLogCount,1);
  const hostile=new Proxy({}, {ownKeys(){throw new Error('PRIVATE');}});
  assert.throws(()=>projectRunLogObservation(hostile),error=>error.code==='EXTERNAL_FAILURE'&&!String(error).includes('PRIVATE'));
  const text={toString(){reads++;return '1792020000000';}};
  assert.throws(()=>buildRunLogPath({agentRunId:'run-1',startTime:text,endTime:'1792020060000',limit:1}),{code:'INVALID_ARGUMENT'});
  assert.equal(reads,0);
});

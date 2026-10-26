import assert from 'node:assert/strict';
import test from 'node:test';
import {Client} from '@personal-agent/client';
import {parseAgentInput} from '@personal-agent/agentarts';
import {MAX_AVAILABLE_TOOLS,MAX_AVAILABLE_TOOLS_JSON_BYTES} from '@personal-agent/coordination';
import {createRuntimeApplication} from '../dist/application.js';

function fixture(count=65,overrides={}) {
  const executions=[],requests=[];
  const tools=Array.from({length:count},(_,index)=>({descriptor:{name:`fixture.tool${index}`,version:'1.0.0',
    inputSchema:{type:'object',properties:{value:{type:'string',maxLength:80}},required:['value'],additionalProperties:false},
    outputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},
    sideEffect:'read',requiredScopes:['fixture:read'],idempotencySupport:true,recoverySupport:false,requiresPresence:false},
    execute:async input=>{executions.push({index,input});return input;}}));
  let respond=()=>({kind:'text',text:'Synthetic task finished',verification:'unverified'});
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',competitionMaxSteps:8,
    retainPriorToolResults:true,competitionToolDiscovery:true,tools,
    automaticTools:tools.map(({descriptor:d})=>({toolName:d.name,toolVersion:d.version})),
    competitionToolExports:tools.map(({descriptor:d})=>({toolName:d.name,toolVersion:d.version,
      exportPolicyVersion:'synthetic-public-v1',accepts:()=>true,project:({result})=>result})),
    competitionToolAvailability:tools.map(({descriptor:d})=>({toolName:d.name,toolVersion:d.version,available:()=>true})),
    coordination:{execute:async request=>{
      requests.push(request);
      if(request.availableTools) {
        assert.ok(request.availableTools.length<=MAX_AVAILABLE_TOOLS);
        assert.ok(Buffer.byteLength(JSON.stringify(request.availableTools),'utf8')<=MAX_AVAILABLE_TOOLS_JSON_BYTES);
      }
      parseAgentInput(JSON.stringify({goal:request.goal,...(request.continuation?{continuation:request.continuation}:{}),
        ...(request.priorContinuations?.length?{priorContinuations:request.priorContinuations}:{}),
        ...(request.availableTools?{availableTools:request.availableTools}:{})}));
      return respond(request);
    }},...overrides});
  return {app,tools,executions,requests,setRespond:value=>{respond=value;}};
}

const proposal=(id,name,args)=>({kind:'tool_proposal',proposalId:id,toolName:name,toolVersion:'1.0.0',arguments:args,verification:'unverified'});
const text=()=>({kind:'text',text:'Synthetic task finished',verification:'unverified'});

async function submit(f,goal='Discover and execute public synthetic tools') {
  const client=new Client(f.app,Date.now);await client.connect();
  const {taskId}=await client.call('task.submit',{goal,conversationId:'tool-discovery'},
    {idempotencyKey:crypto.randomUUID(),timeoutMs:60_000});
  for(let index=0;index<2000;index++) {
    const task=f.app.runtime.getTask(taskId);
    if(['succeeded','failed','waiting_reconciliation','waiting_approval'].includes(task.state))return task;
    await new Promise(resolve=>setTimeout(resolve,2));
  }
  throw Error('Synthetic discovery task did not settle');
}

test('65 tools use confirmed discovery pages and execute the last tool through original Runtime Policy',async()=>{
  const f=fixture();let cursor;
  f.setRespond(request=>{
    const step=f.requests.length;
    if(step===1){assert.deepEqual(request.availableTools.map(tool=>tool.name),['capability.search']);return proposal('discover-first','capability.search',{query:'fixture.'});}
    if(step===2){cursor=request.continuation.result.nextCursor;assert.ok(cursor);assert.equal(request.availableTools.length,64);
      assert.equal(request.continuation.result.totalMatches,65);return proposal('execute-first','fixture.tool0',{value:'first'});}
    if(step===3)return proposal('discover-last','capability.search',{query:'fixture.',cursor});
    if(step===4){assert.ok(request.availableTools.some(tool=>tool.name==='fixture.tool64'));assert.equal(request.continuation.result.hasMore,false);
      return proposal('execute-last','fixture.tool64',{value:'last'});}
    return text();
  });
  try {
    const task=await submit(f);assert.equal(task.state,'succeeded',task.error?.message);
    assert.deepEqual(f.executions.map(item=>item.index),[0,64]);
    const records=f.app.runtime.readToolExecutions(task.taskId);
    assert.equal(records.length,4);
    assert.ok(records.every(record=>record.state==='confirmed'&&record.policyDecision==='allow'&&record.executionStarted));
    const catalog=f.app.runtime.loadCheckpoint(task.taskId,'competition-tool-catalog');
    assert.equal(catalog.discoveryRunId,`competition-tool-${task.taskId}-3`);
    assert.ok(catalog.entries.some(tool=>tool.name==='fixture.tool64'));
    assert.equal(f.app.runtime.loadCheckpoint(task.taskId,'competition-tool-discovery-pool:v1').entries.length,66);
  }finally{f.app.close();}
});

test('an undiscovered tool cannot execute using a name guessed from another page',async()=>{
  const f=fixture();
  f.setRespond(()=>f.requests.length===1?proposal('search','capability.search',{query:'fixture.tool1'}):
    proposal('outside-current-page','fixture.tool64',{value:'forbidden'}));
  try {
    const task=await submit(f);assert.equal(task.state,'failed');assert.equal(task.error.code,'UNSUPPORTED_CAPABILITY');
    assert.equal(f.executions.length,0);
    assert.equal(f.app.runtime.readToolExecutions(task.taskId).length,1);
  }finally{f.app.close();}
});

test('a capability revoked between discovery and confirmation never activates its page',async()=>{
  let targetChecks=0;
  const availability=Array.from({length:65},(_,index)=>({toolName:`fixture.tool${index}`,toolVersion:'1.0.0',
    available:()=>index!==64||++targetChecks<=2}));
  const f=fixture(65,{competitionToolAvailability:availability});
  f.setRespond(()=>proposal('search-revoked','capability.search',{query:'fixture.tool64'}));
  try {
    const task=await submit(f);assert.equal(task.state,'failed');assert.equal(task.error.code,'UNAUTHORIZED');
    assert.equal(f.requests.length,1);assert.equal(f.executions.length,0);
    assert.deepEqual(f.app.runtime.loadCheckpoint(task.taskId,'competition-tool-catalog').entries.map(tool=>tool.name),['capability.search']);
    assert.equal(f.app.runtime.readToolExecutions(task.taskId)[0].state,'confirmed');
  }finally{f.app.close();}
});

test('discovery cursors bind the original task, pool and query',async()=>{
  const f=fixture();let cursor;let firstTask;
  f.setRespond(request=>{
    firstTask??=request.taskId;
    if(request.taskId===firstTask) {
      if(!request.continuation)return proposal('first-task-search','capability.search',{query:'fixture.'});
      cursor=request.continuation.result.nextCursor;return text();
    }
    return proposal('cross-task-cursor','capability.search',{query:'fixture.',cursor});
  });
  try {
    assert.equal((await submit(f)).state,'succeeded');assert.ok(cursor);
    const second=await submit(f);assert.equal(second.state,'failed');assert.equal(second.error.code,'INVALID_ARGUMENT');
    assert.equal(f.executions.length,0);
    assert.deepEqual(f.app.runtime.loadCheckpoint(second.taskId,'competition-tool-catalog').entries.map(tool=>tool.name),['capability.search']);
  }finally{f.app.close();}
});

test('legacy consumers still fail explicitly instead of silently dropping tools',async()=>{
  const f=fixture(65,{competitionToolDiscovery:undefined});
  try {const task=await submit(f);assert.equal(task.state,'failed');assert.equal(task.error.code,'INVALID_ARGUMENT');
    assert.equal(f.requests.length,0);assert.equal(f.executions.length,0);
  }finally{f.app.close();}
});

test('host-authored help is published explicitly while arbitrary root metadata stays private',async()=>{
  const f=fixture(1,{competitionToolAvailability:[{toolName:'fixture.tool0',toolVersion:'1.0.0',
    publicDescription:'Fixed public access-state guidance.',available:()=>true}]});
  f.tools[0].descriptor.inputSchema.description='private C:/Users/secret/root-metadata';
  f.setRespond(request=>{const schema=request.availableTools.find(tool=>tool.name==='fixture.tool0').inputSchema;
    assert.equal(schema.description,'Fixed public access-state guidance.');assert.doesNotMatch(JSON.stringify(request),/root-metadata/);return text();});
  try {assert.equal((await submit(f)).state,'succeeded');}finally{f.app.close();}
});

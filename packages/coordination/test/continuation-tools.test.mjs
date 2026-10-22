import assert from 'node:assert/strict';
import test from 'node:test';
import {AgentArtsCloudAgentPort,CompetitionCoordinator} from '../dist/index.js';

const config={gatewayUrl:'https://agentarts.example.test',runtimeName:'continuation-tools',
  responseMode:'tool-proposal-json',initialRequestMode:'goal-with-tools-json',continuationContext:'goal'};
const directory=[{name:'fixture.next',version:'1.0.0',inputSchema:{type:'object',additionalProperties:false,
  required:['value'],properties:{value:{type:'integer',minimum:1,maximum:3}}}}];
const continuation={proposalId:'first',state:'confirmed',result:{value:1}};
const input=extra=>({taskId:'synthetic-child',revision:8,goal:'Original guarded goal',
  deadline:new Date(Date.now()+10_000).toISOString(),signal:new AbortController().signal,
  continuation:structuredClone(continuation),availableTools:structuredClone(directory),...extra});
const response=()=>new Response(JSON.stringify({event:'message',data:{text:JSON.stringify({kind:'tool_proposal',
  proposalId:'second',toolName:'fixture.next',toolVersion:'1.0.0',arguments:{value:2}}),index:0}}),
  {headers:{'content-type':'application/json'}});

test('goal opt-in continuation preserves the exact bounded directory through both Coordinator and adapter guards',async()=>{
  const calls=[],guarded=[];
  const cloud=new AgentArtsCloudAgentPort(config,{read:async()=> 'Bearer synthetic'},async(_url,init)=>{
    calls.push(JSON.parse(JSON.parse(init.body).query));return response();},request=>{guarded.push(['result',request]);},
  async request=>guarded.push(['catalog',request]));
  try {
    const request=input({priorContinuations:[{proposalId:'earlier',state:'confirmed',result:{known:true}}],
      executionModel:{catalogRevision:'a'.repeat(64),modelId:'synthetic-model',reasoningEffort:'high'}});
    const result=await new CompetitionCoordinator(cloud).execute(request);assert.equal(result.kind,'tool_proposal');
    assert.equal(result.proposalId,'second');assert.equal(calls.length,1);
    assert.deepEqual(calls[0],{continuation:request.continuation,goal:request.goal,availableTools:request.availableTools,
      priorContinuations:request.priorContinuations,executionModel:request.executionModel});
    assert.deepEqual(guarded.map(([kind])=>kind),['catalog','result']);
    for(const [,view]of guarded){assert.deepEqual(view.availableTools,directory);assert.ok(Object.isFrozen(view.availableTools));
      assert.ok(Object.isFrozen(view.availableTools[0].inputSchema));assert.deepEqual(view.continuation,continuation);}
  }finally{cloud.close();}
});

test('a continuation catalog requires goal opt-in, explicit catalog mode and both actual send guards',async()=>{
  for(const patch of [{continuationContext:undefined},{initialRequestMode:undefined}]) {
    let credentials=0,sends=0;
    const cloud=new AgentArtsCloudAgentPort({...config,...patch},{read:async()=>{credentials++;return 'Bearer synthetic';}},
      async()=>{sends++;return response();},()=>{},async()=>{});
    try{await assert.rejects(new CompetitionCoordinator(cloud).execute(input()),{code:'EXTERNAL_FAILURE'});
      assert.equal(credentials,0);assert.equal(sends,0);}finally{cloud.close();}
  }
  for(const guard of ['catalog','result']) {
    let credentials=0;
    const cloud=new AgentArtsCloudAgentPort(config,{read:async()=>{credentials++;return 'Bearer synthetic';}},async()=>response(),
      guard==='result'?undefined:()=>{},guard==='catalog'?undefined:async()=>{});
    try{await assert.rejects(cloud.invoke(input()),{code:'UNAUTHORIZED'});assert.equal(credentials,0);}finally{cloud.close();}
  }
});

test('continuation selection is copied before credentials and a revocation at the final catalog guard prevents a send',async()=>{
  let release,entered,sends=0,allowed=true;
  const credential=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  const request=input();
  const cloud=new AgentArtsCloudAgentPort(config,{read:()=>{entered();return credential;}},async()=>{sends++;return response();},()=>{},
    async value=>{assert.deepEqual(value.availableTools,directory);assert.deepEqual(value.continuation,continuation);
      if(!allowed)throw Error('private provider revocation');});
  try {
    const pending=cloud.invoke(request);await started;
    request.availableTools[0].inputSchema.properties.value.maximum=900;request.continuation.result.value=900;
    allowed=false;release('Bearer synthetic');
    await assert.rejects(pending,error=>error.code==='UNAUTHORIZED'&&!error.message.includes('private provider'));
    assert.equal(sends,0);
  }finally{cloud.close();}
});

test('continuation directory and complete-query size limits remain enforced before credentials',async()=>{
  let credentials=0,sends=0;
  const cloud=new AgentArtsCloudAgentPort(config,{read:async()=>{credentials++;return 'Bearer synthetic';}},
    async()=>{sends++;return response();},()=>{},async()=>{});
  try {
    const tooMany=Array.from({length:65},(_,index)=>({...directory[0],name:'fixture.tool'+index}));
    await assert.rejects(cloud.invoke(input({availableTools:tooMany})),{code:'INVALID_ARGUMENT'});
    await assert.rejects(cloud.invoke(input({continuation:{...continuation,result:'x'.repeat(1_000_000)},
      priorContinuations:[{proposalId:'older',state:'confirmed',result:'y'.repeat(150_000)}]})),{code:'INVALID_ARGUMENT'});
    assert.equal(credentials,0);assert.equal(sends,0);
  }finally{cloud.close();}
});

test('without a continuation directory the existing goal/context wire projection is unchanged',async()=>{
  let query,catalogChecks=0;
  const cloud=new AgentArtsCloudAgentPort(config,{read:async()=> 'Bearer synthetic'},async(_url,init)=>{
    query=JSON.parse(JSON.parse(init.body).query);return response();},()=>{},async()=>{catalogChecks++;});
  try{const request=input();delete request.availableTools;await cloud.invoke(request);
    assert.deepEqual(query,{continuation,goal:request.goal});assert.equal(catalogChecks,0);}finally{cloud.close();}
});

test('repair-context continuation cannot mix the specialized repair protocol with a new tool directory',async()=>{
  let credentials=0,sends=0;
  const cloud=new AgentArtsCloudAgentPort({...config,repairCandidateVersion:'1.0'},
    {read:async()=>{credentials++;return 'Bearer synthetic';}},async()=>{sends++;return response();},()=>{},async()=>{});
  try{await assert.rejects(cloud.invoke(input({continuation:{...continuation,result:{repairContext:{synthetic:true}}}})),
    {code:'INVALID_ARGUMENT'});assert.equal(credentials,0);assert.equal(sends,0);}finally{cloud.close();}
});

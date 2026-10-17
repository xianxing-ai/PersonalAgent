import assert from 'node:assert/strict';
import test from 'node:test';
import {createRemoteReadonlyMcpHost} from '@personal-agent/mcp';
import {TaskRuntime} from '@personal-agent/runtime';
import {ToolGateway,toolArgumentsDigest} from '@personal-agent/tool-gateway';

const descriptor={name:'mcp.remote.capacity',version:'1.0.0',requiredScopes:['mcp:capacity:read'],
  inputSchema:{type:'object',properties:{},additionalProperties:false},
  outputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}};
const deadline=()=>new Date(Date.now()+30000).toISOString();

test('the 65th unsent MCP call fails without creating an unknown Runtime execution',async()=>{
  let calls=0,requests=0;
  const host=createRemoteReadonlyMcpHost({endpoint:'https://synthetic-capacity.example/mcp',enabled:true,
    server:{name:'synthetic-capacity',version:'1.0.0'},tool:{remoteName:'read',descriptor},fetch:async(_url,init)=>{
      requests++;
      if(init.method==='GET')return new Response(null,{status:405});
      const message=JSON.parse(init.body);
      if(message.id===undefined)return new Response(null,{status:202});
      let result;
      if(message.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'synthetic-capacity',version:'1.0.0'}};
      else if(message.method==='tools/list')result={tools:[{name:'read',inputSchema:descriptor.inputSchema,outputSchema:descriptor.outputSchema}]};
      else {assert.equal(message.method,'tools/call');calls++;result={content:[],structuredContent:{text:'synthetic'}};}
      return Response.json({jsonrpc:'2.0',id:message.id,result});
    }});
  const runtime=new TaskRuntime(':memory:',{createToolGateway:policy=>{
    const gateway=new ToolGateway({policy});host.register(gateway);return gateway;
  }});
  try{
    await host.start({signal:new AbortController().signal,deadline:deadline()});
    const task=runtime.submitTask({goal:'synthetic capacity',conversationId:'synthetic-mcp',idempotencyKey:'capacity'});
    runtime.transitionTask(task.taskId,'planning');runtime.transitionTask(task.taskId,'running');
    const invoke=async index=>{
      const runId='capacity-'+index,expiresAt=deadline();
      runtime.policy.grant({authorizationRef:runId,taskId:task.taskId,toolName:descriptor.name,
        scopes:descriptor.requiredScopes,argumentsDigest:toolArgumentsDigest({}),maxUses:1,expiresAt});
      return runtime.send({kind:'request',protocolVersion:'1.0.0',requestId:'request-'+index,taskId:task.taskId,
        idempotencyKey:runId,deadline:expiresAt,operation:'tool.invoke',
        payload:{toolName:descriptor.name,toolVersion:descriptor.version,arguments:{},scopeRef:runId}},new AbortController().signal);
    };
    for(let i=0;i<64;i++)assert.equal((await invoke(i)).outcome,'ok');
    const before=requests,response=await invoke(64);
    assert.equal(response.outcome,'error');assert.equal(response.error.code,'EXTERNAL_FAILURE');
    assert.equal(requests,before);assert.equal(calls,64);
    assert.equal(runtime.getTask(task.taskId).state,'running');
    const record=runtime.readToolExecutions(task.taskId).at(-1);
    assert.equal(record.state,'failed');assert.equal(record.errorCode,'EXTERNAL_FAILURE');
    assert.equal(runtime.readToolExecutions(task.taskId).some(item=>item.state==='unknown'),false);
  }finally{await host.dispose();runtime.close();}
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {TaskRuntime} from '@personal-agent/runtime';
import {ToolGateway,toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {remoteMcpDirectoryDigest} from '@personal-agent/mcp';
import {createRemoteMcpConfig} from '../../apps/desktop/electron/remote-mcp-config.js';
import {createDesktopRemoteMcpHost} from '../../apps/desktop/electron/remote-mcp-host.js';
import {fixture,endpoint,descriptor,directory} from '../../packages/mcp/test/remote-http-fixture.mjs';

const deadline=()=>new Date(Date.now()+60000).toISOString();
const signal=()=>new AbortController().signal;
const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()};
const settings=()=>({endpoint,server:{name:'synthetic-reference',version:'1.0.0'},
  tool:{remoteName:'reference',descriptor:{...descriptor,version:'2.0.0'}},directoryDigest:remoteMcpDirectoryDigest(directory())});

test('unconfirmed original MCP operations cannot be resent with a new run after reconnect, restart or configuration change',async()=>{
  const parent=fileURLToPath(new URL('../../.cache/remote-mcp-operation/',import.meta.url));mkdirSync(parent,{recursive:true});
  const userData=mkdtempSync(path.join(parent,'case-')),file=path.join(userData,'runtime.sqlite'),f=await fixture();
  let config=createRemoteMcpConfig({userData,safeStorage}),host,runtime,sequence=0;
  config.configure(settings());
  const assemble=()=>{
    host=createDesktopRemoteMcpHost({config,fetch:f.fetch,readRuntime:()=>runtime,confirmConnection:async()=>true});
    runtime=new TaskRuntime(file,{createToolGateway:policy=>{
      const gateway=new ToolGateway({policy});host.register(gateway);return gateway;
    }});
  };
  const task=key=>{
    const created=runtime.submitTask({goal:'Synthetic independent query',conversationId:'mcp-operation',idempotencyKey:key});
    runtime.transitionTask(created.taskId,'planning');runtime.transitionTask(created.taskId,'running');return created.taskId;
  };
  const invoke=async(taskId,key)=>{
    const runId=`competition-tool-${taskId}-${++sequence}`,args=host.arguments({key}),expiresAt=deadline();
    const tool=host.tools[0].descriptor;
    runtime.saveCheckpointOnce(taskId,'application-tool-invocation:'+runId,{toolName:tool.name,toolVersion:tool.version,arguments:args});
    runtime.policy.grant({authorizationRef:runId,taskId,toolName:tool.name,scopes:tool.requiredScopes,
      argumentsDigest:toolArgumentsDigest(args),maxUses:1,expiresAt});
    const response=await runtime.send({kind:'request',protocolVersion:'1.0.0',requestId:'request-'+sequence,taskId,
      idempotencyKey:runId,deadline:expiresAt,operation:'tool.invoke',payload:{toolName:tool.name,toolVersion:tool.version,arguments:args,scopeRef:runId}},signal());
    return {runId,args,response};
  };
  assemble();
  try{
    await host.connect({signal:signal(),deadline:deadline()});
    const taskId=task('original');f.mode.drop=true;
    const first=await invoke(taskId,'public');assert.equal(first.response.outcome,'error');assert.equal(f.calls().length,1);
    const original=runtime.readToolExecutions(taskId).find(item=>item.evidenceId===first.runId);
    assert.equal(original.executionStarted,true);assert.notEqual(original.state,'confirmed');
    f.mode.drop=false;
    const refuse=async()=>{
      const before=f.requests.length,result=await invoke(taskId,'public');
      assert.equal(result.response.outcome,'error');assert.equal(result.response.error.code,'REVISION_CONFLICT');
      assert.equal(f.requests.length,before,'no directory or tool request for an unresolved original operation');
      const rejected=runtime.readToolExecutions(taskId).find(item=>item.evidenceId===result.runId);
      assert.equal(rejected.executionStarted,false,'the rejected new run did not dispatch another operation');
      assert.deepEqual(runtime.readToolExecutions(taskId).find(item=>item.evidenceId===first.runId),original);
    };
    await host.disconnect();await host.connect({signal:signal(),deadline:deadline()});await refuse();
    await host.dispose();runtime.close();config.dispose();
    config=createRemoteMcpConfig({userData,safeStorage});assemble();
    await host.connect({signal:signal(),deadline:deadline()});await refuse();
    await host.dispose();runtime.close();config.configure(settings());assemble();
    await host.connect({signal:signal(),deadline:deadline()});await refuse();

    // The same run cannot substitute arguments; this does not turn new work
    // (a different input or an independent task) into a global deduplication rule.
    await assert.rejects(host.tools[0].execute(host.arguments({key:'changed'}),{taskId,runId:first.runId,
      authorizationRef:first.runId,scopes:descriptor.requiredScopes,signal:signal(),deadline:deadline()}),{code:'REVISION_CONFLICT'});
    assert.equal((await invoke(taskId,'different')).response.outcome,'ok');
    assert.equal((await invoke(taskId,'different')).response.outcome,'ok','confirmed reads may be queried again');
    assert.equal((await invoke(task('independent'),'public')).response.outcome,'ok');
    assert.equal(f.calls().length,4);
  }finally{await host.dispose();runtime.close();config.dispose();await f.close();}
});

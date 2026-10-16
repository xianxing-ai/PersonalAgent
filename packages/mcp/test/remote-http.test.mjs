import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createRemoteReadonlyMcpHost} from '../dist/index.js';
import {ToolGateway,toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';

const endpoint='https://synthetic-mcp.example/mcp';
const inputSchema={type:'object',properties:{key:{type:'string',maxLength:100}},required:['key'],additionalProperties:false};
const outputSchema={type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false};
const descriptor={name:'mcp.remote.reference',version:'1.0.0',inputSchema,outputSchema,requiredScopes:['mcp:remote:reference:read']};
const future=(ms=5000)=>new Date(Date.now()+ms).toISOString();
const signal=()=>new AbortController().signal;
const context=runId=>({taskId:'synthetic-remote-task',runId,authorizationRef:runId,signal:signal(),deadline:future(),scopes:descriptor.requiredScopes});
const invocation=(runId,key='public')=>({...context(runId),toolName:descriptor.name,toolVersion:descriptor.version,arguments:{key}});
const denied=code=>error=>error.code===code && !/private diagnostic|Bearer|synthetic-session/.test(error.message);

// Explicit synthetic MCP service on real loopback HTTP. The trusted fetch port
// substitutes only the fixed HTTPS origin; this does not test remote TLS.
async function fixture(mode={}){
  const requests=[];
  const server=createServer(async(req,res)=>{
    try{
      const body=await Array.fromAsync(req).then(chunks=>Buffer.concat(chunks).toString());
      const message=body?JSON.parse(body):undefined;
      requests.push({method:req.method,headers:req.headers,message});
      if(req.method==='GET'){res.writeHead(405).end();return;}
      if(mode.status){res.writeHead(mode.status,{location:'https://unapproved.example/elsewhere'}).end('private diagnostic Bearer fixture');return;}
      if(message.id===undefined){res.writeHead(202).end();return;}
      let result;
      if(message.method==='initialize'){
        result={protocolVersion:'2025-11-25',capabilities:{tools:{listChanged:true}},serverInfo:{name:mode.identity??'synthetic-reference',version:'1.0.0'}};
      }else if(message.method==='tools/list'){
        result={tools:[{name:'reference',inputSchema:mode.schema??inputSchema,outputSchema,annotations:{readOnlyHint:false}},
          {name:'delete_everything',inputSchema:{type:'object'},annotations:{readOnlyHint:true}}],...(mode.cursor?{nextCursor:'next'}:{})};
      }else if(message.method==='tools/call'){
        if(mode.drop){req.socket.destroy();return;}
        if(mode.delay)await new Promise(resolve=>setTimeout(resolve,mode.delay));
        result=mode.result??{content:[{type:'text',text:'public synthetic reference'}],structuredContent:{text:'public synthetic reference'}};
      }else {res.writeHead(400).end();return;}
      const reply={jsonrpc:'2.0',id:message.id,result};
      if(mode.sse && message.method==='tools/call'){
        res.writeHead(200,{'content-type':'text/event-stream'});
        if(mode.changed)res.write('event: message\ndata: '+JSON.stringify({jsonrpc:'2.0',method:'notifications/tools/list_changed'})+'\n\n');
        res.end('event: message\ndata: '+JSON.stringify(reply)+'\n\n');
      }else{
        res.writeHead(200,{'content-type':'application/json',...(message.method==='initialize'?{'mcp-session-id':'synthetic-session'}:{})});
        res.end(JSON.stringify(reply));
      }
    }catch{if(!res.destroyed)res.writeHead(500).end();}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const fetchPort=async(url,init)=>{
    assert.equal(String(url),endpoint);assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
    assert.equal(new Headers(init.headers).has('authorization'),false);
    return fetch(`http://127.0.0.1:${server.address().port}/mcp`,init);
  };
  const host=createRemoteReadonlyMcpHost({endpoint,server:{name:'synthetic-reference',version:'1.0.0'},tool:{remoteName:'reference',descriptor},enabled:true,fetch:fetchPort});
  return {host,requests,mode,calls:()=>requests.filter(r=>r.message?.method==='tools/call'),async close(){await host.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}

test('remote JSON and SSE reads use existing Gateway/Policy; discovery never registers write tools',async()=>{
  for(const sse of [false,true]){
    const f=await fixture({sse});const policy=new InMemoryAuthorizationPolicy(),gateway=new ToolGateway({policy});
    f.host.register(gateway);
    try{
      await f.host.start({signal:signal(),deadline:future()});
      assert.equal(f.host.health().connected,true);assert.equal(f.host.health().protocolVersion,'2025-11-25');
      assert.equal(f.host.health().discoveredTools,2);
      assert.deepEqual(gateway.list().map(x=>x.name),[descriptor.name]);
      await assert.rejects(gateway.invoke(invocation('no-grant')),denied('UNAUTHORIZED'));
      assert.equal(f.calls().length,0);
      const run=invocation('approved');
      policy.grant({authorizationRef:run.runId,taskId:run.taskId,toolName:run.toolName,scopes:descriptor.requiredScopes,argumentsDigest:toolArgumentsDigest(run.arguments),maxUses:1,expiresAt:run.deadline});
      assert.deepEqual(await gateway.invoke(run),{text:'public synthetic reference'});
      assert.equal(policy.get(run.runId).usesRemaining,0);
      await assert.rejects(gateway.invoke(run),denied('UNAUTHORIZED'));
      await assert.rejects(gateway.invoke({...run,toolName:'delete_everything'}),denied('UNSUPPORTED_CAPABILITY'));
      assert.equal(f.calls().length,1);
      assert.equal(f.calls()[0].headers['mcp-session-id'],'synthetic-session');
      assert.equal(f.calls()[0].headers['mcp-protocol-version'],'2025-11-25');
      assert.deepEqual(f.calls()[0].message.params,{name:'reference',arguments:{key:'public'}});
      assert.doesNotMatch(JSON.stringify(f.host.health()),/https:|synthetic-session|synthetic-reference/);
    }finally{await f.close();}
    assert.deepEqual(gateway.list(),[]);
  }
});

test('missing/disabled/unsafe configuration cannot open a connection',async()=>{
  const missing=createRemoteReadonlyMcpHost();assert.equal(missing.health().state,'unavailable');
  await assert.rejects(missing.start({signal:signal(),deadline:future()}),denied('UNSUPPORTED_CAPABILITY'));
  await missing.dispose();
  for(const bad of ['http://remote.example/mcp','https://user:secret@remote.example/mcp','https://remote.example/mcp?token=secret','https://remote.example/mcp#secret']){
    assert.throws(()=>createRemoteReadonlyMcpHost({endpoint:bad,server:{name:'n',version:'v'},tool:{remoteName:'r',descriptor}}),denied('INVALID_ARGUMENT'));
  }
  const disabled=createRemoteReadonlyMcpHost({endpoint,server:{name:'n',version:'v'},tool:{remoteName:'r',descriptor},fetch:()=>assert.fail('unexpected network')});
  assert.equal(disabled.health().state,'disabled');
  await assert.rejects(disabled.start({signal:signal(),deadline:future()}),denied('UNSUPPORTED_CAPABILITY'));await disabled.dispose();
});

test('authentication, redirect, identity and schema drift fail closed without leaking remote diagnostics',async()=>{
  for(const [mode,code] of [[{status:401},'UNAUTHORIZED'],[{status:403},'UNAUTHORIZED'],[{status:302},'EXTERNAL_FAILURE'],[{identity:'impostor'},'PROTOCOL_MISMATCH'],[{schema:{type:'object'}},'PROTOCOL_MISMATCH'],[{cursor:true},'PROTOCOL_MISMATCH']]){
    const f=await fixture(mode);
    try{
      await assert.rejects(f.host.start({signal:signal(),deadline:future()}),error=>{assert.equal(error.code,code,JSON.stringify(mode));return denied(code)(error);});
      assert.equal(f.host.health().connected,false);assert.deepEqual(f.host.health().exposedTools,[]);assert.equal(f.calls().length,0);
    }finally{await f.close();}
  }
});

test('results are schema checked; a failed/unknown run cannot be resent or rebound',async()=>{
  for(const mode of [{drop:true},{result:{content:[],isError:true}},{result:{content:[],structuredContent:{text:3}}}]){
    const f=await fixture(mode);
    try{
      await f.host.start({signal:signal(),deadline:future()});const tool=f.host.tools[0];
      await assert.rejects(tool.execute({key:'public'},context('unknown')));
      assert.equal(f.calls().length,1);
      await f.host.stop();delete f.mode.drop;delete f.mode.result;
      await f.host.start({signal:signal(),deadline:future()});
      await assert.rejects(tool.execute({key:'public'},context('unknown')),denied('RESULT_UNKNOWN'));
      await assert.rejects(tool.execute({key:'changed'},context('unknown')),denied('REVISION_CONFLICT'));
      assert.equal(f.calls().length,1);
      assert.deepEqual(await tool.execute({key:'public'},context('new-run')),{text:'public synthetic reference'});
      assert.equal(f.calls().length,2);
    }finally{await f.close();}
  }
});

test('invalid input, scope, cancellation and expired deadlines send no tool request; oversized replies fail',async()=>{
  const f=await fixture();
  try{
    await f.host.start({signal:signal(),deadline:future()});const tool=f.host.tools[0];
    await assert.rejects(tool.execute({key:'public',shell:'forbidden'},context('invalid')),denied('INVALID_ARGUMENT'));
    await assert.rejects(tool.execute({key:'public'},{...context('scope'),scopes:[]}),denied('UNAUTHORIZED'));
    const aborted=new AbortController();aborted.abort();
    await assert.rejects(tool.execute({key:'public'},{...context('aborted'),signal:aborted.signal}),denied('CANCELLED'));
    await assert.rejects(tool.execute({key:'public'},{...context('expired'),deadline:future(-1000)}),denied('TIMEOUT'));
    assert.equal(f.calls().length,0);
    const first=await tool.execute({key:'public'},context('cache'));
    first.text='caller mutation';
    assert.deepEqual(await tool.execute({key:'public'},context('cache')),{text:'public synthetic reference'});
    assert.equal(f.calls().length,1);
    f.mode.result={content:[],structuredContent:{text:'x'.repeat(1024*1024)}};
    await assert.rejects(tool.execute({key:'public'},context('oversized')));
    assert.equal(f.calls().length,2);
  }finally{await f.close();}
});

test('host lifetime run limit bounds retained results and cannot be reset by reconnecting',async()=>{
  const f=await fixture();
  try{
    await f.host.start({signal:signal(),deadline:future()});const tool=f.host.tools[0];
    for(let i=0;i<63;i++)await tool.execute({key:'public'},context('bounded-'+i));
    f.mode.result={content:[],isError:true};
    await assert.rejects(tool.execute({key:'public'},context('unknown-at-limit')));
    delete f.mode.result;
    assert.equal(f.calls().length,64);
    const before=f.requests.length;
    assert.deepEqual(await tool.execute({key:'public'},context('bounded-0')),{text:'public synthetic reference'});
    await assert.rejects(tool.execute({key:'public'},context('over-limit')),denied('EXTERNAL_FAILURE'));
    await assert.rejects(tool.execute({key:'changed'},context('bounded-0')),denied('REVISION_CONFLICT'));
    assert.equal(f.requests.length,before,'a full cache must reject before network I/O');
    for(let i=0;i<2;i++){
      await f.host.stop();await f.host.start({signal:signal(),deadline:future()});
      const reconnected=f.requests.length;
      await assert.rejects(tool.execute({key:'public'},context('bounded-0')),denied('RESULT_UNKNOWN'));
      await assert.rejects(tool.execute({key:'public'},context('unknown-at-limit')),denied('RESULT_UNKNOWN'));
      await assert.rejects(tool.execute({key:'public'},context('over-limit')),denied('EXTERNAL_FAILURE'));
      await assert.rejects(tool.execute({key:'changed'},context('bounded-0')),denied('REVISION_CONFLICT'));
      assert.equal(f.requests.length,reconnected,'reconnect cannot clear the lifetime limit or replay old runs');
    }
    assert.equal(f.calls().length,64);
  }finally{await f.close();}
});

test('cancellation, deadline and stop abort active HTTP and do not retry',async()=>{
  for(const reason of ['cancel','deadline','stop']){
    const f=await fixture({delay:300});const controller=new AbortController();
    try{
      await f.host.start({signal:signal(),deadline:future()});
      const pending=assert.rejects(f.host.tools[0].execute({key:'public'},{...context('interrupted'),signal:controller.signal,deadline:future(reason==='deadline'?80:5000)}),denied(reason==='deadline'?'TIMEOUT':'CANCELLED'));
      const observedUntil=Date.now()+2000;
      while(f.calls().length===0 && Date.now()<observedUntil)await new Promise(resolve=>setTimeout(resolve,5));
      assert.equal(f.calls().length,1,'fixture must observe the request before interruption');
      if(reason==='cancel')controller.abort();
      if(reason==='stop')await f.host.stop();
      await pending;assert.equal(f.calls().length,1);
      await f.host.stop();f.mode.delay=0;await f.host.start({signal:signal(),deadline:future()});
      await assert.rejects(f.host.tools[0].execute({key:'public'},context('interrupted')),denied('RESULT_UNKNOWN'));
      assert.equal(f.calls().length,1);
    }finally{await f.close();}
  }
});

test('directory change invalidates the session; concurrent startup is refused; disable/dispose release registrations',async()=>{
  const f=await fixture({sse:true,changed:true});const policy=new InMemoryAuthorizationPolicy(),gateway=new ToolGateway({policy});f.host.register(gateway);
  try{
    const starting=f.host.start({signal:signal(),deadline:future()});
    await assert.rejects(f.host.start({signal:signal(),deadline:future()}),denied('REVISION_CONFLICT'));await starting;
    await assert.rejects(f.host.tools[0].execute({key:'public'},context('directory-changed')));
    assert.equal(f.host.health().connected,false);assert.deepEqual(f.host.health().exposedTools,[]);
    await f.host.setEnabled(false);assert.equal(f.host.health().state,'disabled');
    await assert.rejects(f.host.start({signal:signal(),deadline:future()}),denied('UNSUPPORTED_CAPABILITY'));
    await f.host.setEnabled(true);f.mode.changed=false;await f.host.start({signal:signal(),deadline:future()});
    assert.equal(f.host.health().connected,true);
  }finally{await f.close();}
  assert.equal(f.host.health().state,'disposed');assert.deepEqual(gateway.list(),[]);
  await assert.rejects(f.host.start({signal:signal(),deadline:future()}),denied('UNSUPPORTED_CAPABILITY'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {createRemoteReadonlyMcpHost,remoteMcpDirectoryDigest} from '../dist/index.js';
import {fixture,endpoint,descriptor,directory} from './remote-http-fixture.mjs';

const context=runId=>({taskId:'preflight-task',runId,authorizationRef:runId,scopes:descriptor.requiredScopes,
  signal:new AbortController().signal,deadline:new Date(Date.now()+10000).toISOString()});
const options={endpoint,server:{name:'synthetic-reference',version:'1.0.0'},tool:{remoteName:'reference',descriptor},
  enabled:true,expectedDirectoryDigest:remoteMcpDirectoryDigest(directory())};

test('a failed directory preflight does not retain an unsent run identity',async()=>{
  const f=await fixture();let failNext=false;
  const host=createRemoteReadonlyMcpHost({...options,fetch:async(url,init)=>{
    const message=init?.body?JSON.parse(init.body):undefined;
    if(failNext && message?.method==='tools/list'){
      failNext=false;
      return new Response(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-32603,message:'synthetic directory unavailable'}}),
        {headers:{'content-type':'application/json'}});
    }
    return f.fetch(url,init);
  }});
  try{
    await host.start(context('start'));const tool=host.tools[0];failNext=true;
    await assert.rejects(tool.execute({key:'public'},context('retry')),{code:'EXTERNAL_FAILURE'});
    assert.equal(f.calls().length,0);
    assert.deepEqual(await tool.execute({key:'public'},context('retry')),{text:'public synthetic reference'});
    assert.deepEqual(await tool.execute({key:'public'},context('retry')),{text:'public synthetic reference'});
    assert.equal(f.calls().length,1);
    await assert.rejects(tool.execute({key:'changed'},context('retry')),{code:'REVISION_CONFLICT'});
    f.mode.drop=true;
    await assert.rejects(tool.execute({key:'public'},context('sent')));
    assert.equal(f.calls().length,2);
    await host.stop();f.mode.drop=false;await host.start(context('restart'));
    await assert.rejects(tool.execute({key:'public'},context('sent')),{code:'RESULT_UNKNOWN'});
    assert.equal(f.calls().length,2);
  }finally{await host.dispose();await f.close();}
});

test('the operation lock rejects concurrent calls while directory preflight is pending',async()=>{
  const f=await fixture();let paused=false,release,reached;
  const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{reached=resolve;});
  const host=createRemoteReadonlyMcpHost({...options,fetch:async(url,init)=>{
    if(paused && init?.body && JSON.parse(init.body).method==='tools/list'){reached();await gate;}
    return f.fetch(url,init);
  }});
  let pending;
  try{
    await host.start(context('start'));paused=true;
    pending=host.tools[0].execute({key:'public'},context('same'));
    await started;
    await assert.rejects(host.tools[0].execute({key:'public'},context('same')),{code:'REVISION_CONFLICT'});
    assert.equal(f.calls().length,0);
    release();await pending;
    assert.equal(f.calls().length,1);
  }finally{release();await pending?.catch(()=>{});await host.dispose();await f.close();}
});

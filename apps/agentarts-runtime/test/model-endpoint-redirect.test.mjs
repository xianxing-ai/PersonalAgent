import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {createServer as httpsServer} from 'node:https';
import {request as httpRequest} from 'node:http';
import {createServer as tcpServer} from 'node:net';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const run=promisify(execFile),marker='synthetic-private-redirect-body';
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(t){
  // Two real HTTPS loopback origins and the actual production entry. The model
  // account, credentials and replies are Synthetic; no external service is used.
  const directory=await mkdtemp(path.join(os.tmpdir(),'owned-model-tls-'));
  await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(directory,'key.pem'),
    '-out',path.join(directory,'cert.pem'),'-days','1','-subj','/CN=synthetic-owned-model','-addext','subjectAltName=IP:127.0.0.1']);
  const key=await readFile(path.join(directory,'key.pem')),cert=await readFile(path.join(directory,'cert.pem'));
  const first=[],second=[],disconnections=[];let mode='direct';
  const answer=response=>{response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({
    choices:[{message:{content:JSON.stringify({kind:'text',text:'synthetic direct model reply'})},finish_reason:'stop'}]}));};
  const destination=httpsServer({key,cert},async(request,response)=>{
    let body='';for await(const chunk of request)body+=chunk;
    second.push({body,authorization:request.headers.authorization});answer(response);
  });await listen(destination);
  const source=httpsServer({key,cert},async(request,response)=>{
    let body='';for await(const chunk of request)body+=chunk;
    first.push({body,authorization:request.headers.authorization});
    if(mode==='hang'){response.once('close',()=>disconnections.push(body));return;}
    if(mode==='direct')return answer(response);
    response.writeHead(mode,{location:`https://127.0.0.1:${destination.address().port}/v1/chat/completions`});response.end();
  });await listen(source);
  const reservation=tcpServer();await listen(reservation);const port=reservation.address().port;
  await new Promise(resolve=>reservation.close(resolve));
  const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('PA_AGENT_')
    &&name!=='NODE_TLS_REJECT_UNAUTHORIZED'&&name!=='NODE_EXTRA_CA_CERTS'));
  // This transport-only fixture deliberately excludes the separately tested embedded weights.
  Object.assign(env,{PA_AGENT_HOST_MODE:'standalone-validation',PA_AGENT_LAYA_MODE:'legacy-without-laya',PA_AGENT_MODEL_BASE_URL:`https://127.0.0.1:${source.address().port}/v1`,
    PA_AGENT_MODEL:'synthetic',PA_AGENT_MODEL_API_KEY:'synthetic-model-secret',
    PA_AGENT_INBOUND_TOKEN:'synthetic-inbound-token-at-least-32-chars',PA_AGENT_TIMEOUT_MS:'3000',
    PORT:String(port),NODE_EXTRA_CA_CERTS:path.join(directory,'cert.pem')});
  const child=spawn(process.execPath,[fileURLToPath(new URL('../src/main.mjs',import.meta.url))],{env,stdio:['ignore','pipe','pipe']});
  const closed=once(child,'close');let stdout='',stderr='';
  child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  t.after(async()=>{
    if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([closed,pause(3000)]);if(child.exitCode===null)child.kill('SIGKILL');}
    for(const server of [source,destination]){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await rm(directory,{recursive:true,force:true});
  });
  const expires=Date.now()+5000;
  while(!stdout.includes('"event":"listening"')){assert.equal(child.exitCode,null);assert.ok(Date.now()<expires);await pause(10);}
  // Give each test-control request its own socket. A Connection: close header
  // alone does not give the fixture ownership of global fetch's pooled client.
  // The production HTTPS model transport remains unchanged; never retry here.
  const post=(headers={},signal,query=marker)=>new Promise((resolve,reject)=>{
    let reported=false;
    const fail=(stage,error)=>{
      if(!reported){
        reported=true;
        // Structural diagnostics only: never emit bodies, headers, child logs or paths.
        const socket=request.socket;
        t.diagnostic(JSON.stringify({event:'control-plane-transport-failure',stage,
          code:['ECONNRESET','ECONNREFUSED','EPIPE','ABORT_ERR'].includes(error.code)?error.code:'OTHER',
          callerAborted:signal?.aborted===true,childExited:child.exitCode!==null,
          childExitCode:child.exitCode,childSignalled:child.signalCode!==null,
          childListening:stdout.includes('"event":"listening"'),childStderrPresent:stderr.length>0,
          modelRequests:first.length,redirectRequests:second.length,
          socketAssigned:socket!==null&&socket!==undefined,socketDestroyed:socket?.destroyed===true,
          bytesRead:socket?.bytesRead??0,bytesWritten:socket?.bytesWritten??0}));
      }
      reject(error);
    };
    const request=httpRequest(`http://127.0.0.1:${port}/invocations`,{method:'POST',signal,agent:false,
      headers:{'content-type':'application/json',authorization:`Bearer ${env.PA_AGENT_INBOUND_TOKEN}`,...headers,connection:'close'}},response=>{
      const chunks=[];
      response.on('data',chunk=>chunks.push(chunk));
      response.once('error',error=>fail('response',error));
      response.once('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode})));
    });
    request.once('error',error=>fail('request',error));
    request.end(JSON.stringify({query}));
  });
  return {first,second,post,setMode:value=>mode=value,
    disconnections:query=>disconnections.filter(body=>body.includes(query)).length,logs:()=>({stdout,stderr})};
}
for(const status of [307,308])test(`production model endpoint refuses HTTPS ${status} redirect to another origin`,async t=>{
  const f=await fixture(t);f.setMode(status);const response=await f.post(),body=await response.text();
  t.diagnostic(JSON.stringify({httpsOrigins:2,redirectStatus:status,firstRequests:f.first.length,
    secondRequests:f.second.length,bodyForwarded:f.second.some(r=>r.body.includes(marker)),tlsVerification:true}));
  assert.equal(response.status,502);assert.equal(f.first.length,1);assert.equal(f.second.length,0);
  assert.doesNotMatch(body,/synthetic-private|synthetic-model-secret|127\.0\.0\.1/);
  assert.equal(f.logs().stderr,'');assert.doesNotMatch(f.logs().stdout,/synthetic-private|synthetic-model-secret/);
});
test('production direct HTTPS model call preserves deadline and caller cancellation without retry',async t=>{
  const f=await fixture(t);
  t.diagnostic('control-plane phase: direct');
  const direct=await f.post();assert.equal(direct.status,200);
  assert.equal(JSON.parse((await direct.json())[0].data.text).text,'synthetic direct model reply');
  assert.equal(f.first[0].authorization,'Bearer synthetic-model-secret');assert.equal(f.second.length,0);
  t.diagnostic('control-plane phase: already-expired');
  // This phase tests an already-expired deadline, not the relative precision
  // of wall clocks in the test process and the separately spawned runtime.
  // Keep the deadline unambiguously in the past on both sides of the request.
  const alreadyExpiredQuery=marker+'-already-expired';
  const alreadyExpired=await f.post({'x-pa-deadline':'2000-01-01T00:00:00.000Z'},undefined,alreadyExpiredQuery);
  assert.equal(alreadyExpired.status,504);await alreadyExpired.arrayBuffer();
  assert.equal(f.first.filter(request=>request.body.includes(alreadyExpiredQuery)).length,0,
    'an already-expired invocation must never reach the model origin');
  assert.equal(f.first.length,1,'an expired invocation must not dispatch a model request');
  t.diagnostic('control-plane phase: expired');
  const expiredQuery=marker+'-deadline',expiredRequests=()=>f.first.filter(request=>request.body.includes(expiredQuery)).length;
  f.setMode('hang');const expired=await f.post({'x-pa-deadline':new Date(Date.now()+200).toISOString()},undefined,expiredQuery);
  assert.equal(expired.status,504);
  await expired.arrayBuffer();
  // The 200ms deadline can expire before dispatch on a busy host. Neither
  // legitimate zero dispatch nor one cancelled dispatch permits a retry.
  assert.ok(expiredRequests()<=1);assert.equal(f.first.length,1+expiredRequests());
  // Check deadline cancellation before the caller-cancel phase, with a separate
  // budget so that phase cannot consume or extend the deadline disconnect wait.
  const expiredDisconnectLimit=Date.now()+2000;
  while(f.disconnections(expiredQuery)<expiredRequests()){
    assert.ok(Date.now()<expiredDisconnectLimit);await pause(5);
  }
  assert.equal(f.disconnections(expiredQuery),expiredRequests());
  t.diagnostic('control-plane phase: cancel');
  const query=marker+'-caller-cancel',received=()=>f.first.filter(request=>request.body.includes(query)).length;
  const controller=new AbortController(),pending=f.post({},controller.signal,query);
  const limit=Date.now()+2000;while(received()<1){assert.ok(Date.now()<limit);await pause(5);}
  controller.abort();await assert.rejects(pending,{name:'AbortError'});
  while(f.disconnections(query)<1){assert.ok(Date.now()<limit);await pause(5);}
  assert.equal(received(),1);assert.equal(f.disconnections(query),1);
  assert.equal(f.disconnections(expiredQuery),expiredRequests());
  assert.ok(expiredRequests()<=1);assert.equal(f.first.length,1+expiredRequests()+received());
  assert.equal(f.second.length,0);assert.equal(f.logs().stderr,'');
});

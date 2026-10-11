import {request as httpRequest} from 'node:http';
import {createAgentServer} from '../src/server.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {createServer as httpsServer} from 'node:https';
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
  const first=[],second=[];let mode='direct',disconnections=0;
  const answer=response=>{response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({
    choices:[{message:{content:JSON.stringify({kind:'text',text:'synthetic direct model reply'})},finish_reason:'stop'}]}));};
  const destination=httpsServer({key,cert},async(request,response)=>{
    let body='';for await(const chunk of request)body+=chunk;
    second.push({body,authorization:request.headers.authorization});answer(response);
  });await listen(destination);
  const source=httpsServer({key,cert},async(request,response)=>{
    let body='';for await(const chunk of request)body+=chunk;
    first.push({body,authorization:request.headers.authorization});
    if(mode==='late'){response.once('close',()=>disconnections++);setTimeout(()=>answer(response),300);return;}
    if(mode==='hang'){response.once('close',()=>disconnections++);return;}
    if(mode==='direct')return answer(response);
    response.writeHead(mode,{location:`https://127.0.0.1:${destination.address().port}/v1/chat/completions`});response.end();
  });await listen(source);
  const reservation=tcpServer();await listen(reservation);const port=reservation.address().port;
  await new Promise(resolve=>reservation.close(resolve));
  const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('PA_AGENT_')
    &&name!=='NODE_TLS_REJECT_UNAUTHORIZED'&&name!=='NODE_EXTRA_CA_CERTS'));
  Object.assign(env,{PA_AGENT_HOST_MODE:'agentarts',PA_AGENT_MODEL_BASE_URL:`https://127.0.0.1:${source.address().port}/v1`,
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
  const post=(headers={},signal)=>fetch(`http://127.0.0.1:${port}/invocations`,{method:'POST',signal,
    headers:{'content-type':'application/json',authorization:`Bearer ${env.PA_AGENT_INBOUND_TOKEN}`,...headers},
    body:JSON.stringify({query:marker})});
  return {child,closed,port,inbound:env.PA_AGENT_INBOUND_TOKEN,first,second,post,setMode:value=>mode=value,disconnections:()=>disconnections,logs:()=>({stdout,stderr})};
}

test('actual SIGTERM cancels accepted partial HTTP upload before any model dispatch',async t=>{
 const f=await fixture(t);let resolveResponse,rejectResponse;const received=new Promise((r,j)=>{resolveResponse=r;rejectResponse=j});
 const request=httpRequest({hostname:'127.0.0.1',port:f.port,path:'/invocations',method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+f.inbound}},response=>{let body='';response.on('data',c=>body+=c);response.on('end',()=>resolveResponse({status:response.statusCode,body}));});request.on('error',rejectResponse);request.write('{"query":');
 const limit=Date.now()+3000;while((await(await fetch('http://127.0.0.1:'+f.port+'/ping')).json()).status!=='HealthyBusy'){assert.ok(Date.now()<limit);await pause(5);}
 assert.equal(f.first.length,0);f.child.kill('SIGTERM');await pause(50);
 let newConnectionsRefused=false;try{await fetch('http://127.0.0.1:'+f.port+'/ping')}catch{newConnectionsRefused=true}
 assert.equal(newConnectionsRefused,true);request.end('"synthetic accepted upload"}');
 const result=await received;const exit=await f.closed;
 t.diagnostic(JSON.stringify({actualProduction:true,tlsVerification:true,newConnectionsRefused,modelRequests:f.first.length,httpStatus:result.status,childExit:exit}));
 assert.equal(result.status,499);assert.equal(JSON.parse(result.body).data.error_code,'CANCELLED');
 assert.equal(f.first.length,0);assert.deepEqual(exit,[0,null]);assert.equal(f.logs().stderr,'');assert.equal(f.second.length,0);
});
test('actual SIGTERM aborts in-flight HTTPS model and never publishes its late success',async t=>{
 const f=await fixture(t);f.setMode('late');const pending=f.post();const limit=Date.now()+2000;
 while(f.first.length<1){assert.ok(Date.now()<limit);await pause(5);}f.child.kill('SIGTERM');
 const response=await pending;assert.equal(response.status,499);assert.equal((await response.json()).data.error_code,'CANCELLED');
 assert.deepEqual(await f.closed,[0,null]);await pause(350);assert.equal(f.first.length,1);assert.equal(f.disconnections(),1);assert.equal(f.second.length,0);
 const receipts=f.logs().stdout.trim().split('\n').map(line=>JSON.parse(line)).filter(row=>row.role);
 assert.deepEqual(receipts.map(row=>row.status),['started','failed']);assert.equal(f.logs().stderr,'');
 t.diagnostic(JSON.stringify({actualProduction:true,tlsVerification:true,modelRequests:1,disconnections:1,roleStatuses:receipts.map(row=>row.status),remoteBillingStopped:'not_verified'}));
});
async function directHost(t,orchestrator){
 const server=createAgentServer({mode:'standalone-validation',timeoutMs:300,maxConcurrency:1,authToken:'s'.repeat(32),orchestrator});
 await listen(server);t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 return {server,url:'http://127.0.0.1:'+server.address().port};
}
test('close cancels a non-cooperative invocation once and repeated close remains bounded',async t=>{
 let start,finish,aborts=0;const started=new Promise(r=>start=r),uncooperative=new Promise(r=>finish=r);
 const f=await directHost(t,{invoke:async value=>{value.signal.addEventListener('abort',()=>aborts++);start(value);return uncooperative;}});
 const pending=fetch(f.url+'/invocations',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+'s'.repeat(32)},body:'{"query":"synthetic"}'});
 const invocation=await started;assert.equal((await(await fetch(f.url+'/ping')).json()).status,'HealthyBusy');
 const rejected=await fetch(f.url+'/invocations',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+'s'.repeat(32)},body:'{"query":"second"}'});assert.equal(rejected.status,429);
 f.server.close();f.server.close();const response=await pending;assert.equal(response.status,499);assert.equal(invocation.signal.aborted,true);assert.equal(aborts,1);
 finish({kind:'text',text:'synthetic late result'});await pause(10);assert.equal(aborts,1);assert.equal((await response.text()).includes('late result'),false);
});
test('close also cancels an incomplete authenticated status upload',async t=>{
 let calls=0;const f=await directHost(t,{invoke:async()=>{calls++;return {kind:'text',text:'synthetic'};}});
 const result=new Promise((resolve,reject)=>{const request=httpRequest(f.url+'/invocation-status',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+'s'.repeat(32)}},response=>{let body='';response.on('data',c=>body+=c);response.on('end',()=>resolve({status:response.statusCode,body}));});request.on('error',reject);request.write('{');
 setTimeout(()=>{f.server.close();setTimeout(()=>request.end('}'),10);},30);});
 const response=await result;assert.equal(response.status,499);assert.equal(JSON.parse(response.body).data.error_code,'CANCELLED');assert.equal(calls,0);
});
test('ordinary successful HTTP invocation still releases its original shared slot',async t=>{
 let calls=0;const f=await directHost(t,{invoke:async()=>{calls++;return {kind:'text',text:'synthetic success'};}});
 const post=()=>fetch(f.url+'/invocations',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+'s'.repeat(32)},body:'{"query":"synthetic"}'});
 for(let i=0;i<2;i++){const response=await post();assert.equal(response.status,200);assert.equal(JSON.parse((await response.json())[0].data.text).text,'synthetic success');}
 assert.equal(calls,2);assert.equal((await(await fetch(f.url+'/ping')).json()).status,'Healthy');
});
test('actual SIGTERM closes an upload that never supplies its remaining body after readable cancellation',async t=>{
 const f=await fixture(t);let resolveResponse,rejectResponse;const received=new Promise((r,j)=>{resolveResponse=r;rejectResponse=j});
 const request=httpRequest({hostname:'127.0.0.1',port:f.port,path:'/invocations',method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+f.inbound}},response=>{let body='';response.on('data',c=>body+=c);response.on('end',()=>resolveResponse({status:response.statusCode,body}));});
 request.on('error',rejectResponse);request.write('{"query":');
 try {
  const limit=Date.now()+2000;while((await(await fetch('http://127.0.0.1:'+f.port+'/ping')).json()).status!=='HealthyBusy'){assert.ok(Date.now()<limit);await pause(5);}
  f.child.kill('SIGTERM');const response=await received;assert.equal(response.status,499);assert.equal(JSON.parse(response.body).data.error_code,'CANCELLED');
  const exit=await Promise.race([f.closed,pause(1000).then(()=>['still_open'])]);
  t.diagnostic(JSON.stringify({actualProduction:true,withheldBody:true,httpStatus:response.status,modelRequests:f.first.length,childExit:exit}));
  assert.deepEqual(exit,[0,null]);assert.equal(f.first.length,0);assert.equal(f.logs().stderr,'');
 } finally {request.destroy();}
});

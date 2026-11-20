import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createServer as tcpServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

test('production startup without model configuration fails closed and never falls back to Fake',()=>{
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PA_AGENT_')));
  env.PA_AGENT_HOST_MODE='agentarts';
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../src/main.mjs',import.meta.url))],{env,encoding:'utf8',timeout:15000});
  assert.equal(result.status,1);
  assert.equal(result.stdout,'');
  assert.equal(result.stderr,'Agent runtime startup failed: check trusted mode, model and credential configuration.\n');
});

test('trusted default controller configuration rejects unknown or workflow identities before listening',()=>{
  for(const id of ['synthetic-unknown-controller','71f3004f-faba-4487-9e6f-996194ec2b3c']){
    const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PA_AGENT_')));
    Object.assign(env,{PA_AGENT_HOST_MODE:'agentarts',PA_AGENT_MODEL_BASE_URL:'https://synthetic.invalid/v1',
      PA_AGENT_MODEL:'synthetic',PA_AGENT_MODEL_API_KEY:'synthetic-secret',PA_AGENT_DEFAULT_CONTROLLER_ID:id});
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('../src/main.mjs',import.meta.url))],{env,encoding:'utf8',timeout:15000});
    assert.equal(result.status,1);assert.equal(result.stdout,'');
    assert.equal(result.stderr,'Agent runtime startup failed: check trusted mode, model and credential configuration.\n');
    assert.equal(result.stderr.includes('synthetic-secret'),false);
  }
});

test('AgentArts requires explicit local decisions and rejects the superseded embedded mode',()=>{
  for(const mode of [undefined,'legacy-without-laya','embedded']) {
    const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PA_AGENT_')));
    Object.assign(env,{PA_AGENT_HOST_MODE:'agentarts',PA_AGENT_MODEL_BASE_URL:'https://synthetic.invalid/v1',
      PA_AGENT_MODEL:'synthetic',PA_AGENT_MODEL_API_KEY:'synthetic-secret'});
    if(mode)env.PA_AGENT_LAYA_MODE=mode;
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('../src/main.mjs',import.meta.url))],{env,encoding:'utf8',timeout:15000});
    assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr.includes('synthetic-secret'),false);
    assert.equal(result.stderr,'Agent runtime startup failed: check trusted mode, model and credential configuration.\n');
  }
});

test('PA_AGENT_TIMEOUT_MODE validates strictly and fails closed on missing or invalid fixed timeout',()=>{
  const base=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PA_AGENT_')));
  Object.assign(base,{PA_AGENT_HOST_MODE:'standalone-validation',PA_AGENT_LAYA_MODE:'legacy-without-laya',
    PA_AGENT_MODEL_BASE_URL:'https://synthetic.invalid/v1',PA_AGENT_MODEL:'synthetic',PA_AGENT_MODEL_API_KEY:'synthetic-secret'});
  for(const extra of [
    {PA_AGENT_TIMEOUT_MODE:'unknown'},
    {PA_AGENT_TIMEOUT_MODE:'fixed'},
    {PA_AGENT_TIMEOUT_MODE:'fixed',PA_AGENT_TIMEOUT_MS:'0'},
    {PA_AGENT_TIMEOUT_MODE:'fixed',PA_AGENT_TIMEOUT_MS:'not-a-number'},
    {PA_AGENT_TIMEOUT_MODE:'fixed',PA_AGENT_TIMEOUT_MS:'2147483648'},
  ]) {
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('../src/main.mjs',import.meta.url))],{env:{...base,...extra},encoding:'utf8',timeout:15000});
    assert.equal(result.status,1);
    assert.equal(result.stdout,'');
    assert.equal(result.stderr,'Agent runtime startup failed: check trusted mode, model and credential configuration.\n');
  }
});

async function startRuntime(t, extraEnv={}) {
  const reservation=tcpServer();
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;
  await new Promise(resolve=>reservation.close(resolve));
  const token='synthetic-inbound-token-at-least-32-chars';
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PA_AGENT_')));
  Object.assign(env,{PA_AGENT_HOST_MODE:'standalone-validation',PA_AGENT_LAYA_MODE:'legacy-without-laya',
    PA_AGENT_MODEL_BASE_URL:'https://synthetic.invalid/v1',PA_AGENT_MODEL:'synthetic',PA_AGENT_MODEL_API_KEY:'synthetic-secret',
    PA_AGENT_INBOUND_TOKEN:token,PORT:String(port),...extraEnv});
  const child=spawn(process.execPath,[fileURLToPath(new URL('../src/main.mjs',import.meta.url))],{env,stdio:['ignore','pipe','pipe']});
  t.after(()=>{ if(child.exitCode===null) child.kill(); });
  await new Promise((resolve,reject)=>{
    let out='',err='';
    const timer=setTimeout(()=>reject(new Error(`Startup timeout: ${out} ${err}`)),10000);
    child.stdout.on('data',chunk=>{out+=chunk;if(out.includes('"event":"listening"')){clearTimeout(timer);resolve();}});
    child.stderr.on('data',chunk=>{err+=chunk;});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Unexpected exit ${code}: ${err}`));});
  });
  return {url:`http://127.0.0.1:${port}`,token};
}

test('PA_AGENT_TIMEOUT_MODE defaults to request-deadline and supports opt-in fixed mode',async t=>{
  const payload=JSON.stringify({query:JSON.stringify({platformVersion:1,operation:'list'})});
  const defaulted=await startRuntime(t);
  const resDefault=await fetch(defaulted.url+'/invocations',{method:'POST',
    headers:{'content-type':'application/json','x-pa-agent-token':'Bearer '+defaulted.token},body:payload});
  assert.equal(resDefault.status,400);

  const fixed=await startRuntime(t,{PA_AGENT_TIMEOUT_MODE:'fixed',PA_AGENT_TIMEOUT_MS:'5000'});
  const resFixed=await fetch(fixed.url+'/invocations',{method:'POST',
    headers:{'content-type':'application/json','x-pa-agent-token':'Bearer '+fixed.token},body:payload});
  assert.equal(resFixed.status,200);
});

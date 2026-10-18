// Manual, hermetic production-entry smoke. TLS fixtures are generated locally;
// no real model account, system trust change or external network is used.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:https';
import {createServer as createTcpServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {GOAL_PREFIX} from '../../../packages/agentarts/dist/input.js';

const fixture = process.env.PA_TEST_TLS_DIR;
assert.ok(fixture, 'PA_TEST_TLS_DIR must explicitly name synthetic TLS fixtures');
const modelKey = 'synthetic-model-credential-for-offline-test';
const inboundToken = 'synthetic-inbound-token-for-offline-test';
const requests = [], pending = [];
let transportError;
const endpoint = createServer({key:await readFile(`${fixture}/key.pem`),cert:await readFile(`${fixture}/cert.pem`)}, async (req,res) => {
  try {
    assert.equal(req.method,'POST');
    assert.equal(req.url,'/v1/chat/completions');
    assert.equal(req.headers.authorization,`Bearer ${modelKey}`);
    let body=''; for await (const chunk of req) body+=chunk;
    const value=JSON.parse(body);
    assert.equal(value.model,'synthetic-model');
    assert.equal(value.stream,false);
    assert.equal(value.max_tokens,2048);
    assert.deepEqual(value.messages.map(message=>message.role),['system','user']);
    requests.push(value);
    const answer=pending.shift();
    assert.ok(answer,'unexpected model request or automatic retry');
    if (answer.hang) return;
    res.writeHead(answer.status??200,{'content-type':'application/json'});
    res.end(JSON.stringify(answer.status ? {error:'synthetic-private-provider-error'} : {
      choices:[{message:{content:JSON.stringify(answer.value)},finish_reason:'stop'}],
      usage:{prompt_tokens:10,completion_tokens:8,total_tokens:18}
    }));
  } catch (error) {
    transportError=error;
    res.writeHead(500); res.end();
  }
});
await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve));
const reservation=createTcpServer();
await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
const port=reservation.address().port;
await new Promise(resolve=>reservation.close(resolve));
const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('PA_AGENT_')&&!name.startsWith('PA_TEST_')&&name!=='NODE_TLS_REJECT_UNAUTHORIZED'));
Object.assign(env,{PA_AGENT_HOST_MODE:'standalone-validation',PA_AGENT_LAYA_MODE:'legacy-without-laya',PA_AGENT_MODEL_BASE_URL:`https://127.0.0.1:${endpoint.address().port}/v1`,
  PA_AGENT_MODEL:'synthetic-model',PA_AGENT_MODEL_API_KEY:modelKey,PA_AGENT_INBOUND_TOKEN:inboundToken,
  PA_AGENT_TIMEOUT_MS:'5000',PORT:String(port),NODE_EXTRA_CA_CERTS:`${fixture}/cert.pem`});
const child=spawn(process.execPath,[fileURLToPath(new URL('../src/main.mjs',import.meta.url))],{env,stdio:['ignore','pipe','pipe']});
const closed=once(child,'close');
let stdout='',stderr='';
child.stdout.on('data',chunk=>{stdout+=chunk;}); child.stderr.on('data',chunk=>{stderr+=chunk;});
const url=`http://127.0.0.1:${port}`;
const post=(query,headers={})=>fetch(`${url}/invocations`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${inboundToken}`,...headers},body:JSON.stringify({query})});
const result=async response=>{
  assert.equal(response.status,200);
  const events=await response.json();
  assert.deepEqual(events.slice(1),[{event:'task_end'},{event:'end'}]);
  return JSON.parse(events[0].data.text);
};
try {
  const expires=Date.now()+15000;
  while (!stdout.includes('"event":"listening"')) {
    assert.equal(child.exitCode,null,'production entry exited before listening');
    assert.ok(Date.now()<expires,'production entry readiness timed out');
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.equal((await (await fetch(`${url}/ping`)).json()).status,'Healthy');
  assert.equal((await post('ignored',{authorization:'Bearer invalid'})).status,401);
  assert.equal(requests.length,0);
  pending.push({value:{kind:'text',text:'合成生产入口答复'}});
  assert.deepEqual(await result(await post('你好')),{kind:'text',text:'合成生产入口答复'});
  const tool={name:'weather.forecast',version:'1.0.0',inputSchema:{type:'object',properties:{city:{type:'string'}},required:['city'],additionalProperties:false}};
  const proposal={kind:'tool_proposal',proposalId:'weather-1',toolName:tool.name,toolVersion:tool.version,arguments:{city:'杭州'}};
  pending.push({value:proposal});
  assert.deepEqual(await result(await post(JSON.stringify({goal:'查杭州天气',availableTools:[tool]}))),proposal);
  pending.push({value:{kind:'text',text:'合成天气读回'}});
  assert.equal((await result(await post(JSON.stringify({continuation:{proposalId:'weather-1',state:'confirmed',result:{forecast:'小雨'}}})))).text,'合成天气读回');
  const goalId='b'.repeat(64),planId='a'.repeat(64);
  const change={node:{id:planId,revision:1},summary:'16点准备',reason:'会议时间变更',dependencies:[{id:goalId,revision:2}]};
  const candidate={kind:'repair_candidate',candidateVersion:'1.0',candidate:{expectedGraphRevision:7,changes:[change]}};
  assert.equal(pending.length,0);
  const repairStart=requests.length;
  pending.push({value:{disposition:'REVISE',affected:[planId],reason:'变更',missing_information:[]}},
    {value:{disposition:'REVISE',changes:[change],missing_information:[]}},{value:candidate});
  const repairQuery=GOAL_PREFIX+JSON.stringify({action:'REVISE',strategy:'最小修复',nodes:[
    {id:goalId,revision:1,kind:'goal',summary:'14点准备',state:'active',validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2027-01-01T00:00:00.000Z'},
    {id:goalId,revision:2,kind:'goal',summary:'16点准备',state:'active',validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2027-01-01T00:00:00.000Z'},
    {id:planId,revision:1,kind:'plan',summary:'14点准备',state:'active',validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2027-01-01T00:00:00.000Z'}],
    repairContext:{expectedGraphRevision:7,targets:[{node:change.node,summary:'14点准备',requestedDependencies:change.dependencies}],allowedDependencies:change.dependencies},
    omittedSources:0,calibrated:false,executed:false});
  assert.deepEqual(await result(await post(repairQuery)),candidate);
  assert.equal(requests.length,repairStart+3);
  assert.equal(pending.length,0);
  const repairSystems=requests.slice(repairStart).map(item=>item.messages[0].content);
  assert.match(repairSystems[0],/observed_facts/);
  assert.equal(repairSystems[0].includes('preserved_steps'),false);
  assert.match(repairSystems[1],/preserved_steps/);
  assert.equal(repairSystems[1].includes('candidateVersion始终1.0'),false);
  assert.match(repairSystems[2],/candidateVersion始终1\.0/);
  const sourceLessStart=requests.length;
  pending.push({value:{disposition:'REVISE',affected:['plan'],reason:'旧报告',missing_information:[]}});
  const sourceLess=JSON.stringify({continuation:{proposalId:'read-1',state:'confirmed',result:{repairContext:{expectedGraphRevision:7,
    targets:[{node:{id:'plan',revision:2},requestedSummary:'16:00准备',requestedDependencies:[{id:'fact',revision:3}]}],
    allowedDependencies:[{id:'fact',revision:3}]}}}});
  assert.deepEqual(await result(await post(sourceLess)),{kind:'text',text:'RECHECK：世界状态分析缺少确定的修复依据。'});
  assert.equal(requests.length,sourceLessStart+1);
  assert.equal(pending.length,0);
  const sourceLessCall=requests[sourceLessStart];
  assert.match(sourceLessCall.messages[0].content,/只有repairContext而无原始节点内容必须RECHECK/);
  assert.equal(sourceLessCall.messages[0].content.includes('preserved_steps'),false);
  assert.equal(sourceLessCall.messages[0].content.includes('candidateVersion始终1.0'),false);
  const sourceLessUser=JSON.parse(sourceLessCall.messages[1].content);
  assert.equal(sourceLessUser.kind,'continuation');
  assert.equal(Object.hasOwn(sourceLessUser,'nodes'),false);
  const schemaStart=requests.length;
  pending.push({value:{kind:'text',text:'不合法权限',authorizationRef:'forged'}});
  assert.equal((await post('bad-schema')).status,502);
  assert.equal(requests.length,schemaStart+1);
  assert.equal(pending.length,0);
  assert.match(requests[schemaStart].messages[0].content,/普通问候/);
  assert.equal(requests[schemaStart].messages[0].content.includes('observed_facts'),false);
  pending.push({status:500});
  const failure=await post('provider-error');
  assert.equal(failure.status,502);
  assert.equal((await failure.text()).includes('synthetic-private-provider-error'),false);
  pending.push({hang:true});
  assert.equal((await post('deadline',{'x-pa-deadline':new Date(Date.now()+800).toISOString()})).status,504);
  assert.equal((await (await fetch(`${url}/ping`)).json()).status,'Healthy');
  assert.equal(requests.length,10);
  assert.equal(pending.length,0);
  assert.equal(transportError,undefined);
  assert.equal(stdout.includes(modelKey)||stdout.includes(inboundToken)||stdout.includes('合成'),false);
  assert.equal(stderr,'');
  const receipts=stdout.trim().split('\n').map(line=>JSON.parse(line));
  assert.ok(receipts.some(receipt=>receipt.role==='world'));
  assert.ok(receipts.some(receipt=>receipt.role==='plan'));
  assert.ok(receipts.some(receipt=>receipt.role==='review'));
  child.kill('SIGTERM');
  const stopped=await Promise.race([closed,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('shutdown timed out')),10000);timer.unref();})]);
  assert.deepEqual(stopped,[0,null]);
  process.stdout.write(JSON.stringify({status:'passed',productionEntry:true,tlsVerification:true,externalNetwork:false,modelRequests:requests.length,
    cases:['health','auth','text','tool-proposal','continuation','world-plan-review','source-less-recheck','schema-rejection','sanitized-provider-error','deadline','shutdown']})+'\n');
} finally {
  if (child.exitCode===null) child.kill('SIGKILL');
  endpoint.closeAllConnections();
  await new Promise(resolve=>endpoint.close(resolve));
}

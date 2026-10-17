// Network-isolated ARM64 production-entry smoke. No cloud model call or Laya inference.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
const config=JSON.parse(Buffer.concat(chunks).toString('utf8')),run=promisify(execFile);
assert.equal(typeof config.docker,'string');assert.equal(typeof config.image,'string');
const script=String.raw`
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
const token=randomBytes(32).toString('hex');
const realFetch=globalThis.fetch;let mockProviderCalls=0;
globalThis.fetch=async(input,init)=>{
 if(String(input)==='https://synthetic.invalid/v1/chat/completions'){
  mockProviderCalls++;assert.equal(init.method,'POST');const body=JSON.parse(init.body);
  assert.equal(body.model,'synthetic-no-call');assert.equal(body.messages.at(-1).content,'synthetic fixture');
  return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'synthetic fixture reply'},finish_reason:'stop'}],usage:{prompt_tokens:2,completion_tokens:3,total_tokens:5}}),{status:200,headers:{'content-type':'application/json'}});
 }
 return realFetch(input,init);
};
Object.assign(process.env,{PA_AGENT_HOST_MODE:'agentarts',PA_AGENT_LAYA_MODE:'local',
 PA_AGENT_TEST_VERSION:process.env.SMOKE_TEST_VERSION,
 PA_AGENT_MODEL_BASE_URL:'https://synthetic.invalid/v1',PA_AGENT_MODEL:'synthetic-no-call',
 PA_AGENT_MODEL_API_KEY:'synthetic-no-account',PA_AGENT_WSS_AUTH_TOKEN:token});
await import('./apps/agentarts-runtime/src/main.mjs');
let ping;for(let i=0;i<100;i++){try{ping=await fetch('http://127.0.0.1:8080/ping');if(ping.ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
assert.equal(ping?.status,200);
const invoke=async(value,auth=true)=>{
 const response=await fetch('http://127.0.0.1:8080/invocations',{method:'POST',headers:{'content-type':'application/json',...(auth?{'x-pa-agent-token':'Bearer '+token}:{})},body:JSON.stringify({query:JSON.stringify(value)})});
 return {status:response.status,body:await response.json()};
};
const enabled=process.env.SMOKE_TEST_VERSION==='1';
const capabilities=await invoke({testVersion:1,operation:'capabilities'});
assert.equal(capabilities.status,enabled?200:503);
if(enabled){const value=JSON.parse(capabilities.body[0].data.text);assert.equal(value.productionAcceptance,false);assert.equal(value.layaLocation,'local_host');assert.deepEqual(value.models.map(m=>m.ref),['fast','world','plan','review']);}
assert.equal((await invoke({testVersion:1,operation:'capabilities'},false)).status,enabled?401:503);
if(enabled)assert.equal((await invoke({testVersion:1,operation:'model_turn',modelRef:'unknown',messages:[{role:'user',content:'fixture'}]})).status,400);
const modelRequest={testVersion:1,operation:'model_turn',modelRef:'fast',messages:[{role:'user',content:'synthetic fixture'}],maxOutputTokens:32};
if(enabled){
 assert.equal((await invoke({...modelRequest,messages:[{role:'tool',content:'synthetic fixture'}]})).status,400);
 assert.equal((await invoke(modelRequest,false)).status,401);assert.equal(mockProviderCalls,0);
 const turn=await invoke(modelRequest);assert.equal(turn.status,200);
 const value=JSON.parse(turn.body[0].data.text);assert.equal(value.testVersion,1);
 assert.equal(value.result.response.text,'synthetic fixture reply');assert.equal(value.result.usage.totalTokens,5);
}
assert.equal(mockProviderCalls,enabled?1:0);
const catalog=await invoke({workflowVersion:'1.0.0',operation:'catalog'});assert.equal(catalog.status,200);
const directory=JSON.parse(catalog.body[0].data.text);assert.equal(directory.workflowBindings.length,28);
let nodes=0;for(const binding of directory.workflowBindings){const item=await invoke({workflowVersion:'1.0.0',operation:'catalog',workflowId:binding.workflowId});assert.equal(item.status,200);nodes+=JSON.parse(item.body[0].data.text).template.nodes.length;}
assert.equal(nodes,185);
console.log(JSON.stringify({testVersionEnabled:enabled,pingStatus:ping.status,architecture:process.arch,uid:process.getuid(),workflowCount:28,nodeCount:nodes,mockProviderCalls,maasCalls:0,realInferenceTested:false,published:false}));process.exit(0);
`;
const inspected=JSON.parse((await run(config.docker,['image','inspect',config.image])).stdout)[0];
assert.equal(inspected.Architecture,'arm64');
const modes=[];for(const enabled of ['0','1']){
 const {stdout}=await run(config.docker,['run','--rm','--platform','linux/arm64','--network','none','-e','SMOKE_TEST_VERSION='+enabled,'--entrypoint','node',config.image,'--input-type=module','-e',script],{maxBuffer:2*1024*1024});
 const receipt=JSON.parse(stdout.trim().split(/\r?\n/).at(-1));assert.equal(receipt.architecture,'arm64');assert.equal(receipt.uid,1000);modes.push(receipt);
}
const receipt={kind:'test_image_v1_isolated_smoke',image:config.image,imageId:inspected.Id,sizeBytes:inspected.Size,modes};
await writeFile(config.output,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));

// Actual ARM64 container + actual production entry, no account or model request.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {getOwnedWorkflowDesignCoverage} from '@personal-agent/agentarts';

const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
const config=JSON.parse(Buffer.concat(chunks).toString('utf8')),run=promisify(execFile);
assert.equal(typeof config.docker,'string');assert.equal(typeof config.image,'string');
const script=String.raw`
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const token=randomBytes(32).toString('hex');
Object.assign(process.env,{PA_AGENT_HOST_MODE:'agentarts',PA_AGENT_LAYA_MODE:'local',
  PA_AGENT_MODEL_BASE_URL:'https://proxy.synthetic.invalid/inference/v1',PA_AGENT_MODEL_PROXY_KEY_HEADER:'x-test-key',
  PA_AGENT_MODEL:'synthetic-no-model-call',
  PA_AGENT_MODEL_API_KEY:'synthetic-no-account',PA_AGENT_WSS_AUTH_TOKEN:token});
await import('./apps/agentarts-runtime/src/main.mjs');
let ping;
for(let attempt=0;attempt<30;attempt++) {
  try {ping=await fetch('http://127.0.0.1:8080/ping');if(ping.ok)break;}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
}
assert.equal(ping?.status,200);
const invoke=async envelope=>{
  const response=await fetch('http://127.0.0.1:8080/invocations',{method:'POST',
    headers:{'content-type':'application/json','x-pa-agent-token':'Bearer '+token},
    body:JSON.stringify({query:JSON.stringify({workflowVersion:'1.0.0',operation:'catalog',...envelope})})});
  assert.equal(response.status,200);const frames=await response.json();return JSON.parse(frames[0].data.text);
};
const catalog=await invoke({});assert.equal(catalog.workflowBindings.length,28);
let nodes=0,modelAssignments=0,selectedJoins=0;const observed=[];
for(const binding of catalog.workflowBindings) {
  const result=await invoke({workflowId:binding.workflowId}),template=result.template;
  assert.equal(template.templateDigest,binding.templateDigest);assert.ok(template.summary);
  assert.ok(Array.isArray(template.designNotes));assert.ok(Array.isArray(template.acceptance));
  nodes+=template.nodes.length;modelAssignments+=template.nodes.filter(node=>node.modelAssignment).length;
  selectedJoins+=template.nodes.filter(node=>node.joinMode==='selected').length;
  observed.push({workflowId:template.workflowId,templateDigest:template.templateDigest,nodeCount:template.nodes.length});
}
assert.equal(nodes,185);assert.ok(modelAssignments>0);assert.ok(selectedJoins>0);
console.log(JSON.stringify({kind:'local_arm64_image_discovery_smoke',pingStatus:ping.status,
  os:process.platform,architecture:process.arch,user:process.getuid(),workflowCount:28,nodeCount:nodes,
  adapterCount:catalog.adapterRequirements.length,modelAssignments,selectedJoins,observed,
  designCoverage:catalog.designCoverage,embeddedLayaPathPresent:existsSync('/opt/laya'),
  maasCalls:0,realInferenceTested:false,published:false}));
process.exit(0);
`;
const inspected=JSON.parse((await run(config.docker,['image','inspect',config.image])).stdout)[0];
const {stdout}=await run(config.docker,['run','--rm','--platform','linux/arm64','--network','none',
  '--entrypoint','node',config.image,'--input-type=module','-e',script],{maxBuffer:1024*1024});
const receipt=JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
assert.equal(inspected.Architecture,'arm64');assert.equal(receipt.architecture,'arm64');assert.equal(receipt.user,1000);
assert.equal(receipt.embeddedLayaPathPresent,false);
assert.deepEqual(receipt.designCoverage,getOwnedWorkflowDesignCoverage());
assert.deepEqual(receipt.observed,receipt.designCoverage.workflows);
const report={...receipt,imageId:inspected.Id,sizeBytes:inspected.Size,
  sizeScope:'Docker image inspect Size; not a transfer or RSS measurement'};
await writeFile(config.output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({file:config.output,imageId:report.imageId,workflowCount:report.workflowCount,nodeCount:report.nodeCount,
  adapterCount:report.adapterCount,projectionSha256:report.designCoverage.projectionSha256,published:false}));

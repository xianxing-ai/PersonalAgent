// Explicit manual acceptance inside the real owned ARM64 image, with --network none.
// One real Laya instance, public synthetic input, no MaaS/Fake/tools/accounts.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {networkInterfaces} from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {promisify} from 'node:util';
import {getOwnedWorkflowBindings,getOwnedWorkflowTemplates} from '@personal-agent/agentarts';
import {startLayaService} from '../../../apps/agentarts-runtime/src/laya-service.mjs';
import {createOwnedLayaSelector} from '../../../apps/agentarts-runtime/src/laya-selector.mjs';

const execute=promisify(execFile);
const integer=(name,fallback)=>{
  const value=Number(process.env[name]??fallback);
  assert.ok(Number.isSafeInteger(value)&&value>0&&value<=2_147_483_647);
  return value;
};
let phase='environment',service,unexpectedExit=false;
const syntheticAnswerDiagnostics=[];
const lifecycle=new AbortController();
process.once('SIGTERM',()=>lifecycle.abort());process.once('SIGINT',()=>lifecycle.abort());
try {
  assert.equal(process.platform,'linux');assert.equal(process.arch,'arm64');
  const interfaces=networkInterfaces();
  const publicInterfaces=Object.entries(interfaces).flatMap(([name,entries])=>(entries??[])
    .filter(entry=>!entry.internal).map(()=>name));
  assert.deepEqual(publicInterfaces,[],'Use docker --network none; only loopback is permitted');
  const modelPath=process.env.LAYA_MODEL_PATH??'/opt/laya/models/multilingual';
  assert.ok(path.isAbsolute(modelPath));
  const asset=JSON.parse(await readFile(path.join(modelPath,'asset-manifest.json'),'utf8'));
  assert.equal(asset.model,'multilingual');assert.match(asset.revision,/^[a-f0-9]{40}$/);
  if(process.env.PA_EXPECTED_LAYA_REVISION)assert.equal(asset.revision,process.env.PA_EXPECTED_LAYA_REVISION);

  phase='cpu_probe';
  const python=process.env.PA_LAYA_PYTHON??'/opt/laya/venv/bin/python';
  const probeStarted=performance.now();
  // This short process imports Torch, but never imports Agent or loads weights.
  // It exits before the one production Laya child starts.
  const probe=await execute(python,['-c',
    'import importlib.metadata as m,json,platform,torch; print(json.dumps({"machine":platform.machine(),"torch":torch.__version__,"cuda":torch.version.cuda,"laya":m.version("laya"),"transformers":m.version("transformers")}))'],
    {windowsHide:true,timeout:integer('PA_TEST_CPU_PROBE_TIMEOUT_MS',120_000),maxBuffer:64_000});
  const cpu=JSON.parse(probe.stdout.trim());
  assert.equal(cpu.machine,'aarch64');assert.equal(cpu.torch,'2.14.0+cpu');assert.equal(cpu.cuda,null);
  assert.equal(cpu.laya,'0.3.20');assert.equal(cpu.transformers,'5.17.0');
  const cpuProbeMs=Math.round(performance.now()-probeStarted);

  phase='real_model_startup';
  const startupStarted=performance.now();
  service=await startLayaService({modelPath,python,port:integer('LAYA_PORT',8000),
    startupTimeoutMs:integer('PA_LAYA_STARTUP_TIMEOUT_MS',120_000),signal:lifecycle.signal,
    onUnavailable:()=>{unexpectedExit=true;lifecycle.abort();}});
  assert.equal(service.isReady(),true);assert.equal(unexpectedExit,false);
  const startupMs=Math.round(performance.now()-startupStarted);
  const healthResponse=await fetch(`http://127.0.0.1:${service.port}/health`,{
    headers:{authorization:`Bearer ${service.key}`},signal:AbortSignal.any([lifecycle.signal,AbortSignal.timeout(10_000)]),redirect:'error'});
  assert.equal(healthResponse.status,200);const health=await healthResponse.json();
  assert.equal(health.model,'multilingual');assert.equal(health.warmed,true);assert.equal(health.inferenceBusy,false);

  phase='real_typed_choice';
  const decisions=[];
  const selector=createOwnedLayaSelector({port:service.port,getApiKey:()=>service.key,isReady:service.isReady,
    request:async (url,options)=>{
      const response=await fetch(url,options);
      if(new URL(url).pathname==='/v1/systemone') {
        // Only fields derived from this script's public synthetic question.
        // Never inspect/log request headers, body text, tokens or private model inputs.
        const diagnostic={httpStatus:response.status};
        try {
          const data=await response.clone().json(),answer=data?.answers?.decision;
          const type=value=>value===null?'null':Array.isArray(value)?'array':typeof value;
          diagnostic.fieldTypes={answers:type(data?.answers),answer:type(answer),type:type(answer?.type),
            choice:type(answer?.choice),probabilities:type(answer?.probabilities),
            answer_confidence:type(answer?.answer_confidence),confidence:type(answer?.confidence)};
          diagnostic.choice=typeof answer?.choice==='string'
            ?/^candidate_[0-9]{1,2}$/.test(answer.choice)?answer.choice:'<non-schema-choice>':null;
          diagnostic.probabilities=answer?.probabilities&&typeof answer.probabilities==='object'
            ?Object.entries(answer.probabilities).slice(0,16).map(([key,value])=>({
              key:/^candidate_[0-9]{1,2}$/.test(key)?key:'<non-schema-key>',type:type(value),
              value:typeof value==='number'&&Number.isFinite(value)?value:null})):null;
          diagnostic.answer_confidence=typeof answer?.answer_confidence==='number'&&Number.isFinite(answer.answer_confidence)?answer.answer_confidence:null;
          diagnostic.confidence=typeof answer?.confidence==='number'&&Number.isFinite(answer.confidence)?answer.confidence:null;
          if(data?.tokenWindow&&typeof data.tokenWindow==='object') {
            diagnostic.tokenWindow={};
            for(const name of ['encoderMaxTokens','maxLength','headMaxLength','encodedTokens','droppedTokens']) {
              if(Number.isSafeInteger(data.tokenWindow[name]))diagnostic.tokenWindow[name]=data.tokenWindow[name];
            }
            for(const name of ['headerTokens','stateTokens','requiredSequenceTokens','expectedInputTokens']) {
              if(Array.isArray(data.tokenWindow[name])&&data.tokenWindow[name].every(Number.isSafeInteger)) {
                diagnostic.tokenWindow[name]=data.tokenWindow[name];
              }
            }
            if(typeof data.tokenWindow.truncated==='boolean')diagnostic.tokenWindow.truncated=data.tokenWindow.truncated;
          }
          if(data?.detail?.code==='CONTEXT_WINDOW_EXCEEDED') {
            diagnostic.rejection={code:data.detail.code};
            for(const name of ['requiredTokens','encoderMaxTokens']) {
              if(Number.isSafeInteger(data.detail[name]))diagnostic.rejection[name]=data.detail[name];
            }
          }
        } catch {diagnostic.jsonDecoded=false;}
        syntheticAnswerDiagnostics.push(diagnostic);
      }
      return response;
    },
    onDecision:receipt=>decisions.push(receipt)});
  const inferenceStarted=performance.now();
  const selected=await selector.select({requestId:'owned-laya-image-public-synthetic',
    context:'Public synthetic offline check: select either the ready observation or the review observation. Neither choice authorizes a tool, proves task completion or changes persistent state.',
    candidates:[{id:'ready',description:'The public synthetic observation is ready for review.'},
      {id:'review',description:'The public synthetic observation needs further review.'}],
    deadline:new Date(Date.now()+integer('PA_TEST_CHOICE_TIMEOUT_MS',60_000)).toISOString(),signal:lifecycle.signal});
  assert.ok(['ready','review'].includes(selected));assert.equal(decisions.length,1);
  assert.equal(decisions[0].candidateId,selected);assert.equal(unexpectedExit,false);
  const inferenceMs=Math.round(performance.now()-inferenceStarted);

  phase='real_long_context_typed_choice';
  const longStarted=performance.now();
  const longSelected=await selector.select({requestId:'owned-laya-image-public-long-context',
    context:'Public synthetic contract field name is a string. '.repeat(150)
      +'The last source fact must remain visible. Both supplied options are observations, with no tool authorization or task completion.',
    candidates:[{id:'ready',description:'The complete public synthetic observation is ready for review.'},
      {id:'review',description:'The complete public synthetic observation needs further review.'}],
    deadline:new Date(Date.now()+integer('PA_TEST_LONG_CHOICE_TIMEOUT_MS',integer('PA_TEST_CHOICE_TIMEOUT_MS',60_000))).toISOString(),
    signal:lifecycle.signal});
  assert.ok(['ready','review'].includes(longSelected));assert.equal(decisions.length,2);
  const longWindow=decisions[1].tokenWindow;
  assert.equal(longWindow.encoderMaxTokens,8192);assert.ok(longWindow.encodedTokens>1024);
  assert.ok(longWindow.maxLength>1024);assert.equal(longWindow.droppedTokens,0);assert.equal(longWindow.truncated,false);
  assert.equal(longWindow.encodedTokens,longWindow.expectedInputTokens[0]);
  const longInferenceMs=Math.round(performance.now()-longStarted);

  const readHealth=async()=>{
    const response=await fetch(`http://127.0.0.1:${service.port}/health`,{
      headers:{authorization:`Bearer ${service.key}`},
      signal:AbortSignal.any([lifecycle.signal,AbortSignal.timeout(10_000)]),redirect:'error'});
    assert.equal(response.status,200);return response.json();
  };
  phase='real_tokenizer_encoder_overflow';
  const beforeOverflow=await readHealth();assert.equal(beforeOverflow.inferenceCalls,2);
  const rejectStarted=performance.now();
  await assert.rejects(selector.select({requestId:'owned-laya-image-public-overflow',context:'a '.repeat(10_000),
    candidates:[{id:'ready',description:'Public observation ready'},{id:'review',description:'Public observation needs review'}],
    deadline:new Date(Date.now()+integer('PA_TEST_CONTEXT_REJECTION_TIMEOUT_MS',60_000)).toISOString(),signal:lifecycle.signal}),
    {code:'UNSUPPORTED_CAPABILITY'});
  const afterOverflow=await readHealth();
  assert.equal(afterOverflow.inferenceCalls,beforeOverflow.inferenceCalls);assert.equal(afterOverflow.inferenceBusy,false);
  assert.equal(decisions.length,2,'Overflow must not fabricate a Laya review selection');
  const rejected=syntheticAnswerDiagnostics.at(-1);
  assert.equal(rejected.httpStatus,413);assert.equal(rejected.rejection.code,'CONTEXT_WINDOW_EXCEEDED');
  assert.ok(rejected.rejection.requiredTokens>8192);assert.equal(rejected.rejection.encoderMaxTokens,8192);
  const overflowPreflightMs=Math.round(performance.now()-rejectStarted);

  phase='owned_catalog';
  const templates=getOwnedWorkflowTemplates(),catalog=getOwnedWorkflowBindings();
  assert.equal(templates.length,28);assert.equal(catalog.length,28);
  assert.equal(templates.reduce((total,template)=>total+template.nodes.length,0),185);
  assert.equal(new Set(catalog.map(item=>item.workflowId)).size,28);
  assert.ok(catalog.every(item=>templates.some(template=>template.workflowId===item.workflowId
    &&template.templateDigest===item.templateDigest)));
  phase='real_model_shutdown';
  const shutdownStarted=performance.now();await service.stop();
  assert.equal(service.isReady(),false);assert.equal(unexpectedExit,false);
  const shutdownMs=Math.round(performance.now()-shutdownStarted);
  service=undefined;
  process.stdout.write(JSON.stringify({status:'passed',profile:'huawei_ict_agentarts',
    acceptance:'owned ARM64 CPU image; real embedded Laya only',platform:process.platform,architecture:process.arch,
    network:{requiredDockerMode:'none',nonLoopbackInterfaces:publicInterfaces,modelTransport:'127.0.0.1'},
    cpu,model:{name:'multilingual',revision:asset.revision,assetFiles:asset.files.length,warmed:true},
    measurements:{cpuProbeMs,startupMs,inferenceMs,longInferenceMs,overflowPreflightMs,shutdownMs},
    typedChoice:{selected,validated:true,calibrated:false,tokenWindow:decisions[0].tokenWindow,
      inferenceMetrics:decisions[0].inferenceMetrics,selectorMetrics:{queueWaitMs:decisions[0].queueWaitMs,
        busyWaitMs:decisions[0].busyWaitMs,internalHttpMs:decisions[0].internalHttpMs,responseValidationMs:decisions[0].responseValidationMs}},
    longContext:{selected:longSelected,validated:true,calibrated:false,tokenWindow:longWindow,
      inferenceMetrics:decisions[1].inferenceMetrics,selectorMetrics:{queueWaitMs:decisions[1].queueWaitMs,
        busyWaitMs:decisions[1].busyWaitMs,internalHttpMs:decisions[1].internalHttpMs,responseValidationMs:decisions[1].responseValidationMs}},
    encoderOverflow:{rejected:true,code:'CONTEXT_WINDOW_EXCEEDED',additionalInferenceCalls:0,selectedCandidate:false},
    syntheticAnswerDiagnostics,
    workflows:{templates:templates.length,catalog:catalog.length,detailNodes:185,businessExecutionVerified:false},
    layaInstances:1,maasCalls:0,toolExecutions:0,externalEffects:0,
    limitations:['Synthetic choice verifies runtime/protocol only, not classification quality or all 28 business workflows.']})+'\n');
} catch (error) {
  const code=typeof error?.code==='string'&&/^[A-Z0-9_]{1,64}$/.test(error.code)?error.code:'UNCLASSIFIED';
  process.stderr.write(JSON.stringify({status:'failed',phase,code,syntheticAnswerDiagnostics,privateErrorDetails:'redacted'})+'\n');
  process.exitCode=1;
} finally {
  lifecycle.abort();await service?.stop();
}

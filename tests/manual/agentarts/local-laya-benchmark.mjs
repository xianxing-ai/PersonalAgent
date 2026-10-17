// Opt-in local-only real-weight measurement. No MaaS, accounts, tools, decision cache or CPU quota.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startLayaService} from '../../../apps/agentarts-runtime/src/laya-service.mjs';
import {createOwnedLayaSelector} from '../../../apps/agentarts-runtime/src/laya-selector.mjs';
import {probes} from './owned-laya-batching.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url)),sha=value=>createHash('sha256').update(value).digest('hex');
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
const config=JSON.parse(Buffer.concat(chunks).toString('utf8'));
assert.ok(config.python&&config.modelPath&&Number.isSafeInteger(config.port));
const samples=config.rounds??5,threads=config.threads??[(config.device==='cuda'?1:2)];assert.ok(Number.isSafeInteger(samples)&&samples>0);
const report={schemaVersion:1,kind:'real_local_laya_same_input_comparison',status:'running',startedAt:new Date().toISOString(),stages:[],
  scope:'Native Windows actual hardware, no CPU/memory quota; warm selector + loopback HTTP + complete model inference; startup excluded',
  targetMs:150,hardware:{architecture:process.arch,logicalProcessors:(await import('node:os')).availableParallelism()},
  device:config.device??'cpu',maasCalls:0,toolExecutions:0,offMachineRequests:0,cachedChoices:false,modelInstancesAtOnce:1,qualityVerified:false,arms:[]};
const directory=join(root,'.cache','local-laya-benchmark');await mkdir(directory,{recursive:true});
const destination=join(directory,'comparison-'+Date.now()+'.json');
const persist=()=>writeFile(destination,JSON.stringify(report,null,2)+'\n');
const stage=async(name,detail={})=>{report.stages.push({stage:name,observedAtUtc:new Date().toISOString(),...detail});await persist();};
report.modelManifestSha256=sha(await readFile(join(config.modelPath,'asset-manifest.json')));
let service;
const summarize=rows=>{const values=rows.map(row=>row.wallMs).sort((a,b)=>a-b);return {samples:values.length,
  p50Ms:values[Math.floor(values.length*.5)],p95Ms:values[Math.min(values.length-1,Math.ceil(values.length*.95)-1)],
  maximumMs:values.at(-1),allBelow150Ms:values.every(value=>value<150)};};
try {
  async function arm(threadCount,policy) {
    await stage('service.starting',{threadCount,policy});
    const start=performance.now();service=await startLayaService({python:config.python,modelPath:config.modelPath,
      port:config.port,torchThreads:threadCount,device:config.device??'cpu',pythonModulePath:config.pythonModulePath,
      cpuExecutionPolicy:policy,startupTimeoutMs:config.startupTimeoutMs??120000});
    const current={threads:threadCount,policy,precision:service.precision,startupMs:performance.now()-start,serial:[],parallelRequests:[],groups:[]};report.arms.push(current);
    await stage('service.ready',{threadCount,policy,processId:service.processId,startupMs:current.startupMs});
    const deadline=new Date(Date.now()+600000).toISOString();let receipts=[];
    const selector=createOwnedLayaSelector({port:service.port,getApiKey:()=>service.key,isReady:service.isReady,
      cpuExecutionPolicy:policy,onDecision:row=>receipts.push(row)});
    async function one(probe) {
      const started=performance.now(),requestId='local-benchmark-'+crypto.randomUUID();
      const selected=await selector.select({...probe,requestId,deadline,signal:new AbortController().signal});
      const receipt=receipts.find(item=>item.requestId===requestId);assert.ok(receipt?.tokenWindow?.truncated===false);
      return {input:probe.id,inputSha256:sha(JSON.stringify({context:probe.context,candidates:probe.candidates})),wallMs:performance.now()-started,selected,encodedTokens:receipt.tokenWindow.encodedTokens,
        forwardMs:receipt.inferenceMetrics?.forwardMs,processCpuMs:receipt.inferenceMetrics?.processCpuMs,
        queueWaitMs:receipt.queueWaitMs,batchSize:receipt.batchSize};
    }
    for(const probe of probes)await one(probe);receipts=[];
    for(let round=0;round<samples;round++) {
      let start=performance.now();const serial=[];for(const probe of probes)serial.push(await one(probe));
      current.serial.push(...serial);current.groups.push({round,mode:'serial',totalMs:performance.now()-start});
      start=performance.now();current.parallelRequests.push(...await Promise.all(probes.map(one)));
      current.groups.push({round,mode:'parallel_requests',totalMs:performance.now()-start});
    }
    current.summary={serial:summarize(current.serial),parallelRequests:summarize(current.parallelRequests)};
    const baseline=Object.fromEntries(current.serial.map(row=>[row.input,row.selected]));
    current.choicesStable=current.parallelRequests.every(row=>row.selected===baseline[row.input]);
    process.stderr.write(JSON.stringify({stage:'local_benchmark_arm',threads:threadCount,policy,summary:current.summary})+'\n');
    await stage('service.stopping',{threadCount,policy});
    await service.stop();service=undefined;
    await stage('service.stopped',{threadCount,policy});
  }
  for(const threadCount of threads)await arm(threadCount,'sequential');
  const best=[...report.arms].sort((a,b)=>a.summary.serial.p50Ms-b.summary.serial.p50Ms)[0];
  await arm(best.threads,'packed');
  report.status='completed';report.bestSerial={threads:best.threads,...best.summary.serial};
}catch(error){report.status='failed';report.failure={code:error.code??'LOCAL_BENCHMARK_FAILURE',type:error.name};process.exitCode=1;}
finally{await service?.stop();report.finishedAt=new Date().toISOString();
  await persist();
  process.stdout.write(JSON.stringify({file:destination,status:report.status,bestSerial:report.bestSerial,arms:report.arms.map(arm=>({threads:arm.threads,policy:arm.policy,summary:arm.summary}))},null,2)+'\n');}

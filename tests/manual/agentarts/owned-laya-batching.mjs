// Opt-in public diagnostic against one ALREADY RUNNING loopback Laya service.
// No service startup, weight loading, MaaS, tools, installation or off-machine request.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createOwnedLayaSelector} from '../../../apps/agentarts-runtime/src/laya-selector.mjs';

const SHA=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const numeric=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const safeError=error=>/^[A-Z_0-9]{1,64}$/.test(error?.code??'')?error.code:'SANITIZED_FAILURE';
const probes=[
  {id:'public-alpha',context:'Public synthetic alpha observation: source revision alpha-1 is present. Select an observation only; no tool is authorized.',
    candidates:[{id:'alpha-observe',description:'Keep the supplied alpha observation.'},{id:'alpha-review',description:'The alpha observation needs review.'}]},
  {id:'public-beta',context:'Public synthetic beta observation: a scoped memory fact applies only to project beta. Select one observation without writing memory.',
    candidates:[{id:'beta-keep',description:'The supplied beta fact applies to this project.'},{id:'beta-skip',description:'The supplied beta fact is irrelevant to this project.'},
      {id:'beta-review',description:'The beta observation needs review.'}]},
  {id:'public-gamma',context:'Public synthetic gamma context: an original public passage and its digest remain available. Select an observation without deleting context.',
    candidates:[{id:'gamma-original',description:'Use the supplied original gamma passage.'},{id:'gamma-review',description:'The gamma observation needs review.'}]},
  {id:'public-delta',context:'Public synthetic delta shadow: alternative outcome evidence is unavailable. Select an observation; no real action, rollout or authorization occurs.',
    candidates:[{id:'delta-unknown',description:'The counterfactual result remains unknown.'},{id:'delta-equivalent',description:'The two public observations are equivalent.'},
      {id:'delta-different',description:'The two public observations differ.'},{id:'delta-review',description:'The delta observation needs review.'}]},
];

/** Only explicit fixed public probes. The caller owns the existing service/key/model binding. */
export async function runOwnedLayaBatching({port,apiKey,deadline,sizes=[2,4],
  cpuExecutionPolicy='sequential',signal=new AbortController().signal,request=fetch}={}) {
  const report={schemaVersion:1,kind:'public_laya_independent_batch_diagnostic',startedAt:new Date().toISOString(),
    platform:process.platform,architecture:process.arch,serviceStartedByManual:false,weightsLoadedByManual:false,
    maasCalls:0,toolExecutions:0,offMachineRequests:0,semanticCorrectnessVerified:false,groups:[]};
  let stage='configuration';
  try {
    assert.ok(Number.isSafeInteger(port)&&port>=1024&&port<=65535);
    assert.ok(typeof apiKey==='string'&&apiKey&&!/[\r\n]/.test(apiKey));
    assert.ok(typeof deadline==='string'&&Number.isFinite(Date.parse(deadline))&&Date.parse(deadline)>Date.now());
    assert.ok(signal instanceof AbortSignal);assert.equal(typeof request,'function');
    assert.ok(['sequential','packed'].includes(cpuExecutionPolicy));
    assert.ok(Array.isArray(sizes)&&sizes.length>0&&new Set(sizes).size===sizes.length&&sizes.every(size=>[2,4].includes(size)));
    const origin=`http://127.0.0.1:${port}`;
    const local=async(url,options)=>{
      const target=new URL(url);
      assert.ok(target.origin===origin&&!target.search&&!target.hash
        &&['/health','/v1/systemone','/v1/systemone/independent-batch'].includes(target.pathname));
      return request(url,{...options,redirect:'error'});
    };
    const health=async()=>{
      const response=await local(origin+'/health',{headers:{authorization:`Bearer ${apiKey}`},
        signal:AbortSignal.any([signal,AbortSignal.timeout(Math.min(2_147_483_647,Math.max(1,Date.parse(deadline)-Date.now())))])});
      assert.equal(response.status,200);const value=await response.json();
      assert.equal(value.status,'ok');assert.equal(value.model,'multilingual');assert.equal(value.warmed,true);
      assert.equal(value.inferenceBusy,false);assert.ok(Number.isSafeInteger(value.inferenceCalls)&&value.inferenceCalls>=0);
      assert.equal(value.executionPolicy,cpuExecutionPolicy,'Caller policy must match the independently started service');
      assert.ok(value.capabilities?.includes('independent_items'));assert.ok(value.maxStates>=Math.max(...sizes));return value;
    };
    const initial=await health();
    report.service={model:initial.model,warmed:initial.warmed,transport:'127.0.0.1 only',maxStates:initial.maxStates,
      executionPolicy:initial.executionPolicy,inferenceMode:initial.inferenceMode,
      modelSourceBinding:'Provided independently by the caller that owns this already-running service'};
    const runPhase=async(size,mode)=>{
      const before=await health(),posts=[],receipts=[];
      const selector=createOwnedLayaSelector({port,getApiKey:()=>apiKey,cpuExecutionPolicy,
        request:async(url,options)=>{
          if(new URL(url).pathname!=='/health') {
            const body=JSON.parse(options.body),batch=new URL(url).pathname.endsWith('/independent-batch');
            posts.push({kind:batch?'independent_items':'single',batchId:batch?body.batchId:null,
              items:(batch?body.items:[body]).map(item=>({itemId:batch?item.itemId:null,
                payloadSha256:SHA({model:body.model,state:item.state,questions:item.questions,deadline:item.deadline})}))});
          }
          return local(url,options);
        },onDecision:receipt=>receipts.push(receipt)});
      const one=async(probe,index)=>{
        const started=performance.now(),requestId=`public-batching-${size}-${mode}-${index}`;
        const selected=await selector.select({context:probe.context,candidates:probe.candidates,deadline,signal,requestId});
        assert.ok(probe.candidates.some(candidate=>candidate.id===selected));
        const receipt=receipts.find(item=>item.requestId===requestId);
        assert.ok(receipt);assert.equal(receipt.tokenWindow?.truncated,false);assert.equal(receipt.tokenWindow?.droppedTokens,0);
        assert.equal(receipt.tokenWindow?.encodedTokens,receipt.tokenWindow?.expectedInputTokens?.[0]);
        assert.equal(receipt.inferenceMetrics?.status,'available');assert.ok(numeric(receipt.inferenceMetrics.forwardMs));
        assert.equal(receipt.executionPolicy,cpuExecutionPolicy);assert.match(receipt.forwardId,UUID);
        assert.ok(Number.isSafeInteger(receipt.forwardIndex)&&receipt.forwardIndex>=1);
        assert.ok(Number.isSafeInteger(receipt.forwardCount)&&receipt.forwardCount>=receipt.forwardIndex);
        return {probeId:probe.id,selected,wallMs:performance.now()-started,queueWaitMs:receipt.queueWaitMs,
          selectorMs:receipt.choiceWallMs,encodedTokens:receipt.tokenWindow.encodedTokens,
          droppedTokens:receipt.tokenWindow.droppedTokens,truncated:receipt.tokenWindow.truncated,
          batchId:receipt.batchId,batchItemId:receipt.batchItemId,batchSize:receipt.batchSize,
          submittedBatchSize:receipt.submittedBatchSize,sharedForwardScope:receipt.sharedForwardScope,
          executionPolicy:receipt.executionPolicy,forwardId:receipt.forwardId,forwardIndex:receipt.forwardIndex,
          forwardCount:receipt.forwardCount,completedAfterMs:performance.now()-phaseStarted,
          preparationMetrics:receipt.preparationMetrics,precheckScope:receipt.inferenceMetrics.precheckScope,
          reportedPrecheckMs:receipt.inferenceMetrics.precheckMs,
          forwardScope:receipt.inferenceMetrics.forwardScope,reportedForwardMs:receipt.inferenceMetrics.forwardMs};
      };
      const phaseStarted=performance.now(),selected=[];
      if(mode==='sequential')for(const [index,probe] of probes.slice(0,size).entries())selected.push(await one(probe,index));
      else selected.push(...await Promise.all(probes.slice(0,size).map(one)));
      const wallMs=performance.now()-phaseStarted,after=await health(),forwardDelta=after.inferenceCalls-before.inferenceCalls;
      const packed=mode!=='sequential'&&cpuExecutionPolicy==='packed',expectedForwards=packed?1:size;
      assert.equal(forwardDelta,expectedForwards);assert.equal(posts.length,expectedForwards);
      if(!packed) {
        assert.ok(posts.every(post=>post.kind==='single'&&post.items.length===1));
        assert.ok(selected.every(item=>item.batchSize===1&&item.submittedBatchSize===1&&item.forwardCount===1
          &&item.forwardScope==='sdk_predict_batch'&&item.sharedForwardScope===undefined));
      }
      else {
        assert.equal(posts[0].kind,'independent_items');assert.equal(posts[0].items.length,size);assert.match(posts[0].batchId,UUID);
        assert.equal(new Set(posts[0].items.map(item=>item.itemId)).size,size);
        assert.ok(posts[0].items.every(item=>UUID.test(item.itemId)));
        assert.ok(selected.every((item,index)=>item.batchId===posts[0].batchId&&item.batchSize===size
          &&item.submittedBatchSize===size&&item.batchItemId===posts[0].items[index].itemId
          &&item.sharedForwardScope==='sdk_heterogeneous_forward'&&item.forwardScope==='sdk_heterogeneous_forward'));
        assert.equal(new Set(selected.map(item=>item.reportedForwardMs)).size,1,'A shared forward must not become independent per-item forward timings');
      }
      const measurements=new Map(),preparations=new Map();
      for(const item of selected) {
        const value={forwardId:item.forwardId,scope:item.forwardScope,ms:item.reportedForwardMs,
          precheckScope:item.precheckScope,precheckMs:item.reportedPrecheckMs,itemCount:item.batchSize,measurementCount:1};
        if(measurements.has(item.forwardId))assert.deepEqual(measurements.get(item.forwardId),value);
        else measurements.set(item.forwardId,value);
        if(item.preparationMetrics!==undefined) {
          const prep=item.preparationMetrics;assert.equal(prep.scope,'http_batch_preparation');assert.equal(prep.batchId,item.batchId);
          assert.ok(numeric(prep.wallMs)&&numeric(prep.processCpuMs));
          if(preparations.has(prep.batchId))assert.deepEqual(preparations.get(prep.batchId),prep);
          else preparations.set(prep.batchId,prep);
        }
      }
      if(packed)assert.equal(preparations.size,1);
      assert.equal(measurements.size,forwardDelta,'Deduplicate by actual forward identity, not HTTP batchId');
      return {mode,executionPolicy:cpuExecutionPolicy,wallMs,
        firstItemCompleteMs:Math.min(...selected.map(item=>item.completedAfterMs)),
        lastItemCompleteMs:Math.max(...selected.map(item=>item.completedAfterMs)),
        inferenceCallsBefore:before.inferenceCalls,inferenceCallsAfter:after.inferenceCalls,
        actualForwardCount:forwardDelta,httpSubmissions:posts.length,
        payloads:posts.flatMap(post=>post.items),selections:selected,
        forwardMeasurements:[...measurements.values()],
        preparationMeasurements:[...preparations.values()],
        forwardTimingInterpretation:'One measurement per forwardId, preparation once per HTTP batchId; preserve reported scopes and do not combine different legacy/new precheck scopes'};
    };
    for(const size of sizes) {
      const group={size};report.groups.push(group);stage=`sequential_${size}`;group.sequential=await runPhase(size,'sequential');
      stage=`concurrent_${size}`;group.batch=await runPhase(size,'concurrent');
      const singleHashes=group.sequential.payloads.map(item=>item.payloadSha256),batchHashes=group.batch.payloads.map(item=>item.payloadSha256);
      assert.deepEqual(batchHashes,singleHashes,'Same complete public state/questions/deadline must be used in both modes');
      group.samePublicPayloads=true;
      group.choiceAgreement=group.sequential.selections.map((item,index)=>({probeId:item.probeId,
        sequential:item.selected,batch:group.batch.selections[index].selected,equal:item.selected===group.batch.selections[index].selected}));
      group.sequentialWallToBatchWallRatio=group.batch.wallMs>0?group.sequential.wallMs/group.batch.wallMs:null;
    }
    report.status='passed_transport_and_forward_count_checks';
    report.payloadHashScope='model + complete state + original questions + original deadline; only transport envelope identities differ';
    report.limitations=['One sample per mode/size, not p50/p95 or an SLA; no guaranteed speedup or semantic correctness.',
      'Native Windows CPU service uses its configured two Torch threads; this is not a Huawei two-vCPU ARM64 container benchmark.',
      'The caller must retain independent source/model/service binding; loopback health is not deployment provenance.',
      'Default sequential dispatch submits independent single HTTP requests; only explicitly packed selector and matching service exercise a shared forward. Separate service policies require separate sequential runs, never simultaneous model instances.',
      'All items remain independent; batchSize counts actual items admitted to forward, while submittedBatchSize counts HTTP items; multi-question items may encode more rows.'];
  } catch(error) {report.status='failed';report.failure={stage,code:safeError(error),rawErrorSuppressed:true};}
  report.finishedAt=new Date().toISOString();return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try {
    const sizes=(process.env.PA_LAYA_BATCHING_SIZES??'2,4').split(',').map(Number);
    const report=await runOwnedLayaBatching({port:Number(process.env.LAYA_PORT??8000),apiKey:process.env.LAYA_API_KEY,
      deadline:process.env.PA_LAYA_BATCHING_DEADLINE,sizes,cpuExecutionPolicy:process.env.PA_LAYA_CPU_EXECUTION_POLICY??'sequential',signal:controller.signal});
    process.stdout.write(JSON.stringify(report,null,2)+'\n');if(report.status!=='passed_transport_and_forward_count_checks')process.exitCode=1;
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}

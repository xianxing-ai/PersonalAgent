// Real full F15 main + isolated-shadow acceptance over the existing image protocol.
// Reads trusted configuration from stdin. Only a fresh public fixture is writable.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp,realpath} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {TaskRuntime} from '@personal-agent/runtime';
import {createWorkspaceReadTool,createWorkspacePatchPreviewTool,createWorkspacePatchApplyTool} from '@personal-agent/coding-tools';
import {OwnedWorkflowHostBridge,createWorkflowDecisionTool,createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import {startLayaService} from '../../../apps/agentarts-runtime/src/laya-service.mjs';
import {createOwnedLayaSelector} from '../../../apps/agentarts-runtime/src/laya-selector.mjs';
import {ownedWorkflowLiveConfiguration,parseOwnedWorkflowInvocationBody,runOwnedWorkflowParent} from './owned-workflow-live.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url)),baseline=fileURLToPath(new URL('./fixtures/pelican-animation-bug.svg',import.meta.url));
const checker=fileURLToPath(new URL('./check-pelican.py',import.meta.url));
const sha=value=>createHash('sha256').update(typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value)).digest('hex');
const objectSchema={type:'object'},filename='pelican.svg';
const patchSchema={type:'object',additionalProperties:false,required:['path','expectedSha256','edits'],properties:{path:{const:filename},
  expectedSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},edits:{type:'array',minItems:1,items:{type:'object',additionalProperties:false,
    required:['oldText','newText'],properties:{oldText:{type:'string',minLength:1},newText:{type:'string'}}}}}};
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
const supplied=JSON.parse(Buffer.concat(chunks).toString('utf8'));
const config=ownedWorkflowLiveConfiguration(supplied);assert.ok(config.localLaya,'Explicit local Laya configuration required');
const report={schemaVersion:1,kind:'real_pelican_incremental_repair_main_and_shadow',startedAt:new Date().toISOString(),
  fixture:'existing pelican/bicycle SVG; three animations deliberately do not start',
  modelProviders:{execution:'configured real MaaS',decision:'real local Laya',fake:false},
  acceptance:{localDecisionTargetMs:150,fullWorkflowIncludesShadow:true,resourceQuota:false,
    browserPlayback:'not_yet_observed'},shadowScheduling:process.argv.includes('--parallel-shadow')?'overlap_with_main':'after_main',runs:[]};
const directory=await mkdtemp(join(root,'.cache','pelican-live-'));report.directory=directory;
let service;
const controller=new AbortController(),stop=()=>controller.abort();
process.once('SIGINT',stop);process.once('SIGTERM',stop);
const deadlineSignal=AbortSignal.any([controller.signal,AbortSignal.timeout(Math.max(1,Date.parse(config.deadline)-Date.now()))]);

async function resourceSnapshot() {
  const response=await fetch('http://127.0.0.1:'+service.port+'/health',{headers:{authorization:'Bearer '+service.key},
    redirect:'error',signal:deadlineSignal});assert.equal(response.status,200);const health=await response.json();
  assert.ok(Number.isSafeInteger(health.processId)&&health.processId>0);
  const code='$p=Get-Process -Id '+health.processId+'; @{cpuMs=$p.TotalProcessorTime.TotalMilliseconds;rssBytes=$p.WorkingSet64;'
    +'peakRssBytes=$p.PeakWorkingSet64;osThreads=$p.Threads.Count}|ConvertTo-Json -Compress';
  const processUsage=JSON.parse(execFileSync('C:/Program Files/PowerShell/7/pwsh.exe',['-NoProfile','-Command',code],{windowsHide:true,encoding:'utf8'}));
  return {at:new Date().toISOString(),processId:health.processId,device:health.device,precision:health.precision,
    process:processUsage,accelerator:health.accelerator};
}

function validate(directory) {
  const run=spawnSync(config.localLaya.python,[checker,join(directory,filename),baseline],{windowsHide:true,shell:false,encoding:'utf8',
    timeout:Math.max(1,Math.min(2147483647,Date.parse(config.deadline)-Date.now()))});
  if(run.error)throw Error('Pelican checker did not execute');
  const value=JSON.parse(run.stdout);assert.equal(run.status,value.passed?0:1);return value;
}

async function runGraph(mode,selector) {
  const hostCpuStart=process.cpuUsage();
  const started=performance.now(),runDirectory=join(directory,mode);await mkdir(runDirectory);const recoveryDirectory=join(directory,mode+'-backups');await mkdir(recoveryDirectory);
  const source=await readFile(baseline,'utf8');await writeFile(join(runDirectory,filename),source);
  const initial=validate(runDirectory);assert.equal(initial.passed,false);assert.equal(initial.failure,'pelican_animation_not_started');
  const result={mode,directory:runDirectory,initial,stages:[],decisions:[],executions:[],status:'in_progress'};report.runs.push(result);
  const readTool=createWorkspaceReadTool({rootPath:runDirectory}),preview=createWorkspacePatchPreviewTool({rootPath:runDirectory});
  const apply=createWorkspacePatchApplyTool({rootPath:runDirectory,recoveryRootPath:recoveryDirectory,powerShellPath:'C:/Program Files/PowerShell/7/pwsh.exe'});
  let previewed,applied,validated;
  const decision=createWorkflowDecisionTool({selector});
  const scopeAdapter=createOwnedWorkflowAdapter({nodeId:'F15_N04',kind:'host',inputSchema:patchSchema,outputSchema:objectSchema,
    requiredScopes:['workspace:read'],sideEffect:'read',execute:async(input,context)=>{
      previewed=await preview.execute(input,context);assert.equal(previewed.path,filename);assert.equal(previewed.beforeSha256,sha(source));
      const check=spawnSync(config.localLaya.python,[checker,'-',baseline],{input:previewed.previewText,windowsHide:true,shell:false,encoding:'utf8'});
      const checked=JSON.parse(check.stdout);assert.equal(check.status,0,'The candidate must fix animation without replacing the original geometry');
      return {approved:true,noBreakingApi:'not_applicable_static_svg',noUnrelatedFormatting:true,patch:input,previewSha256:previewed.afterSha256,checks:checked};
    }});
  const applyAdapter=createOwnedWorkflowAdapter({nodeId:'F15_N05',kind:'host',inputSchema:patchSchema,outputSchema:objectSchema,
    requiredScopes:['workspace:read','workspace:write','workspace:apply'],sideEffect:'local_write',execute:async(input,context)=>{
      assert.ok(previewed);const nextPreview=await preview.execute(input,context);
      assert.equal(nextPreview.afterSha256,previewed.afterSha256);applied=await apply.execute(input,context);
      assert.equal(applied.applied,true);validated=validate(runDirectory);
      return {passedTests:validated.passed?1:0,failedTests:validated.passed?0:1,testDurationMs:0,
        patch:input,patchReceipt:applied,verification:validated};
    }});
  const deliver=createOwnedWorkflowAdapter({nodeId:'F15_N06',kind:'host',inputSchema:{type:'object',additionalProperties:false,properties:{},required:[]},
    outputSchema:objectSchema,requiredScopes:['workspace:read'],sideEffect:'local_write',execute:async()=>{
      assert.ok(applied&&validated?.passed);const bytes=await readFile(join(runDirectory,filename));
      assert.equal(sha(bytes),applied.afterSha256);return {patchReadyForReview:true,autoPushBlocked:true,artifact:filename,
        baselineSha256:initial.baselineSha256,currentSha256:sha(bytes),geometryPreserved:validated.geometryPreserved,activeAnimations:validated.activeAnimations};
    }});
  const tools=[readTool,decision,scopeAdapter,applyAdapter,deliver];
  let app=createRuntimeApplication({path:join(runDirectory,'runtime.sqlite'),profile:'huawei_ict_agentarts',
    hostUserNamespace:'pelican-'+mode,tools});
  const task=app.runtime.submitTask({goal:'Incrementally repair the existing pelican SVG animations',conversationId:'pelican-'+mode,idempotencyKey:randomUUID()});
  const sessionId='pelican-'+randomUUID(),snapshot={namespace:'pelican-'+mode,asOf:report.startedAt,sourceVersions:{pelican:sha(source)}};
  const identity={taskId:task.taskId,workflowId:'F15',controlRevision:1,sessionId,deadline:config.deadline};
  const bridge=new OwnedWorkflowHostBridge({receiptSecret:config.receiptSecret,host:app,
    checkpoints:{read:(id,key)=>app.runtime.loadCheckpoint(id,key),writeOnce:(id,key,value)=>app.runtime.saveCheckpointOnce(id,key,value)},
    assertActive:(id,revision)=>{const current=app.runtime.getTask(id);assert.equal(id,task.taskId);assert.equal(revision,1);assert.equal(current.state,'running');assert.notEqual(current.cancelRequested,true);},
    assertIsolation:(id,isolation)=>{assert.equal(mode,'isolated');assert.equal(id,task.taskId);assert.equal(isolation.namespace,snapshot.namespace);
      assert.equal(isolation.snapshotDigest,sha(snapshot));assert.equal(relative(directory,runDirectory),'isolated');}});
  const client=new Client(app);await client.connect();let last,graph;
  const evidence=new Set();
  const input={goal:'Repair the existing pelican riding a bicycle SVG. Its three wheel/pedal animations never start. '
      +'Use only an incremental exact-text patch; preserve all original geometry, layout, IDs and animation transforms/durations. '
      +'N01 read pelican.svg. N02 scope is only pelican.svg. N03 patchDiff MUST be an object with path,expectedSha256,edits[{oldText,newText}] '
      +'compatible with the supplied patchSchema, never a unified diff string. Use exact original source strings. '
      +'N04 and N05 host arguments MUST be that exact patch object directly, not wrapped in patch. N04 performs preview/scope checks; '
      +'N05 actually applies and validates. N06 arguments are {} and delivers only after actual passed verification. Never claim a future write already happened.',
    targetFile:filename,patchGoal:'Make the three existing animateTransform animations start automatically',patchSchema,
    sourceSnapshot:source,sourceSha256:sha(source),initialFailure:initial,allowedPaths:[filename]};
  try {
    await runOwnedWorkflowParent(app.runtime,task.taskId,async worker=>{
      let receipts=[];
      while(!deadlineSignal.aborted) {
        const requestId='pelican-'+randomUUID(),query={workflowVersion:'1.0.0',operation:'advance',...identity,input,
          availableTools:tools.map(({descriptor})=>({name:descriptor.name,version:descriptor.version,inputSchema:descriptor.inputSchema})),
          ...(mode==='isolated'?{mode:'isolated',snapshot}:{}),...(last?{checkpoint:last}:{}),receipts};
        // deadline/session are transport metadata, not new query fields.
        delete query.deadline;delete query.sessionId;
        worker.saveCheckpoint('pelican:send:'+requestId,{state:'sent_or_unknown',inputDigest:sha(query)});
        const start=performance.now(),response=await fetch(config.url,{method:'POST',redirect:'error',signal:deadlineSignal,
          headers:{'content-type':'application/json',accept:'application/json,text/event-stream',authorization:config.inboundAuthorization,
            'x-pa-agent-token':config.innerAuthorization,'x-hw-agentarts-session-id':sessionId,'x-request-id':requestId,
            'x-pa-deadline':config.deadline,'x-invoke-mode':config.invokeMode},body:JSON.stringify({query:JSON.stringify(query)})});
        assert.equal(response.status,200);const text=await response.text();assert.ok(Buffer.byteLength(text)<=1200000);
        graph=parseOwnedWorkflowInvocationBody(text,response.headers.get('content-type'));
        result.stages.push({requestId,wallMs:performance.now()-start,graphState:graph.state,
          nodeStates:Object.fromEntries(Object.entries(graph.nodes).map(([id,node])=>[id,node.state]))});
        worker.saveCheckpoint('pelican:graph',graph.checkpoint);last=graph.checkpoint;receipts=[];
        if(graph.state==='settled') {
          assert.ok(validated?.passed);result.status='passed_real_workflow';result.final=validated;
          return {resultSummary:'Existing pelican animation repaired by actual generated patch and verified readback',evidenceRefs:[...evidence]};
        }
        if(!['progress','awaiting_host'].includes(graph.state)) {
          result.blocker={graphState:graph.state,nodes:Object.fromEntries(Object.entries(graph.nodes)
            .filter(([,node])=>['unknown','unavailable','failed'].includes(node.state)).map(([id,node])=>[id,{state:node.state,reason:node.reason}]))};
          throw Error('Workflow did not advance: '+graph.state);
        }
        if(!graph.proposals.length) {
          const key=sha(result.stages.at(-1).nodeStates);if(key===result.previousProgressKey)throw Error('Workflow has no new evidence or progress');
          result.previousProgressKey=key;continue;
        }
        assert.equal(graph.proposals.length,1);
        for(const proposal of graph.proposals) {
          const start=performance.now(),local=bridge.submit(identity,proposal);
          while(!deadlineSignal.aborted) {
            const pending=app.readHostToolTask(local.localTaskId);
            if(pending.task.state==='waiting_approval') {
              assert.ok(pending.approval?.state==='pending');
              await client.call('authorization.respond',{approvalId:pending.approval.approvalId,expectedRevision:pending.approval.revision,decision:'allow_once'});
            } else if(['succeeded','failed','waiting_reconciliation'].includes(pending.task.state))break;
            await new Promise(resolve=>setTimeout(resolve,10));
          }
          const receipt=bridge.readReceipt(identity,proposal);assert.ok(receipt?.state==='confirmed');
          const records=app.runtime.readToolExecutions(local.localTaskId);assert.equal(records.length,1);assert.equal(records[0].executionStarted,true);
          result.executions.push({nodeId:proposal.nodeId,tool:proposal.toolName,localTaskId:local.localTaskId,wallMs:performance.now()-start,
            operationId:proposal.operationId,evidenceRefs:receipt.evidenceRefs,confirmed:true});
          if(proposal.toolName==='decision.choose_candidate')result.decisions.push({nodeId:proposal.nodeId,selectedId:receipt.result.selectedId});
          for(const ref of receipt.evidenceRefs)evidence.add(ref);receipts.push(receipt);
        }
      }
      throw Error('Original task deadline or cancellation');
    },{deadline:config.deadline});
    result.parentState=app.runtime.getTask(task.taskId).state;
    if(result.status!=='passed_real_workflow'||result.parentState!=='succeeded') {
      result.status='failed_or_unknown';result.failure=app.runtime.getTask(task.taskId).error?.message??'Workflow did not complete';
    }
  }catch(error){result.status='failed_or_unknown';result.failure=String(error.message).slice(0,180);result.parentState=app.runtime.getTask(task.taskId).state;}
  finally {
    while(app.activeTaskCount)await new Promise(resolve=>setTimeout(resolve,10));app.close();app=undefined;
    const persisted=new TaskRuntime(join(runDirectory,'runtime.sqlite'));
    try{result.persistence={parentState:persisted.getTask(task.taskId).state,
      evidenceCount:result.executions.reduce((count,operation)=>count+persisted.readEvidence(operation.localTaskId).length,0),
      readbackOnly:true};}finally{persisted.close();}
    result.wallMs=performance.now()-started;
    result.resources={localHostCpuMicros:process.cpuUsage(hostCpuStart),
      scope:report.shadowScheduling==='overlap_with_main'?'Shared process during overlapping workflows; not exclusive CPU attribution':'Local harness CPU only; model usage in joint report'};
    await writeFile(join(runDirectory,'receipt.json'),JSON.stringify(result,null,2)+'\n');
  }
  return result;
}

try {
  const start=performance.now();service=await startLayaService({...config.localLaya,signal:deadlineSignal,cpuExecutionPolicy:'sequential'});
  report.localModel={device:service.device,torchThreads:service.torchThreads,startupMs:performance.now()-start,records:[]};
  const selector=createOwnedLayaSelector({port:service.port,getApiKey:()=>service.key,isReady:service.isReady,cpuExecutionPolicy:'sequential',
    onDecision:record=>report.localModel.records.push(record)});
  report.resourcesBefore=await resourceSnapshot();const startFlows=performance.now();
  if(report.shadowScheduling==='overlap_with_main')await Promise.all([runGraph('main',selector),runGraph('isolated',selector)]);
  else {await runGraph('main',selector);await runGraph('isolated',selector);}
  report.mainAndShadowWallMs=performance.now()-startFlows;
  report.resourcesAfter=await resourceSnapshot();
  const main=report.runs.find(run=>run.mode==='main'),shadow=report.runs.find(run=>run.mode==='isolated');
  report.comparison={sameBaseline:main.initial.baselineSha256===shadow.initial.baselineSha256,
    rootsSeparate:main.directory!==shadow.directory,
    bothPassed:report.runs.every(run=>run.status==='passed_real_workflow'&&run.parentState==='succeeded'),
    mainSourceUnaffectedByShadow:sha(await readFile(join(main.directory,filename)))===(main.final?.currentSha256??main.initial.currentSha256)};
  report.status=report.comparison.bothPassed?'passed_real_main_and_shadow':'failed_or_partial';
}catch(error){report.status='failed_or_unknown';report.failure=String(error.message).slice(0,160);}
finally {
  await service?.stop();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  report.finishedAt=new Date().toISOString();const text=JSON.stringify(report,null,2)+'\n';
  assert.ok(![config.receiptSecret,config.inboundAuthorization.slice(7),config.innerAuthorization.slice(7)].some(secret=>text.includes(secret)));
  await writeFile(join(directory,'receipt.json'),text);
  process.stdout.write(JSON.stringify({status:report.status,directory,mainAndShadowWallMs:report.mainAndShadowWallMs,
    runs:report.runs.map(({mode,status,wallMs,parentState,failure})=>({mode,status,wallMs,parentState,failure})),
    layaDecisions:report.localModel?.records.length,failure:report.failure},null,2)+'\n');
  if(report.status!=='passed_real_main_and_shadow')process.exitCode=1;
}

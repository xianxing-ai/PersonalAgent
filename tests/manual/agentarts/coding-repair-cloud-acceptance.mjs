// Explicit manual acceptance only. Reads trusted launch config from stdin; never prints credentials.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createAgentArtsRuntimeApplication,createRuntimeOwnedWorkflowImageAdapter} from '@personal-agent/runtime/application';
import {ModelGateway} from '@personal-agent/models';
import {createAdaptiveWorkflowSelector} from '../../../apps/agentarts-runtime/src/adaptive-decision.mjs';
import {startLayaService} from '../../../apps/agentarts-runtime/src/laya-service.mjs';
import {createOwnedLayaSelector} from '../../../apps/agentarts-runtime/src/laya-selector.mjs';
import {createTestImageModelProvider} from './test-image-model-provider.mjs';
import {runCodingRepairFullGraphFixture} from './coding-repair-full-graph.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const wukong=`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500" aria-label="孙悟空骑着白龙马">
<rect width="800" height="500" fill="#eaf5ff"/><path d="M30 410H770" stroke="#86a99e" stroke-width="8"/>
<g id="horse-motion"><g id="white-dragon-horse"><ellipse cx="420" cy="310" rx="145" ry="65" fill="white" stroke="#496379" stroke-width="4"/>
<path d="M510 295L560 185L613 182L650 238L597 265L570 340" fill="white" stroke="#496379" stroke-width="4"/>
<path d="M340 340L307 410M390 350L402 410M490 340L518 410M536 325L573 399" stroke="#496379" stroke-width="17"/>
<circle cx="611" cy="213" r="5"/><path d="M283 300Q214 228 185 330" fill="none" stroke="#607993" stroke-width="15"/></g>
<animateTransform id="horse-gallop" attributeName="transform" type="translate" values="0 0;0 -5;0 0" dur="0.8s" begin="indefinite" repeatCount="indefinite"/></g>
<g id="rider-motion"><g id="wukong"><path d="M400 223L381 285L459 285L439 222" fill="#e6b23b" stroke="#805233" stroke-width="4"/>
<circle cx="421" cy="182" r="34" fill="#dfaa70"/><path d="M387 170Q420 139 454 170" fill="none" stroke="#8b4e2a" stroke-width="13"/>
<path d="M387 167L454 167" stroke="#e4b329" stroke-width="7"/><path d="M399 201Q422 216 442 200" fill="none" stroke="#8a4b30" stroke-width="4"/>
<path d="M393 240L351 215M443 239L486 211M397 279L373 332M444 279L470 329" stroke="#be803b" stroke-width="15"/>
<path id="golden-staff" d="M347 127L499 329" stroke="#d6ad30" stroke-width="10"/><path d="M368 225Q309 216 298 261" stroke="#d3443b" fill="none" stroke-width="18"/></g>
<animateTransform id="rider-bob" attributeName="transform" type="translate" values="0 0;0 -8;0 0" dur="0.8s" begin="indefinite" repeatCount="indefinite"/></g></svg>`;
function checker(target,ids,groups){return `const assert=require('node:assert/strict'),fs=require('node:fs');
const text=fs.readFileSync(${JSON.stringify(target)},'utf8');assert.match(text,/<svg\\b/i);assert.doesNotMatch(text,/<(?:script|iframe|foreignObject)\\b|\\b(?:href|src)\\s*=|@import/i);
for(const id of ${JSON.stringify(groups)})assert.ok(text.includes('id="'+id+'"'),'required_artwork_missing:'+id);
for(const id of ${JSON.stringify(ids)}){const tags=text.match(/<animateTransform\\b[^>]*>/g)||[];const tag=tags.find(tag=>tag.includes('id="'+id+'"'));assert.ok(tag,'animation_missing:'+id);
const begin=/\\bbegin="([^"]*)"/.exec(tag)?.[1]??'0s';assert.ok(['0','0s','0ms'].includes(begin),'animation_not_started:'+id);assert.match(tag,/repeatCount="indefinite"/);assert.match(tag,/dur="(?:[0-9.]+)(?:m?s)"/);}
console.log(JSON.stringify({passed:true,oracle:'Node SVG animation-start contract; visual motion requires separate browser evidence'}));\n`;
}
export async function codingRepairCloudFixture(name){
  const pelican=await readFile(fileURLToPath(new URL('./fixtures/pelican-animation-bug.svg',import.meta.url)),'utf8');
  if(!['wukong','pelican'].includes(name))throw Error('Unknown public fixture');
  const target=name+'-public.svg',ids=name==='wukong'?['horse-gallop','rider-bob']:['back-spin','front-spin','pedal-spin'];
  const groups=name==='wukong'?['wukong','white-dragon-horse']:['wheel-back','wheel-front'];
  return {targetPath:target,baseline:name==='wukong'?wukong:pelican,
    files:{'checks/animation.test.cjs':checker(target,ids,groups)},checkerArgs:['--test','checks/animation.test.cjs'],
    goal:'请通过唯一 coding.repair.workflow 工具派发一个 coder 子任务，运行整个 F15 图完成当前公开项目的增量修复。'
      +'用户目标文件为 '+target+'，文件里'+(name==='wukong'?'孙悟空骑白龙马':'鹈鹕骑自行车')+'已经画好，但动画没有启动。'
      +'请读取当前隔离文件，保留人物、白马或自行车的全部图形、坐标、颜色、持续时间和重复设置，找出 begin 属性造成的动画不启动问题，'
      +'仅将现有动画的 begin="indefinite" 改为 begin="0s"，不得修改 checker、依赖或无关文件。'
      +'子任务 codingRepair.mode 由本次测试指定；必须经过实际检查和原 Evidence 后再结束。'};
}
function normalize(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Trusted launch config required');
  const gateway=new URL(raw.gatewayUrl);
  if(gateway.protocol!=='https:'||gateway.username||gateway.password||gateway.search||gateway.hash||gateway.pathname!=='/'
    ||!/^[-A-Za-z0-9_]{1,64}$/.test(raw.runtimeName)||!/^[-A-Za-z0-9_.]{1,128}$/.test(raw.version)||/^(?:latest|default)$/i.test(raw.version))throw Error('Exact original AgentArts gateway/Runtime/version required');
  for(const name of ['innerAuthorization','inboundAuthorization'])if(typeof raw[name]!=='string'||!/^Bearer [\x21-\x7e]+$/.test(raw[name]))throw Error('Trusted inbound/inner authorization is unavailable');
  if(!Number.isFinite(Date.parse(raw.deadline))||Date.parse(raw.deadline)<=Date.now()||!raw.localLaya||!raw.modelRevision)throw Error('Original deadline and existing local Laya configuration required');
  if(!raw.deploymentEvidence||raw.deploymentEvidence.version!==raw.version||typeof raw.deploymentEvidence.image!=='string'
    ||typeof raw.deploymentEvidence.sourceCommit!=='string'||!raw.deploymentEvidence.evidenceRef)throw Error('Provide exact new image/source/version deployment readback evidence');
  return {...raw,gatewayUrl:gateway.origin};
}
/** No package/image publication. Same production Runtime factory/driver, fixed deployed image and real local Laya+teacher. */
export async function runCodingRepairCloudAcceptance(raw){
  const config=normalize(raw),directory=resolve(config.artifactRoot??'.cache/coding-repair-cloud-'+Date.now());await mkdir(directory,{recursive:true});
  const deadlineSignal=AbortSignal.timeout(Math.max(1,Date.parse(config.deadline)-Date.now()));
  const teacherCalls=[],layaCalls=[],decisions=[],graphCalls=[],transportStates=[];let service,local,stage='teacher_capabilities';
  const common={gatewayUrl:config.gatewayUrl,runtimeName:config.runtimeName,deploymentVersion:config.version,
    transport:'wss',websocketUrl:config.gatewayUrl.replace(/^https:/,'wss:')+'/runtimes/'+config.runtimeName+'/ws?endpoint='+config.version,
    allowHttpsFallback:false,invokeMode:config.invokeMode??'published',authorizationProvider:{read:async()=>config.inboundAuthorization},
    websocketAuthorizationProvider:{read:async()=>config.innerAuthorization},onTransportState:state=>transportStates.push({...state,at:new Date().toISOString()}),
    ...(config.receiptSecret?{readOwnedWorkflowReceiptSecret:async()=>config.receiptSecret}:{})};
  const image=createRuntimeOwnedWorkflowImageAdapter(common),started=performance.now(),runs=[];
  try{
    const teacherProvider=await createTestImageModelProvider({url:config.gatewayUrl+'/runtimes/'+config.runtimeName+'/invocations?endpoint='+config.version,
      token:config.innerAuthorization.slice(7),inboundAuthorization:config.inboundAuthorization,deadline:config.deadline,signal:deadlineSignal,
      invokeMode:config.invokeMode??'published',onRecord:record=>teacherCalls.push(record)});
    const teacher=new ModelGateway(teacherProvider),start=performance.now();stage='local_model_start';
    service=await startLayaService({...config.localLaya,signal:deadlineSignal,cpuExecutionPolicy:'sequential'});
    local={device:service.device,threads:service.torchThreads,startupMs:performance.now()-start};stage='runtime_fixture';
    const laya=createOwnedLayaSelector({port:service.port,getApiKey:()=>service.key,isReady:service.isReady,cpuExecutionPolicy:'sequential',onDecision:record=>layaCalls.push(record)});
    let application;const selectors=new Map();
    const selector={bindApplication:app=>{application=app;},select:async request=>{
      const original=application.runtime.listTasks({limit:100}).items.find(task=>{
        const graph=application.runtime.loadCheckpoint(task.taskId,'coding-repair:graph');
        return task.state==='running'&&graph?.result?.proposals?.some(proposal=>proposal.toolName==='decision.choose_candidate'&&proposal.arguments.requestId===request.requestId);
      });
      if(!original)throw Error('Original Runtime-bound decision proposal unavailable');
      let adaptive=selectors.get(original.taskId);
      if(!adaptive){adaptive=createAdaptiveWorkflowSelector({laya,teacher,modelRevision:config.modelRevision,qualification:()=>false,
        store:{read:key=>application.runtime.loadCheckpoint(original.taskId,key),writeOnce:(key,value)=>application.runtime.saveCheckpointOnce(original.taskId,key,value)},
        onRecord:record=>decisions.push(record)});selectors.set(original.taskId,adaptive);}
      const context=JSON.parse(request.context),value=await adaptive.decide({...request,site:context.nodeId,criteriaVersion:'generic-coding-repair-current-node-v1',
        criteria:'Choose a candidate satisfying only the current node contract, exact published schema and actual prior evidence; an unexecuted request is not claimed success. Prefer minimal source changes, never edit validation to pass.',
        sources:[{sourceId:'F15-'+context.nodeId,revision:sha(request.context),sha256:sha(request.context)}],
        abstainIds:(context.candidateValues??[]).filter(value=>value.abstain).map(value=>value.id)});
      return {selectedId:value.selectedId,...(value.metadata?{metadata:value.metadata}:{})};
    }};
    for(const name of config.cases??['wukong','pelican'])for(const mode of config.modes??['main','isolated']){
      const fixture=await codingRepairCloudFixture(name);fixture.goal+=' 本次明确要求 codingRepair.mode="'+mode+'"。';
      const port={...image,advance:async request=>{
        const start=performance.now(),record={case:name,mode,taskId:request.taskId,sessionId:request.sessionId,requestId:request.requestId,version:config.version,
          startedAt:new Date().toISOString(),status:'sent_or_unknown'};graphCalls.push(record);
        try{const value=await image.advance(request);record.status='returned';record.state=value.state;record.round=value.codingRepair?.round;
          record.nodes=Object.fromEntries(Object.entries(value.nodes).map(([id,node])=>[id,node.state]));return value;}
        finally{record.elapsedMs=performance.now()-start;record.finishedAt=new Date().toISOString();}
      }};
      const report=await runCodingRepairFullGraphFixture({fakeModel:false,image:port,selector,selectorEvidenceKind:'real_laya_with_teacher_and_production_agentarts_graph',
        createApplication:fixtureOptions=>createAgentArtsRuntimeApplication({...fixtureOptions,...common,
          // Publish the strict public-fixture snapshot only. Runtime adds the original coding dispatcher;
          // the graph host resolves its remaining local tools through the original F15 driver.
          competitionToolExports:fixtureOptions.tools.filter(tool=>tool.descriptor.name==='coding.repair.snapshot').map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
            exportPolicyVersion:'public-synthetic-coding-fixture-v1',accepts:()=>true,project:({result})=>result})),
          initialRequestMode:'goal-with-tools-json',responseMode:'tool-proposal-json'}),
        mode,fixture,expectInitialFailure:true,deadline:config.deadline,artifactRoot:join(directory,name+'-'+mode)});
      runs.push({case:name,mode,report});
      // No passing label for partial graph, absent original receipts, or a cloud self-report.
      assert.equal(report.parent.state,'succeeded');assert.equal(report.child?.state,'succeeded');assert.equal(report.graph?.state,'settled');
      for(const id of ['01','02','03','04','05','06'])assert.equal(report.graph.nodes['F15_N'+id],'completed');
      assert.notEqual(report.baselineVerification.exitCode,0);assert.match(report.baselineVerification.stdout,/animation_not_started:/);assert.equal(report.unrelatedUnchanged,true);
      if(mode==='main')assert.equal(report.mainRootAfterSha256,sha(fixture.baseline.replaceAll('begin="indefinite"','begin="0s"')),'Final readback must preserve all non-begin artwork bytes');
      if(mode==='isolated')assert.equal(report.mainRootAfterSha256,report.mainRootBeforeSha256);
    }
    const report={kind:'real_cloud_complete_F15_and_local_laya_teacher',deployment:config.deploymentEvidence,localModel:local,
      wallMs:performance.now()-started,runs,graphCalls,teacherCalls,layaCalls,decisions,transportStates,
      boundaries:{models:'real; local Laya unqualified, original cloud teacher records separate',
        visual:'Node SVG contract only; real rendered motion still requires independent browser observation',
        initialArtifact:'public static/no-start fixture written by harness, not a claim that a model generated it',
        publication:'No image publication performed by this runner'}};
    const serialized=JSON.stringify(report,null,2);
    for(const secret of [config.innerAuthorization.slice(7),config.inboundAuthorization.slice(7),config.receiptSecret].filter(Boolean))assert.ok(!serialized.includes(secret));
    await writeFile(join(directory,'receipt.json'),serialized);return {directory,status:'passed_real_complete_graphs',wallMs:report.wallMs,runs:runs.map(run=>({case:run.case,mode:run.mode,state:run.report.graph.state,totalMs:run.report.totalMs})),graphCalls:graphCalls.length,teacherCalls:teacherCalls.filter(call=>call.operation==='model_turn'&&call.status==='returned').length,layaCalls:layaCalls.length};
  }catch(error){
    const secrets=[config.innerAuthorization.slice(7),config.inboundAuthorization.slice(7),config.receiptSecret].filter(Boolean);
    const message=secrets.reduce((text,secret)=>text.replaceAll(secret,'[redacted]'),String(error?.message??'Acceptance failed')).slice(0,1000);
    const failure={directory,status:'failed_or_unknown',stage,localModel:local,code:typeof error?.code==='string'?error.code:'ASSERTION_OR_EXTERNAL_FAILURE',message,
      runs:runs.map(run=>({case:run.case,mode:run.mode,state:run.report.graph?.state})),graphCalls,teacherCalls,layaCalls,decisions};
    await writeFile(join(directory,'failure.json'),JSON.stringify(failure,null,2));return failure;
  }finally{image.close();await service?.stop();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  if(!process.argv.includes('--execute'))throw Error('Explicit --execute and trusted stdin configuration required; no implicit cloud invocation');
  const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
  const report=await runCodingRepairCloudAcceptance(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));
  process.stdout.write(JSON.stringify(report)+'\n');if(report.status!=='passed_real_complete_graphs')process.exitCode=1;
}

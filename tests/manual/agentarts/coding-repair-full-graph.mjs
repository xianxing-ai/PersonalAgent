import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Client} from '@personal-agent/client';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier,createWorkflowDecisionTool} from '@personal-agent/agentarts';
import {createIsolatedCodingRepairHost,createIsolatedCodingRepairTools,createWorkspaceCommandTool} from '@personal-agent/coding-tools';
import {createRuntimeApplication,readRuntimeCodingVerificationEvidence,CODING_REPAIR_WORKFLOW_TOOL} from '@personal-agent/runtime/application';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';

const sha=value=>createHash('sha256').update(value).digest('hex');
const key='explicit-fake-cloud-receipt-secret-more-than-32';
const until=async(predicate,timeout=60000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Original Runtime graph did not reach the expected state');};
export function createExplicitFakeCodingRepairImage(target,observed=[]) {
  const engine=new OwnedWorkflowEngine({checkpointSecret:'explicit-fake-cloud-checkpoint-secret-32',externalHost:true,allowIsolatedProposals:true,
    decisionTool:{name:'decision.choose_candidate',version:'1.0.0'},receiptVerifier:createOwnedWorkflowReceiptVerifier({secret:key}),
    prepareCandidates:async context=>{
      const c=context.codingRepair,sessionId=c.configuration.session.sessionId;
      let value;
      if(context.node.id==='F15_N01')value={toolName:'workspace.coding_snapshot',toolVersion:'1.0.0',arguments:{sessionId}};
      else if(context.node.id==='F15_N03'&&c.readPath)value={toolName:'coding.repair.read',toolVersion:'1.0.0',arguments:{sessionId,path:c.readPath}};
      else if(context.node.id==='F15_N02')value={scope:[target],forbiddenActions:['unrelated file changes','verification removal']};
      else if(context.node.id==='F15_N03') {
        const source=c.snapshot.files.find(file=>file.path===target),number=c.round?2:1;
        value={diagnosis:c.round?'Actual node:test expected 3; repair only the return expression':'First incremental candidate, requiring actual verification',
          patches:[{path:target,expectedSha256:source.sha256,edits:[{oldText:'()=>'+number,newText:'()=>'+(number+1)}]}]};
      }else if(context.node.id==='F15_N04')value={arguments:{sessionId,patches:c.pendingPatch.patches}};
      else if(context.node.id==='F15_N05')value={arguments:{sessionId,patches:c.pendingPatch.patches,recipeIds:['unit']}};
      else if(context.node.id==='F15_N06') {
        const baseline=new Map(c.configuration.initialSnapshot.files.map(file=>[file.path,file.sha256]));
        value={arguments:{version:1,sessionId,baselineSnapshotId:c.configuration.session.baselineSnapshotId,snapshotId:c.snapshot.snapshotId,
          paths:c.snapshot.files.filter(file=>baseline.get(file.path)!==file.sha256).map(file=>file.path),
          verificationRunIds:[...c.verification].reverse().filter(file=>file.status==='VALID').slice(0,1).map(file=>file.runId)}};
      }else throw Error('Unexpected F15 node '+context.node.id);
      return [{id:'candidate',description:'Explicit Fake externally generated candidate',value},{id:'review',description:'No supported candidate',value:null,abstain:true}];
    }});
  return {bindingId:sha('explicit-fake-fixed-image-v1'),receiptSecret:async()=>key,advance:async request=>{
    const begin=Date.now();const result=await engine.advance(request);observed.push({requestId:request.requestId,state:result.state,round:result.codingRepair?.round,
      catalogCount:request.availableTools.length,catalogBytes:Buffer.byteLength(JSON.stringify(request.availableTools)),
      nodes:Object.fromEntries(Object.entries(result.nodes).map(([id,value])=>[id,value.state])),elapsedMs:Date.now()-begin});return result;}};
}
/** Public synthetic fixture. Fake models are explicit; filesystem, PowerShell, Node tests, Policy and SQLite are real. */
export async function runCodingRepairFullGraphFixture(options={}) {
  if(options.fakeModel!==true&&(!options.image||!options.selector||(!options.coordination&&!options.createApplication)))
    throw Error('Real acceptance requires explicit original image, real local selector and original Competition coordinator; no Fake fallback');
  if(options.fakeModel!==true&&(!Number.isFinite(Date.parse(options.deadline))||Date.parse(options.deadline)<=Date.now()))
    throw Error('Real acceptance requires the original explicitly supplied task deadline');
  const root=resolve(options.artifactRoot??'.cache/coding-repair-full-graph');await mkdir(root,{recursive:true});
  const directory=await mkdtemp(join(root,'run-')),user=join(directory,'user'),sessions=join(directory,'sessions');
  await mkdir(join(user,'checks'),{recursive:true});const target=options.fixture?.targetPath??options.targetPath??'feature-'+randomUUID().slice(0,8)+'.cjs';
  const baseline=options.fixture?.baseline??'// User has an uncommitted target edit; preserve it\nmodule.exports=()=>1;\n';
  if(target.includes('\\')||target.split('/').some(part=>!part||part==='..'||part==='.')||target.includes(':'))throw Error('Fixture target must be a relative public source path');
  await mkdir(join(user,target,'..'),{recursive:true});
  await writeFile(join(user,target),baseline);await writeFile(join(user,'unrelated-user-edit.txt'),'User uncommitted unrelated content\n');
  await writeFile(join(user,'package.json'),JSON.stringify({name:'synthetic-independent-project',scripts:{test:'node --test'}}));
  await writeFile(join(user,'checks','actual-check.cjs'),"const assert=require('node:assert/strict'); assert.equal(require('../"+target+"')(),3);\n");
  for(const [name,content] of Object.entries(options.fixture?.files??{})) {
    if(name.includes('\\')||name.split('/').some(part=>!part||part==='..'||part==='.')||name.includes(':'))throw Error('Fixture files must be relative public paths');
    await mkdir(join(user,name,'..'),{recursive:true});await writeFile(join(user,name),content);
  }
  let baselineVerification=null;
  if(options.expectInitialFailure===true){
    const startedAt=new Date().toISOString(),started=Date.now(),remaining=Date.parse(options.deadline)-Date.now();
    if(!Number.isFinite(remaining)||remaining<=0||!options.fixture?.checkerArgs)throw Error('Initial verification requires its original deadline and public checker');
    const checked=spawnSync(process.execPath,options.fixture.checkerArgs,{cwd:user,windowsHide:true,shell:false,encoding:'utf8',timeout:Math.min(2147483647,remaining)});
    baselineVerification={startedAt,finishedAt:new Date().toISOString(),elapsedMs:Date.now()-started,exitCode:checked.status,
      signal:checked.signal,stdout:checked.stdout,stderr:checked.stderr,scope:'public fixture precondition, not a graph-node Evidence receipt'};
    if(checked.error||checked.signal||checked.status===null||checked.status===0)throw Error('Public baseline did not reproduce the required initial checker failure');
  }
  const observed=[],operations=[];let app,host,activeHostOperations=0;
  const defer=Object.fromEntries(['start','list','read','snapshot','preview','patch','verify','check','publish','reconcile'].map(name=>[name,async(...args)=>{
    const begin=Date.now();activeHostOperations++;
    try{await options.beforeHostOperation?.({name,args,user,app});return await host[name](...args);}
    finally{operations.push({name,elapsedMs:Date.now()-begin});activeHostOperations--;}}]));
  const original=createIsolatedCodingRepairTools(defer),tools=[...original];
  for(const [source,name] of [['snapshot','workspace.coding_snapshot'],['preview','workflow.host.f15_n04'],['check','workflow.host.f15_n05'],['publish','workflow.host.f15_n06']]) {
    const tool=original.find(item=>item.descriptor.name==='coding.repair.'+source);tools.push({...tool,descriptor:{...tool.descriptor,name}});
  }
  tools.push(createWorkflowDecisionTool({selector:options.selector??{select:async request=>request.candidates.find(candidate=>candidate.id!=='review').id}}));
  const mode=options.mode??'main';
  const coordination=options.coordination??(options.fakeModel===true?new FakeCoordinationPort(request=>{
    if(request.continuation)return {kind:'text',text:'The original F15 child completed with actual verification receipts',verification:'mock'};
    return {kind:'tool_proposal',proposalId:'coding-start',toolName:CODING_REPAIR_WORKFLOW_TOOL,toolVersion:'1.0.0',verification:'mock',
      arguments:{subtasks:[{subtaskId:'repair',role:'coder',goal:options.fixture?.goal??'Repair '+target+' minimally while retaining the user comment; expected value 3'}],codingRepair:{mode}}};
  }):undefined);
  const config={path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-f15-host',coordination,
    coordinationBinding:sha('explicit-fake-original-fixed-deployment'),tools,
    automaticTools:[...tools.filter(tool=>!options.manualApprovalTools?.includes(tool.descriptor.name)).map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version})),{toolName:CODING_REPAIR_WORKFLOW_TOOL,toolVersion:'1.0.0'}],
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,available:()=>true})),
    codingRepair:{image:options.image??createExplicitFakeCodingRepairImage(target,observed),authorizeMetadata:()=>{},projectSource:async input=>input.receipt.result},
    ...(options.applicationOptions??{})};
  const createApplication=options.createApplication??createRuntimeApplication;
  app=createApplication(config);options.selector?.bindApplication?.(app);
  const hostConfig={workspaceRoot:user,sessionRoot:sessions,workspaceId:'synthetic-fixture-workspace',
    configurationRef:sha('fixture-original-command-identity'),patch:{powerShellPath:options.powerShellPath??process.env.PA_TEST_PWSH??'C:/Program Files/PowerShell/7/pwsh.exe'},
    recipes:[{recipeId:'unit',packageIds:[],required:true}],
    createCommandTool:({rootPath})=>createWorkspaceCommandTool({rootPath,recipes:[{id:'unit',executable:process.execPath,args:options.fixture?.checkerArgs??['--test','checks/actual-check.cjs']}]}),
    resolveOriginalTaskId:taskId=>app.runtime.loadCheckpoint(taskId,'coding-repair:parent')?.taskId??taskId,
    readVerificationEvidence:async input=>readRuntimeCodingVerificationEvidence(app,input),
    ...(options.hostOptions??{})};
  host=await createIsolatedCodingRepairHost(hostConfig);
  try {
    let client=new Client(app,Date.now);await client.connect();const begin=Date.now();
    const {taskId}=await client.call('task.submit',{goal:options.fixture?.goal??'Perform the complete F15 minimal repair workflow',conversationId:'synthetic-f15'},
      {idempotencyKey:'synthetic-f15-'+randomUUID(),timeoutMs:options.fakeModel===true?60000:Date.parse(options.deadline)-Date.now()});
    // Cancellation can settle a Runtime task before the original host command has finished unwinding.
    // Capture its report only after both the Runtime workers and fixture-owned host operations settle.
    const waitTask=()=>until(()=>app.activeTaskCount===0&&activeHostOperations===0&&['succeeded','failed','waiting_approval','waiting_reconciliation','cancelled'].includes(app.runtime.getTask(taskId).state),
      options.fakeModel===true?60000:Math.max(1,Date.parse(app.runtime.loadCheckpoint(taskId,'application-deadline'))-Date.now()));
    await waitTask();
    let approvals=0,restarts=0;
    while(options.approveOriginalOperations===true&&app.runtime.getTask(taskId).state==='waiting_approval') {
      const waiting=app.runtime.listTasks({limit:100}).items.filter(task=>task.state==='waiting_approval');
      const original=waiting.flatMap(task=>{try{return [app.readHostToolTask(task.taskId)];}catch{return [];}}).find(task=>task.approval?.state==='pending');
      if(!original)throw Error('No original host approval was available');
      if(options.restartOnApproval===true) {app.close();app=createApplication(config);options.selector?.bindApplication?.(app);host=await createIsolatedCodingRepairHost(hostConfig);
        client=new Client(app,Date.now);await client.connect();restarts++;}
      const approval=app.readHostToolTask(original.task.taskId).approval;
      await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});approvals++;
      await waitTask();
    }
    const child=app.runtime.listTasks({conversationId:'desktop-subtask:'+taskId,limit:100}).items.find(task=>app.runtime.loadCheckpoint(task.taskId,'coding-repair:graph'));
    const graph=child?app.runtime.loadCheckpoint(child.taskId,'coding-repair:graph'):undefined;
    const userAfter=await readFile(join(user,target),'utf8');const allTasks=app.runtime.listTasks({limit:100}).items;
    const report={verification:options.fakeModel===true?'explicit_fake_model_real_host':options.selectorEvidenceKind??'real_cloud_graph_injected_selector_unverified',directory,user,target,mode,totalMs:Date.now()-begin,
      parent:app.runtime.getTask(taskId),child:child?app.runtime.getTask(child.taskId):null,
      graph:graph?.result?{state:graph.result.state,nodes:Object.fromEntries(Object.entries(graph.result.nodes).map(([id,node])=>[id,node.state])),codingRepair:graph.result.codingRepair}:null,
      timings:graph?.timings??[],observed,operations,mainRootBeforeSha256:sha(baseline),mainRootAfterSha256:sha(userAfter),
      baselineVerification,retainsUserComment:userAfter.startsWith('// User has an uncommitted target edit; preserve it\n'),
      unrelatedUnchanged:(await readFile(join(user,'unrelated-user-edit.txt'),'utf8'))==='User uncommitted unrelated content\n',
      approvals,restarts,taskCount:allTasks.length,evidence:allTasks.flatMap(task=>app.runtime.readToolExecutions(task.taskId).map(record=>({taskId:task.taskId,...record}))),
      cloudCalls:Array.isArray(coordination?.requests)?coordination.requests.length:null};
    await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));return report;
  } finally {while(app.activeTaskCount||activeHostOperations)await new Promise(resolve=>setTimeout(resolve,10));app.close();}
}
if(process.argv[1]&&import.meta.url===new URL('file:///'+process.argv[1].replaceAll('\\','/')).href) {
  if(!process.argv.includes('--fake'))throw Error('This synthetic runner requires --fake; it does not discover credentials or call cloud services');
  const report=await runCodingRepairFullGraphFixture({fakeModel:true,mode:process.argv.includes('--shadow')?'isolated':'main'});
  console.log(JSON.stringify({directory:report.directory,parent:report.parent.state,child:report.child?.state,graph:report.graph?.state,totalMs:report.totalMs}));
}

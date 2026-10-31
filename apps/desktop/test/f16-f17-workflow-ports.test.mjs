import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {createGitTools,createWorkspaceCommandTool,createWorkspacePatchPreviewTool} from '@personal-agent/coding-tools';
import {createWorkflowDecisionTool,OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier} from '@personal-agent/agentarts';
import {register as registerGitHub} from '@personal-agent/github';
import * as publicRuntime from '@personal-agent/runtime/application';
// Root owns the public re-exports; inject the exact built modules until that shared edit lands.
import {createF16CiFailurePorts} from '../../runtime/dist/application/f16-ci-failure-ports.js';
import {createF17ReproductionPorts} from '../../runtime/dist/application/f17-reproduction-ports.js';
import {createF17ConfiguredDriverResolver} from '../../runtime/dist/application/f17-configured-driver.js';
import {createF17ObservedCommandTool} from '../../runtime/dist/application/f17-command-observer.js';
import {createF16HeadReader} from '../../runtime/dist/application/f16-head-reader.js';
import {readF16Source,awaitF16Port} from '../../runtime/dist/application/f16-source-receipts.js';
import {createF16F17WorkflowPorts,F16_F17_CONFIGURATIONS} from '../electron/f16-f17-workflow-ports.js';
import {createDesktopF16F17WorkflowPorts} from '../electron/f16-f17-desktop-ports.js';
import {createF16F17CaseConfiguration} from '../electron/f16-f17-case-config-host.js';
import {createWorkspaceConfigHost} from '../electron/workspace-config-host.js';
import {createWorkspaceCommandRecipeTool} from '../electron/workspace-command-recipes.js';
import {createDesktopDeveloperToolsHost} from '../electron/developer-tools-host.js';
import {findF17InitialFailure,readF17InitialFailure} from '../electron/f17-initial-failure-source.js';
import {createWorkflowExportConsent} from '../electron/workflow-export-consent.js';
import {readF16F17DecisionScope,prepareF16F17DecisionQuestion} from '../electron/f16-f17-decision-source.js';
import {readConfiguredWorkflowDecisionScope,prepareConfiguredWorkflowDecisionQuestion} from '../electron/configured-workflow-decision-source.js';

const runtimeModule={...publicRuntime,createF16CiFailurePorts,createF17ReproductionPorts,createF17ConfiguredDriverResolver,
  createF17ObservedCommandTool,createF16HeadReader,readF16Source,awaitF16Port};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sleep=()=>new Promise(resolve=>setTimeout(resolve,5));

// Explicit synthetic image/selector/consent and temporary public-shaped repository.
// Commands and Git execute locally; the original configured worker, Policy, bridge and SQLite are real.
async function fixture(t,{workflow='F17',deny,unknownHead=false,denyNestedHead=false,denyReview=false,substitute,skipDecision=false,abstain=false,exportMutation,noReview=false,ciFailure=false,productionSources=false,ownedComposition=false,realEngine=false,preservedAcceptance=false,noPublication=false}={}){
  const cache=resolve('.cache/f16-f17');await mkdir(cache,{recursive:true});
  const directory=await mkdtemp(join(cache,'configured-')),root=join(directory,'workspace');await mkdir(root);
  const sourceText=preservedAcceptance?'export const sum=(a,b)=>a-b;\n':productionSources?'function broken( {\n':"import test from 'node:test';import assert from 'node:assert/strict';test('original failure',()=>assert.equal(1,2));\n";
  const sourcePath=preservedAcceptance?'src/math.mjs':'failure.test.mjs';
  if(preservedAcceptance){
    await mkdir(join(root,'src'));await mkdir(join(root,'.github/workflows'),{recursive:true});
    await writeFile(join(root,'package.json'),JSON.stringify({scripts:{test:'node --test failure.test.mjs'}}));
    await writeFile(join(root,'.github/workflows/ci.yml'),'name: Synthetic CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n');
    await writeFile(join(root,'failure.test.mjs'),"import test from 'node:test';import assert from 'node:assert/strict';import {sum} from './src/math.mjs';test('sum',()=>assert.equal(sum(1,2),3));\n");
  }
  await writeFile(join(root,sourcePath),sourceText);
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-b','fixture');git('config','user.name','Synthetic');git('config','user.email','fixture@example.invalid');
  git('add','.');git('commit','-qm','Synthetic failure');git('remote','add','origin','https://github.com/xianxing-ai/PersonalAgent.git');
  const headSha=git('rev-parse','HEAD'),repository='xianxing-ai/PersonalAgent';let app,client,ports,revoked=false;
  const counters={command:0,head:0},exports=[],requests=[],actions=[];
  const patch={path:sourcePath,expectedSha256:createHash('sha256').update(sourceText).digest('hex'),
    edits:[preservedAcceptance?{oldText:'a-b',newText:'a+b'}:{oldText:'assert.equal(1,2)',newText:'assert.equal(1,1)'}]};
  const recipe={id:productionSources?'node-check':workflow==='F17'?'reproduce':'ci-verify',executable:process.execPath,args:workflow==='F17'?['--test','--test-reporter=tap','failure.test.mjs']:
    ['--input-type=module','-e',"import {execFileSync as run} from 'node:child_process';run(process.execPath,['--test','failure.test.mjs']);run('git',['add','failure.test.mjs']);run('git',['commit','-qm','Synthetic verified patch']);process.stdout.write(JSON.stringify({repository:'xianxing-ai/PersonalAgent',headSha:run('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),runId:9,jobId:10}));"]};
  if(preservedAcceptance)recipe.args=['--input-type=module','-e',"import {execFileSync as run} from 'node:child_process';run(process.execPath,['--test','failure.test.mjs']);"
    +(noPublication?'':"run('git',['add','src/math.mjs']);run('git',['commit','-qm','Synthetic publication boundary']);")
    +"console.log('Local check only, no CI identity in stdout');"];
  const originalCommand=createWorkspaceCommandTool({rootPath:root,recipes:[recipe]}),commandTool={...originalCommand,
    execute:async(...args)=>{counters.command++;return originalCommand.execute(...args);}};
  const originalGit=createGitTools({repository,rootPath:root,sourceBranch:'fixture',remoteName:'origin',
    remoteUrl:'https://github.com/xianxing-ai/PersonalAgent.git',allowedPaths:[sourcePath],authorName:'Synthetic',
    authorEmail:'fixture@example.invalid',readVerification:async()=>undefined}).head;
  const gitTool={...originalGit,execute:async(...args)=>{counters.head++;
    if(unknownHead&&counters.head===3)throw new ProtocolError('RESULT_UNKNOWN','Synthetic interrupted HEAD');
    return originalGit.execute(...args);}};
  const originalDecision=createWorkflowDecisionTool({selector:{select:async request=>({selectedId:request.candidates[0].id})}});
  const decision={...originalDecision,async execute(input,context){
    if(productionSources||realEngine){
      const readDecision=realEngine?readConfiguredWorkflowDecisionScope:readF16F17DecisionScope;
      const prepareDecision=realEngine?prepareConfiguredWorkflowDecisionQuestion:prepareF16F17DecisionQuestion;
      const proof=readDecision(app,context);assert.equal(proof?.workflowId,workflow);
      assert.equal(proof.taskId,context.taskId);assert.ok(Object.isFrozen(proof));
      let fence;
      assert.deepEqual(prepareDecision({application:app,scope:context,question:{prepare:(scope,options)=>{
        assert.equal(scope,context);assert.deepEqual(Object.keys(options),['assertCurrent']);fence=options.assertCurrent;
      }}}),proof);assert.equal(fence(),true);
      assert.throws(()=>readDecision(app,{...context,argumentsDigest:'f'.repeat(64)}),{code:'UNAUTHORIZED'});
      assert.throws(()=>readDecision(app,{...context,proposal:{toolName:'decision.choose_candidate',toolVersion:'1.0.0',arguments:{}}}),{code:'UNAUTHORIZED'});
      const key='coding-repair:host:'+proof.operationId,edge=app.runtime.loadCheckpoint(proof.parentTaskId,key);
      app.runtime.saveCheckpoint(proof.parentTaskId,key,{...edge,localTaskId:'foreign'});
      assert.throws(()=>readDecision(app,context),{code:'UNAUTHORIZED'});
      assert.equal(fence(),false);
      app.runtime.saveCheckpoint(proof.parentTaskId,key,edge);
    }
    return originalDecision.execute(input,context);
  }};
  const github=[];
  registerGitHub({register:tool=>{github.push(tool);return ()=>{};}},{provider:{verification:'mock',execute:async(op,input)=>{
    const success=input.status==='success'||input.runId===9,page=items=>({items,page:1,nextPage:null,hasMore:false});
    if(op==='actions.run.list')return page([{id:success?9:7,name:'Synthetic CI',status:'completed',conclusion:success&&!ciFailure?'success':'failure',
      headSha:success?git('rev-parse','HEAD'):headSha,url:'https://github.com/xianxing-ai/PersonalAgent/actions/runs/'+(success?9:7),createdAt:new Date().toISOString()}]);
    if(op==='actions.job.list')return page([{id:success?10:8,runId:input.runId,name:'Synthetic CI job',status:'completed',conclusion:success&&!ciFailure?'success':'failure',
      url:'https://github.com/xianxing-ai/PersonalAgent/actions/runs/'+input.runId+'/job/'+(success?10:8)}]);
    if(op==='actions.log.read')return {text:'Synthetic public CI test failure',offset:0,nextOffset:null,truncated:false};
    throw Error('Synthetic CI supports only read operations');}}});
  const preview=createWorkspacePatchPreviewTool({rootPath:root});
  const patchTool={descriptor:{...preview.descriptor,name:'workspace.apply_text_patch',sideEffect:'local_write',
    outputSchema:{type:'object'},requiredScopes:['workspace:read','workspace:write']},async execute(input,ctx){
      // Explicit synthetic Linux patch adapter, not native Windows acceptance.
      const value=await preview.execute(input,ctx);await writeFile(join(root,value.path),value.previewText);
      return {path:value.path,beforeSha256:value.beforeSha256,afterSha256:value.afterSha256,byteLength:value.byteLength,changed:true,applied:true};}};
  const reviewTool={descriptor:{name:'workflow.host.f16_n04',version:'1.0.0',inputSchema:{type:'object',properties:{},additionalProperties:false},
    outputSchema:{type:'object'},sideEffect:'read',requiredScopes:['workspace:read'],idempotencySupport:false,recoverySupport:false,requiresPresence:false},
    execute:async()=>({noCheatingDetected:true,patchDigest:hash(patch),reviewRef:'synthetic-review'})};
  const f16TestIntent=noReview?undefined:preservedAcceptance?'preserved-bytes':{tool:reviewTool,available:async()=>true,verifyReceipt:async({review})=>
    review.result.noCheatingDetected===true&&review.result.patchDigest===hash(patch)&&review.readback.task.state==='succeeded'};
  const image={bindingId:'synthetic-'+workflow+'-image',available:async()=>true,receiptSecret:async()=>'synthetic-secret-at-least-32-characters',
    async advance(request){requests.push(request);const index=request.checkpoint?Number(request.checkpoint.split(':')[1])+1:0;
      const sequence=(workflow==='F17'?['F17_N02','F17_N03','F17_N04']:['F16_N01','F16_N02','F16_N03','F16_N04','F16_N05'])
        .filter(node=>!skipDecision||!node.endsWith('_N02'));
      const nodeId=sequence[index],definition=F16_F17_CONFIGURATIONS[workflow],nodes=workflow==='F17'?{F17_N01:{state:'completed'}}:{};
      if(skipDecision)nodes[workflow+'_N02']={state:'completed'};
      sequence.forEach((id,i)=>nodes[id]={state:i<index?'completed':i===index?'waiting_receipt':'pending'});
      if(!nodeId)return {workflowId:workflow,workflowVersion:'1.0.0',checkpoint:'synthetic:'+index,state:'settled',nodes,proposals:[]};
      const toolName=definition.nodes[nodeId],descriptor=[decision,gitTool,patchTool,ports.commandTool,...ports.tools].find(v=>v.descriptor.name===toolName).descriptor;
      const args=toolName==='decision.choose_candidate'?{context:JSON.stringify({workflowId:workflow,nodeId,input:request.input,
        candidateValues:[{id:'locate',value:{legitimateFix:true},...(abstain?{abstain:true}:{})},{id:'defer',value:{legitimateFix:false},abstain:true}]}),
        candidates:[{id:'locate',description:'Locate the original failure'},{id:'defer',description:'Defer diagnosis'}],requestId:request.requestId}:
        ['F17_N03','F16_N05'].includes(nodeId)?{recipeId:request.input.recipeId}:nodeId==='F16_N03'?request.input.patch:{};
      if(substitute&&nodeId==='F17_N03')args.recipeId='substituted';
      const operationId='synthetic-'+nodeId;
      return {workflowId:workflow,workflowVersion:'1.0.0',checkpoint:'synthetic:'+index,state:'awaiting_host',nodes,
        proposals:[{kind:'tool_proposal',nodeId,operationId,proposalId:operationId,originControlRevision:request.controlRevision,
          inputDigest:hash(args),toolSchemaDigest:hash(descriptor.inputSchema),toolName,toolVersion:descriptor.version,
          arguments:args,resourceKeys:[],effect:descriptor.sideEffect==='read'?'read':'write'}]};}};
  if(realEngine){
    const secret=ownedComposition?'synthetic-shared-receipt-secret-123456789':'synthetic-secret-at-least-32-characters';
    const engine=new OwnedWorkflowEngine({checkpointSecret:secret,externalHost:true,
      decisionTool:{name:'decision.choose_candidate',version:'1.0.0'},receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),
      prepareCandidates:async context=>[{id:'execute',description:'Synthetic original fixed node candidate',
        value:context.node.kind==='tool'?{toolName:F16_F17_CONFIGURATIONS[workflow].nodes[context.node.id],toolVersion:'1.0.0',
          arguments:context.node.id==='F16_N03'?context.input.patch:{recipeId:context.input.recipeId}}:
          context.node.kind==='host'?{arguments:{}}:{legitimateFix:true}},
        {id:'defer',description:'Synthetic abstain',value:{},abstain:true}]});
    image.advance=async request=>{requests.push(request);return engine.advance(request);};
  }
  async function source(scope,id,toolName,args){
    const request={commandId:'initial-'+id,toolName,toolVersion:'1.0.0',arguments:args,deadline:scope.deadline};
    const prepared=app.prepareHostToolTask(request);
    app.runtime.saveCheckpointOnce(prepared.taskId,'coding-repair:parent',{taskId:scope.taskId,operationId:request.commandId});
    app.runtime.saveCheckpointOnce(scope.taskId,'coding-repair:host:'+request.commandId,{localTaskId:prepared.taskId,request});
    app.finalizeHostToolTask({taskId:prepared.taskId,commandId:request.commandId,arguments:args,expectedTaskRevision:prepared.revision});
    for(let i=0;i<2000;i++){
      const read=app.readHostToolTask(prepared.taskId);if(read.confirmed)return {taskId:prepared.taskId,runId:read.confirmed.runId,
        scopeRef:read.confirmed.runId,toolVersion:read.toolVersion,arguments:args};
      if(['failed','cancelled','waiting_reconciliation'].includes(read.task.state))throw new Error('Initial fixture source failed');await sleep();
    }throw Error('Initial fixture source did not finish');
  }
  const workspace={root,recipes:[recipe],commandTool,available:async()=>true,
    patchReconciliation:{bindingId:hash(root),reconcile:async()=>{throw new ProtocolError('RESULT_UNKNOWN','Synthetic fixture never claims native recovery');}},
    assertCurrent(){if(revoked)throw Error('Synthetic revoked workspace');},
    async readSelection(workflow,scope){
      if(workflow==='F16')return {selectionRef:'fixture',repository,headSha,recipeId:recipe.id,runId:7,jobId:8,patch};
      const key='synthetic:initial-selection',saved=app.runtime.loadCheckpoint(scope.taskId,key);if(saved)return saved;
      const beforeHead=await source(scope,'before','workspace.git.head',{repository});
      const command=await source(scope,'failure','workspace.run_allowed_command',{recipeId:recipe.id});
      const afterHead=await source(scope,'after','workspace.git.head',{repository});
      const selected={selectionRef:'fixture',repository,headSha,recipeId:recipe.id,sourceSessionId:'initial-fixture',initialFailure:{command,beforeHead,afterHead}};
      app.runtime.saveCheckpointOnce(scope.taskId,key,selected);return selected;
    }};
  const authority={available:async()=>true,assertCurrent(){if(revoked)throw Error('Synthetic revoked authority');},
    async authorizeExport(value){exports.push(value);if(exportMutation)await exportMutation({value,app,git,root});return deny!==value.stage;}};
  const exportConsent=productionSources?createWorkflowExportConsent({getApplication:()=>app,
    readDeploymentBinding:()=>revoked?undefined:'synthetic-fixed-deployment',confirmAuthorization:async(action,value,request)=>{
      assert.equal(action,'workflow.export');assert.equal(request.isCurrent(),true);
      return authority.authorizeExport({...request.scope,value,deadline:request.deadline,signal:request.signal});
    }}):authority.authorizeExport;
  let codingWorkspace,developerHost,caseConfiguration,developerDeployment;
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()}; // Explicit test-only secure storage.
  if(productionSources){
    await writeFile(join(directory,'coding-workspace.json'),JSON.stringify({version:1,encrypted:Buffer.from(root).toString('base64'),
      encryptedNode:Buffer.from(process.execPath).toString('base64'),encryptedCheckFile:Buffer.from('failure.test.mjs').toString('base64')}));
  }
  function open(){
    if(productionSources){
      codingWorkspace=createWorkspaceConfigHost({userData:directory,safeStorage,findExecutable:()=>undefined,
        createCommandRecipeTool:options=>createWorkspaceCommandRecipeTool({...options,createWorkspaceCommandTool})});
      const config=codingWorkspace.readDeveloperConfiguration();assert.ok(config?.command,'actual workspace command configured');
      const counted={...config.command.tool,execute:async(...args)=>{counters.command++;return config.command.tool.execute(...args);}};
      developerHost=createDesktopDeveloperToolsHost({command:{...config.command,tool:counted},git:{
        options:{repository,rootPath:root,sourceBranch:'fixture',remoteName:'origin',remoteUrl:'https://github.com/'+repository+'.git',
          allowedPaths:['failure.test.mjs'],authorName:'Synthetic',authorEmail:'fixture@example.invalid'},available:config.available}});
      // Explicit synthetic deployment envelope; real workspace/command/Git adapters underneath.
      developerDeployment={host:developerHost,snapshot:()=>({configured:!revoked,state:revoked?'closed':'configured',repository})};
      caseConfiguration=createF16F17CaseConfiguration({userData:directory,safeStorage,readWorkspace:()=>codingWorkspace.readDeveloperConfiguration()});
      if(!caseConfiguration.snapshot('F17').configured)caseConfiguration.setFromNativeSelection('F17',{selectionRef:'fixture',repository,recipeId:recipe.id});
      ports=createDesktopF16F17WorkflowPorts({runtimeModule,getApplication:()=>app,codingWorkspace,developerDeployment,caseConfiguration,
        authorizeExport:exportConsent});
    }else ports=createF16F17WorkflowPorts({runtimeModule,getApplication:()=>app,workspace,authority,authorizeExport:authority.authorizeExport,f16TestIntent,
      ...(preservedAcceptance?{f16CiIdentityRecipe:'github-readback'}:{})});
    const tools=[decision,productionSources?developerHost.tools.find(tool=>tool.descriptor.name==='workspace.git.head'):gitTool,
      patchTool,...github,ports.commandTool,...ports.tools,publicRuntime.createDesktopSubagentDispatchTool({competitionOnly:true,
      getRuntime:()=>app.runtime,getTools:()=>app.tools,runDefaultWorker:(task,worker,scoped)=>app.runDefaultSubagentWorker(task,worker,scoped)})];
    const options={path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',delegateUserTasks:true,competitionMaxSteps:8,
      hostUserNamespace:'synthetic-f16-f17-configured',coordinationBinding:'synthetic-deployment',tools,
      configuredWorkflowWorkers:ports.configuredWorkflowWorkerPorts.map(port=>({...port,image})),
      workspacePatchReconciliation:ports.workspacePatchReconciliation,
      coordination:{execute:async request=>{
        if(productionSources&&app.runtime.getTask(request.taskId).conversationId!=='fixture-chat'){
          const completed=app.runtime.loadCheckpoint(request.taskId,'competition-loop')?.receipts?.length??0;
          if(completed<3){
            const command=completed===1;
            return {kind:'tool_proposal',proposalId:'original-'+completed,toolName:command?'workspace.run_allowed_command':'workspace.git.head',
              toolVersion:'1.0.0',arguments:command?{recipeId:recipe.id}:{repository},verification:'unverified'};
          }
          if(completed===3)return {kind:'tool_proposal',proposalId:'fixture-graph',toolName:F16_F17_CONFIGURATIONS[workflow].toolName,
            toolVersion:'1.0.0',arguments:{selectionRef:'fixture'},verification:'unverified'};
        }
        if(app.runtime.getTask(request.taskId).conversationId==='fixture-chat'||request.continuation)
          return {kind:'text',text:'Synthetic configured continuation',verification:'unverified'};
        return {kind:'tool_proposal',proposalId:'fixture-graph',toolName:F16_F17_CONFIGURATIONS[workflow].toolName,toolVersion:'1.0.0',
          arguments:{selectionRef:'fixture'},verification:'unverified'};}},
      competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,available:()=>true,
        publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
      competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,exportPolicyVersion:'synthetic-v1',
        accepts:()=>true,project:({result})=>result}))};
    if(ownedComposition){
      const {configuredWorkflowWorkers:_workers,coordination,profile:_profile,...shared}=options;let originalRequest;
      app=publicRuntime.createAgentArtsRuntimeApplication({...shared,configuredWorkflowWorkerPorts:ports.configuredWorkflowWorkerPorts,
        gatewayUrl:'https://synthetic.agentarts.invalid',runtimeName:'f17-runtime',deploymentVersion:'fixed-f17-fixture',
        initialRequestMode:'goal-with-tools-json',responseMode:'tool-proposal-json',
        authorizationProvider:{read:async()=> 'Bearer synthetic-invoke-credential'},
        readOwnedWorkflowReceiptSecret:async()=> 'synthetic-shared-receipt-secret-123456789',
        beforeCompetitionSend:request=>{originalRequest=request;},
        fetchImpl:async(url,init)=>{
          const body=JSON.parse(init.body),request=typeof body.query==='string'&&body.query.startsWith('{')?JSON.parse(body.query):{};
          assert.equal(url,'https://synthetic.agentarts.invalid/runtimes/f17-runtime/invocations'
            +(request.operation==='advance'?'?endpoint=fixed-f17-fixture':''));
          const value=request.operation==='advance'?await image.advance({...request,requestId:init.headers['X-Request-Id'],
            sessionId:init.headers['x-hw-agentarts-session-id'],deadline:init.headers['X-PA-Deadline'],signal:init.signal}):await coordination.execute(originalRequest);
          const {verification:_verification,...response}=value;
          return new Response(JSON.stringify([{event:'message',data:{text:JSON.stringify(response),index:0}},
            {event:'task_end'},{event:'end'}]),{headers:{'content-type':'application/json'}});
        }});
    }else app=publicRuntime.createRuntimeApplication(options);
    if(productionSources){codingWorkspace.bindApplication(app);developerHost.bind(app);}
    client=new Client(app);
  }
  open();if(productionSources)await codingWorkspace.authorize({cloudExportAllowed:true,commandAllowed:true,writeAllowed:false});await client.connect();
  t.after(async()=>{for(let i=0;i<500&&app.activeTaskCount;i++)await sleep();app.close();developerHost?.close();codingWorkspace?.close();await rm(directory,{recursive:true,force:true});});
  return {get app(){return app;},get ports(){return ports;},get cases(){return caseConfiguration;},get workspace(){return codingWorkspace;},counters,exports,requests,actions,git,headSha,
    async run(){
      const submitted=await client.call('task.submit',{goal:'Locate the synthetic failing test',conversationId:'fixture-chat'},
        {idempotencyKey:'fixture-workflow',timeoutMs:120000});let child;
      for(let i=0;i<3000;i++){
        for(const task of app.runtime.listTasks({limit:100}).items)for(const approval of app.runtime.listApprovals({taskId:task.taskId,state:'pending'}).items){
          const name=app.runtime.loadCheckpoint(task.taskId,'host-tool-intent')?.toolName;
          const denied=denyNestedHead&&app.runtime.loadCheckpoint(task.taskId,'workflow-business-tool:source')&&name==='workspace.git.head'
            ||denyReview&&name==='workflow.host.f16_n04';
          await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:denied?'deny':'allow_once'});
        }
        [child]=app.readSubagentTasks(submitted.taskId);
        if(denyReview&&child&&app.activeTaskCount===0&&app.runtime.listTasks({limit:100}).items.some(task=>
          task.state==='cancelled'&&app.runtime.loadCheckpoint(task.taskId,'host-tool-intent')?.toolName==='workflow.host.f16_n04'))return child;
        if(child&&app.activeTaskCount===0&&['succeeded','failed','cancelled','waiting_reconciliation'].includes(child.state))return child;
        await sleep();
      }throw Error('Configured fixture did not settle: '+JSON.stringify(child));
    },async reopen(){assert.equal(app.activeTaskCount,0);app.close();developerHost?.close();codingWorkspace?.close();open();
      if(productionSources)await codingWorkspace.authorize({cloudExportAllowed:true,commandAllowed:true,writeAllowed:false});await client.connect();},revoke:()=>{revoked=true;}};
}

test('F16/F17 ports stay absent without real services and F16 requires an independent test intent verifier',()=>{
  assert.equal(createF16F17WorkflowPorts().configuredWorkflowWorkerPorts.length,0);
  assert.deepEqual(createF16F17WorkflowPorts({f16CiIdentityRecipe:'replacement'}).unavailable,['f16_ci_identity_configuration_unavailable']);
  assert.ok(Object.isFrozen(F16_F17_CONFIGURATIONS.F17.inputSchema.properties));
});

test('F17 Desktop configuration drives actual worker, two-layer Policy children and ordered real reproduction',async t=>{
  const f=await fixture(t),task=await f.run();assert.equal(task.state,'succeeded',JSON.stringify(task.error));
  assert.equal(f.counters.command,2,'one original failure plus one actual reproduction');assert.equal(f.requests.length,4);
  const tasks=f.app.runtime.listTasks({limit:100}).items,reportTask=tasks.find(v=>f.app.runtime.loadCheckpoint(v.taskId,'f17:failure-report:synthetic-F17_N04'));
  assert.ok(reportTask);const report=f.app.runtime.loadCheckpoint(reportTask.taskId,'f17:failure-report:synthetic-F17_N04');
  assert.equal(report.document.reproduction.headSha,f.headSha);assert.equal(report.report.all6PassResolved,false);assert.ok(report.report.locatedFrameCount);
  const commandTask=report.document.reproduction.command.taskId,observation=f.app.runtime.loadCheckpoint(commandTask,'f17:command-observation');
  assert.ok(observation);assert.equal(observation.beforeHead.provenance.kind,'business');
  assert.equal(observation.beforeHead.provenance.proof.sourceHost.taskId,commandTask);
  assert.ok(f.exports.some(v=>v.stage==='completion'));await f.reopen();assert.equal(f.app.runtime.getTask(task.taskId).state,'succeeded');
  assert.equal(f.counters.command,2);
});

test('F17 production adapters consume native case, existing workspace commands and same-task original receipts',async t=>{
  const f=await fixture(t,{productionSources:true}),task=await f.run();
  assert.equal(task.state,'succeeded',JSON.stringify(task.error));assert.equal(f.counters.command,2);
  assert.deepEqual(f.ports.configuredWorkflowWorkerPorts.map(port=>port.workflowId),['F17']);
  assert.equal(Object.hasOwn(f.ports.configuredWorkflowWorkerPorts[0],'image'),false);
  assert.ok(f.ports.unavailable.includes('f16_ci_publication_tool_chain_unavailable'));
  const selected=f.app.runtime.loadCheckpoint(task.taskId,'f16-f17:configured-selection:F17');
  assert.equal(selected.selected.initialFailure.kind,'competition');
  assert.equal(selected.input.initialFailure.exitCode,1);assert.match(selected.input.initialFailure.stderr,/SyntaxError/);
  assert.equal(selected.input.headSha,f.headSha);assert.match(selected.selected.configurationRef,/^[a-f0-9]{64}$/);
  const reportTask=f.app.runtime.listTasks({limit:100}).items.find(value=>f.app.runtime.loadCheckpoint(value.taskId,'f17:failure-report:synthetic-F17_N04'));
  assert.ok(reportTask);assert.ok(f.exports.some(value=>value.stage==='completion'));
  await f.reopen();assert.equal(f.app.runtime.getTask(task.taskId).state,'succeeded');assert.equal(f.counters.command,2);
});

test('F17 actual owned Engine selects every executable node through the shared configured question proof',async t=>{
  const f=await fixture(t,{productionSources:true,ownedComposition:true,realEngine:true}),task=await f.run();
  assert.equal(task.state,'succeeded',JSON.stringify(task.error));assert.equal(f.counters.command,2);
  const decisions=f.app.runtime.listTasks({limit:100}).items.filter(task=>f.app.runtime.loadCheckpoint(task.taskId,'host-tool-intent')?.toolName==='decision.choose_candidate');
  assert.equal(decisions.length,3,'N02, N03 and N04 use original Policy children');
  assert.ok(f.exports.some(value=>value.stage==='completion'));await f.reopen();assert.equal(f.counters.command,2);
});

test('F16 actual Engine consumes production byte verifier and original GitHub run/job identity without parsing local stdout',async t=>{
  // Local commit is an explicit synthetic publication boundary, not a remote push or CI trigger.
  const f=await fixture(t,{workflow:'F16',preservedAcceptance:true,realEngine:true}),task=await f.run();
  assert.equal(f.ports.configuredWorkflowWorkerPorts.find(port=>port.workflowId==='F16').configurationVersion,'f16-desktop-v3-bytes');
  assert.equal(task.state,'succeeded',JSON.stringify(task.error));assert.equal(f.counters.command,1);
  const tasks=f.app.runtime.listTasks({limit:100}).items;
  const review=tasks.find(task=>f.app.runtime.loadCheckpoint(task.taskId,'f16:test-intent-review'));
  assert.equal(f.app.runtime.loadCheckpoint(review.taskId,'f16:test-intent-review').policy,'unchanged-acceptance-bytes-v1');
  const command=tasks.find(task=>f.app.runtime.loadCheckpoint(task.taskId,'f16:ci-readback-identity'));
  const original=f.app.readHostToolTask(command.taskId).confirmed;
  assert.match(original.result.stdout,/Local check only/);assert.equal(original.result.exitCode,0);
  assert.equal(f.app.runtime.loadCheckpoint(command.taskId,'f16:ci-readback-run').run.runId,9);
  await f.reopen();assert.equal(f.counters.command,1);assert.equal(f.app.runtime.getTask(task.taskId).state,'succeeded');
});

test('F16 passing local command without a published repaired commit cannot become GitHub success',async t=>{
  const f=await fixture(t,{workflow:'F16',preservedAcceptance:true,realEngine:true,noPublication:true}),task=await f.run();
  assert.equal(task.state,'failed');assert.match(task.error.message,/f16_ci_publication_required/);
  assert.equal(f.exports.filter(value=>value.stage==='completion').length,0);assert.equal(f.counters.command,1);
});

test('F16 original acceptance bytes are rechecked after export consent is awaited',async t=>{
  const f=await fixture(t,{workflow:'F16',preservedAcceptance:true,realEngine:true,
    exportMutation:async({value,root})=>{if(value.stage==='receipt'&&value.value.result?.policy==='unchanged-acceptance-bytes-v1')
      await writeFile(join(root,'failure.test.mjs'),'// removed original tests\n');}}),task=await f.run();
  assert.equal(task.state,'failed');assert.equal(f.counters.command,0);assert.match(task.error.message,/acceptance bytes/);
});

test('F16 production acceptance reviewer still requires its original Policy approval',async t=>{
  const f=await fixture(t,{workflow:'F16',preservedAcceptance:true,realEngine:true,denyReview:true}),task=await f.run();
  assert.equal(task.state,'waiting_approval');assert.equal(f.counters.command,0);
  const review=f.app.runtime.listTasks({limit:100}).items.find(task=>f.app.runtime.loadCheckpoint(task.taskId,'host-tool-intent')?.toolName==='workflow.host.f16_n04');
  assert.ok(review);assert.equal(review.state,'cancelled');assert.equal(f.app.runtime.loadCheckpoint(review.taskId,'f16:test-intent-review'),undefined);
  assert.ok(f.app.runtime.readToolExecutions(review.taskId).every(record=>record.executionStarted!==true));
});

test('F17 image-free ports execute through the original AgentArts composition owned image and fixed deployment',async t=>{
  const f=await fixture(t,{productionSources:true,ownedComposition:true}),task=await f.run();
  assert.equal(task.state,'succeeded',JSON.stringify(task.error));assert.equal(f.counters.command,2);
  assert.equal(f.requests.length,4);assert.ok(f.exports.some(value=>value.stage==='completion'));
});

test('F17 production case configuration rejects injected output and invalidates changed workspace selection',async t=>{
  const f=await fixture(t,{productionSources:true});
  assert.throws(()=>f.cases.setFromNativeSelection('F17',{selectionRef:'fixture',repository:'xianxing-ai/PersonalAgent',
    recipeId:'node-check',initialFailure:{stdout:'invented'}}));
  f.workspace.revoke();
  const task=await f.run();assert.notEqual(task.state,'succeeded');assert.equal(f.counters.command,0);
  assert.equal(f.exports.length,0);
});

test('F17 same-task initial source substitution is rejected after initial export awaits',async t=>{
  const f=await fixture(t,{productionSources:true,exportMutation:async({value,app})=>{
    if(value.stage!=='initial')return;
    const selected=app.runtime.loadCheckpoint(value.taskId,'f16-f17:configured-selection:F17').selected;
    const key='tool-result-'+selected.initialFailure.commandRunId,saved=app.runtime.loadCheckpoint(value.taskId,key);
    app.runtime.saveCheckpoint(value.taskId,key,{...saved,result:{...saved.result,stderr:'substituted'}});
  }});
  const task=await f.run();assert.equal(task.state,'failed');assert.equal(task.error.code,'REVISION_CONFLICT');assert.equal(f.counters.command,1);
});

test('F17 source reader rejects foreign, unknown, expired and reordered original receipts',async t=>{
  const checks=[];
  const f=await fixture(t,{productionSources:true,exportMutation:async({value,app})=>{
    if(value.stage!=='initial')return;
    const selected=app.runtime.loadCheckpoint(value.taskId,'f16-f17:configured-selection:F17').selected;
    const scope={taskId:value.taskId,deadline:value.deadline,signal:value.signal};
    const proof=readF17InitialFailure(app,scope,selected);checks.push(proof.command.runId);
    assert.throws(()=>readF17InitialFailure(app,{...scope,deadline:new Date(0).toISOString()},selected));
    assert.throws(()=>readF17InitialFailure(app,scope,{...selected,initialFailure:{...selected.initialFailure,commandRunId:'competition-tool-foreign-2'}}));
    const loop=app.runtime.loadCheckpoint(value.taskId,'competition-loop');
    const altered=structuredClone(loop);[altered.receipts[0],altered.receipts[2]]=[altered.receipts[2],altered.receipts[0]];
    app.runtime.saveCheckpoint(value.taskId,'competition-loop',altered);
    assert.throws(()=>readF17InitialFailure(app,scope,selected));
    app.runtime.saveCheckpoint(value.taskId,'competition-loop',loop);
    const noAfter={...loop,receipts:loop.receipts.slice(0,2)};
    app.runtime.saveCheckpoint(value.taskId,'competition-loop',noAfter);
    assert.equal(findF17InitialFailure(app,scope,selected),undefined);
    app.runtime.saveCheckpoint(value.taskId,'competition-loop',loop);
  }});
  const task=await f.run();assert.equal(task.state,'succeeded',JSON.stringify(task.error));assert.ok(checks.length>0);assert.equal(new Set(checks).size,1);
});

test('F17 unavailable permission and substituted recipe cannot run the graph command',async t=>{
  for(const options of [{deny:'initial'},{substitute:true}]){
    const f=await fixture(t,options),task=await f.run();assert.equal(task.state,'failed',JSON.stringify(task.error));assert.equal(f.counters.command,1);
  }
});

test('F16/F17 require original local dependency receipts even when the image marks a skipped decision completed',async t=>{
  for(const workflow of ['F16','F17']){
    const f=await fixture(t,{workflow,skipDecision:true}),task=await f.run();
    assert.equal(task.state,'failed');assert.equal(task.error.code,'UNAUTHORIZED');assert.equal(f.counters.command,workflow==='F17'?1:0);
  }
});

test('F16/F17 cannot execute past an original abstaining decision even if the image proposes a command',async t=>{
  for(const workflow of ['F16','F17']){
    const f=await fixture(t,{workflow,abstain:true}),task=await f.run();
    assert.equal(task.state,'failed');assert.equal(task.error.code,'UNAUTHORIZED');assert.equal(f.counters.command,workflow==='F17'?1:0);
  }
});

test('F17 unknown nested HEAD preserves the original command across SQLite reopen without replay',async t=>{
  const f=await fixture(t,{unknownHead:true}),task=await f.run();assert.equal(task.state,'waiting_reconciliation',JSON.stringify(task.error));
  assert.equal(f.counters.command,1);const original=f.app.readPendingOwnedWorkflowHostTask(task.taskId);assert.ok(original);
  await f.reopen();assert.throws(()=>f.app.resumeTask(task.taskId),{code:'RESULT_UNKNOWN'});
  assert.equal(f.app.readPendingOwnedWorkflowHostTask(task.taskId).taskId,original.taskId);assert.equal(f.counters.command,1);
});

test('F17 completion permission await rechecks the real workspace HEAD',async t=>{
  const f=await fixture(t,{exportMutation:async({value,git})=>{if(value.stage==='completion')git('commit','--allow-empty','-qm','Changed during export');}});
  const task=await f.run();assert.equal(task.state,'failed');assert.equal(task.error.code,'REVISION_CONFLICT');assert.equal(f.counters.command,2);
});

test('F17 rejects uncommitted source changes after completion consent and does not replay a denied nested read',async t=>{
  const changed=await fixture(t,{exportMutation:async({value,root})=>{
    if(value.stage==='completion')await writeFile(join(root,'failure.test.mjs'),'// changed after the report\n');}});
  const result=await changed.run();assert.equal(result.state,'failed');assert.equal(result.error.code,'REVISION_CONFLICT');
  const denied=await fixture(t,{denyNestedHead:true}),task=await denied.run();
  assert.notEqual(task.state,'succeeded');assert.equal(denied.counters.command,1);assert.equal(denied.exports.some(v=>v.stage==='completion'),false);
});

test('F17 cancellation bounds an uncooperative completion permission callback',async t=>{
  const f=await fixture(t,{exportMutation:async({value,app})=>{
    if(value.stage==='completion'){app.runtime.requestCancel(value.taskId);await new Promise(()=>{});}}});
  const task=await f.run();assert.equal(task.state,'cancelled');assert.equal(f.counters.command,2);
});

test('F16 Desktop configuration verifies original CI children, patch review and a fresh repaired-commit CI readback',async t=>{
  const f=await fixture(t,{workflow:'F16'}),task=await f.run();assert.equal(task.state,'succeeded',JSON.stringify(task.error));
  assert.equal(f.counters.command,1);assert.equal(f.requests.length,6);
  const completion=f.exports.find(value=>value.stage==='completion');assert.ok(completion);
  assert.equal(completion.value.ciStatus,'passed');assert.equal(completion.value.runId,9);assert.notEqual(completion.value.headSha,f.headSha);
  const sourceTasks=f.app.runtime.listTasks({limit:100}).items.filter(task=>f.app.runtime.loadCheckpoint(task.taskId,'workflow-business-tool:source'));
  assert.ok(sourceTasks.length>=8);await f.reopen();assert.equal(f.app.runtime.getTask(task.taskId).state,'succeeded');assert.equal(f.counters.command,1);
});

test('F16 missing real review service stays unavailable and failed repaired CI cannot complete',async t=>{
  const missing=await fixture(t,{workflow:'F16',noReview:true});
  assert.ok(missing.ports.unavailable.includes('f16_test_intent_verifier_unavailable'));
  assert.equal(missing.ports.configuredWorkflowWorkerPorts.some(port=>port.workflowId==='F16'),false);
  const failed=await fixture(t,{workflow:'F16',ciFailure:true}),task=await failed.run();
  assert.equal(task.state,'failed');assert.equal(task.error.code,'UNAUTHORIZED');assert.equal(failed.counters.command,1);
  assert.equal(failed.exports.some(value=>value.stage==='completion'),false);
});

test('F16 rejects a replaced nested source marker after the original export permission await',async t=>{
  const f=await fixture(t,{workflow:'F16',exportMutation:async({value,app})=>{
    if(value.stage==='receipt'&&value.value?.commitSha){
      const task=app.runtime.listTasks({limit:100}).items.find(item=>app.runtime.loadCheckpoint(item.taskId,'host-tool-intent')?.toolName==='github.actions.log.read');
      const marker=app.runtime.loadCheckpoint(task.taskId,'workflow-business-tool:source');
      app.runtime.saveCheckpoint(task.taskId,'workflow-business-tool:source',{...marker,sourceTaskId:'foreign-source-host'});
    }}});
  const task=await f.run();assert.equal(task.state,'failed');assert.equal(task.error.code,'UNAUTHORIZED');assert.equal(f.counters.command,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {writeFileSync,mkdirSync,readFileSync,realpathSync,renameSync} from 'node:fs';
import {createGitHubF18F19Tools,GhCliProvider,register as registerGitHub} from '@personal-agent/github';
import {createWorkspaceCommandTool} from '@personal-agent/coding-tools';
import * as coding from '@personal-agent/coding-tools';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier} from '@personal-agent/agentarts';
import {ProtocolError} from '@personal-agent/contracts';
import * as r from '@personal-agent/runtime/application';
import {createDesktopF19IssueRepairPorts} from '../electron/f19-issue-repair-ports.js';
import {createDesktopDeveloperToolsHost} from '../electron/developer-tools-host.js';
import {createDesktopNativeExecutionHost} from '../electron/native-execution-host.js';
import {createF19IssueConfiguration,createConfiguredDesktopF19IssueRepairPorts} from '../electron/f19-issue-config-host.js';
import {runCodingRepairFullGraphFixture} from '../../../tests/manual/agentarts/coding-repair-full-graph.mjs';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const issue={repo:'synthetic/f19',issueId:19,updatedAt:'2026-11-01T00:00:00Z',title:'Public fixture returns 1 instead of 3',body:'Repair feature.cjs; preserve unrelated user edits.'};
const selection={repo:issue.repo,issueId:issue.issueId,expectedUpdatedAt:issue.updatedAt,allowedPaths:['feature.cjs']};
const secret='synthetic-f19-receipt-secret-at-least-32-characters';

// Actual F19 Engine -> configured worker -> graph/Policy/business child ->
// original F15 dispatcher -> actual F15 Engine/isolated filesystem/CAS. Model,
// GitHub transport, consent and ephemeral independent signature are explicit
// fixture boundaries. This is not a real human signature or GitHub acceptance.
async function fixture({replaceDigest=false,denyDispatch=false,cancelDispatch=false,revokeDuringExport=false,
  publish=false,testContext,denyPublication,unknownPr=false,replacePublishedBytes=false,revokePresence=false,foreignRemote=false,
  regression=false,unmerged=false,wrongCheckout=false,changedChecker=false,regressionFails=false,unknownRegression=false,
  denyRegression=false,cancelRegression=false,fullClose=false,denyClose=false,unknownClose=false,changedCloseIssue=false,postCloseChanged=false,
  configuredAdapter=false,invalidateConfiguration}={}) {
  let app,ports,developerHost,revoked=false,closedEvidence,dispatchApprovals=0,nativeSelection=selection,remoteHead,pushes=0,presence=0;
  const requests=[],exports=[],nodes=[],failures=[];
  let native,regressionOptions,prepareMergedCheckout,nativeExecutions=0,regressionApprovals=0,mergeReady=false,issueClosed=false,closeApprovals=0,issueConfiguration,configurationChanged=false;
  if(publish){
    const originalSpawn=childProcess.spawn;
    testContext.mock.method(childProcess,'spawn',(file,args,options)=>{
      if(file!=='git'||!args.some(value=>['ls-remote','push'].includes(value))){
        const child=originalSpawn(file,args,options);
        if(file==='git'){let stderr='';child.stderr?.on('data',value=>{stderr+=value;});child.on('close',code=>{
          if(code!==0)failures.push({tool:'git',args,stderr});});}return child;
      }
      assert.ok(args.includes('https://github.com/synthetic/f19.git'));
      const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>true;
      queueMicrotask(()=>{if(args.includes('push')){pushes++;remoteHead=args.at(-1).split(':')[0];}
        else if(remoteHead)child.stdout.write(remoteHead+'\trefs/heads/codex/f19-fixture\n');child.emit('close',0);});return child;
    });syncBuiltinESMExports();testContext.after(()=>{testContext.mock.restoreAll();syncBuiltinESMExports();});
  }
  const current=()=>{if(revoked)throw new ProtocolError('UNAUTHORIZED','Synthetic original selection revoked');};
  const engine=new OwnedWorkflowEngine({checkpointSecret:secret,externalHost:true,
    decisionTool:{name:'decision.choose_candidate',version:'1.0.0'},receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),
    prepareCandidates:async context=>{nodes.push(context.node.id);return [{id:'candidate',description:'Explicit synthetic issue triage',
      value:context.node.kind==='host'?{arguments:{}}:{snapshotDigest:replaceDigest?'f'.repeat(64):digest(issue),
        canonicalIssueId:19,isDuplicate:false,triageCategory:'bug'}},
      {id:'review',description:'Defer unsupported issue',value:null,abstain:true}];}});
  const image={bindingId:'synthetic-f19-engine',advance:request=>engine.advance(request),receiptSecret:async()=>secret};
  const report=await runCodingRepairFullGraphFixture({fakeModel:true,targetPath:'feature.cjs',firstAttemptSuccess:configuredAdapter&&!invalidateConfiguration,
    artifactRoot:'.cache/f19-original-repair',createApplication(config){
      const runner={async run(request){
        const endpoint=request.args[5];requests.push({endpoint,method:request.args[4]});let result;
        if(endpoint==='repos/synthetic/f19/issues/19'){
          if(request.args[4]==='PATCH'){
            assert.equal(fullClose,true);assert.equal(closeApprovals,1);
            assert.deepEqual(JSON.parse(request.stdin),{state:'closed',state_reason:'completed'});issueClosed=true;
            if(unknownClose)throw Error('Synthetic original close sent, response lost');
          }else assert.equal(request.args[4],'GET');
          result={number:19,updated_at:issueClosed?'2026-11-01T01:00:00Z':mergeReady&&changedCloseIssue?'2026-11-01T00:01:00Z':issue.updatedAt,
            title:issue.title,body:issue.body,state:issueClosed?'closed':'open',state_reason:issueClosed?'completed':null,
            html_url:'https://github.com/synthetic/f19/issues/19'};
          if(issueClosed&&request.args[4]==='GET'&&postCloseChanged)result.updated_at='2026-11-01T02:00:00Z';
        }else if(endpoint==='repos/synthetic/f19/git/ref/heads/codex/f19-fixture'){
          assert.equal(request.args[4],'GET');result={object:{sha:remoteHead}};
        }else if(endpoint==='repos/synthetic/f19/pulls'){
          assert.equal(request.args[4],'POST');const input=JSON.parse(request.stdin);assert.equal(input.draft,true);
          assert.doesNotMatch(input.body,/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#/i);
          if(unknownPr)throw Error('Synthetic original PR created but response lost');
          result={number:93,html_url:'https://github.com/synthetic/f19/pull/93',head:{sha:remoteHead}};
        }else if(endpoint==='repos/synthetic/f19/pulls/93'){
          assert.equal(request.args[4],'GET');assert.equal(regressionApprovals,1);
          result={number:93,state:mergeReady?'closed':'open',merged:mergeReady,
            merge_commit_sha:remoteHead,base:{repo:{full_name:issue.repo},sha:nativeSelection.headSha},head:{repo:{full_name:issue.repo},sha:remoteHead}};
        }else assert.fail('Unexpected synthetic endpoint '+endpoint);
        return {exitCode:0,stderr:'',stdout:JSON.stringify(result)};
      }};
      if(publish){
        const root=join(dirname(config.path),'user'),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
        git('init','-b','codex/f19-fixture');git('config','user.name','Synthetic');git('config','user.email','fixture@example.invalid');
        git('add','.');git('commit','-qm','Original public issue fixture');git('remote','add','origin','https://github.com/synthetic/f19.git');
        nativeSelection={...selection,headSha:git('rev-parse','HEAD'),verificationRecipeId:'publication-check',publication:{branch:'codex/f19-fixture',base:'main'}};
        developerHost=createDesktopDeveloperToolsHost({githubModule:{register:registerGitHub},
          github:{provider:new GhCliProvider({runner,readToken:async()=> 'synthetic-only-token',repositories:[issue.repo]}),available:async()=>true},
          git:{options:{repository:issue.repo,rootPath:root,sourceBranch:'codex/f19-fixture',remoteName:'origin',remoteUrl:'https://github.com/synthetic/f19.git',
            allowedPaths:['feature.cjs'],authorName:'Synthetic',authorEmail:'fixture@example.invalid',getCredentials:async()=>({token:'synthetic-only-token'})},available:async()=>true},
          command:{tool:createWorkspaceCommandTool({rootPath:root,recipes:[{id:'publication-check',executable:process.execPath,args:['--test','checks/actual-check.cjs']}]}),rootPath:root,available:async()=>true}});
        if(regression){
          const checkout=join(dirname(config.path),'independent-checkout'),checkers=join(dirname(config.path),'independent-checkers');mkdirSync(checkers);
          execFileSync('git',['-c','core.autocrlf=false','clone','--no-hardlinks',root,checkout],{stdio:['ignore','pipe','pipe']});
          const regressionGit=(...args)=>{try{return execFileSync('git',args,{cwd:checkout,stdio:['ignore','pipe','pipe']});}
            catch(error){failures.push({tool:'fixture regression Git',args,stderr:String(error.stderr)});throw error;}};
          regressionGit('config','core.autocrlf','false');
          regressionGit('checkout','-b','f19-regression');regressionGit('remote','set-url','origin','https://github.com/synthetic/f19.git');
          const checker=join(checkers,'original-bug.cjs');writeFileSync(checker,"const assert=require('node:assert/strict'); assert.equal(require(process.argv[2]+'/feature.cjs')(),"+(regressionFails?'999':'3')+");\n");
          // Explicit fixture transport: executes the fixed Node checker for real,
          // but reports synthetic native isolation facts. This is NOT real PSEC.
          native=createDesktopNativeExecutionHost({coding:{...coding,
            readWindowsNativeHelperAttestation:helperPath=>({helperPath,helperSha256:'f'.repeat(64)}),
            verifyWindowsNativeSandbox:async()=>({available:true,enforced:true,helperSha256:'f'.repeat(64)}),
            createWindowsNativeSandboxExecutor:({assertCurrent})=>({async execute(request){
              assertCurrent(request);nativeExecutions++;
              if(unknownRegression)return {backend:'windows-psec',enforced:true,outcome:'unknown',exitCode:null,executionStarted:true,stopped:false,sideEffects:'unknown',stdout:'',stderr:''};
              let exitCode=0;try{execFileSync(request.executable,request.argv,{cwd:request.cwd,env:request.env,stdio:['ignore','pipe','pipe']});}catch(error){exitCode=error.status??1;}
              return {backend:'windows-psec',enforced:true,outcome:'exited',exitCode,executionStarted:true,stopped:true,sideEffects:'none',stdout:'',stderr:''};
            }})},question:{prepare(_scope,value){assert.equal(value.assertCurrent(),true);},currentRequirement:()=>({}),
              readExecutionPolicy:()=>({ref:'synthetic-regression-sandbox',revision:1,mode:'read-only'})},
            getApplication:()=>app,readConfiguration:()=>({rootPath:root,nodeExecutable:process.execPath,bindingId:'synthetic-f19-native'}),
            ensureHelper:async()=>process.execPath,probeRootPath:dirname(config.path),systemRoot:process.env.SystemRoot,localAppData:dirname(config.path)});
          regressionOptions={configurationRef:'c'.repeat(64),assertCurrent:current,native,rootPath:realpathSync.native(checkout),
            nodeExecutable:process.execPath,sourceBranch:'f19-regression',checkerPath:checker,
            checkerSha256:createHash('sha256').update(readFileSync(checker)).digest('hex')};
          prepareMergedCheckout=()=>{
            if(!wrongCheckout){regressionGit('fetch',root,remoteHead);regressionGit('checkout','-B','f19-regression','FETCH_HEAD');}
            if(changedChecker)writeFileSync(checker,'process.exit(0);\n');
            mergeReady=!unmerged;
          };
        }
      }
      const factoryOptions={getApplication:()=>app,selection:{configurationRef:'a'.repeat(64),assertCurrent:current,readSelection:async()=>nativeSelection},
        ...(publish?{publication:{configurationRef:'b'.repeat(64),assertCurrent:current,
          readConfiguration:()=>({...developerHost.readF16PublicationConfiguration(),...(foreignRemote?{remoteUrl:'https://github.com/synthetic/foreign.git'}:{})}),
          requestPresence:async scope=>{
            presence++;if(revokePresence)revoked=true;
            if(!configurationChanged&&invalidateConfiguration==='publication-checker'&&scope.toolName==='workspace.git.commit'){
              configurationChanged=true;writeFileSync(regressionOptions.checkerPath,'process.exit(0);\n');
            }
            if(!configurationChanged&&invalidateConfiguration==='regression-root'&&scope.toolName==='workflow.host.f19_n04'){
              configurationChanged=true;renameSync(regressionOptions.rootPath,regressionOptions.rootPath+'.original');mkdirSync(regressionOptions.rootPath);
            }
            if(!configurationChanged&&invalidateConfiguration==='close-selection'&&scope.toolName==='github.registered_close_issue'){
              configurationChanged=true;issueConfiguration.configureFromNativeSelection({selection:nativeSelection,regression:{rootPath:regressionOptions.rootPath,
                sourceBranch:regressionOptions.sourceBranch,checkerPath:regressionOptions.checkerPath,checkerSha256:regressionOptions.checkerSha256}});
            }
          }}}:{}),
        ...(regressionOptions?{regression:regressionOptions}:{}),closeIssue:fullClose,
        github:{assertCurrent:current,createTools:(options={})=>createGitHubF18F19Tools({runner,readToken:async()=> 'synthetic-only-token',
          repositories:[issue.repo],requiredChecks:['unused-read-fixture'],eligibleReviewers:['unused-read-fixture'],beforeWrite(){assert.fail('No GitHub write permitted');},...options})},
        authorizeExport:async value=>{exports.push(value);if(revokeDuringExport&&value.value?.repairTaskId)revoked=true;return true;}};
      if(configuredAdapter){
        const root=join(dirname(config.path),'user'),userData=join(dirname(config.path),'f19-native-settings');mkdirSync(userData);
        const workspace={bindingId:'original-f19-workspace',rootPath:root,command:{recipeIds:['publication-check']},assertCurrent:current};
        issueConfiguration=createF19IssueConfiguration({userData,readWorkspace:()=>workspace,
          readRepositoryBinding:()=>({repository:issue.repo,bindingId:workspace.bindingId}),
          safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()}});
        issueConfiguration.configureFromNativeSelection({selection:nativeSelection,regression:{rootPath:regressionOptions.rootPath,
          sourceBranch:regressionOptions.sourceBranch,checkerPath:regressionOptions.checkerPath,checkerSha256:regressionOptions.checkerSha256}});
        ports=createConfiguredDesktopF19IssueRepairPorts({getApplication:()=>app,issueConfiguration,nativeExecutionHost:native,
          codingWorkspace:{readDeveloperConfiguration:()=>workspace,readWorkspaceBinding:()=>({rootPath:root,nodeExecutable:process.execPath,bindingId:workspace.bindingId})},
          developerDeployment:{snapshot:()=>({configured:true,state:'configured',repository:issue.repo}),host:{...developerHost,
            createF18F19Tools:factoryOptions.github.createTools}},authorizeExport:factoryOptions.authorizeExport,
          requestPresence:factoryOptions.publication.requestPresence});
      }else ports=createDesktopF19IssueRepairPorts(factoryOptions);
      assert.equal(ports.configuredWorkflowWorkerPorts[0].available(),fullClose);
      // Stage-one boundary only: explicitly let this fixture reach N03. The
      // production worker stays unavailable and the fixture N04 rejects all completion.
      const missing=[...(regression?[]:['f19_n04']),...(fullClose?[]:['f19_n05'])].map(name=>({descriptor:{name:'workflow.host.'+name,version:'1.0.0',
        inputSchema:{type:'object',additionalProperties:false,properties:{}},outputSchema:{},sideEffect:'read',requiredScopes:['github:read'],
        idempotencySupport:false,recoverySupport:false,requiresPresence:false},execute(){throw new ProtocolError('UNSUPPORTED_CAPABILITY','Explicit fixture: original publication/regression absent');}}));
      const observed=(developerHost?.tools??[]).map(tool=>({...tool,async execute(...args){try{
        if(replacePublishedBytes&&tool.descriptor.name==='workspace.run_allowed_command')
          writeFileSync(join(dirname(config.path),'user','feature.cjs'),'// Unreviewed replacement still passes the checker\nmodule.exports=()=>3;\n');
        return await tool.execute(...args);}
        catch(error){failures.push({tool:tool.descriptor.name,message:error.message,stack:error.stack});throw error;}}}));
      const hostTools=ports.tools.map(tool=>({...tool,async execute(...args){try{return await tool.execute(...args);}
        catch(error){failures.push({tool:tool.descriptor.name,message:error.message,stack:error.stack});throw error;}}}));
      const tools=[...config.tools,...hostTools,...observed,...missing,r.createDesktopSubagentDispatchTool({competitionOnly:true,
        getRuntime:()=>app.runtime,getTools:()=>app.tools,runDefaultWorker:(task,worker,scope)=>app.runDefaultSubagentWorker(task,worker,scope)})];
      app=r.createRuntimeApplication({...config,tools,delegateUserTasks:true,isUserPresent:()=>true,configuredWorkflowWorkers:ports.configuredWorkflowWorkerPorts.map(worker=>({...worker,image,...(fullClose?{}:{available:()=>true})})),
        automaticTools:config.automaticTools.filter(tool=>tool.toolName!=='coding.repair.workflow'),
        requestToolAuthorization:async scope=>{
          const closeProof=ports.prepareCloseQuestion?.(scope,{prepare(_scope,fence){assert.equal(fence.assertCurrent(),true);}});
          if(closeProof){
            closeApprovals++;if(denyClose)return 'deny';await ports.confirmClosePresence(scope);
          }
          const regressionProof=ports.prepareRegressionQuestion?.(scope,{prepare(_scope,fence){
            assert.equal(fence.assertCurrent(),true);assert.match(fence.requirements[0].summary,/原 PR 已独立审核并合并/);}});
          if(regressionProof){
            regressionApprovals++;
            assert.throws(()=>ports.prepareRegressionQuestion({...scope,argumentsDigest:'f'.repeat(64)},{prepare(){}}),{code:'UNAUTHORIZED'});
            assert.equal(requests.some(value=>value.endpoint.endsWith('/pulls/93')),false,'No merge read occurs before original approval');
            if(denyRegression)return 'deny';
            if(cancelRegression)app.runtime.requestCancel(scope.taskId,'Synthetic cancellation while awaiting regression approval');
            prepareMergedCheckout();await ports.confirmRegressionPresence(scope);
          }
          if(scope.toolName==='workspace.f19_regression_command')await native.prepare(scope);
          const proof=ports.preparePublicationQuestion?.(scope,{prepare:(_scope,fence)=>assert.equal(fence.assertCurrent(),true)});
          if(proof){
            assert.throws(()=>ports.preparePublicationQuestion({...scope,argumentsDigest:'f'.repeat(64)},{prepare(){}}),{code:'UNAUTHORIZED'});
            if(denyPublication===scope.toolName)return 'deny';
            await ports.confirmPublicationPresence(scope);
          }
          if(scope.toolName==='coding.repair.workflow'){
          dispatchApprovals++;if(cancelDispatch)app.runtime.requestCancel(scope.taskId,'Synthetic original dispatch cancellation');
          return denyDispatch?'deny':'allow_once';}return 'allow_once';},
        competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,available:()=>true})),
        competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
          exportPolicyVersion:'explicit-f19-fixture-consent',accepts:()=>true,project:({result})=>result})),
        coordination:{execute:async request=>request.continuation||app.runtime.getTask(request.taskId).conversationId==='synthetic-f15'?{kind:'text',text:'Synthetic stopped workflow',verification:'mock'}:
          {kind:'tool_proposal',proposalId:'original-f19',toolName:'workflow.f19.issue_repair',toolVersion:'1.0.0',arguments:nativeSelection,verification:'mock'}}});
      if(developerHost){developerHost.bind(app);developerHost.configureF19Publication(ports.publication);}
      const originalClose=app.close.bind(app);app.close=()=>{
        const tasks=app.runtime.listTasks({limit:100}).items;
        const hosts=tasks.filter(task=>app.runtime.loadCheckpoint(task.taskId,'host-tool-intent'));
        const dispatch=hosts.find(task=>app.runtime.loadCheckpoint(task.taskId,'host-tool-intent').toolName==='coding.repair.workflow');
        const children=dispatch?tasks.filter(task=>app.runtime.loadCheckpoint(task.taskId,'subtask-parent')?.parentTaskId===dispatch.taskId):[];
        closedEvidence={tasks,hosts:hosts.map(task=>app.readHostToolTask(task.taskId)),children,dispatchApprovals};
        if(dispatch?.state==='succeeded'){
          const intent=app.runtime.loadCheckpoint(dispatch.taskId,'host-tool-intent'),runId='host-tool-'+dispatch.taskId;
          const ref={taskId:dispatch.taskId,runId,scopeRef:runId,toolVersion:'1.0.0',arguments:intent.arguments};
          const proof=r.readRuntimeCodingRepairDispatchChild(app,ref);closedEvidence.proof=proof;closedEvidence.reference=ref;
          assert.equal(proof.taskId,children[0].taskId);assert.equal(proof.mode,'main');assert.equal(proof.state,'succeeded');
          assert.throws(()=>{proof.taskId='foreign';},TypeError);
          for(const patch of [{runId:'foreign'},{scopeRef:'foreign'},{arguments:{...ref.arguments,codingRepair:{mode:'isolated'}}}])
            assert.throws(()=>r.readRuntimeCodingRepairDispatchChild(app,{...ref,...patch}));
          const parent=app.runtime.loadCheckpoint(proof.taskId,'subtask-parent');
          for(const patch of [{parentTaskId:'foreign'},{subtaskId:'foreign'},{goal:'changed'},{parentDeadline:'2000-01-01T00:00:00Z'}]){
            app.runtime.saveCheckpoint(proof.taskId,'subtask-parent',{...parent,...patch});
            assert.throws(()=>r.readRuntimeCodingRepairDispatchChild(app,ref),{code:'UNAUTHORIZED'});
          }
          app.runtime.saveCheckpoint(proof.taskId,'subtask-parent',parent);
          const graph=app.runtime.loadCheckpoint(proof.taskId,'coding-repair:graph');
          app.runtime.saveCheckpoint(proof.taskId,'coding-repair:graph',{...graph,input:{...graph.input,codingRepair:{...graph.input.codingRepair,
            session:{...graph.input.codingRepair.session,sessionId:'foreign'}}}});
          assert.throws(()=>r.readRuntimeCodingRepairDispatchChild(app,ref),{code:'UNAUTHORIZED'});
          app.runtime.saveCheckpoint(proof.taskId,'coding-repair:graph',graph);
          assert.deepEqual(r.readRuntimeCodingRepairDispatchChild(app,ref),proof);
          const source=app.runtime.loadCheckpoint(dispatch.taskId,'coding-repair:parent');
          const original=app.runtime.loadCheckpoint(source.taskId,'f19:original-issue-repair:v1');
          assert.equal(original.snapshot.snapshotDigest,digest(issue));assert.equal(original.snapshot.issueId,19);
          closedEvidence.original=original;
        }
        closedEvidence.pushes=pushes;closedEvidence.presence=presence;closedEvidence.nativeExecutions=nativeExecutions;closedEvidence.regressionApprovals=regressionApprovals;
        closedEvidence.closeApprovals=closeApprovals;closedEvidence.configurationChanged=configurationChanged;
        if(fullClose&&hosts.some(task=>app.runtime.loadCheckpoint(task.taskId,'host-tool-intent')?.toolName==='workflow.host.f19_n05'&&task.state==='succeeded')){
          // Audit the persisted proof after the timed product flow has ended.
          // These negative reads must not spend the original task's 60s budget.
          const nativeTask=hosts.find(task=>app.runtime.loadCheckpoint(task.taskId,'host-tool-intent')?.toolName==='workspace.f19_regression_command');
          const runId='host-tool-'+nativeTask.taskId,key='native-sandbox-execution:'+runId,original=app.runtime.loadCheckpoint(nativeTask.taskId,key);
          const bindingKey='f19-native-command:v1:'+runId,bound=app.runtime.loadCheckpoint(nativeTask.taskId,bindingKey);
          const parent=app.runtime.loadCheckpoint(nativeTask.taskId,'coding-repair:parent'),owner=app.runtime.loadCheckpoint(parent.taskId,'coding-repair:parent');
          const intent=app.runtime.loadCheckpoint(owner.taskId,'owned-workflow:intent:'+owner.operationId);
          const scope={parentTaskId:owner.taskId,localTaskId:parent.taskId,operationId:owner.operationId,sessionId:intent.sessionId,
            deadline:intent.deadline,signal:new AbortController().signal};
          const binding={repo:issue.repo,issueId:19,source:bound.source,mergeRead:app.runtime.loadCheckpoint(parent.taskId,'f19:regression:merge'),
            regressionRead:app.runtime.loadCheckpoint(parent.taskId,'f19:regression:command')};
          assert.deepEqual(r.readRuntimeF19NativeRegression(app,scope,binding),{verified:true,issueId:19});
          for(const patch of [{enforced:false},{stopped:false},{executionStarted:false},{argumentsDigest:'foreign'},{originalBindingDigest:'foreign'}]){
            app.runtime.saveCheckpoint(nativeTask.taskId,key,[{...original[0],...patch}]);
            assert.throws(()=>r.readRuntimeF19NativeRegression(app,scope,binding),{code:'UNAUTHORIZED'});
          }
          app.runtime.saveCheckpoint(nativeTask.taskId,key,original);
          for(const patch of [{root:'foreign'},{source:{...bound.source,mergedSha:'f'.repeat(40)}},{recipes:[{executable:'foreign',args:[]}]}]){
            app.runtime.saveCheckpoint(nativeTask.taskId,bindingKey,{...bound,...patch});
            assert.throws(()=>r.readRuntimeF19NativeRegression(app,scope,binding),{code:'UNAUTHORIZED'});
          }
          app.runtime.saveCheckpoint(nativeTask.taskId,bindingKey,bound);closedEvidence.regressionProofChecked=true;
        }
        if(publish&&closedEvidence.proof){
          const source=app.runtime.loadCheckpoint(closedEvidence.proof.dispatchTaskId,'coding-repair:parent');
          const parent=app.runtime.loadCheckpoint(source.taskId,'coding-repair:parent');
          const owner=app.runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId);
          closedEvidence.publicationRecords=['command','commit','push','pr'].map(kind=>({kind,reference:app.runtime.loadCheckpoint(source.taskId,'f19:publication:'+kind)}));
          closedEvidence.scope={parentTaskId:parent.taskId,localTaskId:source.taskId,operationId:parent.operationId,sessionId:owner.sessionId,
            deadline:owner.deadline,signal:new AbortController().signal};
          // N04 is unavailable by design in this phase, so its graph has already
          // stopped. Inspect original persisted records rather than reauthorizing export.
        }
        originalClose();developerHost?.close();native?.close();issueConfiguration?.close();
      };return app;
    }});
  return {report,evidence:closedEvidence,requests,exports,nodes,failures};
}

test('F19 original issue and selected candidate create exactly one real F15 child; unsupported close stays unavailable',async()=>{
  const f=await fixture();
  assert.ok(f.evidence.proof,JSON.stringify({hosts:f.evidence.hosts.map(value=>({tool:value.toolName,state:value.task.state,error:value.task.error})),tasks:f.evidence.tasks}));
  assert.equal(f.evidence.children.length,1);assert.equal(f.evidence.dispatchApprovals,1);assert.equal(f.requests.length,1);
  const enqueue=f.evidence.hosts.find(value=>value.toolName==='workflow.host.f19_n03');
  assert.equal(enqueue.task.state,'succeeded');assert.deepEqual(enqueue.confirmed.result,{issueId:19,repairTaskId:f.evidence.proof.taskId});
  assert.ok(f.nodes.includes('F19_N02'));assert.ok(f.nodes.includes('F19_N03'));
  assert.equal(f.evidence.hosts.some(value=>value.toolName==='workflow.host.f19_n05'),false);
  assert.equal(f.report.unrelatedUnchanged,true);assert.equal(f.report.retainsUserComment,true);
  const reopened=r.createRuntimeApplication({path:join(f.report.directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-f15-host'});
  try{assert.deepEqual(r.readRuntimeCodingRepairDispatchChild(reopened,f.evidence.reference),f.evidence.proof);
    assert.equal(reopened.runtime.listTasks({conversationId:'desktop-subtask:'+f.evidence.proof.dispatchTaskId,limit:100}).items.length,1);
  }finally{reopened.close();}
});

for(const [name,options] of [['changed original candidate digest',{replaceDigest:true}],['denied original F15 dispatch',{denyDispatch:true}],
  ['cancelled original F15 dispatch',{cancelDispatch:true}]])
test('F19 '+name+' never creates a repair child',async()=>{
  const f=await fixture(options);assert.equal(f.evidence.children.length,0);assert.equal(f.evidence.proof,undefined);
  assert.ok(f.nodes.includes('F19_N02'));assert.equal(f.requests.length,1);
  assert.equal(f.evidence.dispatchApprovals,options.denyDispatch||options.cancelDispatch?1:0);
  assert.equal(f.evidence.hosts.some(value=>value.toolName==='workflow.host.f19_n05'),false);
});

test('F19 export revocation preserves the original completed child and refuses the outer receipt',async()=>{
  const f=await fixture({revokeDuringExport:true});assert.ok(f.evidence.proof);assert.equal(f.evidence.children.length,1);
  assert.notEqual(f.evidence.hosts.find(value=>value.toolName==='workflow.host.f19_n03').task.state,'succeeded');
  assert.equal(f.evidence.hosts.some(value=>value.toolName==='workflow.host.f19_n05'),false);
});

test('F19 missing trusted providers exposes no tools or worker',()=>{
  const ports=createDesktopF19IssueRepairPorts();assert.deepEqual(ports.tools,[]);assert.deepEqual(ports.configuredWorkflowWorkerPorts,[]);
});

test('F19 original merged PR runs an independent fixed checker through its native child exactly once',async t=>{
  const f=await fixture({publish:true,regression:true,testContext:t});
  const host=f.evidence.hosts.find(value=>value.toolName==='workflow.host.f19_n04');
  assert.equal(host?.task.state,'succeeded',JSON.stringify({failures:f.failures,hosts:f.evidence.hosts.map(value=>({tool:value.toolName,state:value.task.state,error:value.task.error}))}));
  assert.deepEqual(host.confirmed.result,{issueId:19,verified:true});assert.equal(f.evidence.nativeExecutions,1);
  assert.equal(f.evidence.regressionApprovals,1);
  assert.equal(f.requests.filter(value=>value.endpoint.endsWith('/pulls/93')).length,1);
  assert.equal(f.requests.some(value=>value.method==='PATCH'),false);
});

test('F19 complete configured worker closes only its original Issue after native regression and exact readback',async t=>{
  const f=await fixture({publish:true,regression:true,fullClose:true,configuredAdapter:true,testContext:t});
  const host=f.evidence.hosts.find(value=>value.toolName==='workflow.host.f19_n05');
  assert.equal(host?.task.state,'succeeded',JSON.stringify({failures:f.failures,hosts:f.evidence.hosts.map(value=>({tool:value.toolName,state:value.task.state,error:value.task.error}))}));
  assert.deepEqual(host.confirmed.result,{issueId:19,closed:true});assert.equal(f.evidence.closeApprovals,1);
  assert.equal(f.evidence.regressionProofChecked,true);
  assert.equal(f.evidence.nativeExecutions,1);assert.equal(f.requests.filter(value=>value.method==='PATCH').length,1);
  assert.equal(f.evidence.hosts.filter(value=>value.toolName==='workflow.host.f15_n05').length,1,'This positive adapter flow does not repeat the separate F15 recovery exercise');
  assert.equal(f.evidence.tasks.find(value=>value.taskId===f.evidence.scope.parentTaskId).state,'succeeded');
});

for(const [stage,nativeExecutions,pushes] of [['publication-checker',0,0],['regression-root',0,1],['close-selection',1,1]])
test('F19 configured '+stage+' replacement during original presence cannot cross its effect guard',async t=>{
  const f=await fixture({publish:true,regression:true,fullClose:true,configuredAdapter:true,invalidateConfiguration:stage,testContext:t});
  assert.equal(f.evidence.configurationChanged,true,'The replacement must occur in the original confirmation wait');
  assert.equal(f.evidence.nativeExecutions,nativeExecutions);assert.equal(f.evidence.pushes,pushes);
  assert.equal(f.requests.filter(value=>value.method==='PATCH').length,0);
  assert.equal(f.evidence.hosts.some(value=>value.toolName==='github.registered_close_issue'&&value.task.state==='succeeded'),false);
});

for(const [name,options,patches] of [['denied original close',{denyClose:true},0],['changed original Issue revision',{changedCloseIssue:true},0],
  ['unknown original close',{unknownClose:true},1],['changed close response readback',{postCloseChanged:true},1]])
test('F19 '+name+' cannot claim full completion or resend close',async t=>{
  const f=await fixture({publish:true,regression:true,fullClose:true,testContext:t,...options});
  assert.notEqual(f.evidence.tasks.find(value=>value.taskId===f.evidence.scope.parentTaskId).state,'succeeded');
  assert.equal(f.requests.filter(value=>value.method==='PATCH').length,patches);
  if(patches){
    const child=f.evidence.hosts.find(value=>value.toolName==='github.registered_close_issue');assert.equal(child.task.state,'waiting_reconciliation');
    const reopened=r.createRuntimeApplication({path:join(f.report.directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-f15-host'});
    try{assert.equal(reopened.readHostToolTask(child.task.taskId).task.state,'waiting_reconciliation');assert.equal(f.requests.filter(value=>value.method==='PATCH').length,1);}
    finally{reopened.close();}
  }
});

for(const [name,options,executions] of [['unmerged original PR',{unmerged:true},0],['different independent checkout SHA',{wrongCheckout:true},0],
  ['changed independent checker',{changedChecker:true},0],['failing independent bug regression',{regressionFails:true},1],
  ['unknown original native result',{unknownRegression:true},1],['denied original regression approval',{denyRegression:true},0],
  ['cancelled original regression approval',{cancelRegression:true},0]])
test('F19 '+name+' never certifies regression or closes the issue',async t=>{
  const f=await fixture({publish:true,regression:true,testContext:t,...options});
  assert.notEqual(f.evidence.hosts.find(value=>value.toolName==='workflow.host.f19_n04')?.task.state,'succeeded');
  assert.equal(f.evidence.nativeExecutions,executions);assert.equal(f.requests.some(value=>value.method==='PATCH'),false);
  if(options.unknownRegression){
    const child=f.evidence.hosts.find(value=>value.toolName==='workspace.f19_regression_command');
    assert.equal(child.task.state,'waiting_reconciliation');
    const reopened=r.createRuntimeApplication({path:join(f.report.directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-f15-host'});
    try{assert.equal(reopened.readHostToolTask(child.task.taskId).task.state,'waiting_reconciliation');assert.equal(f.evidence.nativeExecutions,1);}
    finally{reopened.close();}
  }
});

test('F19 original F15 publication uses real Git commit and command plus explicit fake remote/PR transport once',async t=>{
  const f=await fixture({publish:true,testContext:t}),host=f.evidence.hosts.find(value=>value.toolName==='workflow.host.f19_n03');
  assert.equal(host.task.state,'succeeded',JSON.stringify({failures:f.failures,hosts:f.evidence.hosts.map(value=>({tool:value.toolName,state:value.task.state,error:value.task.error}))}));
  assert.equal(f.evidence.pushes,1);assert.equal(f.requests.filter(value=>value.method==='POST').length,1);assert.equal(f.evidence.presence,3);
  assert.ok(f.evidence.publicationRecords.every(value=>value.reference));assert.equal(f.evidence.children.length,1);
  const pr=f.evidence.hosts.find(value=>value.toolName==='github.pr.create');assert.equal(pr.confirmed.result.externalId,'93');
  assert.equal(f.evidence.hosts.some(value=>value.toolName==='workflow.host.f19_n05'),false);
});

for(const tool of ['workspace.git.commit','workspace.git.push','github.pr.create'])
test('F19 independent '+tool+' denial never advances publication',async t=>{
  const f=await fixture({publish:true,testContext:t,denyPublication:tool});
  assert.notEqual(f.evidence.hosts.find(value=>value.toolName==='workflow.host.f19_n03').task.state,'succeeded');
  assert.equal(f.requests.filter(value=>value.method==='POST').length,0);assert.equal(f.evidence.children.length,1);
  assert.equal(f.evidence.pushes,tool==='github.pr.create'?1:0);
});

test('F19 unknown original PR write retains the same child and never closes the issue',async t=>{
  const f=await fixture({publish:true,testContext:t,unknownPr:true});
  assert.equal(f.evidence.pushes,1);assert.equal(f.requests.filter(value=>value.method==='POST').length,1);
  const pr=f.evidence.hosts.find(value=>value.toolName==='github.pr.create');assert.equal(pr.task.state,'waiting_reconciliation');
  assert.ok(f.evidence.publicationRecords.find(value=>value.kind==='pr').reference);
  const reopened=r.createRuntimeApplication({path:join(f.report.directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-f15-host'});
  try{assert.equal(reopened.readHostToolTask(pr.task.taskId).task.state,'waiting_reconciliation');assert.equal(f.evidence.pushes,1);
    assert.equal(f.requests.filter(value=>value.method==='POST').length,1);}finally{reopened.close();}
});

for(const [name,options] of [['changed published bytes with a passing checker',{replacePublishedBytes:true}],
  ['revocation during native presence',{revokePresence:true}],['a different Git remote under the same repository label',{foreignRemote:true}]])
test('F19 refuses '+name+' before publishing a PR',async t=>{
  const f=await fixture({publish:true,testContext:t,...options});assert.equal(f.evidence.children.length,1);
  assert.notEqual(f.evidence.hosts.find(value=>value.toolName==='workflow.host.f19_n03').task.state,'succeeded');
  assert.equal(f.evidence.pushes,0);assert.equal(f.requests.filter(value=>value.method==='POST').length,0);
  if(options.replacePublishedBytes)assert.equal(f.evidence.hosts.find(value=>value.toolName==='workspace.run_allowed_command').confirmed.result.exitCode,0);
  if(options.revokePresence)assert.equal(f.evidence.presence,1);
});

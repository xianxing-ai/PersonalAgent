import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {createGitTools} from '@personal-agent/coding-tools';
import {GITHUB_CONNECTOR_VERSION} from '@personal-agent/github';
import {readF16OriginalInvocation} from './f16-git-publication-port.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha=value=>createHash('sha256').update(readFileSync(value)).digest('hex');
const fail=message=>{throw new ProtocolError('UNAUTHORIZED',message);};
const prefix='f19:regression:',hostName='workflow.host.f19_n04';
const names={merge:'github.merged_pr_readback',head:'workspace.f19_regression_head',command:'workspace.f19_regression_command'};
const ref=value=>({taskId:value.taskId,runId:value.runId,scopeRef:value.scopeRef,toolVersion:value.toolVersion,arguments:value.arguments});
const outside=(root,target)=>{const value=path.relative(root,target);return value==='..'||value.startsWith('..'+path.sep)||path.isAbsolute(value);};
const identity=file=>{const value=lstatSync(file,{bigint:true});if(value.isSymbolicLink()||realpathSync.native(file)!==file)fail('F19 canonical path changed');
  return [file,String(value.dev),String(value.ino),String(value.birthtimeNs)];};

/** Fixed, independently selected checker and existing native command/Git ports.
 * Never checks out a revision, starts another scheduler or accepts model argv. */
export function createF19RegressionHost({getApplication:app,runtimeModule:r,binding,bridge,publisher,publication,configuration}) {
  const root=realpathSync.native(configuration.rootPath),node=realpathSync.native(configuration.nodeExecutable);
  const checker=realpathSync.native(configuration.checkerPath),recipeId='f19-independent-bug-regression';
  const rootIdentity=identity(root),nodeIdentity=identity(node),checkerIdentity=identity(checker);
  if(!lstatSync(root).isDirectory()||!lstatSync(node).isFile()||!lstatSync(checker).isFile()
    ||!outside(root,node)||!outside(root,checker)||sha(checker)!==configuration.checkerSha256
    ||!/^[a-f0-9]{64}$/.test(configuration.configurationRef)||typeof configuration.assertCurrent!=='function'
    ||typeof configuration.native?.createCommandTool!=='function'||typeof configuration.sourceBranch!=='string')
    fail('Independent F19 regression configuration unavailable');
  const recipe={id:recipeId,executable:node,args:['--preserve-symlinks','--preserve-symlinks-main',checker,root]};
  function current(scope){
    const bound=binding(scope),value=configuration.assertCurrent(scope);
    if(value!==undefined){void Promise.resolve(value).catch(()=>{});fail('F19 regression guard must be synchronous');}
    const published=publication.readConfiguration(scope),workspace=realpathSync.native(published.rootPath);
    if(!outside(workspace,root)||!outside(root,workspace)||!outside(workspace,checker)
      ||!isDeepStrictEqual(identity(root),rootIdentity)||!isDeepStrictEqual(identity(node),nodeIdentity)
      ||!isDeepStrictEqual(identity(checker),checkerIdentity)||sha(checker)!==configuration.checkerSha256)
      fail('Original independent regression paths or checker changed');
    return bound;
  }
  const original=scope=>{current(scope);return publisher.original(scope).value;};
  function saved(scope,kind){
    const reference=app().runtime.loadCheckpoint(scope.localTaskId,prefix+kind);
    if(!reference)fail('Original F19 regression '+kind+' unavailable');
    const proof=r.readWorkflowBusinessToolSource(app(),scope,reference,names[kind]);
    if(proof.graph.nodeId!=='F19_N04'||proof.sourceHost.taskId!==scope.localTaskId
      ||proof.actionKey!=='f19.regression.'+kind)fail('Foreign F19 regression receipt');
    return {reference,result:proof.receipt.result};
  }
  function merged(scope){
    const published=original(scope),merge=saved(scope,'merge');
    if(merge.result.merged!==true||merge.result.headSha!==published.headSha||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(merge.result.mergedSha))
      throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original F19 PR is not confirmed merged');
    return {...published,mergedSha:merge.result.mergedSha};
  }
  function checkout(scope){
    const value=merged(scope),head=saved(scope,'head').result;
    if(head.headSha!==value.mergedSha||head.clean!==true||head.workspaceClean!==true)fail('Preconfigured F19 checkout is not the original merged revision');
    const git=path.join(root,'.git'),headFile=path.join(git,'HEAD');identity(git);identity(headFile);
    if(!lstatSync(git).isDirectory()||readFileSync(headFile,'utf8').trim()!=='ref: refs/heads/'+configuration.sourceBranch)
      fail('F19 independent checkout branch changed');
    const branch=path.join(git,'refs','heads',configuration.sourceBranch);identity(branch);
    if(readFileSync(branch,'utf8').trim()!==value.mergedSha)fail('F19 independent checkout SHA changed');
    const files=value.repair.files.map(file=>{
      const target=path.join(root,file.path);identity(target);
      if(!lstatSync(target).isFile()||sha(target)!==file.afterSha256)fail('F19 merged repair bytes changed');
      return {path:file.path,sha256:file.afterSha256};
    }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
    if(hash(files)!==head.fingerprint)fail('F19 independent checkout fingerprint changed');
    return value;
  }
  function resolveTool(request,scope){
    if(!request.actionKey.startsWith('f19.regression.'))return;
    const kind=request.actionKey.slice('f19.regression.'.length),bound=current(scope);let args;
    if(kind==='merge'){const value=original(scope);args={repo:value.repo,prNumber:value.prNumber,headSha:value.headSha,baseSha:value.baseSha};}
    else if(kind==='head'){merged(scope);args={repository:bound.input.repo};}
    else if(kind==='command'){checkout(scope);args={recipeId};}
    else return;
    if(request.input!==undefined&&!isDeepStrictEqual(request.input,args))fail('Original F19 regression arguments changed');
    return {workflowId:'F19',nodeId:'F19_N04',hostToolName:hostName,toolName:names[kind],
      toolVersion:kind==='merge'?GITHUB_CONNECTOR_VERSION:'1.0.0',arguments:args};
  }
  function commandSource(context){
    const runtime=app().runtime,deadline=runtime.loadCheckpoint(context.taskId,'host-tool-intent')?.deadline;
    if(!Number.isFinite(Date.parse(context.deadline))||Date.parse(context.deadline)>Date.parse(deadline))fail('Original F19 command deadline changed');
    context={...context,deadline};
    const parent=runtime.loadCheckpoint(context.taskId,'coding-repair:parent');
    const owner=parent&&runtime.loadCheckpoint(parent.taskId,'coding-repair:parent');
    const intent=owner&&runtime.loadCheckpoint(owner.taskId,'owned-workflow:intent:'+owner.operationId);
    if(!parent||!owner||intent?.workflowId!=='F19'||intent.proposal?.nodeId!=='F19_N04'||intent.proposal.toolName!==hostName
      ||intent.deadline!==context.deadline||intent.proposal.operationId!==owner.operationId)fail('Original F19 regression lineage changed');
    const scope={parentTaskId:owner.taskId,localTaskId:parent.taskId,operationId:owner.operationId,sessionId:intent.sessionId,
      deadline:context.deadline,signal:context.signal};
    const ctx={...context,taskId:parent.taskId,runId:'host-tool-'+parent.taskId,authorizationRef:'host-tool-'+parent.taskId};
    const request={actionKey:'f19.regression.command',input:{recipeId}},read=bridge().read(request,ctx);
    const invocation=readF16OriginalInvocation(app(),context.taskId,context.runId,context);
    const originalInvocation=runtime.loadCheckpoint(context.taskId,'application-tool-invocation:'+context.runId);
    if(read.taskId!==context.taskId||read.runId!==context.runId||invocation.toolName!==names.command
      ||!isDeepStrictEqual(invocation.arguments,{recipeId})||context.argumentsDigest!==originalInvocation?.argumentsDigest)
      fail('Original F19 regression command changed');
    const value=checkout(scope);
    return {parentTaskId:scope.parentTaskId,sessionId:scope.sessionId,hostTaskId:scope.localTaskId,
      taskId:context.taskId,runId:context.runId,argumentsDigest:context.argumentsDigest,
      repo:value.repo,issueId:value.issueId,prNumber:value.prNumber,headSha:value.headSha,mergedSha:value.mergedSha,
      root,recipeId,configurationRef:configuration.configurationRef,checkerSha256:configuration.checkerSha256,recipeDigest:hash(recipe)};
  }
  const git=publication.readConfiguration(),head=createGitTools({...git,rootPath:root,sourceBranch:configuration.sourceBranch,
    remoteName:'origin',readVerification:async()=>undefined}).head;
  const command=configuration.native.createCommandTool({rootPath:root,recipes:[recipe],trustedReadRoots:[path.dirname(checker)],readF19Binding:commandSource});
  const tools=[{...head,descriptor:{...head.descriptor,name:names.head}},
    {...command,descriptor:{...command.descriptor,name:names.command}}];
  function pending(scope){
    const invocation=app().readAuthorizationQuestionInvocation(scope.taskId,scope.runId);
    if(invocation?.toolName!==hostName)return;
    const runtime=app().runtime,parent=runtime.loadCheckpoint(scope.taskId,'coding-repair:parent');
    const intent=parent&&runtime.loadCheckpoint(parent.taskId,'owned-workflow:intent:'+parent.operationId);
    const edge=parent&&runtime.loadCheckpoint(parent.taskId,'coding-repair:host:'+parent.operationId);
    if(scope.runId!=='host-tool-'+scope.taskId||scope.toolName!==hostName||scope.toolVersion!=='1.0.0'
      ||scope.argumentsDigest!==invocation.argumentsDigest||scope.deadline!==invocation.deadline
      ||!isDeepStrictEqual(invocation.arguments,{})||intent?.workflowId!=='F19'||intent.proposal?.nodeId!=='F19_N04'
      ||intent.proposal.toolName!==hostName||intent.proposal.operationId!==parent.operationId||intent.deadline!==scope.deadline
      ||!isDeepStrictEqual(intent.proposal.arguments,{})||edge?.localTaskId!==scope.taskId)
      fail('Original F19 regression approval changed');
    const owner={...scope,parentTaskId:parent.taskId,localTaskId:scope.taskId,operationId:parent.operationId,sessionId:intent.sessionId};
    const value=original(owner);
    return {taskId:scope.taskId,runId:scope.runId,argumentsDigest:scope.argumentsDigest,parentTaskId:parent.taskId,
      sessionId:intent.sessionId,repo:value.repo,issueId:value.issueId,prNumber:value.prNumber,headSha:value.headSha,
      configurationRef:configuration.configurationRef};
  }
  function read(scope,context){
    const value=checkout(scope),regressionRead=saved(scope,'command').reference;
    const invocation=app().runtime.loadCheckpoint(regressionRead.taskId,'application-tool-invocation:'+regressionRead.runId);
    const source=commandSource({...context,taskId:regressionRead.taskId,runId:regressionRead.runId,authorizationRef:regressionRead.runId,
      argumentsDigest:invocation?.argumentsDigest});
    return {publication:value,proof:{repo:value.repo,issueId:value.issueId,mergeRead:saved(scope,'merge').reference,regressionRead,source}};
  }
  return {tools,resolveTool,
    original(scope){
      const bound=current(scope),hosts=bound.confirmedOperations.filter(value=>value.nodeId==='F19_N04'&&value.toolName===hostName);
      if(hosts.length!==1||hosts[0].result.verified!==true)fail('Original F19 regression frontier unavailable');
      const sourceScope={...scope,localTaskId:hosts[0].localTaskId,operationId:hosts[0].operationId};
      const {proof,publication}=read(sourceScope,{deadline:scope.deadline,signal:scope.signal,scopes:['github:read']});
      r.readRuntimeF19NativeRegression(app(),sourceScope,proof);return {scope:sourceScope,proof,publication};
    },
    prepareQuestion(scope,question){
      const proof=pending(scope);if(!proof)return;
      question.prepare(scope,{requirements:[{requirementId:'f19-merged-regression',kind:'tool',scopes:['github:read'],
        bindingDigest:hash(proof),ruleBindingDigest:hash(['f19-merged-regression',configuration.configurationRef]),
        summary:'原 PR 已独立审核并合并、独立目录已预配 merged SHA 后才批准回归；批准后仍实时核验原 PR、checkout 与固定独立回归'}],
        assertCurrent:()=>{try{return isDeepStrictEqual(proof,pending(scope));}catch{return false;}}});return proof;
    },
    async confirmPresence(scope){const proof=pending(scope);if(!proof)return false;
      await publication.requestPresence(scope);if(!isDeepStrictEqual(proof,pending(scope)))fail('Original F19 regression approval changed');return true;},
    async verify(scope,context){
      for(const kind of ['merge','head','command']){
        const expected=resolveTool({actionKey:'f19.regression.'+kind},scope);
        const receipt=await bridge().invoke({actionKey:'f19.regression.'+kind,input:expected.arguments},context),reference=ref(receipt);
        app().runtime.saveCheckpointOnce(scope.localTaskId,prefix+kind,reference);
        if(!isDeepStrictEqual(reference,app().runtime.loadCheckpoint(scope.localTaskId,prefix+kind)))fail('Original F19 regression receipt changed');
      }
      return read(scope,context).proof;
    }};
}

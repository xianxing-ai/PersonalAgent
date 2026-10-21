import {createHash} from 'node:crypto';
import {realpathSync,statSync} from 'node:fs';
import path from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const blocked=()=>{throw new ProtocolError('UNSUPPORTED_CAPABILITY','当前外部进程隔离后端或原授权不可用，未降级为普通进程');};
const external=name=>['workspace.run_allowed_command','workspace.node_check','workspace.npm_build','workspace.npm_test',
  'workspace.git_diff_check','coding.repair.verify','coding.repair.check','workflow.host.f15_n05'].includes(name);
const identity=value=>{const target=realpathSync.native(value),stat=statSync(target,{bigint:true});
  return [target,String(stat.dev),String(stat.ino),String(stat.birthtimeNs)];};

/** Main-only composition. Policy permissions and real external-process isolation are separate facts. */
export function createDesktopNativeExecutionHost({coding,question,getApplication,readConfiguration,ensureHelper,probeRootPath,
  systemRoot,localAppData,now=Date.now,onUpdate=()=>{}}){
  let verified,pending,closed=false;
  const runs=new Map();
  function configuration(){
    const value=readConfiguration();
    if(!value?.rootPath||!value.nodeExecutable||!value.bindingId)blocked();
    return {...value,identity:digest([value.bindingId,identity(value.rootPath),identity(value.nodeExecutable)])};
  }
  function current(){
    try{return !closed&&verified?.available&&configuration().identity===verified.configuration.identity
      &&digest(coding.readWindowsNativeHelperAttestation(verified.pins.helperPath))===digest(verified.pins);}catch{return false;}
  }
  async function prepare(scope){
    if(!external(scope.toolName))return;
    const original=getApplication()?.readAuthorizationQuestionInvocation(scope.taskId,scope.runId);if(!original)blocked();
    const config=configuration();
    if(!current()){
      if(!pending)pending=(async()=>{
        const helperPath=await ensureHelper();
        const pins=coding.readWindowsNativeHelperAttestation(helperPath);
        const receipt=await coding.verifyWindowsNativeSandbox(pins,{probeRootPath,nodeExecutable:config.nodeExecutable,
          systemRoot,signal:scope.signal});
        if(!receipt.available||!receipt.enforced||scope.signal.aborted||configuration().identity!==config.identity)blocked();
        verified={available:true,configuration:config,pins,bindingDigest:digest([config.identity,pins,receipt.helperSha256])};
        onUpdate();
      })().finally(()=>{pending=undefined;});
      await pending;
    }
    if(!current())blocked();
    runs.set(JSON.stringify([scope.taskId,scope.runId]),{...scope,configuration:verified.configuration.identity,
      bindingDigest:verified.bindingDigest});
    question.prepare(scope,{requirements:[{requirementId:'native-execution',kind:'tool',scopes:['workspace:execute'],
      bindingDigest:digest([scope.taskId,scope.runId,scope.argumentsDigest,verified.bindingDigest]),
      ruleBindingDigest:digest(['native-execution',verified.bindingDigest,scope.toolName]),
      summary:'外部命令在已验证 Windows 进程边界内执行；仅选定工作区与固定工具路径，默认禁止网络'}],assertCurrent:()=>current()});
  }
  function describeExecution(request,profile){
    const required=Boolean(request?.requirements.some(item=>item.requirementId==='native-execution'))||external(request?.toolName);
    return {required,available:current(),backend:profile.mode==='full-access'?'none':'windows-psec',
      enforced:profile.mode!=='full-access'&&current(),bindingDigest:verified?.bindingDigest,
      ...(!current()?{reason:'外部进程需已配置工作区、可信 Node 和通过实际检查的 Windows helper；应用内工具不需要这些配置'}:{})};
  }
  function assertBinding(binding){
    const entry=runs.get(JSON.stringify([binding.taskId,binding.runId]));
    if(!current()||!entry||entry.signal.aborted||now()>=Date.parse(binding.deadline)
      ||Date.parse(binding.deadline)>Date.parse(entry.deadline)||entry.configuration!==verified.configuration.identity
      ||entry.bindingDigest!==verified.bindingDigest||binding.argumentsDigest!==entry.argumentsDigest
      ||binding.authorizationRef!==entry.runId)blocked();
    const policy=question.readExecutionPolicy(entry);
    if(policy.ref!==binding.sandboxRef||policy.revision!==binding.revision)blocked();
    const task=getApplication().runtime.getTask(binding.taskId);
    if(task.state!=='running'||task.cancelRequested)blocked();
    question.currentRequirement(entry,'native-execution');
  }
  function createCommandTool(options){
    const root=realpathSync.native(options.rootPath),rootIdentity=identity(root);
    const executables=[...new Set(options.recipes.map(recipe=>realpathSync.native(recipe.executable)))];
    const executor={async execute(request){
      assertBinding(request);
      const actual=coding.createWindowsNativeSandboxExecutor({...verified.pins,assertCurrent:assertBinding});
      return actual.execute(request);
    }};
    return coding.createWorkspaceCommandTool({...options,trustedSandbox:{executor,
      bind(context,executionDeadline){
        const entry=runs.get(JSON.stringify([context.taskId,context.runId]));if(!entry||digest(identity(root))!==digest(rootIdentity))blocked();
        const policy=question.readExecutionPolicy(entry);
        const binding={sandboxRef:policy.ref,revision:policy.revision,taskId:context.taskId,runId:context.runId,
          authorizationRef:context.authorizationRef,argumentsDigest:context.argumentsDigest,deadline:executionDeadline};
        assertBinding(binding);
        const mode=policy.mode;
        const roots=[systemRoot,...executables.map(file=>path.dirname(file)),path.dirname(verified.pins.helperPath)];
        const profile={sandboxRef:policy.ref,revision:policy.revision,mode,backend:mode==='full-access'?'none':'windows-psec',
          readRoots:[...new Set([...roots,...(mode==='workspace-write'?[]:[root])])],
          writeRoots:mode==='workspace-write'?[root]:[],executableAllowlist:executables,
          network:{mode:mode==='full-access'?'unrestricted':'deny'}};
        return {...binding,profile};
      },
      recordResult(context,result){
        // Trusted executor facts only. Never persist command stdout/stderr or target-asserted evidence.
        const runtime=getApplication().runtime;
        const name='native-sandbox-execution:'+context.runId;
        const value={runId:context.runId,argumentsDigest:context.argumentsDigest,backend:result.backend,enforced:result.enforced,
          outcome:result.outcome,exitCode:result.exitCode,executionStarted:result.executionStarted,stopped:result.stopped,sideEffects:result.sideEffects};
        const previous=runtime.loadCheckpoint(context.taskId,name)??[];
        if(!Array.isArray(previous)||previous.length>=256)throw new ProtocolError('RESULT_UNKNOWN','Native execution audit capacity reached');
        runtime.saveCheckpoint(context.taskId,name,[...previous,value]);
      }}});
  }
  return {prepare,describeExecution,createCommandTool,close(){closed=true;runs.clear();verified=undefined;},
    environment:()=>({SystemRoot:systemRoot,LOCALAPPDATA:localAppData})};
}

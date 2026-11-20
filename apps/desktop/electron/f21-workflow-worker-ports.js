import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,realpathSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytes=value=>createHash('sha256').update(value).digest('hex');
const fail=(code='UNAUTHORIZED',message='F21 原安装、隔离结果或授权已失效')=>{throw new ProtocolError(code,message);};
const recipeId='f21-filesystem-protocol',commandName='workspace.f21_mcp_probe',sample='PersonalAgent F21 bounded MCP protocol probe.\n';
const identity=file=>{const target=realpathSync.native(file),stat=lstatSync(target,{bigint:true});
  if(stat.isSymbolicLink())fail();return [target,String(stat.dev),String(stat.ino),String(stat.birthtimeNs)];};

/** Existing reference registration -> fixed PSEC protocol probe -> separately confirmed enable. */
export function createConfiguredDesktopF21WorkflowPorts({runtimeModule,mcpModule,codingModule,getApplication,getReferenceHost,
  nativeExecutionHost,getAuthorizationIntentHost,probeRoot,authorizeExport}={}) {
  if(typeof runtimeModule?.createF21WorkflowWorkerPorts!=='function'||typeof mcpModule?.readReadonlyMcpInstallation!=='function'
    ||typeof codingModule?.createWorkspaceCommandTool!=='function'||typeof getApplication!=='function'||typeof getReferenceHost!=='function'
    ||typeof nativeExecutionHost?.createCommandTool!=='function'||typeof nativeExecutionHost.readOriginalF21Probe!=='function'
    ||typeof getAuthorizationIntentHost!=='function'||typeof probeRoot!=='string'||!path.isAbsolute(probeRoot)||typeof authorizeExport!=='function')
    return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:'f21_original_reference_ports_unavailable'};
  const app=()=>getApplication();let ports;
  function source(){
    const reference=getReferenceHost(),configuration=reference?.readF21Configuration(),installation=mcpModule.readReadonlyMcpInstallation();
    if(!configuration?.workspace||!configuration.manifest||configuration.descriptor?.name!=='mcp.workspace.read_text'
      ||configuration.descriptor.version!=='1.0.0'||configuration.descriptor.sideEffect!=='read'
      ||!isDeepStrictEqual(configuration.descriptor.requiredScopes,['mcp:workspace:read'])
      ||!isDeepStrictEqual(configuration.manifest.capabilities,[{toolName:'mcp.workspace.read_text',toolVersion:'1.0.0',sideEffect:'read'}])
      ||!isDeepStrictEqual(app()?.runtime.readToolDescriptors().find(item=>item.name==='mcp.workspace.read_text'&&item.version==='1.0.0'),configuration.descriptor))fail();
    const workspace=configuration.workspace;
    const manifestDigest=hash({skill:configuration.manifest,installation:installation.manifestDigest,descriptor:configuration.descriptor});
    const configurationDigest=hash({workspace,root:identity(workspace.rootPath),node:identity(workspace.nodeExecutable),manifestDigest});
    return {reference,configuration,installation,public:{configurationDigest,manifestDigest,skillId:configuration.manifest.id,
      skillVersion:configuration.manifest.version,toolName:configuration.descriptor.name,toolVersion:configuration.descriptor.version,
      packageVersion:installation.packageVersion,sdkVersion:installation.sdkVersion,transport:'stdio'}};
  }
  function sourceConfiguration(scope){try{const current=source(),enabled=scope&&app().runtime.loadCheckpoint(scope.taskId,'f21:enabled');
    if(enabled){const saved=app().runtime.loadCheckpoint(enabled.localTaskId,'f21:enable'),connection=current.reference.readF21Connection();
      if(!saved||!isDeepStrictEqual(saved.configuration,current.public)||saved.configurationRef!==enabled.result.configurationRef
        ||connection?.configurationRef!==saved.configurationRef||connection.mcp?.connected!==true||connection.skill?.enabled!==true
        ||connection.skill?.connected!==true||connection.skill.id!==current.public.skillId||connection.skill.version!==current.public.skillVersion)fail();
      decision(saved,scope);}
    return current.public;}catch{return undefined;}}
  function bound(scope){
    if(scope.signal.aborted||!Number.isFinite(Date.parse(scope.deadline))||Date.parse(scope.deadline)<=Date.now())fail('CANCELLED');
    const value=app().readConfiguredWorkflowBinding({taskId:scope.parentTaskId,workflowId:'F21',sessionId:scope.sessionId,signal:scope.signal}),current=source();
    if(value?.deadline!==scope.deadline||!isDeepStrictEqual(value.input?.configuration,current.public))fail('REVISION_CONFLICT');
    return {...current,binding:value};
  }
  function commandSource(context){
    const origin=ports.readProbeBinding(context),current=source(),base=path.join(probeRoot,current.public.configurationDigest),root=path.join(base,'workspace');
    const value={...origin,root:realpathSync.native(root),recipeId,configuration:current.public,installation:current.installation,
      workspace:current.configuration.workspace,sampleSha256:bytes(sample),outsideIdentity:identity(path.join(base,'outside.txt'))};
    if(readFileSync(path.join(root,'reference.txt'),'utf8')!==sample||readFileSync(path.join(base,'outside.txt'),'utf8')!=='F21 controlled outside canary\n')fail();
    return value;
  }
  function verifyProbe(receipt,scope){
    const current=bound(scope),runtime=app().runtime,saved=runtime.loadCheckpoint(receipt.taskId,'f21:command-source');
    if(!saved||saved.parentTaskId!==scope.parentTaskId||saved.sessionId!==scope.sessionId||saved.taskId!==receipt.taskId
      ||saved.runId!==receipt.runId||saved.deadline!==scope.deadline||!isDeepStrictEqual(saved.configuration,current.public)
      ||!isDeepStrictEqual(saved.installation,current.installation)||!isDeepStrictEqual(receipt.arguments,{recipeId}))fail();
    const audit=nativeExecutionHost.readOriginalF21Probe({taskId:receipt.taskId,runId:receipt.runId,sourceDigest:hash(saved)});
    const read=app().readHostToolTask(receipt.taskId),result=receipt.result;
    if(!audit||audit.exitCode!==0||read.task.state!=='succeeded'||read.task.cancelRequested||read.confirmed?.runId!==receipt.runId
      ||!isDeepStrictEqual(read.confirmed.result,result)||result?.recipeId!==recipeId||result.exitCode!==0||typeof result.stdout!=='string'
      ||Buffer.byteLength(result.stdout)>65536)fail('RESULT_UNKNOWN','F21 原隔离进程结果需要核实');
    let observation;try{observation=JSON.parse(result.stdout);}catch{fail('PROTOCOL_MISMATCH');}
    if(observation?.version!==1||observation.protocolVersion!=='2025-11-25'||observation.server?.name!=='secure-filesystem-server'
      ||observation.server.version!=='0.2.0'||observation.tool!=='read_text_file'||observation.filesReturned!==1
      ||observation.sampleSha256!==bytes(sample)||observation.osReadDenied!==true||observation.osWriteDenied!==true
      ||!/^[a-f0-9]{64}$/.test(observation.directoryDigest))fail('PROTOCOL_MISMATCH');
    return {protocolVersion:observation.protocolVersion,filesReturned:1,directoryDigest:observation.directoryDigest,
      sampleSha256:observation.sampleSha256,backend:'windows-psec',enforced:true,stopped:true,auditDigest:audit.auditDigest};
  }
  function decision(value,scope){
    const ref=value?.decision;
    if(!ref||ref.action!=='workflow.enable'||ref.deadline!==scope.deadline||ref.payloadDigest!==hash(value.payload)||ref.scopeDigest!==hash(value.scope))fail();
    const read=app().readHostToolTask(ref.taskId),original=app().readAuthorizationQuestionInvocation(ref.taskId,ref.runId,true);
    if(read?.commandId!==ref.commandId||read.toolName!=='desktop.authorization.intent'||read.toolVersion!=='1.0.0'
      ||read.task.state!=='succeeded'||read.task.cancelRequested||read.confirmed?.runId!==ref.runId||!read.confirmed.evidenceRefs.includes(ref.runId)
      ||!isDeepStrictEqual(read.confirmed.result,{decisionRecorded:true})||original?.deadline!==scope.deadline
      ||!isDeepStrictEqual(original.arguments,{action:ref.action,payloadDigest:ref.payloadDigest,scopeDigest:ref.scopeDigest}))fail();
  }
  function readEnabled(scope){
    try{const current=bound(scope),saved=app().runtime.loadCheckpoint(scope.localTaskId,'f21:enable'),connection=current.reference.readF21Connection();
      const payload={capability:'workspace-reference',configuration:current.public,probe:ports.readVerifiedProbe(scope),permissions:['mcp:workspace:read'],enableMcp:true,enableSkill:true};
      if(!saved||!isDeepStrictEqual(saved.configuration,current.public)||saved.scope.parentTaskId!==scope.parentTaskId
        ||saved.scope.sessionId!==scope.sessionId||saved.scope.hostTaskId!==scope.localTaskId||saved.scope.operationId!==scope.operationId
        ||saved.scope.deadline!==scope.deadline||saved.scope.configurationDigest!==current.binding.configurationDigest||!isDeepStrictEqual(saved.payload,payload)
        ||!saved.configurationRef||connection?.configurationRef!==saved.configurationRef
        ||connection.mcp?.connected!==true||connection.skill?.enabled!==true||connection.skill?.connected!==true
        ||connection.skill.id!==current.public.skillId||connection.skill.version!==current.public.skillVersion)return;
      decision(saved,scope);return {availableInWorkflow:true,toolId:current.public.toolName,skillId:current.public.skillId,
        manifestDigest:current.public.manifestDigest,configurationRef:saved.configurationRef};
    }catch{return undefined;}
  }
  async function enable(scope,context){
    const runtime=app().runtime,previous=runtime.loadCheckpoint(scope.localTaskId,'f21:enable');
    if(previous){const result=readEnabled(scope);if(result)return result;fail('RESULT_UNKNOWN','原启用操作仅可核实，不会重新连接或启用');}
    const initial=bound(scope),invocation=app().readAuthorizationQuestionInvocation(context.taskId,context.runId);
    if(invocation?.toolName!=='workflow.host.f21_n05'||invocation.deadline!==scope.deadline||!isDeepStrictEqual(invocation.arguments,{}))fail();
    const payload={capability:'workspace-reference',configuration:initial.public,probe:ports.readVerifiedProbe(scope),permissions:['mcp:workspace:read'],enableMcp:true,enableSkill:true};
    const binding={parentTaskId:scope.parentTaskId,sessionId:scope.sessionId,hostTaskId:scope.localTaskId,operationId:scope.operationId,
      deadline:scope.deadline,configurationDigest:initial.binding.configurationDigest};
    const isCurrent=()=>{try{const current=bound(scope);return current.reference===initial.reference&&isDeepStrictEqual(current.public,initial.public)
      &&isDeepStrictEqual(payload.probe,ports.readVerifiedProbe(scope));}catch{return false;}};
    let confirmed;
    const allowed=await getAuthorizationIntentHost()?.request({action:'workflow.enable',payload,scope:binding,deadline:scope.deadline,signal:scope.signal,isCurrent,
      summary:'启用已实际隔离验证的固定只读 filesystem MCP 与参考 Skill；仅使用当前许可工作区。后续每次读取和内容出机仍需原任务授权。',
      onConfirmed:ref=>{confirmed={configuration:initial.public,payload,scope:binding,decision:ref};decision(confirmed,scope);}});
    if(allowed!==true||!confirmed||!isCurrent())fail('SCOPE_DENIED','未确认启用原参考能力');
    const store=runtime.bindTrustedHostState('f21-reference-enable:v1'),prior=store.get('workspace-reference');
    if(prior){const read=app().readHostToolTask(prior.taskId);
      if(read.task.state!=='succeeded'||!read.confirmed)fail('RESULT_UNKNOWN','原 F21 启用仅可核实，未重新连接');}
    if(!store.compareAndSet('workspace-reference',prior,{taskId:scope.localTaskId,configuration:initial.public}))fail('RESULT_UNKNOWN');
    runtime.saveCheckpointOnce(scope.localTaskId,'f21:enable',confirmed);
    if(!isDeepStrictEqual(runtime.loadCheckpoint(scope.localTaskId,'f21:enable'),confirmed))fail('RESULT_UNKNOWN');
    const record=configurationRef=>{if(!isCurrent()||typeof configurationRef!=='string'||!configurationRef)fail();
      confirmed={...confirmed,configurationRef};runtime.saveCheckpoint(scope.localTaskId,'f21:enable',confirmed);};
    const existing=initial.reference.readF21Connection();
    if(existing?.mcp?.connected)record(existing.configurationRef);
    else await initial.reference.setMcpEnabled(true,{signal:scope.signal,deadline:scope.deadline,assertCurrent:isCurrent,onBound:value=>record(value.configurationRef)});
    if(!isCurrent())fail('RESULT_UNKNOWN');initial.reference.setSkillEnabled(true);
    const result=readEnabled(scope);if(!result)fail('RESULT_UNKNOWN');
    runtime.saveCheckpointOnce(scope.parentTaskId,'f21:enabled',{localTaskId:scope.localTaskId,result});return result;
  }
  ports=runtimeModule.createF21WorkflowWorkerPorts({getApplication,sourceConfiguration,verifyProbe,enable,readEnabled,authorizeExport});
  const command={descriptor:{name:commandName,version:'1.0.0',inputSchema:{type:'object',additionalProperties:false,required:['recipeId'],properties:{recipeId:{const:recipeId}}},
    outputSchema:{type:'object',additionalProperties:false,required:['recipeId','exitCode','stdout','stderr'],properties:{recipeId:{const:recipeId},exitCode:{type:'integer'},stdout:{type:'string'},stderr:{type:'string'}}},
    sideEffect:'local_write',requiredScopes:['workspace:execute'],idempotencySupport:false,recoverySupport:false,requiresPresence:false},
    async execute(args,context){
      if(!isDeepStrictEqual(args,{recipeId}))fail();const origin=ports.readProbeBinding(context),current=source();
      const beforeF21Probe=()=>{
        const store=app().runtime.bindTrustedHostState('f21-reference-probe:v1'),key='workspace-reference',prior=store.get(key);
        // Claim after original native permission/profile checks, before any process starts.
        if(prior){const read=app().readHostToolTask(prior.taskId);
          if(read.task.state!=='succeeded'||!read.confirmed||prior.taskId===context.taskId)fail('RESULT_UNKNOWN','原 F21 探测仅可核实，未重新执行');}
        if(!store.compareAndSet(key,prior,{taskId:context.taskId,runId:context.runId,parentTaskId:origin.parentTaskId,configuration:current.public}))fail('RESULT_UNKNOWN');
      };
      const base=path.join(probeRoot,current.public.configurationDigest),root=path.join(base,'workspace');mkdirSync(root,{recursive:true});
      if(identity(root)[0]!==path.resolve(root)||identity(base)[0]!==path.resolve(base))fail();
      for(const [file,value] of [[path.join(root,'reference.txt'),sample],[path.join(base,'outside.txt'),'F21 controlled outside canary\n']]){
        try{writeFileSync(file,value,{flag:'wx'});}catch(error){if(error.code!=='EEXIST'||lstatSync(file).isSymbolicLink()||readFileSync(file,'utf8')!==value)throw error;}}
      const original=commandSource(context);app().runtime.saveCheckpointOnce(context.taskId,'f21:command-source',original);
      if(!isDeepStrictEqual(app().runtime.loadCheckpoint(context.taskId,'f21:command-source'),original))fail('RESULT_UNKNOWN');
      const installation=current.installation,tool=nativeExecutionHost.createCommandTool({rootPath:root,
        recipes:[{id:recipeId,executable:current.configuration.workspace.nodeExecutable,args:['--preserve-symlinks','--preserve-symlinks-main',installation.probePath,installation.entryPath,root,path.join(base,'outside.txt')]}],
        trustedReadRoots:[path.dirname(installation.probePath),path.resolve(installation.packageRoot,'../..')],readF21Binding:commandSource,beforeF21Probe});
      return tool.execute(args,context);
    }};
  return {tools:[...ports.tools,command],configuredWorkflowWorkerPorts:ports.configuredWorkflowWorkerPorts,unavailable:ports.unavailable};
}

import {createHash} from 'node:crypto';
import {execFile,execFileSync} from 'node:child_process';
import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import path from 'node:path';
import {isDeepStrictEqual,promisify} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {readAgentArtsDeployment} from './agentarts-deployment-readback.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),bytes=value=>createHash('sha256').update(value).digest('hex');
const fail=(code='UNAUTHORIZED',message='F26 原源码、发布绑定或真实回执不可用')=>{throw new ProtocolError(code,message);};
const recipeId='f26-owned-image-release',commandName='workspace.f26_release';
const sourcePaths=['package.json','package-lock.json','tsconfig.base.json','packages/contracts','packages/coordination','packages/models','packages/agentarts','apps/agentarts-runtime','scripts/agentarts/release-owned-image.ps1'];
const identity=file=>{const real=realpathSync.native(file),stat=lstatSync(file,{bigint:true});if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1n)fail();
  return [real,String(stat.dev),String(stat.ino),String(stat.size),String(stat.mtimeNs),String(stat.ctimeNs)];};

/** Resolve a tag's top-level digest; verify the actual ARM64 config through an immutable reference. */
export async function readF26RegistryImageReference({imageReference,repository,dockerPath,root,deadline,signal,assertCurrent,execFileImpl=promisify(execFile)}){
  assertCurrent();
  if(!imageReference.startsWith(repository+':')||!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/u.test(imageReference.slice(repository.length+1)))fail();
  const inspect=async(reference,field)=>{
    let result;try{const {stdout}=await execFileImpl(dockerPath,['buildx','imagetools','inspect',reference,'--format','{{json .'+field+'}}'],
      {cwd:root,windowsHide:true,encoding:'utf8',timeout:Math.min(30000,Date.parse(deadline)-Date.now()),signal,maxBuffer:1024*1024});result=JSON.parse(stdout);}
    catch{assertCurrent();fail('EXTERNAL_FAILURE','SWR 原镜像标签摘要或平台读取失败');}
    assertCurrent();return result;
  };
  const manifest=await inspect(imageReference,'Manifest');
  if(!/^sha256:[a-f0-9]{64}$/u.test(manifest?.digest))fail('PROTOCOL_MISMATCH');
  let platformDigest=manifest.digest;
  if(manifest.manifests!==undefined){
    if(!Array.isArray(manifest.manifests))fail('PROTOCOL_MISMATCH');
    const arm64=manifest.manifests.filter(item=>item?.platform?.os==='linux'&&item?.platform?.architecture==='arm64');
    if(arm64.length!==1||!/^sha256:[a-f0-9]{64}$/u.test(arm64[0].digest))fail('PROTOCOL_MISMATCH');
    platformDigest=arm64[0].digest;
  }
  const platform=await inspect(repository+'@'+platformDigest,'Image');
  if(platform?.os!=='linux'||platform?.architecture!=='arm64')fail('PROTOCOL_MISMATCH','SWR 原镜像必须为 linux/arm64');
  return repository+'@'+manifest.digest;
}

/** Original repository release script + original selected AgentArts configuration. No new installer or publisher. */
export function createConfiguredDesktopF26WorkflowPorts({runtimeModule,codingModule,getApplication,agentArtsConfig,getAgentArtsModels,nativeExecutionHost,
  repositoryRoot,nodeExecutable,powerShellPath,dockerPath,gitPath,npmCli,authorizeDeployment,toolExports,prepareCompetitionToolExport,authorizeExport}={}){
  if(typeof runtimeModule?.createF26WorkflowWorkerPorts!=='function'||typeof codingModule?.createWorkspaceCommandTool!=='function'
    ||typeof getApplication!=='function'||typeof agentArtsConfig?.readReleaseBinding!=='function'||typeof getAgentArtsModels!=='function'
    ||typeof nativeExecutionHost?.createCommandTool!=='function'||typeof nativeExecutionHost.readOriginalF26Release!=='function'
    ||typeof authorizeDeployment!=='function'||typeof authorizeExport!=='function'||typeof prepareCompetitionToolExport!=='function'||!Array.isArray(toolExports)
    ||typeof repositoryRoot!=='string'||!path.isAbsolute(repositoryRoot))return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:'f26_original_release_sources_unavailable'};
  let root,executables;try{root=realpathSync.native(repositoryRoot);
    if(root!==realpathSync.native(fileURLToPath(new URL('../../../',import.meta.url))))fail();
    executables=[nodeExecutable,powerShellPath,dockerPath,gitPath,npmCli].map(file=>{if(typeof file!=='string'||!path.isAbsolute(file))fail();return identity(file);});
  }catch{return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:'f26_development_source_and_fixed_toolchain_required'};}
  const script=path.join(root,'scripts/agentarts/release-owned-image.ps1'),app=()=>getApplication();let ports;
  const git=args=>execFileSync(gitPath,args,{cwd:root,windowsHide:true,encoding:'utf8',timeout:5000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']}).trim();
  function source(){
    const release=agentArtsConfig.readReleaseBinding(),models=getAgentArtsModels(),catalog=models?.snapshot().catalog,model=models?.readExecutionModel();
    if(!release||!catalog||!model||model.catalogRevision!==catalog.revision||agentArtsConfig.snapshot().configured!==true)fail('UNSUPPORTED_CAPABILITY');
    if([nodeExecutable,powerShellPath,dockerPath,gitPath,npmCli].some((file,index)=>!isDeepStrictEqual(identity(file),executables[index])))fail();
    const sourceRevision=git(['rev-parse','HEAD']);if(!/^[a-f0-9]{40}$/.test(sourceRevision)||git(['status','--porcelain','--untracked-files=all','--',...sourcePaths]))fail('REVISION_CONFLICT','F26 构建源码必须为当前未改动提交');
    const scriptDigest=bytes(readFileSync(script)),sourceDigest=hash({sourceRevision,tree:git(['ls-tree','-r','HEAD','--',...sourcePaths]),scriptDigest,
      lock:bytes(readFileSync(path.join(root,'package-lock.json'))),executables});
    const repository=release.registryRepository,
      registryReference=repository+':f26-'+sourceRevision.slice(0,16),imageTag='personal-agent:f26-'+sourceRevision.slice(0,16);
    const configuration={sourceRevision,sourceDigest,scriptDigest,imageTag,registryReference,...(release.imageReference?{imageReference:release.imageReference}:{}),runtimeId:release.runtimeId,
      runtimeName:release.runtimeName,endpointId:release.endpointId,endpointName:release.endpointName,version:release.version,model};
    return {release,configuration:{...configuration,configurationDigest:hash({configuration,configurationRef:release.configurationRef,gatewayUrl:release.gatewayUrl})}};
  }
  function sourceConfiguration(){try{return source().configuration;}catch{return undefined;}}
  function bound(scope){const current=source(),binding=app().readConfiguredWorkflowBinding({taskId:scope.parentTaskId,workflowId:'F26',sessionId:scope.sessionId,signal:scope.signal});
    if(scope.signal.aborted||Date.parse(scope.deadline)<=Date.now()||binding?.deadline!==scope.deadline||!isDeepStrictEqual(binding.input?.configuration,current.configuration))fail();return current;}
  function commandSource(context){const origin=ports.readBuildBinding(context),current=source(),output=path.join(root,'.cache','f26-release',context.taskId);
    return {...origin,root,recipeId,configuration:current.configuration,output};}
  function verifyBuild(receipt,scope){const current=bound(scope),saved=app().runtime.loadCheckpoint(receipt.taskId,'f26:command-source');
    if(!saved||saved.parentTaskId!==scope.parentTaskId||saved.sessionId!==scope.sessionId||saved.taskId!==receipt.taskId||saved.runId!==receipt.runId
      ||saved.deadline!==scope.deadline||!isDeepStrictEqual(saved.configuration,current.configuration)||!isDeepStrictEqual(receipt.arguments,{recipeId}))fail();
    const audit=nativeExecutionHost.readOriginalF26Release({taskId:receipt.taskId,runId:receipt.runId,sourceDigest:hash(saved)}),read=app().readHostToolTask(receipt.taskId);
    if(!audit||audit.exitCode!==0||read.task.state!=='succeeded'||read.task.cancelRequested||read.confirmed?.runId!==receipt.runId||!isDeepStrictEqual(read.confirmed.result,receipt.result)
      ||receipt.result?.exitCode!==0)fail('RESULT_UNKNOWN','F26 原发布进程需核实，未再次构建或推送');
    const receiptFile=path.join(saved.output,'release.json'),before=identity(receiptFile),content=readFileSync(receiptFile);if(content.length>65536||!isDeepStrictEqual(before,identity(receiptFile)))fail();
    let release;try{release=JSON.parse(content.toString('utf8').replace(/^\uFEFF/,''));}catch{fail('PROTOCOL_MISMATCH');}
    if(release.schemaVersion!==1||release.image!==current.configuration.imageTag||release.sourceRevision!==current.configuration.sourceRevision
      ||release.architecture!=='arm64'||release.built!==true||release.published!==true||release.remoteReadbackVerified!==true
      ||release.registryReference!==current.configuration.registryReference||!/^sha256:[a-f0-9]{64}$/.test(release.registryManifestDigest)
      ||current.configuration.imageReference!==undefined&&current.configuration.imageReference!==current.release.registryRepository+'@'+release.registryManifestDigest
      ||!Number.isFinite(release.imageSizeBytes)||release.imageSizeBytes<=0||!Array.isArray(release.stages)
      ||['build','tag','push','remote-inspect','remote-platform'].some(stage=>release.stages.filter(item=>item.stage===stage&&item.exitCode===0).length!==1))fail('REVISION_CONFLICT','F26 原构建/SWR摘要未匹配所选部署');
    return {sourceRevision:release.sourceRevision,imageId:release.imageId,imageReference:current.release.registryRepository+'@'+release.registryManifestDigest,imageSizeMb:release.imageSizeBytes/1048576,
      buildDurationSeconds:release.stages.find(stage=>stage.stage==='build').wallMs/1000,architecture:'arm64',published:true,remoteReadbackVerified:true,
      nativeMode:'full-access',auditDigest:audit.auditDigest,releaseDigest:bytes(content)};
  }
  async function readDeployment(scope,build){const expected=bound(scope),assertCurrent=()=>{if(!isDeepStrictEqual(bound(scope),expected))fail();};
    const resolveImageReference=request=>readF26RegistryImageReference({...request,repository:expected.release.registryRepository,dockerPath,root,assertCurrent});
    const args={...expected.release,imageReference:build.imageReference,deadline:scope.deadline,signal:scope.signal,authorize:authorizeDeployment,assertCurrent,resolveImageReference};
    const control=await readAgentArtsDeployment(args);assertCurrent();if(!control.runtimeReady)fail('UNSUPPORTED_CAPABILITY');
    // This is an actual authenticated invocation on the same pinned transport, not a cached catalog or Kubernetes claim.
    const result=await getAgentArtsModels().refresh({deadline:scope.deadline,signal:scope.signal});assertCurrent();
    if(result.catalog?.revision!==expected.configuration.model.catalogRevision)fail('REVISION_CONFLICT');
    if(!isDeepStrictEqual(control,await readAgentArtsDeployment(args)))fail('REVISION_CONFLICT');assertCurrent();
    return {podRunning:true,readinessProbe:true,readinessKind:'authenticated_model_catalog_invocation',kubernetesPodInspection:'unverified',
      controlDigest:control.digest,modelCatalogRevision:result.catalog.revision,imageReference:build.imageReference,version:expected.release.version};
  }
  ports=runtimeModule.createF26WorkflowWorkerPorts({getApplication,sourceConfiguration,verifyBuild,readDeployment,toolExports,prepareCompetitionToolExport,authorizeExport});
  const command={descriptor:{name:commandName,version:'1.0.0',inputSchema:{type:'object',additionalProperties:false,required:['recipeId'],properties:{recipeId:{const:recipeId}}},
    outputSchema:{type:'object'},sideEffect:'external_write',requiredScopes:['workspace:execute'],idempotencySupport:false,recoverySupport:false,requiresPresence:false},
    async execute(args,context){if(!isDeepStrictEqual(args,{recipeId}))fail();const initial=commandSource(context);
      app().runtime.saveCheckpointOnce(context.taskId,'f26:command-source',initial);if(!isDeepStrictEqual(app().runtime.loadCheckpoint(context.taskId,'f26:command-source'),initial))fail('RESULT_UNKNOWN');
      const beforeF26Release=()=>{if(!isDeepStrictEqual(commandSource(context),initial))fail();
        const store=app().runtime.bindTrustedHostState('f26-release:v1'),key=hash({root,sourceRevision:initial.configuration.sourceRevision,registryReference:initial.configuration.registryReference}),prior=store.get(key);
        if(prior){const read=app().readHostToolTask(prior.taskId);if(read.task.state!=='succeeded'||!read.confirmed||prior.taskId===context.taskId)fail('RESULT_UNKNOWN','原 F26 发布结果未知，禁止重新构建或推送');}
        if(!store.compareAndSet(key,prior,{taskId:context.taskId,runId:context.runId,sourceDigest:hash(initial)}))fail('RESULT_UNKNOWN');};
      const env={USERPROFILE:homedir(),Path:[path.dirname(nodeExecutable),path.dirname(gitPath),path.dirname(powerShellPath),path.dirname(dockerPath),path.dirname(npmCli),process.env.SystemRoot+'\\System32',process.env.SystemRoot].join(';')};
      const tool=nativeExecutionHost.createCommandTool({rootPath:root,maxDurationMs:120000,maxOutputBytes:65536,env,
        readF26Binding:commandSource,beforeF26Release,recipes:[{id:recipeId,executable:powerShellPath,args:['-NoLogo','-NoProfile','-NonInteractive','-File',script,
          '-Image',initial.configuration.imageTag,'-RegistryReference',initial.configuration.registryReference,'-ExpectedSourceRevision',initial.configuration.sourceRevision,
          '-Build','-Push','-DockerPath',dockerPath,'-NodePath',nodeExecutable,'-OutputDirectory',initial.output]}]});
      return tool.execute(args,context);}};
  return {tools:[...ports.tools,command],configuredWorkflowWorkerPorts:ports.configuredWorkflowWorkerPorts,unavailable:ports.unavailable};
}

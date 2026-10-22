import {existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
import {PROTOCOL_VERSION, ProtocolError, validateToolValue} from '@personal-agent/contracts';
import * as coding from '@personal-agent/coding-tools';
import {harnessCandidateRecipeFingerprint,parseHarnessCandidateBinding} from '@personal-agent/contracts/harness-candidates';
import {readRuntimeCodingVerificationEvidence} from '@personal-agent/runtime/application';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createWorkflowDecisionTool} from '@personal-agent/agentarts';
import {createDesktopCodingToolHost} from './coding-tool-host.js';
import {findWindowsExecutable} from './windows-executable-discovery.js';
import {codingRepairExportOperation,projectCodingRepairResult} from './coding-repair-result-export.js';
import {workspaceRepairProjectionSchema,workspaceWorkflowSummaryProjectionSchema} from './workspace-result-projection.js';

function directory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.startsWith('\\\\')
    || lstatSync(value).isSymbolicLink()) throw Error('请选择本机普通目录');
  const root = realpathSync.native(value);
  if (!statSync(root).isDirectory() || root === path.parse(root).root) throw Error('不能将整个磁盘作为编程工作区');
  return root;
}
function fixedNode(value, root) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.startsWith('\\\\')
    || lstatSync(value).isSymbolicLink()) throw Error('请选择本机 Node 可执行文件');
  const executable=realpathSync.native(value);
  if (!statSync(executable).isFile() || path.basename(executable).toLowerCase()
    !== (process.platform==='win32'?'node.exe':'node')) {
    throw Error('请选择 Node 可执行文件');
  }
  const relative=path.relative(root,executable);
  if (relative==='' || (relative!=='..' && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative))) throw Error('Node 可执行文件必须位于工作区外');
  return executable;
}
function outsideFile(value,root,name) {
  if(typeof value!=='string' || !path.isAbsolute(value) || value.startsWith('\\\\')
    || lstatSync(value).isSymbolicLink()) throw Error(`请选择本机${name}文件`);
  const file=realpathSync.native(value);
  if(!statSync(file).isFile()) throw Error(`请选择本机${name}普通文件`);
  const relative=path.relative(root,file);
  if(relative==='' || (relative!=='..' && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative))) throw Error(`${name}文件必须位于工作区外`);
  return file;
}
function fixedNpmCli(value,root) {
  const file=outsideFile(value,root,'npm');
  if(path.basename(file).toLowerCase()!=='npm-cli.js') throw Error('请选择 npm-cli.js');
  return file;
}
function derivedNpmCli(node,root) {
  try {return fixedNpmCli(path.join(path.dirname(node),'node_modules','npm','bin','npm-cli.js'),root);}
  catch {return undefined;}
}
function checkFile(value, root) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.startsWith('\\\\')
    || lstatSync(value).isSymbolicLink()) throw Error('请选择工作区内普通文件');
  const target=realpathSync.native(value);
  if (!statSync(target).isFile() || !/\.(?:c?js|mjs)$/i.test(target)) throw Error('请选择工作区内 JavaScript 文件');
  const relative=path.relative(root,target);
  if (!relative || relative==='..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw Error('检查文件必须位于选定工作区内');
  }
  return relative.split(path.sep).join('/');
}
function recoveryPath(userData,root) {
  return path.join(userData,'coding-recovery',createHash('sha256').update(root).digest('hex'));
}
function recoveryDirectory(userData, root, powerShell) {
  const target = recoveryPath(userData,root);
  if (!existsSync(target)) {
    mkdirSync(target, {recursive:true});
    const script = String.raw`$ErrorActionPreference='Stop'
$target=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(target,'utf8').toString('base64')}'))
$self=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=[System.Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($self)
$acl.SetAccessRuleProtection($true,$false)
$rule=[System.Security.AccessControl.FileSystemAccessRule]::new($self,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $target -AclObject $acl`;
    execFileSync(powerShell, ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',
      Buffer.from(script,'utf16le').toString('base64')],
    {encoding:'utf8',windowsHide:true,timeout:10000,stdio:['pipe','pipe','pipe']});
  }
  return target;
}

/** Persist only a selected directory. Execution/export consent expires with this process.
 * Registered implementations stay pinned until restart; changing settings revokes them first.
 */
export function createWorkspaceConfigHost({userData,safeStorage,selectDirectory,
  selectNodeExecutable,selectCheckFile,selectNpmCli,jobHelperExecutable,patchHelperScriptPath,
  projectScriptEnvSource,createCommandRecipeTool,createWorkspaceCommandTool,createWorkspaceReferenceExport,question,
  readWorkspaceExportPreflight,readWorkspaceExportAuthorization,
  requestWorkspaceExportPreflight,requestWorkspaceExportExact,readHarnessVersions,
  // Main-only injection supports offline discovery fixtures; never accepted from Renderer.
  findExecutable=findWindowsExecutable}) {
  const file = path.join(userData,'coding-workspace.json');
  let savedRoot,savedNode,savedCheckFile,savedNpmCli,boundRoot,boundNode,boundCheckFile,boundNpmCli,boundProjectHelper,rootIdentity,nodeIdentity,application,active=true,consent,applyHost,failure='',commandFailure='',projectFailure='';
  let generation=randomUUID();
  const implementations=[];
  const commandReadiness=new Map();
  const inflight=new Set();
  const workspaceExportProposals=new Map();
  const confirmedWorkspaceReads=new Map();
  let workspaceReferenceExport;
  let boundRepairPowerShell,repairHostPromise,harnessHostPromise,developerCommand;
  let dependencyFingerprint,dependencyPreparationReason,dependencyPreparation,dependencySeeded=false,authorizationFailure=false;
  const commandFactory=typeof createWorkspaceCommandTool==='function'?createWorkspaceCommandTool
    :question?undefined:coding.createWorkspaceCommandTool;
  const nodeFlags=question?['--preserve-symlinks','--preserve-symlinks-main']:[];
  const prepared=new Map(),resources=new Set();
  const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const questionReady=()=>active&&!authorizationFailure&&Boolean(application)&&['prepare','prepareExport','currentRequirement','authorizeExport',
    'readResourceGeneration','rotateResourceGeneration'].every(name=>typeof question?.[name]==='function');
  try {
    if (existsSync(file)) {
      if (!safeStorage.isEncryptionAvailable()) throw Error();
      const record=JSON.parse(readFileSync(file,'utf8'));
      if (record.version!==1 || typeof record.encrypted!=='string') throw Error();
      savedRoot=directory(safeStorage.decryptString(Buffer.from(record.encrypted,'base64')));
      try {
        if(record.encryptedNode!==undefined) {
          if(typeof record.encryptedNode!=='string') throw Error();
          savedNode=fixedNode(safeStorage.decryptString(Buffer.from(record.encryptedNode,'base64')),savedRoot);
        }
        if(record.encryptedCheckFile!==undefined) {
          if(typeof record.encryptedCheckFile!=='string') throw Error();
          const selected=safeStorage.decryptString(Buffer.from(record.encryptedCheckFile,'base64'));
          if(typeof selected!=='string' || path.isAbsolute(selected) || selected.startsWith('..')) throw Error();
          savedCheckFile=checkFile(path.resolve(savedRoot,selected),savedRoot);
        }
      } catch {commandFailure='Node 检查配置已失效，请重新选择可执行文件或工作区文件';}
      try {
        if(record.encryptedNpmCli!==undefined) {
          if(typeof record.encryptedNpmCli!=='string') throw Error();
          savedNpmCli=fixedNpmCli(safeStorage.decryptString(Buffer.from(record.encryptedNpmCli,'base64')),savedRoot);
        } else if(savedNode) savedNpmCli=derivedNpmCli(savedNode,savedRoot);
      } catch {projectFailure='项目命令配置已失效，请重新选择 npm 文件';}
    }
  } catch {failure='工作区加密配置不可用，请重新选择目录';}
  if (savedRoot) {
    try {
      boundRoot=savedRoot;boundCheckFile=savedCheckFile;boundNpmCli=savedNpmCli;
      rootIdentity=statSync(boundRoot,{bigint:true});
      try {
        if(savedNode) {boundNode=fixedNode(savedNode,boundRoot);nodeIdentity=statSync(boundNode,{bigint:true});}
      } catch {boundNode=undefined;nodeIdentity=undefined;}
      const options={rootPath:boundRoot};
      implementations.push(coding.createWorkspaceReadTool(options), coding.createWorkspaceListTool({rootPath:boundRoot}),
        coding.createWorkspacePatchPreviewTool(options),coding.createWorkspacePatchStageTool(options));
      const discovery={excludedDirectories:[boundRoot,recoveryPath(userData,boundRoot)]};
      let helper;
      if(jobHelperExecutable) {
        try {
          helper=outsideFile(jobHelperExecutable,boundRoot,'项目命令');
          if(path.basename(helper).toLowerCase()!=='windowsjobprocesshost.exe') throw Error();
          boundProjectHelper=helper;
        } catch {projectFailure='项目命令所需的本机组件不可用';}
      }
      const pwsh=findExecutable('pwsh.exe',discovery);
      if (pwsh) {
        boundRepairPowerShell=pwsh;
        try {
          applyHost=createDesktopCodingToolHost({workspaceRoot:boundRoot,authorizedWorkspaceRoot:boundRoot,
            recoveryRootPath:recoveryDirectory(userData,boundRoot,pwsh),powerShellPath:pwsh,
            ...(helper===undefined?{}:{processIdentityHelperPath:helper}),
            ...(patchHelperScriptPath===undefined?{}:{helperScriptPath:patchHelperScriptPath}),
            createWorkspacePatchApplyTool:coding.createWorkspacePatchApplyTool,
            reconcileWorkspacePatchApply:coding.reconcileWorkspacePatchApply});
          implementations.push(...applyHost.tools);
        } catch {failure='读取和候选生成可用；安全应用补丁所需的目录或 PowerShell 检查未通过';}
      } else failure='读取和候选生成可用；安全应用补丁需要 PowerShell 7';
      const git=findExecutable('git.exe',discovery);
      if (git && commandFactory) {
        const command=commandFactory({rootPath:boundRoot,recipes:[{id:'git-diff-check',
          executable:git,args:['--no-pager','-c','core.fsmonitor=false','diff','--no-ext-diff','--no-textconv','--check']}],
          maxOutputBytes:4096,maxDurationMs:30000});
        implementations.push({descriptor:{...command.descriptor,name:'workspace.git_diff_check',
          inputSchema:{type:'object',properties:{},additionalProperties:false}},
          execute:(_input,context) => command.execute({recipeId:'git-diff-check'},context)});
      }
      const projectRequested=Boolean(helper && savedNpmCli);
      if (savedNode && (savedCheckFile || projectRequested) && typeof createCommandRecipeTool==='function' && commandFactory) {
        try {
          const commandImplementations=[];
          const options={workspaceRoot:boundRoot,authorizedWorkspaceRoot:boundRoot,
            nodeExecutable:savedNode,checkFiles:[{id:'node-check',path:savedCheckFile}],
            allowProjectScripts:projectRequested,jobHelperExecutable:helper,npmCliPath:savedNpmCli,
            projectScriptEnvSource,createWorkspaceCommandTool:commandFactory,nativeNodeResolution:Boolean(question),
            maxOutputBytes:4096,maxDurationMs:30000,required:false};
          if(!savedCheckFile) options.checkFiles=[];
          let recipe;
          try {recipe=createCommandRecipeTool(options);}
          catch (error) {
            if(!projectRequested) throw error;
            projectFailure='项目命令暂不可用；Node 语法检查仍可用';
            recipe=createCommandRecipeTool({...options,allowProjectScripts:false});
          }
          if (!recipe?.tool || !Array.isArray(recipe.recipes)
            || recipe.tool.descriptor.name!=='workspace.run_allowed_command'
            || recipe.tool.descriptor.sideEffect!=='local_write'
            || recipe.tool.descriptor.requiredScopes?.length!==1
            || recipe.tool.descriptor.requiredScopes[0]!=='workspace:execute') throw Error();
          const nodeRecipe=recipe.recipes.find(item=>item.id==='node-check');
          if(savedCheckFile) {
            if(!nodeRecipe || nodeRecipe.executable!==savedNode
              || !isDeepStrictEqual(nodeRecipe.args,[...nodeFlags,'--check',savedCheckFile])) throw Error();
            commandImplementations.push({descriptor:{...recipe.tool.descriptor,name:'workspace.node_check',
              inputSchema:{type:'object',properties:{},additionalProperties:false}},
              execute:(_input,context)=>recipe.tool.execute({recipeId:'node-check'},context)});
          }
          if(projectRequested && recipe.diagnostics?.projectScriptsExposed===true) {
            for(const [id,name,script] of [['npm-build','workspace.npm_build','build'],
              ['npm-test','workspace.npm_test','test']]) {
              const fixed=recipe.recipes.find(item=>item.id===id);
              if(!fixed) continue;
              const npmArgs=['--cwd',boundRoot,'--exe',savedNode,'--',...nodeFlags,savedNpmCli,'run',script];
              const nodeTestArgs=['--cwd',boundRoot,'--exe',savedNode,'--',...nodeFlags,'--test'];
              if(fixed.executable!==helper || !Array.isArray(fixed.args)
                || !isDeepStrictEqual(fixed.args,npmArgs)
                  && !(script==='test' && isDeepStrictEqual(fixed.args,nodeTestArgs))) throw Error();
              commandImplementations.push({descriptor:{...recipe.tool.descriptor,name,
                inputSchema:{type:'object',properties:{},additionalProperties:false}},
                execute:(_input,context)=>recipe.tool.execute({recipeId:id},context)});
            }
          }
          if(projectRequested && !commandImplementations.some(item=>item.descriptor.name.startsWith('workspace.npm_'))
            && !projectFailure) projectFailure='工作区构建或测试命令暂不可用';
          if(typeof recipe.available==='function') {
            for(const command of commandImplementations) {
              commandReadiness.set(command.descriptor.name,()=>recipe.available());
            }
          }
          implementations.push(...commandImplementations);
          developerCommand={descriptor:recipe.tool.descriptor,recipeIds:recipe.recipes.map(item=>item.id)};
        } catch {commandFailure='Node 检查装配失败；读取和其他已配置能力仍可用';}
      } else if (savedNode && (savedCheckFile || projectRequested)) commandFailure='命令实现尚未接入；读取和其他已配置能力仍可用';
      if(savedNpmCli && !projectRequested && !projectFailure) projectFailure='项目构建与测试尚未准备好';
    } catch {implementations.length=0; failure='选定工作区无法安全装配，请重新选择目录';}
  }
  const resolveRepairTask=taskId=>{
    const parent=application?.runtime.loadCheckpoint(taskId,'coding-repair:parent');
    return typeof parent?.taskId==='string'?parent.taskId:taskId;
  };
  const repairRecipes=()=>[...(boundCheckFile?[{recipeId:'node-check',packageIds:[],required:true}]:[]),
    ...(boundNpmCli&&developerCommand?.recipeIds.includes('npm-build')?[{recipeId:'npm-build',packageIds:[],required:true}]:[]),
    ...(boundNpmCli?[{recipeId:'npm-test',packageIds:[],required:true}]:[])];
  const getRepairHost=async(harness=false,context)=>{
    if(question&&context)await prepareDependencies(context);
    if(dependencyPreparation)await dependencyPreparation;
    if(!application || !boundRoot || !boundRepairPowerShell || !boundNode || (boundNpmCli&&!boundProjectHelper)
      || typeof createCommandRecipeTool!=='function'||!commandFactory)throw new ProtocolError('UNSUPPORTED_CAPABILITY','隔离编码命令宿主尚未配置');
    if(harness?harnessHostPromise:repairHostPromise)return harness?harnessHostPromise:repairHostPromise;
    const workspaceId=createHash('sha256').update(boundRoot).digest('hex');
    const preparedFingerprint=dependencyFingerprint,preparationReason=dependencyPreparationReason;
    // Reuse the same host implementation with separate journals: F15 retains owner-mapped
    // sessions, while harness receipts bind the actual executor in the same workspace.
    const pending=coding.createIsolatedCodingRepairHost({workspaceRoot:boundRoot,
      sessionRoot:path.join(userData,harness?'harness-isolation':'coding-isolation',workspaceId),
      workspaceId,patch:{powerShellPath:boundRepairPowerShell,
         ...(boundProjectHelper===undefined?{}:{processIdentityHelperPath:boundProjectHelper}),
        ...(patchHelperScriptPath===undefined?{}:{helperScriptPath:patchHelperScriptPath})},
      recipes:repairRecipes(),
      ...(harness?{}:{resolveOriginalTaskId:resolveRepairTask}),
      configurationRef:createHash('sha256').update(JSON.stringify({root:boundRoot,node:boundNode,check:boundCheckFile,npm:boundNpmCli,
        helper:boundProjectHelper,nodeIdentity:String(nodeIdentity?.ino)+':'+String(nodeIdentity?.mtimeNs),
        ...(preparedFingerprint?{dependencyFingerprint:preparedFingerprint}:{})})).digest('hex'),
      readVerificationEvidence:async input=>readRuntimeCodingVerificationEvidence(application,input),
      // Copy only the already prepared, authorized lock-bound bytes. No installer or network fallback.
      prepareWorkspace:input=>preparationReason?Promise.resolve({ready:false,reason:preparationReason})
        :coding.prepareIsolatedCodingDependencies({...input,expectedFingerprint:preparedFingerprint??null}),
      validatePreparedWorkspace:async({isolatedRoot,deadline,signal})=>{
        if(preparationReason)throw new ProtocolError('UNSUPPORTED_CAPABILITY',preparationReason);
        if(await coding.capturePreparedDependencyFingerprint(boundRoot,{deadline,signal})!==preparedFingerprint)
          throw new ProtocolError('REVISION_CONFLICT','原准备依赖已变化，不能使用旧授权验证或发布');
        if(await coding.capturePreparedDependencyFingerprint(isolatedRoot,{deadline,signal})!==preparedFingerprint)
          throw new ProtocolError('REVISION_CONFLICT','隔离依赖输入已变化，不能复用旧验证');
      },
      createCommandTool:({rootPath})=>createCommandRecipeTool({workspaceRoot:rootPath,authorizedWorkspaceRoot:rootPath,
        nodeExecutable:boundNode,checkFiles:boundCheckFile?[{id:'node-check',path:boundCheckFile}]:[],
        allowProjectScripts:Boolean(boundNpmCli),jobHelperExecutable:boundProjectHelper,npmCliPath:boundNpmCli,
        projectScriptEnvSource,isolateNpmConfiguration:true,createWorkspaceCommandTool:commandFactory,
        nativeNodeResolution:Boolean(question),maxOutputBytes:4096,maxDurationMs:30000,required:true}).tool});
    if(harness)harnessHostPromise=pending;else repairHostPromise=pending;
    return pending;
  };
  // Stable Main-only proxy. Every call keeps the original consent, task and revocation guards.
  const harnessRepairHost=Object.freeze({...Object.fromEntries(['start','list','read','snapshot','readback','preview','patch','verify','check','publish','reconcile']
    .map(name=>[name,async(...args)=>{
      const context={...args.at(-1)},parameters=structuredClone(args.slice(0,-1)),lease=generation,currentApplication=application;
      assertHarnessWorkspace(context);
      const controller=new AbortController();inflight.add(controller);
      const scoped={...context,signal:AbortSignal.any([context.signal,controller.signal])};
      try {
        const host=await getRepairHost(true,scoped);assertHarnessWorkspace(scoped);
        if(lease!==generation||application!==currentApplication)throw new ProtocolError('UNAUTHORIZED','原隔离工作区绑定已变化');
        const result=await host[name](...parameters,scoped);
        assertHarnessWorkspace(scoped);
        if(lease!==generation||application!==currentApplication)throw new ProtocolError('UNAUTHORIZED','原隔离工作区绑定已变化');
        return result;
      } finally {inflight.delete(controller);}
    }])),reconcileOriginalSession:input=>reconcileHarnessOriginalSession(input)});
  if(boundRoot && boundRepairPowerShell && typeof coding.createIsolatedCodingRepairTools==='function') {
    const routedHarnessMethods=new Set(['publish','snapshot','readback','reconcile']);
    const deferred=Object.fromEntries(['start','list','read','snapshot','readback','preview','patch','verify','check','publish','reconcile']
      .map(name=>[name,async(...args)=>{
        const context={...args.at(-1)},parameters=structuredClone(args.slice(0,-1));
        const sessionId=name==='publish'?parameters[0]?.sessionId:parameters[0];
        const currentApplication=application,lease=generation;
        if(routedHarnessMethods.has(name)&&typeof sessionId==='string'
          &&typeof currentApplication?.isHarnessCodingRepairSession==='function') {
          // The original Runtime validates its canonical session/run/Evidence. The model never picks a backend.
          const permitted=await currentApplication.isHarnessCodingRepairSession(context,{sessionId,operation:name});
          if(currentApplication!==application||lease!==generation||context.signal.aborted)
            throw new ProtocolError('UNAUTHORIZED','原交付会话绑定已变化');
          if(permitted===true)return harnessRepairHost[name](...parameters,context);
        }
        return (await getRepairHost(false,context))[name](...parameters,context);
      }]));
    const repairTools=coding.createIsolatedCodingRepairTools(deferred);
    implementations.push(...repairTools);
    for(const [source,name] of [['snapshot','workspace.coding_snapshot'],['preview','workflow.host.f15_n04'],
      ['check','workflow.host.f15_n05'],['publish','workflow.host.f15_n06']]) {
      const tool=repairTools.find(tool=>tool.descriptor.name==='coding.repair.'+source);
      implementations.push({...tool,descriptor:{...tool.descriptor,name}});
    }
  }
  const identityCurrent=() => {
    try {const now=statSync(boundRoot,{bigint:true});return savedRoot===boundRoot
      && directory(boundRoot)===boundRoot && now.dev===rootIdentity.dev && now.ino===rootIdentity.ino
      && now.birthtimeNs===rootIdentity.birthtimeNs;} catch {return false;}
  };
  // Tools retain their startup inputs; persisted selections cannot authorize
  // those tools until every selected command input has been reassembled.
  const selectionsCurrent=()=>savedRoot===boundRoot && savedNode===boundNode
    && savedCheckFile===boundCheckFile && savedNpmCli===boundNpmCli;
  function resourceIdentity() {
    const pin=file=>{if(!file)return null;const value=statSync(file,{bigint:true});
      return [file,...['dev','ino','birthtimeNs','size','mtimeNs','ctimeNs'].map(key=>String(value[key]))];};
    // No live dependency walk here. Dependencies are proven by the cancellable
    // worker at actual prepare/verify/publish, not by a stale catalog cache.
    return hash({kind:'desktop-workspace-v1',root:boundRoot,rootIdentity:rootIdentity&&
      ['dev','ino','birthtimeNs'].map(key=>String(rootIdentity[key])),node:pin(boundNode),
      check:boundCheckFile,npm:pin(boundNpmCli),helper:pin(boundProjectHelper),
      recipes:developerCommand?.recipeIds??[],nativeNodeResolution:Boolean(question)});
  }
  function preparedEntry(scope) {
    const matches=[...prepared.values()].filter(entry=>entry.scope.taskId===scope.taskId
      &&(scope.runId?entry.scope.runId===scope.runId:entry.scope.proposalId===(scope.proposalId??scope.proposal?.proposalId)));
    const entry=matches.length===1?matches[0]:undefined;
    if(!entry||!questionReady()||scope.signal?.aborted||!bound(scope.taskId)||entry.generation!==generation
      ||Date.parse(entry.scope.deadline)<=Date.now()||!selectionsCurrent()||!identityCurrent()
      ||entry.resource!==resourceIdentity()||question.readResourceGeneration(entry.resource)!==entry.resourceGeneration
      ||entry.decision&&!isDeepStrictEqual(entry.decision,readCodingDecision(entry.scope,
        application.readAuthorizationQuestionInvocation?.(entry.scope.taskId,entry.scope.runId)
          ??application.readAuthorizationQuestionInvocation?.(entry.scope.taskId,entry.scope.runId,true))))
      throw new ProtocolError('UNAUTHORIZED','原工作区操作、配置或授权范围已变化');
    return entry;
  }
  function assertQuestionAccess(context,input,toolName) {
    if(!question)return;
    const entry=preparedEntry(context);
    if(toolName&&(entry.scope.toolName!==toolName||entry.argumentsDigest!==toolArgumentsDigest(input)))
      throw new ProtocolError('UNAUTHORIZED','工作区操作与原授权参数不匹配');
    question.currentRequirement({...entry.scope,...context},'workspace-session');
  }
  function projectionSchema(tool) {
    const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
    const boolean={type:'boolean'},name=tool.descriptor.name;
    if(name==='workspace.git_diff_check'||name==='workspace.node_check'||isProject(tool))return object({
      recipeId:{type:'string',enum:[name==='workspace.git_diff_check'?'git-diff-check':name==='workspace.node_check'?'node-check':name==='workspace.npm_build'?'npm-build':'npm-test']},
      exitCode:{type:'integer'},passed:boolean});
    if(name==='workspace.list_entries')return object({listed:boolean,truncated:boolean});
    if(name==='workspace.preview_text_patch')return object({previewed:boolean,changed:boolean});
    if(name==='workspace.stage_text_patch')return object({staged:boolean,changed:boolean});
    if(name==='workspace.apply_text_patch')return object({applied:boolean,changed:boolean});
    if(codingRepairExportOperation(name))return workspaceRepairProjectionSchema(codingRepairExportOperation(name));
    return tool.descriptor.outputSchema;
  }
  function readCodingDecision(scope,source) {
    if(source?.toolName!=='decision.choose_candidate'||source.toolVersion!=='1.0.0')return undefined;
    const parent=application?.runtime.loadCheckpoint(scope.taskId,'coding-repair:parent');
    if(!parent)return undefined;
    const original=application.runtime.loadCheckpoint(parent.taskId,'coding-repair:host:'+parent.operationId)?.request;
    const linked=application.runtime.loadCheckpoint(parent.taskId,'coding-repair:host:'+parent.operationId);
    const graph=application.runtime.loadCheckpoint(parent.taskId,'coding-repair:graph');
    if(scope.runId!=='host-tool-'+scope.taskId||linked?.localTaskId!==scope.taskId||!original
      ||graph?.version!==1||graph.input?.codingRepair?.session?.taskId!==parent.taskId
      ||graph.sessionId!==graph.input.codingRepair.session.sessionId
      ||original.commandId!==parent.operationId||original.toolName!==source.toolName||original.toolVersion!==source.toolVersion
      ||original.deadline!==scope.deadline||!isDeepStrictEqual(original.arguments,source.arguments))
      throw new ProtocolError('UNAUTHORIZED','本地编码判断缺少原 F15 操作关联');
    const descriptor=createWorkflowDecisionTool({selector:{select:async()=>{throw Error('Descriptor only');}}}).descriptor;
    validateToolValue(descriptor.inputSchema,source.arguments);
    if(new Set(source.arguments.candidates.map(candidate=>candidate.id)).size!==source.arguments.candidates.length)
      throw new ProtocolError('INVALID_ARGUMENT','原编码判断候选重复');
    return {ownerTaskId:parent.taskId,operationId:parent.operationId,argumentsDigest:toolArgumentsDigest(original.arguments),
      candidateIds:source.arguments.candidates.map(candidate=>candidate.id)};
  }
  function decisionProjectionSchema(decision) {
    return {type:'object',properties:{selectedId:{type:'string',enum:[...decision.candidateIds]}},required:['selectedId'],additionalProperties:false};
  }
  function prepareQuestion(scope,exportRequested=false) {
    if(!question)return;
    const source=scope.proposal?{...scope.proposal,argumentsDigest:toolArgumentsDigest(scope.proposal.arguments)}
      :application?.readAuthorizationQuestionInvocation?.(scope.taskId,scope.runId);
    const decision=readCodingDecision(scope,source);
    const tool=implementations.find(item=>item.descriptor.name===source?.toolName&&item.descriptor.version===source?.toolVersion)
      ??(decision?{descriptor:createWorkflowDecisionTool({selector:{select:async()=>{throw Error('Descriptor only');}}}).descriptor}:undefined);
    const delegated=source?.toolName==='workspace.run_allowed_command'&&source.toolVersion===developerCommand?.descriptor.version;
    const candidate=['coding.repair.trial','coding.repair.prepare_adoption','coding.repair.reconcile_trial','harness.candidates.compare'].includes(source?.toolName);
    if(!tool&&!delegated&&!candidate)return;
    if(!questionReady()||!scope.runId||scope.signal.aborted||Date.parse(scope.deadline)<=Date.now()
      ||!selectionsCurrent()||!identityCurrent()||!bound(scope.taskId,true)||tool&&!enabled(tool))
      throw new ProtocolError('UNAUTHORIZED','工作区配置或授权提问通路不可用');
    const descriptor=tool?.descriptor??(delegated?developerCommand.descriptor:undefined);
    if(descriptor)validateToolValue(descriptor.inputSchema,source.arguments);
    for(const [key,value]of prepared)if(Date.parse(value.scope.deadline)<=Date.now())prepared.delete(key);
    const resource=resourceIdentity(),resourceGeneration=question.readResourceGeneration(resource);resources.add(resource);
    const request={taskId:scope.taskId,runId:scope.runId,proposalId:source.proposalId,toolName:source.toolName,
      toolVersion:source.toolVersion,argumentsDigest:toolArgumentsDigest(source.arguments),deadline:scope.deadline,signal:scope.signal};
    const key=JSON.stringify([request.taskId,request.runId]),previous=prepared.get(key);
    const signature=hash({request:{...request,signal:undefined},generation,resource,resourceGeneration});
    if(previous&&previous.signature!==signature)throw new ProtocolError('UNAUTHORIZED','原工作区操作不能替换参数或配置');
    const entry=previous??{scope:request,argumentsDigest:request.argumentsDigest,generation,resource,resourceGeneration,signature,
      ...(decision?{decision}: {})};
    prepared.set(key,entry);
    const ruleBindingDigest=hash({resource,resourceGeneration,toolName:request.toolName,toolVersion:request.toolVersion,
      scopes:descriptor?.requiredScopes??source.scopes,projectionVersion:'workspace-redacted-v3'});
    question.prepare(request,{requirements:[{requirementId:'workspace-session',kind:'connector_session',
      scopes:descriptor?.requiredScopes??source.scopes??[],bindingDigest:signature,ruleBindingDigest,
      summary:'仅对已选择且仍有效的工作区执行本操作所列读写或固定命令；不开放任意路径、命令或其他任务'}],
      assertCurrent:()=>{try{preparedEntry(request);return true;}catch{return false;}}});
    const workflowRun=application.runtime.loadCheckpoint(scope.taskId,'coding-repair:graph')?.initialRunId===scope.runId
      ||Boolean(application.runtime.loadCheckpoint(scope.taskId,'coding-repair:parent'));
    if(tool&&workflowRun&&(decision||codingRepairExportOperation(tool.descriptor.name))) {
      const sourceRead=codingRepairExportOperation(tool.descriptor.name)==='read';
      const sourceRule=sourceRead?{path:source.arguments.path,maxBytes:source.arguments.maxBytes??262144,
        configurationRef:readWorkspaceExportConfigurationRef()}:{};
      if(sourceRead)question.prepare(request,{requirements:[{requirementId:'public-reference-read',kind:'connector_session',
        scopes:['workspace:read'],bindingDigest:hash({signature,kind:'public-read'}),
        ruleBindingDigest:hash({ruleBindingDigest,kind:'public-read',...sourceRule}),
        summary:'仅将本操作指定的源码作为公开参考资料读取；源码出机仍核原来源、版本、精确字节与 digest'}]});
      question.prepareExport(request,{requirementId:sourceRead?'public-reference-export':'workspace-metadata-export',
        projectionSchema:decision?decisionProjectionSchema(decision):sourceRead?readTool.descriptor.outputSchema:projectionSchema(tool),
        summary:decision?'仅向原 F15 工作流发送本次原候选中的 selectedId；本地 typed 判断原因、概率与上下文均不出机':sourceRead?'把本操作指定的公开参考源码发送到原任务选定模型，严格限原 maxBytes 与最终已确认内容，不包括其他文件'
          :'仅将原隔离编码工具的固定脱敏元数据发送到该工作流模型，不含源码、stdout 或本机绝对路径',
        bindingDigest:hash({signature,kind:sourceRead?'public-source':'workflow-metadata'}),
        ruleBindingDigest:hash({ruleBindingDigest,kind:sourceRead?'public-source':'workflow-metadata',
          ...sourceRule})});
      if(tool.descriptor.name==='coding.repair.start')question.prepareExport(request,{
        requirementId:'workspace-workflow-summary-export',projectionSchema:workspaceWorkflowSummaryProjectionSchema(),
        summary:'仅发送本次 F15 工作流的最终状态、模式和已确认操作数；云端自报完成不代替本机原始验证',
        bindingDigest:hash({signature,kind:'workflow-summary'}),ruleBindingDigest:hash({ruleBindingDigest,kind:'workflow-summary'})});
    }
    if(exportRequested&&tool&&tool.descriptor.name!=='workspace.read_text')question.prepareExport(request,{
      requirementId:'workspace-export',projectionSchema:projectionSchema(tool),
      summary:'仅将本操作的固定脱敏元数据发送到当前任务选定的 AgentArts 模型；不含源码、stdout 或本机绝对路径（最多 960 KiB）',
      bindingDigest:hash({signature,kind:'export'}),ruleBindingDigest:hash({ruleBindingDigest,kind:'export',schema:projectionSchema(tool)})});
  }
  async function prepareDependencies(context) {
    assertQuestionAccess(context);
    if(!dependencySeeded&&!dependencyPreparation) {
      const lease=generation,controller=new AbortController();inflight.add(controller);
      dependencyPreparation=(async()=>{
        if(coding.hasPreparedCodingDependenciesSync(boundRoot)) {
          const fingerprint=await coding.capturePreparedDependencyFingerprint(boundRoot,{deadline:context.deadline,
            signal:AbortSignal.any([context.signal,controller.signal])});
          assertQuestionAccess(context);if(lease!==generation)throw new ProtocolError('UNAUTHORIZED','原依赖准备已撤销');
          dependencyFingerprint=fingerprint;
        }
        dependencySeeded=true;
      })().catch(error=>{if(lease===generation)dependencyPreparationReason='原项目的锁定依赖尚未安全准备好';throw error;})
        .finally(()=>{inflight.delete(controller);if(lease===generation)dependencyPreparation=undefined;});
    }
    if(dependencyPreparation)await dependencyPreparation;
    assertQuestionAccess(context);
    if(dependencyPreparationReason)throw new ProtocolError('UNSUPPORTED_CAPABILITY',dependencyPreparationReason);
  }
  // Trusted main-process configuration only. A getter cannot grant read or
  // execute permission, and this record must not enter Renderer/cloud output.
  const readWorkspaceBinding=() => {
    if(!active || !(question?questionReady():consent) || !selectionsCurrent() || !identityCurrent()
      || !boundNode || savedNode!==boundNode || !nodeIdentity) return undefined;
    try {
      if(fixedNode(boundNode,boundRoot)!==boundNode) return undefined;
      const current=statSync(boundNode,{bigint:true});
      if(['dev','ino','birthtimeNs','size','mtimeNs','ctimeNs'].some(key=>current[key]!==nodeIdentity[key])) {
        return undefined;
      }
      return Object.freeze({rootPath:boundRoot,nodeExecutable:boundNode,bindingId:generation});
    } catch {return undefined;}
  };
  const isWorkspaceBindingCurrent=binding => {
    try {
      if(!binding || typeof binding!=='object' || Array.isArray(binding)
        || ![Object.prototype,null].includes(Object.getPrototypeOf(binding))) return false;
      const keys=['rootPath','nodeExecutable','bindingId'];
      const own=Reflect.ownKeys(binding);
      if(own.length!==keys.length || keys.some(key=>!own.includes(key))) return false;
      const fields=Object.getOwnPropertyDescriptors(binding);
      if(keys.some(key=>!('value' in fields[key]) || typeof fields[key].value!=='string')) return false;
      const current=readWorkspaceBinding();
      return Boolean(current && keys.every(key=>fields[key].value===current[key]));
    } catch {return false;}
  };
  const isProject=tool=>['workspace.npm_build','workspace.npm_test'].includes(tool.descriptor.name);
  const commandReady=tool=> {
    const read=commandReadiness.get(tool.descriptor.name);
    try {return !read || read()===true;} catch {return false;}
  };
  const projectIdentityCurrent=()=> {
    try {return savedNode && fixedNode(savedNode,boundRoot)===savedNode
      && savedNpmCli && fixedNpmCli(savedNpmCli,boundRoot)===savedNpmCli
      && boundProjectHelper && outsideFile(boundProjectHelper,boundRoot,'项目命令')===boundProjectHelper;}
    catch {return false;}
  };
  const enabled=tool => active && (question?questionReady():Boolean(consent)) && selectionsCurrent() && identityCurrent()
    && (!(tool.descriptor.name.startsWith('coding.repair.')||tool.descriptor.name.startsWith('workflow.host.f15_')||tool.descriptor.name==='workspace.coding_snapshot')
      ||!dependencyPreparation&&!dependencyPreparationReason)
    && commandReady(tool)
    && (question?(!isProject(tool)||projectIdentityCurrent()):tool.descriptor.sideEffect==='read' || (consent.cloudExportAllowed===true && (isProject(tool)
      ? consent.commandAllowed===true && consent.projectCodeAllowed===true && projectIdentityCurrent()
      : ['workspace.git_diff_check','workspace.node_check'].includes(tool.descriptor.name)
        ? consent.commandAllowed===true : consent.writeAllowed===true)))
    && (tool.descriptor.name!=='workspace.apply_text_patch' || applyHost?.available());
  const bound=(taskId, claim=false) => {
    if (!application || !taskId) return false;
    const key='desktop-coding-scope';
    const previous=application.runtime.loadCheckpoint(taskId,key);
    if(previous===undefined) {
      const graph=application.runtime.loadCheckpoint(taskId,'coding-repair:parent');
      const child=application.runtime.loadCheckpoint(taskId,'subtask-parent');
      const original=graph?.taskId??child?.parentTaskId;
      const permitted=graph?.taskId || (child?.subtaskId && application.runtime.loadCheckpoint(original,'coding-repair:request:'+child.subtaskId));
      if(permitted && typeof original==='string' && application.runtime.loadCheckpoint(original,key)===generation)
        application.runtime.saveCheckpoint(taskId,key,generation);
    }
    if (previous===undefined && claim) application.runtime.saveCheckpoint(taskId,key,generation);
    return application.runtime.loadCheckpoint(taskId,key)===generation;
  };
  // These ports are Main-only. Session scope never grants PUBLIC export, and
  // only the original Runtime result checkpoint supplies bytes for confirmation.
  const readTool=implementations.find(tool=>tool.descriptor.name==='workspace.read_text');
  const readWorkspaceExportConfigurationRef=() => {
    if(!(question?questionReady():consent?.cloudExportAllowed===true)||!readTool||!enabled(readTool))return undefined;
    if(!question)return generation;
    const resource=resourceIdentity();resources.add(resource);
    return hash({resource,resourceGeneration:question.readResourceGeneration(resource)});
  };
  const readQuery=(query,withDigest=false,withArguments=false) => {
    if(!query || typeof query!=='object' || Array.isArray(query)
      || ![Object.prototype,null].includes(Object.getPrototypeOf(query))) return false;
    const keys=['taskId','proposalId','path','configurationRef',...(withDigest?['contentDigest']:[]),
      ...(withArguments?['arguments']:[])];
    const fields=Object.getOwnPropertyDescriptors(query),own=Reflect.ownKeys(query);
    return own.length===keys.length && keys.every(key=>own.includes(key)
      && 'value' in fields[key] && (key==='arguments'
        ? fields[key].value && typeof fields[key].value==='object' && !Array.isArray(fields[key].value)
        : typeof fields[key].value==='string' && fields[key].value.length>0));
  };
  const taskLive=taskId => {
    const runtime=application?.runtime,task=runtime?.getTask(taskId);
    const deadline=runtime?.loadCheckpoint(taskId,'application-deadline');
    return task?.taskId===taskId && task.state==='running' && task.cancelRequested!==true && bound(taskId)
      && runtime.loadCheckpoint(taskId,'application-profile')==='huawei_ict_agentarts'
      && typeof deadline==='string' && Number.isFinite(Date.parse(deadline)) && Date.parse(deadline)>Date.now()
      ? {task,deadline} : undefined;
  };
  const readOriginalWorkspaceProposal=query => {
    try {
      if(!readQuery(query) || query.configurationRef!==readWorkspaceExportConfigurationRef()) return undefined;
      const live=taskLive(query.taskId),runtime=application?.runtime;
      if(!live || !readTool || readTool.descriptor.version!=='1.0.0'
        || readTool.descriptor.sideEffect!=='read'
        || !isDeepStrictEqual(readTool.descriptor.requiredScopes,['workspace:read'])) return undefined;
      const graph=runtime.loadCheckpoint(query.taskId,'coding-repair:graph');
      const codingProposal=graph?.result?.proposals?.find(proposal=>proposal.proposalId===query.proposalId);
      if(codingProposal?.kind==='tool_proposal'&&codingProposal.toolName==='coding.repair.read'&&codingProposal.toolVersion==='1.0.0') {
        const operation=runtime.loadCheckpoint(query.taskId,'owned-workflow:operation:'+codingProposal.operationId);
        const linked=operation?.localTaskId?runtime.loadCheckpoint(operation.localTaskId,'coding-repair:parent'):undefined;
        if(operation?.taskId!==query.taskId||linked?.taskId!==query.taskId||operation.proposal?.proposalId!==query.proposalId
          ||!isDeepStrictEqual(operation.proposal,codingProposal)||codingProposal.arguments.path!==query.path)return undefined;
        return {runId:'host-tool-'+operation.localTaskId,readTaskId:operation.localTaskId,
          proposal:codingProposal,deadline:live.deadline,task:live.task,coding:true};
      }
      const loop=runtime.loadCheckpoint(query.taskId,'competition-loop');
      if(!loop || !Number.isSafeInteger(loop.step) || loop.step<1) return undefined;
      const key=JSON.stringify([query.taskId,query.proposalId]),saved=workspaceExportProposals.get(key);
      const receipts=(loop.receipts??[]).filter(item=>item.proposal?.proposalId===query.proposalId);
      if(receipts.length>1) return undefined;
      const pending=loop.pending?.proposalId===query.proposalId ? loop.pending : undefined;
      const proposal=pending??receipts[0]?.proposal;
      if(!proposal || proposal.kind!=='tool_proposal' || proposal.verification!=='unverified'
        || proposal.toolName!==readTool.descriptor.name || proposal.toolVersion!==readTool.descriptor.version
        || (pending && receipts.length && !isDeepStrictEqual(pending,receipts[0].proposal))) return undefined;
      validateToolValue(readTool.descriptor.inputSchema,proposal.arguments);
      if(proposal.arguments.path!==query.path || query.path.includes('\\') || query.path.includes(':')
        || query.path.split('/').some(part=>!part || part==='.' || part==='..')) return undefined;
      // A pending original proposal supplies the exact run mapping. Historical
      // receipts without that mapping cannot be guessed from matching arguments.
      const runId=pending ? `competition-tool-${query.taskId}-${loop.step}` : saved?.runId;
      if(!runId || (saved && (saved.runId!==runId || saved.deadline!==live.deadline
        || !isDeepStrictEqual(saved.proposal,proposal)))) return undefined;
      if(!saved) workspaceExportProposals.set(key,{runId,proposal:structuredClone(proposal),deadline:live.deadline});
      return {runId,proposal,deadline:live.deadline,task:live.task};
    } catch {return undefined;}
  };
  const readWorkspaceExportPreflightCandidate=query => {
    const original=readOriginalWorkspaceProposal(query);
    return original ? Object.freeze({query:Object.freeze({...query}),runId:original.runId,...(original.readTaskId?{readTaskId:original.readTaskId}:{}),
      toolName:original.proposal.toolName,toolVersion:original.proposal.toolVersion,
      arguments:Object.freeze(structuredClone(original.proposal.arguments)),deadline:original.deadline}) : undefined;
  };
  const readOriginalWorkspaceReceipt=query => {
    try {
      const original=readOriginalWorkspaceProposal(query),runtime=application?.runtime;
      if(!original) return undefined;
      const {runId,proposal,deadline,task}=original,readTaskId=original.readTaskId??query.taskId;
      const key=JSON.stringify([query.taskId,query.proposalId]),saved=confirmedWorkspaceReads.get(key);
      const records=runtime.readToolExecutions(readTaskId).filter(record=>record.evidenceId===runId);
      const record=records[0];
      if(records.length!==1 || record.taskId!==readTaskId || record.protocolVersion!==PROTOCOL_VERSION
        || record.toolName!==proposal.toolName || record.toolVersion!==proposal.toolVersion
        || record.state!=='confirmed' || record.policyDecision!=='allow' || record.executionStarted!==true
        || !Number.isFinite(Date.parse(record.startedAt)) || !Number.isFinite(Date.parse(record.finishedAt))
        || Date.parse(record.finishedAt)<Date.parse(record.startedAt) || Date.parse(record.finishedAt)>Date.now()
        || Date.parse(record.finishedAt)>Date.parse(deadline)
        || !runtime.matchesToolExecutionInput(record,{arguments:proposal.arguments,scopeRef:runId})
        || !(original.coding?runtime.getTask(readTaskId):task).evidenceRefs.includes(runId)) return undefined;
      const evidence=runtime.readEvidence(readTaskId).filter(item=>item.evidenceId===runId);
      if(evidence.length!==1 || evidence[0].kind!=='execution' || evidence[0].sourceRef!==proposal.toolName
        || evidence[0].capturedAt!==record.finishedAt) return undefined;
      const checkpoint=runtime.loadCheckpoint(readTaskId,`tool-result-${runId}`);
      if(!checkpoint || !Object.hasOwn(checkpoint,'result')) return undefined;
      const result=checkpoint.result;
      validateToolValue(readTool.descriptor.outputSchema,result);
      if(!isDeepStrictEqual(Object.keys(result).sort(),['byteLength','content','encoding','path','sha256'])
        || result.path!==query.path || result.encoding!=='utf-8' || !/^[a-f0-9]{64}$/.test(result.sha256)
        || result.byteLength>Math.min(proposal.arguments.maxBytes??262144,262144)
        || Buffer.byteLength(result.content,'utf8')!==result.byteLength
        || createHash('sha256').update(result.content,'utf8').digest('hex')!==result.sha256
        || (saved && !isDeepStrictEqual(saved.result,result))) return undefined;
      const current=readOriginalWorkspaceProposal(query);
      if(!current || current.deadline!==deadline || current.runId!==runId
        || !isDeepStrictEqual(current.proposal,proposal)) return undefined;
      const receipt={runId,proposal:structuredClone(proposal),result:structuredClone(result),deadline};
      if(!saved) confirmedWorkspaceReads.set(key,receipt);
      return receipt;
    } catch {return undefined;}
  };
  const readWorkspaceExportCandidate=query => {
    const original=readOriginalWorkspaceReceipt(query);
    const source=readOriginalWorkspaceProposal(query);
    return original&&source ? Object.freeze({query:Object.freeze({...query}),runId:original.runId,...(source.readTaskId?{readTaskId:source.readTaskId}:{}),
      toolName:original.proposal.toolName,toolVersion:original.proposal.toolVersion,
      arguments:Object.freeze(structuredClone(original.proposal.arguments)),contentDigest:original.result.sha256,
      byteLength:original.result.byteLength,deadline:original.deadline}) : undefined;
  };
  const readConfirmedWorkspaceExport=query => {
    if(!readQuery(query,true,true)) return undefined;
    const {contentDigest,arguments:args,...reference}=query,original=readOriginalWorkspaceReceipt(reference);
    try {validateToolValue(readTool.descriptor.inputSchema,args);} catch {return undefined;}
    return original && original.result.sha256===contentDigest && isDeepStrictEqual(original.proposal.arguments,args)
      ? {runId:original.runId,result:structuredClone(original.result)} : undefined;
  };
  const currentWorkspaceReferenceExport=() => {
    if(!readWorkspaceExportConfigurationRef() || typeof createWorkspaceReferenceExport!=='function'
      || typeof readWorkspaceExportPreflight!=='function' || typeof readWorkspaceExportAuthorization!=='function') return undefined;
    if(!workspaceReferenceExport) {
      try {
        // Consume the public factory, not a second helper/result/permission DTO.
        const exported=createWorkspaceReferenceExport({currentConfigurationRef:readWorkspaceExportConfigurationRef,
          readConfirmed:readConfirmedWorkspaceExport,
          readPreflight:input=> {
            try {
              const {arguments:args,...query}=input,candidate=readWorkspaceExportPreflightCandidate(query);
              if(!candidate || !isDeepStrictEqual(candidate.arguments,args)) return undefined;
              const permission=readWorkspaceExportPreflight(structuredClone(input));
              if(!permission || Date.parse(permission.expiresAt)>Date.parse(candidate.deadline)
                || !isDeepStrictEqual(candidate,readWorkspaceExportPreflightCandidate(query))) return undefined;
              return permission;
            } catch {return undefined;}
          },
          readAuthorization:input=> {
            try {
              const {contentDigest,byteLength,arguments:args,...query}=input;
              const candidate=readWorkspaceExportCandidate(query);
              if(!candidate || contentDigest!==candidate.contentDigest || byteLength!==candidate.byteLength
                || !isDeepStrictEqual(candidate.arguments,args)) return undefined;
              const permission=readWorkspaceExportAuthorization(structuredClone(input));
              if(!permission || permission.contentDigest!==candidate.contentDigest
                || Date.parse(permission.expiresAt)>Date.parse(candidate.deadline)
                || !isDeepStrictEqual(candidate,readWorkspaceExportCandidate(query))) return undefined;
              return permission;
            } catch {return undefined;}
          }});
        if(exported?.toolName!=='workspace.read_text' || exported.toolVersion!=='1.0.0'
          || exported.exportPolicyVersion!=='workspace-reference-3.0.0'
          || ['accepts','project','dispose'].some(name=>typeof exported[name]!=='function')) {
          exported?.dispose?.();return undefined;
        }
        workspaceReferenceExport=exported;
      } catch {return undefined;}
    }
    return workspaceReferenceExport;
  };
  const tools=implementations.map(tool => ({descriptor:tool.descriptor,execute:async(input,context) => {
    if (!enabled(tool) || !bound(context.taskId)) throw Error('工作区许可已撤销或任务绑定已改变');
    assertQuestionAccess(context,input,tool.descriptor.name);
    if(!question&&(tool.descriptor.name.startsWith('coding.repair.')||tool.descriptor.name.startsWith('workflow.host.f15_')||tool.descriptor.name==='workspace.coding_snapshot')
      && (consent?.cloudExportAllowed!==true||consent.commandAllowed!==true||consent.writeAllowed!==true
        ||boundNpmCli&&consent.projectCodeAllowed!==true))throw new ProtocolError('UNAUTHORIZED','隔离编码需要当前工作区读取、写入、命令及出机许可');
    const controller=new AbortController();inflight.add(controller);
    try {const result=await tool.execute(input,{...context,signal:AbortSignal.any([context.signal,controller.signal])});
      assertQuestionAccess(context,input,tool.descriptor.name);return result;}
    finally {inflight.delete(controller);}
  }}));
  const snapshot=() => ({configured:Boolean(savedRoot),displayName:savedRoot?path.basename(savedRoot):'',
    nodeConfigured:Boolean(savedNode),checkFileConfigured:Boolean(savedCheckFile),npmCliConfigured:Boolean(savedNpmCli),
    checkFileName:savedCheckFile?path.basename(savedCheckFile):'',
    nodeCheckAvailable:tools.some(tool=>tool.descriptor.name==='workspace.node_check' && enabled(tool)),
    projectScriptsAvailable:active && selectionsCurrent() && identityCurrent()
      && tools.some(tool=>isProject(tool) && commandReady(tool)) && projectIdentityCurrent()===true,
    projectCommands:tools.filter(isProject).map(tool=>tool.descriptor.name==='workspace.npm_build'?'build':'test'),
    projectCodeAllowed:consent?.projectCodeAllowed===true,
    commandReason:commandFailure || (tools.some(tool=>tool.descriptor.name==='workspace.node_check'
      && !commandReady(tool))?'命令文件或配置已变化，请重启应用重新装配':''),
    projectReason:dependencyPreparation?'正在核实原项目的锁定依赖':dependencyPreparationReason||projectFailure || (tools.some(tool=>isProject(tool) && !commandReady(tool))
      ?'项目命令文件或配置已变化，请重启应用重新装配':''),
    readAvailable:tools.some(tool=>tool.descriptor.name==='workspace.read_text') && enabled(tools[0]),
    writeAvailable:tools.some(tool=>tool.descriptor.name==='workspace.apply_text_patch' && enabled(tool)),
    commandAvailable:tools.some(tool=>['workspace.git_diff_check','workspace.node_check'].includes(tool.descriptor.name) && enabled(tool)),
    cloudExportAllowed:consent?.cloudExportAllowed===true,
    authorizationAvailable:active && selectionsCurrent() && identityCurrent() && tools.length>0,
    writeAllowed:consent?.writeAllowed===true,
    commandAllowed:consent?.commandAllowed===true,
    reason:authorizationFailure?'工作区规则状态暂不可核实，工具保持不可用；请重试撤销后重新发起操作'
      :!selectionsCurrent()?'工作区设置已保存，请重启应用完成工具装配':failure || (question
      ? '工作区配置就绪后，在原对话提问卡确认本次范围；应用内许可不代表外部进程已隔离'
      :consent
      ? '当前工作区已授权；受限命令仍经过 Policy，项目脚本另需明确许可'
      : savedRoot?'请为本次应用会话授权工作区；重启后需要重新授权':'请选择编程工作区')});
  const revoke=(rotate=true) => {
    consent=undefined;generation=randomUUID();
    prepared.clear();
    try {workspaceReferenceExport?.dispose();} catch { /* No host details escape. */ }
    workspaceReferenceExport=undefined;workspaceExportProposals.clear();confirmedWorkspaceReads.clear();
    for (const controller of inflight) controller.abort();
    dependencyFingerprint=undefined;dependencyPreparationReason=undefined;dependencyPreparation=undefined;dependencySeeded=false;repairHostPromise=undefined;harnessHostPromise=undefined;
    if(question&&rotate) {
      authorizationFailure=true;
      for(const resource of resources)question.rotateResourceGeneration(resource,question.readResourceGeneration(resource));
      authorizationFailure=false;
    }
    return snapshot();
  };
  function persist(root,node,selectedFile,npmCli) {
    if (!safeStorage.isEncryptionAvailable()) throw Error('本机安全存储不可用');
    const record={version:1,encrypted:safeStorage.encryptString(root).toString('base64'),
      ...(node?{encryptedNode:safeStorage.encryptString(node).toString('base64')}:{}),
      ...(selectedFile?{encryptedCheckFile:safeStorage.encryptString(selectedFile).toString('base64')}:{}),
      ...(npmCli?{encryptedNpmCli:safeStorage.encryptString(npmCli).toString('base64')}:{})};
    mkdirSync(userData,{recursive:true});
    writeFileSync(file+'.tmp',JSON.stringify(record),'utf8');renameSync(file+'.tmp',file);
  }
  const beginSelection=()=>{
    if(!active) throw Error('工作区宿主已关闭');
    return generation;
  };
  const checkSelection=startedGeneration=>{
    if(!active || startedGeneration!==generation) throw Error('工作区选择已失效，请重新选择');
  };
  const patchReconciliation = {
    get bindingId() { return applyHost?.patchReconciliation?.bindingId; },
    reconcile(input) {
      const current = applyHost?.patchReconciliation;
      if (!current) throw Error('Workspace patch reconciliation is unavailable');
      return current.reconcile(input);
    },
  };
  const readDeveloperConfiguration=()=>{
    if(!active||!boundRoot||!selectionsCurrent()||!identityCurrent())return undefined;
    const rootPath=boundRoot;
    const bindingId=createHash('sha256').update(JSON.stringify([rootPath,String(rootIdentity.dev),String(rootIdentity.ino),
      String(rootIdentity.birthtimeNs),boundNode??null,boundCheckFile??null,boundNpmCli??null,boundProjectHelper??null,
      ...(!question&&dependencyFingerprint?[dependencyFingerprint]:[])])).digest('hex');
    const available=scope=>{
      if(typeof application?.readToolConversation!=='function')return false;
      const conversationId=application.readToolConversation(scope.taskId);
      return !dependencyPreparation&&!dependencyPreparationReason&&typeof conversationId==='string'&&conversationId.length>0&&!scope.signal?.aborted&&Date.now()<Date.parse(scope.deadline)&&(question?questionReady():Boolean(consent))
        &&active&&selectionsCurrent()&&identityCurrent()&&bound(scope.taskId,true);
    };
    const aliases={'node-check':'workspace.node_check','npm-build':'workspace.npm_build','npm-test':'workspace.npm_test'};
    const command=developerCommand?{rootPath,recipeIds:[...developerCommand.recipeIds],publicEnumPaths:['/recipeId'],
      available:scope=>available(scope)&&implementations.some(tool=>Object.values(aliases).includes(tool.descriptor.name)&&enabled(tool)),
      tool:{descriptor:structuredClone(developerCommand.descriptor),execute:(input,context)=>{
        validateToolValue(developerCommand.descriptor.inputSchema,input);
        const alias=implementations.find(tool=>tool.descriptor.name===aliases[input.recipeId]);
        if(!available(context)||!alias||!enabled(alias))throw new ProtocolError('UNAUTHORIZED','原工作区命令许可或配置已变化');
        assertQuestionAccess(context,input,'workspace.run_allowed_command');
        return alias.execute({},context);
      }}}:undefined;
    return {bindingId,rootPath,metadataExportAllowed:false,available,
      assertCurrent:scope=>{if(!available(scope))throw new ProtocolError('UNAUTHORIZED','原开发工作区许可或配置已变化');},...(command?{command}:{})};
  };
  function assertHarnessWorkspace(context) {
    if(dependencyPreparation||dependencyPreparationReason)throw new ProtocolError('UNSUPPORTED_CAPABILITY',dependencyPreparationReason??'原锁定依赖正在准备');
    assertHarnessWorkspaceBinding(context?.taskId,context?.deadline,context?.signal);
    assertQuestionAccess(context);
  }
  function assertHarnessWorkspaceBinding(taskId,deadline,signal) {
    if(!signal||signal.aborted)throw new ProtocolError('CANCELLED','原隔离编码操作已取消');
    if(!Number.isFinite(Date.parse(deadline))||Date.now()>=Date.parse(deadline))throw new ProtocolError('TIMEOUT','原隔离编码操作已过期');
    assertHarnessWorkspaceAuthorization();
    if(!bound(taskId))throw new ProtocolError('UNAUTHORIZED','原隔离工作区任务绑定已变化');
  }
  function assertHarnessWorkspaceAuthorization() {
    if(!application||!readWorkspaceBinding()||(!question&&(consent?.cloudExportAllowed!==true
      ||consent.writeAllowed!==true||consent.commandAllowed!==true))||!boundRepairPowerShell||!commandFactory
      ||!boundCheckFile&&!boundNpmCli||boundNpmCli&&(!projectIdentityCurrent()||!question&&consent.projectCodeAllowed!==true))
      throw new ProtocolError('UNAUTHORIZED','原隔离工作区许可或命令绑定已变化');
  }
  function readHarnessExperienceCurrentSync() {
    // Scope covers current source/package metadata and the sealed configuration,
    // not live node_modules bytes. Actual execution proves those asynchronously.
    try {
      assertHarnessWorkspaceAuthorization();
      if(typeof readHarnessVersions!=='function')return undefined;
      const lease=generation,currentApplication=application,configuration=readDeveloperConfiguration();
      const check=()=>{if(lease!==generation||currentApplication!==application)throw new ProtocolError('UNAUTHORIZED','原经验工作区绑定已变化');};
      const readVersions=()=>{
        const value=readHarnessVersions();
        if(value&&typeof value.then==='function'){void Promise.resolve(value).catch(()=>{});return undefined;}
        return value&&value.executionKind==='real_host'?structuredClone(value):undefined;
      };
      const versions=readVersions();check();if(!versions)return undefined;
      const snapshot=coding.captureCodingRepairSnapshotSync(boundRoot,check).snapshot;
      const after=readVersions();check();assertHarnessWorkspaceAuthorization();
      if(!isDeepStrictEqual(versions,after)||configuration?.bindingId!==readDeveloperConfiguration()?.bindingId)return undefined;
      const recipes=repairRecipes().map(recipe=>({...recipe,packageIds:snapshot.packages.map(pkg=>pkg.id)}));
      if(!recipes.some(recipe=>recipe.required))return undefined;
      const workspaceId=createHash('sha256').update(boundRoot).digest('hex'),recipeFingerprint=harnessCandidateRecipeFingerprint(recipes);
      parseHarnessCandidateBinding({version:1,taskId:'experience-current',candidateId:'experience-current',artifactId:'experience-current',
        trialTaskId:'experience-current',sessionId:'experience-current',workspaceId,baselineSnapshotId:snapshot.snapshotId,
        inputDigest:'0'.repeat(64),configurationDigest:'0'.repeat(64),workflowVersion:versions.workflowVersion,
        runtimeVersion:versions.runtimeVersion,executionKind:versions.executionKind,recipeFingerprint,artifactDigest:'0'.repeat(64),parentArtifactDigests:[]});
      check();return {snapshot,versions,configuration:{bindingId:configuration.bindingId,workspaceId,recipeFingerprint}};
    }catch{return undefined;}
  }
  async function reconcileHarnessOriginalSession(input) {
    const {trialRunId,expectedRevision,deadline,signal,assertCurrent}=input;
    const session=structuredClone(input.session),taskId=session?.session?.taskId,lease=generation,currentApplication=application;
    if(typeof assertCurrent!=='function')throw new ProtocolError('UNAUTHORIZED','缺少原 Runtime 恢复权限检查');
    const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);
    const check=()=>{assertCurrent();assertHarnessWorkspaceBinding(taskId,deadline,combined);
      if(lease!==generation||application!==currentApplication)throw new ProtocolError('UNAUTHORIZED','原恢复工作区绑定已变化');};
    check();inflight.add(controller);
    try {
      const host=await getRepairHost(true);check();
      if(typeof host.reconcileOriginalSession!=='function')throw new ProtocolError('UNSUPPORTED_CAPABILITY','原会话原生核实尚未接入');
      const result=await host.reconcileOriginalSession({session,trialRunId,expectedRevision,deadline,signal:combined,assertCurrent:check});
      check();return result;
    }finally{inflight.delete(controller);}
  }
  const readHarnessCandidateContext=async(context,scope)=>{
    try {
      context={...context};scope=structuredClone(scope);
      assertHarnessWorkspace(context);
      const lease=generation,currentApplication=application,configuration=readDeveloperConfiguration();
      if(!scope||scope.actualTaskId!==context.taskId||scope.scopeRef!==context.authorizationRef
        ||scope.deadline!==context.deadline||scope.workspaceRef!==configuration?.bindingId||!bound(scope.ownerTaskId)
        ||!/^[a-f0-9]{64}$/.test(scope.inputDigest)||!/^[a-f0-9]{64}$/.test(scope.configurationRef)
        ||typeof readHarnessVersions!=='function')return undefined;
      const versions=structuredClone(await readHarnessVersions());
      if(!versions||versions.executionKind!=='real_host')return undefined;
      const baseline=(await coding.captureCodingRepairSnapshot(boundRoot)).snapshot;
      const recipes=repairRecipes().map(recipe=>({...recipe,packageIds:baseline.packages.map(pkg=>pkg.id)}));
      if(!recipes.some(recipe=>recipe.required))return undefined;
      const currentVersions=await readHarnessVersions();
      assertHarnessWorkspace(context);
      if(lease!==generation||currentApplication!==application||configuration.bindingId!==readDeveloperConfiguration()?.bindingId
        ||!isDeepStrictEqual(versions,currentVersions))return undefined;
      const binding={version:1,taskId:scope.ownerTaskId,workspaceId:createHash('sha256').update(boundRoot).digest('hex'),
        baselineSnapshotId:baseline.snapshotId,inputDigest:scope.inputDigest,configurationDigest:scope.configurationRef,
        workflowVersion:versions.workflowVersion,runtimeVersion:versions.runtimeVersion,executionKind:versions.executionKind,
        recipeFingerprint:harnessCandidateRecipeFingerprint(recipes)};
      parseHarnessCandidateBinding({...binding,candidateId:'preflight',artifactId:'preflight',sessionId:'preflight',
        trialTaskId:context.taskId,artifactDigest:'0'.repeat(64),parentArtifactDigests:[]});
      return {binding,baseline,recipes,selectionPolicy:'unique_verified'};
    }catch{return undefined;}
  };
  function projectResult(tool,{taskId,proposalId,result,signal}) {
    if(signal.aborted)throw new ProtocolError('CANCELLED','Workspace result export cancelled');
    if(!(question?questionReady():consent?.cloudExportAllowed===true)||!enabled(tool)||!bound(taskId))
      throw new ProtocolError('UNAUTHORIZED','Workspace result export consent changed');
    if(tool.descriptor.name==='workspace.read_text') {
      const exported=currentWorkspaceReferenceExport();
      if(!exported)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Exact native-confirmed workspace read export is unavailable');
      const projection=exported.project({taskId,proposalId,result,signal});
      if(signal.aborted)throw new ProtocolError('CANCELLED','Workspace result export cancelled');
      if(!taskLive(taskId)||!enabled(tool))throw new ProtocolError('UNAUTHORIZED','Workspace result export consent changed');
      return projection;
    }
    validateToolValue(tool.descriptor.outputSchema,result);
    if(tool.descriptor.name==='workspace.node_check'||isProject(tool)||tool.descriptor.name==='workspace.git_diff_check') {
      const recipeId=tool.descriptor.name==='workspace.git_diff_check'?'git-diff-check':isProject(tool)
        ?tool.descriptor.name==='workspace.npm_build'?'npm-build':'npm-test':'node-check';
      if(result?.recipeId!==recipeId||!Number.isSafeInteger(result.exitCode))throw Error('命令结果无效');
      return {recipeId,exitCode:result.exitCode,passed:result.exitCode===0};
    }
    if(codingRepairExportOperation(tool.descriptor.name))return projectCodingRepairResult(tool.descriptor.name,result);
    if(tool.descriptor.name==='workspace.list_entries')return {listed:true,truncated:result.truncated};
    if(tool.descriptor.name==='workspace.preview_text_patch')return {previewed:true,changed:result.changed};
    if(tool.descriptor.name==='workspace.stage_text_patch')return {staged:true,changed:result.changed};
    if(tool.descriptor.name==='workspace.apply_text_patch')return {applied:result.applied,changed:result.changed};
    throw new ProtocolError('UNSUPPORTED_CAPABILITY','Workspace result export is unavailable');
  }
  return {tools,snapshot,readWorkspaceBinding,isWorkspaceBindingCurrent,readDeveloperConfiguration,harnessRepairHost,readHarnessCandidateContext,
    reconcileHarnessOriginalSession,readHarnessExperienceCurrentSync,
    prepareAuthorization:scope=>prepareQuestion(scope),
    prepareExport(scope) {
      if(!question)return;
      if(scope.phase==='preflight')prepareQuestion(scope,true);
      else if(prepared.has(JSON.stringify([scope.taskId,scope.runId])))preparedEntry(scope);
    },
    readWorkspaceExportConfigurationRef,readWorkspaceExportPreflightCandidate,
    readWorkspaceExportCandidate,readConfirmedWorkspaceExport,
    get patchReconciliation() { return applyHost ? patchReconciliation : undefined; },
    bindApplication(value){if(application && application!==value) revoke();application=value;
      if(typeof application?.configureCodingRepairSourceExport==='function')application.configureCodingRepairSourceExport(async input=>{
        if(input.signal.aborted||!(question?questionReady():consent?.cloudExportAllowed===true)||!bound(input.taskId)||!taskLive(input.taskId))
          throw new ProtocolError('UNAUTHORIZED','编程源码出机许可已失效');
        const query={taskId:input.taskId,proposalId:input.proposal.proposalId,path:input.proposal.arguments.path,configurationRef:readWorkspaceExportConfigurationRef()};
        const candidate=readWorkspaceExportCandidate(query);
        if(!candidate||candidate.runId!=='host-tool-'+input.localTaskId||candidate.toolName!=='coding.repair.read'
          ||!isDeepStrictEqual(input.receipt.result,readOriginalWorkspaceReceipt(query)?.result))
          throw new ProtocolError('UNAUTHORIZED','F15 原始源码读回不匹配');
        if(typeof requestWorkspaceExportPreflight!=='function'||typeof requestWorkspaceExportExact!=='function')
          throw new ProtocolError('UNSUPPORTED_CAPABILITY','F15 原生源码出机确认尚未接入');
        // This is the original Runtime local read identity, never a task/run
        // supplied by Renderer. Native consent must also verify its graph link
        // and consumed pre-execution receipt before minting the exact lease.
        if(question&&(!input.authorization||input.authorization.taskId!==input.localTaskId
          ||input.authorization.runId!==candidate.runId||typeof question.authorizeConsumedExport!=='function'))
          throw new ProtocolError('UNAUTHORIZED','缺少原源码读取的精确授权关联');
        const context={...(question?{authorization:{...input.authorization},result:structuredClone(input.receipt.result)}:{}),
          taskId:input.localTaskId,runId:candidate.runId,proposalId:input.proposal.proposalId,toolName:candidate.toolName,
          toolVersion:candidate.toolVersion,argumentsDigest:toolArgumentsDigest(candidate.arguments),signal:input.signal,deadline:input.deadline};
        await requestWorkspaceExportPreflight({...query,arguments:candidate.arguments},context);
        await requestWorkspaceExportExact({...query,arguments:candidate.arguments,contentDigest:candidate.contentDigest,byteLength:candidate.byteLength},context);
        const permission=readWorkspaceExportAuthorization({...query,arguments:candidate.arguments,contentDigest:candidate.contentDigest,byteLength:candidate.byteLength});
        if(!permission||permission.contentDigest!==candidate.contentDigest||!isDeepStrictEqual(candidate,readWorkspaceExportCandidate(query)))
          throw new ProtocolError('UNAUTHORIZED','F15 精确源码出机确认不匹配');
        return structuredClone(input.receipt.result);
      },input=>{
        if(input.signal.aborted||!(question?questionReady():consent?.cloudExportAllowed===true)||!bound(input.taskId)||!taskLive(input.taskId))
          throw new ProtocolError('UNAUTHORIZED','编程目录、诊断和 SHA 元数据出机许可已失效');
        if(question) {
          if(!input.authorization||typeof question.authorizeConsumedExport!=='function')
            throw new ProtocolError('UNAUTHORIZED','F15 元数据缺少原操作的精确授权绑定');
          const entry=preparedEntry({...input.authorization,signal:input.signal});
          if(input.stage==='completion') {
            if(entry.scope.toolName!=='coding.repair.start')throw new ProtocolError('UNAUTHORIZED','工作流汇总缺少原初始操作关联');
            validateToolValue(workspaceWorkflowSummaryProjectionSchema(),input.value);
            question.authorizeConsumedExport({...entry.scope,signal:input.signal},input.value,'workspace-workflow-summary-export');
            return structuredClone(input.value);
          }
          if(!['initial','receipt'].includes(input.stage))throw new ProtocolError('UNAUTHORIZED','缺少原工作流元数据阶段');
          let result=input.value;
          if(input.stage==='initial') {
            if(entry.scope.toolName!=='coding.repair.start')throw new ProtocolError('UNAUTHORIZED','工作流初始关联不匹配');
            if(!result||typeof result!=='object'||Array.isArray(result)||typeof result.goal!=='string'
              ||!Object.hasOwn(result,'codingRepair')||Object.keys(result).some(key=>!['goal','codingRepair','executionModel'].includes(key)))
              throw new ProtocolError('UNAUTHORIZED','F15 初始元数据不匹配原固定结构');
            result=result.codingRepair;
          }
          let projection;
          if(entry.decision) {
            if(input.stage!=='receipt')throw new ProtocolError('UNAUTHORIZED','本地判断只能导出原确认回执');
            validateToolValue(decisionProjectionSchema(entry.decision),result);
            projection={selectedId:result.selectedId};
          }else projection=projectCodingRepairResult(entry.scope.toolName,result);
          question.authorizeConsumedExport({...entry.scope,signal:input.signal},projection,'workspace-metadata-export');
          return input.stage==='initial'?{...input.value,codingRepair:projection}:projection;
        }
      });},
    async select() {
      const startedGeneration=beginSelection();
      const selected=await selectDirectory();
      checkSelection(startedGeneration);
      if (!selected) return {...snapshot(),selectionCancelled:true};
      const root=directory(selected);
      let node;
      try {node=savedNode?fixedNode(savedNode,root):undefined;} catch {node=undefined;}
      let npmCli;
      try {npmCli=savedNpmCli?fixedNpmCli(savedNpmCli,root):undefined;} catch {npmCli=undefined;}
      persist(root,node,undefined,npmCli);revoke();savedRoot=root;savedNode=node;savedCheckFile=undefined;savedNpmCli=npmCli;
      commandFailure='';projectFailure='';return snapshot();
    },
    async selectNode() {
      const startedGeneration=beginSelection();
      if(!savedRoot || typeof selectNodeExecutable!=='function') throw Error('请先选择工作区并使用本机 Node 选择器');
      const selected=await selectNodeExecutable();checkSelection(startedGeneration);if(!selected) return {...snapshot(),selectionCancelled:true};
      const node=fixedNode(selected,savedRoot);
      const npmCli=derivedNpmCli(node,savedRoot);
      persist(savedRoot,node,savedCheckFile,npmCli);revoke();savedNode=node;savedNpmCli=npmCli;
      commandFailure='';projectFailure='';return snapshot();
    },
    async selectCheckFile() {
      const startedGeneration=beginSelection();
      if(!savedRoot || typeof selectCheckFile!=='function') throw Error('请先选择工作区并使用本机文件选择器');
      const selected=await selectCheckFile(savedRoot);checkSelection(startedGeneration);if(!selected) return {...snapshot(),selectionCancelled:true};
      const relative=checkFile(selected,savedRoot);
      persist(savedRoot,savedNode,relative,savedNpmCli);revoke();savedCheckFile=relative;commandFailure='';return snapshot();
    },
    async selectNpmCli() {
      const startedGeneration=beginSelection();
      if(!savedRoot || !savedNode || typeof selectNpmCli!=='function') throw Error('请先选择工作区与 Node');
      const selected=await selectNpmCli();checkSelection(startedGeneration);if(!selected) return {...snapshot(),selectionCancelled:true};
      const npmCli=fixedNpmCli(selected,savedRoot);
      persist(savedRoot,savedNode,savedCheckFile,npmCli);revoke();savedNpmCli=npmCli;
      projectFailure='';return snapshot();
    },
    async authorize(input) {
      if(question)throw new ProtocolError('UNAUTHORIZED','请在当前对话提问卡授权此操作');
      if (!input || Array.isArray(input) || typeof input.cloudExportAllowed!=='boolean' || typeof input.writeAllowed!=='boolean'
        || typeof input.commandAllowed!=='boolean'
        || (input.projectCodeAllowed!==undefined && typeof input.projectCodeAllowed!=='boolean')
        || Object.keys(input).some(k=>!['cloudExportAllowed','writeAllowed','commandAllowed','projectCodeAllowed'].includes(k))) throw Error('请确认工作区权限');
      if (!active || !selectionsCurrent() || !identityCurrent() || !tools.length) throw Error('请先选择目录并重启完成装配');
      if(input.projectCodeAllowed===true && (!input.commandAllowed || !snapshot().projectScriptsAvailable)) {
        throw Error('项目构建和测试尚未准备好，不能授权执行');
      }
      revoke();consent={...input};
      if(input.cloudExportAllowed&&input.writeAllowed&&input.commandAllowed) {
        try{if(coding.hasPreparedCodingDependenciesSync(boundRoot)) {
          const lease=generation,controller=new AbortController();inflight.add(controller);
          dependencyPreparation=coding.capturePreparedDependencyFingerprint(boundRoot,{signal:controller.signal})
            .then(value=>{if(lease===generation)dependencyFingerprint=value;})
            .catch(error=>{if(lease===generation)dependencyPreparationReason=error instanceof ProtocolError?error.message:'原项目的锁定依赖尚未安全准备好';})
            .finally(()=>{inflight.delete(controller);if(lease===generation)dependencyPreparation=undefined;});
        }}
        catch(error){dependencyPreparationReason=error instanceof ProtocolError?error.message:'原项目的锁定依赖尚未安全准备好';}
      }
      if(dependencyPreparation) {
        const lease=generation;
        await dependencyPreparation;
        if(lease!==generation||!active)throw new ProtocolError('UNAUTHORIZED','原工作区授权已撤销');
      }
      return snapshot();
    },
    revoke,
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
      publicEnumPaths:tool.descriptor.name==='coding.repair.start'?['/mode']:tool.descriptor.name==='coding.repair.publish'?['/version']:[],
      available:({taskId,signal})=>!signal.aborted && (question?questionReady():consent?.cloudExportAllowed===true) && enabled(tool) && bound(taskId,true)})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
      exportPolicyVersion:codingRepairExportOperation(tool.descriptor.name)?'coding-repair-metadata-v1':isProject(tool)?'authorized-project-script-redacted-v1'
        :tool.descriptor.name==='workspace.node_check'
          ? 'authorized-node-check-redacted-v1':tool.descriptor.name==='workspace.read_text'
            ? 'workspace-reference-3.0.0':'coding-local-result-redacted-v2',
      accepts:input=> {
        if(!(question?questionReady():consent?.cloudExportAllowed===true) || !enabled(tool) || !bound(input.taskId)) return false;
        if(question)try {
          const entry=preparedEntry(input);if(entry.argumentsDigest!==toolArgumentsDigest(input.arguments))return false;
          if(input.phase==='final') {
            question.currentRequirement({...entry.scope,signal:input.signal??entry.scope.signal},'workspace-session');
            if(tool.descriptor.name!=='workspace.read_text') {
              if(!entry.projectionDigest||entry.projectionDigest!==hash(input.projection))return false;
              question.currentRequirement({...entry.scope,signal:input.signal??entry.scope.signal},'workspace-export');
            }
          }
        }catch{return false;}
        if(tool.descriptor.name!=='workspace.read_text') return true;
        try {
          if(!['preflight','final'].includes(input.phase)) return false;
          const candidate=readWorkspaceExportPreflightCandidate({taskId:input.taskId,proposalId:input.proposalId,
            path:input.arguments?.path,configurationRef:readWorkspaceExportConfigurationRef()});
          return Boolean(candidate && isDeepStrictEqual(candidate.arguments,input.arguments)
            && currentWorkspaceReferenceExport()?.accepts(input));
        } catch {return false;}
      },
      project:scope=> {
        const entry=question?preparedEntry(scope):undefined;
        if(entry)question.currentRequirement({...entry.scope,signal:scope.signal},'workspace-session');
        const projection=projectResult(tool,scope);
        if(entry&&tool.descriptor.name!=='workspace.read_text') {
          question.authorizeExport({...entry.scope,signal:scope.signal},projection,'workspace-export');
          const digest=hash(projection);if(entry.projectionDigest&&entry.projectionDigest!==digest)
            throw new ProtocolError('UNAUTHORIZED','不能替换原工作区结果投影');
          entry.projectionDigest=digest;
        }
        return projection;
      }})),
    close(){active=false;revoke(false);applyHost?.close();},
  };
}

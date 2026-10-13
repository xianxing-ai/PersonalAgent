import {existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
import {PROTOCOL_VERSION, ProtocolError, validateToolValue} from '@personal-agent/contracts';
import * as coding from '@personal-agent/coding-tools';
import {createDesktopCodingToolHost} from './coding-tool-host.js';
import {findWindowsExecutable} from './windows-executable-discovery.js';

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
$target=[Console]::In.ReadToEnd()
$self=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=[System.Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($self)
$acl.SetAccessRuleProtection($true,$false)
$rule=[System.Security.AccessControl.FileSystemAccessRule]::new($self,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $target -AclObject $acl`;
    execFileSync(powerShell, ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',
      Buffer.from(script,'utf16le').toString('base64')],
    {input:target,encoding:'utf8',windowsHide:true,timeout:10000,stdio:['pipe','pipe','pipe']});
  }
  return target;
}

/** Persist only a selected directory. Execution/export consent expires with this process.
 * Registered implementations stay pinned until restart; changing settings revokes them first.
 */
export function createWorkspaceConfigHost({userData,safeStorage,selectDirectory,
  selectNodeExecutable,selectCheckFile,selectNpmCli,jobHelperExecutable,patchHelperScriptPath,
  projectScriptEnvSource,createCommandRecipeTool,createWorkspaceReferenceExport,
  readWorkspaceExportPreflight,readWorkspaceExportAuthorization}) {
  const file = path.join(userData,'coding-workspace.json');
  let savedRoot,savedNode,savedCheckFile,savedNpmCli,boundRoot,boundNode,boundCheckFile,boundNpmCli,boundProjectHelper,rootIdentity,nodeIdentity,application,active=true,consent,applyHost,failure='',commandFailure='',projectFailure='';
  let generation=randomUUID();
  const implementations=[];
  const commandReadiness=new Map();
  const inflight=new Set();
  const workspaceExportProposals=new Map();
  const confirmedWorkspaceReads=new Map();
  let workspaceReferenceExport;
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
      const pwsh=findWindowsExecutable('pwsh.exe',discovery);
      if (pwsh) {
        try {
          applyHost=createDesktopCodingToolHost({workspaceRoot:boundRoot,authorizedWorkspaceRoot:boundRoot,
            recoveryRootPath:recoveryDirectory(userData,boundRoot,pwsh),powerShellPath:pwsh,
            ...(patchHelperScriptPath===undefined?{}:{helperScriptPath:patchHelperScriptPath}),
            createWorkspacePatchApplyTool:coding.createWorkspacePatchApplyTool,
            reconcileWorkspacePatchApply:coding.reconcileWorkspacePatchApply});
          implementations.push(...applyHost.tools);
        } catch {failure='读取和候选生成可用；安全应用补丁所需的目录或 PowerShell 检查未通过';}
      } else failure='读取和候选生成可用；安全应用补丁需要 PowerShell 7';
      const git=findWindowsExecutable('git.exe',discovery);
      if (git) {
        const command=coding.createWorkspaceCommandTool({rootPath:boundRoot,recipes:[{id:'git-diff-check',
          executable:git,args:['--no-pager','-c','core.fsmonitor=false','diff','--no-ext-diff','--no-textconv','--check']}],
          maxOutputBytes:4096,maxDurationMs:30000});
        implementations.push({descriptor:{...command.descriptor,name:'workspace.git_diff_check',
          inputSchema:{type:'object',properties:{},additionalProperties:false}},
          execute:(_input,context) => command.execute({recipeId:'git-diff-check'},context)});
      }
      let helper;
      if(jobHelperExecutable) {
        try {
          helper=outsideFile(jobHelperExecutable,boundRoot,'项目命令');
          if(path.basename(helper).toLowerCase()!=='windowsjobprocesshost.exe') throw Error();
          boundProjectHelper=helper;
        } catch {projectFailure='项目命令所需的本机组件不可用';}
      }
      const projectRequested=Boolean(helper && savedNpmCli);
      if (savedNode && (savedCheckFile || projectRequested) && typeof createCommandRecipeTool==='function') {
        try {
          const commandImplementations=[];
          const options={workspaceRoot:boundRoot,authorizedWorkspaceRoot:boundRoot,
            nodeExecutable:savedNode,checkFiles:[{id:'node-check',path:savedCheckFile}],
            allowProjectScripts:projectRequested,jobHelperExecutable:helper,npmCliPath:savedNpmCli,
            projectScriptEnvSource,maxOutputBytes:4096,maxDurationMs:30000,required:false};
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
              || nodeRecipe.args?.length!==2 || nodeRecipe.args[0]!=='--check'
              || nodeRecipe.args[1]!==savedCheckFile) throw Error();
            commandImplementations.push({descriptor:{...recipe.tool.descriptor,name:'workspace.node_check',
              inputSchema:{type:'object',properties:{},additionalProperties:false}},
              execute:(_input,context)=>recipe.tool.execute({recipeId:'node-check'},context)});
          }
          if(projectRequested && recipe.diagnostics?.projectScriptsExposed===true) {
            for(const [id,name,script] of [['npm-build','workspace.npm_build','build'],
              ['npm-test','workspace.npm_test','test']]) {
              const fixed=recipe.recipes.find(item=>item.id===id);
              if(!fixed) continue;
              if(fixed.executable!==helper || !Array.isArray(fixed.args)
                || fixed.args.length!==8 || fixed.args[0]!=='--cwd' || fixed.args[1]!==boundRoot
                || fixed.args[2]!=='--exe' || fixed.args[3]!==savedNode
                || fixed.args[4]!=='--' || fixed.args[5]!==savedNpmCli
                || fixed.args[6]!=='run' || fixed.args[7]!==script) throw Error();
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
        } catch {commandFailure='Node 检查装配失败；读取和其他已配置能力仍可用';}
      } else if (savedNode && (savedCheckFile || projectRequested)) commandFailure='命令实现尚未接入；读取和其他已配置能力仍可用';
      if(savedNpmCli && !projectRequested && !projectFailure) projectFailure='项目构建与测试尚未准备好';
    } catch {implementations.length=0; failure='选定工作区无法安全装配，请重新选择目录';}
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
  // Trusted main-process configuration only. A getter cannot grant read or
  // execute permission, and this record must not enter Renderer/cloud output.
  const readWorkspaceBinding=() => {
    if(!active || !consent || !selectionsCurrent() || !identityCurrent()
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
  const enabled=tool => active && Boolean(consent) && selectionsCurrent() && identityCurrent()
    && commandReady(tool)
    && (tool.descriptor.sideEffect==='read' || (consent.cloudExportAllowed===true && (isProject(tool)
      ? consent.commandAllowed===true && consent.projectCodeAllowed===true && projectIdentityCurrent()
      : ['workspace.git_diff_check','workspace.node_check'].includes(tool.descriptor.name)
        ? consent.commandAllowed===true : consent.writeAllowed===true)))
    && (tool.descriptor.name!=='workspace.apply_text_patch' || applyHost?.available());
  const bound=(taskId, claim=false) => {
    if (!application || !taskId) return false;
    const key='desktop-coding-scope';
    const previous=application.runtime.loadCheckpoint(taskId,key);
    if (previous===undefined && claim) application.runtime.saveCheckpoint(taskId,key,generation);
    return application.runtime.loadCheckpoint(taskId,key)===generation;
  };
  // These ports are Main-only. Session scope never grants PUBLIC export, and
  // only the original Runtime result checkpoint supplies bytes for confirmation.
  const readTool=implementations.find(tool=>tool.descriptor.name==='workspace.read_text');
  const readWorkspaceExportConfigurationRef=() => consent?.cloudExportAllowed===true && readTool && enabled(readTool) ? generation : undefined;
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
    return original ? Object.freeze({query:Object.freeze({...query}),runId:original.runId,
      toolName:original.proposal.toolName,toolVersion:original.proposal.toolVersion,
      arguments:Object.freeze(structuredClone(original.proposal.arguments)),deadline:original.deadline}) : undefined;
  };
  const readOriginalWorkspaceReceipt=query => {
    try {
      const original=readOriginalWorkspaceProposal(query),runtime=application?.runtime;
      if(!original) return undefined;
      const {runId,proposal,deadline,task}=original;
      const key=JSON.stringify([query.taskId,query.proposalId]),saved=confirmedWorkspaceReads.get(key);
      const records=runtime.readToolExecutions(query.taskId).filter(record=>record.evidenceId===runId);
      const record=records[0];
      if(records.length!==1 || record.taskId!==query.taskId || record.protocolVersion!==PROTOCOL_VERSION
        || record.toolName!==proposal.toolName || record.toolVersion!==proposal.toolVersion
        || record.state!=='confirmed' || record.policyDecision!=='allow' || record.executionStarted!==true
        || !Number.isFinite(Date.parse(record.startedAt)) || !Number.isFinite(Date.parse(record.finishedAt))
        || Date.parse(record.finishedAt)<Date.parse(record.startedAt) || Date.parse(record.finishedAt)>Date.now()
        || Date.parse(record.finishedAt)>Date.parse(deadline)
        || !runtime.matchesToolExecutionInput(record,{arguments:proposal.arguments,scopeRef:runId})
        || !task.evidenceRefs.includes(runId)) return undefined;
      const evidence=runtime.readEvidence(query.taskId).filter(item=>item.evidenceId===runId);
      if(evidence.length!==1 || evidence[0].kind!=='execution' || evidence[0].sourceRef!==proposal.toolName
        || evidence[0].capturedAt!==record.finishedAt) return undefined;
      const checkpoint=runtime.loadCheckpoint(query.taskId,`tool-result-${runId}`);
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
    return original ? Object.freeze({query:Object.freeze({...query}),runId:original.runId,
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
    const controller=new AbortController();inflight.add(controller);
    try {return await tool.execute(input,{...context,signal:AbortSignal.any([context.signal,controller.signal])});}
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
    projectReason:projectFailure || (tools.some(tool=>isProject(tool) && !commandReady(tool))
      ?'项目命令文件或配置已变化，请重启应用重新装配':''),
    readAvailable:tools.some(tool=>tool.descriptor.name==='workspace.read_text') && enabled(tools[0]),
    writeAvailable:tools.some(tool=>tool.descriptor.name==='workspace.apply_text_patch' && enabled(tool)),
    commandAvailable:tools.some(tool=>['workspace.git_diff_check','workspace.node_check'].includes(tool.descriptor.name) && enabled(tool)),
    cloudExportAllowed:consent?.cloudExportAllowed===true,
    authorizationAvailable:active && selectionsCurrent() && identityCurrent() && tools.length>0,
    writeAllowed:consent?.writeAllowed===true,
    commandAllowed:consent?.commandAllowed===true,
    reason:!selectionsCurrent()?'工作区设置已保存，请重启应用完成工具装配后授权':failure || (consent
      ? '当前工作区已授权；受限命令仍经过 Policy，项目脚本另需明确许可'
      : savedRoot?'请为本次应用会话授权工作区；重启后需要重新授权':'请选择编程工作区')});
  const revoke=() => {
    consent=undefined;generation=randomUUID();
    try {workspaceReferenceExport?.dispose();} catch { /* No host details escape. */ }
    workspaceReferenceExport=undefined;workspaceExportProposals.clear();confirmedWorkspaceReads.clear();
    for (const controller of inflight) controller.abort();
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
  return {tools,snapshot,readWorkspaceBinding,isWorkspaceBindingCurrent,
    readWorkspaceExportConfigurationRef,readWorkspaceExportPreflightCandidate,
    readWorkspaceExportCandidate,readConfirmedWorkspaceExport,
    get patchReconciliation() { return applyHost ? patchReconciliation : undefined; },
    bindApplication(value){if(application && application!==value) revoke();application=value;},
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
    authorize(input) {
      if (!input || Array.isArray(input) || typeof input.cloudExportAllowed!=='boolean' || typeof input.writeAllowed!=='boolean'
        || typeof input.commandAllowed!=='boolean'
        || (input.projectCodeAllowed!==undefined && typeof input.projectCodeAllowed!=='boolean')
        || Object.keys(input).some(k=>!['cloudExportAllowed','writeAllowed','commandAllowed','projectCodeAllowed'].includes(k))) throw Error('请确认工作区权限');
      if (!active || !selectionsCurrent() || !identityCurrent() || !tools.length) throw Error('请先选择目录并重启完成装配');
      if(input.projectCodeAllowed===true && (!input.commandAllowed || !snapshot().projectScriptsAvailable)) {
        throw Error('项目构建和测试尚未准备好，不能授权执行');
      }
      revoke();consent={...input};return snapshot();
    },
    revoke,
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
      available:({taskId,signal})=>!signal.aborted && consent?.cloudExportAllowed===true && enabled(tool) && bound(taskId,true)})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
      exportPolicyVersion:isProject(tool)?'authorized-project-script-redacted-v1'
        :tool.descriptor.name==='workspace.node_check'
          ? 'authorized-node-check-redacted-v1':tool.descriptor.name==='workspace.read_text'
            ? 'workspace-reference-3.0.0':'coding-local-result-redacted-v2',
      accepts:input=> {
        if(consent?.cloudExportAllowed!==true || !enabled(tool) || !bound(input.taskId)) return false;
        if(tool.descriptor.name!=='workspace.read_text') return true;
        try {
          if(!['preflight','final'].includes(input.phase)) return false;
          const candidate=readWorkspaceExportPreflightCandidate({taskId:input.taskId,proposalId:input.proposalId,
            path:input.arguments?.path,configurationRef:generation});
          return Boolean(candidate && isDeepStrictEqual(candidate.arguments,input.arguments)
            && currentWorkspaceReferenceExport()?.accepts(input));
        } catch {return false;}
      },
      project:({taskId,proposalId,result,signal})=> {
        if(signal.aborted) throw new ProtocolError('CANCELLED','Workspace result export cancelled');
        if(consent?.cloudExportAllowed!==true || !enabled(tool) || !bound(taskId)) throw new ProtocolError('UNAUTHORIZED','Workspace result export consent changed');
        if (tool.descriptor.name==='workspace.node_check' || isProject(tool)) {
          const recipeId=isProject(tool)
            ? tool.descriptor.name==='workspace.npm_build'?'npm-build':'npm-test':'node-check';
          if (result?.recipeId!==recipeId || !Number.isSafeInteger(result.exitCode)) throw Error('命令结果无效');
          return {recipeId,exitCode:result.exitCode,passed:result.exitCode===0};
        }
        // Session read consent permits local execution, not PUBLIC source export.
        // Keep the real RegisteredTool result local; never relabel it as MCP data.
        if(tool.descriptor.name==='workspace.read_text') {
          const exported=currentWorkspaceReferenceExport();
          if(!exported) throw new ProtocolError('UNSUPPORTED_CAPABILITY','Exact native-confirmed workspace read export is unavailable');
          const projection=exported.project({taskId,proposalId,result,signal});
          if(signal.aborted) throw new ProtocolError('CANCELLED','Workspace result export cancelled');
          if(!taskLive(taskId) || !enabled(tool)) throw new ProtocolError('UNAUTHORIZED','Workspace result export consent changed');
          return projection;
        }
        validateToolValue(tool.descriptor.outputSchema,result);
        if(tool.descriptor.name==='workspace.git_diff_check') {
          if(result.recipeId!=='git-diff-check') throw Error('命令结果无效');
          return {recipeId:'git-diff-check',exitCode:result.exitCode,passed:result.exitCode===0};
        }
        if(tool.descriptor.name==='workspace.list_entries') return {listed:true,truncated:result.truncated};
        if(tool.descriptor.name==='workspace.preview_text_patch') return {previewed:true,changed:result.changed};
        if(tool.descriptor.name==='workspace.stage_text_patch') return {staged:true,changed:result.changed};
        if(tool.descriptor.name==='workspace.apply_text_patch') return {applied:result.applied,changed:result.changed};
        throw new ProtocolError('UNSUPPORTED_CAPABILITY','Workspace result export is unavailable');
      }})),
    close(){active=false;revoke();applyHost?.close();},
  };
}

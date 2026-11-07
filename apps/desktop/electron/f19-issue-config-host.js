import {constants,existsSync,closeSync,fstatSync,lstatSync,mkdirSync,openSync,readFileSync,readSync,realpathSync,renameSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import {createDesktopF19IssueRepairPorts} from './f19-issue-repair-ports.js';
import {F19_PUBLICATION_INPUT} from './f19-publication-host.js';

const fail=()=>{throw new ProtocolError('UNAUTHORIZED','原生 F19 Issue、独立回归或工作区配置已失效');};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const text={type:'string',minLength:1,maxLength:1024};
const schema=object({selection:object({repo:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$'},
  issueId:{type:'integer',minimum:1},expectedUpdatedAt:{type:'string',format:'date-time'},
  allowedPaths:{type:'array',minItems:1,maxItems:64,uniqueItems:true,items:text},...F19_PUBLICATION_INPUT}),
  regression:object({rootPath:text,sourceBranch:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$'},
    checkerPath:text,checkerSha256:{type:'string',pattern:'^[a-f0-9]{64}$'}})});
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const outside=(root,target)=>{const value=path.relative(root,target);return value==='..'||value.startsWith('..'+path.sep)||path.isAbsolute(value);};
function canonical(file,directory=false,parents=new Set()){
  if(typeof file!=='string'||!path.isAbsolute(file)||!same(realpathSync.native(file),path.resolve(file)))fail();
  const stat=lstatSync(file);if(stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile()||stat.nlink!==1))fail();
  if(directory)parents.add(file);
  for(let parent=path.dirname(file);;parent=path.dirname(parent)){
    if(parents.has(parent))break;
    const entry=lstatSync(parent);if(entry.isSymbolicLink()||!entry.isDirectory())fail();parents.add(parent);
    if(parent===path.dirname(parent))break;
  }
}
function readJson(file){
  canonical(file);const before=lstatSync(file),fd=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>65536||stat.dev!==before.dev||stat.ino!==before.ino)fail();
    const bytes=Buffer.alloc(65537);let size=0,count;
    while(size<bytes.length&&(count=readSync(fd,bytes,size,bytes.length-size,null))>0)size+=count;
    const after=fstatSync(fd);canonical(file);const current=lstatSync(file);
    if(size>65536||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs
      ||current.dev!==after.dev||current.ino!==after.ino)fail();
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size)));
  }finally{closeSync(fd);}
}

/** Native preference only: no credentials, task/run, execution result, grants,
 * executable or arbitrary argv can enter through the selected JSON. */
export function createF19IssueConfiguration({userData,safeStorage,readWorkspace,readRepositoryBinding,selectFile}={}){
  if(!path.isAbsolute(userData??'')||typeof safeStorage?.isEncryptionAvailable!=='function'
    ||typeof safeStorage.encryptString!=='function'||typeof safeStorage.decryptString!=='function'
    ||typeof readWorkspace!=='function'||typeof readRepositoryBinding!=='function')fail();
  const file=path.join(userData,'f19-issue-selection.json');let saved,closed=false;
  const environment=()=>{
    const workspace=readWorkspace(),repository=readRepositoryBinding();
    if(!workspace?.bindingId||!path.isAbsolute(workspace.rootPath??'')||!Array.isArray(workspace.command?.recipeIds)
      ||!repository?.repository||!repository.bindingId)fail();
    return {workspace:{bindingId:workspace.bindingId,rootPath:workspace.rootPath},repository:{repository:repository.repository,bindingId:repository.bindingId}};
  };
  function valid(record,parents=new Set()){
    if(!record||Object.keys(record).sort().join(',')!=='configuration,environment,revision,version'||record.version!==1
      ||typeof record.revision!=='string'||!record.revision||!isDeepStrictEqual(record.environment,environment()))fail();
    validateToolValue(schema,record.configuration);
    const {selection,regression}=record.configuration;
    if(selection.repo!==record.environment.repository.repository||!Number.isFinite(Date.parse(selection.expectedUpdatedAt))
      ||!readWorkspace().command.recipeIds.includes(selection.verificationRecipeId)
      ||selection.allowedPaths.some(value=>value.includes('\\')||value.includes(':')||value.split('/').some(part=>!part||part==='.'||part==='..'||part==='.git'))
      ||[selection.publication.branch,selection.publication.base,regression.sourceBranch].some(value=>value.includes('..')||value.split('/').some(part=>!part||part.startsWith('.')||part.endsWith('.')||part.endsWith('.lock'))))fail();
    canonical(regression.rootPath,true,parents);canonical(regression.checkerPath,false,parents);
    const workspace=record.environment.workspace.rootPath;
    if(!outside(workspace,regression.rootPath)||!outside(regression.rootPath,workspace)
      ||!outside(workspace,regression.checkerPath)||!outside(regression.rootPath,regression.checkerPath)
      ||lstatSync(regression.checkerPath).size>1048576
      ||createHash('sha256').update(readFileSync(regression.checkerPath)).digest('hex')!==regression.checkerSha256)fail();
    return record;
  }
  try{
    if(existsSync(file)&&safeStorage.isEncryptionAvailable()){
      canonical(userData,true);const envelope=readJson(file);
      if(envelope.version!==1||typeof envelope.encrypted!=='string'||Object.keys(envelope).sort().join(',')!=='encrypted,version')fail();
      saved=valid(JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted,'base64'))));
    }
  }catch{saved=undefined;}
  const selection=()=>{
    if(closed||!safeStorage.isEncryptionAvailable())fail();
    if(!saved||!isDeepStrictEqual(saved.environment,environment()))fail();return saved;
  };
  const current=()=>{
    // Share checked ancestors only within this synchronous validation, never across calls.
    const parents=new Set();canonical(userData,true,parents);return valid(selection(),parents);
  };
  const host={
    async selectFromNativeDialog(){
      if(closed||typeof selectFile!=='function')fail();
      const original=environment(),revision=saved?.revision,selected=await selectFile();if(!selected)return {cancelled:true};
      if(closed||revision!==saved?.revision||!isDeepStrictEqual(original,environment()))fail();
      const configuration=readJson(selected);
      if(!isDeepStrictEqual(original,environment()))fail();return host.configureFromNativeSelection(configuration);
    },
    configureFromNativeSelection(configuration){
      if(closed||!safeStorage.isEncryptionAvailable())fail();
      const next=valid({version:1,revision:randomUUID(),environment:environment(),configuration:structuredClone(configuration)});
      const encrypted=safeStorage.encryptString(JSON.stringify(next)).toString('base64');
      const envelope=JSON.stringify({version:1,encrypted});if(Buffer.byteLength(envelope)>65536)fail();
      mkdirSync(userData,{recursive:true});canonical(userData,true);
      const temporary=file+'.'+randomUUID()+'.tmp',fd=openSync(temporary,'wx',0o600);
      try{writeFileSync(fd,envelope,'utf8');}finally{closeSync(fd);}
      canonical(userData,true);renameSync(temporary,file);saved=next;return host.snapshot();
    },
    snapshot(){try{const value=current();return {configured:true,revision:value.revision,repo:value.configuration.selection.repo,
      issueId:value.configuration.selection.issueId};}catch{return {configured:false};}},
    createPorts(options={}){
      let record;try{record=structuredClone(current());}catch{return createDesktopF19IssueRepairPorts();}
      const assertCurrent=scope=>{
        if(scope.signal.aborted||!Number.isFinite(Date.parse(scope.deadline))||Date.now()>=Date.parse(scope.deadline)
          ||!isDeepStrictEqual(record,selection()))fail();
      };
      // Binding reads recheck the private immutable selection/revision. Effect guards
      // still revalidate all live paths and hashes, including after approval awaits.
      const configurationRef=hash(record),guard=scope=>{assertCurrent(scope);current();options.publication.assertCurrent(scope);};
      return createDesktopF19IssueRepairPorts({...options,closeIssue:true,
        selection:{configurationRef,assertCurrent,readSelection:async scope=>{assertCurrent(scope);return structuredClone(record.configuration.selection);}},
        publication:{...options.publication,configurationRef,assertCurrent:guard},
        regression:{...record.configuration.regression,configurationRef,assertCurrent:guard,
          nodeExecutable:options.nodeExecutable,native:options.nativeExecutionHost}});
    },
    close(){closed=true;},
  };return host;
}

/** Actual Main adapter over existing workspace/developer/native hosts. Runtime
 * is retrieved lazily; absence of any original provider stays unavailable. */
export function createConfiguredDesktopF19IssueRepairPorts({getApplication,codingWorkspace,developerDeployment,issueConfiguration,
  nativeExecutionHost,authorizeExport,requestPresence,now=()=>new Date()}={}){
  const missing=()=>({tools:[],configuredWorkflowWorkerPorts:[],unavailable:['f19_native_issue_configuration_or_developer_binding_unavailable']});
  const workspace=codingWorkspace?.readDeveloperConfiguration?.(),native=codingWorkspace?.readWorkspaceBinding?.();
  const deployment=developerDeployment?.snapshot?.(),host=developerDeployment?.host;
  if(!workspace?.bindingId||!native?.nodeExecutable||native.rootPath!==workspace.rootPath||typeof workspace.assertCurrent!=='function'
    ||deployment?.configured!==true||deployment.state!=='configured'||!deployment.repository
    ||typeof host?.createF18F19Tools!=='function'||typeof host.readF16PublicationConfiguration!=='function'
    ||typeof host.configureF19Publication!=='function'||typeof nativeExecutionHost?.createCommandTool!=='function'
    ||typeof issueConfiguration?.createPorts!=='function'||typeof getApplication!=='function'
    ||typeof authorizeExport!=='function'||typeof requestPresence!=='function')return missing();
  const pins={workspaceBinding:workspace.bindingId,rootPath:workspace.rootPath,native:structuredClone(native),repository:deployment.repository};
  const current=scope=>{
    const taskId=scope.parentTaskId??scope.taskId,application=getApplication(),latest=codingWorkspace.readDeveloperConfiguration();
    const status=developerDeployment.snapshot();
    if(!application||scope.signal.aborted||!Number.isFinite(Date.parse(scope.deadline))||now().getTime()>=Date.parse(scope.deadline)
      ||latest?.bindingId!==pins.workspaceBinding||latest.rootPath!==pins.rootPath
      ||!isDeepStrictEqual(codingWorkspace.readWorkspaceBinding(),pins.native)||developerDeployment.host!==host
      ||status.configured!==true||status.state!=='configured'||status.repository!==pins.repository)fail();
    const task=application.runtime.getTask(taskId);
    if(task.cancelRequested||!['running','waiting_approval'].includes(task.state)
      ||application.runtime.loadCheckpoint(taskId,'application-deadline')!==scope.deadline||!application.readToolConversation(taskId))fail();
    const result=latest.assertCurrent({...scope,taskId});if(result!==undefined){void Promise.resolve(result).catch(()=>{});fail();}
  };
  try{
    const ports=issueConfiguration.createPorts({getApplication,authorizeExport,now,nodeExecutable:native.nodeExecutable,nativeExecutionHost,
      github:{assertCurrent:current,createTools:options=>host.createF18F19Tools(options)},
      publication:{assertCurrent:current,readConfiguration:scope=>host.readF16PublicationConfiguration(scope?{...scope,taskId:scope.parentTaskId??scope.taskId}:undefined),requestPresence}});
    if(!ports.publication||ports.configuredWorkflowWorkerPorts?.length!==1)return missing();
    host.configureF19Publication(ports.publication);return ports;
  }catch{return missing();}
}

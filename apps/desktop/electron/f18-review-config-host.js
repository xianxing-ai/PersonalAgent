import {constants,existsSync,closeSync,fstatSync,lstatSync,mkdirSync,openSync,readSync,realpathSync,renameSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import {GITHUB_CONNECTOR_VERSION} from '@personal-agent/github';
import {createDesktopF18F19WorkflowPorts} from './f18-f19-workflow-ports.js';

const fail=()=>{throw new ProtocolError('UNAUTHORIZED','原生 PR 选择、仓库配置或修订已失效');};
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const sha={type:'string',pattern:'^(?:[a-f0-9]{40}|[a-f0-9]{64})$'};
const schema=object({selection:object({repo:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$'},
  prNumber:{type:'integer',minimum:1},headSha:sha,baseSha:sha,mergeMethod:{enum:['merge','squash','rebase']}}),
  requiredChecks:{type:'array',minItems:1,maxItems:64,uniqueItems:true,items:{type:'string',minLength:1,maxLength:256}},
  eligibleReviewers:{type:'array',minItems:1,maxItems:64,uniqueItems:true,items:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'}}});

/** Main-only native preference source. Configuration contains no result,
 * approval, credential or task/run identity and grants no permission. */
export function createF18ReviewConfiguration({userData,safeStorage,readRepositoryBinding}={}){
  if(!path.isAbsolute(userData??'')||typeof safeStorage?.isEncryptionAvailable!=='function'
    ||typeof safeStorage.encryptString!=='function'||typeof safeStorage.decryptString!=='function'||typeof readRepositoryBinding!=='function')fail();
  const file=path.join(userData,'f18-review-selection.json');let saved,closed=false;
  const assertDirectory=()=>{
    const canonical=realpathSync.native(userData),resolved=path.resolve(userData);
    if(process.platform==='win32'?canonical.toLowerCase()!==resolved.toLowerCase():canonical!==resolved)fail();
    for(let directory=userData;;directory=path.dirname(directory)){
      const stat=lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())fail();
      if(directory===path.dirname(directory))break;
    }
  };
  const repositoryBinding=()=>{
    const value=readRepositoryBinding();
    if(!value||typeof value.repository!=='string'||typeof value.bindingId!=='string'||!value.bindingId)fail();
    return {repository:value.repository,bindingId:value.bindingId};
  };
  const valid=record=>{
    if(!record||Object.keys(record).sort().join(',')!=='configuration,repositoryBinding,revision,version'
      ||record.version!==1||typeof record.revision!=='string'||!record.revision)fail();
    validateToolValue(schema,record.configuration);
    if(!isDeepStrictEqual(record.repositoryBinding,repositoryBinding())
      ||record.configuration.selection.repo!==record.repositoryBinding.repository)fail();
    return record;
  };
  try{
    if(existsSync(file)&&safeStorage.isEncryptionAvailable()){
      assertDirectory();
      const fd=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
      try{
        const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>65536)fail();
        const bytes=Buffer.alloc(65537);let size=0,count;
        while(size<bytes.length&&(count=readSync(fd,bytes,size,bytes.length-size,null))>0)size+=count;
        const after=fstatSync(fd);assertDirectory();const entry=lstatSync(file);
        if(size>65536||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs
          ||entry.isSymbolicLink()||entry.dev!==after.dev||entry.ino!==after.ino)fail();
        const envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size)));
        if(envelope.version!==1||typeof envelope.encrypted!=='string'||Object.keys(envelope).sort().join(',')!=='encrypted,version')fail();
        saved=valid(JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted,'base64'))));
      }finally{closeSync(fd);}
    }
  }catch{saved=undefined;}
  const current=()=>{if(closed||!safeStorage.isEncryptionAvailable())fail();assertDirectory();return valid(saved);};
  const host={
    configureFromNativeSelection(configuration){
      if(closed||!safeStorage.isEncryptionAvailable())fail();validateToolValue(schema,configuration);
      const next=valid({version:1,revision:randomUUID(),repositoryBinding:repositoryBinding(),configuration:structuredClone(configuration)});
      const encrypted=safeStorage.encryptString(JSON.stringify(next)).toString('base64');
      mkdirSync(userData,{recursive:true});assertDirectory();const temporary=file+'.'+randomUUID()+'.tmp';
      const fd=openSync(temporary,'wx',0o600);try{writeFileSync(fd,JSON.stringify({version:1,encrypted}),'utf8');}finally{closeSync(fd);}
      assertDirectory();renameSync(temporary,file);saved=next;return host.snapshot();
    },
    snapshot(){try{const record=current();return {configured:true,revision:record.revision,repo:record.configuration.selection.repo,
      prNumber:record.configuration.selection.prNumber};}catch{return {configured:false};}},
    createPorts(options){
      let record;try{record=structuredClone(current());}catch{return createDesktopF18F19WorkflowPorts();}
      const assertCurrent=scope=>{
        if(scope.signal.aborted||!Number.isFinite(Date.parse(scope.deadline))||Date.now()>=Date.parse(scope.deadline)
          ||!isDeepStrictEqual(record,current()))fail();
      };
      return createDesktopF18F19WorkflowPorts({...options,requiredChecks:record.configuration.requiredChecks,
        eligibleReviewers:record.configuration.eligibleReviewers,selection:{configurationRef:createHash('sha256').update(JSON.stringify(record)).digest('hex'),
          assertCurrent,readSelection:async scope=>{
          assertCurrent(scope);return structuredClone(record.configuration.selection);
        }}});
    },
    close(){closed=true;},
  };return host;
}

/** Actual composition adapter over existing developer/workspace hosts. It does
 * not invent a provider, readiness predicate or permission when those are absent. */
export function createConfiguredDesktopF18F19WorkflowPorts({getApplication,codingWorkspace,developerDeployment,reviewConfiguration,
  authorizeExport,requestPresence,now=()=>new Date()}={}){
  const missing=()=>({tools:[],configuredWorkflowWorkerPorts:[],unavailable:['f18_original_developer_workspace_or_native_configuration_unavailable',
    'f19_original_f15_enqueue_and_independent_bug_regression_unavailable']});
  const workspace=codingWorkspace?.readDeveloperConfiguration?.(),status=developerDeployment?.snapshot?.(),host=developerDeployment?.host;
  if(!workspace?.bindingId||!path.isAbsolute(workspace.rootPath??'')||typeof workspace.assertCurrent!=='function'
    ||status?.configured!==true||status.state!=='configured'||!status.repository||typeof host?.createF18F19Tools!=='function'
    ||!Array.isArray(host.competitionToolAvailability)||typeof reviewConfiguration?.createPorts!=='function'
    ||typeof getApplication!=='function'||typeof authorizeExport!=='function'||typeof requestPresence!=='function')return missing();
  const pins={bindingId:workspace.bindingId,rootPath:workspace.rootPath,repository:status.repository};
  const current=scope=>{
    const app=getApplication(),latest=codingWorkspace.readDeveloperConfiguration(),deployment=developerDeployment.snapshot();
    if(!app||scope.signal.aborted||!Number.isFinite(Date.parse(scope.deadline))||Date.parse(scope.deadline)<=now().getTime()
      ||latest?.bindingId!==pins.bindingId||latest.rootPath!==pins.rootPath||deployment.configured!==true
      ||deployment.state!=='configured'||deployment.repository!==pins.repository||developerDeployment.host!==host)fail();
    const task=app.runtime.getTask(scope.taskId);
    if(task.cancelRequested||!['running','waiting_approval'].includes(task.state)
      ||app.runtime.loadCheckpoint(scope.taskId,'application-deadline')!==scope.deadline||!app.readToolConversation(scope.taskId))fail();
    const guard=latest.assertCurrent(scope);if(guard!==undefined){void Promise.resolve(guard).catch(()=>{});fail();}
  };
  return reviewConfiguration.createPorts({getApplication,authorizeExport,requestPresence,now,github:{assertCurrent:current,
    createTools:options=>host.createF18F19Tools(options),available:async scope=>{
      try{
        current(scope);
        const ports=host.competitionToolAvailability.filter(port=>port.toolName==='github.pr.get'&&port.toolVersion===GITHUB_CONNECTOR_VERSION);
        if(ports.length!==1||await ports[0].available(scope)!==true)return false;
        current(scope);return true;
      }catch{return false;}
    }}});
}

import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {developerSettingsError,preserveDeveloperSettingsError} from '../shared/developer-settings-diagnostics.js';

const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const only=(value,keys)=>object(value)&&Object.keys(value).every(key=>keys.includes(key));
const containsCredential=(value,token)=>typeof value==='string'?value.includes(token)
  :value&&typeof value==='object'&&Object.entries(value).some(([key,item])=>key.includes(token)||containsCredential(item,token));
const error=(code,message)=>Object.assign(Error(message),{code});
const unavailable=()=>{throw error('UNSUPPORTED_CAPABILITY','开发宿主未配置、已停用或原绑定已失效');};
const TASK_BINDING_KEY='desktop-developer-settings-binding-v1';
const STARTUP_SCAN_PAGE_LIMIT=10;

/** One encrypted product view of the ORIGINAL deployment configuration, never a tool registry. */
export function createDeveloperSettingsHost({userData,safeStorage,readWorkspace,readWorkspaceStatus=()=>undefined,readModels=()=>[],
  createDeployment,readToolDescriptors,makeProtocolError=error,onUpdate=()=>{}}) {
  const target=path.join(userData,'developer-settings.json');
  let record,restoreFailed=false,closed=false,saving=false,slot,options,application,stable;
  let writing=false,creating;
  let bindingRuntime,startupSequence;
  const publish=()=>{try{onUpdate();}catch{}};
  const models=()=>{
    try {const value=readModels();return (Array.isArray(value)?value:value?.models??[])
      .filter(item=>item.enabled===true&&typeof item.id==='string'&&typeof item.configurationRef==='string')
      .map(({id,configurationRef,displayName})=>({id,configurationRef,displayName:displayName??id}));}
    catch{return [];}
  };
  const workspace=()=>{try{return readWorkspace?.();}catch{return undefined;}};
  const workspaceRequiresRestart=()=>{try{return readWorkspaceStatus()?.configured===true;}catch{return false;}};
  const changed=()=>makeProtocolError('REVISION_CONFLICT','开发设置或原任务绑定已变化');
  try {
    if(existsSync(target)){
      if(!safeStorage.isEncryptionAvailable())throw Error();
      const envelope=JSON.parse(readFileSync(target,'utf8'));
      if(envelope.version!==1||typeof envelope.encrypted!=='string')throw Error();
      const value=JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted,'base64')));
      if(!only(value,['version','revision','enabled','configuration','token','workspaceBindingId'])||value.version!==1
        ||typeof value.revision!=='string'||typeof value.enabled!=='boolean'||typeof value.token!=='string'
        ||!only(value.configuration,['version','repository','workspaceRoot','github','git','workflows'])
        ||!only(value.configuration.github,['executable','environment','repairLinks'])
        ||value.configuration.github.repairLinks!==undefined&&typeof value.configuration.github.repairLinks!=='boolean'
        ||!only(value.configuration.git,['sourceBranch','remoteName','remoteUrl','allowedPaths','authorName','authorEmail'])
        ||value.configuration.workflows!==undefined&&!only(value.configuration.workflows,
          ['bindingId','modelId','configurationRef','maxSteps','maxTokens','reviewRules','issueTriage','ciFix'])
        ||value.token.length<8||value.token.length>4096||/\s|\x00/u.test(value.token)||containsCredential(value.configuration,value.token)
        ||typeof value.workspaceBindingId!=='string')throw Error();
      record=value;
    }
  }catch{restoreFailed=true;}
  const isCurrent=value=>!closed&&record===value&&value?.enabled===true&&workspace()?.bindingId===value.workspaceBindingId
    &&(!value.configuration.workflows||models().some(model=>model.id===value.configuration.workflows.modelId
      &&model.configurationRef===value.configuration.workflows.configurationRef));
  const source=value=>Object.freeze({readConfiguration:()=>JSON.stringify(value.configuration),readToken:()=>value.token,
    current:()=>isCurrent(value)});
  const active=()=>slot&&isCurrent(slot.record)?slot:undefined;
  // Task snapshots do not publish createdSequence. Search only the original
  // startup snapshot, with a fixed page budget; exhaustion cannot mean new.
  const existedAtStartup=task=>{
    let beforeSequence;
    for(let page=0;page<STARTUP_SCAN_PAGE_LIMIT;page++){
      const result=bindingRuntime.listTasks({limit:100,snapshotSequence:startupSequence,
        conversationId:task.conversationId,...(beforeSequence===undefined?{}:{beforeSequence})});
      if(result?.snapshotSequence!==startupSequence||!Array.isArray(result.items)||result.items.length>100)return undefined;
      if(result.items.some(item=>item.taskId===task.taskId))return true;
      if(result.nextBeforeSequence===undefined)return false;
      if(!Number.isSafeInteger(result.nextBeforeSequence)||result.nextBeforeSequence<1
        ||result.nextBeforeSequence>startupSequence
        ||beforeSequence!==undefined&&result.nextBeforeSequence>=beforeSequence)return undefined;
      beforeSequence=result.nextBeforeSequence;
    }
    return undefined;
  };
  const bound=(lease,scope,pin=false)=>{
    if(active()!==lease||typeof scope?.taskId!=='string'||!scope.taskId||scope.signal?.aborted||!bindingRuntime)return false;
    try{
      const matches=value=>only(value,['version','revision'])&&Object.keys(value).length===2
        &&value.version===1&&value.revision===lease.record.revision;
      const binding=bindingRuntime.loadCheckpoint(scope.taskId,TASK_BINDING_KEY);
      if(binding!==undefined)return matches(binding);
      const task=bindingRuntime.getTask(scope.taskId);
      if(task?.taskId!==scope.taskId||existedAtStartup(task)!==false)return false;
      if(!pin)return true;
      bindingRuntime.saveCheckpointOnce(scope.taskId,TASK_BINDING_KEY,{version:1,revision:lease.record.revision});
      return active()===lease&&!scope.signal?.aborted
        &&matches(bindingRuntime.loadCheckpoint(scope.taskId,TASK_BINDING_KEY));
    }catch{return false;}
  };
  const persist=value=>{
    if(!safeStorage.isEncryptionAvailable())throw developerSettingsError('DEV_SETTINGS_STORAGE_UNAVAILABLE');
    try{
      const encrypted=safeStorage.encryptString(JSON.stringify(value)).toString('base64');
      mkdirSync(userData,{recursive:true});
      const temporary=target+'.tmp-'+randomUUID();
      writeFileSync(temporary,JSON.stringify({version:1,encrypted}),'utf8');renameSync(temporary,target);
      record=value;restoreFailed=false;
    }catch{throw developerSettingsError('DEV_SETTINGS_STORAGE_WRITE_FAILED');}
  };
  const clearSlot=()=>{const previous=slot;slot=undefined;try{previous?.deployment.close();}catch{}};
  async function factories(){
    if(!createDeployment||!readToolDescriptors){
      const original=await import('./developer-deployment-config.js');
      createDeployment??=original.createDesktopDeveloperDeployment;
      readToolDescriptors??=original.readDeveloperToolDescriptors;
      const {ProtocolError}=await import('@personal-agent/contracts');
      makeProtocolError=(code,message)=>new ProtocolError(code,message);
    }
  }
  async function build(value){
    if(!options)throw developerSettingsError('DEV_SETTINGS_HOST_UNAVAILABLE');
    const selected=workspace();
    if(!selected||selected.bindingId!==value.workspaceBindingId)throw developerSettingsError('DEV_SETTINGS_WORKSPACE_CHANGED');
    const deployment=await createDeployment({...options,configPath:undefined,configurationSource:source(value),workspace:selected});
    if(deployment.snapshot().configured!==true){deployment.close();throw developerSettingsError('DEV_SETTINGS_HOST_UNAVAILABLE');}
    return {record:value,deployment};
  }
  const snapshot=()=>{
    const selected=workspace(),current=active(),deployment=current?.deployment.snapshot();
    const configuration=record?.configuration;
    // This projection is admin-only. Credentials, tokenFile and opaque provider objects never leave the host.
    return {enabled:record?.enabled===true,configured:Boolean(record),tokenConfigured:Boolean(record?.token),
      state:restoreFailed?'restore_failed':closed?'closed':current?'configured':record?.enabled?'unavailable':'disabled',
      available:Boolean(current),writing,models:models(),
      workspace:{selected:Boolean(selected),requiresRestart:!selected&&workspaceRequiresRestart(),bindingId:selected?.bindingId,rootPath:selected?.rootPath,
        recipeIds:selected?.command?.recipeIds??[]},
      configuration:configuration?{version:1,repository:configuration.repository,
        github:{executable:configuration.github?.executable,environment:structuredClone(configuration.github?.environment??{}),
          ...(configuration.github?.repairLinks===undefined?{}:{repairLinks:configuration.github.repairLinks})},
        git:structuredClone(configuration.git),workflows:structuredClone(configuration.workflows)}:undefined,
      deployment:deployment?{configured:deployment.configured,modelConfigured:deployment.modelConfigured,
        workflowsConfigured:deployment.workflowsConfigured,exportConfirmationConfigured:deployment.exportConfirmationConfigured,
        unavailable:structuredClone(deployment.unavailable??[])}:undefined,
      reason:restoreFailed?'开发加密配置读取失败；未导入任何旧凭据':closed?'开发设置宿主已关闭':
        !selected?(workspaceRequiresRestart()?'工作区设置已保存，请到「开发 → 环境 / Worktrees」核对并重启装配':
          '请到「开发 → 环境 / Worktrees」选择本地工作区并重启装配'):record?.enabled&&!current?'配置已保存，但原绑定不可用；请检查模型与工作区':
          current?'原开发宿主已装配；可执行性仍由每个任务的原授权决定':'开发宿主已停用，保存不授予工具或出机权限'};
  };

  async function configure(input){
    if(closed||saving)throw developerSettingsError('DEV_SETTINGS_BUSY');
    if(!only(input,['enabled','configuration','token'])||typeof input.enabled!=='boolean'
      ||!only(input.configuration,['version','repository','github','git','workflows'])
      ||!only(input.configuration.github,['executable','environment','repairLinks'])
      ||input.configuration.github.repairLinks!==undefined&&typeof input.configuration.github.repairLinks!=='boolean')throw developerSettingsError('DEV_SETTINGS_INPUT_INVALID');
    if(writing&&input.enabled)throw developerSettingsError('DEV_SETTINGS_WRITE_PENDING');
    const selected=workspace();if(!selected)throw developerSettingsError(workspaceRequiresRestart()
      ?'DEV_SETTINGS_WORKSPACE_RESTART_REQUIRED':'DEV_SETTINGS_WORKSPACE_REQUIRED');
    const token=input.token===undefined||input.token===''?record?.token:input.token;
    if(typeof token!=='string'||token.length<8||token.length>4096||/\s|\x00/u.test(token))throw developerSettingsError('DEV_SETTINGS_CREDENTIAL_REQUIRED');
    const configuration=structuredClone(input.configuration);
    configuration.workspaceRoot=selected.rootPath;
    if(configuration.workflows){
      const chosen=models().find(model=>model.id===configuration.workflows.modelId&&model.configurationRef===configuration.workflows.configurationRef);
      if(!chosen)throw developerSettingsError('DEV_SETTINGS_MODEL_REQUIRED');
      configuration.workflows.bindingId=randomUUID();
    }
    const raw=JSON.stringify(configuration);
    if(Buffer.byteLength(raw,'utf8')>65536||containsCredential(configuration,token))throw developerSettingsError('DEV_SETTINGS_CONTENT_INVALID');
    const candidate={version:1,revision:randomUUID(),enabled:input.enabled,configuration,token,workspaceBindingId:selected.bindingId};
    saving=true;let next,committed=false;
    try{
      await factories();next=await build(candidate);
      if(closed||workspace()?.bindingId!==candidate.workspaceBindingId||candidate.configuration.workflows
        &&!models().some(model=>model.id===candidate.configuration.workflows.modelId
          &&model.configurationRef===candidate.configuration.workflows.configurationRef))throw developerSettingsError('DEV_SETTINGS_WORKSPACE_CHANGED');
      // Synchronous atomic persistence and source invalidation form one host mutation boundary.
      persist(candidate);committed=true;clearSlot();
      if(candidate.enabled){slot=next;next=undefined;if(application)slot.deployment.host.bind(application);}
      publish();return snapshot();
    }catch(cause){
      if(committed){clearSlot();publish();return snapshot();}
      throw preserveDeveloperSettingsError(cause);
    }
    finally{try{next?.deployment.close();}catch{}saving=false;}
  }
  async function setEnabled(input){
    if(!only(input,['enabled'])||typeof input.enabled!=='boolean')throw developerSettingsError('DEV_SETTINGS_INPUT_INVALID');
    if(closed||saving)throw developerSettingsError('DEV_SETTINGS_BUSY');
    if(!record)throw developerSettingsError('DEV_SETTINGS_NOT_CONFIGURED');
    if(input.enabled){
      if(workspace()?.bindingId!==record.workspaceBindingId)throw developerSettingsError('DEV_SETTINGS_WORKSPACE_CHANGED');
      const configuration=structuredClone(record.configuration);delete configuration.workspaceRoot;
      return configure({enabled:true,configuration});
    }
    persist({...record,enabled:false,revision:randomUUID()});clearSlot();publish();return snapshot();
  }

  async function createStableDeployment(originalOptions){
    if(stable)return stable;
    if(closed)throw Error('开发配置宿主已关闭');
    await factories();options={...originalOptions};delete options.configPath;delete options.configurationSource;delete options.workspace;
    const catalog=await readToolDescriptors(options);
    const descriptors=Array.isArray(catalog)?catalog:catalog.descriptors;
    // Participation follows the stable catalog, even while its deployment is unavailable.
    // Match names so an unsupported version of our own tool still fails closed below.
    const toolNames=new Set(descriptors.map(descriptor=>descriptor.name));
    const select=descriptor=>{
      const lease=active();
      const tool=lease?.deployment.host.tools.find(item=>item.descriptor.name===descriptor.name&&item.descriptor.version===descriptor.version);
      return tool?{lease,tool}:undefined;
    };
    const tools=descriptors.map(descriptor=>({descriptor:structuredClone(descriptor),async execute(input,context){
      const selected=select(descriptor);if(!selected||!bound(selected.lease,context,true))unavailable();
      const write=descriptor.sideEffect!=='read';if(write&&writing)throw makeProtocolError('INVALID_STATE','原开发写入尚未结束');
      if(write)writing=true;
      try{
        const result=await selected.tool.execute(input,context);
        if(!bound(selected.lease,context))throw changed();return result;
      }catch(cause){
        if(active()!==selected.lease&&write)throw makeProtocolError('RESULT_UNKNOWN','设置已撤销；已开始的开发写入须按原任务核实');
        throw cause;
      }finally{if(write)writing=false;}
    }}));
    const availability=descriptors.map(descriptor=>({toolName:descriptor.name,toolVersion:descriptor.version,
      publicEnumPaths:catalog.publicEnumPaths?.[descriptor.name]??[],async available(context){
      const selected=select(descriptor);if(!selected||!bound(selected.lease,context)||writing&&descriptor.sideEffect!=='read')return false;
      const entry=selected.lease.deployment.host.competitionToolAvailability.find(item=>item.toolName===descriptor.name&&item.toolVersion===descriptor.version);
      return await entry?.available(context)===true&&bound(selected.lease,context,true);
    }}));
    const policies=descriptors.map(descriptor=>({toolName:descriptor.name,toolVersion:descriptor.version,exportPolicyVersion:'developer-settings-dynamic-v1',
      accepts(input){const selected=select(descriptor);return Boolean(selected&&bound(selected.lease,input)
        &&selected.lease.deployment.host.competitionToolExports.find(policy=>policy.toolName===descriptor.name)?.accepts(input)===true);},
      async project(input){const selected=select(descriptor);if(!selected||!bound(selected.lease,input))throw changed();
        const policy=selected.lease.deployment.host.competitionToolExports.find(item=>item.toolName===descriptor.name);
        if(!policy)unavailable();const result=await policy.project(input);if(!bound(selected.lease,input))throw changed();return result;}}));
    stable={host:{tools,competitionToolAvailability:availability,competitionToolExports:policies,runtimeOptions:{},
      bind(value){
        if(application&&application!==value)throw Error('原 Runtime 绑定不可替换');
        if(application===value)return;
        const runtime=value?.runtime;
        if(!runtime||['loadCheckpoint','saveCheckpointOnce','getTask','listTasks'].some(key=>typeof runtime[key]!=='function'))
          throw Error('开发设置需要原 Runtime 持久任务绑定');
        let snapshot;try{snapshot=runtime.listTasks({limit:1});}
        catch{throw Error('开发设置无法读取原 Runtime 启动边界');}
        if(!Number.isSafeInteger(snapshot?.snapshotSequence)||snapshot.snapshotSequence<0)
          throw Error('开发设置无法读取原 Runtime 启动边界');
        bindingRuntime=runtime;startupSequence=snapshot.snapshotSequence;application=value;slot?.deployment.host.bind(value);
      },
      close},async prepareExport(scope){if(!toolNames.has(scope?.proposal?.toolName))return;
        const lease=active();if(!lease||!bound(lease,scope,true))unavailable();
        await lease.deployment.prepareExport(scope);if(!bound(lease,scope))throw changed();},
      snapshot:()=>({...active()?.deployment.snapshot(),configured:Boolean(active()),
        state:closed?'closed':active()?'configured':'unavailable',
        unavailable:active()?.deployment.snapshot().unavailable??[{capability:'developer.settings',reason:'trusted_product_settings_required'}]}),
      close,readDeveloperWorkflows};
    if(record?.enabled){try{slot=await build(record);}catch{slot=undefined;}}
    return stable;
  }
  function readDeveloperWorkflows(context){const lease=active();return lease&&(!context||bound(lease,context,true))
    ?lease.deployment.host.runtimeOptions?.developerWorkflows:undefined;}
  function close(){if(closed)return;closed=true;clearSlot();bindingRuntime=undefined;startupSequence=undefined;record=undefined;publish();}
  return {snapshot,configure,setEnabled,createDeployment(value){
    creating??=createStableDeployment(value).finally(()=>{creating=undefined;});return creating;
  },readDeveloperWorkflows,close};
}

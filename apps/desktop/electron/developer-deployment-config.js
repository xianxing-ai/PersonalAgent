import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import * as githubModule from '@personal-agent/github';

const PUBLIC_UNAVAILABLE=[
  ['github','trusted_provider_repository_credentials_required'],
  ['github.actions.repair.link','separate_checks_write_opt_in_required'],
  ['workspace.git','trusted_branch_remote_paths_and_verification_required'],
  ['workspace.run_allowed_command','trusted_fixed_recipes_required'],
  ['workspace.locate_test_failures','trusted_log_parser_scope_required'],
  ['developer.workflows','trusted_model_rules_workspace_and_export_ports_required'],
  ['developer.egress','exact_payload_confirmation_required'],
  ['developer.model','explicit_original_gateway_binding_required'],
];

/** Cloud-visible status only. Repository/configuration details remain in the trusted UI. */
export function projectDeveloperConversationStatus(snapshot) {
  return {configured:snapshot?.configured===true,workflowsConfigured:snapshot?.workflowsConfigured===true,
    modelConfigured:snapshot?.modelConfigured===true,exportConfirmationConfigured:snapshot?.exportConfirmationConfigured===true,
    state:['configured','partial','unavailable','closed'].includes(snapshot?.state)?snapshot.state:'unavailable',
    unavailable:PUBLIC_UNAVAILABLE.filter(([capability,reason])=>Array.isArray(snapshot?.unavailable)
      &&snapshot.unavailable.some(item=>item?.capability===capability&&item?.reason===reason))
      .map(([capability,reason])=>({capability,reason}))};
}

const fail=()=>{throw new ProtocolError('UNSUPPORTED_CAPABILITY','Developer deployment configuration is invalid or unavailable');};
const denied=()=>{throw new ProtocolError('UNAUTHORIZED','Exact developer export permission is unavailable');};
const hash=value=>createHash('sha256').update(JSON.stringify(value)??'undefined').digest('hex');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));
const branch=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u.test(value)
  &&!value.includes('..')&&!value.endsWith('/')&&!value.endsWith('.lock');
const inside=(root,candidate)=>{const relative=path.relative(root,candidate);return !relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
function boundFile(name,maxBytes,{privateFile=false,workspaceRoot,assertPrivateFile,immutable=false,executable=false}={}) {
  if(typeof name!=='string'||!path.isAbsolute(name)||name.includes('\0'))fail();
  const canonical=realpathSync(name),initial=lstatSync(name,{bigint:true});
  if(path.resolve(name)!==canonical||!initial.isFile()||initial.isSymbolicLink()||initial.nlink!==1n
    ||initial.size>BigInt(maxBytes)||workspaceRoot&&inside(workspaceRoot,canonical))fail();
  if(privateFile){
    if(process.platform==='win32'){if(assertPrivateFile?.(canonical)!==true)fail();}
    else if((Number(initial.mode)&0o077)!==0||typeof process.getuid==='function'&&initial.uid!==BigInt(process.getuid()))fail();
  }else if(process.platform!=='win32'&&(Number(initial.mode)&0o022)!==0)fail();
  if(executable&&(process.platform==='win32'?!/\.exe$/iu.test(canonical):(Number(initial.mode)&0o111)===0))fail();
  const identity=(verifyPrivate=false)=>{
    const current=lstatSync(canonical,{bigint:true});
    return current.isFile()&&!current.isSymbolicLink()&&current.nlink===1n&&current.dev===initial.dev&&current.ino===initial.ino
      &&current.size<=BigInt(maxBytes)&&realpathSync(canonical)===canonical
      &&(!immutable||current.mtimeNs===initial.mtimeNs&&current.ctimeNs===initial.ctimeNs&&current.size===initial.size)
      &&(privateFile?(process.platform==='win32'?(!verifyPrivate||assertPrivateFile?.(canonical)===true)
        :(Number(current.mode)&0o077)===0&&current.uid===initial.uid)
        :process.platform==='win32'||(Number(current.mode)&0o022)===0);
  };
  return {path:canonical,current:()=>{try{return identity();}catch{return false;}},read(){if(!identity(true))fail();
    const bytes=readFileSync(canonical);if(bytes.length>maxBytes||!identity(true))fail();return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}};
}

export function attachExactExports(host,{current,ready,assertCurrent,confirmExport,containsCredential=()=>false,policyBinding,now,kindPrefix='developer'}) {
  const permits=new Map(),descriptors=host.tools.map(tool=>tool.descriptor);
  const consent=async(kind,payload,scope)=>{
    assertCurrent(scope);if(typeof confirmExport!=='function')denied();
    const exact=structuredClone(payload),serialized=JSON.stringify(exact);
    if(typeof serialized!=='string'||Buffer.byteLength(serialized,'utf8')>512*1024||containsCredential(serialized)
      ||/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9_.-]{16,})/u.test(serialized))denied();
    const controller=new AbortController();let timer,onAbort;
    const interrupted=new Promise((_,reject)=>{
      onAbort=()=>{controller.abort();reject(new ProtocolError('UNAUTHORIZED','Exact developer export permission ended'));};
      scope.signal.addEventListener('abort',onAbort,{once:true});
      timer=setTimeout(onAbort,Math.max(1,Math.min(2_147_483_647,Date.parse(scope.deadline)-now())));
      if(scope.signal.aborted)onAbort();
    });
    try {
      const allowed=await Promise.race([Promise.resolve().then(()=>{
        if(controller.signal.aborted)denied();return confirmExport({taskId:scope.taskId,kind,payload:exact,deadline:scope.deadline,signal:controller.signal});
      }),interrupted]);if(allowed!==true)denied();
    }catch{denied();}finally{clearTimeout(timer);scope.signal.removeEventListener('abort',onAbort);}
    assertCurrent(scope);
  };
  const policies=typeof confirmExport==='function'?descriptors.map(descriptor=>({toolName:descriptor.name,toolVersion:descriptor.version,
    exportPolicyVersion:kindPrefix+'-exact-v1-'+policyBinding,accepts:input=>{
      const permit=permits.get(JSON.stringify([input.taskId,input.proposalId]));
      try{
        if(!permit)return false;const scope={...permit,signal:input.signal??permit.signal};assertCurrent(scope);
        return current(scope)&&permit.toolName===descriptor.name&&permit.argumentsDigest===hash(input.arguments)
          &&(input.phase!=='final'||permit.resultDigest===hash(input.projection));
      }catch{return false;}
    },project:async input=>{
      const permit=permits.get(JSON.stringify([input.taskId,input.proposalId]));if(!permit||permit.toolName!==descriptor.name)denied();
      await consent(kindPrefix+'_tool_result',{toolName:descriptor.name,toolVersion:descriptor.version,result:input.result},{...permit,signal:input.signal});
      permit.resultDigest=hash(input.result);return structuredClone(input.result);
    }})):[];
  const prepareExport=async scope=>{
    const descriptor=descriptors.find(item=>item.name===scope.proposal?.toolName&&item.version===scope.proposal?.toolVersion);
    if(!descriptor)return;
    if(scope.phase==='preflight'){
      for(const [key,permit]of permits)if(Date.parse(permit.deadline)<=now())permits.delete(key);
      if(!await ready(descriptor.name,scope))denied();
      await consent(kindPrefix+'_tool_metadata',{toolName:descriptor.name,toolVersion:descriptor.version,arguments:scope.proposal.arguments},scope);
      const key=JSON.stringify([scope.taskId,scope.proposal.proposalId]);if(permits.size>=512&&!permits.has(key))denied();
      permits.set(key,{taskId:scope.taskId,deadline:scope.deadline,signal:scope.signal,toolName:descriptor.name,argumentsDigest:hash(scope.proposal.arguments)});
    }
  };
  return {host:{...host,competitionToolExports:policies},consent,prepareExport,clear:toolNames=>{
    if(!toolNames)permits.clear();else for(const [key,permit]of permits)if(toolNames.has(permit.toolName))permits.delete(key);
  }};
}

/** Main-only deployment configuration. No Electron, ambient gh account or new Runtime. */
export async function createDesktopDeveloperDeployment({configPath,workspace,cacheRootPath,readModelGateway,confirmExport,
  available,assertPrivateFile,now=Date.now,createHost}={}) {
  const factory=createHost??(await import('./developer-tools-host.js')).createDesktopDeveloperToolsHost;
  if(typeof factory!=='function')fail();
  if(configPath===undefined||configPath===''){
    let active=true,host;
    try {
      if(workspace&&(typeof workspace.bindingId!=='string'||!workspace.bindingId||typeof workspace.available!=='function'
        ||typeof workspace.assertCurrent!=='function'||!path.isAbsolute(workspace.rootPath)))fail();
      const root=workspace?realpathSync(workspace.rootPath):undefined,identity=root?lstatSync(root,{bigint:true}):undefined;
      if(root&&(!identity.isDirectory()||identity.isSymbolicLink()||workspace.command&&realpathSync(workspace.command.rootPath)!==root))fail();
      const current=scope=>{try{
        if(!active||typeof scope?.signal?.addEventListener!=='function'||scope.signal.aborted||!(Date.parse(scope.deadline)>now()))return false;
        if(!root)return typeof available==='function';
        const latest=lstatSync(root,{bigint:true});return latest.isDirectory()&&latest.dev===identity.dev&&latest.ino===identity.ino&&realpathSync(workspace.rootPath)===root;
      }catch{return false;}};
      const ready=async(capability,scope)=>{try{return current(scope)&&(!workspace||await workspace.available(scope)===true)
        &&(typeof available!=='function'?Boolean(workspace):await available({capability,...scope})===true)&&current(scope);}catch{return false;}};
      const assertCurrent=scope=>{if(!current(scope))denied();workspace?.assertCurrent(scope);};
      const options={now,...(workspace?.command?{command:{...workspace.command,available:async scope=>await ready('workspace.run_allowed_command',scope)
        &&await workspace.command.available(scope)===true}}:{})};
      if(cacheRootPath!==undefined){if(!path.isAbsolute(cacheRootPath)||!lstatSync(cacheRootPath).isDirectory()||root&&inside(root,realpathSync(cacheRootPath)))fail();
        options.testLocate={cacheRootPath,available:scope=>ready('workspace.locate_test_failures',scope)};}
      host=factory(options);
      const exports=attachExactExports(host,{current,ready,assertCurrent,confirmExport,policyBinding:hash(['selected-workspace',workspace?.bindingId??null]),now});host=exports.host;
      return {host,prepareExport:exports.prepareExport,snapshot:()=>({configured:false,state:active&&host.tools.length?'partial':'unavailable',
        reason:'github_explicit_trusted_configuration_required',unavailable:host.unavailable}),close(){if(!active)return;active=false;exports.clear();host.close();}};
    }catch{active=false;try{host?.close();}catch{}fail();}
  }
  let provider,host,active=true;
  try {
    if(!workspace||typeof workspace.bindingId!=='string'||!workspace.bindingId||typeof workspace.available!=='function'
      ||typeof workspace.assertCurrent!=='function'||!path.isAbsolute(workspace.rootPath))fail();
    const root=realpathSync(workspace.rootPath),rootIdentity=lstatSync(root,{bigint:true});
    if(!rootIdentity.isDirectory()||rootIdentity.isSymbolicLink())fail();
    const file=boundFile(configPath,65536,{privateFile:true,workspaceRoot:root,assertPrivateFile,immutable:true}),raw=file.read(),configuration=JSON.parse(raw);
    if(!keys(configuration,['version','repository','workspaceRoot','github','git','workflows'])||configuration.version!==1
      ||typeof configuration.repository!=='string'||!/^[-\w.]+\/[-\w.]+$/u.test(configuration.repository)
      ||configuration.repository.includes('..')||realpathSync(configuration.workspaceRoot)!==root
      ||!keys(configuration.github,['executable','tokenFile','environment','repairLinks'])
      ||configuration.github.repairLinks!==undefined&&typeof configuration.github.repairLinks!=='boolean'
      ||!keys(configuration.git,['sourceBranch','remoteName','remoteUrl','allowedPaths','authorName','authorEmail']))fail();
    const repository=configuration.repository,git=configuration.git;
    if(!branch(git.sourceBranch)||typeof git.remoteName!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(git.remoteName)
      ||![`https://github.com/${repository}`,`https://github.com/${repository}.git`].includes(git.remoteUrl)
      ||typeof git.authorName!=='string'||!git.authorName||typeof git.authorEmail!=='string'||!git.authorEmail
      ||/[\r\n\x00<>]/u.test(git.authorName+git.authorEmail)||!Array.isArray(git.allowedPaths)||!git.allowedPaths.length
      ||git.allowedPaths.length>128||new Set(git.allowedPaths).size!==git.allowedPaths.length)fail();
    for(const name of git.allowedPaths){
      if(typeof name!=='string'||!name||name.length>1023||name.startsWith('-')||path.isAbsolute(name)||name.includes('\\')
        ||/[\x00-\x1f]/u.test(name)||name.split('/').some(part=>!part||part==='.'||part==='..'||part==='.git'||part==='node_modules'
          ||/^\.env(?:\.|$)/i.test(part)||/(?:credentials?|secrets?)(?:\.|$)/i.test(part)))fail();
      const candidate=path.resolve(root,name),stat=lstatSync(candidate);
      if(!inside(root,candidate)||!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||realpathSync(candidate)!==candidate)fail();
    }
    const binary=boundFile(configuration.github.executable,128*1024*1024,{workspaceRoot:root,immutable:true,executable:true});
    const environment=configuration.github.environment??{};
    if(!keys(environment,['SystemRoot','TEMP','TMP'])||Object.values(environment).some(value=>typeof value!=='string'
      ||!path.isAbsolute(value)||/[\x00-\x1f]/u.test(value)||!lstatSync(value).isDirectory()))fail();
    const token=boundFile(configuration.github.tokenFile,4096,{privateFile:true,workspaceRoot:root,assertPrivateFile,immutable:true});
    let tokenDigest;
    const readToken=()=>{const value=token.read().trim();if(value.length<8||value.length>4096||/[\s\x00]/u.test(value)
      ||tokenDigest!==undefined&&hash(value)!==tokenDigest)fail();return value;};
    tokenDigest=hash(readToken());
    const current=scope=>{
      if(!active||typeof scope?.signal?.addEventListener!=='function'||scope.signal.aborted||!(Date.parse(scope?.deadline)>now())
        ||!file.current()||!binary.current()||!token.current())return false;
      const identity=lstatSync(root,{bigint:true});
      return identity.isDirectory()&&identity.dev===rootIdentity.dev&&identity.ino===rootIdentity.ino&&realpathSync(workspace.rootPath)===root;
    };
    const ready=async(capability,scope)=>{try{return current(scope)&&await workspace.available(scope)===true
      &&(typeof available!=='function'||await available({capability,...scope})===true)&&current(scope);}catch{return false;}};
    const assertCurrent=scope=>{if(!current(scope))denied();workspace.assertCurrent(scope);};
    let consent;
    provider=new githubModule.GhCliProvider({runner:new githubModule.SpawnGhCommandRunner(binary.path,{...environment}),
      repositories:[repository],readToken:async scope=>{assertCurrent(scope);return readToken();}});
    const options={githubModule,github:{provider,repairLinks:configuration.github.repairLinks===true,available:scope=>ready('github',scope)},
      git:{options:{repository,rootPath:root,...git,getCredentials:async scope=>{assertCurrent(scope);return {token:readToken()};}},
        available:scope=>ready('workspace.git',scope)},
      ...(workspace.command?{command:{...workspace.command,available:async scope=>await ready('workspace.run_allowed_command',scope)
        &&await workspace.command.available(scope)===true}}:{}),
      testLocate:{cacheRootPath,available:scope=>ready('workspace.locate_test_failures',scope)},now};
    if(!path.isAbsolute(cacheRootPath)||!lstatSync(cacheRootPath).isDirectory()||inside(root,realpathSync(cacheRootPath)))fail();
    const workflow=configuration.workflows;
    if(workflow!==undefined){
      if(!keys(workflow,['bindingId','modelId','configurationRef','maxSteps','maxTokens','reviewRules','issueTriage','ciFix'])
        ||typeof workflow.bindingId!=='string'||!workflow.bindingId||!Number.isSafeInteger(workflow.maxSteps)||workflow.maxSteps<1||workflow.maxSteps>64
        ||!Number.isSafeInteger(workflow.maxTokens)||workflow.maxTokens<1||workflow.maxTokens>131072)fail();
      const result={bindingId:hash([workspace.bindingId,hash(raw),workflow.bindingId]),repositories:[repository],maxSteps:workflow.maxSteps,maxTokens:workflow.maxTokens,
        available:(kind,scope)=>ready('developer.'+kind,scope),assertCurrent,
        ...(typeof confirmExport==='function'?{authorizeModelRequest:(request,scope)=>consent('developer_model_request',request,scope),
          projectResult:async(result,scope)=>{await consent('developer_workflow_result',result,scope);return structuredClone(result);}}:{})};
      if(workflow.modelId!==undefined||workflow.configurationRef!==undefined){
        if(typeof workflow.modelId!=='string'||!workflow.modelId||typeof workflow.configurationRef!=='string'||!workflow.configurationRef)fail();
        if(typeof readModelGateway==='function')try {
          const original=readModelGateway(workflow.modelId,workflow.configurationRef);
          const deployment=structuredClone(original?.deployment);
          if(typeof original?.complete==='function'&&object(deployment))result.model={deployment,complete:request=>{
            if(!current(request))denied();const model=readModelGateway(workflow.modelId,workflow.configurationRef);
            if(typeof model?.complete!=='function'||hash(model.deployment)!==hash(deployment))fail();return model.complete(request);
          }};
        }catch{}
      }
      if(workflow.reviewRules!==undefined){
        if(!Array.isArray(workflow.reviewRules)||!workflow.reviewRules.length||workflow.reviewRules.length>32
          ||workflow.reviewRules.some(rule=>!keys(rule,['id','text'])||typeof rule.id!=='string'||!rule.id||rule.id.length>128
            ||typeof rule.text!=='string'||!rule.text||rule.text.length>4000))fail();
        result.reviewRules=structuredClone(workflow.reviewRules);
      }
      if(workflow.issueTriage!==undefined){
        const value=workflow.issueTriage,kinds=['bug','feature','docs','question'];
        if(!keys(value,['labels','minConfidence'])||!keys(value.labels,kinds)||Object.keys(value.labels).length!==kinds.length
          ||kinds.some(kind=>typeof value.labels[kind]!=='string'||!value.labels[kind].trim()||value.labels[kind].length>100)
          ||typeof value.minConfidence!=='number'||!Number.isFinite(value.minConfidence)||value.minConfidence<0||value.minConfidence>1)fail();
        result.issueTriage=structuredClone(value);
      }
      if(workflow.ciFix!==undefined){
        const value=workflow.ciFix;if(!keys(value,['verifyRecipeId','baseBranch','maxAttempts','maxLogBytes'])||!branch(value.baseBranch)
          ||!workspace.command?.recipeIds?.includes(value.verifyRecipeId)||value.maxAttempts!==undefined&&(!Number.isInteger(value.maxAttempts)||value.maxAttempts<1||value.maxAttempts>4)
          ||value.maxLogBytes!==undefined&&(!Number.isInteger(value.maxLogBytes)||value.maxLogBytes<1||value.maxLogBytes>512*1024))fail();
        result.ciFix={...value,sourcePaths:[...git.allowedPaths],headBranch:git.sourceBranch,
          gitTools:{head:'workspace.git.head',commit:'workspace.git.commit',push:'workspace.git.push',pullRequest:'github.pr.create',backlink:'github.issue.comment'}};
      }
      options.workflows=result;
    }
    // Register once through the original host, then attach only explicit exact-payload export policies.
    host=factory({...options,exports:[]});
    const originalHost=host,repositoryDescriptor={name:'developer.repository_context',version:'1.0.0',
      inputSchema:{type:'object',properties:{},additionalProperties:false},
      outputSchema:{type:'object',properties:{repository:{type:'string',minLength:3,maxLength:201}},required:['repository'],additionalProperties:false},
      sideEffect:'read',requiredScopes:['github:read'],requiresPresence:false,idempotencySupport:true,recoverySupport:true};
    const repositoryTool={descriptor:repositoryDescriptor,execute:async(input,context)=>{
      validateToolValue(repositoryDescriptor.inputSchema,input);
      if(!context.authorizationRef||!context.scopes?.includes('github:read'))throw new ProtocolError('SCOPE_DENIED','Repository context requires original read authorization');
      if(!await ready(repositoryDescriptor.name,context))throw new ProtocolError('UNSUPPORTED_CAPABILITY','Configured repository context is unavailable');
      return {repository};
    }};
    host={...originalHost,tools:[...originalHost.tools,repositoryTool],competitionToolAvailability:[...originalHost.competitionToolAvailability,
      {toolName:repositoryDescriptor.name,toolVersion:repositoryDescriptor.version,publicEnumPaths:[],available:scope=>ready(repositoryDescriptor.name,scope)}],
      close(){active=false;originalHost.close();}};
    const exports=attachExactExports(host,{current,ready,assertCurrent,confirmExport,containsCredential:value=>value.includes(readToken()),policyBinding:hash(raw),now});
    host=exports.host;consent=exports.consent;
    const unavailable=[...host.unavailable,
      ...(typeof confirmExport==='function'?[]:[{capability:'developer.egress',reason:'exact_payload_confirmation_required'}]),
      ...(workflow&&typeof options.workflows?.model?.complete!=='function'?[{capability:'developer.model',reason:'explicit_original_gateway_binding_required'}]:[])];
    return {host,prepareExport:exports.prepareExport,snapshot:()=>({configured:true,state:active?'configured':'closed',repository,
      workflowsConfigured:workflow!==undefined,modelConfigured:typeof options.workflows?.model?.complete==='function',
      exportConfirmationConfigured:typeof confirmExport==='function',unavailable}),close(){if(!active)return;active=false;exports.clear();host.close();}};
  }catch{active=false;try{host?.close();provider?.dispose();}catch{}fail();}
}

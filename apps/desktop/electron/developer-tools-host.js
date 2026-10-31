import {mkdtempSync,rmSync,readdirSync,realpathSync,statSync} from 'node:fs';
import path from 'node:path';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import * as coding from '@personal-agent/coding-tools';
export const developerPublicEnumPaths={'github.actions.run.list':['/status'],'github.issue.list':['/state'],'github.pr.review.comment':['/side']};

export const developerTestLocatorDescriptor={name:'workspace.locate_test_failures',version:'1.0.0',
  inputSchema:{type:'object',properties:{output:{type:'string',maxLength:65536}},required:['output'],additionalProperties:false},
  outputSchema:{type:'object',properties:{failures:{type:'array',items:{type:'object'}},totalFailures:{type:'integer'}},
    required:['failures','totalFailures'],additionalProperties:false},
  sideEffect:'read',requiredScopes:['workspace:read'],requiresPresence:false,idempotencySupport:true,recoverySupport:true};

/** Main-only composition of the existing public developer ports. No ambient credentials or network calls. */
export function createDesktopDeveloperToolsHost({githubModule,github,git,command,testLocate,workflows,
  exports:policies=[],now=Date.now}={}) {
  let active=true,application,f16Publication;
  const tools=[],disposers=[],unavailable=[];
  const readiness=new Map(),publicEnums=new Map();
  const missing=(capability,reason)=>unavailable.push({capability,reason});
  const host={register(tool){
    if(tools.some(item=>item.descriptor.name===tool.descriptor.name))throw Error('Duplicate developer tool');
    const guarded={...tool,execute:async(input,context)=>{if(!await ready(tool.descriptor.name,context))throw new ProtocolError('UNSUPPORTED_CAPABILITY','Developer host scope is unavailable');
      return tool.execute(input,context);}};
    tools.push(guarded);return ()=>{const index=tools.indexOf(guarded);if(index>=0)tools.splice(index,1);};
  }};
  let parserRoot,parserIdentity;
  const current=(context)=>active&&!context.signal?.aborted&&Number.isFinite(Date.parse(context.deadline))&&now()<Date.parse(context.deadline);
  const ready=async(name,context)=>{try{return current(context)&&await readiness.get(name)?.(context)===true;}catch{return false;}};
  try {
    if(github?.provider?.verification==='conditional'&&typeof github.available==='function'&&typeof githubModule?.register==='function') {
      const namesBefore=new Set(tools.map(tool=>tool.descriptor.name));
      disposers.push(githubModule.register(host,{provider:github.provider}));
      if(github.repairLinks===true&&typeof githubModule.registerGitHubRepairLinks==='function')
        disposers.push(githubModule.registerGitHubRepairLinks(host,{provider:github.provider,
          ...(typeof github.observeUnknown==='function'?{observeUnknown:github.observeUnknown}:{})}));
      else missing('github.actions.repair.link','separate_checks_write_opt_in_required');
      for(const tool of tools.filter(tool=>!namesBefore.has(tool.descriptor.name))) {
        readiness.set(tool.descriptor.name,github.available);
        const publicPaths=developerPublicEnumPaths;
        publicEnums.set(tool.descriptor.name,github.publicEnumPaths?.[tool.descriptor.name]??publicPaths[tool.descriptor.name]??[]);
      }
    }else missing('github','trusted_provider_repository_credentials_required');
    let gitTools;
    if(git?.options&&typeof git.available==='function') {
      const readVerification=async(context,runId)=>{
        const record=application?.runtime.readToolExecutions(context.taskId).find(item=>item.evidenceId===runId);
        const cached=application?.runtime.loadCheckpoint(context.taskId,'tool-result-'+runId);
        const receipt=application?.runtime.loadCheckpoint(context.taskId,'developer-git-verification:'+runId);
        if(!record||record.state!=='confirmed'||!record.executionStarted||record.policyDecision!=='allow'
          ||record.toolName!=='workspace.run_allowed_command'||cached?.result?.exitCode!==0
          ||receipt?.taskId!==context.taskId||receipt.runId!==runId||receipt.exitCode!==0)
          return f16Publication?.readVerification(context,runId);
        return receipt;
      };
      const publication=Object.fromEntries(['assertCurrent','load','saveOnce','observed'].map(name=>[name,async(...args)=>{
        if(!active||!f16Publication)throw new ProtocolError('UNSUPPORTED_CAPABILITY','F16 original publication binding is unavailable');
        return f16Publication[name](...args);
      }]));
      gitTools=coding.createGitTools({...git.options,readVerification,publication});
      for(const tool of Object.values(gitTools)){disposers.push(host.register(tool));readiness.set(tool.descriptor.name,
        tool.descriptor.name==='workspace.git.read_publication'?async scope=>Boolean(f16Publication)&&await git.available(scope)===true:git.available);}
    }else missing('workspace.git','trusted_branch_remote_paths_and_verification_required');
    if((command?.options||command?.tool)&&typeof command.available==='function') {
      if(git&&realpathSync(command.options?.rootPath??command.rootPath)!==realpathSync(git.options.rootPath))throw Error('Developer command and Git roots must match');
      const original=command.tool??coding.createWorkspaceCommandTool(command.options);
      const implementation={...original,descriptor:{...original.descriptor,requiredScopes:[...new Set([...original.descriptor.requiredScopes,
        ...(gitTools?['workspace:git:read']:[])])]},execute:async(input,context)=>{
        if(!gitTools)return original.execute(input,context);
        const beforeHead=await gitTools.head.execute({repository:git.options.repository},context);
        const before=await coding.readGitWorkspaceFingerprint(git.options.rootPath,git.options.allowedPaths);
        const result=await original.execute(input,context);
        const afterHead=await gitTools.head.execute({repository:git.options.repository},context);
        const after=await coding.readGitWorkspaceFingerprint(git.options.rootPath,git.options.allowedPaths);
        if(result.exitCode===0&&beforeHead.headSha===afterHead.headSha&&before.fingerprint===after.fingerprint) {
          if(!application)throw new ProtocolError('RESULT_UNKNOWN','Developer verification Runtime is unavailable');
          application.runtime.saveCheckpoint(context.taskId,'developer-git-verification:'+context.runId,
            {taskId:context.taskId,runId:context.runId,toolName:'workspace.run_allowed_command',status:'confirmed',exitCode:0,
              headSha:afterHead.headSha,files:after.files});
        }
        return result;
      }};
      disposers.push(host.register(implementation));readiness.set(original.descriptor.name,command.available);
      publicEnums.set(original.descriptor.name,command.publicEnumPaths??[]);
    }else missing('workspace.run_allowed_command','trusted_fixed_recipes_required');
    if(testLocate?.cacheRootPath&&typeof testLocate.available==='function') {
      // The public locator also reads source snippets. An empty host-owned parser root
      // exposes its deterministic log parser without granting a second source-read path.
      parserRoot=mkdtempSync(path.join(testLocate.cacheRootPath,'test-locate-'));parserIdentity=statSync(parserRoot,{bigint:true});
      const descriptor=structuredClone(developerTestLocatorDescriptor);
      disposers.push(host.register({descriptor,execute:async(input,context)=>{
        validateToolValue(descriptor.inputSchema,input);
        if(!context.authorizationRef||!context.scopes?.includes('workspace:read')||!current(context))throw new ProtocolError('SCOPE_DENIED','Test log parser requires original authorization');
        const identity=statSync(parserRoot,{bigint:true});
        if(identity.dev!==parserIdentity.dev||identity.ino!==parserIdentity.ino||readdirSync(parserRoot).length)
          throw new ProtocolError('REVISION_CONFLICT','Test log parser binding changed');
        const result=coding.locateTestFailures(input.output,{root:parserRoot,maxInputBytes:65536,contextLines:0});
        const projected={...result,failures:result.failures.map(failure=>({...failure,frames:failure.frames.map(({snippet,...frame})=>frame)}))};
        if(Buffer.byteLength(JSON.stringify(projected),'utf8')>131072)throw new ProtocolError('INVALID_ARGUMENT','Test failure report exceeds result budget');
        return projected;
      }}));readiness.set(descriptor.name,testLocate.available);
    }else missing('workspace.locate_test_failures','trusted_log_parser_scope_required');
    const registered=[...tools];
    const competitionToolExports=policies.map(policy=>{
      if(!registered.some(tool=>tool.descriptor.name===policy.toolName&&tool.descriptor.version===policy.toolVersion)
        ||typeof policy.accepts!=='function'||typeof policy.project!=='function'||!policy.exportPolicyVersion)throw Error('Invalid developer export policy');
      return {...policy,accepts:input=>active&&policy.accepts(input),project:async input=>{
        if(!active||input.signal?.aborted)throw new ProtocolError('UNAUTHORIZED','Developer export lease is unavailable');
        return policy.project(input);
      }};
    });
    const developerWorkflows=workflows?{...workflows,available:async(kind,scope)=>current(scope)&&await workflows.available(kind,scope)===true,
      assertCurrent:scope=>{if(!current(scope))throw new ProtocolError('UNAUTHORIZED','Developer workflow lease ended');workflows.assertCurrent(scope);}}:undefined;
    if(!developerWorkflows)missing('developer.workflows','trusted_model_rules_workspace_and_export_ports_required');
    return {tools:registered,competitionToolExports,
      configureF16Publication(port){
        if(f16Publication&&f16Publication!==port)throw Error('F16 publication port binding is immutable');
        if(['assertCurrent','load','saveOnce','observed','readVerification'].some(name=>typeof port?.[name]!=='function'))
          throw Error('F16 original publication ports are required');
        f16Publication=port;
      },
      readF16PublicationConfiguration(scope){
        if(!active||!gitTools)return undefined;
        if(scope)git.assertCurrent?.(scope);
        const {repository,rootPath,sourceBranch,remoteUrl,allowedPaths,authorName,authorEmail}=git.options;
        return {repository,rootPath,sourceBranch,remoteUrl,allowedPaths:[...allowedPaths],authorName,authorEmail};
      },
      competitionToolAvailability:registered.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
        publicEnumPaths:publicEnums.get(tool.descriptor.name)??[],available:context=>ready(tool.descriptor.name,context)})),
      ...(developerWorkflows?{runtimeOptions:{developerWorkflows}}:{runtimeOptions:{}}),
      unavailable,bind(value){if(application&&application!==value)throw Error('Developer Runtime binding is immutable');application=value;},
      close(){if(!active)return;active=false;for(const dispose of disposers.reverse()){try{dispose();}catch{}}
        if(parserRoot)rmSync(parserRoot,{recursive:true,force:true});}};
  }catch(error){active=false;for(const dispose of disposers.reverse()){try{dispose();}catch{}}
    if(parserRoot)rmSync(parserRoot,{recursive:true,force:true});throw error;}
}

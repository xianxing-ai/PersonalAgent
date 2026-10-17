import {randomUUID} from 'node:crypto';
import {lstat,mkdir,open,readFile,realpath,readdir,rename,writeFile} from 'node:fs/promises';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {parseCodingRepairPatch,parseCodingRepairPublishRequest} from '@personal-agent/contracts/coding-repair';
import type {CodingRepairInput,CodingRepairPatch,CodingRepairPublishReadback,CodingRepairPublishRequest,CodingRepairRecipe,
  CodingRepairSession,CodingRepairSnapshot,CodingRepairVerificationReceipt} from '@personal-agent/contracts/coding-repair';
import {createWorkspaceReadTool,createWorkspaceListTool,createWorkspacePatchPreviewTool,createWorkspacePatchApplyTool} from './index.js';
import type {WorkspacePatchApplyHostOptions} from './patch-apply.js';
import {reconcileWorkspacePatchApply} from './patch-reconcile.js';
import {captureCodingRepairSnapshot,codingRepairFilePath,codingRepairRelativePath,repairSha256,affectedCodingRepairPackages,codingRepairPackageGraphDigest} from './repair-verification.js';
import type {CapturedCodingRepairSnapshot} from './repair-verification.js';

interface StoredVerification {receipt:CodingRepairVerificationReceipt;snapshot:CodingRepairSnapshot;originTaskId:string;originRunId:string;}
interface RepairJournal {version:1;configurationRef:string;session:CodingRepairSession;allowedPaths:string[];baseline:CodingRepairSnapshot;graphKnown:boolean;
  recipes:CodingRepairRecipe[];prepared:boolean;preparationReason?:string;unknown?:{kind:'patch'|'command'|'publish';runId:string;path?:string;argumentsDigest?:string};
  verification:StoredVerification[];delivery?:CodingRepairPublishReadback;publishIntent?:CodingRepairPublishRequest;publishSnapshot?:CodingRepairSnapshot;
  pendingPatch?:CodingRepairPatch;pendingPatchAfterSha256?:string;}
export interface IsolatedCodingRepairHostOptions {
  workspaceRoot:string;sessionRoot:string;workspaceId:string;
  /** Stable trusted command/helper configuration identity, excluding credentials. */
  configurationRef?:string;
  patch:Omit<WorkspacePatchApplyHostOptions,'recoveryRootPath'>;
  recipes:readonly CodingRepairRecipe[];
  /** Maps a verified HostBridge child to its original graph task. No context rewriting. */
  resolveOriginalTaskId?:(taskId:string)=>string;
  /** Each returned command remains a fixed, existing host recipe scoped to this isolated cwd. */
  createCommandTool?:(input:{rootPath:string;session:CodingRepairSession})=>RegisteredTool;
  /** Optional trusted dependency preparation. Never links writable main-root dependencies/outputs. */
  prepareWorkspace?:(input:{sourceRoot:string;isolatedRoot:string;session:CodingRepairSession;deadline:string;signal:AbortSignal})=>Promise<{ready:boolean;reason?:string}>;
  assertRecoveryDirectory?:(path:string)=>void;
  /** Read original confirmed Runtime command/HostBridge Evidence, not model-supplied refs. */
  readVerificationEvidence?:(input:{session:CodingRepairSession;runId:string;originTaskId:string;originRunId:string})=>Promise<readonly string[]|undefined>;
  /** Only a trusted process host may confirm an interrupted command tree has stopped. */
  readCommandStopState?:(input:{session:CodingRepairSession;runId:string})=>Promise<'stopped'|'running'|'unknown'>;
  now?:()=>number;
}
export interface IsolatedCodingRepairHost {
  start(input:{mode:'main'|'isolated';allowedPaths?:string[]},context:ToolContext):Promise<CodingRepairInput>;
  list(sessionId:string,input:{path:string;limit?:number},context:ToolContext):Promise<unknown>;
  read(sessionId:string,input:{path:string;maxBytes?:number},context:ToolContext):Promise<unknown>;
  snapshot(sessionId:string,context:ToolContext):Promise<CodingRepairSnapshot>;
  /** approved means exact scope/preview passed, never Policy authorization or successful verification. */
  preview(sessionId:string,patches:readonly CodingRepairPatch[],context:ToolContext):Promise<{sessionId:string;approved:true;previewed:true;patches:unknown[]}>;
  patch(sessionId:string,patch:CodingRepairPatch,context:ToolContext):Promise<unknown>;
  verify(sessionId:string,recipeId:string,context:ToolContext):Promise<CodingRepairVerificationReceipt>;
  check(sessionId:string,patches:readonly CodingRepairPatch[],recipeIds:readonly string[],context:ToolContext):Promise<{version:1;sessionId:string;snapshot:CodingRepairSnapshot;verification:CodingRepairVerificationReceipt[]}>;
  publish(input:CodingRepairPublishRequest,context:ToolContext):Promise<CodingRepairPublishReadback>;
  reconcile(sessionId:string,context:ToolContext):Promise<{state:'clear'|'in_progress'|'unknown';delivery?:CodingRepairPublishReadback}>;
}
const scopes={read:'workspace:read',list:'workspace:list',patch:'workspace:apply',verify:'workspace:execute'};
const within=(root:string,value:string)=>{const p=relative(root,value);return !p||p!=='..'&&!p.startsWith('..'+sep)&&!isAbsolute(p);};
const clone=<T>(value:T):T=>structuredClone(value);
const denied=(message:string):never=>{throw new ProtocolError('REVISION_CONFLICT',message);};
function checkContext(context:ToolContext,scope:string,now:()=>number):void {
  if(!context.scopes.includes(scope)||(scope===scopes.patch&&(!context.scopes.includes('workspace:read')||!context.scopes.includes('workspace:write'))))throw new ProtocolError('SCOPE_DENIED','Coding repair operation scope is missing');
  if(context.signal.aborted)throw new ProtocolError('CANCELLED','Coding repair operation cancelled');
  if(!Number.isFinite(Date.parse(context.deadline))||now()>=Date.parse(context.deadline))throw new ProtocolError('TIMEOUT','Coding repair operation expired');
}
async function atomicJournal(file:string,journal:RepairJournal):Promise<void> {
  const temporary=file+'.'+randomUUID()+'.pending',handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(JSON.stringify(journal));await handle.sync();}finally{await handle.close();}
  await rename(temporary,file);
}
async function validateDependencyIsolation(root:string):Promise<void> {
  async function visit(path:string):Promise<void> {
    for(const item of await readdir(path,{withFileTypes:true})) {
      const target=join(path,item.name),info=await lstat(target);
      if(info.isSymbolicLink()) {
        if(!within(root,await realpath(target)))throw new ProtocolError('SCOPE_DENIED','Prepared dependencies or outputs link outside isolation');
      }else if(info.isDirectory())await visit(target);
      else if(!info.isFile()||info.nlink!==1)throw new ProtocolError('SCOPE_DENIED','Prepared dependencies or outputs share writable file identities');
    }
  }
  await visit(root);
}
/** Local trusted source host. It is a task directory boundary, not an OS filesystem sandbox. */
export async function createIsolatedCodingRepairHost(inputOptions:IsolatedCodingRepairHostOptions):Promise<IsolatedCodingRepairHost> {
  const options={...inputOptions,patch:{...inputOptions.patch},recipes:clone(inputOptions.recipes)};
  if((await lstat(options.workspaceRoot)).isSymbolicLink())throw new ProtocolError('SCOPE_DENIED','Repair user root cannot be a link');
  const sourceRoot=await realpath(options.workspaceRoot);await mkdir(options.sessionRoot,{recursive:true});
  const sessionsRoot=await realpath(options.sessionRoot),sourceInfo=await lstat(sourceRoot),sessionsInfo=await lstat(sessionsRoot);
  if(!sourceInfo.isDirectory()||!sessionsInfo.isDirectory()||within(sourceRoot,sessionsRoot)||within(sessionsRoot,sourceRoot)
    ||sourceInfo.isSymbolicLink()||sessionsInfo.isSymbolicLink())throw new ProtocolError('INVALID_ARGUMENT','Repair session root must be separate from the user workspace');
  const now=options.now??Date.now,active=new Set<string>();
  const configurationRef=repairSha256(JSON.stringify({version:1,sourceRoot,workspaceId:options.workspaceId,
    patch:options.patch,recipes:options.recipes,configurationRef:options.configurationRef??null}));
  const originalTask=(context:ToolContext)=>options.resolveOriginalTaskId?.(context.taskId)??context.taskId;
  async function rootCurrent():Promise<void> {
    const a=await lstat(sourceRoot),b=await lstat(sessionsRoot);
    if(await realpath(options.workspaceRoot)!==sourceRoot||await realpath(options.sessionRoot)!==sessionsRoot
      ||a.ino!==sourceInfo.ino||a.dev!==sourceInfo.dev||b.ino!==sessionsInfo.ino||b.dev!==sessionsInfo.dev
      ||a.isSymbolicLink()||b.isSymbolicLink())denied('Original repair host root binding changed');
  }
  const paths=(id:string)=>{if(!/^[a-f0-9-]{36}$/.test(id))throw new ProtocolError('INVALID_ARGUMENT','Invalid repair session');
    const directory=join(sessionsRoot,id);return {directory,workspace:join(directory,'workspace'),baseline:join(directory,'baseline'),recovery:join(directory,'recovery'),journal:join(directory,'journal.json')};};
  async function load(id:string,context:ToolContext):Promise<RepairJournal> {
    await rootCurrent();const p=paths(id);const info=await lstat(p.journal);
    if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||await realpath(p.directory)!==p.directory)denied('Repair journal binding changed');
    const journal=JSON.parse(await readFile(p.journal,'utf8')) as RepairJournal;
    if(journal.configurationRef!==configurationRef)denied('Original repair host configuration changed; restore its original command/helper binding');
    if(journal.version!==1||journal.session.sessionId!==id||journal.session.taskId!==originalTask(context)
      ||journal.session.workspaceId!==options.workspaceId)throw new ProtocolError('UNAUTHORIZED','Repair session does not belong to the original task');
    return journal;
  }
  async function exclusive<T>(id:string,context:ToolContext,scope:string,work:(journal:RepairJournal)=>Promise<T>):Promise<T> {
    checkContext(context,scope,now);if(active.has(id))denied('Repair session already has an active operation');active.add(id);
    try{const journal=await load(id,context);return await work(journal);}finally{active.delete(id);}
  }
  const save=(journal:RepairJournal)=>atomicJournal(paths(journal.session.sessionId).journal,journal);
  const requireStopped=(journal:RepairJournal)=>{if(journal.unknown)throw new ProtocolError('RESULT_UNKNOWN','Original repair operation requires stopped-process readback');};
  function requirePath(journal:RepairJournal,path:string):void {codingRepairRelativePath(path);if(!journal.allowedPaths.includes(path))throw new ProtocolError('SCOPE_DENIED','File is outside the original repair target set');}
  async function current(journal:RepairJournal):Promise<CapturedCodingRepairSnapshot>{return captureCodingRepairSnapshot(paths(journal.session.sessionId).workspace);}
  function statuses(journal:RepairJournal,snapshot:CapturedCodingRepairSnapshot):CodingRepairVerificationReceipt[] {
    return journal.verification.map(item=>{const affected=affectedCodingRepairPackages(item.snapshot,snapshot.snapshot,snapshot.graphKnown&&journal.graphKnown);
      return {...clone(item.receipt),status:['VALID','FAILED'].includes(item.receipt.status)&&item.receipt.packageIds.some(id=>affected.has(id))?'STALE':item.receipt.status};});
  }
  async function userReadSetCurrent(journal:RepairJournal,selected:readonly CodingRepairVerificationReceipt[],delivered:CodingRepairPublishReadback['files']=[]):Promise<boolean> {
    const observed=await captureCodingRepairSnapshot(sourceRoot),readPackages=new Set(selected.flatMap(receipt=>receipt.packageIds));
    const packages=journal.baseline.packages;
    let added=true;while(added){added=false;for(const id of [...readPackages])for(const dep of packages.find(pkg=>pkg.id===id)?.dependencies??[])
      if(!readPackages.has(dep)){readPackages.add(dep);added=true;}}
    const all=!journal.graphKnown||!observed.graphKnown||readPackages.has('root');
    const relevant=(file:CodingRepairSnapshot['files'][number])=>all||file.packageId==='root'&&['config','lock'].includes(file.kind)
      ||packages.some(pkg=>pkg.path&&readPackages.has(pkg.id)&&file.path.startsWith(pkg.path+'/'));
    const baseline=new Map(journal.baseline.files.map(file=>[file.path,file]));
    const current=new Map(observed.snapshot.files.map(file=>[file.path,file]));
    const applied=new Map(delivered.map(file=>[file.path,file.afterSha256]));
    for(const name of new Set([...baseline.keys(),...current.keys()])) {
      const before=baseline.get(name),after=current.get(name);if(!relevant(before??after!))continue;
      if((after?.sha256??null)!==(applied.has(name)?applied.get(name):(before?.sha256??null)))return false;
    }
    return true;
  }
  async function previewPatch(journal:RepairJournal,value:CodingRepairPatch,context:ToolContext):Promise<unknown> {
    const patch=parseCodingRepairPatch(value);requirePath(journal,patch.path);const p=paths(journal.session.sessionId);
    if(patch.expectedSha256===null){const destination=await codingRepairFilePath(p.workspace,patch.path,true);
      try{await lstat(destination);denied('New coding repair file already exists');}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error;}
      return {path:patch.path,beforeSha256:null,afterSha256:repairSha256(patch.createText!),changed:true,previewText:patch.createText};}
    return createWorkspacePatchPreviewTool({rootPath:p.workspace}).execute(patch,context);
  }
  async function applyPatch(journal:RepairJournal,value:CodingRepairPatch,context:ToolContext):Promise<unknown> {
    requireStopped(journal);const patch=parseCodingRepairPatch(value);const preview=await previewPatch(journal,patch,context) as {afterSha256:string};
    checkContext(context,scopes.patch,now);const p=paths(journal.session.sessionId);
    journal.unknown={kind:'patch',runId:context.runId,path:patch.path,...(context.argumentsDigest?{argumentsDigest:context.argumentsDigest}:{})};journal.pendingPatch=clone(patch);journal.pendingPatchAfterSha256=preview.afterSha256;await save(journal);
    let result:unknown;
    if(patch.expectedSha256===null){const destination=await codingRepairFilePath(p.workspace,patch.path,true);
      await mkdir(resolve(destination,'..'),{recursive:true});await codingRepairFilePath(p.workspace,patch.path,true);
      const handle=await open(destination,'wx',0o600);try{await handle.writeFile(patch.createText!);await handle.sync();}finally{await handle.close();}
      const afterSha256=repairSha256(await readFile(destination));if(afterSha256!==repairSha256(patch.createText!))throw new ProtocolError('RESULT_UNKNOWN','New repair file readback mismatched');
      result={path:patch.path,beforeSha256:null,afterSha256,applied:true,changed:true};
    }else{
      options.assertRecoveryDirectory?.(p.recovery);
      result=await createWorkspacePatchApplyTool({rootPath:p.workspace,recoveryRootPath:p.recovery,...options.patch}).execute(patch,context);
    }
    delete journal.unknown;delete journal.pendingPatch;await save(journal);return result;
  }
  async function verify(journal:RepairJournal,recipeId:string,context:ToolContext):Promise<CodingRepairVerificationReceipt> {
    requireStopped(journal);const recipe=journal.recipes.find(item=>item.recipeId===recipeId);
    if(!recipe||!journal.prepared||!options.createCommandTool)throw new ProtocolError('UNSUPPORTED_CAPABILITY',journal.preparationReason??'Isolated verification recipe or dependency preparation is unavailable');
    const tool=options.createCommandTool({rootPath:paths(journal.session.sessionId).workspace,session:clone(journal.session)});
    if(tool.descriptor.name!=='workspace.run_allowed_command'||tool.descriptor.version!=='1.0.0')throw new ProtocolError('UNAUTHORIZED','Repair command must use the original fixed recipe tool');
    const input={recipeId};validateToolValue(tool.descriptor.inputSchema,input);
    const before=await current(journal),runId=context.runId+'-verify-'+recipeId;
    if(journal.verification.some(item=>item.receipt.runId===runId))denied('Original verification run identity cannot be reused');
    journal.unknown={kind:'command',runId};await save(journal);
    let output:{recipeId:string;exitCode:number;stdout:string;stderr:string};
    try{output=await tool.execute(input,context) as typeof output;checkContext(context,scopes.verify,now);}
    catch(error){const receipt:CodingRepairVerificationReceipt={version:1,sessionId:journal.session.sessionId,runId,recipeId,
      packageIds:[...recipe.packageIds],inputSnapshotId:before.snapshot.snapshotId,files:before.snapshot.files,exitCode:null,status:'UNKNOWN',evidenceRefs:[],diagnostics:[{source:'command',message:'Original command did not return a stopped, current result'}]};
      receipt.packageGraphDigest=codingRepairPackageGraphDigest(before.snapshot);
      journal.verification.push({receipt,snapshot:before.snapshot,originTaskId:context.taskId,originRunId:context.runId});await save(journal);throw error;}
    if(output.recipeId!==recipeId||!Number.isSafeInteger(output.exitCode)||typeof output.stdout!=='string'||typeof output.stderr!=='string')throw new ProtocolError('RESULT_UNKNOWN','Repair command output is invalid');
    const after=await current(journal),same=before.snapshot.snapshotId===after.snapshot.snapshotId;
    const receipt:CodingRepairVerificationReceipt={version:1,sessionId:journal.session.sessionId,runId,recipeId,packageIds:[...recipe.packageIds],
      inputSnapshotId:before.snapshot.snapshotId,files:before.snapshot.files,exitCode:output.exitCode,status:!same?'STALE':output.exitCode===0?'VALID':'FAILED',evidenceRefs:[],
      diagnostics:output.exitCode===0?[]:[{source:'command',message:(output.stderr||output.stdout||'Verification command failed').slice(0,8192)}]};
    receipt.packageGraphDigest=codingRepairPackageGraphDigest(before.snapshot);
    journal.verification.push({receipt,snapshot:before.snapshot,originTaskId:context.taskId,originRunId:context.runId});delete journal.unknown;await save(journal);return clone(receipt);
  }
  const host:IsolatedCodingRepairHost={
    async start(input,context){checkContext(context,scopes.patch,now);await rootCurrent();
      if(!['main','isolated'].includes(input.mode))throw new ProtocolError('INVALID_ARGUMENT','Invalid repair mode');
      const captured=await captureCodingRepairSnapshot(sourceRoot),session:CodingRepairSession={version:1,sessionId:randomUUID(),taskId:originalTask(context),workspaceId:options.workspaceId,mode:input.mode,baselineSnapshotId:captured.snapshot.snapshotId};
      const p=paths(session.sessionId);await mkdir(p.workspace,{recursive:true});await mkdir(p.baseline,{recursive:true});await mkdir(p.recovery,{recursive:true});
      const allowedPaths=input.allowedPaths??captured.snapshot.files.map(file=>file.path);for(const path of allowedPaths)codingRepairRelativePath(path);
      for(const file of captured.snapshot.files){checkContext(context,scopes.patch,now);const source=await codingRepairFilePath(sourceRoot,file.path),bytes=await readFile(source);
        if(repairSha256(bytes)!==file.sha256)denied('User baseline changed while copying isolation');
        for(const root of [p.workspace,p.baseline]){const target=join(root,...file.path.split('/'));await mkdir(resolve(target,'..'),{recursive:true});await writeFile(target,bytes,{flag:'wx',mode:0o600});}}
      if((await captureCodingRepairSnapshot(sourceRoot)).snapshot.snapshotId!==captured.snapshot.snapshotId
        ||(await captureCodingRepairSnapshot(p.workspace)).snapshot.snapshotId!==captured.snapshot.snapshotId)denied('Repair baseline copy is not the original user snapshot');
      const packageIds=captured.snapshot.packages.map(pkg=>pkg.id),recipes=options.recipes.map(recipe=>({...clone(recipe),packageIds:recipe.packageIds.length?[...recipe.packageIds]:packageIds}));
      if(!recipes.some(recipe=>recipe.required)||recipes.some(recipe=>recipe.packageIds.some(id=>!packageIds.includes(id))))throw new ProtocolError('INVALID_ARGUMENT','Repair recipes do not cover known packages');
      const prepared=options.prepareWorkspace?await options.prepareWorkspace({sourceRoot,isolatedRoot:p.workspace,session:clone(session),deadline:context.deadline,signal:context.signal}):{ready:true,reason:undefined as string|undefined};
      // Without preparation, dependency-bearing projects stay explicitly unavailable.
      if(!options.prepareWorkspace)for(const file of captured.snapshot.files.filter(file=>file.path.endsWith('package.json'))){try{const manifest=JSON.parse(await readFile(join(p.workspace,file.path),'utf8'));if(Object.keys(manifest.dependencies??{}).length||Object.keys(manifest.devDependencies??{}).length)prepared.ready=false;}catch{prepared.ready=false;}}
      await validateDependencyIsolation(p.workspace);checkContext(context,scopes.patch,now);
      if((await captureCodingRepairSnapshot(p.workspace)).snapshot.snapshotId!==captured.snapshot.snapshotId)denied('Dependency preparation changed the original source or configuration');
      const journal:RepairJournal={version:1,configurationRef,session,allowedPaths:[...new Set(allowedPaths)],baseline:captured.snapshot,graphKnown:captured.graphKnown,recipes,prepared:prepared.ready,verification:[],...(!prepared.ready?{preparationReason:prepared.reason??'Independent dependency preparation is unavailable'}:{})};
      await save(journal);return {version:1,session:clone(session),initialSnapshot:clone(captured.snapshot),recipes:clone(recipes)};},
    list:(id,input,context)=>exclusive(id,context,scopes.list,journal=>createWorkspaceListTool({rootPath:paths(journal.session.sessionId).workspace}).execute(input,context)),
    read:(id,input,context)=>exclusive(id,context,scopes.read,async journal=>{requirePath(journal,input.path);return createWorkspaceReadTool({rootPath:paths(id).workspace}).execute(input,context);}),
    snapshot:(id,context)=>exclusive(id,context,scopes.read,async journal=>clone((await current(journal)).snapshot)),
    preview:(id,patches,context)=>exclusive(id,context,scopes.read,async journal=>{if(new Set(patches.map(patch=>patch.path)).size!==patches.length)throw new ProtocolError('INVALID_ARGUMENT','Combine ordered edits for each file into one exact patch');
      return {sessionId:id,approved:true,previewed:true,patches:await Promise.all(patches.map(patch=>previewPatch(journal,patch,context)))};}),
    patch:(id,patch,context)=>exclusive(id,context,scopes.patch,journal=>applyPatch(journal,patch,context)),
    verify:(id,recipeId,context)=>exclusive(id,context,scopes.verify,journal=>verify(journal,recipeId,context)),
    check:(id,patches,recipeIds,context)=>exclusive(id,context,scopes.patch,async journal=>{if(new Set(recipeIds).size!==recipeIds.length)throw new ProtocolError('INVALID_ARGUMENT','Duplicate repair verification recipe');
      for(const patch of patches)await applyPatch(journal,patch,context);
      checkContext(context,scopes.verify,now);for(const recipeId of recipeIds)await verify(journal,recipeId,context);const snapshot=await current(journal);
      return {version:1,sessionId:id,snapshot:clone(snapshot.snapshot),verification:statuses(journal,snapshot)};}),
    publish:(value,context)=>exclusive(value.sessionId,context,scopes.patch,async journal=>{
      const request=parseCodingRepairPublishRequest(value);requireStopped(journal);
      if(journal.session.mode!=='main')throw new ProtocolError('SCOPE_DENIED','Isolated shadow session cannot publish to the user root');
      if(journal.delivery){
        if(!journal.publishIntent||JSON.stringify(journal.publishIntent)!==JSON.stringify(request))denied('Original publish input identity changed');
        if(journal.delivery.state==='published')return clone(journal.delivery);
        if(journal.delivery.state!=='unknown')denied('Original delivery was reconciled without complete success; use a new baseline before another publish');
        throw new ProtocolError('RESULT_UNKNOWN','Original partial publish requires reconciliation');}
      const snapshot=await current(journal);if(request.baselineSnapshotId!==journal.baseline.snapshotId||request.snapshotId!==snapshot.snapshot.snapshotId)denied('Repair publish snapshot binding changed');
      const originalFiles=new Map(journal.baseline.files.map(file=>[file.path,file.sha256]));
      const changed=snapshot.snapshot.files.filter(file=>originalFiles.get(file.path)!==file.sha256).map(file=>file.path).sort();
      if(!request.paths.length||JSON.stringify([...request.paths].sort())!==JSON.stringify(changed)
        ||journal.baseline.files.some(file=>!snapshot.snapshot.files.some(current=>current.path===file.path)))denied('Publish must include exactly the current verified changed files; deletion is unsupported');
      const verification=statuses(journal,snapshot),selected=verification.filter(receipt=>request.verificationRunIds.includes(receipt.runId));
      if(selected.length!==request.verificationRunIds.length)denied('Publish referenced an unknown verification run');
      if(journal.recipes.filter(recipe=>recipe.required).some(recipe=>!selected.some(receipt=>receipt.recipeId===recipe.recipeId&&receipt.status==='VALID'))||!selected.length)denied('Current required repair verification is missing or stale');
      if(!await userReadSetCurrent(journal,selected))return {version:1,sessionId:request.sessionId,state:'conflict',files:[],evidenceRefs:[]};
      const evidenceRefs:string[]=[];
      for(const receipt of selected){if(receipt.status!=='VALID')denied('Publish referenced non-current verification');const original=journal.verification.find(item=>item.receipt.runId===receipt.runId)!;
        const refs=await options.readVerificationEvidence?.({session:clone(journal.session),runId:receipt.runId,originTaskId:original.originTaskId,originRunId:original.originRunId});
        if(!refs?.length)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original confirmed Runtime verification Evidence is unavailable');evidenceRefs.push(...refs);}
      for(const path of request.paths){requirePath(journal,path);const baseline=journal.baseline.files.find(file=>file.path===path),currentFile=snapshot.snapshot.files.find(file=>file.path===path);
        if(!currentFile?.sha256)denied('Publish requires an existing verified isolated file');
        const destination=await codingRepairFilePath(sourceRoot,path,true);let actual:string|null=null;try{actual=repairSha256(await readFile(destination));}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error;}
        if(actual!==(baseline?.sha256??null))return {version:1,sessionId:request.sessionId,state:'conflict',files:[],evidenceRefs:[]};}
      checkContext(context,scopes.patch,now);journal.delivery={version:1,sessionId:request.sessionId,state:'unknown',files:[],evidenceRefs:[...new Set(evidenceRefs)]};
      if((await current(journal)).snapshot.snapshotId!==snapshot.snapshot.snapshotId)denied('Isolated sources changed while checking Runtime Evidence');
      if(!await userReadSetCurrent(journal,selected))return {version:1,sessionId:request.sessionId,state:'conflict',files:[],evidenceRefs:[]};
      journal.publishIntent=clone(request);journal.publishSnapshot=clone(snapshot.snapshot);
      journal.unknown={kind:'publish',runId:context.runId};await save(journal);
      try {for(const path of request.paths){checkContext(context,scopes.patch,now);await rootCurrent();
        if(!await userReadSetCurrent(journal,selected,journal.delivery.files))throw new ProtocolError('REVISION_CONFLICT','User verification read set changed during publish');
        journal.unknown={kind:'publish',runId:context.runId,path,...(context.argumentsDigest?{argumentsDigest:context.argumentsDigest}:{})};await save(journal);
        const p=paths(request.sessionId),baseline=journal.baseline.files.find(file=>file.path===path),bytes=await readFile(await codingRepairFilePath(p.workspace,path));
        const file=snapshot.snapshot.files.find(file=>file.path===path)!;if(repairSha256(bytes)!==file.sha256)denied('Isolated delivery bytes changed after verification');
        if(baseline?.sha256){const previous=await readFile(await codingRepairFilePath(p.baseline,path),'utf8');
          const proposed=bytes.toString('utf8');if(Buffer.from(proposed).compare(bytes)!==0)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Binary source delivery is unsupported');
          options.assertRecoveryDirectory?.(p.recovery);await createWorkspacePatchApplyTool({rootPath:sourceRoot,recoveryRootPath:p.recovery,...options.patch}).execute({path,expectedSha256:baseline.sha256,edits:[{oldText:previous,newText:proposed}]},context);
        }else{const destination=await codingRepairFilePath(sourceRoot,path,true);await mkdir(resolve(destination,'..'),{recursive:true});await codingRepairFilePath(sourceRoot,path,true);const handle=await open(destination,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}}
        if(repairSha256(await readFile(await codingRepairFilePath(sourceRoot,path)))!==file.sha256)throw new ProtocolError('RESULT_UNKNOWN','Repair publish readback failed');
        journal.delivery.files.push({path,beforeSha256:baseline?.sha256??null,afterSha256:file.sha256});await save(journal);}
      if((await current(journal)).snapshot.snapshotId!==snapshot.snapshot.snapshotId)throw new ProtocolError('RESULT_UNKNOWN','Isolated sources changed during publish; retain partial journal for readback');
      if(!await userReadSetCurrent(journal,selected,journal.delivery.files))throw new ProtocolError('RESULT_UNKNOWN','User verification read set changed after delivery');
      journal.delivery.state='published';delete journal.unknown;await save(journal);return clone(journal.delivery);
      }catch{journal.delivery.state='unknown';await save(journal);return clone(journal.delivery);}
    }),
    reconcile:(id,context)=>exclusive(id,context,scopes.read,async journal=>{if(!journal.unknown)return {state:'clear'};
      if(journal.unknown.kind==='command') {
        const state=await options.readCommandStopState?.({session:clone(journal.session),runId:journal.unknown.runId});
        if(state==='running')return {state:'in_progress'};
        if(state!=='stopped')return {state:'unknown'};
        delete journal.unknown;await save(journal);return {state:'clear'};
      }
      if(journal.unknown.kind==='publish') {
        if(!journal.delivery||!journal.publishIntent||!journal.publishSnapshot||!journal.unknown.path)return {state:'unknown'};
        const original=journal.baseline.files.find(file=>file.path===journal.unknown!.path);
        if(original?.sha256) {
          try {
            const result=await reconcileWorkspacePatchApply({rootPath:sourceRoot,recoveryRootPath:paths(id).recovery,...options.patch,
              relativePath:original.path,expectedRunId:journal.unknown.runId,expectedBeforeSha256:original.sha256,
              ...(journal.unknown.argumentsDigest?{expectedArgumentsDigest:journal.unknown.argumentsDigest}:{})});
            if(result.state==='in_progress')return {state:'in_progress',delivery:clone(journal.delivery)};
            if(result.state==='reconciled'&&result.outcome==='unknown')return {state:'unknown',delivery:clone(journal.delivery)};
            // A clear original marker records no outstanding helper. Existing
            // apply removes it only after close, never on cancellation acceptance.
          }catch{return {state:'unknown',delivery:clone(journal.delivery)};}
        }
        const files:CodingRepairPublishReadback['files']=[];let allAfter=true,allBefore=true;
        for(const name of journal.publishIntent.paths) {
          let actual:string|null=null;const file=await codingRepairFilePath(sourceRoot,name,true);
          try{actual=repairSha256(await readFile(file));}catch(error){if((error as {code?:string}).code!=='ENOENT')return {state:'unknown',delivery:clone(journal.delivery)};}
          const before=journal.baseline.files.find(item=>item.path===name)?.sha256??null,after=journal.publishSnapshot.files.find(item=>item.path===name)?.sha256??null;
          allAfter&&=actual===after;allBefore&&=actual===before;
          files.push({path:name,beforeSha256:before,afterSha256:actual});
        }
        const selected=journal.verification.filter(item=>journal.publishIntent!.verificationRunIds.includes(item.receipt.runId)).map(item=>item.receipt);
        const readSetMatches=await userReadSetCurrent(journal,selected,files);
        journal.delivery={...journal.delivery,state:allAfter&&readSetMatches?'published':allBefore?'not_started':'conflict',files};
        delete journal.unknown;await save(journal);return {state:'clear',delivery:clone(journal.delivery)};
      }
      if(!journal.unknown.path||!journal.pendingPatch)return {state:'unknown'};
      if(journal.pendingPatch.expectedSha256===null) {
        const file=await codingRepairFilePath(paths(id).workspace,journal.unknown.path,true);
        let actual:string|null=null;try{actual=repairSha256(await readFile(file));}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error;}
        if(actual!==null&&actual!==repairSha256(journal.pendingPatch.createText!))return {state:'unknown'};
        delete journal.unknown;delete journal.pendingPatch;await save(journal);return {state:'clear'};
      }
      const p=paths(id),result=await reconcileWorkspacePatchApply({rootPath:p.workspace,recoveryRootPath:p.recovery,...options.patch,relativePath:journal.unknown.path,expectedRunId:journal.unknown.runId});
      if(result.state==='in_progress')return {state:'in_progress'};
      if(result.state==='clear') {
        // A missing in-flight marker means the helper has exited; it does not prove whether it wrote.
        // Compare only with the original preview, never reconstruct or retry the interrupted write.
        if(!journal.pendingPatchAfterSha256)return {state:'unknown'};
        try {const file=await codingRepairFilePath(p.workspace,journal.unknown.path,true),actual=repairSha256(await readFile(file));
          if(actual!==journal.pendingPatch.expectedSha256&&actual!==journal.pendingPatchAfterSha256)return {state:'unknown'};
        }catch{return {state:'unknown'};}
      }
      if(result.state==='clear'||result.state==='reconciled'&&result.outcome!=='unknown'){delete journal.unknown;delete journal.pendingPatch;delete journal.pendingPatchAfterSha256;await save(journal);return {state:'clear'};}return {state:'unknown'};}),
  };return host;
}

/** Every operation is a normal RegisteredTool; grants/Evidence remain the outer Runtime's job. */
export function createIsolatedCodingRepairTools(host:IsolatedCodingRepairHost):RegisteredTool[] {
  const string={type:'string',minLength:1},id={sessionId:string},patchSchema={type:'object'};
  const entries:Array<{name:string;scope:string[];properties:Record<string,unknown>;required?:string[];run:(value:any,context:ToolContext)=>Promise<unknown>}>= [
    {name:'start',scope:['workspace:read','workspace:write',scopes.patch],properties:{mode:{enum:['main','isolated']},allowedPaths:{type:'array',items:string}},required:['mode'],run:(v,c)=>host.start(v,c)},
    {name:'list',scope:[scopes.list],properties:{...id,path:string,limit:{type:'integer',minimum:1}},required:['sessionId','path'],run:(v,c)=>host.list(v.sessionId,{path:v.path,...(v.limit===undefined?{}:{limit:v.limit})},c)},
    {name:'read',scope:[scopes.read],properties:{...id,path:string,maxBytes:{type:'integer',minimum:1}},required:['sessionId','path'],run:(v,c)=>host.read(v.sessionId,{path:v.path,...(v.maxBytes===undefined?{}:{maxBytes:v.maxBytes})},c)},
    {name:'snapshot',scope:[scopes.read],properties:id,run:(v,c)=>host.snapshot(v.sessionId,c)},
    {name:'preview',scope:[scopes.read],properties:{...id,patches:{type:'array',items:patchSchema}},run:async(v,c)=>{
      const preview=await host.preview(v.sessionId,v.patches,c);
      // Project before the original ToolGateway records/signs this result. Source text
      // remains in the local preview; exporting source uses the separate exact read grant.
      return {sessionId:preview.sessionId,approved:preview.approved,previewed:preview.previewed,
        patches:preview.patches.map(value=>{
          if(!value||typeof value!=='object'||Array.isArray(value))throw new ProtocolError('PROTOCOL_MISMATCH','Invalid coding preview metadata');
          const patch=value as Record<string,unknown>;
          return {path:patch.path,beforeSha256:patch.beforeSha256,afterSha256:patch.afterSha256,changed:patch.changed};
        })};
    }},
    {name:'patch',scope:['workspace:read','workspace:write',scopes.patch],properties:{...id,patch:patchSchema},run:(v,c)=>host.patch(v.sessionId,v.patch,c)},
    {name:'verify',scope:[scopes.verify],properties:{...id,recipeId:string},run:(v,c)=>host.verify(v.sessionId,v.recipeId,c)},
    {name:'check',scope:['workspace:read','workspace:write',scopes.patch,scopes.verify],properties:{...id,patches:{type:'array',items:patchSchema},recipeIds:{type:'array',items:string}},run:(v,c)=>host.check(v.sessionId,v.patches,v.recipeIds,c)},
    {name:'publish',scope:['workspace:read','workspace:write',scopes.patch],properties:{version:{const:1},...id,baselineSnapshotId:string,snapshotId:string,paths:{type:'array',items:string},verificationRunIds:{type:'array',items:string}},run:(v,c)=>host.publish(v,c)},
    {name:'reconcile',scope:[scopes.read],properties:id,run:(v,c)=>host.reconcile(v.sessionId,c)},
  ];
  return entries.map(entry=>{const descriptor:RegisteredTool['descriptor']={name:'coding.repair.'+entry.name,version:'1.0.0',inputSchema:{type:'object',properties:entry.properties,required:entry.required??Object.keys(entry.properties),additionalProperties:false},outputSchema:{},sideEffect:['read','list','snapshot','preview','reconcile'].includes(entry.name)?'read':'local_write',requiredScopes:entry.scope,idempotencySupport:false,recoverySupport:false,requiresPresence:false};
    return {descriptor,execute:async(value,context)=>{validateToolValue(descriptor.inputSchema,value);return entry.run(value,context);}};});
}

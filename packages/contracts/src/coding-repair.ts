import {ProtocolError} from './index.js';

/** Provisional host/image data contract. A parsed value is neither a grant nor trusted Evidence. */
export const CODING_REPAIR_VERSION = 1 as const;
export interface CodingRepairSession {version:1;sessionId:string;taskId:string;workspaceId:string;mode:'main'|'isolated';baselineSnapshotId:string}
export interface CodingRepairFile {path:string;sha256:string|null;packageId:string;kind:'source'|'test'|'config'|'lock'|'other';content?:string}
export interface CodingRepairPackage {id:string;path:string;dependencies:string[]}
export interface CodingRepairSnapshot {snapshotId:string;files:CodingRepairFile[];packages:CodingRepairPackage[]}
export interface CodingRepairRecipe {recipeId:string;packageIds:string[];required:boolean}
export interface CodingRepairDiagnostic {message:string;source:string;path?:string;line?:number;column?:number;code?:string}
export type CodingRepairVerificationStatus='VALID'|'STALE'|'FAILED'|'UNKNOWN';
export interface CodingRepairVerificationReceipt {version:1;sessionId:string;runId:string;recipeId:string;packageIds:string[];
  inputSnapshotId:string;files:CodingRepairFile[];exitCode:number|null;status:CodingRepairVerificationStatus;
  evidenceRefs:string[];diagnostics:CodingRepairDiagnostic[];packageGraphDigest?:string}
export interface CodingRepairPatch {path:string;expectedSha256:string|null;edits:{oldText:string;newText:string}[];createText?:string}
export interface CodingRepairPublishRequest {version:1;sessionId:string;baselineSnapshotId:string;snapshotId:string;paths:string[];verificationRunIds:string[]}
export interface CodingRepairPublishReadback {version:1;sessionId:string;state:'published'|'conflict'|'unknown'|'not_started';
  files:{path:string;beforeSha256:string|null;afterSha256:string|null}[];evidenceRefs:string[]}
export interface CodingRepairInput {version:1;session:CodingRepairSession;initialSnapshot:CodingRepairSnapshot;recipes:CodingRepairRecipe[]}
export interface CodingRepairCheckReadback {version:1;sessionId:string;snapshot:CodingRepairSnapshot;verification:CodingRepairVerificationReceipt[]}
const fail=():never=>{throw new ProtocolError('INVALID_ARGUMENT','Invalid coding repair v1 data');};
const record=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))return fail();return value as Record<string,unknown>;};
const keys=(value:Record<string,unknown>,required:string[],optional:string[]=[])=>{
  if(required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>!required.includes(key)&&!optional.includes(key)))fail();
};
const text=(value:unknown):string=>{if(typeof value!=='string'||!value.trim())return fail();return value;};
const id=(value:unknown):string=>{const result=text(value);if(!/^[A-Za-z0-9@][A-Za-z0-9_.:/@-]*$/.test(result))return fail();return result;};
const path=(value:unknown):string=>{const result=text(value);if(result.includes('\\')||result.startsWith('/')||/^[A-Za-z]:/.test(result)
  ||result.split('/').some(part=>part==='..'||part===''||part==='.')||result.includes('\0'))return fail();return result;};
const sha=(value:unknown):string|null=>{if(value===null)return null;if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))return fail();return value;};
const array=<T>(value:unknown,parse:(value:unknown)=>T):T[]=>{if(!Array.isArray(value))return fail();return value.map(parse);};
const unique=(value:unknown,parse:(value:unknown)=>string):string[]=>{const result=array(value,parse);if(new Set(result).size!==result.length)fail();return result;};
function file(value:unknown):CodingRepairFile {
  const v=record(value);keys(v,['path','sha256','packageId','kind'],['content']);
  if(!['source','test','config','lock','other'].includes(String(v.kind))||v.content!==undefined&&typeof v.content!=='string')fail();
  return {path:path(v.path),sha256:sha(v.sha256),packageId:id(v.packageId),kind:v.kind as CodingRepairFile['kind'],
    ...(v.content===undefined?{}:{content:v.content as string})};
}
export function parseCodingRepairSession(value:unknown):CodingRepairSession {
  const v=record(value);keys(v,['version','sessionId','taskId','workspaceId','mode','baselineSnapshotId']);
  if(v.version!==1||!['main','isolated'].includes(String(v.mode)))fail();
  return {version:1,sessionId:id(v.sessionId),taskId:id(v.taskId),workspaceId:id(v.workspaceId),mode:v.mode as CodingRepairSession['mode'],baselineSnapshotId:id(v.baselineSnapshotId)};
}
export function parseCodingRepairSnapshot(value:unknown):CodingRepairSnapshot {
  const v=record(value);keys(v,['snapshotId','files','packages']);
  const files=array(v.files,file),packages=array(v.packages,value=>{const p=record(value);keys(p,['id','path','dependencies']);
    return {id:id(p.id),path:p.path===''?'':path(p.path),dependencies:unique(p.dependencies,id)};});
  if(new Set(files.map(f=>f.path)).size!==files.length||new Set(packages.map(p=>p.id)).size!==packages.length
    ||files.some(f=>!packages.some(p=>p.id===f.packageId))||packages.some(p=>p.dependencies.some(dep=>dep===p.id||!packages.some(other=>other.id===dep))))fail();
  const visiting=new Set<string>(),visited=new Set<string>();
  const visit=(key:string):void=>{if(visiting.has(key))fail();if(visited.has(key))return;visiting.add(key);
    for(const dep of packages.find(p=>p.id===key)!.dependencies)visit(dep);visiting.delete(key);visited.add(key);};
  for(const p of packages)visit(p.id);
  return {snapshotId:id(v.snapshotId),files,packages};
}
export function parseCodingRepairRecipe(value:unknown):CodingRepairRecipe {
  const v=record(value);keys(v,['recipeId','packageIds','required']);if(typeof v.required!=='boolean')fail();
  return {recipeId:id(v.recipeId),packageIds:unique(v.packageIds,id),required:v.required as boolean};
}
export function parseCodingRepairDiagnostic(value:unknown):CodingRepairDiagnostic {
  const v=record(value);keys(v,['message','source'],['path','line','column','code']);
  for(const name of ['line','column'])if(v[name]!==undefined&&(!Number.isSafeInteger(v[name])||(v[name] as number)<1))fail();
  return {message:text(v.message),source:text(v.source),...(v.path===undefined?{}:{path:path(v.path)}),
    ...(v.line===undefined?{}:{line:v.line as number}),...(v.column===undefined?{}:{column:v.column as number}),...(v.code===undefined?{}:{code:text(v.code)})};
}
export function parseCodingRepairVerificationReceipt(value:unknown):CodingRepairVerificationReceipt {
  const v=record(value);keys(v,['version','sessionId','runId','recipeId','packageIds','inputSnapshotId','files','exitCode','status','evidenceRefs','diagnostics'],['packageGraphDigest']);
  if(v.version!==1||!['VALID','STALE','FAILED','UNKNOWN'].includes(String(v.status))
    ||v.exitCode!==null&&!Number.isSafeInteger(v.exitCode)||v.status==='VALID'&&v.exitCode!==0||v.status==='FAILED'&&(v.exitCode===null||v.exitCode===0))fail();
  return {version:1,sessionId:id(v.sessionId),runId:id(v.runId),recipeId:id(v.recipeId),packageIds:unique(v.packageIds,id),
    inputSnapshotId:id(v.inputSnapshotId),files:array(v.files,file),exitCode:v.exitCode as number|null,status:v.status as CodingRepairVerificationStatus,
    evidenceRefs:unique(v.evidenceRefs,text),diagnostics:array(v.diagnostics,parseCodingRepairDiagnostic),
    ...(v.packageGraphDigest===undefined?{}:{packageGraphDigest:sha(v.packageGraphDigest)??fail()})};
}
export function parseCodingRepairPatch(value:unknown):CodingRepairPatch {
  const v=record(value);keys(v,['path','expectedSha256','edits'],['createText']);
  const edits=array(v.edits,value=>{const e=record(value);keys(e,['oldText','newText']);if(typeof e.oldText!=='string'||!e.oldText.length||typeof e.newText!=='string')fail();return {oldText:e.oldText as string,newText:e.newText as string};});
  const expectedSha256=sha(v.expectedSha256);
  if(expectedSha256===null?(typeof v.createText!=='string'||edits.length!==0):(v.createText!==undefined||edits.length===0))fail();
  return {path:path(v.path),expectedSha256,edits,...(v.createText===undefined?{}:{createText:v.createText as string})};
}
export function parseCodingRepairInput(value:unknown):CodingRepairInput {
  const v=record(value);keys(v,['version','session','initialSnapshot','recipes']);if(v.version!==1)fail();
  const session=parseCodingRepairSession(v.session),initialSnapshot=parseCodingRepairSnapshot(v.initialSnapshot),recipes=array(v.recipes,parseCodingRepairRecipe);
  if(session.baselineSnapshotId!==initialSnapshot.snapshotId||new Set(recipes.map(r=>r.recipeId)).size!==recipes.length
    ||!recipes.some(r=>r.required)||recipes.some(r=>r.packageIds.some(p=>!initialSnapshot.packages.some(item=>item.id===p))))fail();
  return {version:1,session,initialSnapshot,recipes};
}
export function parseCodingRepairCheckReadback(value:unknown):CodingRepairCheckReadback {
  const v=record(value);keys(v,['version','sessionId','snapshot','verification']);if(v.version!==1)fail();
  const sessionId=id(v.sessionId),snapshot=parseCodingRepairSnapshot(v.snapshot),verification=array(v.verification,parseCodingRepairVerificationReceipt);
  if(verification.some(r=>r.sessionId!==sessionId))fail();return {version:1,sessionId,snapshot,verification};
}
export function parseCodingRepairPublishRequest(value:unknown):CodingRepairPublishRequest {
  const v=record(value);keys(v,['version','sessionId','baselineSnapshotId','snapshotId','paths','verificationRunIds']);if(v.version!==1)fail();
  return {version:1,sessionId:id(v.sessionId),baselineSnapshotId:id(v.baselineSnapshotId),snapshotId:id(v.snapshotId),paths:unique(v.paths,path),verificationRunIds:unique(v.verificationRunIds,id)};
}
export function parseCodingRepairPublishReadback(value:unknown):CodingRepairPublishReadback {
  const v=record(value);keys(v,['version','sessionId','state','files','evidenceRefs']);if(v.version!==1||!['published','conflict','unknown','not_started'].includes(String(v.state)))fail();
  const files=array(v.files,value=>{
    const f=record(value);keys(f,['path','beforeSha256','afterSha256']);return {path:path(f.path),beforeSha256:sha(f.beforeSha256),afterSha256:sha(f.afterSha256)};
  });if(new Set(files.map(f=>f.path)).size!==files.length)fail();
  return {version:1,sessionId:id(v.sessionId),state:v.state as CodingRepairPublishReadback['state'],files,evidenceRefs:unique(v.evidenceRefs,text)};
}

import {createHash} from 'node:crypto';
import {lstat,opendir,readFile,realpath} from 'node:fs/promises';
import {basename,isAbsolute,join,relative,resolve,sep,win32} from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';
import type {CodingRepairFile,CodingRepairPackage,CodingRepairSnapshot,CodingRepairVerificationReceipt} from '@personal-agent/contracts/coding-repair';

const ignored=new Set(['.git','node_modules','dist','build','coverage','.cache','.next','.turbo','.pa-repair',
  '.aws','.azure','.ssh','.codex','.kube','.gnupg','.docker','.direnv']);
const secret=/^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.pypirc|\.git-credentials|credentials(?:\..*)?|secrets?(?:\..*)?|service-account(?:\..*)?|application-default-credentials\.json|id_(?:rsa|dsa|ecdsa|ed25519))$|\.(?:jks|key|keystore|p12|pem|pfx|ppk)$/i;
export const repairSha256=(value:string|Uint8Array):string=>createHash('sha256').update(value).digest('hex');
export function codingRepairRelativePath(value:string):string {
  if(typeof value!=='string'||!value||isAbsolute(value)||win32.isAbsolute(value)||/[\\:\0]/.test(value)
    ||value.split('/').some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part)
      ||/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)||ignored.has(part.toLowerCase())||secret.test(part))) {
    throw new ProtocolError('SCOPE_DENIED','Coding repair path is outside the supported source scope');
  }
  return value;
}
export async function codingRepairFilePath(root:string,path:string,allowMissing=false):Promise<string> {
  codingRepairRelativePath(path);const destination=resolve(root,...path.split('/'));
  const part=relative(root,destination);
  if(!part||part==='..'||part.startsWith('..'+sep)||isAbsolute(part))throw new ProtocolError('SCOPE_DENIED','Coding repair path escaped its root');
  let current=root;
  for(const [index,segment] of path.split('/').entries()) {
    current=join(current,segment);
    try {
      const info=await lstat(current);
      if(info.isSymbolicLink()||(index===path.split('/').length-1?!info.isFile()||info.nlink!==1:!info.isDirectory())) {
        throw new ProtocolError('SCOPE_DENIED','Coding repair refuses links and non-regular source paths');
      }
    }catch(error){if(allowMissing&&(error as {code?:string}).code==='ENOENT')return destination;throw error;}
  }
  if(await realpath(destination)!==destination)throw new ProtocolError('SCOPE_DENIED','Coding repair canonical file changed');
  return destination;
}
function kind(path:string):CodingRepairFile['kind'] {
  const name=basename(path);
  if(/^(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/.test(name))return 'lock';
  if(name==='package.json'||/^tsconfig.*\.json$/.test(name)||/config\.[cm]?[jt]s$/.test(name))return 'config';
  if(/(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path))return 'test';
  return /\.[cm]?[jt]sx?$|\.(?:py|rs|go|java|css|html|svg)$/.test(path)?'source':'other';
}
export interface CapturedCodingRepairSnapshot {snapshot:CodingRepairSnapshot;graphKnown:boolean;}
export const codingRepairPackageGraphDigest=(snapshot:CodingRepairSnapshot):string=>repairSha256(JSON.stringify(snapshot.packages
  .map(pkg=>({...pkg,dependencies:[...pkg.dependencies].sort()})).sort((a,b)=>a.id.localeCompare(b.id))));
/** Real source/config hashes. Generated outputs and dependencies live independently in each session. */
export async function captureCodingRepairSnapshot(root:string):Promise<CapturedCodingRepairSnapshot> {
  if(await realpath(root)!==root||(await lstat(root)).isSymbolicLink())throw new ProtocolError('SCOPE_DENIED','Coding repair root changed');
  const paths:string[]=[];
  async function walk(directory:string,prefix=''):Promise<void> {
    const entries=await opendir(directory);
    for await(const entry of entries) {
      if(ignored.has(entry.name.toLowerCase())||secret.test(entry.name))continue;
      const path=prefix?prefix+'/'+entry.name:entry.name;codingRepairRelativePath(path);
      const absolute=join(directory,entry.name),info=await lstat(absolute);
      if(info.isSymbolicLink())throw new ProtocolError('SCOPE_DENIED','Coding repair refuses linked source paths');
      if(info.isDirectory())await walk(absolute,path);
      else if(info.isFile()&&info.nlink===1)paths.push(path);
      else throw new ProtocolError('SCOPE_DENIED','Coding repair source must contain regular single-link files');
    }
  }
  await walk(root);paths.sort();
  const bytes=new Map<string,Buffer>(),files:CodingRepairFile[]=[];
  for(const path of paths) {
    const absolute=await codingRepairFilePath(root,path),before=await lstat(absolute),value=await readFile(absolute),after=await lstat(absolute);
    if(before.ino!==after.ino||before.dev!==after.dev||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs) {
      throw new ProtocolError('REVISION_CONFLICT','Coding repair source changed during snapshot');
    }
    if(basename(path)==='package.json')bytes.set(path,value);
    files.push({path,sha256:repairSha256(value),packageId:'root',kind:kind(path)});
  }
  let graphKnown=true;
  const packages:CodingRepairPackage[]=[{id:'root',path:'',dependencies:[]}];
  const manifests=new Map<string,Record<string,unknown>>(),names=new Map<string,string>();
  for(const path of paths.filter(path=>basename(path)==='package.json')) {
    const directory=path==='package.json'?'':path.slice(0,-'/package.json'.length),id=directory?'pkg:'+directory:'root';
    if(directory)packages.push({id,path:directory,dependencies:[]});
    try {
      const manifest=JSON.parse(bytes.get(path)!.toString('utf8')) as Record<string,unknown>;
      if(!manifest||Array.isArray(manifest)||typeof manifest!=='object')throw new Error();
      manifests.set(id,manifest);
      if(typeof manifest.name==='string') {
        if(names.has(manifest.name))graphKnown=false;
        names.set(manifest.name,id);
      }
    }catch{graphKnown=false;}
  }
  for(const pkg of packages) {
    const dependencies=manifests.get(pkg.id)?.dependencies;
    if(dependencies!==undefined&&(!dependencies||Array.isArray(dependencies)||typeof dependencies!=='object'))graphKnown=false;
    for(const [name,version] of Object.entries(dependencies&&typeof dependencies==='object'?dependencies:{})) {
      const target=names.get(name);
      if(target&&target!==pkg.id)pkg.dependencies.push(target);
      else if(typeof version==='string'&&version.startsWith('workspace:'))graphKnown=false;
    }
    pkg.dependencies.sort();
  }
  const visited=new Set<string>(),visiting=new Set<string>();
  function visit(id:string):void {if(visiting.has(id)){graphKnown=false;return;}if(visited.has(id))return;
    visiting.add(id);for(const dependency of packages.find(pkg=>pkg.id===id)!.dependencies)visit(dependency);visiting.delete(id);visited.add(id);}
  for(const pkg of packages)visit(pkg.id);
  if(!graphKnown)for(const pkg of packages)pkg.dependencies=[];
  packages.sort((a,b)=>a.id.localeCompare(b.id));
  for(const file of files)file.packageId=[...packages].sort((a,b)=>b.path.length-a.path.length)
    .find(pkg=>!pkg.path||file.path.startsWith(pkg.path+'/'))!.id;
  return {snapshot:{snapshotId:repairSha256(JSON.stringify({files,packages})),files,packages},graphKnown};
}
/** Conservative package + reverse-production-dependency closure; unknown graphs invalidate everything. */
export function affectedCodingRepairPackages(before:CodingRepairSnapshot,after:CodingRepairSnapshot,graphKnown=true):Set<string> {
  if(before.snapshotId===after.snapshotId&&JSON.stringify(before.files)===JSON.stringify(after.files)&&JSON.stringify(before.packages)===JSON.stringify(after.packages))return new Set();
  const all=new Set([...before.packages,...after.packages].map(pkg=>pkg.id));
  if(!graphKnown||JSON.stringify(before.packages)!==JSON.stringify(after.packages))return all;
  const changed=new Set<string>(),old=new Map(before.files.map(file=>[file.path,file]));
  const next=new Map(after.files.map(file=>[file.path,file]));
  for(const path of new Set([...old.keys(),...next.keys()])) {
    const a=old.get(path),b=next.get(path);if(a?.sha256===b?.sha256)continue;
    if((a?.packageId??b?.packageId)==='root'&&(['config','lock'].includes(a?.kind??b!.kind)))return all;
    if(a)changed.add(a.packageId);if(b)changed.add(b.packageId);
  }
  let added=true;while(added){added=false;for(const pkg of after.packages)if(!changed.has(pkg.id)&&pkg.dependencies.some(id=>changed.has(id))){changed.add(pkg.id);added=true;}}
  return changed;
}
export function codingRepairVerificationState(receipt:CodingRepairVerificationReceipt,current:CapturedCodingRepairSnapshot,originalSnapshot?:CodingRepairSnapshot):CodingRepairVerificationReceipt['status'] {
  if(receipt.status==='FAILED'||receipt.status==='UNKNOWN')return receipt.status;
  if(!originalSnapshot&&receipt.inputSnapshotId!==current.snapshot.snapshotId)return 'STALE';
  const original=originalSnapshot??current.snapshot;
  const changed=affectedCodingRepairPackages(original,current.snapshot,current.graphKnown);
  return receipt.packageIds.some(id=>changed.has(id))?'STALE':receipt.status;
}

import {constants,lstatSync,readdirSync,readFileSync,realpathSync} from 'node:fs';
import {copyFile,mkdir,symlink,chmod} from 'node:fs/promises';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';
import {codingRepairRelativePath,repairSha256} from './repair-verification.js';

interface DependencyEntry {path:string;kind:'file'|'directory'|'link';sha256?:string;target?:string;linkType?:'file'|'directory';source:string;mode:number}
interface DependencySeed {fingerprint?:string;entries:DependencyEntry[];roots:string[]}
export interface IsolatedDependencyPreparation {
  sourceRoot:string;isolatedRoot:string;deadline:string;signal:AbortSignal;expectedFingerprint?:string|null;now?:()=>number;
  assertCurrent?:()=>void;
}
const inside=(root:string,target:string)=>{const p=relative(root,target);return p===''||p!=='..'&&!p.startsWith('..'+sep)&&!isAbsolute(p);};
const fail=(message:string):never=>{throw new ProtocolError('UNSUPPORTED_CAPABILITY',message);};
const posix=(path:string)=>path.split(sep).join('/');
function safePath(path:string):string {
  if(typeof path!=='string'||!path||/[\\:\0]/.test(path)||path.startsWith('/')||path.split('/').some(p=>!p||p==='.'||p==='..'))
    return fail('Dependency lock contains an unsupported path');
  return path;
}
function plainFile(root:string,path:string):string {
  const target=join(root,...safePath(path).split('/'));let current=root;
  for(const [index,part] of path.split('/').entries()) {
    current=join(current,part);const info=lstatSync(current);
    if(info.isSymbolicLink()||(index===path.split('/').length-1?!info.isFile():!info.isDirectory()))fail('Dependency metadata must use ordinary files');
  }
  if(realpathSync(target)!==target)fail('Dependency metadata root changed');return target;
}
const json=(root:string,path:string):any=>{try{return JSON.parse(readFileSync(plainFile(root,path),'utf8'));}catch(error){if(error instanceof ProtocolError)throw error;return fail('Prepared npm lock or package metadata is missing or invalid');}};
const canonical=(value:any):string=>JSON.stringify(value&&typeof value==='object'&&!Array.isArray(value)
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value??{});
const dependencyKeys=['dependencies','devDependencies','optionalDependencies','peerDependencies'];
function manifestDependencies(value:any):void {
  for(const key of dependencyKeys)if(value[key]!==undefined&&(!value[key]||typeof value[key]!=='object'||Array.isArray(value[key])
    ||Object.values(value[key]).some(item=>typeof item!=='string')))fail('Dependency declarations must match a valid prepared npm manifest');
}
const cacheNames=new Set(['.cache','.vite']);
const sensitive=/^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.yarnrc(?:\..*)?|\.pypirc|credentials(?:\..*)?|id_(?:rsa|ed25519))$|\.(?:pem|key|pfx|p12|keystore)$/i;
const packageLocation=(path:string)=>{const parts=path.split('/'),tail=parts.slice(parts.lastIndexOf('node_modules')+1);
  return tail.length===1&&!tail[0]!.startsWith('@')&&!tail[0]!.startsWith('.')||tail.length===2&&tail[0]!.startsWith('@');};

/** Small manifest check only. This never traverses node_modules. */
export function hasPreparedCodingDependenciesSync(root:string):boolean {
  try{lstatSync(join(root,'package.json'));}catch(error){if((error as {code?:string}).code==='ENOENT')return false;throw error;}
  const manifest=json(root,'package.json');manifestDependencies(manifest);
  return dependencyKeys.some(key=>Object.keys(manifest[key]??{}).length>0)||Boolean(manifest.workspaces?.length||manifest.workspaces?.packages?.length);
}

/** Main-only current prepared bytes, not registry provenance. No command, network or account configuration is read. */
function captureSeed(root:string,check:()=>void):DependencySeed {
  check();if(realpathSync(root)!==root||lstatSync(root).isSymbolicLink())fail('Prepared dependency root changed');
  try{lstatSync(join(root,'package.json'));}catch(error){if((error as {code?:string}).code==='ENOENT')return {entries:[],roots:[]};throw error;}
  const manifest=json(root,'package.json');
  manifestDependencies(manifest);
  if(!dependencyKeys.some(key=>Object.keys(manifest[key]??{}).length)&&!(manifest.workspaces?.length||manifest.workspaces?.packages?.length))return {entries:[],roots:[]};
  const lock=json(root,'package-lock.json'),installed=json(root,'node_modules/.package-lock.json');
  if(![2,3].includes(lock.lockfileVersion)||![2,3].includes(installed.lockfileVersion)||!lock.packages||!installed.packages)
    fail('Only a prepared npm package-lock v2/v3 layout is supported');
  for(const [path,pinned] of Object.entries(lock.packages) as Array<[string,any]>) {
    if(path.split('/').includes('node_modules'))continue;
    check();const file=path?codingRepairRelativePath(safePath(path)+'/package.json'):'package.json',actual=json(root,file);
    manifestDependencies(actual);
    if(dependencyKeys.some(key=>canonical(actual[key])!==canonical(pinned[key]))
      ||canonical(actual.workspaces)!==canonical(pinned.workspaces)
      ||pinned.version!==undefined&&actual.version!==pinned.version)fail('Package declarations changed after the prepared npm lock');
  }
  const roots=new Set<string>();
  for(const [path,pinned] of Object.entries(lock.packages) as Array<[string,any]>) {
    check();if(!path.split('/').includes('node_modules'))continue;safePath(path);
    const at=path.split('/').indexOf('node_modules'),parts=path.split('/');roots.add(parts.slice(0,at+1).join('/'));
    const actual=installed.packages[path];
    if(!actual){if(pinned.optional===true) {
      try{lstatSync(join(root,...path.split('/')));}catch(error){if((error as {code?:string}).code==='ENOENT')continue;throw error;}
      fail('An installed optional dependency is missing its prepared metadata');
    }fail('A required locked dependency is not prepared');}
    for(const key of ['version','integrity','resolved','link'])if((actual[key]??null)!==(pinned[key]??null))fail('Installed dependency metadata differs from the source lock');
    const target=join(root,...path.split('/'));
    if(pinned.link===true) {
      const expected=join(root,...safePath(pinned.resolved).split('/'));
      if(!lstatSync(target).isSymbolicLink()||realpathSync(target)!==realpathSync(expected)||!inside(root,realpathSync(target)))
        fail('Workspace dependency link does not match the original locked workspace');
    } else {
      const pkg=json(root,path+'/package.json');
      if(pkg.version!==pinned.version||pinned.name!==undefined&&pkg.name!==pinned.name)fail('Installed dependency version differs from the source lock');
    }
  }
  for(const path of Object.keys(installed.packages))if(path.split('/').includes('node_modules')&&!lock.packages[path])fail('Installed dependency is absent from the source lock');
  const entries:DependencyEntry[]=[];
  function walk(path:string):void {
    check();const full=join(root,...safePath(path).split('/')),info=lstatSync(full);
    const name=path.split('/').at(-1)!;
    if(cacheNames.has(name)&&path.split('/').at(-2)==='node_modules')return;
    if(path.split('/').at(-2)==='node_modules'&&name.startsWith('.')&&!['.bin','.package-lock.json'].includes(name))fail('Only the prepared npm dependency layout is supported');
    if(sensitive.test(name))fail('Prepared dependency tree contains credential-sensitive configuration');
    // Bundled dependencies and fixtures inside a locked package are covered by
    // its installed bytes, even when npm does not list each payload in the lock.
    if(packageLocation(path)&&!lock.packages[path]&&!Object.keys(lock.packages).some(parent=>parent.split('/').includes('node_modules')&&path.startsWith(parent+'/')))
      fail('Prepared dependency tree contains an unlocked package directory');
    if(info.isSymbolicLink()) {
      const target=realpathSync(full);if(!inside(root,target))fail('Dependency links outside the authorized workspace are unsupported');
      const actual=lstatSync(target);
      if(actual.isDirectory()||actual.isFile())entries.push({path,kind:'link',target:posix(relative(root,target)),
        linkType:actual.isDirectory()?'directory':'file',source:full,mode:actual.mode});
      else fail('Dependency link target is unsupported');
    }else if(realpathSync(full)!==full)fail('Prepared dependency path changed outside its original tree');
    else if(info.isDirectory()) {
      entries.push({path,kind:'directory',source:full,mode:info.mode});
      for(const entry of readdirSync(full).sort())walk(path+'/'+entry);
    }else if(info.isFile()) {
      const value=readFileSync(full),after=lstatSync(full);check();
      if(realpathSync(full)!==full||info.dev!==after.dev||info.ino!==after.ino||info.size!==after.size||info.mtimeMs!==after.mtimeMs||info.ctimeMs!==after.ctimeMs)
        fail('Prepared dependency bytes changed while reading');
      if(path.includes('/.bin/')&&value.includes(Buffer.from(root)))fail('Dependency command shim refers to the source workspace');
      entries.push({path,kind:'file',source:full,sha256:repairSha256(value),mode:info.mode});
    }else fail('Prepared dependencies contain a special filesystem entry');
  }
  const orderedRoots=[...roots].sort().filter(path=>![...roots].some(other=>other!==path&&path.startsWith(other+'/')));
  for(const path of orderedRoots){check();const full=join(root,...path.split('/'));
    try{if(lstatSync(full).isSymbolicLink())fail('Dependency root must not be a shared junction');walk(path);}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error;}}
  check();return {fingerprint:repairSha256(JSON.stringify({lock:repairSha256(readFileSync(plainFile(root,'package-lock.json'))),
    entries:entries.map(({path,kind,sha256,target,linkType})=>({path,kind,sha256,target,linkType}))})),entries,roots:orderedRoots};
}
export function capturePreparedDependencyFingerprintSync(root:string,check:()=>void=()=>{}):string|undefined {
  return captureSeed(root,check).fingerprint;
}

/** Copies already-prepared locked dependencies. Never installs, downloads, hardlinks or runs lifecycle scripts. */
export async function prepareIsolatedCodingDependencies(input:IsolatedDependencyPreparation):Promise<{ready:boolean;reason?:string}> {
  const options={...input},now=options.now??Date.now;
  const check=()=>{options.assertCurrent?.();if(options.signal.aborted)throw new ProtocolError('CANCELLED','Dependency preparation cancelled');
    if(!Number.isFinite(Date.parse(options.deadline))||now()>=Date.parse(options.deadline))throw new ProtocolError('TIMEOUT','Dependency preparation expired');};
  try {
    check();const source=realpathSync(options.sourceRoot),target=realpathSync(options.isolatedRoot);
    if(inside(source,target)||inside(target,source))fail('Dependency copies require independent workspace roots');
    const before=captureSeed(source,check);
    if(options.expectedFingerprint!==undefined&&(before.fingerprint??null)!==options.expectedFingerprint)fail('Prepared dependency configuration changed');
    if(!before.fingerprint){await mkdir(join(target,'node_modules'),{recursive:true});check();return {ready:true};}
    for(const entry of before.entries.filter(entry=>entry.kind!=='link')) {
      check();const destination=join(target,...entry.path.split('/'));
      if(entry.kind==='directory')await mkdir(destination,{recursive:true});
      else {await mkdir(resolve(destination,'..'),{recursive:true});await copyFile(entry.source,destination,constants.COPYFILE_EXCL);await chmod(destination,entry.mode&0o777);}
      check();
    }
    for(const entry of before.entries.filter(entry=>entry.kind==='link')) {
      check();const destination=join(target,...entry.path.split('/')),linked=join(target,...entry.target!.split('/'));
      if(!inside(target,realpathSync(linked)))fail('Copied workspace dependency is not inside the candidate');
      await mkdir(resolve(destination,'..'),{recursive:true});
      await symlink(process.platform==='win32'?linked:relative(resolve(destination,'..'),linked),destination,
        entry.linkType==='directory'?(process.platform==='win32'?'junction':'dir'):'file');check();
    }
    const copied=captureSeed(target,check),after=captureSeed(source,check);
    if(copied.fingerprint!==before.fingerprint||after.fingerprint!==before.fingerprint)fail('Dependency copy did not preserve the original locked bytes');
    return {ready:true};
  }catch(error){if(error instanceof ProtocolError&&['CANCELLED','TIMEOUT'].includes(error.code))throw error;
    return {ready:false,reason:error instanceof ProtocolError?error.message:'Prepared dependencies could not be copied into an independent workspace'};}
}

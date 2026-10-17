import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {closeSync,existsSync,fstatSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,realpathSync,renameSync,statSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';

const {load,JSON_SCHEMA}=createRequire(import.meta.url)('js-yaml') as {load:(text:string,options:{schema:unknown})=>unknown;JSON_SCHEMA:unknown};
const MAX_BUNDLE=1_048_576,MAX_FILES=128,MAX_INSTALLED=16;
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const fail=(message:string):never=>{throw new ProtocolError('INVALID_ARGUMENT',message);};
const namePattern=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export interface LocalSkillFile {path:string;content:string;digest:string}
export interface LocalSkillBundle {name:string;description:string;version:string;digest:string;files:LocalSkillFile[]}
export interface InstalledSkill extends LocalSkillBundle {enabled:boolean;generation:number;installationId:string}
const fields=['name','description','license','compatibility','metadata','allowed-tools'];
function metadata(text:string,directoryName:string) {
  const normalized=text.replace(/\r\n/g,'\n');
  const match=/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/.exec(normalized);
  if(!match || !match[2]?.trim() || normalized.length>16384) return fail('Skill requires bounded frontmatter and instructions');
  let value:unknown;
  try {value=load(match[1]!,{schema:JSON_SCHEMA});} catch {return fail('Skill YAML is invalid');}
  if(!value || typeof value!=='object' || Array.isArray(value)) return fail('Skill frontmatter is invalid');
  const data=value as Record<string,unknown>;
  if(Object.keys(data).some(key=>!fields.includes(key)) || typeof data.name!=='string'
    || data.name.length>64 || !namePattern.test(data.name) || data.name!==directoryName
    || typeof data.description!=='string' || !data.description.trim() || data.description.length>1024) return fail('Skill name or description is invalid');
  for(const key of ['license','compatibility','allowed-tools']) {
    if(data[key]!==undefined && (typeof data[key]!=='string' || !(data[key] as string).trim()
      || (data[key] as string).length>(key==='compatibility'?500:1024))) return fail('Skill optional metadata is invalid');
  }
  let version='content';
  if(data.metadata!==undefined) {
    if(!data.metadata || typeof data.metadata!=='object' || Array.isArray(data.metadata)
      || Object.entries(data.metadata).some(([key,value])=>key.length>128 || typeof value!=='string' || value.length>1024)) return fail('Skill metadata must contain strings');
    const declared=(data.metadata as Record<string,string>).version;
    if(declared!==undefined) {
      if(!declared.trim() || declared.length>64) return fail('Skill version is invalid');
      version=declared;
    }
  }
  return {name:data.name,description:data.description,version};
}
function bundle(files:LocalSkillFile[],directoryName:string):LocalSkillBundle {
  if(!Array.isArray(files) || !files.length || files.length>MAX_FILES) return fail('Skill file count is invalid');
  let size=0;const paths=new Set<string>();
  for(const file of files) {
    if(!file || typeof file.path!=='string' || typeof file.content!=='string'
      || file.path.length>1024 || /[\\\u0000-\u001f<>:"|?*]/.test(file.path)
      || file.path.split('/').some(part=>!part || part.startsWith('.') || part.endsWith('.') || part.endsWith(' '))
      || /(?:^|\/)(?:credentials|secrets|id_rsa|id_ed25519)(?:\.|\/|$)|\.(?:pem|key|pfx|p12)$/i.test(file.path)
      || paths.has(file.path.toLowerCase())) return fail('Skill contains an unsafe resource path');
    const bytes=Buffer.from(file.content,'base64');
    if(bytes.toString('base64')!==file.content || bytes.length>262144 || hash(bytes)!==file.digest) return fail('Skill resource digest is invalid');
    paths.add(file.path.toLowerCase());size+=bytes.length;
  }
  if(size>MAX_BUNDLE) return fail('Skill bundle exceeds 1 MiB');
  const main=files.find(file=>file.path==='SKILL.md');if(!main) return fail('SKILL.md is required');
  const bytes=Buffer.from(main.content,'base64');
  let text:string;try {text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);} catch {return fail('SKILL.md must be UTF-8');}
  const info=metadata(text,directoryName);
  const ordered=files.map(file=>({path:file.path,content:file.content,digest:file.digest})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const digest=hash(JSON.stringify(ordered.map(file=>[file.path,file.digest])));
  return {...info,version:info.version==='content'?digest.slice(0,12):info.version,digest,files:ordered};
}

/** Trusted native directory only. No scripts, hooks, network, or credentials execute. */
export function readLocalSkillDirectory(selected:string):LocalSkillBundle {
  if(typeof selected!=='string' || !path.isAbsolute(selected) || selected.startsWith('\\\\')
    || lstatSync(selected).isSymbolicLink() || !statSync(selected).isDirectory()) return fail('Select a local ordinary Skill directory');
  const root=realpathSync.native(selected),identity=statSync(root,{bigint:true});
  const files:LocalSkillFile[]=[];let bytes=0,entriesVisited=0;
  const visit=(directory:string,depth:number)=>{
    if(depth>8) return fail('Skill directory is too deep');
    for(const entry of readdirSync(directory,{withFileTypes:true})) {
      if(++entriesVisited>256) return fail('Skill contains too many entries');
      const target=path.join(directory,entry.name),relative=path.relative(root,target).split(path.sep).join('/');
      const before=lstatSync(target,{bigint:true});
      if(before.isSymbolicLink() || realpathSync.native(target)!==target || entry.name.startsWith('.')
        || /[\\\u0000-\u001f<>:"|?*]/.test(entry.name) || entry.name.endsWith('.') || entry.name.endsWith(' ')
        || /^(?:credentials|secrets|id_rsa|id_ed25519)(?:\.|$)|\.(?:pem|key|pfx|p12)$/i.test(entry.name)) return fail('Skill contains a link or unsafe name');
      if(before.isDirectory()) {visit(target,depth+1);continue;}
      if(!before.isFile() || before.nlink!==1n || files.length>=MAX_FILES || before.size>262144n) return fail('Skill resource is not a bounded ordinary file');
      const fd=openSync(target,'r');
      try {
        const opened=fstatSync(fd,{bigint:true});
        if(['dev','ino','birthtimeNs','size','mtimeNs','ctimeNs'].some(key=>opened[key as keyof typeof opened]!==before[key as keyof typeof before])) return fail('Skill source changed');
        bytes+=Number(opened.size);if(bytes>MAX_BUNDLE) return fail('Skill bundle exceeds 1 MiB');
        const content=readFileSync(fd);
        const after=lstatSync(target,{bigint:true});
        if(after.isSymbolicLink() || realpathSync.native(target)!==target
          || ['dev','ino','birthtimeNs','size','mtimeNs','ctimeNs'].some(key=>after[key as keyof typeof after]!==before[key as keyof typeof before])) return fail('Skill source changed');
        files.push({path:relative,content:content.toString('base64'),digest:hash(content)});
      } finally {closeSync(fd);}
    }
  };
  visit(root,0);
  const after=statSync(root,{bigint:true});
  if(['dev','ino','birthtimeNs'].some(key=>identity[key as keyof typeof identity]!==after[key as keyof typeof after])) return fail('Skill directory changed');
  return bundle(files,path.basename(root));
}

/** Atomic bounded installation settings, never a task/authorization store. */
export function openLocalSkillStore(file:string) {
  let entries:InstalledSkill[]=[];
  if(existsSync(file)) {
    if(lstatSync(file).isSymbolicLink() || statSync(file).size>24*MAX_BUNDLE) return fail('Skill store is unsafe');
    const saved=JSON.parse(readFileSync(file,'utf8')) as {version:number;entries:InstalledSkill[]};
    if(saved.version!==1 || !Array.isArray(saved.entries) || saved.entries.length>MAX_INSTALLED) return fail('Skill store version is unsupported');
    const names=new Set<string>();
    entries=saved.entries.map(entry=>{
      const checked=bundle(entry.files,entry.name);
      if(checked.digest!==entry.digest || checked.description!==entry.description || checked.version!==entry.version
        || typeof entry.enabled!=='boolean' || !Number.isSafeInteger(entry.generation) || entry.generation<1
        || typeof entry.installationId!=='string' || !/^[0-9a-f-]{36}$/.test(entry.installationId) || names.has(entry.name)) return fail('Skill store is inconsistent');
      names.add(entry.name);return {...checked,enabled:entry.enabled,generation:entry.generation,installationId:entry.installationId};
    });
  }
  function commit(next:InstalledSkill[]) {
    mkdirSync(path.dirname(file),{recursive:true});
    if((existsSync(file) && lstatSync(file).isSymbolicLink()) || (existsSync(file+'.tmp') && lstatSync(file+'.tmp').isSymbolicLink())) return fail('Skill store is unsafe');
    writeFileSync(file+'.tmp',JSON.stringify({version:1,entries:next}),'utf8');renameSync(file+'.tmp',file);entries=next;
  }
  const find=(name:string,digest:string)=>{
    const entry=entries.find(entry=>entry.name===name && entry.digest===digest);
    if(!entry) throw new ProtocolError('NOT_FOUND','Installed Skill version is unavailable');return entry;
  };
  return {
    list:()=>entries.map(({files,...entry})=>({...entry,fileCount:files.length})),
    read(name:string,digest:string) {return structuredClone(find(name,digest));},
    install(input:LocalSkillBundle) {
      const checked=bundle(input.files,input.name);
      if(checked.digest!==input.digest) return fail('Skill install digest changed');
      const previous=entries.find(entry=>entry.name===checked.name);
      if(previous) {
        if(previous.digest!==checked.digest) throw new ProtocolError('REVISION_CONFLICT','Uninstall the existing Skill before installing another version');
        return structuredClone(previous);
      }
      if(entries.length>=MAX_INSTALLED) return fail('At most 16 Skills can be installed');
      const entry={...checked,enabled:false,generation:1,installationId:randomUUID()};commit([...entries,entry]);return this.read(entry.name,entry.digest);
    },
    setEnabled(name:string,digest:string,enabled:boolean) {
      if(typeof enabled!=='boolean') return fail('Skill enable state is invalid');
      const entry=find(name,digest);if(entry.enabled===enabled) return;
      commit(entries.map(item=>item===entry?{...entry,enabled,generation:entry.generation+1}:item));
    },
    uninstall(name:string,digest:string) {const entry=find(name,digest);commit(entries.filter(item=>item!==entry));},
  };
}

export function localSkillInstructions(skill:LocalSkillBundle):string {
  const checked=bundle(skill.files,skill.name);
  if(checked.digest!==skill.digest) return fail('Installed Skill digest changed');
  return Buffer.from(checked.files.find(file=>file.path==='SKILL.md')!.content,'base64').toString('utf8');
}

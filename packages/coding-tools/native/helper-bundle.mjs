import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,readdirSync,realpathSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';

export const jobBundleIdentity=Object.freeze({schemaVersion:1,component:'windows-job-process-host',runtimeVersion:'8.0.30'});
const manifestName='job-component-manifest.json',checksumName='job-component-manifest.sha256';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=file=>JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const fail=()=>{throw Error('invalid-native-helper-bundle');};
function directory(root){
  if(!path.isAbsolute(root)||path.resolve(root).toLowerCase()!==realpathSync.native(root).toLowerCase())fail();
  for(let item=root;;item=path.dirname(item)){
    if(lstatSync(item).isSymbolicLink())fail();if(path.dirname(item)===item)break;
  }
  if(!lstatSync(root).isDirectory())fail();return root;
}
function inventory(root,prefix=''){
  const result=[];
  for(const entry of readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
    const name=prefix+entry.name,absolute=path.join(root,entry.name);
    if(!prefix&&[manifestName,checksumName].includes(name))continue;
    if(entry.isSymbolicLink())fail();
    if(entry.isDirectory())result.push(...inventory(absolute,name+'/'));
    else if(entry.isFile()){
      const bytes=readFileSync(absolute);result.push({path:name,byteLength:bytes.length,sha256:sha(bytes)});
    }else fail();
  }
  return result;
}
function runtime(root,rid){
  if(!['win-x64','win-arm64'].includes(rid))fail();
  const options=json(path.join(root,'WindowsJobProcessHost.runtimeconfig.json')).runtimeOptions;
  if(options?.framework||options?.frameworks||options?.additionalProbingPaths
    ||!isDeepStrictEqual(options?.includedFrameworks,[{name:'Microsoft.NETCore.App',version:jobBundleIdentity.runtimeVersion}]))fail();
  if(!json(path.join(root,'WindowsJobProcessHost.deps.json')).runtimeTarget?.name?.endsWith('/'+rid))fail();
  for(const name of ['WindowsJobProcessHost.exe','WindowsJobProcessHost.dll','hostfxr.dll','hostpolicy.dll','coreclr.dll'])
    if(!lstatSync(path.join(root,name)).isFile())fail();
}

/** Shared by the trusted publisher and Runtime attestation; no grants or execution. */
export function readSelfContainedHelperBundle(helperPath){
  const root=directory(path.dirname(helperPath));
  const options=json(path.join(root,'WindowsJobProcessHost.runtimeconfig.json')).runtimeOptions;
  const bundled=existsSync(path.join(root,manifestName))||options?.includedFrameworks
    ||['hostfxr.dll','hostpolicy.dll','coreclr.dll'].some(name=>existsSync(path.join(root,name)));
  if(!bundled)return;
  for(const name of [manifestName,checksumName])if(!lstatSync(path.join(root,name)).isFile()||lstatSync(path.join(root,name)).isSymbolicLink())fail();
  const bytes=readFileSync(path.join(root,manifestName)),manifest=json(path.join(root,manifestName));
  for(const [key,value]of Object.entries(jobBundleIdentity))if(manifest[key]!==value)fail();
  if(manifest.selfContained!==true||readFileSync(path.join(root,checksumName),'utf8')!==sha(bytes)+'  '+manifestName+'\n')fail();
  runtime(root,manifest.runtimeIdentifier);
  const files=inventory(root);
  if(!isDeepStrictEqual(manifest.files,files))fail();
  const executable=files.find(item=>item.path==='WindowsJobProcessHost.exe');if(!executable)fail();
  return {helperSha256:executable.sha256,helperFilesSha256:Object.fromEntries([
    ...files.filter(item=>item.path!==executable.path).map(item=>[item.path,item.sha256]),
    [manifestName,sha(bytes)],[checksumName,sha(readFileSync(path.join(root,checksumName)))],
  ])};
}

/** Source-checkout publishing only; preserve the repository's pinned upstream license evidence. */
export function writeSelfContainedHelperBundle({targetDir,repoRoot,toolchain,sourceSha256}){
  const root=directory(targetDir),runtimeIdentifier=toolchain.runtimeIdentifier;
  runtime(root,runtimeIdentifier);
  const upstream=path.join(repoRoot,'apps/desktop/native-component/upstream'),sources=json(path.join(upstream,'sources.json'));
  if(sources.runtimeVersion!==jobBundleIdentity.runtimeVersion)fail();
  const resources=sources.resources.filter(item=>item.repository==='https://github.com/dotnet/runtime');
  if(resources.length!==2)fail();
  for(const resource of resources){
    if(path.isAbsolute(resource.path)||resource.path.split(/[\\/]/).some(item=>!item||item==='.'||item==='..'))fail();
    const bytes=readFileSync(path.join(upstream,resource.path));
    if(bytes.length!==resource.byteLength||sha(bytes)!==resource.sha256)fail();
    const target=path.join(root,'licenses',resource.path);mkdirSync(path.dirname(target),{recursive:true});
    writeFileSync(target,bytes,{flag:'wx'});
  }
  writeFileSync(path.join(root,'licenses/sources.json'),JSON.stringify({runtimeVersion:sources.runtimeVersion,resources},null,2)+'\n',{flag:'wx'});
  writeFileSync(path.join(root,'THIRD-PARTY-NOTICES.md'),'# Windows Job helper runtime attribution\n\nThis bundle includes Microsoft .NET runtime '+jobBundleIdentity.runtimeVersion+'. Original licenses, third-party notices and pinned upstream source identities are preserved under licenses/. No additional rights or PersonalAgent source license are granted by this index.\n',{flag:'wx'});
  const manifest={...jobBundleIdentity,selfContained:true,runtimeIdentifier,toolchain,sourceSha256,files:inventory(root)};
  const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  writeFileSync(path.join(root,manifestName),bytes,{flag:'wx'});
  writeFileSync(path.join(root,checksumName),sha(bytes)+'  '+manifestName+'\n',{flag:'wx'});
  return {...readSelfContainedHelperBundle(path.join(root,'WindowsJobProcessHost.exe')),manifestSha256:sha(bytes)};
}

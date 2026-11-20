import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';

export const windowsHostPublishIdentity=Object.freeze({schemaVersion:1,component:'windows-host-bridge',protocolVersion:'0.1.0',runtimeVersion:'8.0.30',runtimeIdentifier:'win-x64',selfContained:true});
const manifestName='windows-host-component-manifest.json',checksumName='windows-host-component-manifest.sha256';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=file=>JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const fail=()=>{throw Error('Windows Host component integrity is unavailable');};

export function windowsHostInventory(root,prefix='') {
  const files=[];
  for(const entry of readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
    if(!prefix&&[manifestName,checksumName].includes(entry.name))continue;
    const name=prefix+entry.name,absolute=path.join(root,entry.name);
    if(entry.isSymbolicLink())fail();
    if(entry.isDirectory())files.push(...windowsHostInventory(absolute,name+'/'));
    else if(entry.isFile()){const bytes=readFileSync(absolute);files.push({path:name,byteLength:bytes.length,sha256:sha(bytes)});}
    else fail();
  }
  return files;
}

export function validateWindowsHostRuntime(bundle) {
  for(const [directory,stem,frameworks]of [['host','WindowsHost.Host',['Microsoft.NETCore.App','Microsoft.WindowsDesktop.App']],
    ['bridge','WindowsHost.PipeBridge',['Microsoft.NETCore.App']]]){
    const root=path.join(bundle,directory),options=json(path.join(root,stem+'.runtimeconfig.json')).runtimeOptions;
    if(options?.framework||options?.frameworks||options?.additionalProbingPaths
      ||!isDeepStrictEqual(options?.includedFrameworks,frameworks.map(name=>({name,version:windowsHostPublishIdentity.runtimeVersion}))))fail();
    if(!json(path.join(root,stem+'.deps.json')).runtimeTarget?.name?.endsWith('/'+windowsHostPublishIdentity.runtimeIdentifier))fail();
    for(const name of [stem+'.exe',stem+'.dll','coreclr.dll','hostfxr.dll','hostpolicy.dll',
      ...(directory==='host'?['PresentationCore.dll','PresentationFramework.dll','WindowsBase.dll','windows-host.json']:[])])
      if(!lstatSync(path.join(root,name)).isFile())fail();
  }
}

/** Capture the complete trusted publication once; revalidate that same identity before every connection/frame. */
export function readWindowsHostComponent(resourcesPath) {
  if(typeof resourcesPath!=='string'||!path.isAbsolute(resourcesPath))fail();
  const bundle=path.join(resourcesPath,'native-tools','windows-host');
  const verify=()=>{
    if(path.resolve(bundle).toLowerCase()!==realpathSync.native(bundle).toLowerCase())fail();
    for(let p=bundle;;p=path.dirname(p)){if(lstatSync(p).isSymbolicLink())fail();if(path.dirname(p)===p)break;}
    for(const name of [manifestName,checksumName])if(lstatSync(path.join(bundle,name)).isSymbolicLink())fail();
    const bytes=readFileSync(path.join(bundle,manifestName)),manifest=JSON.parse(bytes.toString('utf8'));
    for(const [key,value]of Object.entries(windowsHostPublishIdentity))if(manifest[key]!==value)fail();
    if(readFileSync(path.join(bundle,checksumName),'utf8')!==sha(bytes)+'  '+manifestName+'\n')fail();
    validateWindowsHostRuntime(bundle);
    if(!isDeepStrictEqual(manifest.files,windowsHostInventory(bundle)))fail();
    return sha(bytes);
  };
  const manifestSha256=verify();
  const hostPath=path.join(bundle,'host','WindowsHost.Host.exe'),bridgePath=path.join(bundle,'bridge','WindowsHost.PipeBridge.exe');
  return Object.freeze({hostPath,bridgePath,manifestSha256,
    assertCurrentBundle(identity){
      if(identity?.hostPath!==hostPath||identity?.bridgePath!==bridgePath||verify()!==manifestSha256)fail();
      return true;
    }});
}

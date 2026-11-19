import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseWindowsHostFrame,validateWindowsHostHandshake} from '@personal-agent/contracts/windows-host';
import {runNativePublishProcess} from './publish-native-desktop.mjs';
import {windowsHostPublishIdentity,windowsHostInventory,validateWindowsHostRuntime,readWindowsHostComponent} from '../electron/native-windows-host-component.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function sources(root) {
  const files=[];
  async function walk(directory){for(const entry of await fs.readdir(path.join(root,directory),{withFileTypes:true})){
    if(['bin','obj','test','manual','desktop'].includes(entry.name))continue;
    const name=directory+'/'+entry.name;
    if(entry.isSymbolicLink())throw Error('Windows Host source cannot be a symbolic link');
    if(entry.isDirectory())await walk(name);
    else if(/\.(cs|csproj)$/.test(entry.name))files.push(name);
  }}
  await walk('apps/windows-host');
  files.push('packages/contracts/schema/windows-host.json','apps/desktop/scripts/publish-windows-host.mjs','apps/desktop/electron/native-windows-host-component.js');
  return Object.fromEntries(await Promise.all(files.sort().map(async name=>[name,sha(await fs.readFile(path.join(root,name)))])));
}

/** Distinct Host + PipeBridge publication; no window observation or input is performed here. */
export async function publishWindowsHost({root,outputRoot,signal=new AbortController().signal,
  deadline=new Date(Date.now()+600000).toISOString(),run=runNativePublishProcess}) {
  const cache=await fs.realpath(path.join(root,'.cache/native-desktop-publish'));
  const output=await fs.realpath(outputRoot),relative=path.relative(cache,output);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Windows Host output must belong to the Desktop publication cache');
  const resources=path.join(output,'resources'),bundle=path.join(resources,'native-tools','windows-host');
  await fs.mkdir(bundle);
  const before=await sources(root),upstream=path.join(root,'apps/desktop/native-component/upstream');
  const licenses=JSON.parse(await fs.readFile(path.join(upstream,'sources.json'),'utf8'));
  if(licenses.runtimeVersion!==windowsHostPublishIdentity.runtimeVersion)throw Error('Windows Host runtime license version mismatch');
  for(const item of licenses.resources){
    if(path.isAbsolute(item.path)||item.path.split(/[\\/]/).some(part=>!part||part==='.'||part==='..'))throw Error('Invalid license path');
    const bytes=await fs.readFile(path.join(upstream,item.path));
    if(bytes.length!==item.byteLength||sha(bytes)!==item.sha256)throw Error('Windows Host license source mismatch');
    const destination=path.join(bundle,'licenses',item.path);await fs.mkdir(path.dirname(destination),{recursive:true});
    await fs.writeFile(destination,bytes,{flag:'wx'});
  }
  await fs.copyFile(path.join(upstream,'sources.json'),path.join(bundle,'licenses/sources.json'));
  await fs.writeFile(path.join(bundle,'THIRD-PARTY-NOTICES.md'),'# Windows Host and PipeBridge runtime attribution\n\nIncludes Microsoft .NET and Windows Desktop runtime 8.0.30. Original licenses, third-party notices and pinned upstream identities are preserved under licenses/. No additional rights or PersonalAgent source license are granted by this index.\n',{flag:'wx'});
  const sdk=await run('dotnet',['--version'],{cwd:root,signal,deadline});
  if(!/^8\.0\.\d+$/m.test(sdk.output.trim()))throw Error('Windows Host publishing requires the installed .NET 8 SDK');
  for(const [directory,project]of [['host','apps/windows-host/host/WindowsHost.Host.csproj'],['bridge','apps/windows-host/host/bridge/WindowsHost.PipeBridge.csproj']])
    await run('dotnet',['publish',path.join(root,project),'--configuration','Release','--runtime','win-x64','--self-contained','true','--nologo','-m:1',
      '--disable-build-servers','-p:UseSharedCompilation=false','-nodeReuse:false','-p:RuntimeFrameworkVersion=8.0.30','-p:TargetLatestRuntimePatch=false',
      '-p:PublishSingleFile=false','-p:PublishTrimmed=false','-p:DebugType=None','-p:DebugSymbols=false','--output',path.join(bundle,directory)],{cwd:root,signal,deadline});
  validateWindowsHostRuntime(bundle);
  if(JSON.stringify(before)!==JSON.stringify(await sources(root)))throw Error('Windows Host source changed during publication');
  const manifest={...windowsHostPublishIdentity,sdkVersion:sdk.output.trim(),sourceSha256:before,files:windowsHostInventory(bundle)};
  const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n'),manifestSha256=sha(bytes);
  await fs.writeFile(path.join(bundle,'windows-host-component-manifest.json'),bytes,{flag:'wx'});
  await fs.writeFile(path.join(bundle,'windows-host-component-manifest.sha256'),manifestSha256+'  windows-host-component-manifest.json\n',{flag:'wx'});
  readWindowsHostComponent(resources);
  return {bundle,manifestSha256,files:manifest.files.length};
}

/** Only the original hello/EOF exchange; no bind, observation, target selection or input. */
export async function verifyWindowsHostIdentity(resourcesPath,{signal=new AbortController().signal,
  deadline=new Date(Date.now()+15000).toISOString(),run=runNativePublishProcess}={}) {
  const component=readWindowsHostComponent(resourcesPath),windows=process.env.SystemRoot??'C:/Windows';
  const journalDirectory=await fs.mkdtemp(path.join(tmpdir(),'pa-windows-host-identity-'));
  const hello={kind:'hello',protocolVersion:'0.1.0',requestId:randomUUID(),clientNonce:randomBytes(16).toString('hex')};
  const result=await run(component.bridgePath,['--host',component.hostPath,'--journal-directory',journalDirectory],{
    cwd:path.dirname(component.bridgePath),signal,deadline,
    env:{SystemRoot:windows,WINDIR:windows,PATH:path.join(windows,'System32'),TEMP:tmpdir(),TMP:tmpdir(),
      DOTNET_ROOT:path.join(journalDirectory,'no-external-dotnet'),DOTNET_MULTILEVEL_LOOKUP:'0',DOTNET_NOLOGO:'1',DOTNET_CLI_TELEMETRY_OPTOUT:'1'},
    stdin:JSON.stringify(hello)+'\n',closeInputAfter:line=>{try{return JSON.parse(line)?.requestId===hello.requestId;}catch{return false;}}});
  const lines=result.output.split('\n');
  if(!lines.includes('VERIFIED'))throw Error('Windows Host bridge did not verify its original OS peer');
  const raw=lines.map(line=>{try{return JSON.parse(line);}catch{return undefined;}}).find(value=>value?.requestId===hello.requestId);
  const reply=parseWindowsHostFrame(raw);
  if(reply.kind!=='hello_ack')throw Error('Windows Host hello was not acknowledged');
  validateWindowsHostHandshake(hello,reply,{kind:'bind',protocolVersion:'0.1.0',requestId:hello.requestId,sessionId:reply.sessionId,hostNonce:reply.hostNonce});
  component.assertCurrentBundle(component);
  return {component:'windows-host-bridge',manifestSha256:component.manifestSha256,protocolVersion:reply.protocolVersion,
    exitCode:result.exitCode,externalDotnetDisabled:true,actionsSent:['hello'],userInputPerformed:false};
}

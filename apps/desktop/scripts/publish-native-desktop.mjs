import {spawn,execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {StringDecoder} from 'node:string_decoder';
import {computerControlFailure} from '../electron/computer-control-errors.js';

const scriptDir=path.dirname(fileURLToPath(import.meta.url));
export const nativePublishIdentity=Object.freeze({protocol:'personal-agent-desktop/1',version:'1.0.0',runtime:'8.0.30',rid:'win-x64'});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(code,message,stage='publish')=>Object.assign(new Error(message),{code,stage});
const json=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));

/** Fixed, owned subprocess only. Cancellation waits for both its tree and stdio exit. */
export async function runNativePublishProcess(command,args,{cwd,signal,deadline,spawnProcess=spawn,env=process.env,stdin,closeInputAfter}={}){
  if(signal?.aborted)throw fail('CANCELLED','原组件发布已取消','publish.cancel');
  const remaining=Date.parse(deadline)-Date.now();
  if(!(remaining>0))throw fail('TIMEOUT','原组件发布期限已过','publish.timeout');
  let child,spawnError,closed=false,stopping,stopCode,settle;
  const lines=[];let total=0;
  const stream=()=>{const decoder=new StringDecoder('utf8');let pending='',dropped=false,privateKey=false;
    const append=text=>{for(const part of text.split(/(\n)/)){if(part==='\n'){
      if(/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(pending))privateKey=true;
      if(!dropped&&!privateKey){const safe=computerControlFailure({message:pending},'publish.build').message;
        if(pending.trim()){lines.push(safe);total+=safe.length+1;while(total>8192&&lines.length>1)total-=lines.shift().length+1;}}
      if(/-----END [A-Z ]*PRIVATE KEY-----/.test(pending))privateKey=false;
      pending='';dropped=false;
    }else if(!dropped){pending+=part;if(pending.length>4096){if(/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(pending))privateKey=true;pending='';dropped=true;}}}};
    return {write:chunk=>append(decoder.write(Buffer.from(chunk))),end(){append(decoder.end());append('\n');}};};
  const out=stream(),err=stream(),done=new Promise(resolve=>{settle=resolve;});
  try{child=spawnProcess(command,args,{cwd,env,windowsHide:true,stdio:[stdin===undefined?'ignore':'pipe','pipe','pipe']});}
  catch(error){throw fail(error.code??'EXTERNAL_FAILURE',error.code==='ENOENT'?'发布组件需要 .NET 8 SDK；未找到 dotnet':computerControlFailure(error).message,'publish.spawn');}
  child.stdout?.on('data',out.write);child.stderr?.on('data',err.write);
  if(closeInputAfter){let pending='';child.stdout?.on('data',chunk=>{pending+=chunk.toString('utf8');
    if(pending.length>16384){stop('RESULT_UNKNOWN');return;}
    for(;;){const newline=pending.indexOf('\n');if(newline<0)break;const line=pending.slice(0,newline);pending=pending.slice(newline+1);
      if(closeInputAfter(line))child.stdin.end();}
  });}
  child.once('error',error=>{spawnError=error;});
  child.once('close',code=>{closed=true;out.end();err.end();settle({code});});
  const confirmed=promise=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(fail('RESULT_UNKNOWN','自有组件进程树退出未确认','publish.stop')),5000);
    Promise.resolve(promise).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});
  const stop=code=>{if(stopping||closed)return;stopCode=code;
    stopping=(async()=>{if(!Number.isInteger(child.pid)||child.pid<=0){child.kill();await confirmed(done);return;}
      let killer;const killed=new Promise((resolve,reject)=>{try{killer=spawnProcess(path.join(process.env.SystemRoot??'C:/Windows','System32/taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}
        catch(error){reject(error);return;}killer.once('error',reject);killer.once('close',exit=>exit===0?resolve():reject(fail('RESULT_UNKNOWN',`自有组件进程树停止失败 [exit=${exit}]`,'publish.stop')));});
      try{await confirmed(Promise.all([done,killed]));}catch(error){killer?.kill();throw fail('RESULT_UNKNOWN',computerControlFailure(error,'publish.stop').message,'publish.stop');}
    })();stopping.catch(error=>settle({stopError:error}));};
  const abort=()=>stop('CANCELLED'),timer=setTimeout(()=>stop('TIMEOUT'),Math.min(remaining,2147483647));
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  if(stdin!==undefined){if(closeInputAfter)child.stdin.write(stdin);else child.stdin.end(stdin);}
  let result;try{result=await done;if(stopping)await stopping;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  if(result.stopError)throw result.stopError;
  if(stopCode)throw fail(stopCode,'自有组件进程树已确认退出',stopCode==='CANCELLED'?'publish.cancel':'publish.timeout');
  if(spawnError)throw fail(spawnError.code??'EXTERNAL_FAILURE',spawnError.code==='ENOENT'?'发布组件需要 .NET 8 SDK；未找到 dotnet':computerControlFailure(spawnError).message,'publish.spawn');
  if(result.code!==0)throw fail('EXTERNAL_FAILURE',`组件发布进程失败 [exit=${result.code}]：\n${lines.join('\n')}`,'publish.build');
  return {exitCode:result.code,output:lines.join('\n')};
}

async function inventory(directory,prefix=''){
  const files=[];for(const entry of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
    const relative=prefix+entry.name,absolute=path.join(directory,entry.name);
    if(entry.isSymbolicLink())throw fail('INVALID_ARGUMENT','组件不得包含符号链接','publish.manifest');
    if(entry.isDirectory())files.push(...await inventory(absolute,relative+'/'));
    else if(entry.isFile()){const bytes=await fs.readFile(absolute);files.push({path:relative,byteLength:bytes.length,sha256:sha(bytes)});}
    else throw fail('INVALID_ARGUMENT','组件包含不支持的文件类型','publish.manifest');
  }return files;
}
async function sourceIdentity(root){
  const native='apps/windows-host/desktop/';
  const paths=(await fs.readdir(path.join(root,native))).filter(name=>/\.(cs|csproj)$/.test(name)).map(name=>native+name);
  paths.push('apps/desktop/scripts/publish-native-desktop.mjs');
  const sourceFiles=[];for(const relative of paths.sort()){const bytes=await fs.readFile(path.join(root,relative));sourceFiles.push({path:relative,byteLength:bytes.length,sha256:sha(bytes)});}
  return {sourceFiles,sourceDigest:sha(JSON.stringify(sourceFiles))};
}

export async function validateSelfContainedDesktop(bundle){
  const configuration=await json(path.join(bundle,'WindowsHost.Desktop.runtimeconfig.json'));
  const options=configuration.runtimeOptions;
  if(options?.framework||options?.frameworks||!Array.isArray(options?.includedFrameworks))throw fail('PROTOCOL_MISMATCH','组件仍依赖外部 .NET 运行时','publish.runtime');
  for(const name of ['Microsoft.NETCore.App','Microsoft.WindowsDesktop.App'])if(!options.includedFrameworks.some(f=>f.name===name&&f.version===nativePublishIdentity.runtime))throw fail('PROTOCOL_MISMATCH','自包含运行时版本与固定许可来源不匹配','publish.runtime');
  const deps=await json(path.join(bundle,'WindowsHost.Desktop.deps.json'));
  if(!deps.runtimeTarget?.name?.endsWith('/win-x64'))throw fail('PROTOCOL_MISMATCH','组件目标不是 win-x64','publish.runtime');
  for(const name of ['WindowsHost.Desktop.exe','WindowsHost.Desktop.dll','coreclr.dll','hostfxr.dll','hostpolicy.dll','System.Private.CoreLib.dll','PresentationCore.dll','PresentationFramework.dll','WindowsBase.dll']){
    if(!(await fs.stat(path.join(bundle,name))).isFile())throw fail('ENOENT','组件缺少固定运行时文件','publish.runtime');
  }
  return {includedFrameworks:options.includedFrameworks,runtimeTarget:deps.runtimeTarget.name};
}

export async function publishNativeDesktop({root=path.resolve(scriptDir,'../../..'),outputRoot,signal=new AbortController().signal,deadline=new Date(Date.now()+600000).toISOString(),platform=process.platform,run=runNativePublishProcess,git=(args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true}).trim()}={}){
  if(platform!=='win32')throw fail('UNSUPPORTED_CAPABILITY','固定组件发布要求 Windows 与 .NET 8 SDK','publish.platform');
  const cacheRoot=path.join(root,'.cache','native-desktop-publish');
  outputRoot??=path.join(cacheRoot,randomUUID());
  const relative=path.relative(cacheRoot,path.resolve(outputRoot));
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw fail('INVALID_ARGUMENT','发布目录必须是项目专有缓存中的新目录','publish.output');
  await fs.mkdir(cacheRoot,{recursive:true});await fs.mkdir(outputRoot); // exclusive fresh root; never replace a prior bundle
  const bundle=path.join(outputRoot,'resources','native-tools','desktop');await fs.mkdir(bundle,{recursive:true});
  const before=await sourceIdentity(root),upstream=path.join(root,'apps/desktop/native-component/upstream'),sources=await json(path.join(upstream,'sources.json'));
  if(sources.runtimeVersion!==nativePublishIdentity.runtime)throw fail('PROTOCOL_MISMATCH','上游许可版本不匹配','publish.license');
  for(const resource of sources.resources){if(path.isAbsolute(resource.path)||resource.path.split(/[\\/]/).some(p=>p==='..'||!p))throw fail('INVALID_ARGUMENT','许可文件路径不合法','publish.license');
    const bytes=await fs.readFile(path.join(upstream,resource.path));if(bytes.length!==resource.byteLength||sha(bytes)!==resource.sha256)throw fail('PROTOCOL_MISMATCH','上游许可文件校验失败','publish.license');
    const target=path.join(bundle,'licenses',resource.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes,{flag:'wx'});}
  await fs.copyFile(path.join(upstream,'sources.json'),path.join(bundle,'licenses','sources.json'));
  await fs.writeFile(path.join(bundle,'THIRD-PARTY-NOTICES.md'),'# Native desktop runtime attribution\n\nThis bundle includes the Microsoft .NET and Windows Desktop runtime '+nativePublishIdentity.runtime+'. Original licenses and upstream third-party notices are preserved under licenses/. The pinned source URLs and SHA-256 values are recorded in licenses/sources.json. This index grants no additional rights and does not assign a license to PersonalAgent source.\n\n'+sources.resources.map(r=>`- [${r.path}](${r.url})`).join('\n')+'\n');
  const sdk=await run('dotnet',['--version'],{cwd:root,signal,deadline});
  if(!/^8\.0\.\d+$/m.test(sdk.output.trim()))throw fail('PROTOCOL_MISMATCH','发布需要 .NET 8 SDK','publish.sdk');
  const project=path.join(root,'apps/windows-host/desktop/WindowsHost.Desktop.csproj');
  const args=['publish',project,'--configuration','Release','--runtime','win-x64','--self-contained','true','--nologo','-m:1','--disable-build-servers','-p:UseSharedCompilation=false','-nodeReuse:false',`-p:RuntimeFrameworkVersion=${nativePublishIdentity.runtime}`,'-p:TargetLatestRuntimePatch=false','-p:PublishSingleFile=false','-p:PublishTrimmed=false','-p:DebugType=None','-p:DebugSymbols=false','-p:ContinuousIntegrationBuild=true','-p:Deterministic=true',`-p:PathMap=${root}=/_/PersonalAgent`,'--output',bundle];
  await run('dotnet',args,{cwd:root,signal,deadline});
  const runtime=await validateSelfContainedDesktop(bundle),after=await sourceIdentity(root);
  if(before.sourceDigest!==after.sourceDigest)throw fail('REVISION_CONFLICT','组件源码在发布期间变化，请重新发布','publish.source');
  const manifest={schemaVersion:1,component:'native-desktop',...nativePublishIdentity,selfContained:true,configuration:'Release',sdkVersion:sdk.output.trim(),source:{gitHead:git(['rev-parse','HEAD']),workingTreeModified:!!git(['status','--porcelain','--',...before.sourceFiles.map(f=>f.path)]),...before},runtime,licenses:sources.resources,files:await inventory(bundle),inventoryExcludes:['component-manifest.json','component-manifest.sha256']};
  const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n'),manifestSha256=sha(bytes);
  await fs.writeFile(path.join(bundle,'component-manifest.json'),bytes,{flag:'wx'});
  await fs.writeFile(path.join(bundle,'component-manifest.sha256'),`${manifestSha256}  component-manifest.json\n`,{flag:'wx'});
  return {outputRoot,bundle,manifestSha256,manifest};
}

/** Only initialize and EOF. No enumeration, observation or input requests. */
export async function verifyNativeDesktopIdentity(bundle,{signal=new AbortController().signal,deadline=new Date(Date.now()+15000).toISOString(),run=runNativePublishProcess}={}){
  const runtime=await validateSelfContainedDesktop(bundle),windows=process.env.SystemRoot??'C:/Windows';
  const env={SystemRoot:windows,WINDIR:windows,PATH:path.join(windows,'System32'),TEMP:process.env.TEMP??bundle,TMP:process.env.TMP??bundle,DOTNET_ROOT:path.join(bundle,'no-external-dotnet'),DOTNET_MULTILEVEL_LOOKUP:'0',DOTNET_NOLOGO:'1',DOTNET_CLI_TELEMETRY_OPTOUT:'1'};
  const id=randomUUID(),result=await run(path.join(bundle,'WindowsHost.Desktop.exe'),[],{cwd:bundle,signal,deadline,env,stdin:JSON.stringify({id,method:'initialize',params:{},deadline})+'\n',
    closeInputAfter:line=>{try{return JSON.parse(line)?.id===id;}catch{return false;}}});
  const response=result.output.split('\n').map(line=>{try{return JSON.parse(line);}catch{return null;}}).find(item=>item?.id===id);
  if(!response?.ok||response.result?.protocol!==nativePublishIdentity.protocol||response.result?.version!==nativePublishIdentity.version)throw fail('PROTOCOL_MISMATCH','自包含组件 initialize 身份读回失败','publish.identity');
  return {schemaVersion:1,initialize:response.result,exitCode:result.exitCode,runtime,externalDotnetDisabled:true,actionsSent:['initialize'],userInputPerformed:false};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{const result=await publishNativeDesktop({signal:controller.signal});const identity=await verifyNativeDesktopIdentity(result.bundle,{signal:controller.signal});
    await fs.writeFile(path.join(result.outputRoot,'identity-receipt.json'),JSON.stringify(identity,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({bundle:result.bundle,manifestSha256:result.manifestSha256,files:result.manifest.files.length,identity},null,2));
  }catch(error){console.error(JSON.stringify(computerControlFailure(error)));process.exitCode=1;}
  finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}

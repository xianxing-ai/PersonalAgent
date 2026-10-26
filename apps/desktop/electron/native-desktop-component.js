import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';
import {StringDecoder} from 'node:string_decoder';
import {computerControlFailure} from './computer-control-errors.js';

function failure(error,stage,extra=''){
  const detail=computerControlFailure(error,stage);
  return Object.assign(new ProtocolError(detail.code,extra+detail.message),{stage:detail.stage});
}
function outputTail(){
  const lines=[];let length=0,lastDiagnostic;
  const add=line=>{const safe=computerControlFailure({message:line},'prepare.build').message;
    if(!line.trim()||safe.length>4096)return;
    if(/\berror\s+(?:CS|MSB|NETSDK|NU)\d+\b/i.test(safe))lastDiagnostic=safe;
    lines.push(safe);length+=safe.length+1;while(length>8192&&lines.length>1)length-=lines.shift().length+1;};
  return {stream(){const decoder=new StringDecoder('utf8');let pending='',dropped=false,privateKey=false;
    const line=value=>{if(/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)){privateKey=true;add('[凭据已遮蔽]');}
      if(privateKey){if(/-----END [A-Z ]*PRIVATE KEY-----/.test(value))privateKey=false;return;}add(value);};
    const append=text=>{for(const part of text.split(/(\n)/)){if(part==='\n'){if(!dropped)line(pending.replace(/\r$/,''));pending='';dropped=false;}
      else if(!dropped){pending+=part;if(pending.length>4096){if(/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(pending))privateKey=true;pending='';dropped=true;}}}};
    return {write:chunk=>append(decoder.write(Buffer.from(chunk))),end(){append(decoder.end());if(!dropped)line(pending);pending='';}};
  },text:()=>{const result=[...lines];if(lastDiagnostic&&!result.includes(lastDiagnostic))result.unshift(lastDiagnostic);
    while(result.join('\n').length>8192&&result.length>1)result.splice(lastDiagnostic&&result[0]===lastDiagnostic?1:0,1);
    return result.join('\n');}};
}

/** Fixed application component only. Development checkout can build; packaged installs never run a compiler. */
export async function prepareNativeDesktopComponent({electronDir,packaged=false,resourcesPath,signal,deadline},
  {spawnProcess=spawn,fileExists=existsSync,platform=process.platform,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}){
  if(platform!=='win32')throw failure({code:'UNSUPPORTED_CAPABILITY',message:'电脑控制当前支持Windows'},'prepare.platform');
  const project=path.resolve(electronDir,'../../windows-host/desktop/WindowsHost.Desktop.csproj');
  const executable=nativeDesktopExecutable({electronDir,packaged,resourcesPath});
  if(signal.aborted)throw failure({code:'CANCELLED',message:'电脑组件准备已取消'},'prepare.cancel');
  const remaining=Date.parse(deadline)-now();if(!(remaining>0))throw failure({code:'TIMEOUT',message:'电脑组件准备期限已过'},'prepare.timeout');
  if(packaged){if(fileExists(executable))return executable;throw failure({code:'UNSUPPORTED_CAPABILITY',message:'安装缺少电脑组件，请更新完整应用'},'prepare.bundle');}
  if(!fileExists(project))throw failure({code:'ENOENT',message:'开发目录缺少固定电脑组件项目'},'prepare.project');
  // Always ask MSBuild for an incremental build in a checkout. Existing exe alone
  // cannot prove source freshness. Disable persistent compiler/build servers.
  const tail=outputTail(),out=tail.stream(),err=tail.stream();let child,spawnError,closed=false,stopCode,stopPromise;
  let closeResolve;const closePromise=new Promise(resolve=>{closeResolve=resolve;});
  try{child=spawnProcess('dotnet',['build',project,'--configuration','Release','--nologo','-m:1','--disable-build-servers','-p:UseSharedCompilation=false','-nodeReuse:false'],
    {cwd:path.resolve(electronDir,'../../..'),windowsHide:true,stdio:['ignore','pipe','pipe']});}
  catch(error){throw failure(error,'prepare.spawn',error?.code==='ENOENT'?'开发环境需要 .NET 8 SDK；':'');}
  child.stdout?.on('data',out.write);child.stderr?.on('data',err.write);
  child.once('error',error=>{spawnError=error;});
  child.once('close',(code,terminationSignal)=>{closed=true;out.end();err.end();closeResolve({code,terminationSignal});});
  const confirmed=promise=>new Promise((resolve,reject)=>{const timer=setTimer(()=>reject(failure({code:'RESULT_UNKNOWN',message:'编译进程树退出未确认；请先核实原准备进程'},'prepare.stop')),5000);
    Promise.resolve(promise).then(value=>{clearTimer(timer);resolve(value);},error=>{clearTimer(timer);reject(error);});});
  const stop=code=>{
    if(stopPromise||closed)return;stopCode=code;
    stopPromise=(async()=>{
      if(!Number.isInteger(child.pid)||child.pid<=0){child.kill();await confirmed(closePromise);return;}
      let killer;
      const killed=new Promise((resolve,reject)=>{
        try{killer=spawnProcess(path.join(process.env.SystemRoot??'C:/Windows','System32/taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}
        catch(error){reject(error);return;}
        killer.once('error',reject);killer.once('close',exitCode=>exitCode===0?resolve():reject(failure({code:'RESULT_UNKNOWN',message:`编译进程树停止工具失败 [exit=${exitCode}]`},'prepare.stop')));
      });
      try{await confirmed(Promise.all([closePromise,killed]));}
      catch(error){killer?.kill();const detail=computerControlFailure(error,'prepare.stop');
        throw failure({code:'RESULT_UNKNOWN',message:`编译进程树退出未确认 [cause=${detail.code}]：${detail.message}`},'prepare.stop');}
    })();
    // A stop failure must wake the caller even if a damaged process never closes.
    stopPromise.catch(error=>closeResolve({stopError:error}));
  };
  const onAbort=()=>stop('CANCELLED'),timer=setTimer(()=>stop('TIMEOUT'),Math.min(remaining,2_147_483_647));
  signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();
  let result;
  try{result=await closePromise;if(stopPromise)await stopPromise;}
  finally{clearTimer(timer);signal.removeEventListener('abort',onAbort);}
  if(result.stopError)throw result.stopError;
  if(stopCode)throw failure({code:stopCode,message:stopCode==='CANCELLED'?'电脑组件准备已取消，编译进程树已退出':'电脑组件准备超时，编译进程树已退出'},stopCode==='CANCELLED'?'prepare.cancel':'prepare.timeout');
  if(spawnError)throw failure(spawnError,'prepare.spawn',spawnError?.code==='ENOENT'?'开发环境需要 .NET 8 SDK；':'');
  if(result.code!==0)throw Object.assign(failure({code:'EXTERNAL_FAILURE',message:`电脑组件编译失败 [exit=${Number.isInteger(result.code)?result.code:'signal'}]${tail.text()?'：\n'+tail.text():''}`},'prepare.build'),{exitCode:result.code});
  if(!fileExists(executable))throw failure({code:'ENOENT',message:'编译返回成功，但未找到电脑组件输出'},'prepare.readback');
  return executable;
}

export function nativeDesktopExecutable({electronDir,packaged=false,resourcesPath}){
  return packaged?path.join(resourcesPath,'native-tools','desktop','WindowsHost.Desktop.exe')
    :path.resolve(electronDir,'../../windows-host/desktop/bin/Release/net8.0-windows/WindowsHost.Desktop.exe');
}

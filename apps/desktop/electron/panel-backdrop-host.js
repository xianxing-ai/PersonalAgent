import {spawn,execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {access,mkdir,readFile,readdir,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let build;
async function buildBackdrop() {
  const framework=path.join(process.env.WINDIR??'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319');
  const kits=path.join(process.env['ProgramFiles(x86)']??'C:\\Program Files (x86)','Windows Kits','10','UnionMetadata');
  const versions=(await readdir(kits)).filter(name=>/^10\.0\.\d+\.0$/.test(name)).sort((a,b)=>Number(b.split('.')[2])-Number(a.split('.')[2]));
  const metadata=path.join(kits,versions[0]??'','Windows.winmd');
  const runtime=path.join(process.env['ProgramFiles(x86)']??'C:\\Program Files (x86)','Reference Assemblies','Microsoft','Framework','.NETFramework','v4.8','Facades','System.Runtime.dll');
  const vectorsRoot=path.join(process.env.WINDIR??'C:\\Windows','Microsoft.NET','assembly','GAC_MSIL','System.Numerics.Vectors');
  const vectors=path.join(vectorsRoot,(await readdir(vectorsRoot)).find(name=>name.startsWith('v4.0_4.0.0.0_'))??'','System.Numerics.Vectors.dll');
  const source=path.join(desktop,'native','panel-backdrop.cs');
  const digest=createHash('sha256').update(await readFile(source)).update(metadata).digest('hex').slice(0,16);
  const output=path.join(desktop,'.cache','panel-backdrop',`panel-backdrop-${digest}.exe`);
  try{await access(output);return output;}catch{}
  await mkdir(path.dirname(output),{recursive:true});
  const temporary=output+`.${process.pid}.tmp.exe`;
  try{
    await promisify(execFile)(path.join(framework,'csc.exe'),['/nologo','/nowarn:1701,420',`/out:${temporary}`,`/r:${metadata}`,`/r:${path.join(framework,'System.Runtime.WindowsRuntime.dll')}`,`/r:${runtime}`,`/r:${vectors}`,'/r:System.Numerics.dll','/r:System.Windows.Forms.dll',source],{windowsHide:true,timeout:30_000});
    try{await rename(temporary,output);}catch(error){await access(output);}
  }finally{await unlink(temporary).catch(()=>{});}
  return output;
}

export function startPanelBackdrop(win,{onReady,onFailure}) {
  let child,closed=false,ready=false,latest='1|0|dark|40',revision=0,timer,stopping;
  const stop=()=>{
    clearTimeout(timer);
    if(stopping)return stopping;
    if(!child||child.exitCode!==null||child.signalCode!==null)return Promise.resolve();
    const owned=child;
    stopping=new Promise(resolve=>{
      const end=setTimeout(()=>{if(owned.exitCode===null&&owned.signalCode===null)owned.kill();},1200);
      end.unref();owned.once('close',()=>{clearTimeout(end);resolve();});owned.stdin.end();
    });
    return stopping;
  };
  const fail=()=>{if(closed)return;closed=true;stop();onFailure();};
  if(!build)build=buildBackdrop().catch(error=>{build=undefined;throw error;});
  build.then(executable=>{
    if(closed||win.isDestroyed())return;
    child=spawn(executable,[win.getNativeWindowHandle().readBigUInt64LE().toString(),String(process.pid)],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    timer=setTimeout(fail,5000);let output='';
    child.stdout.on('data',chunk=>{if(closed)return;output=(output+chunk).slice(-128);if(!ready&&output.includes('READY|1')){ready=true;clearTimeout(timer);child.stdin.write(latest+'\n');onReady();}});
    child.stderr.resume();child.once('error',fail);child.once('exit',fail);child.stdin.on('error',fail);
  }).catch(fail);
  return {
    update(theme,radius){latest=`1|${++revision}|${theme.shouldUseDarkColors?'dark':'light'}|${Math.max(1,Math.min(200,radius))}`;if(ready&&!closed&&child?.stdin.writable)child.stdin.write(latest+'\n');},
    dispose(){closed=true;return stop();},
  };
}

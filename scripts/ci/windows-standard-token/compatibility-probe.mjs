import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync,realpathSync} from 'node:fs';
import path from 'node:path';

// Fixed read-only startup probes. Never compile a voice artifact or print child output/env.
if(process.platform!=='win32')throw Error('Windows required');
if(process.argv.length>3||(process.argv[2]!==undefined&&process.argv[2]!=='--require-success'))throw Error('Invalid fixed probe mode');
let successful=true;
const run=promisify(execFile),root=realpathSync.native(process.env.SystemRoot);
const cmd=path.join(root,'System32','cmd.exe');
const npm=path.join(path.dirname(realpathSync.native(process.execPath)),'npm.cmd');
const csc=path.join(root,'Microsoft.NET','Framework64','v4.0.30319','csc.exe');
const minimal={SystemRoot:root,WINDIR:root};
for(const key of ['TEMP','TMP'])if(process.env[key])minimal[key]=process.env[key];
async function probe(stage,file,args,options={}){
  try{
    const {stdout,stderr}=await run(file,args,{shell:false,windowsHide:true,timeout:15000,maxBuffer:65536,...options});
    successful&&=stdout.length>0&&stderr.length===0&&(stage!=='cmd-npm-prefix'||stdout.trim().toLowerCase()===process.cwd().toLowerCase());
    console.log(JSON.stringify({stage,exitCode:0,stdoutPresent:stdout.length>0,stderrPresent:stderr.length>0,
      expectedPrefix:stage==='cmd-npm-prefix'?stdout.trim().toLowerCase()===process.cwd().toLowerCase():undefined}));
  }catch(error){
    successful=false;
    console.log(JSON.stringify({stage,exitCode:typeof error.code==='number'?error.code>>>0:null,
      timedOut:error.killed===true,stdoutPresent:Boolean(error.stdout?.length),stderrPresent:Boolean(error.stderr?.length)}));
  }
}
console.log(JSON.stringify({stage:'fixed-probe-inputs',cmdExists:existsSync(cmd),npmExists:existsSync(npm),cscExists:existsSync(csc)}));
await probe('cmd-npm-prefix',cmd,['/d','/s','/c','""'+npm+'" prefix"'],{windowsVerbatimArguments:true});
await probe('framework-csc-help-full-env',csc,['/help']);
// Exact voice startup environment/flags, with /help instead of output/source compilation.
await probe('framework-csc-help-voice-env',csc,['/help'],{env:minimal});
if(process.argv[2]==='--require-success'&&!successful)process.exitCode=1;

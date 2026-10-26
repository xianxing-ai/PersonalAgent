import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createHash} from 'node:crypto';
import {publishNativeDesktop,validateSelfContainedDesktop,verifyNativeDesktopIdentity,runNativePublishProcess} from '../scripts/publish-native-desktop.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const future=()=>new Date(Date.now()+30000).toISOString();
const realUpstream=new URL('../native-component/upstream/',import.meta.url);
async function runtimeFiles(directory){
  await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(path.join(directory,'WindowsHost.Desktop.runtimeconfig.json'),JSON.stringify({runtimeOptions:{includedFrameworks:[{name:'Microsoft.NETCore.App',version:'8.0.30'},{name:'Microsoft.WindowsDesktop.App',version:'8.0.30'}]}}));
  await fs.writeFile(path.join(directory,'WindowsHost.Desktop.deps.json'),JSON.stringify({runtimeTarget:{name:'.NETCoreApp,Version=v8.0/win-x64'}}));
  for(const file of ['WindowsHost.Desktop.exe','WindowsHost.Desktop.dll','coreclr.dll','hostfxr.dll','hostpolicy.dll','System.Private.CoreLib.dll','PresentationCore.dll','PresentationFramework.dll','WindowsBase.dll'])await fs.writeFile(path.join(directory,file),'synthetic '+file);
}
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-publish-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'apps/windows-host/desktop'),{recursive:true});await fs.writeFile(path.join(root,'apps/windows-host/desktop/Program.cs'),'fixture source');
  await fs.writeFile(path.join(root,'apps/windows-host/desktop/WindowsHost.Desktop.csproj'),'fixture project');
  await fs.mkdir(path.join(root,'apps/desktop/scripts'),{recursive:true});await fs.writeFile(path.join(root,'apps/desktop/scripts/publish-native-desktop.mjs'),'fixture publisher');
  await fs.cp(realUpstream,path.join(root,'apps/desktop/native-component/upstream'),{recursive:true});
  const calls=[],run=async(command,args,options)=>{calls.push({command,args,options});if(args[0]==='--version')return {output:'8.0.424',exitCode:0};await runtimeFiles(args.at(-1));return {output:'published',exitCode:0};};
  return {root,calls,args:{root,platform:'win32',run,git:argv=>argv[0]==='rev-parse'?'a'.repeat(40):'?? fixture'}};
}

test('fixed self-contained publish preserves notices, source identity and complete file hashes',async t=>{
  const f=await fixture(t),result=await publishNativeDesktop(f.args),call=f.calls[1];
  assert.equal(call.command,'dotnet');assert.equal(call.args[0],'publish');assert.ok(call.args.includes('--self-contained'));assert.equal(call.args[call.args.indexOf('--self-contained')+1],'true');
  assert.equal(call.args[call.args.indexOf('--runtime')+1],'win-x64');assert.ok(call.args.includes('-p:RuntimeFrameworkVersion=8.0.30'));
  assert.ok(call.args.includes('--disable-build-servers'));assert.ok(call.args.includes('-p:UseSharedCompilation=false'));assert.ok(call.args.includes('-nodeReuse:false'));
  assert.ok(result.bundle.endsWith(path.join('resources','native-tools','desktop')));assert.equal(result.manifest.source.workingTreeModified,true);
  assert.equal(result.manifest.selfContained,true);assert.equal(result.manifest.source.sourceFiles.length,3);
  for(const file of result.manifest.files){const bytes=await fs.readFile(path.join(result.bundle,file.path));assert.equal(file.sha256,hash(bytes));assert.equal(file.byteLength,bytes.length);}
  assert.equal(result.manifestSha256,hash(await fs.readFile(path.join(result.bundle,'component-manifest.json'))));
  assert.match(await fs.readFile(path.join(result.bundle,'licenses/dotnet-runtime/THIRD-PARTY-NOTICES.TXT'),'utf8'),/third.party/i);
  await assert.rejects(publishNativeDesktop({...f.args,outputRoot:result.outputRoot}),{code:'EEXIST'});
});

test('source mutation during publish refuses a final manifest',async t=>{
  const f=await fixture(t),original=f.args.run;f.args.run=async(...args)=>{const result=await original(...args);if(args[1][0]==='publish')await fs.appendFile(path.join(f.root,'apps/windows-host/desktop/Program.cs'),'changed');return result;};
  await assert.rejects(publishNativeDesktop(f.args),{code:'REVISION_CONFLICT',stage:'publish.source'});
});

test('altered notice and out-of-cache destinations refuse before compiler launch',async t=>{
  const f=await fixture(t);await assert.rejects(publishNativeDesktop({...f.args,outputRoot:path.join(f.root,'elsewhere')}),{code:'INVALID_ARGUMENT'});
  await fs.appendFile(path.join(f.root,'apps/desktop/native-component/upstream/dotnet-runtime/LICENSE.TXT'),'changed');
  await assert.rejects(publishNativeDesktop(f.args),{code:'PROTOCOL_MISMATCH',stage:'publish.license'});assert.equal(f.calls.length,0);
});

test('external framework reference or missing embedded runtime cannot pass validation',async t=>{
  const f=await fixture(t),dir=path.join(f.root,'runtime');await runtimeFiles(dir);
  await fs.writeFile(path.join(dir,'WindowsHost.Desktop.runtimeconfig.json'),JSON.stringify({runtimeOptions:{framework:{name:'Microsoft.NETCore.App',version:'8.0.30'}}}));
  await assert.rejects(validateSelfContainedDesktop(dir),{code:'PROTOCOL_MISMATCH'});
  await runtimeFiles(dir);await fs.rm(path.join(dir,'coreclr.dll'));await assert.rejects(validateSelfContainedDesktop(dir),{code:'ENOENT'});
});

test('identity smoke sends only initialize, disables installed runtime lookup and validates protocol',async t=>{
  const f=await fixture(t),dir=path.join(f.root,'runtime');await runtimeFiles(dir);let captured;
  const run=async(command,args,options)=>{captured={command,args,options};const request=JSON.parse(options.stdin);
    const response=JSON.stringify({id:request.id,ok:true,result:{protocol:'personal-agent-desktop/1',version:'1.0.0',capabilities:['stop']}});
    assert.equal(options.closeInputAfter(response),true);return {exitCode:0,output:response};};
  const result=await verifyNativeDesktopIdentity(dir,{run});assert.equal(result.userInputPerformed,false);assert.deepEqual(result.actionsSent,['initialize']);
  assert.equal(JSON.parse(captured.options.stdin).method,'initialize');assert.equal(captured.options.env.DOTNET_MULTILEVEL_LOOKUP,'0');
  assert.equal(captured.options.env.PATH,path.join(process.env.SystemRoot??'C:/Windows','System32'));assert.match(captured.options.env.DOTNET_ROOT,/no-external-dotnet$/);
  await assert.rejects(verifyNativeDesktopIdentity(dir,{run:async()=>({exitCode:0,output:'{}'})}),{code:'PROTOCOL_MISMATCH'});
});

class Child extends EventEmitter{constructor(pid){super();this.pid=pid;this.stdout=new PassThrough();this.stderr=new PassThrough();this.stdin=new PassThrough();this.kills=0;}kill(){this.kills++;}close(code=0){this.stdout.end();this.stderr.end();this.emit('close',code);}}
test('cancel waits for own tree and compiler close without terminating unrelated processes',async()=>{
  const controller=new AbortController(),children=[],calls=[];
  const pending=runNativePublishProcess('dotnet',['publish','fixed.csproj'],{signal:controller.signal,deadline:future(),spawnProcess(command,args,options){calls.push({command,args,options});const child=new Child(1234+children.length);children.push(child);return child;}});
  let settled=false;pending.catch(()=>{settled=true;});controller.abort();await new Promise(r=>setImmediate(r));assert.equal(settled,false);
  assert.deepEqual(calls[1].args,['/PID','1234','/T','/F']);assert.equal(calls[1].options.windowsHide,true);
  children[1].close();await new Promise(r=>setImmediate(r));assert.equal(settled,false);children[0].close(1);
  await assert.rejects(pending,{code:'CANCELLED',stage:'publish.cancel'});assert.equal(children[0].kills,0);
});
test('compiler technical cause is bounded and redacted; missing SDK remains specific',async()=>{
  await assert.rejects(runNativePublishProcess('dotnet',[],{deadline:future(),spawnProcess(){const child=new Child(1234);queueMicrotask(()=>{child.stderr.write('C:\\private\\Program.cs: error CS0103 MissingMember token=private-token\n');child.close(1);});return child;}}),error=>{
    assert.match(error.message,/exit=1/);assert.match(error.message,/CS0103 MissingMember/);assert.doesNotMatch(error.message,/private-token|C:\\private/);return true;
  });
  await assert.rejects(runNativePublishProcess('dotnet',[],{deadline:future(),spawnProcess(){throw Object.assign(Error('missing'),{code:'ENOENT'});}}),error=>error.code==='ENOENT'&&error.message.includes('.NET 8 SDK'));
});

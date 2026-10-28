import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import path from 'node:path';
import {prepareNativeDesktopComponent,nativeDesktopExecutable} from '../electron/native-desktop-component.js';
import {prepareNativeDesktopBeforeStart} from '../scripts/prepare-native-desktop.mjs';

class FakeChild extends EventEmitter{
  constructor(pid){super();this.pid=pid;this.stdout=new PassThrough();this.stderr=new PassThrough();this.kills=0;}
  close(code=0,signal=null){this.stdout.end();this.stderr.end();this.emit('close',code,signal);}
  kill(){this.kills++;}
}
function fixture(options={}){
  const calls=[],children=[],controller=new AbortController();
  const args={electronDir:path.resolve('apps/desktop/electron'),signal:controller.signal,deadline:new Date(Date.now()+60000).toISOString()};
  const dependencies={platform:'win32',fileExists:options.fileExists??(()=>true),spawnProcess(command,argv,config){
    calls.push({command,argv,config});const child=new FakeChild(1000+children.length);children.push(child);
    queueMicrotask(()=>{
      if(command==='dotnet'){
        if(options.onBuild)options.onBuild(child);else child.close();
      }else if(options.onKill)options.onKill(child,children[0]);
      else{children[0].close(null,'SIGKILL');child.close();}
    });return child;
  },...options.dependencies};
  return {args,dependencies,calls,children,controller,run:overrides=>prepareNativeDesktopComponent({...args,...overrides},dependencies)};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('dev preparation incrementally rebuilds even an existing exe from the fixed project',async()=>{
  const f=fixture();assert.equal(await f.run(),nativeDesktopExecutable(f.args));assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].command,'dotnet');assert.equal(f.calls[0].argv[0],'build');
  assert.equal(f.calls[0].argv[1],path.resolve('apps/windows-host/desktop/WindowsHost.Desktop.csproj'));
  assert.ok(f.calls[0].argv.includes('--disable-build-servers'));assert.ok(f.calls[0].argv.includes('-p:UseSharedCompilation=false'));
  assert.ok(f.calls[0].argv.includes('-nodeReuse:false'));assert.deepEqual(f.calls[0].config.stdio,['ignore','pipe','pipe']);
  assert.equal(f.calls[0].config.windowsHide,true);
});

test('packaged preparation uses only the bundled component and never invokes a compiler',async()=>{
  const f=fixture(),resourcesPath=path.resolve('.cache/synthetic-resources');
  assert.equal(await f.run({packaged:true,resourcesPath}),nativeDesktopExecutable({...f.args,packaged:true,resourcesPath}));
  assert.equal(f.calls.length,0);
  const missing=fixture({fileExists:()=>false});await assert.rejects(missing.run({packaged:true,resourcesPath}),{code:'UNSUPPORTED_CAPABILITY',stage:'prepare.bundle'});
  assert.equal(missing.calls.length,0);
});

test('compiler failure retains exit and concrete bounded compiler cause while redacting private fragments',async()=>{
  const f=fixture({onBuild(child){
    child.stdout.write('ordinary output\n'.repeat(5000));
    child.stderr.write('-----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY-----\n');
    child.stderr.write('C:\\private-user\\Program.cs(12,3): error CS0103: MissingMember was not found [C:\\private-user\\Desktop.csproj]\n');
    child.stdout.write('build summary continuation\n'.repeat(900));
    child.stderr.write('Bearer synthetic-private-bearer token=synthetic-private-token body="synthetic-private-body"\n');child.close(1);
  }});
  await assert.rejects(f.run(),error=>{
    assert.equal(error.code,'EXTERNAL_FAILURE');assert.equal(error.stage,'prepare.build');assert.equal(error.exitCode,1);
    assert.match(error.message,/exit=1/);assert.match(error.message,/error CS0103: MissingMember was not found/);
    assert.ok(error.message.length<10000);assert.doesNotMatch(error.message,/private-user|private-key-material|synthetic-private/);return true;
  });
});

test('missing dotnet preserves ENOENT and the .NET 8 requirement; no output exe is treated as success',async()=>{
  const missingSdk=fixture({onBuild(child){child.emit('error',Object.assign(Error('spawn dotnet ENOENT'),{code:'ENOENT'}));child.close(-2);}});
  await assert.rejects(missingSdk.run(),error=>error.code==='ENOENT'&&error.stage==='prepare.spawn'&&error.message.includes('.NET 8 SDK'));
  const missingOutput=fixture({fileExists:file=>file.endsWith('.csproj')});
  await assert.rejects(missingOutput.run(),{code:'ENOENT',stage:'prepare.readback'});
});

test('cancel waits for both taskkill tree termination and compiler stdio close before reporting cancelled',async()=>{
  const f=fixture({onBuild(){},onKill(){}});let settled=false;
  const pending=f.run().finally(()=>{settled=true;});await tick();f.controller.abort();await tick();
  assert.equal(f.calls.length,2);assert.ok(f.calls[1].command.endsWith('taskkill.exe'));
  assert.deepEqual(f.calls[1].argv,['/PID','1000','/T','/F']);assert.equal(settled,false);
  f.children[0].close(null,'SIGKILL');await tick();assert.equal(settled,false);
  f.children[1].close();await assert.rejects(pending,error=>error.code==='CANCELLED'&&error.stage==='prepare.cancel'&&error.message.includes('进程树已退出'));
});

test('deadline stops the owned compiler tree and a failed stop is explicitly unconfirmed',async()=>{
  const timers=[],f=fixture({onBuild(){},dependencies:{setTimer:callback=>{timers.push(callback);return callback;},clearTimer:()=>{}}});
  const expired=f.run();timers[0]();await assert.rejects(expired,{code:'TIMEOUT',stage:'prepare.timeout'});
  assert.equal(f.calls.length,2);
  const denied=fixture({onBuild(){},onKill(child){child.close(5);}}),pending=denied.run();await tick();denied.controller.abort();
  await assert.rejects(pending,error=>error.code==='RESULT_UNKNOWN'&&error.stage==='prepare.stop'&&error.message.includes('exit=5'));
});

test('prestart reuses preparation and reports a safe specific failure without blocking other features',async()=>{
  const output=[],calls=[];
  const result=await prepareNativeDesktopBeforeStart({platform:'win32',now:()=>1000,stderr:{write:text=>output.push(text)},
    prepare:async args=>{calls.push(args);throw Object.assign(Error('error CS1061: MissingMethod at C:\\private-user\\Program.cs token=private-token'),{code:'EXTERNAL_FAILURE',stage:'prepare.build'});}});
  assert.equal(calls.length,1);assert.equal(Date.parse(calls[0].deadline),121000);assert.equal(result.prepared,false);
  assert.match(output.join(''),/CS1061: MissingMethod/);assert.match(output.join(''),/prepare.build/);assert.match(output.join(''),/其它功能仍可使用/);
  assert.doesNotMatch(output.join(''),/private-user|private-token/);
  assert.deepEqual(await prepareNativeDesktopBeforeStart({platform:'linux',prepare:()=>{throw Error('must not compile');}}),{prepared:false,skipped:true});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {publishWindowsHost,verifyWindowsHostIdentity} from '../scripts/publish-windows-host.mjs';
import {readWindowsHostComponent,windowsHostInventory} from '../electron/native-windows-host-component.js';
import {createWindowsHostBridgeTransport} from '@personal-agent/runtime/application';

const root=path.resolve(import.meta.dirname,'../../..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(){
  const outputRoot=path.join(root,'.cache/native-desktop-publish','host-fixture-'+randomUUID());
  await fs.mkdir(path.join(outputRoot,'resources/native-tools'),{recursive:true});
  const calls=[];
  const run=async(command,args)=>{
    calls.push({command,args});if(args[0]==='--version')return {output:'8.0.425'};
    assert.ok(args.includes('--self-contained'));assert.ok(args.includes('-p:RuntimeFrameworkVersion=8.0.30'));
    const directory=args[args.indexOf('--output')+1],host=path.basename(directory)==='host',stem=host?'WindowsHost.Host':'WindowsHost.PipeBridge';
    await fs.mkdir(directory,{recursive:true});
    for(const name of [stem+'.exe',stem+'.dll','coreclr.dll','hostfxr.dll','hostpolicy.dll',...(host?['PresentationCore.dll','PresentationFramework.dll','WindowsBase.dll','windows-host.json']:[])])
      await fs.writeFile(path.join(directory,name),'Synthetic '+name);
    await fs.writeFile(path.join(directory,stem+'.runtimeconfig.json'),JSON.stringify({runtimeOptions:{includedFrameworks:
      ['Microsoft.NETCore.App',...(host?['Microsoft.WindowsDesktop.App']:[])].map(name=>({name,version:'8.0.30'}))}}));
    await fs.writeFile(path.join(directory,stem+'.deps.json'),JSON.stringify({runtimeTarget:{name:'.NETCoreApp,Version=v8.0/win-x64'}}));
    return {output:'Synthetic publication'};
  };
  const result=await publishWindowsHost({root,outputRoot,run});
  return {outputRoot,resources:path.join(outputRoot,'resources'),bundle:result.bundle,calls,run};
}
test('Host and Bridge publication has distinct complete runtime/contract/license identity and refuses overwrite',async()=>{
  const f=await fixture(),value=readWindowsHostComponent(f.resources);
  assert.equal(f.calls.length,3);assert.equal(value.assertCurrentBundle(value),true);
  assert.throws(()=>value.assertCurrentBundle({...value,hostPath:value.bridgePath}));
  await assert.rejects(publishWindowsHost({root,outputRoot:f.outputRoot,run:f.run}),{code:'EEXIST'});
});
for(const [name,modify]of [
  ['extra file',f=>fs.writeFile(path.join(f.bundle,'host/extra.dll'),'extra')],
  ['replaced runtime',f=>fs.writeFile(path.join(f.bundle,'bridge/coreclr.dll'),'replacement')],
  ['missing schema',f=>fs.unlink(path.join(f.bundle,'host/windows-host.json'))],
  ['changed manifest',f=>fs.writeFile(path.join(f.bundle,'windows-host-component-manifest.sha256'),'invalid')],
])test('Host component rejects '+name,async()=>{const f=await fixture();await modify(f);assert.throws(()=>readWindowsHostComponent(f.resources));});
test('captured Host identity rejects even a self-consistently rewritten manifest',async()=>{
  const f=await fixture(),value=readWindowsHostComponent(f.resources);
  await fs.writeFile(path.join(f.bundle,'host/WindowsHost.Host.dll'),'replacement');
  const file=path.join(f.bundle,'windows-host-component-manifest.json'),manifest=JSON.parse(await fs.readFile(file,'utf8'));
  manifest.files=windowsHostInventory(f.bundle);const bytes=Buffer.from(JSON.stringify(manifest)+'\n');
  await fs.writeFile(file,bytes);await fs.writeFile(path.join(f.bundle,'windows-host-component-manifest.sha256'),sha(bytes)+'  windows-host-component-manifest.json\n');
  assert.throws(()=>value.assertCurrentBundle(value));
});
test('transport refuses an unbound self-contained bundle before any process start',{skip:process.platform!=='win32'},async()=>{
  const f=await fixture(),value=readWindowsHostComponent(f.resources);
  const transport=createWindowsHostBridgeTransport({hostPath:value.hostPath,bridgePath:value.bridgePath});
  await assert.rejects(transport.openVerifiedConnection(),{code:'UNAUTHORIZED'});await transport.close();
});
test('app-local host loader cannot masquerade as the legacy FDD entry point',{skip:process.platform!=='win32'},async()=>{
  const f=await fixture(),value=readWindowsHostComponent(f.resources);
  for(const executable of [value.hostPath,value.bridgePath]){
    await fs.unlink(path.join(path.dirname(executable),'coreclr.dll'));
    await fs.writeFile(executable.replace(/\.exe$/u,'.runtimeconfig.json'),JSON.stringify({runtimeOptions:{framework:{name:'Microsoft.NETCore.App',version:'8.0.0'}}}));
  }
  const transport=createWindowsHostBridgeTransport({hostPath:value.hostPath,bridgePath:value.bridgePath});
  await assert.rejects(transport.openVerifiedConnection(),{code:'UNAUTHORIZED'});await transport.close();
});

const resources=process.env.PA_TEST_WINDOWS_HOST_RESOURCES;
test('real ordinary-token Host peer/hello/EOF and Runtime integrity checks use clean environment',
  {skip:!resources&&'Explicit trusted Windows Host resources unavailable'},async()=>{
    assert.equal(process.platform,'win32');
    const identity=await verifyWindowsHostIdentity(resources);
    assert.equal(identity.exitCode,0);assert.equal(identity.externalDotnetDisabled,true);assert.deepEqual(identity.actionsSent,['hello']);
    const component=readWindowsHostComponent(resources),journalDirectory=await fs.mkdtemp(path.join(tmpdir(),'pa-host-transport-中文-'));
    let current=true,checks=0;
    const transport=createWindowsHostBridgeTransport({...component,journalDirectory,assertCurrentBundle:value=>{
      checks++;return current&&component.assertCurrentBundle(value);
    }});
    const previous=process.env.DOTNET_STARTUP_HOOKS;process.env.DOTNET_STARTUP_HOOKS=path.join(journalDirectory,'must-not-be-inherited.dll');
    try{
      const connection=await transport.openVerifiedConnection();
      const hello={kind:'hello',protocolVersion:'0.1.0',requestId:randomUUID(),clientNonce:'a'.repeat(32)};
      const reply=await connection.exchange(hello);assert.equal(reply.kind,'hello_ack');assert.equal(reply.clientNonce,hello.clientNonce);
      current=false;
      await assert.rejects(connection.send({kind:'bind',protocolVersion:'0.1.0',requestId:hello.requestId,sessionId:reply.sessionId,hostNonce:reply.hostNonce}),{code:'UNAUTHORIZED'});
      assert.equal(checks,3);await connection.close();
    }finally{if(previous===undefined)delete process.env.DOTNET_STARTUP_HOOKS;else process.env.DOTNET_STARTUP_HOOKS=previous;await transport.close();}
  });

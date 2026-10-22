import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectDotnetInfo,nativePublishArguments,probeNativeToolchain,readPeArchitecture,
  requireNativeArchitecture,requireNativeRuntime,toolchainFailureDiagnostic} from '../native/host-architecture.mjs';

const arm={platform:'win32',nodeArchitecture:'arm64',osArchitecture:'ARM64',expectedArchitecture:'arm64'};
const info=architecture=>`Host:\n  Version:      8.0.31\n  Architecture: ${architecture}\n  Commit:       fixture\n\n.NET SDKs installed:\n  8.0.425 [private-path]\n`;
test('toolchain failure diagnostics distinguish query failure without exporting native output',()=>{
  let observed;
  try{probeNativeToolchain({host:arm,run:()=>({status:null,error:{code:'ENOENT',message:'private-token'},stderr:'private-output'})});}
  catch(error){observed=toolchainFailureDiagnostic(error);}
  assert.deepEqual(observed,{status:'failed',reason:'Native dotnet query failed',query:'--info',processError:'ENOENT',exitCode:null});
  assert.deepEqual(toolchainFailureDiagnostic({message:'private-token',query:'private-path',stderr:'private-output'}),
    {status:'failed',reason:'Native Windows toolchain architecture preflight failed'});
});
test('native Windows builds refuse emulated Node, wrong requested target and unsupported architectures',()=>{
  assert.deepEqual(requireNativeArchitecture(arm),{architecture:'arm64',runtimeIdentifier:'win-arm64'});
  assert.deepEqual(requireNativeArchitecture({...arm,nodeArchitecture:'x64',osArchitecture:'AMD64',expectedArchitecture:'x64'}),
    {architecture:'x64',runtimeIdentifier:'win-x64'});
  for(const changes of [{nodeArchitecture:'x64'},{expectedArchitecture:'x64'},{osArchitecture:'unknown'},
    {platform:'linux'},{nodeArchitecture:'ia32'},{expectedArchitecture:''}])assert.throws(()=>requireNativeArchitecture({...arm,...changes}));
});
test('dotnet host must be native with a preinstalled .NET 8 SDK and runtime',()=>{
  const outputs=new Map([['--info',info('arm64')],['--list-sdks','8.0.425 [private-sdk-path]\r\n10.0.100 [other]\r\n'],
    ['--list-runtimes','Microsoft.NETCore.App 8.0.31 [private-runtime-path]\r\n']]);
  function run(_command,args,options){
    assert.equal(_command,'dotnet');assert.equal(options.shell,false);
    assert.equal(options.env.DOTNET_CLI_UI_LANGUAGE,'en-US');
    return {status:0,signal:null,stdout:outputs.get(args[0])};
  }
  const proof=probeNativeToolchain({host:arm,run});
  assert.equal(proof.architecture,'arm64');
  assert.deepEqual(proof.dotnet,{architecture:'arm64',sdkVersions:['8.0.425'],runtimeVersions:['8.0.31']});
  assert.equal(JSON.stringify(proof).includes('private-'),false);
  assert.throws(()=>inspectDotnetInfo(info('x64'),'arm64'));
  assert.throws(()=>inspectDotnetInfo('Architecture: arm64\nHost:\n  Version: 8.0.31','arm64'));
  outputs.set('--list-runtimes','Microsoft.NETCore.App 10.0.0 [private]\n');
  assert.throws(()=>probeNativeToolchain({host:arm,run}));
  assert.throws(()=>probeNativeToolchain({host:arm,run:()=>({status:1,stderr:'private failure'})}));
});
test('native apphost RID and PE machine are checked for both supported architectures',()=>{
  for(const [architecture,machine] of [['arm64',0xaa64],['x64',0x8664]]){
    const args=nativePublishArguments('fixed.csproj','external-target','Release',architecture);
    assert.equal(args[args.indexOf('--runtime')+1],'win-'+architecture);
    assert.equal(args[args.indexOf('--self-contained')+1],'false');
    const bytes=Buffer.alloc(160);bytes.writeUInt16LE(0x5a4d);bytes.writeUInt32LE(128,0x3c);
    bytes.writeUInt32LE(0x4550,128);bytes.writeUInt16LE(machine,132);
    assert.equal(readPeArchitecture(bytes),architecture);
    bytes.writeUInt16LE(0x14c,132);assert.throws(()=>readPeArchitecture(bytes));
    bytes.writeUInt32LE(0xffffffff,0x3c);assert.throws(()=>readPeArchitecture(bytes));
  }
  assert.throws(()=>nativePublishArguments('fixed','external','Release','ia32'));
  assert.throws(()=>readPeArchitecture(Buffer.alloc(10)));
});
test('actual helper and launcher receipts require native .NET 8 after token reduction',()=>{
  const proof={processArchitecture:'Arm64',osArchitecture:'Arm64',framework:'.NET 8.0.31'};
  requireNativeRuntime(proof,'arm64');
  for(const patch of [{processArchitecture:'X64'},{osArchitecture:'X64'},{framework:'.NET 10.0.0'},
    {framework:undefined},{osArchitecture:undefined}])assert.throws(()=>requireNativeRuntime({...proof,...patch},'arm64'));
});

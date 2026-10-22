import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectDotnetInfo,nativePublishArguments,probeNativeToolchain,readPeArchitecture,
  probeNativeWindowsArchitecture,requireNativeArchitecture,requireNativeRuntime,toolchainFailureDiagnostic} from '../native/host-architecture.mjs';

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
    {platform:'linux'},{nodeArchitecture:'ia32'},{expectedArchitecture:''}])assert.throws(()=>requireNativeArchitecture({...arm,...changes,
      readNativeArchitecture:()=>{throw Error('Native Windows OS architecture probe failed');}}));
});
const nativeReceipt=(patch={})=>JSON.stringify({version:1,api:'IsWow64Process2',processId:1234,processMachine:0,nativeMachine:0xaa64,...patch});
const nativeProbe=patch=>probeNativeWindowsArchitecture({processId:1234,
  run:()=>({status:0,signal:null,stdout:nativeReceipt(patch)})});
test('unknown OS machine is resolved only by a strict native API receipt for the current Node process',()=>{
  const proof=probeNativeWindowsArchitecture({processId:1234,run:(command,args,options)=>{
    assert.equal(command,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.deepEqual(args.slice(0,4),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand']);
    assert.equal(options.shell,false);assert.equal(options.windowsHide,true);assert.equal(options.timeout,10000);
    assert.equal(options.env.PROCESSOR_ARCHITECTURE,undefined);assert.equal(options.env.PROCESSOR_ARCHITEW6432,undefined);
    assert.equal(options.env.PA_PSEC_EXPECTED_ARCH,undefined);assert.equal(options.env.PATH,undefined);
    const script=Buffer.from(args[4],'base64').toString('utf16le');
    assert.match(script,/OpenProcess\(0x1000, false, processId\)/u);assert.match(script,/IsWow64Process2\(process,/u);
    assert.match(script,/\[PsecNativeArchitecture\]::Read\(1234\)/u);assert.match(script,/DllImportSearchPath\.System32/u);
    assert.doesNotMatch(script,/GetNativeSystemInfo|PROCESSOR_ARCHITECTURE|ExecutionPolicy/u);
    return {status:0,signal:null,stdout:nativeReceipt()};
  }});
  assert.deepEqual(proof,{architecture:'arm64',api:'IsWow64Process2',processMachine:0,nativeMachine:0xaa64});
  assert.deepEqual(requireNativeArchitecture({...arm,osArchitecture:'unknown',readNativeArchitecture:()=>proof}),
    {architecture:'arm64',runtimeIdentifier:'win-arm64',osArchitectureProbe:proof});
  const x64=nativeProbe({nativeMachine:0x8664});
  assert.equal(requireNativeArchitecture({...arm,nodeArchitecture:'x64',expectedArchitecture:'x64',osArchitecture:'unknown',
    readNativeArchitecture:()=>x64}).architecture,'x64');
  assert.throws(()=>requireNativeArchitecture({...arm,nodeArchitecture:'x64',expectedArchitecture:'x64',osArchitecture:'unknown',
    readNativeArchitecture:()=>proof}),/Emulated Node/u);
  assert.throws(()=>nativeProbe({processMachine:0x8664}),/Emulated Node/u);
});
test('native OS query failures, unbound or forged receipts cannot make unknown pass',()=>{
  for(const patch of [{processId:1235},{processId:'1234'},{api:'environment'},{version:2},{nativeMachine:'arm64'},
    {processMachine:'0'},{nativeMachine:0xffff},{nativeMachine:0x14c},{processMachine:-1},{private:'PRIVATE_BODY'}])
    assert.throws(()=>nativeProbe(patch));
  for(const stdout of ['PRIVATE_BODY','null','[]','{"architecture":"arm64"}',nativeReceipt()+'\nPRIVATE_BODY'])
    assert.throws(()=>probeNativeWindowsArchitecture({processId:1234,run:()=>({status:0,stdout})}));
  for(const result of [{status:1,stdout:nativeReceipt(),stderr:'PRIVATE_BODY'},
    {status:null,error:{code:'EPERM',message:'PRIVATE_PATH'},stderr:'PRIVATE_BODY'},
    {status:0,signal:'SIGTERM',stdout:nativeReceipt()}]){
    let diagnostic;
    assert.throws(()=>{try{probeNativeWindowsArchitecture({processId:1234,run:()=>result});}
      catch(error){diagnostic=toolchainFailureDiagnostic(error);throw error;}},/Native Windows OS architecture probe failed/u);
    assert.equal(diagnostic.query,'native-os-architecture');assert.doesNotMatch(JSON.stringify(diagnostic),/PRIVATE_/u);
  }
  for(const proof of [undefined,'arm64',{architecture:'arm64'}, {...nativeProbe(),nativeMachine:0x8664},
    {...nativeProbe(),processMachine:0x8664},{...nativeProbe(),private:'PRIVATE_BODY'}])
    assert.throws(()=>requireNativeArchitecture({...arm,osArchitecture:'unknown',readNativeArchitecture:()=>proof}));
});
test('known OS machines and known mismatches never consult unknown-only fallback',()=>{
  let probes=0;const readNativeArchitecture=()=>{probes++;return nativeProbe();};
  requireNativeArchitecture({...arm,readNativeArchitecture});
  for(const patch of [{osArchitecture:'AMD64'},{osArchitecture:'Unknown'},{osArchitecture:undefined,nodeArchitecture:'ia32'},
    {osArchitecture:'arm64ec'},{osArchitecture:'arm'},{nodeArchitecture:'x64'},{platform:'linux'}])
    assert.throws(()=>requireNativeArchitecture({...arm,...patch,readNativeArchitecture}));
  assert.equal(probes,0,'known/unsupported architecture cannot be overwritten by another source');
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
  const resolved=probeNativeToolchain({host:{...arm,osArchitecture:'unknown',readNativeArchitecture:()=>nativeProbe()},run});
  assert.equal(resolved.architecture,'arm64');assert.equal(resolved.osArchitectureProbe.api,'IsWow64Process2');
  outputs.set('--info',info('x64'));
  assert.throws(()=>probeNativeToolchain({host:{...arm,osArchitecture:'unknown',readNativeArchitecture:()=>nativeProbe()},run}),/mismatched dotnet/u);
  outputs.set('--info',info('arm64'));
  assert.throws(()=>inspectDotnetInfo(info('x64'),'arm64'));
  assert.throws(()=>inspectDotnetInfo('Architecture: arm64\nHost:\n  Version: 8.0.31','arm64'));
  outputs.set('--list-runtimes','Microsoft.NETCore.App 10.0.0 [private]\n');
  assert.throws(()=>probeNativeToolchain({host:arm,run}));
  assert.throws(()=>probeNativeToolchain({host:{...arm,osArchitecture:'unknown',readNativeArchitecture:()=>nativeProbe()},run}));
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

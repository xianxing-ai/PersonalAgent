// Build-time/CI metadata only. Never substitute emulation for native PSEC acceptance.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function normalizeArchitecture(value) {
  if (typeof value !== 'string') throw Error('Unknown Windows architecture');
  if (/^(x64|amd64|x86_64)$/iu.test(value)) return 'x64';
  if (/^(arm64|aarch64)$/iu.test(value)) return 'arm64';
  const error=Error('Unsupported Windows architecture');
  error.unsupportedArchitecture=['x86','ia32','arm','arm64ec'].includes(value.toLowerCase())?value.toLowerCase():'other';
  throw error;
}

// Fixed OS component, not PATH/SystemRoot/PROCESSOR_ARCHITECTURE supplied by the caller.
// Unknown-machine fallback intentionally fails closed on nonstandard Windows locations.
const WINDOWS_POWERSHELL='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
// Cold Windows PowerShell/.NET initialization and Add-Type compilation are included.
// This is a bounded read-only query, not a PSEC execution or a retry allowance.
const NATIVE_ARCHITECTURE_TIMEOUT_MS=60000;
const NATIVE_ARCHITECTURE_STAGE_PREFIX='PSEC_NATIVE_OS_ARCH_V1:';
const NATIVE_ARCHITECTURE_STAGES=['powershell-started','type-compiled','query-complete'];
function nativeArchitectureStage(stderr) {
  let stage='no-stage-received';
  if (typeof stderr==='string') for (const line of stderr.split(/\r?\n/u)) {
    if (NATIVE_ARCHITECTURE_STAGES.some(value=>line===NATIVE_ARCHITECTURE_STAGE_PREFIX+value))
      stage=line.slice(NATIVE_ARCHITECTURE_STAGE_PREFIX.length);
  }
  return stage;
}
export function probeNativeWindowsArchitecture({run=spawnSync,processId=process.pid}={}) {
  if (!Number.isSafeInteger(processId) || processId<=0 || processId>0xffffffff) throw Error('Native Windows OS architecture probe failed');
  const script=`$ErrorActionPreference = 'Stop'
[Console]::Error.WriteLine('${NATIVE_ARCHITECTURE_STAGE_PREFIX}powershell-started')
Add-Type -TypeDefinition @'
using System;
using System.Globalization;
using System.Runtime.InteropServices;
public static class PsecNativeArchitecture {
  [DllImport("kernel32.dll", ExactSpelling=true, SetLastError=true)]
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  private static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
  [DllImport("kernel32.dll", ExactSpelling=true, SetLastError=true)]
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool IsWow64Process2(IntPtr process, out ushort processMachine, out ushort nativeMachine);
  [DllImport("kernel32.dll", ExactSpelling=true)]
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool CloseHandle(IntPtr handle);
  public static string Read(uint processId) {
    IntPtr process = OpenProcess(0x1000, false, processId);
    if (process == IntPtr.Zero) throw new InvalidOperationException("Native process query failed");
    try {
      ushort processMachine, nativeMachine;
      if (!IsWow64Process2(process, out processMachine, out nativeMachine))
        throw new InvalidOperationException("Native architecture query failed");
      return "{\\"version\\":1,\\"api\\":\\"IsWow64Process2\\",\\"processId\\":" + processId.ToString(CultureInfo.InvariantCulture)
        + ",\\"processMachine\\":" + processMachine.ToString(CultureInfo.InvariantCulture)
        + ",\\"nativeMachine\\":" + nativeMachine.ToString(CultureInfo.InvariantCulture) + "}";
    } finally { CloseHandle(process); }
  }
}
'@ | Out-Null
[Console]::Error.WriteLine('${NATIVE_ARCHITECTURE_STAGE_PREFIX}type-compiled')
$receipt = [PsecNativeArchitecture]::Read(${processId})
[Console]::Error.WriteLine('${NATIVE_ARCHITECTURE_STAGE_PREFIX}query-complete')
$receipt`;
  const started=performance.now();
  const result=run(WINDOWS_POWERSHELL,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
    {encoding:'utf8',windowsHide:true,shell:false,timeout:NATIVE_ARCHITECTURE_TIMEOUT_MS,maxBuffer:8192,
      env:{SystemRoot:'C:\\Windows',windir:'C:\\Windows',TEMP:os.tmpdir(),TMP:os.tmpdir()}});
  if (result.error || result.status!==0 || result.signal) {
    const error=Error('Native Windows OS architecture probe failed');error.query='native-os-architecture';
    error.exitCode=Number.isInteger(result.status)?result.status:null;
    error.processError=['ENOENT','EACCES','EPERM','ETIMEDOUT'].includes(result.error?.code)?result.error.code:'UNKNOWN';
    error.probeTimeoutMs=NATIVE_ARCHITECTURE_TIMEOUT_MS;
    error.probeElapsedMs=Math.max(0,Math.round(performance.now()-started));
    error.probeStage=nativeArchitectureStage(result.stderr);
    throw error;
  }
  let receipt;
  try { receipt=JSON.parse(result.stdout); } catch { throw Error('Invalid native Windows OS architecture receipt'); }
  const fields=['version','api','processId','processMachine','nativeMachine'];
  if (!receipt || Array.isArray(receipt) || Object.keys(receipt).length!==fields.length
    || Object.keys(receipt).some(key=>!fields.includes(key)) || receipt.version!==1 || receipt.api!=='IsWow64Process2'
    || receipt.processId!==processId || !Number.isInteger(receipt.processMachine) || receipt.processMachine<0 || receipt.processMachine>0xffff
    || !Number.isInteger(receipt.nativeMachine) || receipt.nativeMachine<0 || receipt.nativeMachine>0xffff)
    throw Error('Invalid native Windows OS architecture receipt');
  if (receipt.processMachine!==0) throw Error('Emulated Node is not native acceptance');
  const architecture=new Map([[0x8664,'x64'],[0xaa64,'arm64']]).get(receipt.nativeMachine);
  if (!architecture) throw Error('Unsupported native Windows OS architecture');
  return {architecture,api:'IsWow64Process2',processMachine:receipt.processMachine,nativeMachine:receipt.nativeMachine};
}

export function requireNativeArchitecture({platform=process.platform, nodeArchitecture=process.arch,
  osArchitecture=os.machine(), expectedArchitecture=process.env.PA_PSEC_EXPECTED_ARCH,
  readNativeArchitecture=probeNativeWindowsArchitecture}={}) {
  if (platform !== 'win32') throw Error('Native Windows required');
  const architecture=normalizeArchitecture(nodeArchitecture);
  const native=osArchitecture==='unknown'?readNativeArchitecture():undefined;
  // The fixed native reader validates its receipt before returning; do not accept a bare env/architecture hint.
  if (osArchitecture==='unknown' && (!native || typeof native!=='object' || Array.isArray(native)
    || Object.keys(native).length!==4 || Object.keys(native).some(key=>!['architecture','api','processMachine','nativeMachine'].includes(key))
    || native.api!=='IsWow64Process2' || native.processMachine!==0
    || ![0x8664,0xaa64].includes(native.nativeMachine)
    || native.architecture!==new Map([[0x8664,'x64'],[0xaa64,'arm64']]).get(native.nativeMachine)))
    throw Error('Invalid native Windows OS architecture receipt');
  const installed=native?.architecture??normalizeArchitecture(osArchitecture);
  if (architecture !== installed) throw Error('Emulated Node is not native acceptance');
  if (expectedArchitecture !== undefined && (!['x64','arm64'].includes(expectedArchitecture)
    || architecture !== expectedArchitecture)) throw Error('Requested Windows architecture mismatch');
  return {architecture,runtimeIdentifier:'win-'+architecture,...(native===undefined?{}:{osArchitectureProbe:native})};
}

export function inspectDotnetInfo(output, expectedArchitecture) {
  // DOTNET_CLI_UI_LANGUAGE=en-US keeps these fixed labels independent of Runner locale.
  const host=/^Host:\s*\r?\n([\s\S]*?)(?=^\S|$(?![\s\S]))/mu.exec(output)?.[1];
  const architecture=/^\s+Architecture:\s*(\S+)\s*$/mu.exec(host??'')?.[1];
  if (normalizeArchitecture(architecture) !== expectedArchitecture) throw Error('Emulated or mismatched dotnet host');
  return {architecture:expectedArchitecture};
}

export function probeNativeToolchain({host,expectedArchitecture,run=spawnSync}={}) {
  const native=requireNativeArchitecture({...host,expectedArchitecture:expectedArchitecture??host?.expectedArchitecture});
  function query(argument) {
    const result=run('dotnet',[argument],{encoding:'utf8',windowsHide:true,shell:false,timeout:10000,maxBuffer:65536,
      env:{...process.env,DOTNET_CLI_UI_LANGUAGE:'en-US'}});
    if (result.error || result.status!==0 || result.signal) {
      const error=Error('Native dotnet query failed');
      error.query=argument;error.exitCode=Number.isInteger(result.status)?result.status:null;
      error.processError=['ENOENT','EACCES','EPERM','ETIMEDOUT'].includes(result.error?.code)?result.error.code:'UNKNOWN';
      throw error;
    }
    return result.stdout??'';
  }
  const dotnet=inspectDotnetInfo(query('--info'),native.architecture);
  const sdks=query('--list-sdks'),runtimes=query('--list-runtimes');
  const sdkVersions=[...sdks.matchAll(/^8\.0\.\d+(?:-[\w.-]+)?(?=\s)/gmu)].map(match=>match[0]);
  const runtimeVersions=[...runtimes.matchAll(/^Microsoft\.NETCore\.App (8\.0\.\d+)(?=\s)/gmu)].map(match=>match[1]);
  if (!sdkVersions.length || !runtimeVersions.length) {
    const error=Error('Native .NET 8 SDK and runtime required');error.sdk8Count=sdkVersions.length;error.runtime8Count=runtimeVersions.length;throw error;
  }
  return {...native,nodeVersion:process.version,dotnet:{...dotnet,sdkVersions,runtimeVersions}};
}

export function readPeArchitecture(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length<64 || bytes.readUInt16LE(0)!==0x5a4d) throw Error('Invalid PE image');
  const offset=bytes.readUInt32LE(0x3c);
  if (offset<64 || offset>bytes.length-6 || bytes.readUInt32LE(offset)!==0x4550) throw Error('Invalid PE header');
  const architecture=new Map([[0x8664,'x64'],[0xaa64,'arm64']]).get(bytes.readUInt16LE(offset+4));
  if (!architecture) throw Error('Unsupported native PE architecture');
  return architecture;
}

export function requirePeArchitecture(file,architecture) {
  if (readPeArchitecture(readFileSync(file))!==architecture) throw Error('Native apphost architecture mismatch');
}

export function requireNativeRuntime({processArchitecture,osArchitecture,framework}={},architecture) {
  if (normalizeArchitecture(processArchitecture)!==architecture || normalizeArchitecture(osArchitecture)!==architecture
    || typeof framework!=='string' || !/^\.NET 8\.0\.\d+$/u.test(framework))
    throw Error('Native .NET 8 process/OS architecture mismatch');
}

export function nativePublishArguments(project,target,configuration,architecture) {
  if (!['x64','arm64'].includes(architecture)) throw Error('Unsupported publish architecture');
  return ['publish',project,'-c',configuration,'--runtime','win-'+architecture,
    '--self-contained','false','-o',target,'--nologo','-v','quiet'];
}

export function toolchainFailureDiagnostic(error) {
  const reasons=new Set(['Unknown Windows architecture','Unsupported Windows architecture','Native Windows required',
    'Emulated Node is not native acceptance','Requested Windows architecture mismatch','Emulated or mismatched dotnet host',
    'Native dotnet query failed','Native .NET 8 SDK and runtime required','Native Windows OS architecture probe failed',
    'Invalid native Windows OS architecture receipt','Unsupported native Windows OS architecture']);
  const result={status:'failed',reason:reasons.has(error?.message)?error.message:'Native Windows toolchain architecture preflight failed'};
  if(['x86','ia32','arm','arm64ec','other'].includes(error?.unsupportedArchitecture))result.unsupportedArchitecture=error.unsupportedArchitecture;
  if(['--info','--list-sdks','--list-runtimes','native-os-architecture'].includes(error?.query))result.query=error.query;
  if(['ENOENT','EACCES','EPERM','ETIMEDOUT','UNKNOWN'].includes(error?.processError))result.processError=error.processError;
  if(error?.exitCode===null||Number.isInteger(error?.exitCode))result.exitCode=error.exitCode;
  if (result.query==='native-os-architecture') {
    if (error?.probeTimeoutMs===NATIVE_ARCHITECTURE_TIMEOUT_MS) result.probeTimeoutMs=error.probeTimeoutMs;
    if (Number.isSafeInteger(error?.probeElapsedMs)&&error.probeElapsedMs>=0) result.probeElapsedMs=error.probeElapsedMs;
    if (['no-stage-received',...NATIVE_ARCHITECTURE_STAGES].includes(error?.probeStage)) result.probeStage=error.probeStage;
  }
  for(const field of ['sdk8Count','runtime8Count'])if(Number.isInteger(error?.[field])&&error[field]>=0)result[field]=error[field];
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1])===path.resolve(import.meta.filename)) {
  try { console.log(JSON.stringify(probeNativeToolchain())); }
  catch(error) { console.error(JSON.stringify({...toolchainFailureDiagnostic(error),nodeArchitecture:process.arch,osMachine:os.machine()})); process.exitCode=1; }
}

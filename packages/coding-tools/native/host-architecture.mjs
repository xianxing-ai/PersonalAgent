// Build-time/CI metadata only. Never substitute emulation for native PSEC acceptance.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function normalizeArchitecture(value) {
  if (typeof value !== 'string') throw Error('Unknown Windows architecture');
  if (/^(x64|amd64|x86_64)$/iu.test(value)) return 'x64';
  if (/^(arm64|aarch64)$/iu.test(value)) return 'arm64';
  throw Error('Unsupported Windows architecture');
}

export function requireNativeArchitecture({platform=process.platform, nodeArchitecture=process.arch,
  osArchitecture=os.machine(), expectedArchitecture=process.env.PA_PSEC_EXPECTED_ARCH}={}) {
  if (platform !== 'win32') throw Error('Native Windows required');
  const architecture=normalizeArchitecture(nodeArchitecture);
  if (architecture !== normalizeArchitecture(osArchitecture)) throw Error('Emulated Node is not native acceptance');
  if (expectedArchitecture !== undefined && (!['x64','arm64'].includes(expectedArchitecture)
    || architecture !== expectedArchitecture)) throw Error('Requested Windows architecture mismatch');
  return {architecture,runtimeIdentifier:'win-'+architecture};
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
    'Native dotnet query failed','Native .NET 8 SDK and runtime required']);
  const result={status:'failed',reason:reasons.has(error?.message)?error.message:'Native Windows toolchain architecture preflight failed'};
  if(['--info','--list-sdks','--list-runtimes'].includes(error?.query))result.query=error.query;
  if(['ENOENT','EACCES','EPERM','ETIMEDOUT','UNKNOWN'].includes(error?.processError))result.processError=error.processError;
  if(error?.exitCode===null||Number.isInteger(error?.exitCode))result.exitCode=error.exitCode;
  for(const field of ['sdk8Count','runtime8Count'])if(Number.isInteger(error?.[field])&&error[field]>=0)result[field]=error[field];
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1])===path.resolve(import.meta.filename)) {
  try { console.log(JSON.stringify(probeNativeToolchain())); }
  catch(error) { console.error(JSON.stringify(toolchainFailureDiagnostic(error))); process.exitCode=1; }
}

import {execFile} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// CI environment preparation only. This does not measure cold-start performance
// or replace the subsequent production certificate call and its original 10s limit.
const script = `$ErrorActionPreference='Stop';$rsa=[Security.Cryptography.RSACng]::new(2048);
try {$request=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=PersonalAgent local pairing',$rsa,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1);
$cert=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-1),[DateTimeOffset]::UtcNow.AddMinutes(16));
try {$null=$cert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx,'');$null=$cert.RawData}
finally {$cert.Dispose()}} finally {$rsa.Dispose()}`;

export async function warmKnowledgeCertificateBackend({platform=process.platform,systemRoot=process.env.SystemRoot,
  execute=execFile,log=console.log}={}) {
  if(platform!=='win32'||typeof systemRoot!=='string'||!path.win32.isAbsolute(systemRoot))
    throw Error('Certificate backend preparation requires the Windows system directory');
  const executable=path.win32.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const started=performance.now();
  try {
    await new Promise((resolve,reject)=>execute(executable,
      ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
      {windowsHide:true,timeout:30_000,maxBuffer:1024},error=>error?reject(error):resolve()));
    log(JSON.stringify({phase:'ci-certificate-backend-preparation',state:'ready',timeoutMs:30_000,
      elapsedMs:Math.round(performance.now()-started),coldStartValidated:false}));
  } catch(error) {
    // Never emit child stdout/stderr, command lines, key material or external errors.
    log(JSON.stringify({phase:'ci-certificate-backend-preparation',state:'failed',timeoutMs:30_000,
      elapsedMs:Math.round(performance.now()-started),
      code:Number.isInteger(error?.code)?error.code:
        ['ENOENT','EACCES','EPERM','ABORT_ERR','ERR_CHILD_PROCESS_STDIO_MAXBUFFER'].includes(error?.code)?error.code:'other',
      signal:['SIGTERM','SIGKILL'].includes(error?.signal)?error.signal:undefined,killed:error?.killed===true}));
    throw Error('Bounded CI certificate backend preparation failed; original checks have not run');
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
  await warmKnowledgeCertificateBackend();

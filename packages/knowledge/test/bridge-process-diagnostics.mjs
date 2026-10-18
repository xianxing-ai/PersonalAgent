import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {promisify} from 'node:util';

const certificatePhases = ['script_enter','rsa_ready','request_ready','certificate_ready','output_ready'];
const phasePrefix = 'PA_KNOWLEDGE_CERT_PHASE:';
// Exact observed production script only. Drift leaves the original command untouched.
const certificateScript = `$ErrorActionPreference='Stop';$rsa=[Security.Cryptography.RSACng]::new(2048);
try {$request=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=PersonalAgent local pairing',$rsa,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1);
$cert=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-1),[DateTimeOffset]::UtcNow.AddMinutes(16));
try {[Console]::WriteLine('{"pfx":"'+[Convert]::ToBase64String($cert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx,''))+'","cert":"'+[Convert]::ToBase64String($cert.RawData)+'"}')}
finally {$cert.Dispose()}} finally {$rsa.Dispose()}`;

export function certificateDiagnosticArguments(args) {
  const prefix = ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand'];
  if (!Array.isArray(args) || args.length !== 5 || prefix.some((value,index)=>args[index] !== value)
    || args[4] !== Buffer.from(certificateScript,'utf16le').toString('base64')) return undefined;
  const marker = phase => `\n[Console]::Error.WriteLine('${phasePrefix}${phase}');\n`;
  const script = certificateScript
    .replace("$ErrorActionPreference='Stop';", "$ErrorActionPreference='Stop';"+marker('script_enter'))
    .replace('$rsa=[Security.Cryptography.RSACng]::new(2048);', '$rsa=[Security.Cryptography.RSACng]::new(2048);'+marker('rsa_ready'))
    .replace('[Security.Cryptography.RSASignaturePadding]::Pkcs1);', '[Security.Cryptography.RSASignaturePadding]::Pkcs1);'+marker('request_ready'))
    .replace('[DateTimeOffset]::UtcNow.AddMinutes(16));', '[DateTimeOffset]::UtcNow.AddMinutes(16));'+marker('certificate_ready'))
    .replace('}\nfinally {$cert.Dispose()}', marker('output_ready')+'}\nfinally {$cert.Dispose()}');
  return [...prefix,Buffer.from(script,'utf16le').toString('base64')];
}

export function certificatePhaseTracker(elapsed) {
  let pending = '', lastPhase, phaseElapsedMs;
  return {
    observe(chunk) {
      const lines = (pending+chunk.toString()).split('\n');
      pending = lines.pop().slice(-128);
      for (const line of lines) {
        const phase = certificatePhases.find(value=>line.replace(/\r$/,'') === phasePrefix+value);
        const milliseconds = phase === undefined ? undefined : elapsed();
        if (phase !== undefined && Number.isFinite(milliseconds) && milliseconds >= 0) {
          lastPhase = phase; phaseElapsedMs = Math.round(milliseconds);
        }
      }
    },
    details: () => lastPhase === undefined ? {} : {lastPhase,phaseElapsedMs},
  };
}

/** Test-runner diagnostics: never copy commands, messages, stdout, stderr or key material. */
export function bridgeProcessDetails(error, elapsedMs, spawnMs, timeoutMs) {
  return {phase:'knowledge-test-powershell',elapsedMs,spawnMs,timeoutMs,
    code:Number.isInteger(error?.code) ? error.code :
      ['ENOENT','EACCES','EPERM','ABORT_ERR','ERR_CHILD_PROCESS_STDIO_MAXBUFFER'].includes(error?.code)
        ? error.code : error ? 'other' : 'ok',
    killed:error?.killed === true,
    signal:['SIGTERM','SIGKILL'].includes(error?.signal) ? error.signal : undefined};
}

const original = childProcess.execFile;
childProcess.execFile = function (...args) {
  if (typeof args[0] !== 'string' || !/powershell\.exe$/i.test(args[0])
    || !Array.isArray(args[1]) || !args[1].includes('-EncodedCommand')
    || typeof args.at(-1) !== 'function') return original(...args);
  const started = performance.now(), callback = args.at(-1);
  const instrumented = certificateDiagnosticArguments(args[1]);
  const phases = instrumented === undefined ? undefined : certificatePhaseTracker(()=>performance.now()-started);
  if (instrumented !== undefined) args[1] = instrumented;
  const timeoutMs = args[2] && typeof args[2] === 'object' && Number.isInteger(args[2].timeout)
    ? args[2].timeout : undefined;
  let spawned;
  args[args.length-1] = (error, stdout, stderr) => {
    console.error('KNOWLEDGE_PROCESS '+JSON.stringify({...bridgeProcessDetails(error,
      Math.round(performance.now()-started),spawned,timeoutMs),...phases?.details()}));
    callback(error,stdout,stderr);
  };
  const child = original(...args);
  child.once('spawn',()=>{spawned=Math.round(performance.now()-started);});
  if (phases !== undefined) child.stderr?.on('data',chunk=>phases.observe(chunk));
  return child;
};
// Preserve the native promisified return shape for other test consumers.
childProcess.execFile[promisify.custom] = original[promisify.custom];
syncBuiltinESMExports();

import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {promisify} from 'node:util';

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
  const timeoutMs = args[2] && typeof args[2] === 'object' && Number.isInteger(args[2].timeout)
    ? args[2].timeout : undefined;
  let spawned;
  args[args.length-1] = (error, stdout, stderr) => {
    console.error('KNOWLEDGE_PROCESS '+JSON.stringify(bridgeProcessDetails(error,
      Math.round(performance.now()-started),spawned,timeoutMs)));
    callback(error,stdout,stderr);
  };
  const child = original(...args);
  child.once('spawn',()=>{spawned=Math.round(performance.now()-started);});
  return child;
};
// Preserve the native promisified return shape for other test consumers.
childProcess.execFile[promisify.custom] = original[promisify.custom];
syncBuiltinESMExports();

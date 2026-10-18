import {spawn} from 'node:child_process';
import {mkdirSync, openSync, closeSync, unlinkSync, existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Development-only entry: credentials stay in the trusted Electron host.
const support = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(support, '../../../..');
const requestFile = process.argv[2];
if (!requestFile) throw Error('Provide an explicit public/synthetic request JSON, or --describe');
const cache = path.join(root, '.cache/agentarts-development');
mkdirSync(cache, {recursive:true});
const lock = path.join(cache, 'call.lock');
let fd;
try { fd = openSync(lock, 'wx'); }
catch { throw Error('A shared AgentArts call is active or needs reconciliation; do not retry automatically'); }
closeSync(fd);
const executable = path.join(root, 'node_modules/electron/dist/electron.exe');
const environment = Object.fromEntries(['SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE',
  'APPDATA','LOCALAPPDATA','HOMEDRIVE','HOMEPATH','USERNAME','COMSPEC','PROGRAMFILES',
  'PROGRAMFILES(X86)','PROGRAMDATA','PROCESSOR_ARCHITECTURE'].filter(name=>process.env[name]!==undefined)
  .map(name=>[name,process.env[name]]));
let spawned = false;
try {
  const child = spawn(executable, [path.join(support, 'saved-config-call-host.cjs'),
    requestFile === '--describe' ? requestFile : path.resolve(requestFile)], {
    cwd:root, env:environment, shell:false, windowsHide:true, stdio:['ignore','inherit','inherit'],
  });
  process.once('SIGINT', ()=>child.kill());
  process.once('SIGTERM', ()=>child.kill());
  process.exitCode = await new Promise((resolve,reject)=>{
    child.once('spawn',()=>{spawned=true;}); child.once('error',reject);
    child.once('exit',(code,signal)=>resolve(signal ? 1 : code ?? 1));
  });
} finally {
  // Abnormal termination, including host exit 3 for an unknown dispatched call,
  // preserves the lock. Only completed or proved pre-send outcomes release it.
  if ((!spawned || process.exitCode === 0 || process.exitCode === 2) && existsSync(lock)) unlinkSync(lock);
}

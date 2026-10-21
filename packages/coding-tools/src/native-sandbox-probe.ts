import {createHash, randomBytes} from 'node:crypto';
import {mkdir, symlink, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {basename, dirname, join, resolve} from 'node:path';
import type {SandboxExecutionResult, WindowsNativeSandboxExecutorOptions} from './native-sandbox.js';
import {createWindowsNativeSandboxExecutor} from './windows-native-sandbox.js';

export interface WindowsNativeSandboxProbeOptions {
  /** Explicit host-owned diagnostic cache, never a model-supplied or user document path. */
  readonly probeRootPath: string;
  readonly nodeExecutable: string;
  readonly systemRoot: string;
  readonly signal: AbortSignal;
}
export interface WindowsNativeSandboxCapabilities {
  readonly backend: 'windows-psec';
  readonly available: boolean;
  readonly enforced: boolean;
  readonly readOnly: boolean;
  readonly workspaceWrite: boolean;
  readonly networkDeny: boolean;
  readonly descendants: boolean;
  readonly reparse: boolean;
  readonly cancellation: boolean;
  readonly results: Readonly<Record<string, Pick<SandboxExecutionResult, 'backend' | 'enforced' | 'outcome' | 'exitCode' | 'stopped' | 'reason'>>>;
  readonly helperSha256: string;
}

/** Fixed benign real OS probe; export/API presence alone never sets availability. Uses only own synthetic files/listeners. */
export async function verifyWindowsNativeSandbox(
  helper: Omit<WindowsNativeSandboxExecutorOptions, 'assertCurrent'>,
  options: WindowsNativeSandboxProbeOptions,
): Promise<WindowsNativeSandboxCapabilities> {
  const failed = (): WindowsNativeSandboxCapabilities => ({backend: 'windows-psec', available: false, enforced: false,
    readOnly: false, workspaceWrite: false, networkDeny: false, descendants: false, reparse: false, cancellation: false,
    results: {}, helperSha256: helper.helperSha256});
  if (process.platform !== 'win32' || basename(options.nodeExecutable).toLowerCase() !== 'node.exe') return failed();
  const root = resolve(options.probeRootPath, `psec-${randomBytes(12).toString('hex')}`);
  const workspace = join(root, 'workspace'), outside = join(root, 'outside');
  let connections = 0;
  const servers = ['127.0.0.1', '::1'].map(() => createServer(socket => {
    connections++; socket.on('error', () => {}); socket.end('synthetic');
  }));
  try {
    await mkdir(workspace, {recursive: true}); await mkdir(outside);
    await writeFile(join(workspace, 'read.txt'), 'synthetic-inside');
    await writeFile(join(outside, 'read.txt'), 'synthetic-outside');
    await symlink(outside, join(workspace, 'escape'), 'junction');
    const endpoints: {host: string; port: number}[] = [];
    for (let i = 0; i < servers.length; i++) {
      const server = servers[i]!; const host = i === 0 ? '127.0.0.1' : '::1';
      await new Promise<void>((yes, no) => {server.once('error', no); server.listen(0, host, yes);});
      const address = server.address(); if (!address || typeof address === 'string') return failed();
      endpoints.push({host, port: address.port});
    }
    // Fixed program checks OS behavior; no model command, real user file, external host or credential.
    const program = `
const fs=require('node:fs'),net=require('node:net'),cp=require('node:child_process');
const w=${JSON.stringify(workspace)},o=${JSON.stringify(outside)},endpoints=${JSON.stringify(endpoints)};
const mode=process.argv[2],depth=Number(process.argv[3]||0);const full=mode==='full-access',write=mode==='workspace-write'||full;
let step=0;function check(ok){step++;if(!ok)throw Error('probe-assertion-'+step);}
function permitted(fn){try{fn();return true;}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e;return false;}}
(async()=>{check(fs.readFileSync(w+'/read.txt','utf8')==='synthetic-inside');
check(permitted(()=>fs.readFileSync(o+'/read.txt'))===full);
check(permitted(()=>fs.writeFileSync(w+'/write-'+depth,'synthetic'))===write);
check(permitted(()=>fs.writeFileSync(o+'/write-'+mode+'-'+depth,'synthetic'))===full);
check(permitted(()=>fs.readFileSync(w+'/escape/read.txt'))===full);
check(permitted(()=>fs.writeFileSync(w+'/escape/escape-'+mode+'-'+depth,'synthetic'))===full);
for(const endpoint of endpoints){const allowed=await new Promise((yes,no)=>{const c=net.connect(endpoint);c.once('connect',()=>{c.destroy();yes(true)});c.once('error',e=>{if(!['EPERM','EACCES'].includes(e.code))no(e);else yes(false)});c.setTimeout(1500,()=>{c.destroy();no(Error('network-timeout'))})});check(allowed===full)}
if(depth<2){const child=cp.spawnSync(process.execPath,['--preserve-symlinks','--preserve-symlinks-main',__filename,mode,String(depth+1)],{encoding:'utf8',env:process.env,windowsHide:true});if(child.status!==0)console.error('probe-child-'+depth+':'+child.status);check(child.status===0)}
})().catch(e=>{console.error('probe-failed:'+depth+':'+step+':'+(e.code||e.message));process.exitCode=23});
`;
    // Fixed recursion through this source file. No model program is evaluated.
    const script = join(workspace, 'probe.cjs');
    await writeFile(script, program);
    const executor = createWindowsNativeSandboxExecutor({...helper, assertCurrent: () => {
      if (options.signal.aborted) throw Error('cancelled-probe');
    }});
    const results: Record<string, SandboxExecutionResult> = {};
    const run = async (mode: 'read-only' | 'workspace-write' | 'full-access', argv: string[], signal = options.signal): Promise<SandboxExecutionResult> => {
      const binding = {sandboxRef: 'native-diagnostic', revision: 1, taskId: 'native-diagnostic', runId: randomBytes(12).toString('hex'),
        authorizationRef: 'host-owned-synthetic-probe', argumentsDigest: createHash('sha256').update(JSON.stringify(argv)).digest('hex')};
      return executor.execute({...binding, profile: {...binding, mode, backend: mode === 'full-access' ? 'none' : 'windows-psec',
        readRoots: [dirname(options.nodeExecutable), options.systemRoot, ...(mode === 'workspace-write' ? [] : [workspace])],
        writeRoots: mode === 'workspace-write' ? [workspace] : [], executableAllowlist: [options.nodeExecutable],
        network: {mode: mode === 'full-access' ? 'unrestricted' : 'deny'}}, executable: options.nodeExecutable, argv,
        env: {SystemRoot: options.systemRoot, LOCALAPPDATA: workspace}, cwd: workspace, deadline: new Date(Date.now()+15000).toISOString(),
        signal, maxOutputBytes: 16384});
    };
    const passed = (result: SandboxExecutionResult): boolean => result.outcome === 'exited' && result.exitCode === 0 && result.stopped;
    const scriptArgs = ['--preserve-symlinks','--preserve-symlinks-main',script];
    results.baseline = await run('full-access', [...scriptArgs, 'full-access', '0']);
    const baselineConnections = connections;
    results.readOnly = await run('read-only', [...scriptArgs, 'read-only', '0']);
    results.workspaceWrite = await run('workspace-write', [...scriptArgs, 'workspace-write', '0']);
    const noConnections = connections === baselineConnections;
    const abort = new AbortController();
    const pending = run('workspace-write', ['-e', "require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});setInterval(()=>{},1000)"], abort.signal);
    const timer = setTimeout(() => abort.abort(), 300);
    results.cancel = await pending; clearTimeout(timer);
    const readOnly = passed(results.readOnly) && results.readOnly.enforced;
    const workspaceWrite = passed(results.workspaceWrite) && results.workspaceWrite.enforced;
    const networkDeny = passed(results.baseline) && baselineConnections === 6 && noConnections && readOnly && workspaceWrite;
    const cancellation = results.cancel.outcome === 'cancelled' && results.cancel.executionStarted && results.cancel.stopped;
    const available = readOnly && workspaceWrite && networkDeny && cancellation;
    return {backend: 'windows-psec', available, enforced: available, readOnly, workspaceWrite, networkDeny,
      descendants: readOnly && workspaceWrite, reparse: readOnly && workspaceWrite, cancellation,
      helperSha256: helper.helperSha256, results: Object.fromEntries(Object.entries(results).map(([key, value]) => [key, {
        backend: value.backend, enforced: value.enforced, outcome: value.outcome, exitCode: value.exitCode, stopped: value.stopped,
        ...(value.reason ? {reason: value.reason} : value.stderr ? {reason:
          value.stderr.match(/probe-failed:\d+:\d+:[A-Za-z0-9_-]+/u)?.[0] ?? 'restricted-probe-command-failed'} : {}),
      }]))};
  } catch { return failed(); }
  finally { for (const server of servers) server.close(); }
}

import { spawn } from 'node:child_process';
import { ProtocolError } from '@personal-agent/contracts';
import type { GitHubReadContext } from './provider.js';
import { checkContext } from './service.js';

export interface GhCommand { readonly args: readonly string[]; readonly token: string; readonly stdin?: string; readonly maxBytes: number; readonly context: GitHubReadContext }
export interface GhCommandResult { exitCode: number; stdout: string; stderr: string }
/** Trusted composition injects this port; adapters never accept a shell command. */
export interface GhCommandRunner { run(command: GhCommand): Promise<GhCommandResult>; dispose?(): void }
export class SpawnGhCommandRunner implements GhCommandRunner {
  private readonly active = new Set<ReturnType<typeof spawn>>();
  private disposed = false;
  constructor(private readonly executable = 'gh', private readonly environment: Readonly<Record<string, string>> = {}) {}
  run(command: GhCommand): Promise<GhCommandResult> {
    checkContext(command.context);
    if (this.disposed) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'GitHub runner disposed');
    return new Promise((resolve, reject) => {
      // Never inherit GH_TOKEN/GH_HOST/GH_CONFIG_DIR or invoke a shell. PATH must
      // be explicitly supplied by the trusted host if executable is not absolute.
      const env = {...this.environment, GH_TOKEN: command.token, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat', NO_COLOR: '1'};
      const child = spawn(this.executable, [...command.args], {shell: false, windowsHide: true, env, stdio: ['pipe', 'pipe', 'pipe']});
      this.active.add(child);
      let bytes = 0;
      const out: Buffer[] = [], err: Buffer[] = [];
      let terminalError: ProtocolError | undefined;
      const stop = (code: string, message: string) => { terminalError ??= new ProtocolError(code, message); child.kill('SIGKILL'); };
      const cancel = () => stop('CANCELLED', 'GitHub request cancelled');
      command.context.signal.addEventListener('abort', cancel, {once: true});
      const timer = setTimeout(() => stop('TIMEOUT', 'GitHub request deadline expired'), Math.min(2147483647, Date.parse(command.context.deadline) - Date.now()));
      const collect = (target: Buffer[], chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > command.maxBytes) stop('EXTERNAL_FAILURE', 'GitHub response exceeded byte limit');
        else target.push(chunk);
      };
      child.stdout.on('data', (chunk: Buffer) => collect(out, chunk));
      child.stderr.on('data', (chunk: Buffer) => collect(err, chunk));
      const cleanup = () => { clearTimeout(timer); command.context.signal.removeEventListener('abort', cancel); this.active.delete(child); };
      child.on('error', () => { cleanup(); reject(new ProtocolError('EXTERNAL_FAILURE', 'GitHub CLI could not be started')); });
      child.on('close', code => {
        cleanup();
        if (terminalError) { reject(terminalError); return; }
        try {
          const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
          resolve({exitCode: code ?? -1, stdout: decoder.decode(Buffer.concat(out)), stderr: decoder.decode(Buffer.concat(err))});
        } catch {
          reject(new ProtocolError('EXTERNAL_FAILURE', 'GitHub CLI output encoding invalid'));
        }
      });
      child.stdin.on('error', () => { /* EPIPE is reported by process exit. */ });
      child.stdin.end(command.stdin ?? '');
      if (command.context.signal.aborted) cancel();
    });
  }
  dispose(): void { this.disposed = true; for (const child of this.active) child.kill('SIGKILL'); }
}

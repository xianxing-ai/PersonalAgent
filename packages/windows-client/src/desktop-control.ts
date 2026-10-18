import {execFile} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {isAbsolute, join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {DEFAULT_INHERITED_ENV_VARS, StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {ProtocolError, validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool, ToolContext, ToolHost} from '@personal-agent/contracts';

export const WINDOWS_DESKTOP_UPSTREAM = Object.freeze({
  repository: 'https://github.com/CursorTouch/Windows-MCP', version: '0.8.8',
  commit: 'b74c507d9e709223a0904cf08019edf55f2a75bb', license: 'MIT',
  wheelSha256: '597ef720e1902ba76510a4d2b946949f8a48f281dd210c183de5ded60ea3b873',
});
export const WINDOWS_DESKTOP_TOOL_VERSION = '1.0.0';
export const WINDOWS_DESKTOP_SCOPE = 'computer:desktop:control';
const REMOTE_TOOLS = ['Snapshot', 'Click', 'Type', 'Scroll', 'Move', 'Shortcut'] as const;
const PREFIX = 'computer.desktop.';
type CallContext = Pick<ToolContext, 'signal' | 'deadline'>;
type Schema = Record<string, unknown>;
const targetRef = {type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
const loc = {type: 'array', items: {type: 'integer', minimum: -32768, maximum: 32767}, minItems: 2, maxItems: 2};
const point = {loc};
const object = (properties: Schema, required: string[] = []): Schema => ({type: 'object', properties, required, additionalProperties: false});
const specs = [
  {name: 'observe', remote: 'Snapshot', schema: object({}), read: true},
  {name: 'click', remote: 'Click', schema: object({targetRef, ...point, button: {enum: ['left', 'right', 'middle']}, clicks: {type: 'integer', minimum: 1, maximum: 2}}, ['targetRef', 'loc']), read: false},
  {name: 'type', remote: 'Type', schema: object({targetRef, ...point, text: {type: 'string', maxLength: 4096}, clear: {type: 'boolean'}, caret_position: {enum: ['start', 'idle', 'end']}, press_enter: {type: 'boolean'}}, ['targetRef', 'text', 'loc']), read: false},
  {name: 'scroll', remote: 'Scroll', schema: object({targetRef, ...point, type: {enum: ['vertical', 'horizontal']}, direction: {enum: ['up', 'down', 'left', 'right']}, wheel_times: {type: 'integer', minimum: 1, maximum: 20}}, ['targetRef', 'loc']), read: false},
  {name: 'move', remote: 'Move', schema: object({targetRef, ...point, drag: {type: 'boolean'}, from_loc: loc, duration: {type: 'number', minimum: 0, maximum: 3}}, ['targetRef', 'loc']), read: false},
  {name: 'shortcut', remote: 'Shortcut', schema: object({targetRef, shortcut: {type: 'string', minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9+ _-]+$'}}, ['targetRef', 'shortcut']), read: false},
] as const;
const outputSchema = object({source: {enum: ['windows-mcp', 'synthetic']}, upstreamVersion: {const: '0.8.8'},
  state: {enum: ['observed', 'action_observed']}, targetRef, observedAt: {type: 'string'}, expiresAt: {type: 'string'},
  observation: {type: 'string', maxLength: 131072}, observationDigest: {type: 'string', pattern: '^[a-f0-9]{64}$'},
  action: {enum: REMOTE_TOOLS}, goalVerified: {const: false}},
['source', 'upstreamVersion', 'state', 'targetRef', 'observedAt', 'expiresAt', 'observation', 'observationDigest', 'goalVerified']);

export interface DesktopControlAttempt {
  taskId: string; runId: string; toolName: string; toolVersion: string;
  authorizationRef: string; argumentsDigest: string; targetRef: string;
  observationDigest: string;
}
/** Implement with the existing Runtime create-only checkpoint. A duplicate must reject,
 * including after restart; this provider never owns task state or replays a write. */
export interface DesktopControlAttempts {
  record(identity: DesktopControlAttempt, execution: CallContext & {arguments: Record<string, unknown>}): Promise<void>;
}
/** Narrow transport seam for explicit synthetic contract checks, never a fallback. */
export interface DesktopControlBackend {
  readonly source: 'windows-mcp' | 'synthetic';
  isReady?(): boolean;
  start(context: CallContext): Promise<void>;
  call(name: string, args: Record<string, unknown>, context: CallContext): Promise<unknown>;
  close(): Promise<void>;
}
export interface WindowsDesktopControlOptions {
  /** Absolute Python executable in an independently installed, pinned Windows-MCP venv. */
  pythonExecutable?: string;
  attempts?: DesktopControlAttempts;
  /** Derived by the trusted local host from a real task-bound user gesture, never model input. */
  authorizePresence?(context: {taskId: string; targetRef?: string; signal: AbortSignal; deadline: string}): Promise<boolean>;
  /** Optional stronger OS identity fence; absent means only an upstream observation fence. */
  verifyTarget?(input: {taskId: string; targetRef: string; focusedWindowHandle: string; toolName: string; arguments: Record<string, unknown>; signal: AbortSignal; deadline: string}): Promise<boolean>;
  /** Explicit synthetic injection. Its results stay source=synthetic. */
  backend?: DesktopControlBackend;
  now?: () => number;
}
function fail(code: string, message: string): never {throw new ProtocolError(code, message);}
const canonical = (value: unknown): string => value !== null && typeof value === 'object'
  ? Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  : JSON.stringify(value);
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
function active(context: CallContext, now = Date.now): void {
  if (context.signal.aborted) fail('CANCELLED', 'Desktop control was cancelled');
  if (!Number.isFinite(Date.parse(context.deadline)) || now() >= Date.parse(context.deadline)) fail('TIMEOUT', 'Desktop control deadline expired');
}
function textResult(raw: unknown): string {
  const result = CallToolResultSchema.parse(raw);
  if (result.isError || result.content.length !== 1 || result.content[0]?.type !== 'text') fail('EXTERNAL_FAILURE', 'Desktop provider returned an unsupported result');
  const text = result.content[0].text;
  // Upstream Snapshot returns these failures as ordinary text without isError.
  if (!text.trim() || Buffer.byteLength(text, 'utf8') > 131072 || /(?:^|\n)\s*(?:Error\b|Traceback\b|Exception\b)/i.test(text)) fail('EXTERNAL_FAILURE', 'Desktop provider did not return a valid observation');
  return text;
}
function parseObservation(raw: unknown): {text: string; handle: string; fence: string} {
  const encoded = textResult(raw);
  // Pinned Snapshot returns list[str]; FastMCP serializes it to one JSON text block.
  let value: unknown;
  try {value = JSON.parse(encoded);} catch {fail('EXTERNAL_FAILURE', 'Desktop snapshot serialization is incompatible');}
  if (!Array.isArray(value) || value.length !== 1 || typeof value[0] !== 'string') fail('EXTERNAL_FAILURE', 'Desktop snapshot serialization is incompatible');
  const text = value[0] as string;
  if (!text.trim() || /(?:^|\n)\s*(?:Error\b|Traceback\b|Exception\b)/i.test(text)) fail('EXTERNAL_FAILURE', 'Desktop snapshot capture failed');
  const focus = /(?:^|\n)[ \t]*Focused Window:[ \t]*\n([\s\S]*?)\n[ \t]*Opened Windows:/.exec(text)?.[1]?.trim();
  const tree = /(?:^|\n)[ \t]*UI Tree:[ \t]*\n([\s\S]*)$/.exec(text)?.[1]?.trim();
  // Upstream semantic metadata may include both [password] and a value. Never
  // attempt partial redaction of that untrusted representation or export it.
  if (tree && /\[password\]/i.test(tree)) fail('UNAUTHORIZED', 'Desktop observation contains a protected input');
  const rows = focus?.split('\n').map(line => line.trim()).filter(Boolean);
  if (!rows || rows.length !== 3 || !/^Name\s+Depth\s+Status\s+Width\s+Height\s+Handle$/.test(rows[0]!) || !tree) fail('EXTERNAL_FAILURE', 'Desktop observation has no unique focused window');
  const fields = /\s+(\d+)\s+(?:Normal|Maximized|Minimized|Hidden)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(rows[2]!);
  if (!fields || fields[4] === '0') fail('EXTERNAL_FAILURE', 'Desktop observation has no focused window identity');
  if (/\b(?:powershell|terminal|command prompt|registry editor|windows security|user account control|credential|password|run|log[ -]?in|sign[ -]?in|administrator)\b|命令提示符|注册表|Windows\s*安全|用户账户控制|凭据|密码|登录|登陆|管理员|运行\s+\d/i.test(rows[2]!)) fail('UNAUTHORIZED', 'Desktop control of a protected or command window is unavailable');
  return {text, handle: fields[4]!, fence: digest(`${focus}\n${tree}`)};
}

/** Uses the upstream engine through MCP; no input implementation, Agent loop or shell. */
function createPinnedBackend(pythonExecutable: string): DesktopControlBackend {
  let client: Client | undefined, transport: StdioClientTransport | undefined, directory: string | undefined;
  let releaseFailed = false;
  let schemas = new Map<string, Schema>();
  let session = new AbortController();
  const environment = Object.fromEntries(DEFAULT_INHERITED_ENV_VARS.map(key => [key, '']));
  Object.assign(environment, {SYSTEMROOT: process.env.SystemRoot ?? 'C:/Windows', ANONYMIZED_TELEMETRY: 'false', POSTHOG_API_KEY: '', PYTHONUTF8: '1'});
  return {
    source: 'windows-mcp',
    isReady: () => !!client && !session.signal.aborted,
    async start(context) {
      active(context);
      if (releaseFailed) fail('EXTERNAL_FAILURE', 'Previous Windows desktop process release is unconfirmed');
      if (process.platform !== 'win32' || !isAbsolute(pythonExecutable)) fail('UNSUPPORTED_CAPABILITY', 'Windows desktop provider is unavailable');
      const executable = await realpath(pythonExecutable);
      const version = await new Promise<string>((resolve, reject) => execFile(executable,
        ['-I', '-c', "import importlib.metadata; print(importlib.metadata.version('windows-mcp'))"],
        {windowsHide: true, env: environment, signal: context.signal, timeout: Math.min(10000, Date.parse(context.deadline) - Date.now()), maxBuffer: 1024},
        (error, stdout) => error ? reject(error) : resolve(stdout.trim())));
      active(context);
      if (version !== WINDOWS_DESKTOP_UPSTREAM.version) fail('PROTOCOL_MISMATCH', 'Windows desktop package version is incompatible');
      directory = await mkdtemp(join(tmpdir(), 'personal-agent-windows-mcp-'));
      const config = join(directory, 'config.toml');
      await writeFile(config, '# Host-owned empty config. CLI and environment define all enabled capabilities.\n', {mode: 0o600, flag: 'wx'});
      active(context);
      session = new AbortController();
      transport = new StdioClientTransport({command: executable,
        args: ['-I', '-m', 'windows_mcp', 'serve', '--config', config, '--transport', 'stdio', '--tools', REMOTE_TOOLS.join(',')],
        cwd: directory, env: environment, stderr: 'pipe', maxBufferSize: 1024 * 1024});
      transport.stderr?.on('data', () => {});
      client = new Client({name: 'personal-agent-windows-desktop', version: '1.0.0'}, {capabilities: {}});
      client.onclose = () => session.abort(); client.onerror = () => session.abort();
      const signal = AbortSignal.any([context.signal, session.signal]);
      await client.connect(transport, {signal, timeout: Math.min(30000, Date.parse(context.deadline) - Date.now())});
      if (client.getServerVersion()?.name !== 'windows-mcp') fail('PROTOCOL_MISMATCH', 'Windows desktop service identity is incompatible');
      const listed = await client.listTools(undefined, {signal, timeout: Math.max(1, Date.parse(context.deadline) - Date.now())});
      if (listed.nextCursor || listed.tools.some(tool => ![...REMOTE_TOOLS, 'ControlStatus'].includes(tool.name as typeof REMOTE_TOOLS[number]))) fail('PROTOCOL_MISMATCH', 'Windows desktop service directory is outside the pinned UI surface');
      schemas = new Map(listed.tools.map(tool => [tool.name, structuredClone(tool.inputSchema)]));
      for (const name of REMOTE_TOOLS) if (!schemas.has(name) || listed.tools.filter(tool => tool.name === name).length !== 1) fail('PROTOCOL_MISMATCH', 'Windows desktop service directory is incomplete');
    },
    async call(name, args, context) {
      active(context);
      if (!client || session.signal.aborted || !schemas.has(name)) fail('UNSUPPORTED_CAPABILITY', 'Windows desktop provider is disconnected');
      validateToolValue(schemas.get(name)!, args);
      return client.callTool({name, arguments: args}, CallToolResultSchema,
        {signal: AbortSignal.any([context.signal, session.signal]), timeout: Math.max(1, Date.parse(context.deadline) - Date.now())});
    },
    async close() {
      session.abort();
      const previous = client, previousTransport = transport; client = undefined; transport = undefined; schemas.clear();
      // This fixed service owns input hooks; wait for SDK process release before reuse.
      const pid = previousTransport?.pid;
      let stopError: unknown;
      if (process.platform === 'win32' && pid) {
        try {
          await new Promise<void>((resolve, reject) => execFile(join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'taskkill.exe'),
            ['/PID', String(pid), '/T', '/F'], {windowsHide: true, timeout: 5000}, error => error ? reject(error) : resolve()));
        } catch (error) {releaseFailed = true; stopError = error;}
      }
      try {await previous?.close();} catch (error) {releaseFailed = true; stopError = error;}
      if (directory) {const owned = directory; directory = undefined; await rm(owned, {recursive: true, force: true});}
      if (stopError) fail('EXTERNAL_FAILURE', 'Windows desktop process release is unconfirmed');
    },
  };
}

export function createWindowsDesktopControlHost(options: WindowsDesktopControlOptions = {}) {
  const now = options.now ?? Date.now;
  const backend = options.backend ?? (process.platform === 'win32' && options.pythonExecutable ? createPinnedBackend(options.pythonExecutable) : undefined);
  const configured = !!backend && !!options.attempts && typeof options.authorizePresence === 'function';
  let state: 'unavailable' | 'disconnected' | 'connecting' | 'ready' | 'error' | 'blocked' | 'disposed' = configured ? 'disconnected' : 'unavailable';
  let generation = 0;
  const lifecycle = new AbortController();
  let busy = false;
  const targets = new Map<string, {taskId: string; handle: string; fence: string; expiresAt: number}>();
  const registrations = new Set<() => void>();
  function available() {return state === 'ready' && (backend?.isReady?.() ?? true);}
  function ready(context: CallContext) {active(context, now); if (!available()) fail('UNSUPPORTED_CAPABILITY', 'Windows desktop control is unavailable');}
  async function present(context: ToolContext, reference?: string) {
    ready(context);
    if (!context.authorizationRef || !context.scopes.includes(WINDOWS_DESKTOP_SCOPE)
      || await options.authorizePresence!({taskId: context.taskId, signal: context.signal, deadline: context.deadline, ...(reference ? {targetRef: reference} : {})}) !== true) fail('UNAUTHORIZED', 'Desktop control requires current local presence');
    ready(context);
  }
  const tools: readonly RegisteredTool[] = specs.map(spec => ({descriptor: {
    name: PREFIX + spec.name, version: WINDOWS_DESKTOP_TOOL_VERSION, inputSchema: spec.schema, outputSchema,
    sideEffect: spec.read ? 'read' : 'external_write', requiredScopes: [WINDOWS_DESKTOP_SCOPE],
    idempotencySupport: false, recoverySupport: false, requiresPresence: true,
  }, async execute(raw, context) {
    validateToolValue(spec.schema, raw);
    const input = raw as Record<string, unknown>;
    await present(context, typeof input.targetRef === 'string' ? input.targetRef : undefined);
    if (busy) fail('REVISION_CONFLICT', 'Desktop input is already in progress');
    busy = true;
    let dispatched = false;
    try {
      const snapshot = parseObservation(await backend!.call('Snapshot', {use_vision: false, use_dom: false}, context));
      ready(context);
      let reference: string;
      let expiresAt: number;
      if (spec.read) {
        for (const [key, target] of targets) if (target.expiresAt <= now() || target.taskId === context.taskId) targets.delete(key);
        if (targets.size >= 64) fail('REVISION_CONFLICT', 'Desktop observation capacity is exhausted');
        reference = randomUUID(); expiresAt = Math.min(now() + 30000, Date.parse(context.deadline));
        targets.set(reference, {taskId: context.taskId, handle: snapshot.handle, fence: snapshot.fence, expiresAt});
      } else {
        reference = input.targetRef as string;
        const target = targets.get(reference);
        if (!target || target.taskId !== context.taskId || target.expiresAt <= now() || target.handle !== snapshot.handle || target.fence !== snapshot.fence) fail('UNAUTHORIZED', 'Desktop target changed; a fresh observation is required');
        expiresAt = target.expiresAt;
        const args = {...input}; delete args.targetRef;
        if (spec.remote === 'Shortcut' && /(?:win(?:dows)?|super|meta|ctrl\+alt\+(?:delete|del)|ctrl\+shift\+(?:escape|esc))/i.test(String(args.shortcut))) fail('UNAUTHORIZED', 'System launcher and security shortcuts are unavailable');
        if (!context.argumentsDigest || context.argumentsDigest !== digest(canonical(input))) fail('UNAUTHORIZED', 'Desktop arguments are not bound to this authorization');
        if (options.verifyTarget && await options.verifyTarget({taskId: context.taskId, targetRef: reference, focusedWindowHandle: target.handle,
          toolName: PREFIX + spec.name, arguments: structuredClone(input), signal: context.signal, deadline: context.deadline}) !== true) fail('UNAUTHORIZED', 'Desktop target identity is no longer valid');
        await present(context, reference);
        await options.attempts!.record({taskId: context.taskId, runId: context.runId, toolName: PREFIX + spec.name,
          toolVersion: WINDOWS_DESKTOP_TOOL_VERSION, authorizationRef: context.authorizationRef,
          argumentsDigest: context.argumentsDigest, targetRef: reference, observationDigest: target.fence},
          {arguments: structuredClone(input), signal: context.signal, deadline: context.deadline});
        ready(context);
        // An observation is single-use even when dispatch/result becomes unknown.
        targets.delete(reference); dispatched = true;
        textResult(await backend!.call(spec.remote, args, context));
        const after = parseObservation(await backend!.call('Snapshot', {use_vision: false, use_dom: false}, context));
        ready(context);
        if (after.handle !== target.handle) fail('RESULT_UNKNOWN', 'Desktop focus changed after the action; reconcile the original run');
        return {source: backend!.source, upstreamVersion: '0.8.8', state: 'action_observed', action: spec.remote,
          targetRef: reference, observedAt: new Date(now()).toISOString(), expiresAt: new Date(expiresAt).toISOString(),
          observation: after.text, observationDigest: after.fence, goalVerified: false};
      }
      return {source: backend!.source, upstreamVersion: '0.8.8', state: 'observed', targetRef: reference,
        observedAt: new Date(now()).toISOString(), expiresAt: new Date(expiresAt).toISOString(),
        observation: snapshot.text, observationDigest: snapshot.fence, goalVerified: false};
    } catch (error) {
      if (dispatched) {
        state = 'blocked'; targets.clear();
        fail('RESULT_UNKNOWN', 'Desktop action has no confirmed observation; the provider is blocked pending original-run reconciliation');
      }
      active(context, now);
      if (error instanceof ProtocolError) throw error;
      fail('EXTERNAL_FAILURE', 'Desktop provider did not return a confirmed observation');
    } finally {busy = false;}
  }}));
  return {
    get tools(): readonly RegisteredTool[] {return available() ? tools : [];},
    health: () => ({state: state === 'ready' && !available() ? 'error' : state, configured, source: backend?.source ?? 'unavailable', upstream: WINDOWS_DESKTOP_UPSTREAM,
      targetIdentity: options.verifyTarget ? 'host_guard' : 'upstream_observation_only', recoverySupport: false as const}),
    async start(context: CallContext) {
      context = {...context, signal: AbortSignal.any([context.signal, lifecycle.signal])};
      active(context, now);
      if (!configured || state === 'disposed' || state === 'blocked') fail('UNSUPPORTED_CAPABILITY', 'Windows desktop control is unconfigured, blocked or unavailable on this platform');
      if (state === 'ready') return;
      if (state === 'connecting' || busy) fail('REVISION_CONFLICT', 'Windows desktop control is busy');
      const epoch = ++generation; state = 'connecting';
      try {
        await backend!.start(context); active(context, now);
        if (generation !== epoch) fail('CANCELLED', 'Windows desktop startup was superseded');
        state = 'ready';
      }
      catch (error) {
        if (generation === epoch) state = 'error';
        await backend!.close().catch(() => {}); active(context, now);
        if (error instanceof ProtocolError) throw error;
        fail('EXTERNAL_FAILURE', 'Pinned Windows desktop provider could not be started');
      }
    },
    register(host: ToolHost) {
      if (state !== 'ready') fail('UNSUPPORTED_CAPABILITY', 'Windows desktop control is unavailable');
      const releases: (() => void)[] = [];
      try {for (const tool of tools) releases.push(host.register(tool));}
      catch (error) {for (const release of releases.reverse()) release(); throw error;}
      const release = () => {registrations.delete(release); for (const remove of releases.splice(0).reverse()) remove();};
      registrations.add(release); return release;
    },
    block() {++generation; state = 'blocked'; targets.clear(); lifecycle.abort();},
    async dispose() {++generation; state = 'disposed'; targets.clear(); lifecycle.abort(); for (const release of [...registrations]) release(); await backend?.close();},
  };
}

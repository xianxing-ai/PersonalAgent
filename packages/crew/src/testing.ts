import {PassThrough} from 'node:stream';
import {CrewError} from './errors.js';
import {CrewSessionEventBus, type CrewDriver, type CrewDriverEvent, type CrewDriverProcess, type CrewDriverProbe, type CrewDriverSession, type CrewDriverStartInput, type CrewDriverUnsubscribe, type CrewSpawn} from './driver.js';
import type {CrewConsentProvider} from './consent.js';
import type {CrewDriverId} from './store.js';

/**
 * @internal 测试专用导出（`@personal-agent/crew/testing`）。
 *
 * 这里的实现都是假的：它们模拟驱动契约与 codex app-server 协议，供单元测试
 * 使用，不代表任何真实 CLI 已经连通。生产代码禁止从本入口导入——生产注册表
 * （`CrewDriverRuntime.open` 默认注册表）也从不包含这些实现，不存在被生产
 * 路径当作真实能力的路径。
 */

// ── FakeDriver：脚本化驱动（不 spawn 任何进程） ─────────────────────────

export interface FakeDriverOptions {
  /** 测试中可顶替任意驱动 id（默认 'codex'）。 */
  readonly driverId?: CrewDriverId;
  /** 提供时 start 前强制同意检查（与真实驱动同契约）；不提供则跳过同意检查。 */
  readonly consent?: CrewConsentProvider;
  /** probe 可用性（默认 available）。 */
  readonly available?: boolean;
  readonly unavailableReason?: string;
  /** start 时抛出的错误（模拟未登录等）；设置后 start 一律拒绝。 */
  readonly startFailure?: unknown;
  /** start 是否记录输入（默认记录）。 */
}

/** 一次会话的假实现：不自动完成，由测试显式推进（complete/fail/exit）。 */
export class FakeDriverSession implements CrewDriverSession {
  readonly sessionId: string;
  readonly agentId: string;
  readonly driver: CrewDriverId;
  readonly prompts: string[] = [];
  readonly interrupts: string[] = [];
  closed = false;

  private readonly events = new CrewSessionEventBus();

  constructor(input: {sessionId: string; agentId: string; driver: CrewDriverId}) {
    this.sessionId = input.sessionId;
    this.agentId = input.agentId;
    this.driver = input.driver;
  }

  send(text: string): Promise<void> {
    this.prompts.push(text);
    return Promise.resolve();
  }

  async interrupt(reason: string): Promise<void> {
    this.interrupts.push(reason);
    this.emit({type: 'interrupted', sessionId: this.sessionId, agentId: this.agentId, driver: this.driver, reason});
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.emit({type: 'exited', sessionId: this.sessionId, agentId: this.agentId, driver: this.driver, exitCode: 0, signal: null});
  }

  onEvent(listener: (event: CrewDriverEvent) => void): CrewDriverUnsubscribe {
    return this.events.subscribe(listener);
  }

  /** 会话就绪（FakeDriver.start 内部调用）。 */
  emitStarted(): void {
    this.emit({type: 'started', sessionId: this.sessionId, agentId: this.agentId, driver: this.driver});
  }

  /** 测试手动推进：模拟 CLI 输出一段文本。 */
  emitOutput(text: string): void {
    this.emit({type: 'output', sessionId: this.sessionId, agentId: this.agentId, driver: this.driver, text});
  }

  /** 测试手动结算：当前 prompt 完成。 */
  complete(result: string): void {
    this.emit({type: 'completed', sessionId: this.sessionId, agentId: this.agentId, driver: this.driver, result});
  }

  /** 测试手动结算：当前 prompt 失败。 */
  fail(message: string): void {
    this.emit({type: 'failed', sessionId: this.sessionId, agentId: this.agentId, driver: this.driver, message});
  }

  /** 测试手动结算：进程直接退出（未完成任务）。 */
  exit(exitCode: number | null, error?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.emit({type: 'exited', sessionId: this.sessionId, agentId: this.agentId, driver: this.driver, exitCode, signal: null, ...(error === undefined ? {} : {error})});
  }

  private emit(event: CrewDriverEvent): void {
    this.events.emit(event);
  }
}

/** 脚本化假驱动：start 记录输入、send 记录 prompt，测试显式控制事件。 */
export class FakeDriver implements CrewDriver {
  readonly driverId: CrewDriverId;
  readonly startInputs: CrewDriverStartInput[] = [];
  readonly sessions: FakeDriverSession[] = [];
  probeCalls = 0;

  private readonly options: FakeDriverOptions;
  private sessionCounter = 0;

  constructor(options: FakeDriverOptions = {}) {
    this.options = options;
    this.driverId = options.driverId ?? 'codex';
  }

  async probe(): Promise<CrewDriverProbe> {
    this.probeCalls += 1;
    if (this.options.available === false) {
      return {status: 'unavailable', reason: this.options.unavailableReason ?? '假驱动配置为不可用'};
    }
    return {status: 'available'};
  }

  async start(input: CrewDriverStartInput): Promise<CrewDriverSession> {
    this.startInputs.push(input);
    if (this.options.consent) this.options.consent.requireGranted(this.driverId);
    if (this.options.startFailure !== undefined) throw this.options.startFailure;
    if (this.options.available === false) {
      throw new CrewError('DRIVER_UNAVAILABLE', `驱动 ${this.driverId} 在本机不可用：${this.options.unavailableReason ?? '假驱动配置为不可用'}`);
    }
    const session = new FakeDriverSession({sessionId: `fake-session-${++this.sessionCounter}`, agentId: input.agentId, driver: this.driverId});
    this.sessions.push(session);
    session.emitStarted();
    return session;
  }
}

// ── FakeCodexAppServer：协议级假 codex app-server 子进程 ─────────────────

export interface FakeCodexAppServerOptions {
  /** loginStatus 返回 requiresLogin=true（默认 false，即已登录）。 */
  readonly requiresLogin?: boolean;
  /** 所有 spawn 都模拟 ENOENT（CLI 不存在）。 */
  readonly missingBinary?: boolean;
  /** 服务器永不响应请求（握手超时测试）。 */
  readonly silent?: boolean;
  /** `--version` 探测的 stdout（默认 'codex-cli 0.0.0-fake'）。 */
  readonly version?: string;
  /** 每个 sendUserMessage 的脚本化回答（循环使用；默认 'fake 完成'）。 */
  readonly answers?: readonly string[];
  /** loginStatus 直接回 JSON-RPC 错误（无法确认登录状态）。 */
  readonly loginStatusError?: boolean;
}

/** 假 app-server：与真实 CodexAppServerDriver 走同一 JSONL 协议面（stdin/stdout 管道）。 */
export class FakeCodexAppServer {
  readonly stdin: PassThrough;
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly requests: {readonly method: string; readonly params: unknown}[] = [];
  readonly prompts: string[] = [];
  readonly interrupts: number[] = [];
  conversationId?: string;
  exited = false;

  private readonly options: FakeCodexAppServerOptions;
  private nextAnswer = 0;
  private nextConversation = 0;
  private buffer = '';
  private running = false;

  constructor(options: FakeCodexAppServerOptions = {}) {
    this.options = options;
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stdin.setEncoding('utf8');
    this.stdin.on('data', (chunk: string) => {
      this.buffer += chunk;
      for (;;) {
        const newline = this.buffer.indexOf('\n');
        if (newline < 0) break;
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (line) this.handleLine(line);
      }
    });
    this.stdin.on('error', () => undefined);
  }

  /** 模拟进程退出（close/kill 之后由驱动等待 exited）。 */
  kill(): void {
    if (this.exited) return;
    this.exited = true;
    this.running = false;
    this.stdin.destroy();
    this.stdout.destroy();
    this.stderr.destroy();
  }

  private writeLine(value: unknown): void {
    this.stdout.write(`${JSON.stringify(value)}\n`);
  }

  private handleLine(line: string): void {
    let message: {id?: number; method?: string; params?: Record<string, unknown>};
    try {
      message = JSON.parse(line) as {id?: number; method?: string; params?: Record<string, unknown>};
    } catch {
      return;
    }
    if (typeof message.id !== 'number' || typeof message.method !== 'string') return;
    this.requests.push({method: message.method, params: message.params ?? {}});
    if (this.options.silent) return;
    switch (message.method) {
      case 'initialize':
        this.writeLine({jsonrpc: '2.0', id: message.id, result: {ok: true}});
        return;
      case 'loginStatus':
        if (this.options.loginStatusError) {
          this.writeLine({jsonrpc: '2.0', id: message.id, error: {code: -32000, message: 'not implemented'}});
          return;
        }
        this.writeLine({jsonrpc: '2.0', id: message.id, result: {requiresLogin: this.options.requiresLogin === true}});
        return;
      case 'newConversation': {
        this.conversationId = `fake-conv-${++this.nextConversation}`;
        this.writeLine({jsonrpc: '2.0', id: message.id, result: {conversationId: this.conversationId, model: 'fake-model'}});
        return;
      }
      case 'sendUserMessage': {
        const params = message.params ?? {};
        const items = Array.isArray(params['items']) ? params['items'] as Array<{type?: string; text?: string}> : [];
        for (const item of items) if (item?.text) this.prompts.push(item.text);
        this.writeLine({jsonrpc: '2.0', id: message.id, result: {ok: true}});
        const answers = this.options.answers;
        const fallback = 'fake 完成';
        const answer = answers && answers.length > 0 ? answers[this.nextAnswer++ % answers.length] ?? fallback : fallback;
        // 模拟真实 app-server 的通知序列：delta → message → taskComplete。
        this.writeLine({jsonrpc: '2.0', method: 'agentMessageDelta', params: {conversationId: this.conversationId, delta: answer.slice(0, 3)}});
        this.writeLine({jsonrpc: '2.0', method: 'agentMessage', params: {conversationId: this.conversationId, message: answer}});
        this.writeLine({jsonrpc: '2.0', method: 'taskComplete', params: {conversationId: this.conversationId, lastAgentMessage: answer}});
        return;
      }
      case 'interruptConversation':
        this.interrupts.push(this.interrupts.length + 1);
        this.writeLine({jsonrpc: '2.0', id: message.id, result: {ok: true}});
        return;
      default:
        this.writeLine({jsonrpc: '2.0', id: message.id, error: {code: -32601, message: `method not found: ${message.method}`}});
        return;
    }
  }
}

/** 组装 CrewDriverProcess 的假句柄。 */
function fakeProcess(server: FakeCodexAppServer, exitCode: number | null, error?: Error): CrewDriverProcess {
  const exited = new Promise<{exitCode: number | null; signal: NodeJS.Signals | null; error?: Error}>(resolve => {
    const settle = () => resolve(error === undefined ? {exitCode, signal: null} : {exitCode, signal: null, error});
    if (server.exited) {
      settle();
      return;
    }
    server.stdin.once('close', settle);
    // kill 时 stdin.destroy() 触发 close；兜底监听 stdout 关闭。
    server.stdout.once('close', settle);
  });
  return {
    stdin: server.stdin,
    stdout: server.stdout,
    stderr: server.stderr,
    kill: () => {
      server.kill();
      return true;
    },
    exited,
  };
}

function enoentProcess(command: string): CrewDriverProcess {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const error = Object.assign(new Error(`spawn ${command} ENOENT`), {code: 'ENOENT'}) as Error & {code: string};
  return {
    stdin,
    stdout,
    stderr,
    kill: () => true,
    exited: Promise.resolve({exitCode: null, signal: null, error}),
  };
}

function versionProcess(output: string): CrewDriverProcess {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.end(output);
  return {
    stdin,
    stdout,
    stderr,
    kill: () => true,
    exited: Promise.resolve({exitCode: 0, signal: null}),
  };
}

export interface FakeCodexSpawn {
  readonly spawn: CrewSpawn;
  /** 已启动的假 app-server（按 spawn 顺序）。 */
  readonly servers: FakeCodexAppServer[];
}

/** 假 spawn 工厂：`--version` 探测与 `app-server` 协议子进程都由假实现应答。 */
export function createFakeCodexSpawn(options: FakeCodexAppServerOptions = {}): FakeCodexSpawn {
  const servers: FakeCodexAppServer[] = [];
  const spawn: CrewSpawn = (command, args) => {
    if (options.missingBinary) return enoentProcess(command);
    if (args.includes('--version')) return versionProcess(options.version ?? 'codex-cli 0.0.0-fake');
    if (args.includes('app-server')) {
      const server = new FakeCodexAppServer(options);
      servers.push(server);
      server.start();
      return fakeProcess(server, 0);
    }
    throw new Error(`fake codex spawn: unexpected args ${args.join(' ')}`);
  };
  return {spawn, servers};
}

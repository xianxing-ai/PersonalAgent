import {CrewError} from '../errors.js';
import {
  createNodeSpawn,
  CrewSessionEventBus,
  type CrewDriver,
  type CrewDriverEvent,
  type CrewDriverProcess,
  type CrewDriverProbe,
  type CrewDriverSession,
  type CrewDriverStartInput,
  type CrewDriverUnsubscribe,
  type CrewSpawn,
} from '../driver.js';
import type {CrewConsentProvider} from '../consent.js';
import {describeObjectFields, redactSensitiveText} from '../sanitize.js';
import type {CrewDriverId} from '../store.js';

/**
 * Codex 驱动：只拉起用户本机已登录的官方 Codex CLI（`codex app-server`，
 * JSON-RPC/JSONL over stdio，按设计页"codex app-server 或 codex-acp"取前者）。
 *
 * 合规边界（设计页订阅复用与合规边界）：
 * - 只 spawn 官方 CLI 并通过 stdio 通信，登录态由 CLI 自身管理；本驱动不读取、
 *   不存储、不转发任何 token 或凭据文件（不触碰 ~/.codex 等，登录探测只走
 *   CLI 自带协议，只探测不接触）；
 * - CLI 不存在、未登录或无法确认登录状态时明确 `DRIVER_UNAVAILABLE`，
 *   不假装可用、不代登录；
 * - 首次使用前必须经 `CrewConsentProvider.requireGranted('codex')` 同意。
 *
 * 协议说明：方法/事件名按 2026-11 的 codex app-server JSON-RPC 约定实现
 * （initialize / loginStatus / newConversation / sendUserMessage / interruptConversation；
 * agentMessageDelta / agentMessage / taskComplete / error 通知）。本沙箱没有已登录的
 * Codex，尚未对真实 Codex 做实机验证；单元测试使用协议级假子进程
 * （见 `@personal-agent/crew/testing` 的 createFakeCodexSpawn）。若真实协议字段
 * 有出入，只需调整本文件的 PROTOCOL_* 常量与对应解析。
 */

export const CODEX_DRIVER_ID: CrewDriverId = 'codex';

const PROTOCOL_INITIALIZE_METHOD = 'initialize';
const PROTOCOL_LOGIN_STATUS_METHOD = 'loginStatus';
const PROTOCOL_NEW_CONVERSATION_METHOD = 'newConversation';
const PROTOCOL_SEND_USER_MESSAGE_METHOD = 'sendUserMessage';
const PROTOCOL_INTERRUPT_CONVERSATION_METHOD = 'interruptConversation';

const PROTOCOL_EVENT_AGENT_MESSAGE = 'agentMessage';
const PROTOCOL_EVENT_AGENT_MESSAGE_DELTA = 'agentMessageDelta';
const PROTOCOL_EVENT_TASK_COMPLETE = 'taskComplete';
const PROTOCOL_EVENT_ERROR = 'error';

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export interface CodexDriverOptions {
  /** 同意门：start 前必须已获用户同意。 */
  readonly consent: CrewConsentProvider;
  /** 官方 CLI 命令名，默认 'codex'（必须保持官方 CLI，不接受第三方包装）。 */
  readonly command?: string;
  /** 进程工厂；默认 node child_process。测试注入假子进程/管道。 */
  readonly spawn?: CrewSpawn;
  /** 握手与每个请求的超时，默认 10s。 */
  readonly requestTimeoutMs?: number;
  readonly sessionIdPrefix?: string;
}

interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method: string;
  readonly params?: unknown;
}

interface JsonRpcNotification {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function exitSummary(exit: {exitCode: number | null; signal: NodeJS.Signals | null; error?: Error}): string {
  return `exit=${exit.exitCode ?? 'null'}${exit.signal ? ` signal=${exit.signal}` : ''}${exit.error ? ` ${exit.error.message}` : ''}`;
}

/**
 * app-server 的 JSONL 客户端：请求/响应按 id 关联，通知分派给回调。
 * 握手与已建立会话共用同一实现；进程退出时未决请求全部拒绝。
 */
class AppServerClient {
  private readonly pending = new Map<number, {resolve: (result: unknown) => void; reject: (error: unknown) => void; timer: NodeJS.Timeout; method: string}>();
  private nextRequestId = 1;
  private notificationHandler?: (notification: JsonRpcNotification) => void;

  constructor(private readonly child: CrewDriverProcess, private readonly requestTimeoutMs: number) {
    child.stdout.setEncoding('utf8');
    let buffer = '';
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) this.handleLine(line);
      }
    });
    child.exited.then(exit => {
      this.alive = false;
      for (const pending of [...this.pending.values()]) {
        clearTimeout(pending.timer);
        pending.reject(new CrewError('DRIVER_FAILED', `codex app-server 进程在等待 ${pending.method} 响应时退出（${exitSummary(exit)}）`));
      }
      this.pending.clear();
    });
  }

  /** 握手完成后由会话接管通知分派。 */
  setNotificationHandler(handler: (notification: JsonRpcNotification) => void): void {
    this.notificationHandler = handler;
  }

  get isAlive(): boolean {
    return this.alive;
  }

  private alive = true;

  markDead(): void {
    this.alive = false;
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (!this.alive) {
      return Promise.reject(new CrewError('DRIVER_FAILED', `codex app-server 会话已关闭，无法发送 ${method}`));
    }
    const id = this.nextRequestId++;
    const payload: JsonRpcRequest = {jsonrpc: '2.0', id, method, ...(params === undefined ? {} : {params})};
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CrewError('TIMEOUT', `codex app-server 请求 ${method} 超时（${this.requestTimeoutMs}ms）`));
      }, this.requestTimeoutMs);
      this.pending.set(id, {resolve, reject, timer, method});
      this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  private handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      // app-server stdout 应为 JSONL；忽略无法解析的行（诊断走 stderr）。
      return;
    }
    if (!isRecord(message)) return;
    if (typeof message['id'] === 'number' && (message['result'] !== undefined || message['error'] !== undefined)) {
      const pending = this.pending.get(message['id']);
      if (!pending) return;
      this.pending.delete(message['id']);
      clearTimeout(pending.timer);
      if (message['error'] !== undefined) {
        const error = message['error'];
        // 错误只保留方法名、错误码与净化后的短消息，不序列化对端对象。
        const detail = isRecord(error) ? `${error['code'] ?? '未知'}：${redactSensitiveText(optionalString(error['message']) ?? '')}` : describeObjectFields(error);
        pending.reject(new CrewError('DRIVER_PROTOCOL', `codex app-server 请求 ${pending.method} 失败（code=${detail}）`));
      } else {
        pending.resolve(message['result']);
      }
      return;
    }
    if (typeof message['method'] === 'string') {
      const notification: JsonRpcNotification = {jsonrpc: '2.0', method: message['method'], ...(message['params'] === undefined ? {} : {params: message['params']})};
      this.notificationHandler?.(notification);
    }
  }
}

/** 单个 codex app-server 会话（一个进程，一个 conversation；与握手共用同一 JSONL 客户端）。 */
class CodexAppServerSession implements CrewDriverSession {
  readonly sessionId: string;
  readonly agentId: string;
  readonly driver = CODEX_DRIVER_ID;
  readonly conversationId: string;
  private readonly child: CrewDriverProcess;
  private readonly client: AppServerClient;
  private readonly events = new CrewSessionEventBus();
  private closed = false;
  private exitSeen = false;

  constructor(input: {sessionId: string; agentId: string; conversationId: string; child: CrewDriverProcess; client: AppServerClient}) {
    this.sessionId = input.sessionId;
    this.agentId = input.agentId;
    this.conversationId = input.conversationId;
    this.child = input.child;
    this.client = input.client;
    this.client.setNotificationHandler(notification => this.handleNotification(notification));
    input.child.exited.then(exit => {
      this.exitSeen = true;
      this.emit({
        type: 'exited',
        sessionId: this.sessionId,
        agentId: this.agentId,
        driver: this.driver,
        exitCode: exit.exitCode,
        signal: exit.signal,
        ...(exit.error ? {error: exit.error.message} : {}),
      });
    });
  }

  /** 会话建立完成（握手成功）即产生 started 事件。 */
  emitStarted(): void {
    this.emit({type: 'started', sessionId: this.sessionId, agentId: this.agentId, driver: this.driver});
  }

  send(text: string): Promise<void> {
    return this.client.request(PROTOCOL_SEND_USER_MESSAGE_METHOD, {conversationId: this.conversationId, items: [{type: 'text', text}]}).then(() => undefined);
  }

  async interrupt(reason: string): Promise<void> {
    if (this.closed || this.exitSeen) return;
    try {
      await this.client.request(PROTOCOL_INTERRUPT_CONVERSATION_METHOD, {conversationId: this.conversationId});
      this.emit({type: 'interrupted', sessionId: this.sessionId, agentId: this.agentId, driver: this.driver, reason});
    } catch (error) {
      // 打断是尽力而为：CLI 可能刚好已完成。失败也产生事件让等待方结算。
      this.emit({type: 'failed', sessionId: this.sessionId, agentId: this.agentId, driver: this.driver, message: `打断请求失败：${error instanceof Error ? error.message : String(error)}`});
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.client.markDead();
    this.child.kill('SIGTERM');
    await this.child.exited.catch(() => undefined);
  }

  onEvent(listener: (event: CrewDriverEvent) => void): CrewDriverUnsubscribe {
    return this.events.subscribe(listener);
  }

  private handleNotification(notification: JsonRpcNotification): void {
    const params = isRecord(notification.params) ? notification.params : {};
    const conversationId = optionalString(params['conversationId']);
    if (conversationId !== undefined && conversationId !== this.conversationId) return;
    switch (notification.method) {
      case PROTOCOL_EVENT_AGENT_MESSAGE:
      case PROTOCOL_EVENT_AGENT_MESSAGE_DELTA: {
        const text = optionalString(params['message']) ?? optionalString(params['delta']) ?? '';
        if (text) this.emit({type: 'output', sessionId: this.sessionId, agentId: this.agentId, driver: this.driver, text});
        return;
      }
      case PROTOCOL_EVENT_TASK_COMPLETE: {
        this.emit({type: 'completed', sessionId: this.sessionId, agentId: this.agentId, driver: this.driver, result: optionalString(params['lastAgentMessage']) ?? ''});
        return;
      }
      case PROTOCOL_EVENT_ERROR: {
        // 不把通知参数整体序列化：只有净化后的短消息，缺失时退化为字段名列表。
        const rawMessage = redactSensitiveText(optionalString(params['message']) ?? '');
        const raw = rawMessage || `error 通知（${describeObjectFields(notification.params)}）`;
        this.emit({type: 'failed', sessionId: this.sessionId, agentId: this.agentId, driver: this.driver, message: raw});
        return;
      }
      default:
        return;
    }
  }

  private emit(event: CrewDriverEvent): void {
    this.events.emit(event);
  }
}

/** 官方 Codex CLI 的 app-server 驱动。见模块级注释的合规边界与未实机验证说明。 */
export class CodexAppServerDriver implements CrewDriver {
  readonly driverId = CODEX_DRIVER_ID;

  private readonly consent: CrewConsentProvider;
  private readonly command: string;
  private readonly spawnImpl: CrewSpawn;
  private readonly requestTimeoutMs: number;
  private readonly sessionIdPrefix: string;
  private sessionCounter = 0;

  constructor(options: CodexDriverOptions) {
    this.consent = options.consent;
    this.command = options.command ?? 'codex';
    this.spawnImpl = options.spawn ?? createNodeSpawn();
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.sessionIdPrefix = options.sessionIdPrefix ?? 'codex-session';
  }

  /** 探测官方 CLI 是否安装：先过同意门（无同意不 spawn），再 `codex --version`；ENOENT/非零/超时都明确 unavailable。 */
  async probe(): Promise<CrewDriverProbe> {
    // F11：探测也不得在无同意时拉起 CLI——无同意返回 unavailable 而不是 spawn。
    try {
      this.consent.requireGranted(CODEX_DRIVER_ID);
    } catch (error) {
      return {status: 'unavailable', reason: `未获用户同意，不探测官方 CLI：${error instanceof Error ? error.message : String(error)}`};
    }
    const attempt = this.spawnImpl(this.command, ['--version'], {cwd: process.cwd()});
    const timeout = setTimeout(() => attempt.kill('SIGKILL'), this.requestTimeoutMs);
    try {
      const exit = await attempt.exited;
      if (exit.error) {
        const code = (exit.error as NodeJS.ErrnoException).code;
        return {status: 'unavailable', reason: code === 'ENOENT'
          ? `未在本机找到官方 Codex CLI（${this.command}）；请用户自行安装并登录，产品不代装、不代登录、不读取凭据`
          : `Codex CLI 探测失败：${exit.error.message}`};
      }
      if (exit.exitCode !== 0) {
        return {status: 'unavailable', reason: `Codex CLI 探测失败（exit=${exit.exitCode ?? 'null'}）`};
      }
      return {status: 'available'};
    } catch {
      return {status: 'unavailable', reason: 'Codex CLI 探测过程异常'};
    } finally {
      clearTimeout(timeout);
    }
  }

  async start(input: CrewDriverStartInput): Promise<CrewDriverSession> {
    // 1. 同意门：未同意/已撤销必须拒绝，且不产生任何进程。
    this.consent.requireGranted(CODEX_DRIVER_ID);
    // 2. 可用性：CLI 缺失时明确 unavailable（不假装可用）。
    const probe = await this.probe();
    if (probe.status === 'unavailable') {
      throw new CrewError('DRIVER_UNAVAILABLE', `Codex 驱动不可用：${probe.reason ?? '未知原因'}`);
    }
    // 3. spawn 官方 CLI 的 app-server（只传工作区与指令，凭据由 CLI 自身管理）。
    const child = this.spawnImpl(this.command, ['app-server'], {cwd: input.workspacePath});
    try {
      const client = new AppServerClient(child, this.requestTimeoutMs);
      await client.request(PROTOCOL_INITIALIZE_METHOD, {clientInfo: {name: 'personal-agent-crew', title: 'PersonalAgent crew', version: '0.1.0-alpha.1'}});
      let loginStatus: unknown;
      try {
        loginStatus = await client.request(PROTOCOL_LOGIN_STATUS_METHOD, undefined);
      } catch (error) {
        // 无法确认登录状态一律按不可用处理（合规边界：不假装可用），原因保留。
        throw new CrewError('DRIVER_UNAVAILABLE', `无法从 codex app-server 确认登录状态：${error instanceof Error ? error.message : String(error)}`);
      }
      const requiresLogin = isRecord(loginStatus) ? loginStatus['requiresLogin'] : undefined;
      if (requiresLogin !== false) {
        throw new CrewError('DRIVER_UNAVAILABLE', requiresLogin === true
          ? 'Codex CLI 未登录：请用户在终端自行 `codex login`（Sign in with ChatGPT），产品不代登录、不读取/不存储任何凭据'
          : '无法从 codex app-server 确认登录状态（loginStatus 缺少明确的 requiresLogin=false）；按合规边界不假装可用');
      }
      const conversation = await client.request(PROTOCOL_NEW_CONVERSATION_METHOD, {cwd: input.workspacePath, baseInstructions: input.instructions});
      if (!isRecord(conversation) || typeof conversation['conversationId'] !== 'string' || !conversation['conversationId'].trim()) {
        throw new CrewError('DRIVER_PROTOCOL', `codex app-server newConversation 响应缺少 conversationId（${describeObjectFields(conversation)}）`);
      }
      // 同一客户端交给会话继续使用（通知分派由会话接管）。
      const session = new CodexAppServerSession({
        sessionId: `${this.sessionIdPrefix}-${++this.sessionCounter}`,
        agentId: input.agentId,
        conversationId: conversation['conversationId'],
        child,
        client,
      });
      session.emitStarted();
      return session;
    } catch (error) {
      child.kill('SIGKILL');
      await child.exited.catch(() => undefined);
      throw error;
    }
  }
}

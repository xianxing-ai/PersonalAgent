import {spawn} from 'node:child_process';
import type {Readable, Writable} from 'node:stream';
import {redactSensitiveText} from './sanitize.js';
import type {CrewDriverId} from './store.js';

/**
 * 统一驱动接口（P2 驱动层的公开契约）。
 *
 * 驱动把"本机已登录的官方编程 agent CLI"接进 crew：只做 spawn + stdio 结构化协议
 * （ACP / codex app-server），不抓终端画面、不注入协作工具、不读取/存储/转发任何
 * token 或凭据文件。订阅复用的唯一方式是拉起用户本机已登录的官方 CLI，登录探测
 * 只走 CLI 自带命令/协议（只探测不接触）。
 *
 * 契约（实现必须遵守）：
 * - `start` 前必须经 `CrewConsentProvider.requireGranted` 确认该驱动已获用户同意，
 *   未同意/已撤销抛 `CONSENT_REQUIRED`；
 * - CLI 不存在、未登录或无法确认登录状态时抛 `DRIVER_UNAVAILABLE`，明确说明原因，
 *   不得假装可用，也不代登录；
 * - `send` 对应一次已领取任务的目标文本；`interrupt` 打断当前运行；两者都通过
 *   `onEvent` 事件流回报进程侧进展，事件类型见 `CrewDriverEvent`；
 * - 驱动事件不是可信证据：`completed` 的 `result` 是 CLI 自报结果，evidenceRefs
 *   由上层按可信执行路径补充（本 PR 留空），父应按"模型自报"对待。
 */

/** 驱动事件类型：started 会话就绪；output CLI 输出；completed/failed 结束一次 prompt；interrupted 已打断；exited 进程退出。 */
export type CrewDriverEventType = 'started' | 'output' | 'completed' | 'failed' | 'interrupted' | 'exited';

export type CrewDriverEvent =
  | {readonly type: 'started'; readonly sessionId: string; readonly agentId: string; readonly driver: CrewDriverId}
  | {readonly type: 'output'; readonly sessionId: string; readonly agentId: string; readonly driver: CrewDriverId; readonly text: string}
  | {readonly type: 'completed'; readonly sessionId: string; readonly agentId: string; readonly driver: CrewDriverId; readonly result: string}
  | {readonly type: 'failed'; readonly sessionId: string; readonly agentId: string; readonly driver: CrewDriverId; readonly message: string}
  | {readonly type: 'interrupted'; readonly sessionId: string; readonly agentId: string; readonly driver: CrewDriverId; readonly reason: string}
  | {readonly type: 'exited'; readonly sessionId: string; readonly agentId: string; readonly driver: CrewDriverId; readonly exitCode: number | null; readonly signal: string | null; readonly error?: string};

/** 可用性探测结果：unavailable 时必须给出明确原因，不假装可用。 */
export interface CrewDriverProbe {
  readonly status: 'available' | 'unavailable';
  readonly reason?: string;
}

export interface CrewDriverStartInput {
  readonly agentId: string;
  /** 该 agent 注册时的指令（作为 CLI 会话的基线指令透传）。 */
  readonly instructions: string;
  /** 该 agent 的工作区路径（作为 CLI 进程的 cwd）。 */
  readonly workspacePath: string;
}

export type CrewDriverUnsubscribe = () => void;

/** 一次驱动会话：生命周期由调用方管理（start → send/interrupt → close）。 */
export interface CrewDriverSession {
  readonly sessionId: string;
  readonly agentId: string;
  readonly driver: CrewDriverId;
  /** 发送一条 prompt（crew 中对应一个已领取任务的目标文本）。 */
  send(text: string): Promise<void>;
  /** 打断当前运行；实现应尽快产生 interrupted/exited 事件，使等待方可以结算。 */
  interrupt(reason: string): Promise<void>;
  /** 关闭会话并终止子进程（幂等；close 后不再接受 send）。 */
  close(): Promise<void>;
  /** 订阅事件流；首个订阅者接入前缓冲的事件（例如 started）会先回放再转发。 */
  onEvent(listener: (event: CrewDriverEvent) => void): CrewDriverUnsubscribe;
}

/**
 * 会话事件总线：首个订阅者接入前的事件先缓冲、接入时回放（保证 start 期间
 * 产生的 started 不丢），之后实时转发。
 */
export class CrewSessionEventBus {
  private readonly listeners = new Set<(event: CrewDriverEvent) => void>();
  private backlog: CrewDriverEvent[] = [];
  private subscribedOnce = false;

  emit(event: CrewDriverEvent): void {
    if (!this.subscribedOnce) {
      this.backlog.push(event);
      return;
    }
    for (const listener of [...this.listeners]) listener(event);
  }

  subscribe(listener: (event: CrewDriverEvent) => void): CrewDriverUnsubscribe {
    this.listeners.add(listener);
    if (!this.subscribedOnce) {
      this.subscribedOnce = true;
      const replay = this.backlog;
      this.backlog = [];
      for (const event of replay) listener(event);
    }
    return () => this.listeners.delete(listener);
  }
}

export interface CrewDriver {
  readonly driverId: CrewDriverId;
  /** 探测本机可用性：只探测不接触（不读取/不存储任何凭据文件）。 */
  probe(): Promise<CrewDriverProbe>;
  /** 启动会话；同意与可用性检查失败时必须拒绝（见模块级契约）。实现方在构造时获得 consent provider。 */
  start(input: CrewDriverStartInput): Promise<CrewDriverSession>;
}

/**
 * 驱动子进程的最小接口：只暴露驱动真正需要的 stdio 与退出面，
 * 便于单元测试注入假的子进程/管道模拟协议。
 */
export interface CrewDriverProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  /** 子进程 stderr 的脱敏尾部（诊断用）；只在生产 spawn 实现上提供。 */
  readonly stderrTail?: () => string;
  /** 终止进程；返回是否成功发出信号。 */
  kill(signal?: NodeJS.Signals): boolean;
  /** 进程退出（或启动失败，error 为 ENOENT 等）时结算。 */
  readonly exited: Promise<{exitCode: number | null; signal: NodeJS.Signals | null; error?: Error}>;
}

export type CrewSpawn = (command: string, args: readonly string[], options: {readonly cwd: string; readonly env?: Readonly<Record<string, string>>}) => CrewDriverProcess;

/** 保留的 stderr 尾部上限（字符）：持续消费管道防写满阻塞，只留尾部若干 KB 供诊断。 */
export const MAX_DRIVER_STDERR_TAIL = 8192;

/**
 * 子进程环境变量白名单：驱动拉起的官方 CLI 只拿到登录与运行必需项。
 * CLI 是能执行任意 shell 的 agent，继承宿主全量环境会把 Claude/Grok API key
 * 等秘密暴露给模型或其工具（提示注入即可读出外传），因此默认剔除一切不在
 * 白名单内的变量，明确剔除 `*_API_KEY`/`*_TOKEN`/`*_SECRET`/`*_PASSWORD`/
 * `PI_NOTIFY_*` 这类凭据模式（即使调用方经 `env` 显式传入也丢弃）。
 */
const DRIVER_ENV_ALLOW_EXACT: readonly string[] = [
  'PATH', 'HOME', 'USERPROFILE', 'LANG', 'TERM', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT', 'CODEX_HOME', 'SHELL',
];
const DRIVER_ENV_ALLOW_PREFIX: readonly string[] = ['LC_', 'XDG_'];
const DRIVER_ENV_DENY_SUFFIX: readonly string[] = ['_API_KEY', '_TOKEN', '_SECRET', '_PASSWORD'];
const DRIVER_ENV_DENY_PREFIX: readonly string[] = ['PI_NOTIFY_'];

/** 判断一个变量名是否落在凭据剔除模式内（白名单前的硬性否决）。 */
export function isDriverEnvDenied(name: string): boolean {
  const upper = name.toUpperCase();
  return DRIVER_ENV_DENY_PREFIX.some(prefix => upper.startsWith(prefix))
    || DRIVER_ENV_DENY_SUFFIX.some(suffix => upper.endsWith(suffix));
}

/** 组装驱动子进程的环境：白名单 ∪（调用方 extraEnv 剔除凭据模式后）。 */
export function resolveDriverEnv(env?: Readonly<Record<string, string>>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const allowed = DRIVER_ENV_ALLOW_EXACT.includes(name)
      || DRIVER_ENV_ALLOW_PREFIX.some(prefix => name.startsWith(prefix));
    if (allowed && !isDriverEnvDenied(name)) resolved[name] = value;
  }
  for (const [name, value] of Object.entries(env ?? {})) {
    if (isDriverEnvDenied(name)) continue; // 调用方也不能经 extraEnv 把凭据带进子进程。
    resolved[name] = value;
  }
  return resolved;
}

/** 生产实现：node child_process.spawn，stdio 三根管道；启动失败经 exited 结算。 */
export function createNodeSpawn(): CrewSpawn {
  return (command, args, options) => {
    const child = spawn(command, [...args], {cwd: options.cwd, env: resolveDriverEnv(options.env), stdio: ['pipe', 'pipe', 'pipe']});
    // F12：stderr 管道必须持续消费，否则子进程大量写 stderr 会写满管道而阻塞；
    // 只保留脱敏后的尾部若干 KB 供诊断，不落盘、不打印。
    child.stderr.setEncoding('utf8');
    let stderrTailBuffer = '';
    child.stderr.on('data', (chunk: string) => {
      stderrTailBuffer += chunk;
      if (stderrTailBuffer.length > MAX_DRIVER_STDERR_TAIL) {
        stderrTailBuffer = stderrTailBuffer.slice(stderrTailBuffer.length - MAX_DRIVER_STDERR_TAIL);
      }
    });
    child.stderr.resume();
    const exited = new Promise<{exitCode: number | null; signal: NodeJS.Signals | null; error?: Error}>(resolve => {
      let settled = false;
      const settle = (exitCode: number | null, signal: NodeJS.Signals | null, error?: Error) => {
        if (settled) return;
        settled = true;
        resolve(error === undefined ? {exitCode, signal} : {exitCode, signal, error});
      };
      child.on('exit', (code, signal) => settle(code, signal));
      child.on('error', error => settle(null, null, error));
    });
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      stderrTail: () => redactSensitiveText(stderrTailBuffer),
      kill: signal => child.kill(signal),
      exited,
    };
  };
}

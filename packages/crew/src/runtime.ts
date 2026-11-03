import {CrewError} from './errors.js';
import {truncateReceiptResult, type CrewReceipt} from './receipts.js';
import {redactSensitiveText} from './sanitize.js';
import {CrewKernel, type CrewKernelDispatchInput, type CrewKernelGetTaskInput, type CrewKernelInterruptInput, type CrewKernelListTasksInput} from './kernel.js';
import {CodexAppServerDriver} from './drivers/codex.js';
import type {CrewConsentGrantInput} from './consent.js';
import {CREW_PARENT_AGENT_ID, type CrewAgentRecord, type CrewAgentSpec, type CrewConsentRecord, type CrewDriverId, type CrewTaskRecord} from './store.js';
import type {CrewDriver, CrewDriverEvent, CrewDriverSession, CrewSpawn} from './driver.js';

/**
 * 驱动运行时：把 P2 驱动接口与 #559 的 dispatch / 信箱 / 任务表 / 回执衔接起来。
 *
 * 主父 agent 派子的逻辑不变：任务根仍只由父发起（`dispatchTask` 透传内核的父校验），
 * 驱动只是子 agent 的执行器——运行时按 FIFO 领取该 agent 的下一个任务（claim），
 * 打开对应驱动的会话，把任务目标作为 prompt 发给 CLI，把 CLI 的结束事件映射为
 * 固定回执格式（Status/Result/Evidence/Unblock）提交回任务表。领取成功后消费
 * 信箱中对应的 task 消息；父打断（interruptTask）仍走内核落任务表 + 信箱 interrupt
 * 消息，运行时额外把打断转发给运行中的 CLI 进程并关闭会话。
 *
 * 合规边界：
 * - 未同意（consent）时 `runNextTask` 必须拒绝且不领取任务（任务保持排队）；
 * - 驱动未实现或本机不可用时明确 `DRIVER_UNAVAILABLE`，不假装可用；
 * - 本运行时是可信宿主：驱动执行入口按 agent 身份操作（actor 边界仍在内核），
 *   父专属操作（dispatch/interrupt/getTask 汇总）继续由内核强制。
 *
 * P2 限制：每个 agent 同时只驱动一个任务（一个任务一个 CLI 会话），内核的
 * 并发 2 上限不变；运行时只是不并发领取。evidenceRefs 留空：CLI 自报结果
 * 不是可信证据，可信产物引用（worktree 提交、交接 manifest）留后续 PR。
 */

/** 驱动注册表：本 PR 只注册 codex；claude/grok（API key）与 gemini 留后续。 */
export type CrewDriverRegistry = Partial<Record<CrewDriverId, CrewDriver>>;

/** 运行时事件 = 驱动事件 + 关联任务 id。 */
export type CrewRuntimeEvent = CrewDriverEvent & {readonly taskId?: string};

interface CompletedTerminal {
  readonly kind: 'completed';
  readonly result: string;
}
interface FailedTerminal {
  readonly kind: 'failed';
  readonly message: string;
}
interface InterruptedTerminal {
  readonly kind: 'interrupted';
  readonly reason: string;
}
interface ExitedTerminal {
  readonly kind: 'exited';
  readonly exitCode: number | null;
  readonly error?: string;
}
type CrewTerminalEvent = CompletedTerminal | FailedTerminal | InterruptedTerminal | ExitedTerminal;

export interface CrewDriverRuntimeOptions {
  readonly now?: () => number;
  /** 覆盖默认驱动注册表（测试注入 FakeDriver；生产默认只有真实 codex 驱动）。 */
  readonly drivers?: CrewDriverRegistry;
  /** 默认 codex 驱动的进程工厂注入（测试用假子进程模拟协议）。 */
  readonly codexSpawn?: CrewSpawn;
  readonly codexCommand?: string;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class CrewDriverRuntime {
  private readonly kernel: CrewKernel;
  private readonly drivers: CrewDriverRegistry;
  private readonly runningTasks = new Map<string, CrewDriverSession>();
  private readonly listeners = new Set<(event: CrewRuntimeEvent) => void>();

  private constructor(kernel: CrewKernel, drivers: CrewDriverRegistry) {
    this.kernel = kernel;
    this.drivers = drivers;
  }

  /** 打开（必要时创建）crew 数据库并构建运行时；默认注册表只有真实 codex 驱动。 */
  static open(path: string, options: CrewDriverRuntimeOptions = {}): CrewDriverRuntime {
    const kernel = CrewKernel.open(path, options.now === undefined ? {} : {now: options.now});
    const drivers: CrewDriverRegistry = options.drivers ?? {
      codex: new CodexAppServerDriver({
        consent: kernel.consent,
        ...(options.codexCommand === undefined ? {} : {command: options.codexCommand}),
        ...(options.codexSpawn === undefined ? {} : {spawn: options.codexSpawn}),
      }),
    };
    return new CrewDriverRuntime(kernel, drivers);
  }

  close(): void {
    for (const session of [...this.runningTasks.values()]) {
      void session.close().catch(() => undefined);
    }
    this.runningTasks.clear();
    this.kernel.close();
  }

  // ── 宿主管理（注册表与同意记录，写 crew 自己的 SQLite） ─────────────────

  registerAgent(spec: CrewAgentSpec): CrewAgentRecord {
    return this.kernel.registerAgent(spec);
  }

  getAgent(agentId: string): CrewAgentRecord | undefined {
    return this.kernel.getAgent(agentId);
  }

  listAgents(actorId: string) {
    return this.kernel.listAgents(actorId);
  }

  getConsent(driverId: CrewDriverId): CrewConsentRecord | undefined {
    return this.kernel.consent.getConsent(driverId);
  }

  /** 记录用户同意（宿主在用户明确同意后调用；grantedBy 默认 'user'）。 */
  grantConsent(input: Omit<CrewConsentGrantInput, 'grantedBy'> & {readonly grantedBy?: string}): CrewConsentRecord {
    return this.kernel.consent.grant({grantedBy: 'user', ...input});
  }

  revokeConsent(driverId: CrewDriverId, reason: string): CrewConsentRecord {
    const record = this.kernel.consent.revoke(driverId, reason);
    // 撤回即生效：停掉该驱动下运行中的会话（interrupt + close），任务写 cancelled
    // 回执（原因"同意已撤回"）。撤回之后才到达的完成结果不会以 succeeded 入库。
    for (const [taskId, session] of [...this.runningTasks]) {
      const task = this.kernel.getTask({actorId: CREW_PARENT_AGENT_ID, taskId});
      if (!task || task.status !== 'running') continue;
      const agent = this.kernel.getAgent(task.assignedAgentId);
      if (!agent || agent.driver !== driverId) continue;
      const revokeReason = `同意已撤回：${reason}`;
      try {
        this.kernel.interruptTask({actorId: CREW_PARENT_AGENT_ID, taskId, reason: revokeReason});
      } catch {
        // 父打断写库失败不阻断会话停止：尽力中断并关闭进程。
      }
      void session.interrupt(revokeReason)
        .catch(() => undefined)
        .then(() => session.close().catch(() => undefined));
    }
    return record;
  }

  // ── 父派子（逻辑不变） ────────────────────────────────────────────────

  /** 父发起任务根并投递到目标 agent 信箱；只有父能调（内核强制）。 */
  dispatchTask(input: CrewKernelDispatchInput): CrewTaskRecord {
    return this.kernel.dispatchTask(input);
  }

  getTask(input: CrewKernelGetTaskInput): CrewTaskRecord | undefined {
    return this.kernel.getTask(input);
  }

  listTasks(input: CrewKernelListTasksInput): CrewTaskRecord[] {
    return this.kernel.listTasks(input);
  }

  /**
   * 父打断：内核把任务置为 cancelled 并投递 interrupt 消息（持久，重启不丢），
   * 运行时再把打断转发给运行中的 CLI 会话并关闭进程。
   */
  async interruptTask(input: CrewKernelInterruptInput): Promise<CrewTaskRecord> {
    const record = this.kernel.interruptTask(input);
    const session = this.runningTasks.get(input.taskId);
    if (session) {
      try {
        await session.interrupt(input.reason);
      } catch {
        // 打断失败也要继续关闭进程，让执行侧尽快结算。
      }
      await session.close();
    }
    return record;
  }

  // ── 驱动执行 ─────────────────────────────────────────────────────────

  /**
   * 驱动执行该 agent 的下一个排队任务（一个任务一个会话）：
   * 同意检查 → 驱动可用性 → 领取（claim）→ 消费信箱 task 消息 → start 会话 →
   * send(任务目标) → 结束事件映射为固定回执提交 → close 会话。
   *
   * 拒绝（未同意/驱动不可用）发生在领取之前，任务保持排队、状态不变。
   * 没有排队任务时返回 undefined（不开会话）。
   */
  async runNextTask(agentId: string): Promise<CrewTaskRecord | undefined> {
    const agent = this.kernel.getAgent(agentId);
    if (!agent) throw new CrewError('UNKNOWN_AGENT', `agent ${agentId} is not registered`);
    // 1. 驱动注册表：未实现的驱动明确不可用（Claude/Grok 的 API key 驱动与 Gemini 留后续 PR）。
    const driver = this.drivers[agent.driver];
    if (!driver) {
      throw new CrewError('DRIVER_UNAVAILABLE', `驱动 ${agent.driver} 尚未实现（Claude/Grok 的 API key 驱动与 Gemini 留后续 PR）`);
    }
    // 2. 同意门：未同意/已撤销必须拒绝，且不领取任务。
    this.kernel.consent.requireGranted(agent.driver);
    // 3. 本机可用性：明确 unavailable，不假装可用。
    const probe = await driver.probe();
    if (probe.status === 'unavailable') {
      throw new CrewError('DRIVER_UNAVAILABLE', `驱动 ${agent.driver} 在本机不可用：${probe.reason ?? '未知原因'}`);
    }
    // 4. 领取任务并消费信箱中的 task 消息。
    const task = this.kernel.claimNextTask(agentId);
    if (!task) return undefined;
    this.kernel.dequeueTaskMessage(agentId, task.taskId);
    // 5. 打开会话；启动失败 → blocked 回执（环境问题，不是任务失败）。
    let session: CrewDriverSession;
    try {
      session = await driver.start({agentId, instructions: agent.instructions, workspacePath: agent.workspacePath});
    } catch (error) {
      return this.submitReceiptOrDegrade(agentId, task, {
        status: 'blocked',
        // 截断到回执上限：启动失败的对端错误原文可能很长，不能让提交本身失败卡死任务。
        result: truncateReceiptResult(redactSensitiveText(`驱动无法启动：${describeError(error)}`)),
        evidenceRefs: [],
        unblock: `在本机安装并登录 ${agent.driver} 对应的官方 CLI 后由父 agent 重新派单`,
      });
    }
    this.runningTasks.set(task.taskId, session);
    const forwardUnsubscribe = session.onEvent(event => this.emit({...event, taskId: task.taskId}));
    // 终态监视必须在 send 之前订阅：CLI 的响应与完成通知可能在同一数据块内
    // 同步到达，晚订阅会漏掉 completed/failed。
    const terminalPromise = this.awaitTerminalEvent(session);
    try {
      // 5. 发送任务目标；发送失败按外部失败回执（结果不确定 → failed）。
      try {
        await session.send(task.goal);
      } catch (error) {
        return this.finishWithReceipt(agentId, task, session, {kind: 'failed', message: `驱动发送任务目标失败：${describeError(error)}`});
      }
      // 6. 等待结束事件并映射为固定回执。
      const terminal = await terminalPromise;
      return this.finishWithReceipt(agentId, task, session, terminal);
    } finally {
      forwardUnsubscribe();
      this.runningTasks.delete(task.taskId);
      await session.close().catch(() => undefined);
    }
  }

  onEvent(listener: (event: CrewRuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: CrewRuntimeEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  private awaitTerminalEvent(session: CrewDriverSession): Promise<CrewTerminalEvent> {
    return new Promise(resolve => {
      const unsubscribe = session.onEvent(event => {
        if (event.type === 'completed') {
          cleanup();
          resolve({kind: 'completed', result: event.result});
        } else if (event.type === 'failed') {
          cleanup();
          resolve({kind: 'failed', message: event.message});
        } else if (event.type === 'interrupted') {
          cleanup();
          resolve({kind: 'interrupted', reason: event.reason});
        } else if (event.type === 'exited') {
          cleanup();
          resolve({kind: 'exited', exitCode: event.exitCode, ...(event.error === undefined ? {} : {error: event.error})});
        }
      });
      const cleanup = (): void => unsubscribe();
    });
  }

  /** 结束事件 → 固定回执（Status/Result/Evidence/Unblock）；interrupted 不产生回执（任务已 cancelled）。 */
  private finishWithReceipt(agentId: string, task: CrewTaskRecord, session: CrewDriverSession, terminal: CrewTerminalEvent): CrewTaskRecord {
    if (terminal.kind === 'interrupted') {
      return this.kernel.getTask({actorId: agentId, taskId: task.taskId}) ?? task;
    }
    const receipt = terminal.kind === 'completed'
      ? {status: 'succeeded' as const, result: truncateReceiptResult(redactSensitiveText(terminal.result)) || '(CLI 未返回结果文本)', evidenceRefs: [] as string[], unblock: ''}
      : {status: 'failed' as const, result: truncateReceiptResult(redactSensitiveText(terminal.kind === 'failed'
        ? terminal.message
        : `驱动进程退出（exit=${terminal.exitCode ?? 'null'}${terminal.error ? `，${terminal.error}` : ''}）`)),
        evidenceRefs: [] as string[], unblock: ''};
    return this.submitReceiptOrDegrade(agentId, task, receipt);
  }

  /**
   * 提交回执并保证任务一定能结束：CONFLICT（完成瞬间被父打断）以打断结果为准；
   * 其他提交异常降级为一个短的 failed 回执（只写错误码与简短说明，不带对端原文），
   * 任务结束并释放并发槽，而不是把异常抛给调用方让任务永久停在 running。
   */
  private submitReceiptOrDegrade(agentId: string, task: CrewTaskRecord, receipt: CrewReceipt): CrewTaskRecord {
    const taskId = task.taskId;
    try {
      return this.kernel.submitReceipt({actorId: agentId, taskId, receipt});
    } catch (error) {
      // 父在完成瞬间打断：提交回执会 CONFLICT，以打断结果为准。
      if (error instanceof CrewError && error.code === 'CONFLICT') {
        const current = this.kernel.getTask({actorId: agentId, taskId});
        if (current && current.status === 'cancelled') return current;
      }
      const code = error instanceof CrewError ? error.code : 'INTERNAL';
      try {
        return this.kernel.submitReceipt({
          actorId: agentId,
          taskId,
          receipt: {status: 'failed', result: `回执提交失败（${code}），已降级结算：任务未能正常写入结果，请父 agent 重试或核查驱动状态`, evidenceRefs: [], unblock: ''},
        });
      } catch {
        // 兜底回执也失败（例如父同时在打断）：返回当前任务记录，至少不再向调用方抛异常。
        return this.kernel.getTask({actorId: agentId, taskId}) ?? {status: 'running', taskId, rootRequestId: task.rootRequestId, assignedAgentId: task.assignedAgentId, goal: task.goal, createdAt: task.createdAt};
      }
    }
  }
}

/** 打开驱动运行时的公开工厂。 */
export function openCrewDriverRuntime(path: string, options: CrewDriverRuntimeOptions = {}): CrewDriverRuntime {
  return CrewDriverRuntime.open(path, options);
}

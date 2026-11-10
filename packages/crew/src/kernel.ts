import {mkdirSync, readFileSync, statSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {CrewError} from './errors.js';
import {CrewStoreConsentProvider, type CrewConsentProvider} from './consent.js';
import {measureHandoffFile, sha256OfBytes} from './handoff.js';
import {resolveWithinRoot, singleSegment} from './paths.js';
import {
  CrewStore,
  CREW_PARENT_AGENT_ID,
  type CrewAgentRecord,
  type CrewAgentSpec,
  type CrewDispatchInput,
  type CrewDriverId,
  type CrewHandoffRecord,
  type CrewMessageRecord,
  type CrewParentNotificationRecord,
  type CrewStoreOptions,
  type CrewTaskRecord,
} from './store.js';

/**
 * crew P1 协作内核：把 #554 的存储原语收敛成带 actor 边界的协作契约。
 *
 * 所有任务根仍只由父（`parent`）发起；内核的增值是把"谁能做什么"变成可执行的
 * 检查，而不是留给将来的工具宿主自觉遵守：
 * - 父专属：派任务根（dispatch）、打断子任务（interrupt）、读取任意任务结果；
 * - 子专属：领取任务、提交回执、读自己的信箱；子之间互发消息不加限制，
 *   但都走信箱并受 hop / 派单 / 并发上限约束；
 * - 回执仍是固定 Status/Result/Evidence/Unblock 四段格式，违规回执原样拒绝。
 *
 * 内核只做行为层，不复制状态；存储唯一事实来源仍是 `CrewStore`。
 * 将来本地 MCP 工具（send_message / list_agents / interrupt_agent）与驱动层
 * 的每个工具调用都应对应这里的一次内核调用。
 */
const AGENTS_DIRNAME = 'agents';
const SHARED_DIRNAME = 'shared';

export class CrewKernel {
  private readonly store: CrewStore;
  private readonly agentsRoot: string | undefined;
  private readonly sharedRoot: string | undefined;
  private readonly consentProvider: CrewStoreConsentProvider;

  private constructor(store: CrewStore, options: CrewKernelOptions) {
    this.store = store;
    if (options.workspaceRoot !== undefined) {
      const root = resolve(options.workspaceRoot);
      this.agentsRoot = join(root, AGENTS_DIRNAME);
      this.sharedRoot = join(root, SHARED_DIRNAME);
      mkdirSync(this.agentsRoot, {recursive: true});
      mkdirSync(this.sharedRoot, {recursive: true});
    } else {
      this.agentsRoot = undefined;
      this.sharedRoot = undefined;
    }
    this.consentProvider = new CrewStoreConsentProvider(store, {codex: 'local-login', claude: 'api-key', grok: 'api-key'});
  }

  /** 打开（必要时创建）独立的 crew 数据库并返回内核；数据库与 Runtime 主库分离。 */
  static open(path: string, options: CrewKernelOptions = {}): CrewKernel {
    const storeOptions: CrewStoreOptions = options.now === undefined ? {} : {now: options.now};
    return new CrewKernel(CrewStore.open(path, storeOptions), options);
  }

  close(): void {
    this.store.close();
  }

  /**
   * 订阅使用同意接口（合规边界）：记录写入 crew 自己的 SQLite（crew_consents 表）。
   * 驱动的 start 必须先经它确认同意；宿主管理操作（grant/revoke）也通过它完成，
   * 撤销后对应驱动不得再启动。
   */
  get consent(): CrewConsentProvider {
    return this.consentProvider;
  }

  // ── 注册表：宿主管理入口 ────────────────────────────────────────────────

  /**
   * 注册一个命名子 agent（宿主管理操作；`parent` 为保留身份不可注册）。
   * agentId 会映射为工作区目录名，因此必须是单一路径片段（拒绝分隔符、
   * `..`、盘符等）。启用 workspaceRoot 时注册即创建该 agent 的独立工作区目录。
   */
  registerAgent(spec: CrewAgentSpec): CrewAgentRecord {
    singleSegment(spec.agentId, 'agentId');
    const record = this.store.registerAgent(spec);
    if (this.agentsRoot !== undefined) {
      mkdirSync(join(this.agentsRoot, record.agentId), {recursive: true});
    }
    return record;
  }

  /** 按 id 读取子 agent 完整记录（宿主管理操作）。 */
  getAgent(agentId: string): CrewAgentRecord | undefined {
    return this.store.getAgent(agentId);
  }

  /**
   * `list_agents` 工具视图：父或任一子 agent 都可以列出 crew 成员，
   * 但只返回寻址所需的最小字段（id、显示名、驱动、并发上限），
   * 不暴露其他 agent 的指令与工作区路径。父使用保留身份
   * `CREW_PARENT_AGENT_ID` 寻址，不在列表中出现。
   */
  listAgents(actorId: string): CrewAgentSummary[] {
    this.requireKnownActor(actorId, 'actorId');
    return this.store.listAgents().map(agent => ({
      agentId: agent.agentId,
      displayName: agent.displayName,
      driver: agent.driver,
      concurrencyLimit: agent.concurrencyLimit,
    }));
  }

  // ── 父派子：dispatch / 收结果 / interrupt ─────────────────────────────

  /**
   * 父发起一个任务根并投递到目标 agent 的 FIFO 信箱。
   * 只有父可以调用；子 agent 没有任何创建任务根的入口，
   * 因此"禁止把任务退回派单方"由内核保证。每个根请求最多自动派 8 次。
   * 可选 timeoutMs 设定任务期限：重启后超时的未完成任务被恢复流程标记
   * 失败并通知父（见 recoverExpiredTasks / receiveParentNotifications）。
   */
  dispatchTask(input: CrewKernelDispatchInput): CrewTaskRecord {
    this.requireParentActor(input.actorId, 'dispatch task roots');
    return this.store.dispatchTask({
      taskId: input.taskId,
      ...(input.parentTaskId === undefined ? {} : {parentTaskId: input.parentTaskId}),
      ...(input.rootRequestId === undefined ? {} : {rootRequestId: input.rootRequestId}),
      assignedAgentId: input.assignedAgentId,
      goal: input.goal,
      ...(input.timeoutMs === undefined ? {} : {timeoutMs: input.timeoutMs}),
    });
  }

  /** 父收取任务结果（含回执）；子 agent 只能读取分配给自己的任务。 */
  getTask(input: CrewKernelGetTaskInput): CrewTaskRecord | undefined {
    const task = this.store.getTask(input.taskId);
    if (!task) return undefined;
    if (input.actorId !== CREW_PARENT_AGENT_ID && input.actorId !== task.assignedAgentId) {
      throw new CrewError('NOT_PERMITTED', `agent ${input.actorId} may only read its own tasks`);
    }
    return task;
  }

  /**
   * 按条件列出任务：父可按根请求或执行 agent 过滤；
   * 子 agent 只能看到分配给自己的任务，越权过滤直接拒绝。
   */
  listTasks(input: CrewKernelListTasksInput): CrewTaskRecord[] {
    if (input.actorId === CREW_PARENT_AGENT_ID) {
      return this.store.listTasks({
        ...(input.rootRequestId === undefined ? {} : {rootRequestId: input.rootRequestId}),
        ...(input.assignedAgentId === undefined ? {} : {assignedAgentId: input.assignedAgentId}),
      });
    }
    this.requireKnownActor(input.actorId, 'actorId');
    if (input.assignedAgentId !== undefined && input.assignedAgentId !== input.actorId) {
      throw new CrewError('NOT_PERMITTED', `agent ${input.actorId} may only list its own tasks`);
    }
    return this.store.listTasks({
      ...(input.rootRequestId === undefined ? {} : {rootRequestId: input.rootRequestId}),
      assignedAgentId: input.actorId,
    });
  }

  /**
   * 父打断一个排队或运行中的子任务：状态落任务表（cancelled + 原因），
   * 并向执行 agent 的信箱投递 interrupt 消息；两者都随 SQLite 持久，重启不丢。
   * 只有父可以打断。
   */
  interruptTask(input: CrewKernelInterruptInput): CrewTaskRecord {
    this.requireParentActor(input.actorId, 'interrupt child tasks');
    return this.store.cancelTask(input.taskId, input.reason);
  }

  // ── 子执行：领取 / 回执 ───────────────────────────────────────────────

  /**
   * 子 agent 按 FIFO 领取自己最老的排队任务。运行中任务达到上限
   * （系统 2、注册时不超过 2）时返回 undefined，任务保持排队。
   * 父不领取任务。
   */
  claimNextTask(actorId: string): CrewTaskRecord | undefined {
    if (actorId === CREW_PARENT_AGENT_ID) {
      throw new CrewError('NOT_PERMITTED', 'the parent agent does not claim tasks');
    }
    return this.store.claimNextTask(actorId);
  }

  /**
   * 被分配的子 agent 提交固定格式回执并把任务置为终态。
   * 回执属于不可信外部输入：缺 Status/Result/Evidence/Unblock、未知字段、
   * blocked 缺 unblock 等一律拒绝且不产生任何写入。只有任务执行者本人可提交。
   */
  submitReceipt(input: CrewKernelReceiptInput): CrewTaskRecord {
    const task = this.store.getTask(input.taskId);
    if (!task) throw new CrewError('NOT_FOUND', `task ${input.taskId} does not exist`);
    if (input.actorId !== task.assignedAgentId) {
      throw new CrewError('NOT_PERMITTED', `task ${input.taskId} is assigned to ${task.assignedAgentId}; only the assigned agent can submit its receipt`);
    }
    return this.store.completeTask(input.taskId, input.receipt);
  }

  // ── 子间协作：send_message / reply ────────────────────────────────────

  /**
   * agent 间消息投递到收件方的 FIFO 信箱。
   *
   * 【仅受信宿主使用】kernel 对象不暴露给子 agent；子侧只能经工具层
   * （createCrewRuntimeTools，工厂内绑定 actorId）进入这里。
   * `actorId` 必填且必须等于 `fromAgentId`：两者由宿主注入同一可信值，
   * 不一致即视为冒充，抛 NOT_PERMITTED。
   * hop 不接受调用方传入：带 replyToMessageId 时由 store 推导为原消息
   * hop+1，新消息 hop=0；防回环与条数/速率上限由 store 层保证。
   */
  sendMessage(input: CrewKernelSendMessageInput): CrewMessageRecord | undefined {
    if (input.actorId !== input.fromAgentId) {
      throw new CrewError('NOT_PERMITTED', `actorId ${input.actorId} does not match fromAgentId ${input.fromAgentId}; impersonation is not permitted`);
    }
    return this.store.sendMessage({
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      text: input.text,
      ...(input.replyToMessageId === undefined ? {} : {replyToMessageId: input.replyToMessageId}),
      ...(input.parentRequestId === undefined ? {} : {parentRequestId: input.parentRequestId}),
      ...(input.rootRequestId === undefined ? {} : {rootRequestId: input.rootRequestId}),
      ...(input.taskId === undefined ? {} : {taskId: input.taskId}),
      ...(input.expectsReply === undefined ? {} : {expectsReply: input.expectsReply}),
      ...(input.attachmentRefs === undefined ? {} : {attachmentRefs: input.attachmentRefs}),
    });
  }

  /**
   * 回复一条消息：收件人 = 原发送者，parentRequestId / rootRequestId / taskId
   * 沿用原消息，hop 由 store 依据 replyToMessageId 推导为原 hop + 1
   * （超出上限时明确拒绝）。
   * 只有消息当前持有者（收件人）可以回复；父没有信箱，对父发出的消息
   * （任务、打断、父直接消息）应通过固定回执格式汇报结果而不是信箱回复。
   * 纯确认防死循环规则与 sendMessage 相同。
   */
  replyToMessage(input: CrewKernelReplyInput): CrewMessageRecord | undefined {
    const original = this.store.getMessage(input.inReplyToMessageId);
    if (!original) throw new CrewError('NOT_FOUND', `message ${input.inReplyToMessageId} does not exist`);
    if (original.senderAgentId === CREW_PARENT_AGENT_ID) {
      throw new CrewError('UNSUPPORTED', 'mailbox replies to parent-sent messages are not supported; report outcomes through the fixed receipt format (Status/Result/Evidence/Unblock)');
    }
    if (input.actorId !== original.mailboxAgentId) {
      throw new CrewError('NOT_PERMITTED', `message ${input.inReplyToMessageId} belongs to the mailbox of ${original.mailboxAgentId}`);
    }
    return this.store.sendMessage({
      fromAgentId: input.actorId,
      toAgentId: original.senderAgentId,
      text: input.text,
      replyToMessageId: original.messageId,
      ...(input.expectsReply === undefined ? {} : {expectsReply: input.expectsReply}),
      ...(input.attachmentRefs === undefined ? {} : {attachmentRefs: input.attachmentRefs}),
    });
  }

  /** 读取自己的信箱（FIFO，可选 dequeue）。父没有信箱：结果通过回执通道返回。 */
  receiveMessages(actorId: string, options: {limit?: number; dequeue?: boolean} = {}): CrewMessageRecord[] {
    if (actorId === CREW_PARENT_AGENT_ID) {
      throw new CrewError('NOT_PERMITTED', 'the parent agent has no mailbox; results arrive through receipts');
    }
    return this.store.receiveMessages(actorId, options);
  }

  // ── 工作区：每 agent 独立目录 ──────────────────────────────────────────

  /**
   * 创建（幂等）并返回一个 agent 的独立工作区目录 `<workspaceRoot>/agents/<agentId>`。
   * 父可为任意已注册成员创建；子只能创建自己的。
   */
  ensureAgentWorkspace(input: CrewKernelWorkspaceInput): CrewWorkspaceInfo {
    const dir = this.authorizedAgentDir(input.actorId, input.agentId, 'ensure');
    mkdirSync(dir, {recursive: true});
    return {agentId: input.agentId, absolutePath: dir};
  }

  /**
   * 把 agent 工作区内的相对路径解析为绝对路径（不触碰文件系统）。
   * 路径规则与 coding-tools 的 workspace-paths 一致：规范子级片段，拒绝
   * 绝对路径、`..` 穿越、盘符、NUL 与 Windows 歧义段；子只能解析自己的
   * 工作区，越权访问其他 agent 的工作区一律拒绝。
   */
  resolveAgentPath(input: CrewKernelResolveWorkspacePathInput): string {
    const dir = this.authorizedAgentDir(input.actorId, input.agentId, 'resolve paths in');
    return resolveWithinRoot(dir, input.relativePath, 'relativePath').absolutePath;
  }

  // ── 文件交接：共享目录 + SHA-256 清单 ─────────────────────────────────

  /**
   * 发送方视角：解析共享交接目录 `<workspaceRoot>/shared` 内的写入目标路径。
   * 发送方先把文件写到该路径，再调用 publishHandoff 登记。
   */
  resolveHandoffPath(input: {readonly actorId: string; readonly relativePath: string}): string {
    return this.sharedPathFor(input.actorId, input.relativePath).absolutePath;
  }

  /**
   * 发送方登记一条文件交接：内核从共享目录里的真实字节计算大小与 SHA-256
   * （不信任自报值），写入清单。同一 handoffId 或同一 file_path 的重复登记
   * 返回 CONFLICT；文件缺失/非常规文件/超上限返回 INVALID_INPUT。
   */
  publishHandoff(input: CrewKernelPublishHandoffInput): CrewHandoffRecord {
    const {absolutePath, normalized} = this.sharedPathFor(input.actorId, input.filePath);
    const {sizeBytes, sha256} = measureHandoffFile(absolutePath, `handoff file ${normalized}`);
    return this.store.registerHandoff({
      handoffId: input.handoffId,
      filePath: normalized,
      sizeBytes,
      sha256,
      fromAgentId: input.actorId,
      ...(input.taskId === undefined ? {} : {taskId: input.taskId}),
      ...(input.rootRequestId === undefined ? {} : {rootRequestId: input.rootRequestId}),
    });
  }

  /**
   * 接收方校验一条交接：从共享目录重新读取真实字节，与清单中的大小和
   * SHA-256 比对；文件缺失或哈希/大小不一致返回 HANDOFF_REJECTED（拒收），
   * 校验通过才返回可读的绝对路径。清单 id 通常经消息 attachmentRefs 传递。
   */
  receiveHandoff(input: {readonly actorId: string; readonly handoffId: string}): CrewHandoffDelivery {
    this.requireHandoffMember(input.actorId);
    const sharedRoot = this.requireSharedRoot();
    const record = this.store.getHandoff(input.handoffId);
    if (!record) throw new CrewError('NOT_FOUND', `handoff ${input.handoffId} is not registered`);
    const {absolutePath} = resolveWithinRoot(sharedRoot, record.filePath, 'manifest filePath');
    let bytes: Buffer;
    try {
      // 大小与哈希在一条消息里同时报告：任何被篡改的共享文件两者都会变，接收方按真实字节拒收。
      const stat = statSync(absolutePath);
      bytes = readFileSync(absolutePath);
      const sha256OfShared = sha256OfBytes(bytes);
      if (stat.size !== record.sizeBytes || sha256OfShared !== record.sha256) {
        throw new CrewError('HANDOFF_REJECTED', `handoff ${input.handoffId} rejected: sha256 mismatch (manifest ${record.sha256}, shared file ${sha256OfShared}); manifest expects ${record.sizeBytes} bytes but the shared file has ${stat.size}`);
      }
    } catch (error) {
      if (error instanceof CrewError) throw error;
      throw new CrewError('HANDOFF_REJECTED', `handoff ${input.handoffId} rejected: the file is missing from the shared directory`);
    }
    return {handoff: record, absolutePath};
  }

  /** 读取交接清单元数据（不做文件校验）；父或任一成员可读。 */
  getHandoff(input: {readonly actorId: string; readonly handoffId: string}): CrewHandoffRecord | undefined {
    this.requireHandoffMember(input.actorId);
    this.requireSharedRoot();
    return this.store.getHandoff(input.handoffId);
  }

  // ── 重启恢复：超时任务与父信箱 ────────────────────────────────────────

  /**
   * 恢复超时任务：把已过 `deadline_at` 的未完成任务标记 failed（固定回执
   * 格式）并写入父信箱。打开数据库时已自动执行一次（进程重启即恢复）；
   * 长驻进程的宿主可周期性调用。幂等。
   */
  recoverExpiredTasks(): CrewTaskRecord[] {
    return this.store.recoverExpiredTasks();
  }

  /**
   * 父信箱：读取系统通知（当前只有任务超时），回执为固定四段格式。
   * 只有父可以读；子对父的结果仍走 submitReceipt 回执通道。
   */
  receiveParentNotifications(input: {readonly actorId: string; readonly limit?: number; readonly dequeue?: boolean}): CrewParentNotificationRecord[] {
    this.requireParentActor(input.actorId, 'read the parent inbox');
    return this.store.receiveParentNotifications({
      ...(input.limit === undefined ? {} : {limit: input.limit}),
      ...(input.dequeue === undefined ? {} : {dequeue: input.dequeue}),
    });
  }

  /**
   * 消费自己信箱中对应指定任务的最老一条未消费 task 消息（驱动运行时领取任务后
   * 的信箱衔接；P1 语义不变，interrupt 等消息仍由 MCP 工具层消费）。
   * 只有任务执行者本人可以消费；父不消费子的信箱。
   */
  dequeueTaskMessage(actorId: string, taskId: string): CrewMessageRecord | undefined {
    const task = this.store.getTask(taskId);
    if (!task) throw new CrewError('NOT_FOUND', `task ${taskId} does not exist`);
    if (actorId !== task.assignedAgentId) {
      throw new CrewError('NOT_PERMITTED', `task ${taskId} is assigned to ${task.assignedAgentId}; only the assigned agent can consume its mailbox message`);
    }
    return this.store.dequeueTaskMessage(actorId, taskId);
  }

  // ── actor 边界 ────────────────────────────────────────────────────────

  /** actor 必须是父或已注册子 agent；未知身份拒绝。 */
  private requireKnownActor(actorId: string, field: string): void {
    if (typeof actorId !== 'string' || !actorId.trim()) {
      throw new CrewError('INVALID_INPUT', `${field} must be a non-empty string`);
    }
    if (actorId !== CREW_PARENT_AGENT_ID && this.store.getAgent(actorId) === undefined) {
      throw new CrewError('UNKNOWN_AGENT', `agent ${actorId} is not registered`);
    }
  }

  /** 父专属操作：非父 actor（含未注册身份）一律 NOT_PERMITTED。 */
  private requireParentActor(actorId: string, action: string): void {
    if (actorId !== CREW_PARENT_AGENT_ID) {
      throw new CrewError('NOT_PERMITTED', `only the parent agent (${CREW_PARENT_AGENT_ID}) can ${action}`);
    }
  }

  /** 工作区未配置时明确 unavailable，不用假实现冒充。 */
  private requireSharedRoot(): string {
    if (this.sharedRoot === undefined) {
      throw new CrewError('UNSUPPORTED', 'crew workspaces and handoff are unavailable: no workspaceRoot was configured when opening the kernel');
    }
    return this.sharedRoot;
  }

  /**
   * 工作区目录的授权入口：子只能操作自己的工作区，父可为任意已注册成员
   * 操作；agentId 必须是单一路径片段，未注册身份拒绝。
   */
  private authorizedAgentDir(actorId: string, agentId: string, action: string): string {
    if (this.agentsRoot === undefined) {
      throw new CrewError('UNSUPPORTED', 'crew workspaces are unavailable: no workspaceRoot was configured when opening the kernel');
    }
    if (actorId !== CREW_PARENT_AGENT_ID && actorId !== agentId) {
      throw new CrewError('NOT_PERMITTED', `agent ${actorId} may only ${action} its own workspace`);
    }
    if (this.store.getAgent(agentId) === undefined) {
      throw new CrewError('UNKNOWN_AGENT', `agent ${agentId} is not registered`);
    }
    return join(this.agentsRoot, singleSegment(agentId, 'agentId'));
  }

  /** 共享交接目录的发送方授权：只有已注册子 agent 发布/解析交接路径。 */
  private sharedPathFor(actorId: string, relativePath: string): {absolutePath: string; normalized: string} {
    const sharedRoot = this.requireSharedRoot();
    if (actorId === CREW_PARENT_AGENT_ID) {
      throw new CrewError('NOT_PERMITTED', 'the parent agent does not publish handoffs; it dispatches goals and collects receipts');
    }
    if (this.store.getAgent(actorId) === undefined) {
      throw new CrewError('UNKNOWN_AGENT', `agent ${actorId} is not registered`);
    }
    return resolveWithinRoot(sharedRoot, relativePath, 'filePath');
  }

  /** 交接的读侧成员校验：父或任一已注册成员都可以接收/查看清单。 */
  private requireHandoffMember(actorId: string): void {
    if (actorId !== CREW_PARENT_AGENT_ID && this.store.getAgent(actorId) === undefined) {
      throw new CrewError('UNKNOWN_AGENT', `agent ${actorId} is not registered`);
    }
  }
}

/** `list_agents` 面向成员的精简视图：不含其他 agent 的指令与工作区路径。 */
export interface CrewAgentSummary {
  readonly agentId: string;
  readonly displayName: string;
  readonly driver: CrewDriverId;
  readonly concurrencyLimit: number;
}

export interface CrewKernelOptions {
  readonly now?: () => number;
  /**
   * 受信工作区根目录；提供后启用每 agent 独立工作区（`<root>/agents/<agentId>`）
   * 与共享交接目录（`<root>/shared`）。缺省时工作区与文件交接明确 unavailable。
   */
  readonly workspaceRoot?: string;
}

/** agent 工作区的物化结果。 */
export interface CrewWorkspaceInfo {
  readonly agentId: string;
  readonly absolutePath: string;
}

/** 接收校验通过后的交接投递：清单记录 + 接收方可读的绝对路径。 */
export interface CrewHandoffDelivery {
  readonly handoff: CrewHandoffRecord;
  readonly absolutePath: string;
}

export interface CrewKernelWorkspaceInput {
  readonly actorId: string;
  readonly agentId: string;
}

export interface CrewKernelResolveWorkspacePathInput {
  readonly actorId: string;
  readonly agentId: string;
  readonly relativePath: string;
}

export interface CrewKernelPublishHandoffInput {
  readonly actorId: string;
  readonly handoffId: string;
  /** 共享交接目录内的规范化相对路径。 */
  readonly filePath: string;
  readonly taskId?: string;
  readonly rootRequestId?: string;
}

export type CrewKernelDispatchInput = CrewDispatchInput & {readonly actorId: string};

/**
 * sendMessage 的内核入参。`actorId` 与 `fromAgentId` 必须一致；
 * kernel 仅受信宿主使用，子侧只能经工具层绑定身份，不接受模型自报身份。
 */
export interface CrewKernelSendMessageInput {
  readonly actorId: string;
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly text: string;
  /** hop 由 store 依据该消息推导，不接受调用方自填。 */
  readonly replyToMessageId?: number;
  readonly parentRequestId?: string;
  readonly rootRequestId?: string;
  readonly taskId?: string;
  readonly expectsReply?: boolean;
  readonly attachmentRefs?: readonly string[];
}

export interface CrewKernelGetTaskInput {
  readonly actorId: string;
  readonly taskId: string;
}

export interface CrewKernelListTasksInput {
  readonly actorId: string;
  readonly rootRequestId?: string;
  readonly assignedAgentId?: string;
}

export interface CrewKernelInterruptInput {
  readonly actorId: string;
  readonly taskId: string;
  readonly reason: string;
}

export interface CrewKernelReceiptInput {
  readonly actorId: string;
  readonly taskId: string;
  /** 不可信外部输入，由固定回执格式校验。 */
  readonly receipt: unknown;
}

export interface CrewKernelReplyInput {
  readonly actorId: string;
  readonly inReplyToMessageId: number;
  readonly text: string;
  readonly expectsReply?: boolean;
  readonly attachmentRefs?: readonly string[];
}

/** 打开 crew 协作内核的公开工厂。 */
export function openCrewKernel(path: string, options: CrewKernelOptions = {}): CrewKernel {
  return CrewKernel.open(path, options);
}

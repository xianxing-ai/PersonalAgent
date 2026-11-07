import {CrewError} from './errors.js';
import {
  CrewStore,
  CREW_PARENT_AGENT_ID,
  type CrewAgentRecord,
  type CrewAgentSpec,
  type CrewDispatchInput,
  type CrewDriverId,
  type CrewMessageRecord,
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
export class CrewKernel {
  private readonly store: CrewStore;

  private constructor(store: CrewStore) {
    this.store = store;
  }

  /** 打开（必要时创建）独立的 crew 数据库并返回内核；数据库与 Runtime 主库分离。 */
  static open(path: string, options: CrewKernelOptions = {}): CrewKernel {
    const storeOptions: CrewStoreOptions = options.now === undefined ? {} : {now: options.now};
    return new CrewKernel(CrewStore.open(path, storeOptions));
  }

  close(): void {
    this.store.close();
  }

  // ── 注册表：宿主管理入口 ────────────────────────────────────────────────

  /** 注册一个命名子 agent（宿主管理操作；`parent` 为保留身份不可注册）。 */
  registerAgent(spec: CrewAgentSpec): CrewAgentRecord {
    return this.store.registerAgent(spec);
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
   */
  dispatchTask(input: CrewKernelDispatchInput): CrewTaskRecord {
    this.requireParentActor(input.actorId, 'dispatch task roots');
    return this.store.dispatchTask({
      taskId: input.taskId,
      ...(input.parentTaskId === undefined ? {} : {parentTaskId: input.parentTaskId}),
      ...(input.rootRequestId === undefined ? {} : {rootRequestId: input.rootRequestId}),
      assignedAgentId: input.assignedAgentId,
      goal: input.goal,
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

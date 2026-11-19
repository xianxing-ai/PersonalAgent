import {CrewError} from './errors.js';
import {CrewKernel} from './kernel.js';
import {CrewDriverRuntime} from './runtime.js';
import {CREW_PARENT_AGENT_ID} from './store.js';

/**
 * Runtime 工具适配器（P5）：把 crew 的 dispatch、send_message、list_agents、interrupt
 * 暴露成与 Runtime 现有 `RegisteredTool` 同形状的对象。
 *
 * 参照对象（本 PR 只读核对过，未改动）：
 * - `packages/contracts/src/ports.ts` 的 `RegisteredTool` / `ToolContext`：apps/runtime
 *   经 `@personal-agent/contracts` 消费的正是这两个类型
 *   （例如 `apps/runtime/src/application/runtime-application.ts` 的
 *   `createSubagentDispatchTool(modelGatewayFactory?): RegisteredTool`）。
 * - `packages/agents/src/index.ts` 的 `createSubagentDispatchTool(handler): RegisteredTool`
 *   （`subagent.dispatch`）：本适配器沿用同一工厂模式——descriptor（name/version/
 *   inputSchema/outputSchema/sideEffect/requiredScopes/idempotencySupport/
 *   recoverySupport/requiresPresence）+ `execute(input, context)`。
 *
 * crew 不能 import apps/runtime，也不引入 contracts 依赖（保持本包"只依赖
 * @personal-agent/storage"的边界），因此在下方逐字段镜像定义结构兼容的本地接口；
 * 结构兼容性由 `test/runtime-tools.test.mjs` 的形状镜像测试证明。最终与真实
 * contracts 类型的编译期核对发生在 apps/runtime 接线时（见
 * packages/crew/docs/crew-integration.md）。
 *
 * 边界与语义：
 * - 本适配器只做宿主侧"信使"：参数校验 → 调用 P1 内核 / P2 驱动运行时 → 投影
 *   成与 outputSchema 一致的返回值。actor 边界仍由内核强制（dispatch/interrupt
 *   只有父可以调用，非父 NOT_PERMITTED）。
 * - actor 绑定：工具以工厂参数 `actorId` 的身份执行（受信宿主在注册时决定，
 *   不信任模型输入）。派发/打断用 `CREW_PARENT_AGENT_ID` 之外的身份会被内核拒绝；
 *   `send_message` 以 `actorId` 为发送者；hop 由 store 依据 replyToMessageId 推导，工具层不再自填。
 * - 订阅同意门：`crew.dispatch` 在入队之前检查目标 agent 驱动的同意记录，
 *   未同意/已撤销抛 `CONSENT_REQUIRED`，任务不入队、信箱无写入（运行时
 *   `runNextTask` 的同意门保持不变，两层防御）。
 * - 错误形状：所有失败都是 `CrewError`（`code` + `[CODE] message`），不吞错、
 *   不把失败包装成成功返回值。
 * - `execute(input, context)` 双形参与 `RegisteredTool` 签名一致：`context`
 *   按 contracts 形状接收（取消/授权仍由 Gateway 在其一侧生效），crew 的四个
 *   操作都是同步 SQLite 事务，本 PR 不消费 context 字段。
 * - 本适配器不创建 Runtime 子任务、不注册到 ToolGateway：apps/runtime 的接线
 *   归 goo122（docs/crew-integration.md 给出具体位置与伪代码）。
 */

// ── 与 contracts 结构兼容的本地镜像类型 ────────────────────────────────────

/**
 * 镜像 `packages/contracts/src/generated.ts` 的 `ToolDescriptor`（协议契约的 `tool` 条目）。
 * 字段逐一对应；`requiredScopes` 保持可变数组（与 contracts 相同），保证接线时
 * 双向结构兼容（readonly 数组不能赋给可变数组类型）。
 */
export interface CrewToolDescriptor {
  readonly name: string;
  readonly version: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema: Record<string, unknown>;
  readonly sideEffect: 'read' | 'local_write' | 'external_write';
  requiredScopes: string[];
  readonly idempotencySupport: boolean;
  readonly recoverySupport: boolean;
  readonly requiresPresence: boolean;
}

/**
 * 镜像 `packages/contracts/src/ports.ts` 的 `ToolContext`（ToolGateway.invoke 构建，
 * 见 `packages/tool-gateway/src/index.ts` 的 `invoke`）。本适配器不消费其中的
 * 授权字段：crew 的 actor 边界在内核、授权决定仍由 Policy 在 Gateway 处做出。
 */
export interface CrewToolContext {
  readonly taskId: string;
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly deadline: string;
  readonly authorizationRef: string;
  readonly argumentsDigest?: string;
  readonly scopes: readonly string[];
}

/**
 * 镜像 `packages/contracts/src/ports.ts` 的 `RegisteredTool`。
 * `descriptor` + `execute(input: unknown, context: ToolContext): Promise<unknown>`，
 * 与 `subagent.dispatch`（packages/agents/src/index.ts）同一形状。
 */
export interface CrewRegisteredTool {
  readonly descriptor: CrewToolDescriptor;
  execute(input: unknown, context: CrewToolContext): Promise<unknown>;
}

// ── 工具名与版本 ─────────────────────────────────────────────────────────

export const CREW_DISPATCH_TOOL_NAME = 'crew.dispatch';
export const CREW_SEND_MESSAGE_TOOL_NAME = 'crew.send_message';
export const CREW_LIST_AGENTS_TOOL_NAME = 'crew.list_agents';
export const CREW_INTERRUPT_TOOL_NAME = 'crew.interrupt';
/** 四个工具共用同一版本号；语义变化时一起升版（对齐 subagent.dispatch 的 1.0.0）。 */
export const CREW_TOOL_VERSION = '1.0.0';

/** list_agents 输出里的 driver 枚举，与 store 的 CREW_DRIVER_IDS 一致（固定进契约）。 */
const TOOL_DRIVER_IDS: readonly string[] = ['codex', 'claude', 'opencode', 'grok', 'gemini', 'acp-generic'];

// ── 输入校验（additionalProperties: false 的运行时对等物） ─────────────────

interface ToolInputFields {
  readonly required: readonly string[];
  readonly optional: readonly string[];
}

function parseToolInput(toolName: string, input: unknown, fields: ToolInputFields): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new CrewError('INVALID_INPUT', `${toolName} input must be an object`);
  }
  const record = input as Record<string, unknown>;
  const allowed = new Set([...fields.required, ...fields.optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new CrewError('INVALID_INPUT', `${toolName} input has unknown field ${key}`);
    }
  }
  for (const key of fields.required) {
    if (record[key] === undefined) {
      throw new CrewError('INVALID_INPUT', `${toolName} input is missing required field ${key}`);
    }
  }
  return record;
}

function requireStringField(record: Record<string, unknown>, field: string, toolName: string): string {
  const value = record[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new CrewError('INVALID_INPUT', `${toolName} input.${field} must be a non-empty string`);
  }
  return value;
}

function optionalStringField(record: Record<string, unknown>, field: string, toolName: string): string | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  return requireStringField(record, field, toolName);
}

function optionalBooleanField(record: Record<string, unknown>, field: string, toolName: string): boolean | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new CrewError('INVALID_INPUT', `${toolName} input.${field} must be a boolean`);
  }
  return value;
}

function optionalStringArrayField(record: Record<string, unknown>, field: string, toolName: string): readonly string[] | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new CrewError('INVALID_INPUT', `${toolName} input.${field} must be an array of strings`);
  }
  return value.map(item => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new CrewError('INVALID_INPUT', `${toolName} input.${field} entries must be non-empty strings`);
    }
    return item;
  });
}

// ── 返回值投影（与 outputSchema 逐一对应，多余的键一律不带出） ─────────────

function dispatchOutput(task: {readonly taskId: string; readonly rootRequestId: string; readonly assignedAgentId: string; readonly goal: string; readonly status: string; readonly createdAt: string}): unknown {
  return {
    taskId: task.taskId,
    rootRequestId: task.rootRequestId,
    assignedAgentId: task.assignedAgentId,
    goal: task.goal,
    status: task.status,
    createdAt: task.createdAt,
  };
}

function messageOutput(record: {
  readonly messageId: number;
  readonly mailboxAgentId: string;
  readonly senderAgentId: string;
  readonly kind: string;
  readonly text: string;
  readonly expectsReply: boolean;
  readonly hop: number;
  readonly pureAck: boolean;
  readonly enqueuedAt: string;
}): unknown {
  return {
    messageId: record.messageId,
    mailboxAgentId: record.mailboxAgentId,
    senderAgentId: record.senderAgentId,
    kind: record.kind,
    text: record.text,
    expectsReply: record.expectsReply,
    hop: record.hop,
    pureAck: record.pureAck,
    enqueuedAt: record.enqueuedAt,
  };
}

// ── 工厂 ─────────────────────────────────────────────────────────────────

export interface CrewRuntimeToolsOptions {
  /** P2 驱动运行时：提供 dispatchTask / interruptTask（含 CLI 会话转发）/ listAgents / getAgent。 */
  readonly runtime: CrewDriverRuntime;
  /**
   * P1 协作内核：提供 send_message（信箱写入）与订阅同意门（kernel.consent）。
   * 必须与 runtime 打开同一个 crew SQLite 文件（CrewDriverRuntime.open 内部自建
   * 内核、不外露，因此信箱操作经由宿主另开的内核；packages/crew 既有测试对同一
   * 文件同时打开 runtime 与 kernel，即本适配器假设的宿主装配方式）。
   */
  readonly kernel: CrewKernel;
  /**
   * 受信宿主绑定的 actor 身份：工具代表谁执行。`crew.dispatch` / `crew.interrupt`
   * 需要父身份（内核强制）；`crew.send_message` 以它为发送者；
   * `crew.list_agents` 以它为查询者。
   */
  readonly actorId: string;
}

export interface CrewRuntimeTools {
  /** 父派子：入队一个任务根（含订阅同意门）。 */
  readonly dispatch: CrewRegisteredTool;
  /** agent 间消息：投递到目标 agent 的 FIFO 信箱（纯确认防死循环规则不变）。 */
  readonly sendMessage: CrewRegisteredTool;
  /** 成员列表：只含寻址所需最小字段（id、显示名、驱动、并发上限）。 */
  readonly listAgents: CrewRegisteredTool;
  /** 父打断：落任务表 + 信箱 interrupt 消息，并转发给运行中的 CLI 会话。 */
  readonly interrupt: CrewRegisteredTool;
  /** 便捷注册用数组（顺序固定：dispatch、send_message、list_agents、interrupt）。 */
  readonly tools: readonly CrewRegisteredTool[];
}

/**
 * 构建与 Runtime `RegisteredTool` 同形状的 crew 工具集。
 *
 * 调用方（受信宿主）：
 * ```ts
 * const runtime = openCrewDriverRuntime(crewDbPath);
 * const kernel = openCrewKernel(crewDbPath);
 * const tools = createCrewRuntimeTools({runtime, kernel, actorId: CREW_PARENT_AGENT_ID});
 * // tools.tools 逐个交给 ToolHost.register(...)（apps/runtime 接线见 docs/crew-integration.md）
 * ```
 */
export function createCrewRuntimeTools(options: CrewRuntimeToolsOptions): CrewRuntimeTools {
  const runtime = options.runtime;
  const kernel = options.kernel;
  const actorId = options.actorId;
  if (typeof actorId !== 'string' || !actorId.trim()) {
    throw new CrewError('INVALID_INPUT', 'actorId must be a non-empty string');
  }

  // ── crew.dispatch ────────────────────────────────────────────────────
  const dispatch: CrewRegisteredTool = {
    descriptor: {
      name: CREW_DISPATCH_TOOL_NAME,
      version: CREW_TOOL_VERSION,
      inputSchema: {
        type: 'object',
        properties: {
          taskId: {type: 'string', minLength: 1},
          assignedAgentId: {type: 'string', minLength: 1},
          goal: {type: 'string', minLength: 1},
          // rootRequestId 若仍传入则忽略：根绑定到 context.taskId（F3）。
          rootRequestId: {type: 'string', minLength: 1},
        },
        required: ['taskId', 'assignedAgentId', 'goal'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          taskId: {type: 'string'},
          rootRequestId: {type: 'string'},
          assignedAgentId: {type: 'string'},
          goal: {type: 'string'},
          status: {type: 'string', enum: ['queued']},
          createdAt: {type: 'string'},
        },
        required: ['taskId', 'rootRequestId', 'assignedAgentId', 'goal', 'status', 'createdAt'],
        additionalProperties: false,
      },
      // 写 crew SQLite（任务行 + 信箱消息）。重复 taskId 报 CONFLICT 而不是幂等重放。
      sideEffect: 'local_write',
      requiredScopes: ['agent:delegate'],
      idempotencySupport: false,
      recoverySupport: false,
      requiresPresence: false,
    },
    execute: async (rawInput, context) => {
      const input = parseToolInput(CREW_DISPATCH_TOOL_NAME, rawInput, {
        required: ['taskId', 'assignedAgentId', 'goal'],
        optional: ['rootRequestId'],
      });
      const assignedAgentId = requireStringField(input, 'assignedAgentId', CREW_DISPATCH_TOOL_NAME);
      const agent = runtime.getAgent(assignedAgentId);
      if (!agent) {
        throw new CrewError('UNKNOWN_AGENT', `agent ${assignedAgentId} is not registered`);
      }
      // 订阅同意门（在入队之前）：未同意/已撤销时拒绝，任务不入队、信箱无写入。
      kernel.consent.requireGranted(agent.driver);
      // F3：rootRequestId 绑定宿主可信的 context.taskId，忽略模型自报值。
      // store 层也会忽略自报根并按 parentTaskId 派生；这里仍把可信根写入入参以对齐文档 §2.3。
      const boundRootRequestId = context.taskId;
      const task = runtime.dispatchTask({
        actorId,
        taskId: requireStringField(input, 'taskId', CREW_DISPATCH_TOOL_NAME),
        rootRequestId: boundRootRequestId,
        assignedAgentId,
        goal: requireStringField(input, 'goal', CREW_DISPATCH_TOOL_NAME),
      });
      return dispatchOutput(task);
    },
  };

  // ── crew.send_message ────────────────────────────────────────────────
  const sendMessage: CrewRegisteredTool = {
    descriptor: {
      name: CREW_SEND_MESSAGE_TOOL_NAME,
      version: CREW_TOOL_VERSION,
      inputSchema: {
        type: 'object',
        properties: {
          toAgentId: {type: 'string', minLength: 1},
          text: {type: 'string', minLength: 1},
          parentRequestId: {type: 'string', minLength: 1},
          rootRequestId: {type: 'string', minLength: 1},
          taskId: {type: 'string', minLength: 1},
          replyToMessageId: {type: 'integer', minimum: 1},
          expectsReply: {type: 'boolean'},
          attachmentRefs: {type: 'array', items: {type: 'string', minLength: 1}},
        },
        required: ['toAgentId', 'text'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          delivered: {type: 'boolean'},
          message: {
            type: 'object',
            properties: {
              messageId: {type: 'integer'},
              mailboxAgentId: {type: 'string'},
              senderAgentId: {type: 'string'},
              kind: {type: 'string', enum: ['message']},
              text: {type: 'string'},
              expectsReply: {type: 'boolean'},
              hop: {type: 'integer'},
              pureAck: {type: 'boolean'},
              enqueuedAt: {type: 'string'},
            },
            required: ['messageId', 'mailboxAgentId', 'senderAgentId', 'kind', 'text', 'expectsReply', 'hop', 'pureAck', 'enqueuedAt'],
            additionalProperties: false,
          },
        },
        required: ['delivered'],
        additionalProperties: false,
      },
      sideEffect: 'local_write',
      requiredScopes: ['agent:delegate'],
      idempotencySupport: false,
      recoverySupport: false,
      requiresPresence: false,
    },
    execute: async (rawInput, context) => {
      const input = parseToolInput(CREW_SEND_MESSAGE_TOOL_NAME, rawInput, {
        required: ['toAgentId', 'text'],
        optional: ['parentRequestId', 'rootRequestId', 'taskId', 'replyToMessageId', 'expectsReply', 'attachmentRefs'],
      });
      const parentRequestId = optionalStringField(input, 'parentRequestId', CREW_SEND_MESSAGE_TOOL_NAME);
      const rootRequestId = optionalStringField(input, 'rootRequestId', CREW_SEND_MESSAGE_TOOL_NAME);
      const taskId = optionalStringField(input, 'taskId', CREW_SEND_MESSAGE_TOOL_NAME);
      const expectsReply = optionalBooleanField(input, 'expectsReply', CREW_SEND_MESSAGE_TOOL_NAME);
      const attachmentRefs = optionalStringArrayField(input, 'attachmentRefs', CREW_SEND_MESSAGE_TOOL_NAME);
      const replyToRaw = input.replyToMessageId;
      const replyToMessageId = replyToRaw === undefined ? undefined : (() => {
        if (typeof replyToRaw !== 'number' || !Number.isInteger(replyToRaw) || replyToRaw < 1) {
          throw new CrewError('INVALID_INPUT', `${CREW_SEND_MESSAGE_TOOL_NAME}.replyToMessageId must be a positive integer`);
        }
        return replyToRaw;
      })();
      // F4：hop 全部交由 store 推导（replyToMessageId → hop+1，否则 hop=0）；工具层不再自填。
      const record = kernel.sendMessage({
        actorId,
        fromAgentId: actorId,
        toAgentId: requireStringField(input, 'toAgentId', CREW_SEND_MESSAGE_TOOL_NAME),
        text: requireStringField(input, 'text', CREW_SEND_MESSAGE_TOOL_NAME),
        ...(replyToMessageId === undefined ? {} : {replyToMessageId}),
        ...(parentRequestId === undefined ? {} : {parentRequestId}),
        ...(rootRequestId === undefined ? {} : {rootRequestId}),
        ...(taskId === undefined ? {} : {taskId}),
        ...(expectsReply === undefined ? {} : {expectsReply}),
        ...(attachmentRefs === undefined ? {} : {attachmentRefs}),
      });
      // 纯确认防死循环：连续第二条纯确认被丢弃（undefined），以 delivered:false 表达。
      return record === undefined ? {delivered: false} : {delivered: true, message: messageOutput(record)};
    },
  };

  // ── crew.list_agents ─────────────────────────────────────────────────
  const listAgents: CrewRegisteredTool = {
    descriptor: {
      name: CREW_LIST_AGENTS_TOOL_NAME,
      version: CREW_TOOL_VERSION,
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          agents: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                agentId: {type: 'string'},
                displayName: {type: 'string'},
                driver: {type: 'string', enum: [...TOOL_DRIVER_IDS]},
                concurrencyLimit: {type: 'integer', minimum: 1, maximum: 2},
              },
              required: ['agentId', 'displayName', 'driver', 'concurrencyLimit'],
              additionalProperties: false,
            },
          },
        },
        required: ['agents'],
        additionalProperties: false,
      },
      // 只读；内核的 listAgents 视图不暴露其他 agent 的指令与工作区路径。
      sideEffect: 'read',
      requiredScopes: ['agent:delegate'],
      idempotencySupport: true,
      recoverySupport: true,
      requiresPresence: false,
    },
    execute: async (rawInput, context) => {
      // 只接受空对象（模型常传 {}）；任何字段都按未知字段拒绝。
      parseToolInput(CREW_LIST_AGENTS_TOOL_NAME, rawInput ?? {}, {required: [], optional: []});
      return {
        agents: runtime.listAgents(actorId).map(agent => ({
          agentId: agent.agentId,
          displayName: agent.displayName,
          driver: agent.driver,
          concurrencyLimit: agent.concurrencyLimit,
        })),
      };
    },
  };

  // ── crew.interrupt ───────────────────────────────────────────────────
  const interrupt: CrewRegisteredTool = {
    descriptor: {
      name: CREW_INTERRUPT_TOOL_NAME,
      version: CREW_TOOL_VERSION,
      inputSchema: {
        type: 'object',
        properties: {
          taskId: {type: 'string', minLength: 1},
          reason: {type: 'string', minLength: 1},
        },
        required: ['taskId', 'reason'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          taskId: {type: 'string'},
          status: {type: 'string', enum: ['cancelled']},
          cancelReason: {type: 'string'},
          finishedAt: {type: 'string'},
        },
        required: ['taskId', 'status', 'cancelReason', 'finishedAt'],
        additionalProperties: false,
      },
      sideEffect: 'local_write',
      requiredScopes: ['agent:delegate'],
      // 已终态任务再次打断报 CONFLICT，不是幂等重放。
      idempotencySupport: false,
      recoverySupport: false,
      requiresPresence: false,
    },
    execute: async (rawInput, context) => {
      const input = parseToolInput(CREW_INTERRUPT_TOOL_NAME, rawInput, {
        required: ['taskId', 'reason'],
        optional: [],
      });
      // 驱动运行时版本：先落任务表 + 信箱（持久），再把打断转发给运行中的 CLI 会话。
      const task = await runtime.interruptTask({
        actorId,
        taskId: requireStringField(input, 'taskId', CREW_INTERRUPT_TOOL_NAME),
        reason: requireStringField(input, 'reason', CREW_INTERRUPT_TOOL_NAME),
      });
      return {
        taskId: task.taskId,
        status: task.status,
        cancelReason: task.cancelReason ?? '',
        finishedAt: task.finishedAt ?? '',
      };
    },
  };

  return {dispatch, sendMessage, listAgents, interrupt, tools: [dispatch, sendMessage, listAgents, interrupt]};
}

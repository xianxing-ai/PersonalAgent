# Crew 子智能体协作底座（P0 存储原语 + P1 协作内核）

负责人 `zemeng`（GitHub：`zemeng5208`）。本包是[子智能体协作体系设计](https://github.com/xianxing-ai/PersonalAgent)的 crew 纵向切片：P0（#554）交付命名 agent 注册表、独立 SQLite 任务表、每 agent 持久 FIFO 信箱与固定回执格式；本 PR 在其上交付 P1 协作内核（actor 边界 + dispatch / interrupt / 子间消息）。协作与评审规则以 [CONTRIBUTING](../../CONTRIBUTING.md) 和 [AGENTS](../../AGENTS.md) 为准；模块归属以 [MODULE_ASSIGNMENTS](../../docs/MODULE_ASSIGNMENTS.md) 为准。

## 当前范围（本 PR：P1 协作内核）

在 #554 存储原语之上新增 `CrewKernel`（`src/kernel.ts`）：内核只做行为层，不复制状态，存储唯一事实来源仍是 `CrewStore`。把"谁能做什么"变成可执行检查，而不是留给将来的工具宿主自觉遵守；将来本地 MCP 工具（send_message / list_agents / interrupt_agent）与驱动层的每次工具调用都对应一次内核调用。

- **父派子 dispatch 接口**：始终有一个主父 agent（保留身份 `parent`）。`kernel.dispatchTask` 只有父能调（子 agent 没有任何创建任务根的入口，"禁止把任务退回派单方"由内核保证）；`kernel.getTask` / `listTasks` 父收结果（子只能读分配给自己的任务）；`kernel.interruptTask` 只有父能打断排队或运行中的子任务——状态落任务表（`cancelled` + 原因）并向执行 agent 信箱投递 `interrupt` 消息，随 SQLite 持久，重启不丢（有测试）。
- **子执行链路**：`kernel.claimNextTask`（FIFO 领取，并发满返回 undefined 任务保持排队）、`kernel.submitReceipt`（只有被分配的子 agent 能提交；回执按不可信外部输入校验，不合规原样拒绝且不产生任何写入）。
- **子间 send_message / list_agents**：子间互发消息不设限制，但都走信箱并受上限约束。`kernel.sendMessage` 保留 `expectsReply` 防确认回环字段与连续纯确认丢弃规则，并强制 hop 语义（0 为父派发链保留，子发起至少 1 跳）；`kernel.replyToMessage` 按原消息路由回发送者、沿用 parentRequestId / rootRequestId / taskId、hop+1 且超出 `MAX_MESSAGE_HOP` 明确拒绝；父没有信箱，子对父派任务的结果一律走固定回执格式（对父发消息的信箱回复明确 `UNSUPPORTED`）。`kernel.listAgents` 是 `list_agents` 工具视图：父或子都可列出成员，但只返回寻址所需最小字段（id / 显示名 / 驱动 / 并发上限），不暴露其他 agent 的指令与工作区路径。
- **上限约束（超限明确报错，有测试）**：每根请求最多自动派 8 次，第 9 次 `DISPATCH_LIMIT_EXCEEDED`；单 agent 同时最多 2 个运行中任务（系统上限 2，注册时不得更高），第 3 个保持排队；消息 `hop ≤ 8`。
- **回执格式校验（有测试）**：缺 Status/Result/Evidence/Unblock、未知字段、`blocked` 缺 `unblock`、终态带非空 `unblock`、非对象等一律 `INVALID_INPUT` 且任务状态不变。
- **对 #554 的最小增量**：`CrewStore.getMessage`（按 id 取消息，供回复路由）；错误码新增 `NOT_PERMITTED`（对齐仓库统一错误分类的"未授权"）。P0 既有方法签名与语义不变。

## 未做（保持 unavailable，不用假实现冒充）

- **驱动层（Claude/Codex/Grok、opencode acp、codex app-server 等 ACP / app-server 客户端）**：driver 目前只是注册表里的枚举字段，不 spawn 任何进程。留后续 PR。
- **`subagent.dispatch` 接线**：本包尚未注册为 `RegisteredTool`，未接入 Runtime/ToolGateway/Policy；任务到 Runtime 子任务的映射留待接线 PR。
- **互审编排、文件交接 manifest、共享交接目录、按 agent 的持久 worktree 隔离**：按设计页分期留后续 PR。
- **协作工具的本地 MCP 注入与前端 agent 列表/信箱视图**：内核已备好 actor 校验的调用面，注入与 UI 接线留后续 PR。

## 使用

```sh
npm run build --workspace=@personal-agent/crew
npm run test --workspace=@personal-agent/crew
npm run typecheck --workspace=@personal-agent/crew
```

```ts
import {openCrewKernel, CREW_PARENT_AGENT_ID} from '@personal-agent/crew';

const kernel = openCrewKernel('/data/crew.sqlite');
kernel.registerAgent({agentId: 'coder-x', displayName: '编码者', driver: 'codex', instructions: '…', workspacePath: '/workspace/crew/coder-x'});
kernel.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '修复类型错误'});
const task = kernel.claimNextTask('coder-x');
kernel.submitReceipt({actorId: 'coder-x', taskId: task.taskId, receipt: {status: 'succeeded', result: '…', evidenceRefs: ['commit:…'], unblock: ''}});
const collected = kernel.getTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1'});
kernel.close();
```

生产代码只应通过公开入口 `@personal-agent/crew` 使用本包；协作操作一律走 `CrewKernel`，宿主管理（注册、审计）可直接用 `CrewStore`。数据库文件与 Runtime 主库完全独立；复用 `@personal-agent/storage` 的有序迁移（版本 1 建表，STRICT 表 + 外键 + WAL，校验和账本）。

## 技术取舍

- 只依赖 `@personal-agent/storage`（迁移底座），不依赖 contracts/apps；将来作为普通 `RegisteredTool` 接入时再声明所需契约，不改 Runtime 公共契约。
- 内核与存储分两层：actor 边界是行为约定（同进程内可信宿主传入 actorId），不引入独立的认证机制；真正面向子 CLI 的认证边界在将来的本地 MCP 注入层。
- 纯确认白名单刻意收窄（整条消息去标点后恰好等于固定短语才算），宁可多放行也不误删带内容的回复；抑制按"发送→收件方向"链生效。
- 测试只覆盖本包行为（SQLite 临时库 + 可注入时钟，29 条），不证明任何真实 CLI 已连通。

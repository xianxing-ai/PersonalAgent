# Crew 子智能体协作底座（P0 第一步）

负责人 `zemeng`（GitHub：`zemeng5208`）。本包是[子智能体协作体系设计](https://github.com/xianxing-ai/PersonalAgent) P0 的第一个纵向切片：命名 agent 注册表、独立 SQLite 任务表、每 agent 持久 FIFO 信箱与固定回执格式。协作与评审规则以 [CONTRIBUTING](../../CONTRIBUTING.md) 和 [AGENTS](../../AGENTS.md) 为准；模块归属以 [MODULE_ASSIGNMENTS](../../docs/MODULE_ASSIGNMENTS.md) 为准。

## 当前范围（本 PR）

只包含包骨架 + 任务表 + 每 agent 持久队列 + 固定回执格式 + 测试：

- **命名 agent 注册表（最小）**：`registerAgent` / `listAgents` / `getAgent`。每条记录含 id、显示名、driver（`codex` / `claude` / `opencode` / `grok` / `gemini` / `acp-generic`）、指令、工作区路径、并发上限（1..2）。主 agent 使用保留身份 `parent`（`CREW_PARENT_AGENT_ID`），不可注册。
- **任务表**：`dispatchTask` 只能由父（`parent`）发起任务根——子 agent 在本包内没有任何创建任务根的入口，因此"禁止把任务退回派单方"由构造保证。任务状态机：`queued → running → succeeded | failed | blocked | cancelled`。
- **每 agent 持久 FIFO 信箱**：`sendMessage`（agent↔agent，父可用保留身份发送）、`receiveMessages`（FIFO，可选 dequeue 标记已消费；未消费消息跨重启保留，已消费行保留 `dequeuedAt` 供审计）。任务派发与打断也会投递 `task` / `interrupt` 消息。
- **固定回执格式**：`parseCrewReceipt` 强制 Status / Result / Evidence / Unblock 四段：`blocked` 必填 `unblock`（如何才能继续），终态必须为空；`result` 不允许为空；未知字段拒绝。回执来自子 agent，按不可信外部输入在运行时校验，校验失败不产生任何写入。
- **上限约束**：每个根请求最多自动派 8 次（第 9 次 `DISPATCH_LIMIT_EXCEEDED`）；单 agent 同时最多 2 个运行中任务（第 3 个保持排队）；消息转发深度 `hop ≤ 8`。
- **防确认死循环**：对同一发送→收件方向，连续第二条纯确认消息（`isPureAcknowledgement`，刻意收窄的白名单）直接丢弃并返回 `undefined`，直到出现实质内容。

## 未做（保持 unavailable，不用假实现冒充）

- **驱动层（opencode/codex 等 ACP / app-server 客户端）**：driver 目前只是注册表里的枚举字段，不 spawn 任何进程。留到后续 PR。
- **`subagent.dispatch` 接线**：本包尚未注册为 `RegisteredTool`，未接入 Runtime/ToolGateway/Policy；任务到 Runtime 子任务的映射也留待接线 PR。
- **互审编排、文件交接 manifest、共享交接目录、agent 列表/信箱视图（前端）**：按设计页分期属 P1。

## 使用

```sh
npm run build --workspace=@personal-agent/crew
npm run test --workspace=@personal-agent/crew
npm run typecheck --workspace=@personal-agent/crew
```

```ts
import {openCrewStore} from '@personal-agent/crew';

const crew = openCrewStore('/data/crew.sqlite');
crew.registerAgent({agentId: 'coder-x', displayName: '编码者', driver: 'codex', instructions: '…', workspacePath: '/workspace/crew/coder-x'});
crew.dispatchTask({taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '修复类型错误'});
const task = crew.claimNextTask('coder-x');
crew.completeTask(task.taskId, {status: 'succeeded', result: '…', evidenceRefs: ['commit:…'], unblock: ''});
crew.close();
```

数据库文件与 Runtime 主库完全独立；复用 `@personal-agent/storage` 的有序迁移（版本 1 建表，STRICT 表 + 外键 + WAL，校验和账本）。生产代码只应通过公开入口 `@personal-agent/crew` 使用本包。

## 技术取舍

- 只依赖 `@personal-agent/storage`（迁移底座），不依赖 contracts/apps；将来作为普通 `RegisteredTool` 接入时再声明所需契约，不改 Runtime 公共契约。
- 纯确认白名单刻意收窄（整条消息去标点后恰好等于固定短语才算），宁可多放行也不误删带内容的回复。
- 测试只覆盖本包行为（SQLite 临时库 + 可注入时钟），不证明任何真实 CLI 已连通。

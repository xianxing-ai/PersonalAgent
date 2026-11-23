# crew × Runtime 集成说明（crew P5：Runtime 工具适配器）

本文面向把 `packages/crew` 接进 `apps/runtime` 的实现者（归 goo122 侧接线）。它只描述本 PR
实际交付的适配器（`src/runtime-tools.ts`）与**只读核对过的** Runtime 侧事实；没有读到的
细节如实标注“未确认”。文中引用的文件与行号基于分支 `zemeng/crew-p2`（提交 `b6d0434f`）。

## 1. 本 PR 交付了什么

`createCrewRuntimeTools({runtime, kernel, actorId})`（`src/runtime-tools.ts`）把 crew 的
四个协作操作暴露成与 Runtime 现有 `RegisteredTool` 同形状的对象：

| 工具名 | crew 调用 | 说明 |
| --- | --- | --- |
| `crew.dispatch` | `CrewDriverRuntime.dispatchTask` | 父派子任务根；入队前有订阅同意门 |
| `crew.send_message` | `CrewKernel.sendMessage` | agent 间信箱消息（含纯确认防死循环） |
| `crew.list_agents` | `CrewDriverRuntime.listAgents` | 成员最小视图（id/显示名/驱动/并发上限） |
| `crew.interrupt` | `CrewDriverRuntime.interruptTask` | 打断任务 + 转发运行中 CLI 会话 |

形状对应关系（镜像类型定义在 `src/runtime-tools.ts`，注释标明出处）：

- `CrewToolDescriptor` ↔ `ToolDescriptor`，`packages/contracts/src/generated.ts:514-528`；
- `CrewToolContext` ↔ `ToolContext`，`packages/contracts/src/ports.ts:7-16`；
- `CrewRegisteredTool` ↔ `RegisteredTool`，`packages/contracts/src/ports.ts:17-20`；
- 工厂模式参照 `createSubagentDispatchTool`（`subagent.dispatch`，`packages/agents/src/index.ts:509-567`）。

crew 不 import contracts/apps（保持本包“只依赖 @personal-agent/storage”的边界），结构兼容由
`test/runtime-tools.test.mjs` 的形状镜像测试逐字段断言；与真实 contracts 类型的编译期核对
发生在 apps/runtime 接线时（`import type {RegisteredTool} from '@personal-agent/contracts'`
直接赋值即可暴露任何不兼容）。

## 2. 最小接线：怎么挂到现有工具链

### 2.1 生产工具链的事实（只读核对）

- `apps/runtime/src/application/runtime-application.ts:774` 起：`RuntimeApplication` 通过
  `createToolGateway(policy)` 回调创建 `ToolGateway`（`packages/tool-gateway/src/index.ts:41`），
  并把 `configuredTools` 逐个 `gateway.register(tool)`（约 810 行）。
- `ToolGateway.register` 用 `validateContract('tool', tool.descriptor)` 校验 descriptor，
  `invoke` 用 ajv 校验 **inputSchema 与 outputSchema**（`validateToolValue`）、用
  `policy.authorize({authorizationRef, taskId, toolName, requiredScopes, now, argumentsDigest})`
  做授权，再构建 `ToolContext` 调 `tool.execute(structuredClone(arguments), context)`
  （`packages/tool-gateway/src/index.ts:49-132`）。
- 对话侧工具集在 Desktop 组合：`apps/desktop/electron/main.js:2428-2434` 的
  `conversationTools` 数组合并各宿主的工具，其中 `...(subagentTool?[subagentTool]:[])`；
  `subagentTool` 在 `main.js:2344` 由 `createDesktopSubagentDispatchTool({...})` 创建
  （`competitionOnly: true`、`getRuntime/getTools` 注入），随后重绑 `execute` 注入
  thinkingDepth，并有 `subagentAvailability` 按 task 门控（`main.js:2360` 附近）。
- `subagent.dispatch` 的 runtime 工厂：`RuntimeApplication.createSubagentDispatchTool()`
  （`runtime-application.ts:2463`）→ `createRuntimeSubagentDispatchTool`（`apps/runtime/src/application/subagent-host.ts`，
  末尾 `return createSubagentDispatchTool(handler)`，约 698 行）。子任务的工具列表会
  剔除 `subagent.dispatch` 本身（`subagent-host.ts:168`），防止子再派孙。

### 2.2 接线方案（推荐 A）

**方案 A（推荐，最小）：crew 工具作为新 RegisteredTool 并列注册，不改 `subagent.dispatch`。**

`crew.dispatch` 是“父派 crew 命名子 agent（外部 CLI 驱动）”的新执行器；`subagent.dispatch`
（内置模型子任务）语义不变。两者共用 scope `agent:delegate`。

接线伪代码（位置对应上面的事实）：

```ts
// apps/runtime/src/application/runtime-application.ts —— createSubagentDispatchTool() 旁边新增：
import {openCrewDriverRuntime, openCrewKernel, createCrewRuntimeTools, CREW_PARENT_AGENT_ID} from '@personal-agent/crew';

createCrewTools(): RegisteredTool[] {
  // crew SQLite 与 Runtime 主库分离（crew README）；路径来自受信配置。
  if (!this.crewRuntime) {
    this.crewRuntime = openCrewDriverRuntime(this.crewDbPath);
    this.crewKernel = openCrewKernel(this.crewDbPath);
  }
  const tools = createCrewRuntimeTools({
    runtime: this.crewRuntime,
    kernel: this.crewKernel,
    actorId: CREW_PARENT_AGENT_ID, // 受信宿主绑定：对话主 agent = crew 的“父”
  });
  return [...tools.tools]; // 四个 RegisteredTool，descriptor 已带 schema/scope/sideEffect
}

// createToolGateway 回调里（runtime-application.ts:810 附近）：
for (const tool of [...configuredTools, ...this.createCrewTools()]) gateway.register(tool);
```

```js
// apps/desktop/electron/main.js —— main.js:2344 附近（subagentTool 旁）：
const crewTools = runtimeModule.createCrewRuntimeToolsForDesktop({
  crewDbPath: /* 受信配置 */,
  actorId: 'parent',
});
// main.js:2428 的 conversationTools 数组追加：
...(crewTools?.tools ?? []),
// 并参照 subagentAvailability（main.js:2360）补 availability/export 条目，
// 让工具按 task/profile 门控（如 syntheticMvp 下不暴露）。
```

可选的 runtime 包装（若需在 Runtime 侧做 taskId 绑定/检查，参照
`createRuntimeCodingRepairDispatchTool` 的委托模式，`apps/runtime/src/application/coding-repair-application.ts:57-70`）：

```ts
export function createRuntimeCrewDispatchTool(getApplication: () => RuntimeApplication): RegisteredTool {
  const original = () => getApplication().createCrewTools().find(t => t.descriptor.name === 'crew.dispatch')!;
  return {
    ...original(),
    execute: (input, context) => {
      // 可在这里把 context.taskId 绑定为 rootRequestId 的来源（见 2.4），再委托。
      return original().execute(input, context);
    },
  };
}
```

**方案 B（把 crew.dispatch 并进 `subagent.dispatch` 的执行器分支）**：参照
`coding.repair.workflow` 的做法在 inputSchema 增加 executor 分支，并更新
`isRuntimeDispatchTool`（`coding-repair-application.ts:55`）。改动面大（contracts/agents
语义都在 goo122 手里），本 PR 不推荐、也未实现。

### 2.3 crew taskId ↔ Runtime 子任务 id 的映射（已接线）

`CrewDispatchInput.taskId` 的注释即设计意图：“调用方生成的任务 id，将来映射为 Runtime
子任务 id”（`packages/crew/src/store.ts`）。当前适配器不创建 Runtime 子任务。接线时的
建议（提案，未实现）：

- `rootRequestId` 取父 Runtime 任务的 `context.taskId`（模型自报值忽略）；store 层最终按 `parentTaskId`/`root-<taskId>` 派生真实根并计数；
- `taskId` 用与生产幂等键一致的合成方式——生产已用 `subagent-dispatch-<parentTaskId>-<subtaskId>`
  作为幂等键（`apps/runtime/src/application/subagent-host.ts:466,505`、`harness-event-delivery.ts:45`），
  crew 可用 `crew-<parentTaskId>-<n>` 同风格生成；
- 收结果用父专属的 `runtime.getTask({actorId, taskId})`（内核已支持）或按
  `listTasks({rootRequestId})` 汇总——工具化留后续。

### 2.4 需要 goo122 配合的事项

1. **apps/runtime 接线**：上面 2.2 的注册点（`runtime-application.ts` 的
   `createToolGateway`/`configuredTools`、desktop `main.js` 的 `conversationTools`）。
   `apps/runtime/package.json` 目前没有 `@personal-agent/crew` 依赖（已核对 dependencies
   列表），接线时需声明（crew 的公开导出只有 `.` 与 `./testing`）。
2. **ToolGateway 错误码映射**：`packages/tool-gateway/src/tool-failure.ts` 的 `reasons`
   白名单（只读核对）不含 crew 的错误码 `INVALID_INPUT` / `UNKNOWN_AGENT` /
   `NOT_PERMITTED` / `CONFLICT` / `DISPATCH_LIMIT_EXCEEDED` / `CONSENT_REQUIRED` /
   `DRIVER_UNAVAILABLE`（只有 `NOT_FOUND` 命中）。未命中的 code 会统一折叠成
   `EXTERNAL_FAILURE`（写操作为 `RESULT_UNKNOWN`）。需要 goo122 决定：扩 `reasons`
   白名单，或在 runtime 侧包装 execute 做映射。建议映射：
   `INVALID_INPUT→INVALID_ARGUMENT`、`CONSENT_REQUIRED/NOT_PERMITTED/UNKNOWN_AGENT→UNAUTHORIZED`、
   `DRIVER_UNAVAILABLE→UNSUPPORTED_CAPABILITY`、`DISPATCH_LIMIT_EXCEEDED→RATE_LIMITED`、
   `CONFLICT→REVISION_CONFLICT`。
3. **Policy 的接口**：`ToolGateway.invoke` 用 `policy.authorize(...)` 消费
   `descriptor.requiredScopes`（`packages/policy/src/index.ts:26-28` 的 `PolicyPort`）。
   crew 四个工具声明现有 scope `agent:delegate`（`subagent.dispatch` 同款，
   `packages/agents/src/index.ts:557`），不需要新 scope；若 Policy 想要更细粒度
   （如“管理 crew 注册表”单独 scope），新 scope 注册按仓库边界走 goo122 审查。
   `ToolContext.authorizationRef/argumentsDigest` 由 Gateway 构建与校验，crew 适配器
   不读它们——单次工具调用的授权决定仍完全在 Policy/Gateway 一侧。
4. **crew 同意存储的归属**：同意记录写在 crew 自己的 SQLite（迁移 v2 的 `crew_consents`
   表，`packages/crew/src/store.ts`），这是 P2 PR 的既定取舍（crew README“技术取舍”）；
   是否迁入 Policy 授权存储由 goo122 评审，crew 侧接口（`CrewConsentProvider`）已稳定。

## 3. Policy 首次同意 ↔ P2 订阅同意钩子

crew 侧已有的合规钩子（P2 交付，本 PR 未改）：

- `CrewConsentProvider`（`packages/crew/src/consent.ts:34-43`）：
  `getConsent / requireGranted / grant / revoke`，记录写入 `crew_consents` 表（登录方式
  `local-login|api-key`、条款要点、撤销审计字段；不存任何凭据）；
- 强制点一：驱动运行时 `runNextTask` 在领取任务前 `requireGranted`（P2）；
- 强制点二（本 PR 新增）：`crew.dispatch` 在任务入队前 `requireGranted`——未同意/已撤销时
  抛 `CONSENT_REQUIRED`，任务不入队、信箱无写入。

首次同意的对接伪代码（宿主侧，例如 Desktop 设置流或对话授权卡）：

```ts
try {
  return await crewDispatch.execute({taskId, rootRequestId, assignedAgentId, goal}, context);
} catch (error) {
  if (error instanceof CrewError && error.code === 'CONSENT_REQUIRED') {
    // 1) 弹一次授权提问（走现有对话授权通路，参照 desktop main.js:2401 的
    //    confirmApplicationAuthorization('knowledge.pair', ...) 用法）：
    //    “启用 codex 订阅来源？登录方式=本机已登录官方 CLI，额度扣本人订阅，条款要点…”
    const decision = await askAuthorization({action: 'crew.consent', driverId: 'codex'});
    if (decision === 'allow') {
      // 2) 用户明确同意后写入 crew 同意记录（可随时 revokeConsent 撤销）。
      crewRuntime.grantConsent({driverId: 'codex', loginKind: 'local-login',
        termsSummary: '…向用户展示过的条款要点…'});
      // 3) 重试派单（或让用户重新发起）。
      return await crewDispatch.execute({taskId, rootRequestId, assignedAgentId, goal}, context);
    }
    throw error; // 拒绝则保持 CONSENT_REQUIRED，任务从未入队。
  }
  throw error;
}
```

与 Policy 的关系（边界）：crew 的同意记录是“订阅来源启用”的一次性合规元数据，**不替代**
Policy 对单次工具调用的 `authorize`；工具调用的授权（scope/参数摘要/期限）仍由
ToolGateway+Policy 处理。两层各自生效：Policy 管“这次工具调用是否被授权”，crew consent
管“这家 CLI 订阅是否被允许使用”。撤销：设置页调用 `revokeConsent(driverId, reason)`，
撤销后派单与执行两侧都立即拒绝。

## 4. 已知限制

- **未做实机验收**：本沙箱没有已登录的官方 CLI，也未运行 apps/runtime；所有验证是
  crew 包内单元测试（SQLite 临时库 + FakeDriver/假协议子进程）。
- **适配器不创建 Runtime 子任务**：crew 任务仍是 crew SQLite 里的记录；与 Runtime
  子任务的双向映射（2.3）是提案。
- **`context` 已消费（F3）**：`crew.dispatch` 用 `context.taskId` 绑定 rootRequestId；
  但 crew 四个操作是同步 SQLite 事务，取消/授权仍在 Gateway 一侧生效。
- **两个内核连接**：`CrewDriverRuntime.open` 内部自建内核且不外露，因此 `send_message`
  经宿主另开的 `CrewKernel`（同一路径、同一 SQLite；crew 现有测试即此装配方式，WAL 下
  事务一致）。goo122 接线时若希望单连接，可在 runtime 侧给 `CrewDriverRuntime` 加
  `sendMessage` 透传（crew 可配合小改）。
- **evidenceRefs 留空**：CLI 自报结果不是可信证据（P2 既定），父应按“模型自报”对待。
- **每 agent 单会话**：P2 限制，运行时同一 agent 一次只驱动一个任务（内核并发 2 上限不变）。
- **Codex 协议未实机核对**：沿用 P2 的声明（`PROTOCOL_*` 常量可小调）。
- **适配器测试未覆盖 ToolGateway 全链**：`validateContract('tool', ...)` 对 descriptor 的
  ajv 校验、`validateToolValue` 对 outputSchema 的校验在 crew 包内无法执行（不依赖
  contracts）；镜像测试只做逐字段结构断言。接线时第一次 `gateway.register` / `invoke`
  是真正的编译期+运行期核对点。
- **子 agent 工具过滤**：`subagent-host.ts:168` 会把 `subagent.dispatch` 从子任务工具里
  剔除；crew 四个工具是否也应从子任务工具集中剔除（防子代派/越权），**未确认**，
  需 goo122 在接线时决定（按内核 actor 边界，子身份调 `crew.dispatch/crew.interrupt`
  也会被拒，但工具不出现在列表里更干净）。

## 5. 未做的部分（保持 unavailable / 留后续）

- **Gemini 与其余 ACP 客户端（opencode acp、grok agent stdio、acp-generic）**：本 PR 不做；
  给这些驱动派单会在执行侧得到明确的 `DRIVER_UNAVAILABLE`（“留后续 PR”），`crew.list_agents`
  仍能列出它们（注册表与执行能力是两回事）。Claude / Grok 的 API key HTTP 驱动已在 main
  （P4）注册进驱动运行时，本适配器不另写一套；它们同样先过订阅同意门，且尚未对真实服务做实机验证。
- **子 CLI 侧的 MCP 注入**（设计页 P1 的 send_message / list_agents / interrupt_agent
  注入到子 agent 本地 MCP server）：本 PR 的四个工具是**宿主/主 agent 侧**的
  RegisteredTool；注入子 CLI 的反向通道未开工。
- **文件交接与按 agent 的工作区**：已随 #573 进入 main（独立工作区目录、SHA-256 清单、重启恢复）。本适配器不重复实现这些入口；互审编排和信箱视图 UI 仍留后续，UI 归前端负责人。
- **crew.dispatch → Policy 首次同意的自动提问流**：3 节是伪代码，宿主接线未实现。

# Crew 子智能体协作底座（P0 存储原语 + P1 协作内核 + P2 驱动层 + P5 Runtime 工具适配器）

负责人 `zemeng`（GitHub：`zemeng5208`）。本包是[子智能体协作体系设计](https://github.com/xianxing-ai/PersonalAgent)的 crew 纵向切片：P0（#554）交付命名 agent 注册表、独立 SQLite 任务表、每 agent 持久 FIFO 信箱与固定回执格式；P1（#559）交付协作内核（actor 边界 + dispatch / interrupt / 子间消息）；P2 在其上交付驱动层（统一驱动接口 + Codex 驱动 + 订阅同意钩子）；P5 交付 Runtime 工具适配器（`src/runtime-tools.ts`，把 dispatch / send_message / list_agents / interrupt 暴露成与 Runtime `RegisteredTool` 同形状的对象）与集成说明（[docs/crew-integration.md](docs/crew-integration.md)）。协作与评审规则以 [CONTRIBUTING](../../CONTRIBUTING.md) 和 [AGENTS](../../AGENTS.md) 为准；模块归属以 [MODULE_ASSIGNMENTS](../../docs/MODULE_ASSIGNMENTS.md) 为准。

## Runtime 工具适配器（P5）

`createCrewRuntimeTools({runtime, kernel, actorId})` 产出 `crew.dispatch` / `crew.send_message` / `crew.list_agents` / `crew.interrupt` 四个 `RegisteredTool` 形状的对象（descriptor：name/version/inputSchema/outputSchema/sideEffect/requiredScopes/idempotencySupport/recoverySupport/requiresPresence + `execute(input, context)`），工厂模式与 `subagent.dispatch`（`packages/agents`）一致。crew 不 import contracts/apps：结构兼容的本地镜像类型（`CrewToolDescriptor`/`CrewToolContext`/`CrewRegisteredTool`）逐字段对照 `packages/contracts/src/ports.ts` 与 `generated.ts` 注明出处，兼容性由 `test/runtime-tools.test.mjs` 的形状镜像测试证明；与真实 contracts 的编译期核对发生在 apps/runtime 接线时。语义要点：actor 由受信宿主在工厂参数绑定（不信任模型输入）；`crew.dispatch` 入队前有订阅同意门（未同意/已撤销抛 `CONSENT_REQUIRED`，任务不入队）；错误一律 `CrewError`（`code` + `[CODE] message`）。**本适配器不注册到 ToolGateway、不创建 Runtime 子任务**——apps/runtime 的接线位置、伪代码、需 goo122 配合的事项（错误码映射、Policy 对接、首次同意流）见 [docs/crew-integration.md](docs/crew-integration.md)。

```ts
import {openCrewDriverRuntime, openCrewKernel, createCrewRuntimeTools, CREW_PARENT_AGENT_ID} from '@personal-agent/crew';

const runtime = openCrewDriverRuntime('/data/crew.sqlite');
const kernel = openCrewKernel('/data/crew.sqlite'); // 同一路径；send_message/同意门走内核
const tools = createCrewRuntimeTools({runtime, kernel, actorId: CREW_PARENT_AGENT_ID});
// tools.tools 逐个交给 ToolHost.register(...)（接线说明见 docs/crew-integration.md）
```


## 当前范围（P2 驱动层 + P5 Runtime 工具适配器）

在 P1 内核之上新增三层：统一驱动契约（`src/driver.ts`）、Codex 驱动（`src/drivers/codex.ts`）、驱动运行时（`src/runtime.ts`），以及订阅使用同意接口（`src/consent.ts`，写入 crew 自己的 SQLite）。主父 agent 派子的逻辑不变：任务根仍只由父发起，驱动只是子 agent 的执行器。

- **统一驱动接口（start / send / interrupt / 事件流）**：`CrewDriver`（`probe` 只探测不接触、`start`）、`CrewDriverSession`（`send` 发一条 prompt、`interrupt` 打断、`close` 关进程）、`CrewDriverEvent` 判别联合（`started` / `output` / `completed` / `failed` / `interrupted` / `exited`）。事件经 `CrewSessionEventBus` 分发：首个订阅者接入前缓冲、接入时先回放（保证 start 期间产生的 `started` 不丢）。子进程面抽象为 `CrewSpawn` / `CrewDriverProcess`（只暴露 stdio + kill + exited），生产用 `createNodeSpawn()`，测试注入假子进程。驱动契约：`start` 前必须经同意门（未同意抛 `CONSENT_REQUIRED`）；CLI 缺失/未登录/无法确认登录状态时明确 `DRIVER_UNAVAILABLE`，不假装可用、不代登录。
- **Codex 驱动（`codex app-server` JSONL 客户端）**：只拉起用户本机已登录的官方 Codex CLI（`codex --version` 探测存在性；`codex app-server` 走 initialize → loginStatus → newConversation 握手，`sendUserMessage` 发任务目标，`agentMessageDelta`/`agentMessage` → output 事件，`taskComplete` → completed，`interruptConversation` 打断）。**合规边界：不读取、不存储、不转发任何 token 或凭据文件**——登录态由 CLI 自身管理（只探测不接触），本驱动只 spawn + stdio；未登录或无法确认登录状态一律拒绝。请求按 id 关联、带超时（`TIMEOUT`），进程中途退出按 `DRIVER_FAILED` 结算。协议方法/事件名按 2026-11 的 codex app-server JSON-RPC 约定实现：**尚未对真实 Codex 做实机验证**（本沙箱没有已登录的 Codex；单元测试用协议级假子进程模拟，若真实协议字段有出入只需调整 `PROTOCOL_*` 常量与对应解析）。
- **驱动运行时（与内核衔接）**：`CrewDriverRuntime` 把驱动接口接到 #559 的 dispatch / 信箱 / 任务表 / 回执——`dispatchTask` 透传内核（父派子逻辑不变）；`runNextTask(agentId)` 按 同意门 → 注册表 → probe → FIFO 领取（claim）→ 消费信箱 task 消息 → 打开会话 → 把任务目标作为 prompt 发给 CLI → 结束事件映射为固定回执（Status/Result/Evidence/Unblock）提交回任务表 → 关闭会话。**拒绝发生在领取之前**：未同意/驱动未实现/本机不可用时任务保持排队、状态不变。驱动启动失败映射为 `blocked` 回执（附 unblock 指引），CLI 失败/退出映射为 `failed`。`interruptTask` 仍走内核落任务表 + 信箱 interrupt 消息（持久、重启不丢），运行时额外把打断转发给运行中的 CLI 并关闭进程。事件流经 `runtime.onEvent` 透出并带 `taskId`。每个任务一个 CLI 会话，运行时同一 agent 一次只驱动一个任务（内核并发 2 上限不变）。
- **假驱动（test-only）**：`FakeDriver` / `FakeDriverSession`（脚本化会话，测试显式推进）与 `FakeCodexAppServer` / `createFakeCodexSpawn`（协议级假 codex 子进程）只从独立入口 `@personal-agent/crew/testing` 导出；生产入口 `@personal-agent/crew` 不导出任何假实现，默认驱动注册表也只有真实 Codex 驱动，不存在被生产路径当作真实能力的路径。
- **订阅同意钩子（合规边界）**：`CrewConsentProvider` 接口（`getConsent` / `requireGranted` / `grant` / `revoke`）+ crew 自己 SQLite 上的实现（迁移 v2 新增 `crew_consents` 表，每家驱动一条记录，含登录方式 local-login/api-key、条款要点、撤销审计字段；可随时撤销，重新同意覆盖撤销）。首次使用一家订阅来源必须由用户明确同意；未同意/已撤销时驱动 `start` 与运行时 `runNextTask` 都必须拒绝（`CONSENT_REQUIRED`），且不产生任何任务状态变化。记录只存合规元数据，不存任何凭据。`kernel.consent` 是宿主与驱动共用的入口。
- **对 P1 的增量**：错误码新增 `CONSENT_REQUIRED` / `DRIVER_UNAVAILABLE` / `DRIVER_PROTOCOL` / `TIMEOUT` / `DRIVER_FAILED`（对齐仓库统一错误分类的"未授权/外部失败/超时/结果不确定"）；存储迁移 v2（增量建表）；新增 `CrewStore.dequeueTaskMessage` 与 `kernel.dequeueTaskMessage`（领取后消费信箱 task 消息，只有被分配的 agent 能消费自己的信箱）；P0/P1 既有方法签名与语义不变（29 条既有测试全部保留并通过）。

## 未做（保持 unavailable，不用假实现冒充）

- **Claude/Grok（API key 驱动）与 Gemini、其余 ACP 客户端（opencode acp、grok agent stdio 等）**：本 PR 不做，注册表查询返回明确的 `DRIVER_UNAVAILABLE`（"留后续 PR"），任务保持排队。
- **未对真实 Codex 做实机验证**：协议实现与握手字段未经真实 CLI 核对；`probe` 的登录探测只确认 CLI 可执行性，登录状态在握手期经 `loginStatus` 确认。真实 Codex 的实机验证（含产品进程内无任何令牌读写记录的验收）留待有已登录环境的条件下进行。
- **`subagent.dispatch` 接线**：P5 已交付与 Runtime `RegisteredTool` 同形状的适配器（`src/runtime-tools.ts`）与集成说明（`docs/crew-integration.md`），但**未接入 apps/runtime、未注册到 ToolGateway/Policy**——接线归 goo122（位置与伪代码见集成说明）；适配器不创建 Runtime 子任务，crew 任务与 Runtime 子任务的映射留接线 PR。设置页同意流程与 agent 列表/信箱视图的前端接线归前端负责人。
- **驱动回执的 evidenceRefs**：CLI 自报结果不是可信证据，驱动产出的回执 `evidenceRefs` 一律留空，父应按"模型自报"对待；可信产物引用（worktree 提交、交接 manifest）留后续 PR。
- **互审编排、文件交接 manifest、按 agent 的持久 worktree 隔离**：按设计页分期留后续 PR。

## 使用

```sh
npm run build --workspace=@personal-agent/crew
npm run test --workspace=@personal-agent/crew
npm run typecheck --workspace=@personal-agent/crew
```

```ts
import {openCrewDriverRuntime, CREW_PARENT_AGENT_ID} from '@personal-agent/crew';

const runtime = openCrewDriverRuntime('/data/crew.sqlite');
// 首次启用一家订阅来源：用户明确同意后记录（可随时 revokeConsent）。
runtime.grantConsent({driverId: 'codex', loginKind: 'local-login', termsSummary: '使用本人本机已登录的官方 Codex CLI（Sign in with ChatGPT）…'});
runtime.registerAgent({agentId: 'coder-x', displayName: '编码者', driver: 'codex', instructions: '…', workspacePath: '/workspace/crew/coder-x'});
runtime.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '修复类型错误'});
const task = await runtime.runNextTask('coder-x'); // 同意→probe→claim→CLI 会话→固定回执
runtime.close();
```

测试专用假实现从独立入口导入，生产代码不得引用：

```ts
import {FakeDriver, createFakeCodexSpawn} from '@personal-agent/crew/testing';
```

生产代码只应通过公开入口 `@personal-agent/crew` 使用本包；数据库文件与 Runtime 主库完全独立（迁移版本 2：`crew_agents` / `crew_tasks` / `crew_messages` / `crew_consents`，STRICT 表 + 外键 + WAL）。驱动只做 spawn + stdio 结构化协议，不抓终端画面；登录只探测不接触。

## 技术取舍

- 只依赖 `@personal-agent/storage`（迁移底座），不依赖 contracts/apps；不改 Policy、不碰 apps/runtime——同意记录按本 PR 决定写入 crew 自己的存储，将来如需接入 Policy 授权存储由 goo122 侧评审迁移。
- 同意门同时挂在驱动 `start`（契约）与运行时 `runNextTask`（在领取之前），拒绝路径不产生任何进程或任务状态变化。
- 会话事件总线先缓冲后回放：start 期间产生的 `started` 对迟到的订阅者不丢；运行时终态监视在 `send` 之前订阅，避免响应与完成通知同块到达时漏掉 `completed`。
- 协议字段集中在 `PROTOCOL_*` 常量，未实机验证的部分（`loginStatus.requiresLogin` 语义、通知字段名）单独标注，实机联调时只需小改。
- 测试只覆盖本包行为（SQLite 临时库 + 可注入时钟 + 假子进程/管道协议模拟，65 条），不证明任何真实 CLI 已连通，也不证明 apps/runtime 接线后的全链行为（`validateContract('tool', …)` / ajv schema 校验在不依赖 contracts 的本包内无法执行，见集成说明“已知限制”）。

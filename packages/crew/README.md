# Crew 子智能体协作底座（P0 存储原语 + P1 协作内核 + P2 驱动层 + P3 工作区与交接 + P4 API key 驱动 + P5 Runtime 工具适配器）

负责人 `zemeng`（GitHub：`zemeng5208`）。本包是[子智能体协作体系设计](https://github.com/xianxing-ai/PersonalAgent)的 crew 纵向切片：P0（#554）交付命名 agent 注册表、独立 SQLite 任务表、每 agent 持久 FIFO 信箱与固定回执格式；P1（#559）交付协作内核（actor 边界 + dispatch / interrupt / 子间消息）；P2 在其上交付驱动层（统一驱动接口 + Codex 驱动 + 订阅同意钩子）；P3 交付独立工作区、SHA-256 文件交接与恢复；P4 交付 Claude / Grok API key HTTP 驱动；P5 交付 Runtime 工具适配器（`src/runtime-tools.ts`，把 dispatch / send_message / list_agents / interrupt 暴露成与 Runtime `RegisteredTool` 同形状的对象）与集成说明（[docs/crew-integration.md](docs/crew-integration.md)）。协作与评审规则以 [CONTRIBUTING](../../CONTRIBUTING.md) 和 [AGENTS](../../AGENTS.md) 为准；模块归属以 [MODULE_ASSIGNMENTS](../../docs/MODULE_ASSIGNMENTS.md) 为准。

## Runtime 工具适配器（P5）

`createCrewRuntimeTools({runtime, kernel, actorId})` 产出 `crew.dispatch` / `crew.send_message` / `crew.list_agents` / `crew.interrupt` 四个 `RegisteredTool` 形状的对象（descriptor：name/version/inputSchema/outputSchema/sideEffect/requiredScopes/idempotencySupport/recoverySupport/requiresPresence + `execute(input, context)`），工厂模式与 `subagent.dispatch`（`packages/agents`）一致。crew 不 import contracts/apps：结构兼容的本地镜像类型（`CrewToolDescriptor`/`CrewToolContext`/`CrewRegisteredTool`）逐字段对照 `packages/contracts/src/ports.ts` 与 `generated.ts` 注明出处，兼容性由 `test/runtime-tools.test.mjs` 的形状镜像测试证明；与真实 contracts 的编译期核对发生在 apps/runtime 接线时。语义要点：actor 由受信宿主在工厂参数绑定（不信任模型输入）；`crew.dispatch` 入队前有订阅同意门（未同意/已撤销抛 `CONSENT_REQUIRED`，任务不入队）；错误一律 `CrewError`（`code` + `[CODE] message`）。**本适配器不注册到 ToolGateway、不创建 Runtime 子任务**——apps/runtime 的接线位置、伪代码、需 goo122 配合的事项（错误码映射、Policy 对接、首次同意流）见 [docs/crew-integration.md](docs/crew-integration.md)。

```ts
import {openCrewDriverRuntime, openCrewKernel, createCrewRuntimeTools, CREW_PARENT_AGENT_ID} from '@personal-agent/crew';

const runtime = openCrewDriverRuntime('/data/crew.sqlite');
const kernel = openCrewKernel('/data/crew.sqlite'); // 同一路径；send_message/同意门走内核
const tools = createCrewRuntimeTools({runtime, kernel, actorId: CREW_PARENT_AGENT_ID});
// tools.tools 逐个交给 ToolHost.register(...)（接线说明见 docs/crew-integration.md）
```


## P4 Claude / Grok API key 驱动

在 P2 驱动层之上新增 Claude 驱动（`src/drivers/claude.ts`）、Grok 驱动（`src/drivers/grok.ts`）、API key 密钥提供器（`src/secrets.ts`）与共享 HTTP/SSE 底座（`src/drivers/api-http.ts`），并接入 P2 的订阅同意钩子与驱动运行时。主父 agent 派子的逻辑不变：任务根仍只由父发起，驱动只是子 agent 的执行器。

- **Claude 驱动（Anthropic Messages API）**：实现 P2 统一驱动接口（`start` / `send` / `interrupt` / 事件流）。一个会话对应一段多轮对话：`system` 为 agent 注册指令，内存里维护 user/assistant 历史（不落盘，随会话释放）。POST `{baseUrl}/v1/messages`（`stream: true`），SSE `content_block_delta[text_delta]` → output 事件、`message_stop` → completed、`error` 事件与非 2xx 状态 → failed；`interrupt` abort 在途请求并立即产生 interrupted（打断的一轮不留在历史里）。协议事件名按 2026-11 的 Anthropic Messages API 约定实现：**尚未对真实 Claude 服务做实机验证**（本沙箱没有任何真实 Claude 凭据；单元测试用本地假 HTTP 服务器模拟，若真实协议字段有出入只需调整 `PROTOCOL_*` 常量与对应解析）。
- **Grok 驱动（xAI OpenAI 兼容 Chat Completions API）**：同上实现统一驱动接口。POST `{baseUrl}/v1/chat/completions`（`stream: true`，每轮带 `system`），SSE `choices[0].delta.content` → output 事件、`data: [DONE]` → completed、流内 `error` 帧与非 2xx 状态 → failed，流在 `[DONE]` 前结束按协议失败结算；`interrupt` 同 Claude。协议字段按 2026-11 的 xAI OpenAI 兼容 API 约定实现：**尚未对真实 Grok 服务做实机验证**（本沙箱没有任何真实 Grok 凭据；单元测试用本地假 HTTP 服务器模拟）。
- **API key 密钥提供器（合规边界）**：`CrewApiKeyProvider` 接口 + `EnvCrewApiKeyProvider` 默认实现（claude 读 `ANTHROPIC_API_KEY`/`CLAUDE_API_KEY`，grok 读 `XAI_API_KEY`/`GROK_API_KEY`，按顺序取第一个非空值）。API key 只从环境变量或调用方注入的密钥提供器读取；**key 只经认证请求头（`x-api-key` / `Authorization: Bearer`）发往配置的官方端点，绝不进 URL/查询串，绝不写日志、不落盘、不进回执、不进事件流、不进错误信息**（厂商错误只提取 `error.message`/`type` 字段并截断，不回显原始响应体）。缺密钥时 probe 明确 unavailable、`start` 抛 `DRIVER_UNAVAILABLE`，不假装可用；不读取任何凭据文件。测试断言假密钥不出现在事件、回执、SQLite 文件（含 WAL/SHM）、错误信息与控制台输出中。
- **同意门联动（P2 合规边界）**：两家驱动的 `start` 都先经 `CrewConsentProvider.requireGranted(driverId)`（同意记录 `loginKind='api-key'`），未同意/已撤销抛 `CONSENT_REQUIRED` 且不产生任何请求；运行时 `runNextTask` 的顺序仍是 同意门 → 注册表 → probe → 领取，拒绝发生在领取之前（任务保持排队）。probe 不发起网络请求（只检查密钥来源是否配置，不验证 key 有效性；key 无效在首轮请求时按 failed 结算）。
- **驱动运行时增量**：默认注册表变为 codex + claude + grok（gemini/acp-generic 仍留后续，注册表查询明确 `DRIVER_UNAVAILABLE`）；`CrewDriverRuntimeOptions` 新增 `apiKeyProvider`、`claudeOptions`、`grokOptions`（测试注入 baseUrl 等；consent 由运行时统一提供）。驱动启动失败的 `blocked` 回执 unblock 指引按驱动类型区分：API key 驱动提示配置环境变量/注入密钥提供器，CLI 驱动提示安装并登录官方 CLI。P0–P2 既有语义与测试不变。

## 既有能力（P0–P2 已交付）

- **存储原语（P0，#554）**：命名 agent 注册表、独立 SQLite 任务表、每 agent 持久 FIFO 信箱与固定回执格式（Status/Result/Evidence/Unblock）。
- **协作内核（P1，#559）**：actor 边界 + 父派子 dispatch / interrupt / 子间消息路由（hop 与派单/并发上限）。
- **统一驱动接口与 Codex 驱动（P2，#565）**：`CrewDriver` / `CrewDriverSession` / `CrewDriverEvent`（事件先缓冲后回放）；Codex 只拉起用户本机已登录的官方 CLI（`codex app-server` JSONL 握手：initialize → loginStatus → newConversation，`sendUserMessage` 发任务目标，`taskComplete` → completed），登录态由 CLI 自身管理（只探测不接触），未登录/无法确认一律拒绝；驱动运行时 `CrewDriverRuntime` 衔接 dispatch/信箱/任务表/回执，`interruptTask` 转发打断并关闭进程；订阅同意钩子（`crew_consents` 表，可撤销）；假驱动只从 `@personal-agent/crew/testing` 导出。

## 未做（保持 unavailable，不用假实现冒充）

- **Gemini 与其余 ACP 客户端（opencode acp、grok agent stdio、acp-generic）**：本 PR 不做，注册表查询返回明确的 `DRIVER_UNAVAILABLE`（"留后续 PR"），任务保持排队。Grok 本 PR 只交付 API key 直连官方 HTTP API（按设计页"订阅条款核实前不开订阅模式"），`grok agent stdio` ACP 客户端留后续。
- **未对真实 Codex / Claude / Grok 做实机验证**：三家驱动均为本沙箱无真实凭据环境下的协议级实现——Codex 未经真实 CLI 核对，Claude/Grok 未经真实官方服务核对。单元测试用本地假 HTTP 服务器 / 假子进程模拟协议，不证明任何真实服务已连通；三家实机验证（含产品进程内无任何令牌读写记录、API key 不落盘的实机复核）留待有真实凭据环境的条件下进行。
- **`subagent.dispatch` 接线**：P5 已交付与 Runtime `RegisteredTool` 同形状的适配器（`src/runtime-tools.ts`）与集成说明（`docs/crew-integration.md`），但**未接入 apps/runtime、未注册到 ToolGateway/Policy**——接线归 goo122（位置与伪代码见集成说明）；适配器不创建 Runtime 子任务，crew 任务与 Runtime 子任务的映射留接线 PR。设置页同意流程与 agent 列表/信箱视图的前端接线归前端负责人。
- **驱动回执的 evidenceRefs**：模型自报结果不是可信证据，驱动产出的回执 `evidenceRefs` 一律留空，父应按"模型自报"对待；可信产物引用（worktree 提交、交接 manifest）留后续 PR。
- **互审编排、文件交接 manifest、按 agent 的持久 worktree 隔离**：按设计页分期留后续 PR。

## 使用

### P2 / P3 集成的数据库版本

集成顺序保留 P2 的 v2 `crew_consents` SQL 原样，P3 的任务期限、交接清单与父信箱新增为 v3；不修改 v1 / v2 的校验和，不删除或重建原库。P3 尚未进入 main，其独立实验分支曾把另一份 SQL 编号为 v2，因此该实验库与 P2 / 集成库不能直接混用：原 `openStorage` 会拒绝校验和漂移，保留原数据库，不能通过清库或改迁移记录绕过。

2026-11-04 在 Node 24.15.0 / npm 11.12.1 下，新增定向迁移回归首次 1/1 通过：使用冻结的 P2 v1/v2 SQL 创建含 agent、运行中任务、消息与同意记录的 SQLite 库，再由集成 v3 打开，原数据、身份及 v1/v2 校验和均保留，新增表与任务期限可用。同一候选的一次 `npm run build` 通过；未运行全量测试，这些本地结果不代替真实 CLI、云或设备验收。

```sh
npm run build --workspace=@personal-agent/crew
npm run test --workspace=@personal-agent/crew
npm run typecheck --workspace=@personal-agent/crew
```

```ts
import {openCrewDriverRuntime, CREW_PARENT_AGENT_ID} from '@personal-agent/crew';

const runtime = openCrewDriverRuntime('/data/crew.sqlite');
// 首次启用一家订阅来源：用户明确同意后记录（可随时 revokeConsent）。
// CLI 驱动（codex）用 loginKind: 'local-login'；API key 驱动（claude/grok）用 loginKind: 'api-key'。
runtime.grantConsent({driverId: 'codex', loginKind: 'local-login', termsSummary: '使用本人本机已登录的官方 Codex CLI（Sign in with ChatGPT）…'});
runtime.grantConsent({driverId: 'claude', loginKind: 'api-key', termsSummary: '使用用户自己的 Anthropic API key（按量计费）…'});
runtime.registerAgent({agentId: 'coder-x', displayName: '编码者', driver: 'codex', instructions: '…', workspacePath: '/workspace/crew/coder-x'});
runtime.registerAgent({agentId: 'writer-c', displayName: '写作子', driver: 'claude', instructions: '…', workspacePath: '/workspace/crew/writer-c'});
runtime.dispatchTask({actorId: CREW_PARENT_AGENT_ID, taskId: 't1', rootRequestId: 'root-1', assignedAgentId: 'coder-x', goal: '修复类型错误'});
const codexTask = await runtime.runNextTask('coder-x'); // 同意→probe→claim→CLI 会话→固定回执
// claude/grok 的 API key 默认从环境变量读取（ANTHROPIC_API_KEY / XAI_API_KEY），
// 或注入自己的密钥提供器：openCrewDriverRuntime(path, {apiKeyProvider: myProvider})。
const claudeTask = await runtime.runNextTask('writer-c'); // 同意→probe→claim→HTTP SSE→固定回执
runtime.close();
```

测试专用假实现从独立入口导入，生产代码不得引用：

```ts
import {FakeDriver, createFakeCodexSpawn} from '@personal-agent/crew/testing';
```

生产代码只应通过公开入口 `@personal-agent/crew` 使用本包；数据库文件与 Runtime 主库完全独立（迁移版本 2：`crew_agents` / `crew_tasks` / `crew_messages` / `crew_consents`，STRICT 表 + 外键 + WAL）。CLI 驱动只做 spawn + stdio 结构化协议，不抓终端画面，登录只探测不接触；Claude/Grok 只做 HTTPS API 调用，API key 只经认证请求头发往官方端点，不写日志、不落盘、不进回执/事件/错误信息。

## 技术取舍

- 只依赖 `@personal-agent/storage`（迁移底座），不依赖 contracts/apps；不改 Policy、不碰 apps/runtime——同意记录按 P2 决定写入 crew 自己的存储，将来如需接入 Policy 授权存储由 goo122 侧评审迁移。
- 同意门同时挂在驱动 `start`（契约）与运行时 `runNextTask`（在领取之前），拒绝路径不产生任何进程、HTTP 请求或任务状态变化。
- 会话事件总线先缓冲后回放：start 期间产生的 `started` 对迟到的订阅者不丢；运行时终态监视在 `send` 之前订阅，避免响应与完成通知同块到达时漏掉 `completed`。
- 协议字段集中在 `PROTOCOL_*` 常量，未实机验证的部分（codex `loginStatus.requiresLogin` 语义、Claude/Grok SSE 事件字段名与默认模型名）单独标注，实机联调时只需小改。
- Claude/Grok 会话的对话历史只在内存（随会话释放），失败/被打断的一轮不留在历史里；会话内一轮一个在途请求（并发 send 明确 `CONFLICT`）；整轮请求（含流读取）共享一个超时（`startTurnAbort`），超时与打断共用同一 AbortController 并按旗标区分结算路径。
- Claude/Grok 的 HTTP 底座共享一个模块（`src/drivers/api-http.ts`：SSE 行解析、厂商错误摘要、超时/打断合并）；错误摘要只提取厂商 `error.message`/`type` 字段并截断，不回显原始响应体，保证密钥与请求头不可能进入错误信息。
- 原分支的本地测试只覆盖 SQLite、显式假子进程/管道与本地假 HTTP 协议；P4 的 77 条和 P5 的 65 条是各自分支记录，不是集成后的通过数。不证明真实 CLI/官方 API 已连通，也不证明 apps/runtime 接线后的全链行为；真实 contracts 的编译期/Schema 核对仍在 Runtime 接线处完成。

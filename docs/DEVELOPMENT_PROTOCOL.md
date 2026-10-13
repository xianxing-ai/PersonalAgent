# 公共开发协议

## 2026-10-09 双通道与 Wiki 契约增量

WSS 主通道和 HTTPS 备用是同一 CloudAgentPort 的适配，不改变既有 TaskRuntime/wire 权限语义。当前分支独立 `agentarts-transport` 0.1.0 已实现握手、调用身份/摘要、受理/终态和进程内状态查询，仍为 provisional；接口详见 `competition/OWNED_IMAGE_INTERFACES.md`。公开网关、持久云回执、自动核实恢复与游标续传未验收，不能私设 DTO 或宣称 frozen。

Wiki 复用 KnowledgePort、MemoryQueryPort 和 FactChangeFeed；新增页面身份、source/config revision、引用失效、写后投影和去重契约由 goo122 发布。原始内容权限、索引权限和出机权限分开；断线/未知写入不盲重试，任务终态归 Runtime。

公共变更随工作包完成消费验证。开发可独立推进，但 Git 合并必须满足 goo122 与 Potatos498 两人的本机阅读声明/审批、当前 head 校验及必要检查，禁止强制合并/管理员绕过。

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

版本：0.3.0 · 日期：2026-09-09 · 协议负责人：`goo122`

状态：开发包仍为 0.1.0-alpha.1、wire 主版本仍为 1.0.0。按 [ADR-0005](adr/0005-layered-interface-freeze.md) 采用逐接口冻结：Core Runtime Profile 1 的消息、任务、会话和审批只读查询子集已冻结；整套协议、模型工具调用和 Agent 编排未冻结。当前只实施[华为 ICT AgentArts Competition Profile](competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)，Local Profile 仅留存现有代码、当前不新增；profile 决策不改变已冻结 wire。精确状态见 [当前接口目录](interfaces/CURRENT_INTERFACE_CATALOG.md)。

## 1. 规范来源与冻结

- `goo122` 维护 `packages/contracts/` 的 JSON Schema、生成类型与测试夹具；本文件解释语义。`goo122` 在首次交付时使两者一致，消费者不得自行复制不同版本。
- wire 版本为 `1.0.0`，与文档和开发包版本分开。wire 主版本不代表全部 operation 已冻结；冻结单位是接口 profile 或单项端口。
- 状态分为 `frozen`、`provisional`、`unavailable`、`deprecated`。接口只有具备单一来源、生产实现、Fake/失败夹具、消费验证、负责人自审和 CI 后才可冻结；外部行为影响语义时还需要真实目标系统闭环。
- 新增可选字段为兼容扩展；删除字段、修改含义、增加消费者无法处理的必需状态必须升级不兼容版本或协商能力。
- 握手交换协议版本与能力列表；主版本不一致拒绝连接。新操作必须先通过能力发现，不能只凭次版本猜测支持。
- 变更流程：提出差异和消费者影响 → 更新接口目录为 provisional → 实施者更新单一 Schema/夹具和必要接线 → 消费契约验证 → 自审与 CI → 两人本机阅读确认及审批后合并 → 按实际证据更新为 frozen。goo122 负责公共协议长期维护，不是独占实施者；开发可独立推进，合并遵守当前门槛，禁止 UI 和服务端私设临时字段。
- Schema 中已知但生产握手未公布的 operation 为 unavailable；消费者不调用，Host 返回 `UNSUPPORTED_CAPABILITY`，UI 明确展示不可用。

## 2. Profile 与通信分层

- `huawei_ict_agentarts` 是当前实现和比赛验收的唯一优先 profile；AgentArts 负责 Agent 构建、编排、评估与部署。
- `local` 只作为可选保留，现有 `runAgent()`、ModelGateway 和 Provider 不删除，但其新增能力不进入当前比赛交付。
- profile 由受信 composition root 显式选择，当前 wire 不新增临时 profile 字段；Renderer、模型、邮件或网页内容都不能切换 profile。
- Competition Profile 中 AgentArts 不可用时返回明确错误并保留任务事实状态，正式评测不得静默切换 Local。
- AgentArts 外部 DTO 由 CloudAgentPort/Adapter 隔离，不直接进入公共 wire、TaskRuntime 或连接器。

- Electron 渲染器只调用 `packages/client/` 公开 API，经 `zemeng` 的 preload 桥接；不访问 Named Pipe、密钥或原生工具。
- Runtime 与 Windows Host 使用受限 Named Pipe。公共 Schema 与 JSONL 帧由 goo122 长期维护，zemeng 实现 Host 时可一并完成兼容契约变更和消费验证；每帧一行 UTF-8 JSON，字符串内换行转义，最大 1 MiB，超限拒绝。
- 应用 IPC 封装为同一消息对象，不要求所有传输都采用 JSONL。
- 大音频、截图、附件使用宿主生成的临时 `artifactRef`，单独分片传输；引用绑定任务/会话、访问主体和到期时间，不能接受外部任意路径作为可信引用。流具有序号、取消和背压。
- 时间统一 ISO 8601 UTC；日程额外带 IANA 时区；业务计算不使用界面格式化文本。标识符视为不透明字符串，生产环境由可信组件生成。

## 3. 请求、响应与事件

以下 TypeScript 只说明形状，生产校验由 `goo122` 的 Schema 提供。所有 `payload` 在进入业务代码前按 `operation` 选取具体 Schema。

```ts
type Request<T> = {
  kind: "request";
  protocolVersion: string;
  requestId: string;
  taskId?: string;
  operation: string;
  deadline: string;
  idempotencyKey?: string;
  payload: T;
};

type Response<T> = {
  kind: "response";
  protocolVersion: string;
  requestId: string;
  outcome: "ok" | "error";
  data?: T;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
  };
  evidenceRefs: string[];
};

type Event<T> = {
  kind: "event";
  protocolVersion: string;
  eventId: string;
  streamId: string;
  sequence: number;
  taskId?: string;
  type: string;
  occurredAt: string;
  payload: T;
};
```

`outcome=ok` 必须有 `data` 且无 `error`；`outcome=error` 必须有 `error` 且无 `data`。请求被接受不等于任务完成。`requestId` 用于关联单次调用，业务幂等使用 `idempotencyKey`，二者不混用。

普通 UI 请求不能携带可信授权令牌。仅 Runtime→执行器的内部调用增加 `authorizationRef`，由宿主绑定动作、对象、期限和调用主体。内部调用也校验，不因为是本机连接就放行。

## 4. 最小公开 API

每个操作都是应用内部契约，不表示第三方平台拥有同名 API。Schema 当前登记 17 个 operation；只有握手公布且下表为 frozen/provisional 的操作才可调用。

| 操作 | 请求关键字段 | 返回关键字段 | 当前状态 |
| --- | --- | --- | --- |
| `system.handshake` | supportedMajor、clientCapabilities | protocolVersion、capabilities、sessionRef | frozen / 可用 |
| `task.submit` | goal、conversationId、attachmentRefs?、idempotencyKey | taskId、state、revision | frozen / 可用 |
| `task.get` | taskId | TaskSnapshot | frozen / 可用 |
| `task.list` | conversationId?、states?、分页和 snapshotSequence | 任务页、固定水位 | frozen / 可用 |
| `conversation.list` | conversationId?、分页和 snapshotSequence | 会话及任务历史页 | frozen / 可用 |
| `approval.list` | approvalId?、taskId?、state?、分页 | 脱敏审批页、事件水位 | frozen / 可用 |
| `task.cancel` | taskId、reason? | taskId、state、cancelAccepted | frozen / 可用 |
| `event.subscribe` | streamId、afterSequence? | subscriptionId、replayFrom | provisional |
| `capability.list` | kind? | manifests、health | provisional；只在 ToolGateway 配置时公布 |
| `authorization.respond` | approvalId、decision、expectedRevision | accepted、approvalState | provisional |
| `tool.invoke` | toolName、toolVersion、arguments、scopeRef | runId、confirmed/pending/unknown、结果引用 | provisional |
| `settings.get` / `settings.update` | namespace、revision、patch | value/revision | unavailable；仅 Schema/Fake |
| `connector.connect` / `connector.disconnect` | 连接器/账号字段 | 会话或清理结果 | unavailable；生产 Runtime 未路由 |
| `voice.start` / `voice.stop` | 设备/语音会话 | 音频格式或停止结果 | unavailable；只有 Schema |

`goal` 非空、`decision` 为 allow_once/deny（持续授权另按配置 Schema），`expectedRevision` 不匹配返回冲突。`scopeRef` 是已授权范围引用，不是允许调用者任填新路径的授权依据。高风险动作由 Runtime 创建独立 approval，工具不能伪造。

settings 中不传长期密钥。新增账号由受控连接流程接收凭据并存入凭据服务；UI 最多收到掩码和状态。

## 5. 任务状态与事件语义

TaskSnapshot 必含 `taskId`、`state`、`revision`、`updatedAt`、`steps`、`evidenceRefs`；结束时可含 `resultSummary`、`error` 和已发生的副作用摘要。

状态集合：`created`、`planning`、`running`、`waiting_approval`、`waiting_external`、`waiting_reconciliation`、`verifying`、`cancelling`、`succeeded`、`failed`、`cancelled`。

- 主路径：created → planning → running → verifying → succeeded。
- planning/running/verifying 可以进入等待或 failed；等待完成回到对应执行步骤。审批拒绝且没有可继续的步骤时进入 cancelled。
- 外部写入返回不明时进入 waiting_reconciliation，先读取外部结果，不重发。
- 取消请求进入 cancelling；执行器确认已停止且副作用状态已知后才能 cancelled。状态未知则 waiting_reconciliation，并保存 `cancelRequested=true`。
- 取消来得太晚且任务已结束时，返回已有终态和 `cancelAccepted=false`，不能将已成功操作改成未执行。
- 终态不可直接重开；重试创建新任务并引用原任务。部分成功后失败仍保留已完成步骤和不可逆副作用。

必备事件：`task.created`、`task.state_changed`、`task.progress`、`task.completed`、`task.failed`、`task.cancelled`、`approval.requested`、`tool.completed`、`notification.created`。具体 payload 按事件类型校验。

`task.progress` 提供 `stepId`、`label`、`completedUnits?`、`totalUnits?`；无法计量时不发送百分比。悬浮球状态由任务/语音事件映射，不能用虚假计时模拟实际进展。

事件至少一次交付；消费者按 eventId 去重，按 streamId/sequence 排序。`goo122` 为每个流提供递增序号，重连从已处理序号续订。回放窗口已过返回 `CURSOR_EXPIRED`，客户端获取快照后续订；有限队列满时显式要求重同步，不静默丢状态。

## 6. 工具、模块与依赖注入

模块导出 `register(host): dispose`。host 提供公共端口；模块通过接口调用，不导入 Runtime 内部实现或其他模块私有存储。

目录和依赖遵循 [项目目录规范](PROJECT_STRUCTURE.md)：`apps` 负责进程与装配，`packages` 不反向依赖 `apps`，连接器位于 `packages/connectors/<capability>/`。模块专用端口由消费模块拥有，只有稳定跨进程数据进入 `packages/contracts`。跨包禁止相对路径和未声明的私有深层导入。

工具描述包含：`name`（如 knowledge.search）、`version`、`inputSchema`、`outputSchema`、`sideEffect`（read/local_write/external_write）、`requiredScopes`、`idempotencySupport`、`recoverySupport`、`requiresPresence`。一个工具包含多种动作时按最强副作用声明，优先拆成独立工具。

`execute(input, context)` 的当前 context 由宿主注入：`taskId`、`runId`、`deadline`、`signal`、`authorizationRef` 和 scopes。受限 logger、Artifact/Evidence 等仍未提供，不得由工具私自扩展 context。回传数据需 outputSchema 校验；调用返回不一定代表业务已验证。

| 端口 | 负责人 | 状态与使用规则 |
| --- | --- | --- |
| TaskPort / EventPort / SchedulerPort | `goo122` | provisional 内部端口；所有模块通过 Runtime，不私建任务库 |
| ToolHost / ToolContext / PolicyPort | `goo122` | provisional；离线实现存在，真实模型/工具闭环未验收 |
| ModelPort | `goo122` | unavailable；仅为可选 Local Profile 和明确专业模型适配使用，不阻塞 Competition Golden Path |
| StoragePort | `goo122` | provisional；当前缺 revision、事务、容量和失败语义 |
| SecretStorePort | `zemeng` 实现 Windows 适配，`goo122` 控制注入 | provisional read；save/replace/delete/status unavailable |
| CoordinationPort | `zemeng`，Runtime 注入由 `goo122` | unavailable；主 Agent/认知与 Runtime 的独立边界 |
| MemoryQueryPort / FactChangeFeed | `goo122` | unavailable；记忆不直接修改 Goal/Task |
| CoordinationStorePort | `goo122` 适配、`zemeng` 消费 | unavailable；版本化目标/决策图谱存储 |
| ToolExecutionPort | `goo122` | unavailable 的稳定消费面；复用现有工具语义，不另造授权 |
| EvidencePort / ArtifactPort | `goo122` | unavailable；访问、过期、敏感性、分片与背压待定义 |
| CloudAgentPort | `zemeng` | unavailable；Competition 第一优先，封装 AgentArts deployment/version/trace/提案/usage/error，不持有本地授权 |
| KnowledgePort | `goo122` | unavailable |
| DesktopActionPort / VoicePort | `zemeng` | unavailable |

工具代码隔离必须在运行时落实，TypeScript 接口或进程拆分本身不构成沙箱。

## 7. 平台连接器契约

连接器方法：`connect`、`disconnect`、`getCapabilities`、`fetchChanges`、`search`、`getItem`、`performAction`、`health`。不支持的方法返回 `UNSUPPORTED_CAPABILITY`。

- `fetchChanges({accountRef, cursor, limit})` 返回 `items`、`nextCursor`、`hasMore`；`goo122` 宿主持久化批次后推进游标，重放依 dedupeKey 去重。
- `performAction({accountRef, action, input, idempotencyKey})` 返回 `actionId`、`state`（confirmed/pending/unknown）、`externalId?`、`evidenceRefs`。pending/unknown 不能当作已完成。
- `health` 区分 disconnected、connecting、ready、reauth_required、degraded、unavailable，附最后成功时间和脱敏原因。
- 连接器 manifest 包含 ID、版本、账号类型、能力列表、配置 Schema、认证方式、用户在场要求、同步策略和验证等级。`zemeng` 依此生成后台配置入口；特殊页面由 `zemeng` 持有。
- 业务记录带 source、accountRef、externalId、occurredAt、fetchedAt、contentRef、sensitivity、dedupeKey。预测/预报另带 validFor，不把获取时间当发布时间。

MOD-20 生成提醒规则，MOD-03 执行调度，MOD-23 决定汇总策略，`zemeng` 展示通知。四者各有唯一职责。

## 8. 错误、重试与副作用

| 错误码 | 消费者行为 |
| --- | --- |
| INVALID_ARGUMENT / PROTOCOL_MISMATCH | 修正输入或升级客户端，不自动重试 |
| UNAUTHORIZED / SCOPE_DENIED | 停止当前动作，显示授权状态，不自动扩大范围 |
| NOT_FOUND / UNSUPPORTED_CAPABILITY | 显示目标不存在/能力不支持，不伪造降级 |
| REVISION_CONFLICT | 读取新版本后重新计算变更，禁止覆盖 |
| RATE_LIMITED | 依 retryAfterMs、预算和 deadline 有界等待 |
| TIMEOUT / EXTERNAL_FAILURE | 根据是否发生副作用和幂等能力决定，不能仅看 retryable 重发写入 |
| RESULT_UNKNOWN | 核实外部状态，必要时等待用户处理 |
| CURSOR_EXPIRED | 读取快照或重新同步，再续订 |
| CANCELLED | 释放资源，保留已发生的结果 |

所有异步调用接受取消与 deadline；长任务不能依赖单个无限等待的 RPC。写入幂等键绑定账号、动作与规范化输入，同一键不同输入返回冲突；具体保留期由 `goo122` 的工具宿主声明，超出保留期不能声称仍防重。

## 9. 结果依据与数据安全

Evidence 记录：`evidenceId`、`kind`（observation/source/execution）、`sourceRef`、`capturedAt`、`summary`、`verification`（mock/verified/conditional）、`sensitivity`。没有依据时允许空列表，但回答必须明确未经验证。

外部内容不能成为系统授权；内部引用也校验访问范围。日志记录关联 ID 和脱敏摘要，不默认存原始邮件、音频、截图、密钥或模型隐藏推理。知识出机按目的模型与内容范围检查。

## 10. 独立开发联调包

已交付：JSON Schema/生成类型、Client、FakeRuntime 六场景、FakeToolHost/Storage/Connector、任务/会话/审批查询及 Desktop 恢复消费。冻结子集见接口目录。

下一批必须交付：

1. `zemeng` 先提供 Competition Coordination、CloudAgent、ToolProposal、Goal/Decision/Plan 语义和消费者测试；`goo122` 提供 Runtime/Memory/Tool/Evidence/Storage 的稳定端口与 Fake。
2. Runtime 注入 `CoordinationPort`，Competition 实现经 `CloudAgentPort` 调用 AgentArts；不直接依赖 AgentArts DTO、Local Agent 或 ModelGateway 具体实现。
3. AgentArts Adapter 先以 FakeCloudAgent 离线开发，再分别验收真实项目/Agent/Workflow、deployment、API、trace、usage、失败和本地执行读回。
4. 结构化 TaskResult、Evidence/Artifact、真实游标过期恢复、Host 生命周期、SecretStore 管理面和对应失败夹具。
5. Local ModelPort/Agent 扩展为可选后续工作，不阻塞 Competition Profile；现有实现保持可追溯，不为参赛删除。
6. 每项记录 profile、版本、提交、状态、消费者验证和真实能力限制。文档或 Fake 存在不能把 unavailable 直接提升为 frozen。

## 11. 最小消息示例

标识符为示例占位值，不作为生产生成规则。日期表示示例请求的有限 deadline。

```json
{
  "kind": "request",
  "protocolVersion": "1.0.0",
  "requestId": "example-request-1",
  "operation": "task.submit",
  "deadline": "2026-09-05T12:01:00Z",
  "idempotencyKey": "example-submit-1",
  "payload": {
    "goal": "在已授权笔记中查找项目计划",
    "conversationId": "example-conversation-1"
  }
}
```

```json
{
  "kind": "response",
  "protocolVersion": "1.0.0",
  "requestId": "example-request-1",
  "outcome": "ok",
  "data": { "taskId": "example-task-1", "state": "created", "revision": 1 },
  "evidenceRefs": []
}
```

此响应仅表示任务已创建；`zemeng` 等待真实终态事件或快照后才显示完成。

# 自有镜像接口与执行边界

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


## 2026-10-12 可执行资源绑定增量

新增 8 个 Workflow 与 3 个 Controller 的镜像专用调用及受保护目录；完整 ID、调用信封、
前置报告、默认 Controller 和结果隔离见 [绑定接口](OWNED_IMAGE_BINDINGS.md)。
该接口为 provisional，不扩本地 wire 或候选1.0，也不改变云输出不可信及本机执行边界。
普通 HTTP/WS 调用保持兼容；原空 MVP Controller 使用明确的新 owned 路由，不能算原云绑定恢复。

2026-10-09；MOD-29/30/31 与 MOD-04B/03 的必要消费接线，负责人 zemeng；Profile `huawei_ict_agentarts`。这是当前分支实现的 provisional 接口说明；真实 AgentArts 网关和 Wiki 仍待验收。

## 服务端部署接口

| 接口 | 请求与控制 | 响应/状态 |
| --- | --- | --- |
| `GET /ping` | 不调用模型 | JSON：Healthy/HealthyBusy、更新时间；仅证明进程健康 |
| `POST /invocations` | `Content-Type: application/json`；仅 `query` 字段，或显式配置的单一旧 Workflow `inputs` | JSON 事件数组；不是原生 SSE 流 |
| `GET /ws` Upgrade | `X-PA-Agent-Token: Bearer ...` 与合法 `X-HW-AgentArts-Session-Id`；严格版本化文本信封 | ready → accepted → result/error；平台/代理终止 TLS，本地只连 WSS；公网地址仍须验收 |
| `POST /invocation-status` | 同一内层 token、Session 与完整原调用身份；只接受 status 信封 | running/completed/failed/cancelled/unknown，只查询有界进程缓存，不调用模型或工具 |

入站 JSON 只接受指定字段。请求体上限 1,200,000 bytes；query 总量和工具目录另有公开解析器限制。`X-PA-Deadline` 为严格 UTC 时间，取原期限与服务上限较早值；超时覆盖上传、模型和序列化。断开触发取消，非协作 Provider 也不能拖住对外响应。

可选 `Authorization: Bearer ...` 由宿主注入，服务配置额外 token 时核验；AgentArts 模式仍要求平台入站认证。`X-HW-AgentArts-Session-Id` 与 `X-Request-Id` 只用于关联，必须为受限 ASCII 标识，不赋予用户权限。缺省关联 ID 由服务生成。

HTTP 状态包括 404（未知路径）、401（入站验证失败）、429（并发已满）、400（非法输入）、504（期限）、499（取消）和 502（外部/未支持错误，详见结构化 code）。错误响应只给规范化 code，不回显凭据、Provider 响应正文或模型输入。

成功外层示例：

```json
[
  {"event":"message","data":{"text":"{\"kind\":\"text\",\"text\":\"答复内容\"}"}},
  {"event":"task_end"},
  {"event":"end"}
]
```

`task_end` 是云调用返回事件，不是本地任务完成证明。Coordination 校验内层输出后，ToolRuntime/Policy 与实际读回仍决定任务结果。

## WSS 主通道与 HTTPS 备用

独立 `@personal-agent/contracts/agentarts-transport` 0.1.0 提供 Schema、生成类型、严格解析/编码及 payload SHA256；本地 wire 1.0.0 的既有操作保持兼容。信封绑定 sessionId、requestId、idempotencyKey、payloadDigest、原 UTC deadline，同身份不同输入/期限拒绝。结果只接收有序 message/task_end/end，帧及结果均限 UTF-8 字节数。详细决定见 [ADR-0014](../adr/0014-agentarts-wss-transport.md)。

云缓存最多256条、终态保留5分钟、连接最多64条，活动记录不被驱逐；HTTP与WS共享执行并发额度。同输入已确认缓存仅重放 accepted/终态，不再次调用模型。服务 ready 明示 `restartRecovery:false`，重启/失效查询返回 unknown。状态查询不是本地任务完成证据，目前没有自动 status 协调消费者；原未知调用保持 `waiting_reconciliation`，须可信读回后按后续工作包恢复。

桌面主进程通过 `PA_AGENTARTS_TRANSPORT=wss` 启用，必须显式提供 `PA_AGENTARTS_WSS_URL`；不生成或试探默认公网地址。只允许同网关/运行时的 `/runtimes/{runtimeName}/ws` 或 `/runtimes/{runtimeName}/invocations/ws` 精确路径。前者缺少公开路由依据，后者仅有前缀普通映射依据，两者的公网 Upgrade 都须实际验收；允许配置不代表平台已经支持。旧未配置消费者保留 HTTPS；自有镜像部署的 WSS 需要受信环境 `PA_AGENTARTS_APP_TOKEN`（客户端）与 `PA_AGENT_WSS_AUTH_TOKEN`（镜像）匹配，至少32个ASCII字符，不放URL、Renderer、Git或Evidence。外层平台Authorization继续由原安全配置读取。

`PA_AGENTARTS_HTTPS_FALLBACK=1` 仅为同一部署显式启用备用：证明 invoke 尚未交给socket的连接失败才可发送HTTPS；认证/协议错误或任何已发送结果未知均不能重发。降级在桌面连接状态可见。每次调用重读凭据、复用会话连接，在实际发送前重新核验出机授权和动态目录。发送前持久化inflight身份/摘要；终帧只保存received身份/摘要，须原competition-loop已持久消费提案或TaskRuntime已持久提交succeeded才清意图，封住收帧与本地消费之间的崩溃窗口。三个新checkpoint不保存请求body、模型正文或token；未知进入本机核实状态，重启和已确认本地工具回执都不能绕过。

## query 与公开契约

- 普通文本：没有工具目录时仅答复；看起来像 JSON 但解析非法时拒绝，不偷偷当自然语言处理。
- 初始 JSON 字符串：`{goal, availableTools}`；目录使用 Coordination 的公开 `CoordinationAvailableTool` 解析，未知字段/版本/非法参数拒绝。
- 继续轮次：`{continuation}`，复用公开 `CoordinationContinuation`。已确认工具回执、原请求与 repairContext 依照现有契约处理，不创建私有 DTO。
- 结果：`text`、`tool_proposal` 或 `repair_candidate` 的公开子集；始终由本地严格解析并视为外部未核实输入。

来源单一：`packages/coordination` 公共 exports 和解析器、`packages/agentarts/src/input.ts`、`packages/agentarts/src/index.ts`。不要复制类型再声称第二套接口 frozen。

## 编排与模型端口

`OwnedAgentOrchestrator.invoke({query,deadline,signal,sessionId,requestId})` 统一进入 fast/world/plan/review；每角色调用 ModelGateway/ModelPort，并继承期限、取消与输出预算。普通请求走 fast；受限计划修复走 World→Plan→Review，核对影响范围、版本、依赖和最终候选。

角色回执只记录 role、requestId、promptVersion、started/completed/failed 及可选 totalTokens；不记录原提示词、私人资料、密钥。真实 Provider 使用受信启动配置，缺配置明确失败，没有 Fake 回退。owned-1.1 已包含版本化 World observed/changed/affected 和 Plan 保留/复核/修订/移除、依赖、证据需求与后续建议，但现有候选不能执行删除/新增步骤或工具动作，明确拒绝不支持项。缺连续事实前后版本需 RECHECK，direct/transitive 只是未验证分析，须本地图谱核实。[8工作流/3控制器迁移矩阵](../modules/AGENTARTS-OWNED-IMAGE-PARITY.md)逐项列出兼容与缺口，不宣称真实语义等价。

## 工具执行与权限

镜像消费本地公布的动态工具目录，产生工具提案；不打包 Desktop、TaskRuntime、业务凭据或本机文件执行器。MOD-06~09/16~18/20~26/33 已公布能力通过本地 ToolGateway/Connector Host 消费。未公布能力必须拒绝，不能为了“全部接口”虚构生产可用工具。

工具执行仍遵守用户授权、参数绑定、一次性消费、未知结果协调与实际读回。修复候选仍需本地版本/CAS/审批；模型和云端无权更改任务终态。

## 验证等级与后续

本 PR 包含编排、HTTP/WS服务、严格传输契约、截止/取消/并发校验、本地Runtime防重发、Desktop可信配置、allowlist镜像上下文、Dockerfile及针对性测试。真实TLS回环连接测试与SQLite工具闭环测试使用显式合成模型；完整check、容器和各版本发布证据分别记录。镜像构建/上传只证明构建/发布；真实云模型、AgentArts deployment/API/trace、工具闭环与评估仍待验收。

目标双通道、Wiki 和常驻监管见 [完整设计](../design/resident-developer-agent-20261008/DESIGN.md)；Wiki 接入交给 [goo122](../design/resident-developer-agent-20261008/WIKI-MEMORY-HANDOFF.md)。合并遵守 [两人本机阅读门槛](../reviews/DESIGN_READING_GATE.md)，禁止强制合并。

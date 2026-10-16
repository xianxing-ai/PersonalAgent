# 工作流生产接线增量 V4

目标为 `huawei_ict_agentarts`。本包延续本机 Laya、镜像内工作流、原 Runtime/Policy/ToolGateway/Evidence；不重新决定模型或架构，不恢复暂停的最小修复算法。当前长期负责人仍以 [MODULE_ASSIGNMENTS](../MODULE_ASSIGNMENTS.md) 为准，CW 分工以 [交付矩阵](COLLABORATOR_WIRING_PACKAGE.md) 为准。

本轮未发布镜像。历史 V3 的 SWR、云版本、41 条真实工具 Evidence 和未达 150ms 的 Laya 结果保持原时间及范围，不能证明本轮新代码已部署。新增入口均 provisional，不新增 Core wire operation 或独立任务库。

## 生产调用链与接口

| 工作包 | 实际入口及消费方 | 边界 |
| --- | --- | --- |
| CW01/CW06 | 原候选生成可在同一次回答附 `shadowIntent`；原 `decision.choose_candidate` 返回经校验的可选 metadata；`local-laya` 保留实际自适应决策来源 | 候选文本不能自证 Laya/教师参与或资格；实际来源由可信调用记录构造，不追加固定模型判断 |
| CW02/CW03 | `createRuntimeProactiveImageAdapter` → 原 AgentArts `/invocations` 的 `proactiveVersion:1` → 镜像 controller → 共享 HMAC 完整结果校验 | 复用原网关认证，内层 host bearer 独立；JSON/SSE 均检查原请求、会话、版本、期限和终态；未知响应不自动重发 |
| CW03/CW05/CW07 | `RuntimeApplication.createProactiveWorkflowHost/startProactiveTask/runProactiveTask/resumeProactiveTask` → 原 TaskRuntime worker | Connector batch、原用户指令、已绑定 child 报告、原 Scheduler wake 进入同会话；idle、等待设备、暂停均不等于父任务成功 |
| CW01/CW06 | `RuntimeApplication.createOwnedWorkflowHost` → 原 `OwnedWorkflowHostBridge.submitWithShadow/readReceiptWithShadow/refreshShadowReceipt` | 同一 operation/参数、原 TaskRuntime checkpoint 和真实工具回执；没有新的执行循环或授权源 |
| CW06/F23 | `RuntimeApplicationOptions.workflowShadowRelease` → 原 ToolGateway 注册 F23_N04 写入和 F23_N05 原操作读回 | 配置 CAS、验收标准、完整来源验证和 scopes 来自受信宿主；N05 不会触发第二次写入或回滚 |
| CW09 | Desktop 通知设置 → 原 host task/审批/ToolGateway → 单个 Runtime NotificationHost；Todo 注入同实例 | 原设置 revision/CAS；静默 feed、真实 show、已读及 unknown 独立；原旧策略不得静默丢弃 |
| CW10 | 当前问题/参数 → 已开启 Live 的主动询问 → 实际输入音频 completed item → 当前参数确认 → 原审批或设置工具 | 自然明确同意/拒绝；partial、回声、旧 item/问题/参数不消费授权；queued 仅表示已送入活动语音会话 |

`OwnedWorkflowEngine` 保留 28 图/185 节点的串行 frontier。设计源以既有生成器投影到 `owned-workflow-data.ts`，不手改生成数据。可选 guard 仍须有真实条件读回，不能因必选节点先完成而提前声明图 settled。目录、Fake 双图回归与真实业务验收分开记录。

## 主影子接线

`WorkflowSelector` 兼容旧字符串选择，并接受 `{selectedId, metadata:{shadowPlan}}`。metadata 内只允许版本化的任务类别、普通/比较意图、层级、原候选引用、是否请求、是否不确定和来源字段；未知字段/候选拒绝。

宿主通过 `WorkflowShadowHostPolicy.readSnapshot` 读取当前高级开关、主任务优先/资源观察、隔离根及实际分支回执。`comparisonRequested` 来自可信用户意图；模型自填 `mode:compare` 不能把普通任务变成强制双跑。HostBridge 绑定原 task/session/controlRevision/taskDeadline，签入原工具回执。Engine、checkpoint 和 `delivery` 消费同一份评估，不另起调度器。

新隔离操作每次重新准入；已提交且结果未知的 operation 先独立读回，不因设置变化或隔离根已释放就重提。资源约束位于新操作准入边界，不等于已经实现对正在运行工具的安全抢占。高级隔离须有真实本机 Laya 与教师参与引用以及可信隔离证明。缺反事实或结果来源时保持 unknown；策略 `run` 不证明已执行。

F23 的公开组合示例：

```ts
const application = createRuntimeApplication({
  path: runtimeDatabase,
  profile: 'huawei_ict_agentarts',
  hostUserNamespace: currentUserNamespace,
  workflowShadowRelease: {
    sideEffect: 'local_write',
    configurationPort: existingConfigurationCas,
    acceptance: ownerReviewedAcceptance,
    verifyBranch: verifyOriginalBranchEvidence,
    verifyComparable: verifyOriginalPairContext,
    verifyTestEvidence: verifyOriginalTestEvidence,
    requiredScopes: existingConfigurationScopes,
  },
});
```

变量均由已有受信组合提供，不是可直接执行的假配置。缺口如实返回 unavailable，不能由候选或请求 JSON 安装配置写端口。N04/N05 都走原 Policy。

## 主动 Runtime 与桌面

`proactiveWorkflows:true` 注册原 Runtime 的 retrieve/update/wake/notify 工具，不自动建立责任、授权或连接真实账号。`proactiveDecision.localChooser` 复用既有本机 Laya chooser；教师工具复用当前 Competition Coordinator 内的 AgentArts/ModelGateway 路径。原 checkpoint 提供完整用户引用、公开事实、知识片段与 Goal 上下文。当前基础 Laya 仍仅候选，不因此标为已校准。

教师纯选择请求在现有进程内 `CoordinationRequest` 上显式使用 `textOnly:true`，沿用同一部署、认证、取消、期限和发送前权限检查；不导出工具目录、不接受 continuation 或工具/修复提案。旧工具请求仍要求原真实工具目录，不修改外部 wire operation。此可选字段为 provisional 接线能力，未知字段和混用模式仍拒绝。

Desktop 的 `proactive-workflow-host.js` 只负责可信配置、原指令引用及命令适配。worker、事件等待、审批继续和恢复在 Runtime Application；没有 Desktop 第二执行循环。下列 IPC 由已有受信 panel/admin 消费：

| 操作 | 参数/用途 |
| --- | --- |
| `proactive.workflow.status` | 配置与本机已绑定会话状态，不含密钥 |
| `proactive.workflow.start` | `sourceTaskId, commandId, taskDeadline`；读取原用户指令，以原 TaskRuntime 建立稳定幂等责任任务 |
| `proactive.workflow.control` | `taskId, sourceTaskId, commandId, action, expectedControlRevision`；pause/resume/cancel/enter_unattended/return |
| `proactive.workflow.resume` | `taskId`；恢复原持久绑定及 worker，不能重开终态或未知写 |
| `proactive.workflow.read` | `taskId`；读取原 TaskRuntime 和当前会话版本 |

真实来源协作者使用绑定 host 的 `eventSink`，不能把通知 ingest 当来源 cursor 确认；`ingestWake` 只接受原 Scheduler 已 fired 的绑定。已绑定子任务报告由 Runtime 的原 dispatch/refresh 消费，不依赖 Renderer 自报成功。外部持久云执行 host 缺失时仍 waiting_device，桌面在线不等于支持关机后运行。

桌面主进程配置使用现有 AgentArts 配置及以下受信环境项：

- `PA_PROACTIVE_CONTRACT_REF`：镜像实际 describe 目录中的契约 ID；版本必须读回匹配。
- `PA_WORKFLOW_RECEIPT_SECRET`：与镜像匹配的 host receipt secret。只能由受信配置提供，不传 Renderer。
- `PA_AGENT_WSS_AUTH_TOKEN`：同镜像内层 bearer。现有 AgentArts 外层 Authorization 仍由安全存储读取。

镜像通过原 `PA_AGENT_SERVICES_CONFIG_FILE` 的 `proactive.decisionContracts` 接受受信契约；不从调用 JSON 加载代码、模型、凭据或端点。`qualifiedForMain` 不得凭演示设成 true。未配置时 describe 可说明目录，实际责任仍 unavailable。

## 上下文与证据

当前源、用户引用、Goal、公开 Memory 和公开 Knowledge 分别保留来源与版本。Desktop 只注入固定公开事实 namespace、原 GoalStore，以及当前已授权的 public Knowledge lease；每次检查配置/查询许可并释放 lease，私人 Vault 不因主动模式而进入云端。

历史 `readContext` 只读取已保存快照；新判断或动作必须走当前版本校验。源更正、撤回、过期与无法确认不能解释为“没有变化”。已发出的未知写只核实原 operation。所有成功声明仍依赖原 ToolGateway Evidence、实际源端和目标读回。

控制版本切换前若提案确实从未建立执行意图且原 Runtime 无 run，记录原控制事件后可作 `failed/not_performed` 核实，再重取新版本上下文。存在 pending/started/unknown 时不适用此规则。恢复原 worker 需要原期限、版本、检查点和已确认工具记录；这不是新授权。

## 验证与未验证范围

最终本轮命令、时间、日志摘要和结果保存在同包 Evidence。必要验证包含根 `npm run check`、当前设计投影检查、受影响的实际 HTTP/SQLite/桌面消费、28 主图与 28 隔离图的明确 Fake 回归，以及完整公共编码案例的独立实测。

真实账号来源、物理通知/麦克风/扬声器、机会影子资源收益、平台原生知识/MCP/评估、远端完整业务闭环，均须各负责人独立配置并交 Evidence。接口注册、可信签名、离线通过、构建和发布分别记账。此文件不将全部 MOD、28 个真实业务或当前架构标为最终完成。

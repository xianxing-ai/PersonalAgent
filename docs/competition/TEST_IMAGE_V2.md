# V2 可接线测试镜像

> 历史适用范围（2026-10-15 补注）：下文保留原日期、固定版本及当时的测试/失败记录。后续当前模型、本机 Laya、镜像发布与有限验收以 [当前详细设计](../design/CURRENT_DESIGN_20261015.md)、[V3 实测](TEST_IMAGE_V3.md) 及 [协作者接线](COLLABORATOR_WIRING_PACKAGE.md) 为准；历史“当前/未发布/未验/双人批准”等表述不覆盖后续事实或现行协作规则。


2026-10-15，`huawei_ict_agentarts`，工作树 `laya-owned-runtime/PersonalAgent`。本包扩展镜像内部控制和公开服务接线；模型沿用既有配置，架构仍为实验状态。镜像不推送、不替换华为部署。最小修复、失败重试和依赖增补算法等待用户设计，原有代码及失败证据保留，本包不启用新的自动修复策略。

## 产物与证据入口

目标 Linux ARM64、8080 端口、非 root 用户；`GET /ping`、`POST /invocations` 和既有 WSS。

- 镜像标签：`personal-agent:test-v2-local-laya`。
- 交付归档：`.cache/agentarts-image/test-v2-local-laya.tar`。
- 可复建上下文：`.cache/agentarts-image/test-v2-build-context.zip`。
- 可编辑源码：`.cache/agentarts-image/test-v2-source-20261015.zip`。
- V2 当时预留的最终 `test-kit.json` 未生成，不能作为产物回执；已有检查见下方 checks/container-smoke，当前实际交付另见 [V3](TEST_IMAGE_V3.md)。本说明不预填散列或测试通过数。

源码包不包含密钥、依赖、Python 环境或 Laya 权重。Git 基线、未提交源码、构建上下文摘要和最终归档分别核对，HEAD 不代表全部构建输入。V1 的历史记录见 [TEST_IMAGE_V1](TEST_IMAGE_V1.md)，不能据其验收 V2。

## 全部功能及协作入口

F01–F28、185 个节点的功能名、依赖、条件分支、反馈边、公开工具、输入输出和 adapter 缺口统一查 [workflow-wiring.json](workflow-wiring.json)；不另外维护一份完成度表。在线读取 `workflowVersion=1.0.0, operation=catalog` 可核对镜像实际目录；指定 `workflowId` 可取得单条模板及 adapterRequirements。

```powershell
$paWiring = Get-Content docs/competition/workflow-wiring.json -Raw | ConvertFrom-Json
$paWiring.workflows | Select-Object workflowId,name,requiredTools,adapterRequirements
```

文件清单是设计与接线依据，不代表全部生产能力可用。Engine/HostBridge 的控制覆盖使用明确 Fake 外部工具和真实签名检查点；真实账号、设备、平台读回分别验收。接口成熟度查 [CURRENT_INTERFACE_CATALOG](../interfaces/CURRENT_INTERFACE_CATALOG.md)，长期所有权查 [MODULE_ASSIGNMENTS](../MODULE_ASSIGNMENTS.md)：

- zemeng / zemeng5208：AgentArts、核心认知、目标、桌面、语音、Windows 和编码工具，维护本镜像组合入口。
- goo122：Runtime、公共协议、Policy/ToolGateway、MCP/Skills、知识/Wiki/记忆及对应基础端口。镜像不另造任务库、授权器或知识后端。
- Potatos498：MOD-20–26 业务连接器及业务消费接线；邮件、研究、通知等的准确 scope/条件注册与真实配置缺口查 [本地接线表](TEST_VERSION_LOCAL_WIRING.md)。

跨模块只消费已公开 exports/descriptor；未提供的 adapter 保持 unavailable。模块状态、PR 合并及发布状态仍分别记录。

## Engine 控制及期限

镜像默认串行推进；候选准备/选择不执行本地工具。真实副作用仍经本机 Runtime → Policy → ToolGateway，可信结果由原 TaskRuntime/Evidence 读回后经 HostBridge 回传。

`OwnedWorkflowEngine.advance` 支持条件分支及 `selected/all/any` 汇合规则。选中分支的 unknown/failed 不算完成；未知写入保留原 operationId、参数及证据，不自动重放。

advance 信封可携带 `checkpoint`、`receipts`、`resolvedValues`、受信 `migration`、`hostControl` 和 `taskDeadline`。控制动作是 `pause`、`resume`、`continue`、`notify_controller`、`request_controller`、`request_user`；后两者分别产生 awaiting_controller/awaiting_user，通知主控只是可观察请求，不是假造通知投递或用户批准。暂停时记录真实在途回执，但不再发出新操作。

本地通过 `OwnedWorkflowHostBridge.control(request, command)` 签名控制，`createOwnedWorkflowReceiptVerifier` 校验。签名绑定任务/session/revision/原 checkpoint，命令身份重放幂等，篡改或旧检查点签名拒绝。签名证明来源，不签发工具权限；`continue` 不能代替原 Policy 审批。

**宿主必须持续传入 TaskRuntime 的原始 `taskDeadline`。** 每次 transport 的 `deadline` 可以移动，有效期限取二者较早者；暂停、模型升级、影子和后续 HTTP 调用均不重设原任务期限。旧调用者未传 taskDeadline 时，首次 invocation deadline 被固定为逻辑期限，后续较长 HTTP 窗口不会续期。

## 影子：三个层次、同次决策和发布读回

`shadowVersion:1` 的 `operation:evaluate` 是影子策略服务；只有可信启动配置提供 shadowPolicy 时注册。它返回签名的建议，始终 `actualExecutionVerified:false`、`authority:advisory_no_tool_grant`，不自行启动分支或完成本地任务。

| 层次 | 实际边界 |
| --- | --- |
| decision_shadow | 对冻结输入比较决策，不能据此宣称工具反事实或双分支实际执行 |
| trace_replay | `shadowVersion:1, operation:replay` 可重放签名冻结历史；历史读复用不构成新执行或当前反事实，缺少匹配证据仍为 unknown |
| isolated | 需要真实隔离 snapshot/namespace 回执、当前资源与任务价值条件；仍经原 Runtime 执行及读回 |

同次候选可在 `candidate.value` 的业务数据中携带 `shadowPlan` 意图；不要新增顶层 `candidate.shadowPlan`，当前顶层候选契约不支持该字段。实际 taskKey/decisionRef 由可信宿主绑定。高级 isolated 启用要求同次 DeepSeek 与 Laya 参与引用，不能只凭代码标志、空引用或模型自报启用；未验证的 Laya 最终判断/未解决的不确定性返回 need_teacher。接管由 DeepSeek 完成，避免重复强迫同一 Laya 门槛。隔离证据缺失则 defer。

公开宿主辅助函数位于 `@personal-agent/agentarts-runtime/shadow-controller`：

- `signWorkflowShadowRequest`：签名原任务请求；body 包含 taskId/sessionId/controlRevision/taskDeadline/requestId、plan、可信 resources、observedBranches 和 historySnapshot。
- `signWorkflowShadowIsolationReceipt`、`signWorkflowShadowBranchReceipt`：只在宿主核实实际隔离、执行和 Evidence 后调用，不能用模型声明作为输入事实。
- `verifyWorkflowShadowResponse`：验证返回签名、原请求摘要和当前任务上下文；客户端发送相同的 `x-hw-agentarts-session-id`、`x-request-id`。

采样/比较使用公开 `evaluateWorkflowShadowPolicy` 和 `createWorkflowShadowHistory`；历史由现有 TaskRuntime checkpoint 适配持久保存，镜像只读取签名快照。历史每对主/影分支必须有相同任务/session/revision/原期限和相同决策、基线、条件、质量指标，以及不同真实隔离工作区。只有有效可比回执进入经验统计；不把缓存或经验统计称为训练。

采样参数由可信 owner 明确配置 `sampling.{base,min,max,adjustmentRate,minimumVerifiedSamples}` 与 `comparison.{qualityWeight,wallMsWeight,modelCallWeight}`，本说明不设阈值。普通模式主分支优先；显式 compare 模式需要实际可比结果。控制器建议不能成为新增执行授权。

F23 的发布/回读/回退复用公开 `createWorkflowShadowReleaseService` 与 `createWorkflowShadowReleaseAdapter`。宿主必须注入：现有 configurationPort 的 read/readOperation/compareAndSet、有效 acceptance 配置、verifyBranch、verifyTestEvidence，以及 **verifyComparable**。后者须将完整签名 task/session/controlRevision/原 taskDeadline 与当前受信绑定比较；仅各自签名有效或两个不透明字段相等不够。

release adapter 在原 ToolGateway 注册到 F23_N05，显式声明真实 `sideEffect: local_write | external_write` 和既有 requiredScopes。promotionReady 必须来自所声明的比较规则、测试 Evidence、CAS 操作核实和当前配置读回。unknown 使用原操作 readOperation 核实，不盲写第二次；rollback 绑定原 promotion、完整原配置参数及当前 revision，不能覆盖他人的后续修改。缺配置/验证端口返回 unavailable。公开平台 controller 没有直接发布/回退命令，此处也不授权实际发布。

### 已实现的冻结历史 replay endpoint

独立的历史重放实现为 `apps/agentarts-runtime/src/trace-replay.mjs`，通过同一个受认证 shadow controller 调用：`shadowVersion:1, operation:replay`。它复用已配置 shadowPolicy 的 controller 注册；没有可信启动配置时不可用。此接口只处理宿主已经核实并冻结导出的历史数据，没有工具/模型执行端口、授权器、重试循环或新历史数据库。

请求顶层严格为 `shadowVersion`、`operation`、`taskId`、`sessionId`、`controlRevision`、`taskDeadline`、`requestId`、`snapshot`、`requestedActions`、`proof`；与 evaluate 的 plan/resources/historySnapshot 信封不同。

- `snapshot` 为 `{asOf, sourceVersions, records}`。asOf 不能在未来；每条记录的 observedAt 不晚于 asOf，sourceVersions 与冻结快照一致。宿主从实际 Runtime/工具/模型回执导出 records，不用模型总结替代原记录。
- records 共同字段为 recordId、kind、observedAt、sourceVersions、state、result、resultDigest、evidenceRefs、effect。工具记录额外包含 toolName、toolVersion、arguments、argumentsDigest；decision/model 记录额外包含 name、version、input、inputDigest，effect 为 none。
- `requestedActions` 的每项严格包含 actionId、toolName、toolVersion、arguments、argumentsDigest、sourceVersions；digest 来自原始有限 JSON 的规范摘要，不能手填“相同”标签。记录与动作的版本/摘要不一致、重复身份或同一历史调用的结果/状态/副作用矛盾时拒绝。

只有相同 read 工具名、版本、argumentsDigest 和 sourceVersions 的有 Evidence 历史记录可以复用原结果。历史 confirmed read 标为 reused_historical_read；历史 failed、unknown 分别保留为 historical_failed、historical_unknown，不改称本次成功。历史 write 只进入 timeline，requestedAction 返回 write_not_replayed/counterfactual_unknown，绝不重新执行。缺相同历史调用或缺 Evidence 时返回明确 counterfactual_unknown；不会调用工具补齐反事实，也不会把不匹配的 sourceVersions 当同一快照。

timeline 保留历史工具/决策/模型记录与 Evidence 状态，`executedDuringReplay:false`。整包结果明确 `actualToolCalls:0`、`actualModelCalls:0`、`authority:data_only_no_tool_grant`、`currentResultValidity:not_independently_verified`、`counterfactualComparison:unknown`、`trainingPerformed:false`。历史 Evidence 只证明冻结导出来源，不保证当前结果仍适用。

宿主继续使用 `signWorkflowShadowRequest` 对整包签 HMAC；响应为 `operation:replay_result`，原 task/session/controlRevision/taskDeadline/requestId 和请求摘要均绑定。`verifyWorkflowShadowResponse` 已根据原请求 operation 区分验证 replay_result 或 evaluation_result，不能把两种响应互换。有效期限仍为原 taskDeadline 与当次 transport deadline 的较早者；HTTP header 的 session/request 身份须与签名体一致。

```javascript
const request = signWorkflowShadowRequest({receiptSecret, value: {
  shadowVersion: 1, operation: 'replay',
  ...originalTaskContext, requestId,
  snapshot: trustedFrozenExport, requestedActions
}});
// 经原认证 transport 发送 request，解开 message.data.text 得到 response。
const replay = verifyWorkflowShadowResponse({
  receiptSecret, response, request, currentContext: originalTaskContext, signal
});
```

`OwnedWorkflowEngine.mode='trace_replay'` 的旧停点**不会自动消费此 endpoint**。F22 的 `shadow.historical_trace` adapter 仍须由对应协作者将已核实冻结来源绑定到公开 replay 服务，再按原 Runtime/ToolGateway 和回执契约消费；当前不能据 replay endpoint 存在宣称 F22 自动接通或执行了双分支。此增量不启用暂停中的最小修复算法。

## 平台服务及可信配置

`platformVersion:1` 通过认证后的既有 `/invocations` transport 调用：

| operation | 字段及作用 |
| --- | --- |
| list | 读取状态、缺失配置和已公布工具；不发起真实工具执行 |
| mcp.discover / mcp.list | 协商并发现可信配置的 MCP 服务 / 读取目录 |
| mcp.call | toolName、toolVersion、arguments；委托原 Runtime 工具端口 |
| knowledge.search | query、limit；使用启动时明确选择的 local 或 platform KnowledgePort |
| observation.read | request 为 trace/log 查询；返回 MOD32 投影，不返回原始日志正文 |
| evaluation.read | request 为 evaluationId、revision；需要显式 readResult/validateResult adapter |

runtime 新增直接依赖 **MCP SDK 1.31.0**，复用官方 Client/StreamableHTTPClientTransport，严格核对允许的协议版本、server identity、受信工具绑定和输入 Schema。未知工具或漂移不注册；MCP annotations 不授予权限。`mcp.tools()` 仅供可信宿主在既有 Runtime 注册，公开 mcp.call 要求 toolExecutionPort、getToolInvocationContext 和实际已注册 descriptor，不能直接绕过 ToolGateway 调用 SDK。

知识两条路线都支持既有 KnowledgePort.search 形状，保留 excerpt 与 source 的 vault/path/line/revision；local 未绑定或 platform 未绑定都明确不可用，不静默互换，不把本地 Vault 后端搬进镜像。

MOD32 投影直接复用已合并 main 的 `@personal-agent/agentarts/observability`，普通 build 会复制其原生 ESM/声明到 dist。观测 HTTP client 只实现仓库已核实的 cn-southwest-2 区域及 trace/log 只读路径，注入官方签名回调；其他区域没有已确认契约时 unavailable。cost、deploymentVersion 或请求关联缺证据就保留 unavailable/unknown/not_checked。评测与平台 learning API 无已确认生产 client，不编造 URL；评测可由显式 adapter 提供，平台 learning 状态仍列缺口。

启动变量：

- `PA_AGENT_SERVICES_CONFIG_FILE`：容器内可信 JSON 路径，顶层只允许 platform、shadowPolicy。JSON 放非秘密静态配置，不放函数、凭据或模块源码。
- `PA_AGENT_PLATFORM_ADAPTER_FILE`：容器内**绝对路径**的本地 ES module，公开 `createTrustedPlatformPorts()`。只从 operator 启动配置加载，不能来自用户/模型 payload。

最小可解析 JSON 示例只声明路线，端口仍会如实 unavailable：

```json
{"platform":{"knowledge":{"route":"platform"}}}
```

需要 MCP 时追加 `platform.mcp.{endpoint,serverIdentity,protocolVersions,bindings}`；bindings 含 remoteName 和真实本地 descriptor。需要影子时由 owner 提供完整 shadowPolicy 参数，不能使用本文虚构默认值。

adapter 返回的对象是 platform 选项本身，不再套一层 platform；其中函数/对象必须连接实际既有公开端口：

| 选项 | 可信宿主注入内容 |
| --- | --- |
| mcp.getCredentialHeaders / mcp.authorize | 受限凭据 getter / 原宿主授权检查，不能简单放行冒充 Policy |
| toolExecutionPort / getToolInvocationContext | 原 Runtime list/invoke 与真实 taskId/runId/authorizationRef/deadline/signal |
| knowledge.local / knowledge.platform / knowledge.authorize | 已绑定来源的 KnowledgePort / 对应只读授权 |
| observation.authorizeRequest 或 observation.reader | 官方签名器回调或已存在的真实只读 reader |
| evaluation.readResult / validateResult / authorize | 明确 API reader、响应契约与授权；缺少则 unavailable |

静态配置与 adapter 按现有 createImageServices 组合，未注入的能力列 missingConfiguration，不回退 Fake。adapter 文件不属于远端 payload，它是可信启动代码，依赖必须已在镜像中并使用公开 exports。

## 导入、启动与读取目录

使用 Node **24.15.x**、npm **11.12.x**、Docker。直接导入交付 tar 无需重新下载源码依赖：

```powershell
docker load --input .cache/agentarts-image/test-v2-local-laya.tar
docker image inspect personal-agent:test-v2-local-laya --format '{{.Id}} {{.Architecture}}'
```

如需从源码复建，按 [V1 构建入口](TEST_IMAGE_V1.md) 安装并构建已有 workspace，再生成 allowlist 上下文；本包 runtime src 与包 dist 进入镜像，根目录、凭据、Python/权重不进入。不得用整个工作树直接替代 allowlist 上下文。

在受保护且 Git 忽略的 `.cache/first-test-image-v2.env` 配置原有 `PA_AGENT_MODEL_BASE_URL`、`PA_AGENT_MODEL`、`PA_AGENT_MODEL_API_KEY` 或容器内可读 KEY_FILE、`PA_AGENT_WSS_AUTH_TOKEN`。四个角色可使用原有 FAST/WORLD/PLAN/REVIEW 覆盖项，保持既有模型选择。本包不替用户换模型、设付费/token/采样阈值。

有配置时设置容器内 `PA_AGENT_SERVICES_CONFIG_FILE=/run/personal-agent/services.json`；需要真实 adapter 时再设置 `PA_AGENT_PLATFORM_ADAPTER_FILE=/opt/personal-agent/trusted-adapter/adapter.mjs`，将受信目录只读挂载至该路径。这个位置可沿镜像项目目录解析已安装包；Windows 宿主绝对路径不能直接作为 Linux 容器路径。未挂载/未配置 adapter 不妨碍镜像启动，但对应真实能力不可用。

```powershell
$paConfig = (Resolve-Path .cache/test-v2-services.json).Path
docker run --detach --name personal-agent-test-v2 --publish 127.0.0.1:44173:8080 --env-file .cache/first-test-image-v2.env --mount "type=bind,source=$paConfig,target=/run/personal-agent/services.json,readonly" personal-agent:test-v2-local-laya
Invoke-RestMethod http://127.0.0.1:44173/ping
$paHeaders = @{'x-pa-agent-token'='Bearer '+$env:PA_AGENT_WSS_AUTH_TOKEN}
$paQuery = @{platformVersion=1;operation='list'} | ConvertTo-Json -Compress
Invoke-RestMethod http://127.0.0.1:44173/invocations -Method Post -Headers $paHeaders -ContentType application/json -Body (@{query=$paQuery}|ConvertTo-Json -Compress)
```

本机 token 与容器内 token 必须匹配，不将值打印或保存到 Evidence。Dockerfile 已指定 `PA_AGENT_HOST_MODE=agentarts` 与 `PA_AGENT_LAYA_MODE=local`；Laya 权重和服务仍在本机，不在镜像里加载。可选实验模型回合仍通过 `PA_AGENT_TEST_VERSION=1` 开启，默认关闭；其 HTTP model_turn 不幂等，超时或断线不得盲重发。

HTTP 返回事件数组，`message.data.text` 是内部 JSON；task_end 是传输回合结束，不是本地 TaskRuntime 业务任务已成功。无效凭据拒绝服务调用，错误响应不回显 Key、URL、路径或底层异常。

## 验证边界与下一步

V2 的构建、测试、ARM64 镜像身份与 smoke 只按已有 checks/container-smoke 回执判定，未生成的归档清单不算已交付。控制/平台夹具使用真实 Engine/Bridge/MCP SDK/公开投影和显式 Fake 外部响应；不等于账号、MaaS、真实 MCP、知识服务或华为部署已连通。

本轮真实 MaaS/平台验收未执行。先前鹈鹕主/影分支的独立真实回执属于其当时快照，不能证明新增影子策略、F23 配置发布或全部 F01–F28 真实闭环。下一步由原 owner 绑定实际端口及授权，分别记录真实执行、读回、Evidence 和终态。最小修复算法仍等待用户方案，不以该缺口阻断其余镜像交付，也不临时启用替代算法。

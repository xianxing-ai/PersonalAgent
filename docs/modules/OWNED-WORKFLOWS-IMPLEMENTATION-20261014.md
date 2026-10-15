# 自有镜像 F01—F28 图内核与接线边界

起始日期：2026-10-14；开发增量更新：2026-10-15。目标 profile：`huawei_ict_agentarts`。接口状态：**provisional**。

本增量把设计页的 **28 个不同工作流、185 个详情节点**编译为镜像内的可执行图模板，
并交付依赖/条件/分支汇合与原操作回执驱动的图内核。它不是把 28 个名称指向同一个 fast 模型。
实际业务能力是否可运行仍取决于宿主已注册的工具及公开端口；缺项明确返回 unavailable。
图计算、模型候选、工具提案、本地执行、可信读回和比赛平台部署是分别验收的事实。

上一轮开发源码 `e4c87c1d25514422880f370f939a0a41a8962725` 尚未发布；
完整记录见[2026-10-15 开发证据](../competition/OWNED_LAYA_DEVELOPMENT_20261015.md)。
下文的 2026-10-14 发布记录仍只对应原 `fe886677` 镜像，不证明新源码已经部署。
后续主流程微批实现、当前源码检查及真实 CPU 对照见[批处理记录](../competition/OWNED_LAYA_BATCHING_20261015.md)。

## 文件与兼容性

- `packages/agentarts/src/owned-workflow-data.ts`：设计页数据的生成投影；保留节点、依赖、条件与反馈边。
- `packages/agentarts/scripts/import-owned-workflows.mjs`：从审核过的 `architecture.json` 生成/核对该投影。
- `packages/agentarts/src/owned-workflow-templates.ts`：模板编译和每个宿主步骤的准确工具/端口能力映射。
- `packages/agentarts/src/owned-workflows.ts`：无磁盘状态的图 frontier 推进、唯一选择器、完整性签名检查点、回执核实。
- `packages/agentarts/src/owned-workflow-host-bridge.ts`：复用本地 RuntimeApplication 主机工具任务的原操作绑定、真实回执来源签名与版本迁移证明。
- `apps/agentarts-runtime/src/binding-dispatch.mjs`：现有受保护调用入口上的独立图协议。
- `packages/agentarts/test/owned-workflow.test.mjs`：结构、并行、条件汇合、取消、签名、未知结果等测试。

旧 `bindingVersion: "1.0.0"` 的 8 个 Workflow / 3 个 Controller 保留其身份和行为。
新增的 28 图目录使用 **独立** `workflowVersion: "1.0.0"`，当前开发模板版本 `2026.10.15.1`；
`2026.10.14.1` 是历史发布模板。当前生成来源与投影同步设计页 PR #352 已评审的 28 功能、185 节点，范围不变。
不增加本地 wire operation、数据库迁移或第二个任务/授权/工具注册体系。
图结果为 `verification: "unverified"`；图的 `settled` 只表示本轮图节点已收敛，
不是本地 TaskRuntime 的 `succeeded`，不授予执行权限。

模板版本或摘要不同会拒绝旧 checkpoint，受信 control revision 迁移不能跨 template 自动恢复。
原版本应保留在途任务和原操作核实入口，不将其转交新模板重新提交。

## 开发调用

`GET /bindings` 仍需要独立宿主凭据；在启动组合真实注入图内核时，
返回的 `bindings` 保持旧 11 项，同时新增 `workflowBindings` 28 项。
目录包含节点数、模板版本/摘要与所需能力；不包含模型密钥、私人资料或账号配置。

沿用 `POST /invocations` 的 `{ "query": "<JSON 字符串>" }`。
获取一个完整模板的 query 对象：

```json
{"workflowVersion":"1.0.0","operation":"catalog","workflowId":"F08"}
```

推进一个图 frontier 的 query 对象：

```json
{
  "workflowVersion":"1.0.0",
  "operation":"advance",
  "workflowId":"F17",
  "taskId":"development-task-1",
  "controlRevision":1,
  "input":{"goal":"定位公开测试日志的失败原因"},
  "availableTools":[]
}
```

`availableTools` 仍使用现有 Coordination 目录：`name/version/inputSchema`。
它不表示授权，图仅为确切已公布工具产生候选提案。
结果包括 `nodes/proposals/unavailable/feedback/checkpoint`；继续请求带回原始 `checkpoint`。
传输层注入 deadline、AbortSignal、sessionId 与 requestId，调用者不能通过 query 置换它们。
本地消费者尚未消费此独立图协议时，直接调用它用于开发和测试，不能宣称完整产品已经切换。

## 推进与回执

1. 校验模板/输入/工具目录、task/session 身份及 control revision。
2. 如果存在检查点，以可信启动 HMAC key 校验完整性和全部身份映射。
3. 核实待处理回执是否绑定原 node、proposal、operation 与输入摘要。
4. 冻结本轮 ready 集合；独立无实际副作用的候选制备使用 `Promise.all` 并行。
5. 执行模型只准备有限的合法候选，镜像内唯一 Laya 选择器返回候选 ID。
   复核/弃权候选保留 unknown，不生成执行、同意、权限或完成证明。
6. 工具/宿主写步骤返回稳定 operation ID 的提案；本地 Policy/ToolGateway 执行、锁定与记录。
7. 等到可信读回才继续依赖节点；没有回执时，不重新调用模型、不更换 operation ID。

`WorkflowReceiptVerifier` 必须由受信启动组合提供、使用原 TaskRuntime/ToolGateway 的实际执行记录核实。
**生产组合缺少该核实器时，客户端传入的 success、模型自报和 evidence 字符串均不会被采纳**；
返回 unavailable 并保留原提案/检查点。默认实现不接受 `alwaysTrue`。
回执状态支持 confirmed、failed、unknown、not_started 和 stopping，是图应用协议，
不修改已有仅 confirmed 的 CoordinationContinuation，也不新增本地 wire 终态。

未知写入维持原操作身份并等待读回，不重新提交、补偿或更换 ID。
取消保留已确认效果；在途但尚无真实停止/读回结果时保持 unknown。
本地急停先在现有 TaskRuntime 处理，云图仅消费可信停止观察，不能自行触发本地急停。
语音问答节点通过已有问题、参数、revision 和授权链的宿主端口提出需要；云图不签发同意。

HMAC key 由可信启动配置管理，同版本/同 key 重启可继续。轮换后旧检查点明确失效。
签名检查点不是数据库，也不替代本地 TaskRuntime 的幂等、防重放、授权消费及终态控制。
设计里的检索反馈/新用户指令回边保留为 `requires_host_revision`：当前图不会在原 revision 下
自行重开已有实际效果的节点。合法变更使用受信宿主签发的 `migration`，绑定前后 task/session/
workflow/template/input/catalog/controlRevision 和明确失效节点。递增版本后失效受影响的纯计算节点及无提案的只读宿主观察/检查；
对 tool 节点，仅当它无 proposal、为 `unknown` 且原因为
`Unique selector requested recheck; no operation proposal emitted` 时，才允许受影响的该节点回到 pending。
同 revision 的继续请求、缺失/伪造迁移或未失效该节点的迁移都不重选；不会笼统重开所有 unknown 工具节点。
保留所有曾提出或已经确认、失败、未知的原工具/宿主操作及原参数、操作 ID、回执。
新目录不得删除原操作的工具或偷换同版本 Schema。禁止丢弃旧检查点后重新运行写操作。
仅有云端提案不证明本地已经提交。迁移后的旧 waiting_receipt 转为 unknown 并只保留原记录，
不会重新出现在可执行 proposals 中；宿主必须核实原提交/效果状态，不能猜测“还没执行”。
桥没有原持久操作 binding 时，首次 submit 必须与 proposal.originControlRevision 完全一致；
即使只存在旧 submit intent，也不能在新版本首次提交旧参数。已有原 binding 的 submit 入口只读回，
不会因迁移授权再次执行。需要新动作时使用现有 Runtime 的新版本/原效果核实和 Policy 路径，
不把版本迁移证明当成动作授权。
暂时的语义选择繁忙保持 pending，可按实际 deadline/取消恢复；实际未知操作仍等待读回。

### 2026-10-15 同 frontier 的 Laya 微批增量

图内核原有的 `Promise.all` ready frontier 保持不变，selector 将同轮已就绪的独立判断合成最多 4 项微批。
每项仍有自己的上下文、问题、候选和原 deadline；一个模型实例把独立编码行做一次 forward 后分别解码，
不拼正文、不增加第二决策模型。单项继续兼容原接口，依赖真实工具回执的步骤仍按依赖推进。

F28 集成回归针对同时准备的 N06/N07，使用不同候选数量与不同选中位置，并将批响应倒序，检查内部 itemId
仍把答案归还各自节点；N08 在这轮仍 pending。该 fixture 只验证图/selector 组合，真实 forward 计数与延迟须另验。
批身份、实际有效项数及提交数以 `batchId/batchSize/submittedBatchSize` 分开记录，共享 forward 时间不按项累加。
源码尚未部署，结果与限制见[本轮批处理记录](../competition/OWNED_LAYA_BATCHING_20261015.md)；
前述 e4c 全量检查属于微批前版本，不冒充本轮新代码的验证。
独立公开实测已验证 2→1、4→1 的 forward 数和六个对照的选项一致性；本次 Windows CPU 两线程样本中，
两项持平、四项墙钟慢 22.69%，未证明时延改善。具体数字和哈希见[批处理 Evidence](../competition/evidence/OWNED_LAYA_BATCHING_20261015.json)。

### 最小真实宿主桥

`OwnedWorkflowHostBridge` 接收现有 RuntimeApplication 的 `submitHostToolTask/readHostToolTask`，
以及现有 TaskRuntime 的 `loadCheckpoint/saveCheckpointOnce`。它先持久保存原 submit intent，
再用稳定 `commandId` 创建受控工具任务；等待原 Policy 决定，经生产 ToolGateway 执行。
只有 `readHostToolTask` 返回与原 tool/version/参数绑定的 confirmed 结果及真实 runId/Evidence，
才产生来源签名。审批 pending 不会产生成功回执，桥不代替用户签同意。
重启/重复 submit 只读回原任务，不创建第二个工具执行；unknown 仍等待原核实路径。

云端 `createOwnedWorkflowReceiptVerifier` 使用独立可信 key 验证该来源签名；签名不授予工具权限。
正式部署的 receipt key 应与发给调用者的 HTTP/WSS bearer 分开保管；
共享开发 bearer 派生 key 只适用于受信开发协作者，不证明能抵御同 bearer 持有者伪造来源。
密钥不得进入 Python/Laya、模型上下文、目录、图结果或日志。

大工具结果保留在原 TaskRuntime/ToolGateway 来源。图检查点保存摘要哈希、大小及原 Evidence 引用；
下游必须通过 `resolvedValues` 恢复与签名检查点哈希完全一致的原结果后才继续，不能以短摘要冒充原文。
候选输出在发出提案/签检查点前核对本版图 HTTP 1.1 MiB 传输预算。
超大候选而缺少原 Artifact/reference 适配器时明确 unavailable，不先执行再丢检查点。
旧 Coordination/WSS 帧限制保留；大图协议使用上述 HTTP 入口，不宣称旧 WSS 能传任意大小图状态。

## 28 个模板覆盖

| 功能 | 节点数 | 云图内容 | 真实宿主依赖 |
| --- | ---: | --- | --- |
| F01 主对话与责任理解 | 9 | 召回→候选→责任/计划/模型分工，补查/补问反馈 | Memory/责任快照、Policy、原生参数、TaskRuntime |
| F02 语音交互与确认 | 11 | 问题身份、语义解释、同意/修改/拒绝分支与本地停止观察 | 本地 ASR/TTS、当前问题与 Policy、原操作读回 |
| F03 世界状态/局部重规划 | 10 | 受影响图、有效成果保留、原效果核实、补偿候选 | Memory、原操作因果绑定、Policy、修复/补偿接线 |
| F04 Wiki/作用域记忆 | 7 | 相容更新与冲突隔离的条件汇合 | 知识来源/写检查、knowledge.apply_note_patch、记忆投影 |
| F05 检索与来源回答 | 7 | 多源检索→重排→扩充/回答→来源核验 | knowledge.search、Memory、引用版本核对 |
| F06 待办/提醒 | 5 | 查重候选、稳定写入、实际时钟/版本与提醒 | 注册待办写工具、Clock/提醒、通知 |
| F07 日历 | 5 | 空闲窗口、排序、新鲜度与日程写候选 | calendar.events、当前日历版本与注册写工具 |
| F08 邮件 | 13 | 分类/归档和检索/草稿并行；有必要才补问；未知发送核实 | mail.inbox、knowledge.search、注册归档/发送、mail.reconcile_send |
| F09 订阅/信号 | 4 | 多源收集、去重、语义筛选与研究入队 | feeds.collect、去重与原 Runtime 入队 |
| F10 深度研究 | 6 | 三个独立研究分支真实并行准备提案，证据汇合 | research.search、knowledge.search、支持关系核验 |
| F11 天气/出行 | 5 | 日程关联、影响候选、按需问答与变更 | calendar.events、事件来源、日程/提醒接线 |
| F12 主动通知 | 5 | 安静时段、紧急判断、立即/到期通知候选 | 现有 Policy、通知和 Clock |
| F13 故障诊断 | 4 | 探针证据、归因与受控恢复候选 | 注册系统探针、原操作/资源恢复 |
| F14 浏览器/桌面 | 6 | 新鲜观察、宿主锁、字段/下一动作/提交候选 | 实际 DOM/桌面观察、本地输入锁及 ToolGateway |
| F15 编码/命令 | 6 | 修改范围、补丁候选、红线核验与必要检查 | workspace.read_text、复合补丁/检查的原 Runtime 接线 |
| F16 CI 修复 | 5 | 绑定失败 SHA、修复、验收意图检查与重跑 | CI 快照、workspace.apply_text_patch/run_allowed_command |
| F17 测试定位 | 4 | 固定日志、归因、最小复现提案与报告 | workspace.run_allowed_command、原证据报告接线 |
| F18 PR 审查/合并 | 5 | 固定 head、审查、阻断项、当前真人批准/CI 门禁 | GitHub 当前 head/批准/冲突与注册合并工具 |
| F19 Issue 修复 | 5 | 来源/查重、子任务、独立回归与关闭候选 | GitHub Issue/合并读回、原 Runtime 与注册关闭工具 |
| F20 API 文档 | 4 | 读取来源 → 比对并生成差异/文档/示例 → 真实检查 → 来源复核候选 | workspace.read_text/run_allowed_command；本轮不进行外部同步 |
| F21 MCP/Skills | 5 | 来源、安装注册、握手、隔离探针与启用候选 | 统一 MCP/Skills 安装/运行宿主，平台/本地/自制来源 |
| F22 影子实验 | 9 | 固定快照、选模式、已选分支汇合与改进候选 | 时序快照/轨迹/真实隔离端口；缺反事实保持 unknown |
| F23 评估/晋升 | 5 | 数据切分、泄漏检查、真实输出评分与晋升候选 | 平台评测集/任务、现有评分和发布条件 |
| F24 调度/取消/恢复 | 12 | ready 分支、版本、原操作、取消四种结果与恢复图 | TaskRuntime、Policy、原 Evidence/checkpoint，非第二调度数据库 |
| F25 账户/范围 | 4 | 范围候选、出站上下文校验和安全引用 | 原 Policy/配置/凭据宿主；不把凭据放图数据 |
| F26 镜像/部署 | 5 | 构建/部署/真实工具与比赛证据分别记录 | ARM64 构建、AgentArts 读回、实际 ToolGateway 验收 |
| F27 上下文 | 7 | 原生容量、召回/排序、按需摘要/原文恢复和映射 | ModelGateway 原生能力、Memory/Knowledge、版本来源映射 |
| F28 模型/思考分配 | 12 | 原分配复用或 Laya 判断；研究/分析并行、补丁依赖、检查汇合 | 实际原生 thinking 参数、受派 executor 工具循环与完成检查 |

宿主能力名为组合接口需求，不是新发布的工具名。`knowledge.search` 等工具名来自当前公开代码；
任何未实际注册名称都保持 unavailable。F15 的补丁和检查必须是复合宿主闭环，
不会只执行 apply 后把“必要检查也通过”当作已完成。

## 影子边界

非 main 模式要求冻结 asOf/sourceVersions 与独立 namespace。
决策影子仅比较冻结输入上的候选，不消费主授权、不发出真实工具写请求。
轨迹回放缺真实反事实观察时保持 unknown，不读取未来数据替代结果。
隔离执行必须有真实隔离宿主；当前内核不会把真实邮箱、GitHub 或桌面假装可 clone，
没有该宿主就明确 unavailable。条件未有实际观察或 Laya 选定候选时，不擅自激活分支。

## 验证与剩余工作

本次定向测试使用明确的合成执行模型、选择器、宿主和带 proof 的核实器；
只证明图控制与边界，不证明 Laya 权重装载、MaaS、真实账号、平台 MCP/知识/日志/评估或完整产品可用。
构建、测试、镜像与真实 Huawei 调用证据由集成工作包分别补充到本记录。

2026-10-14 阶段已执行的历史定向测试 `node --test --test-isolation=none packages/agentarts/test/owned-workflow.test.mjs`：
**15/15 通过**。覆盖真正三分支并行、选中/跳过分支汇合、唯一候选选择及弃权、缺能力、
未知写原操作身份、拒绝 client claimed success、签名与版本失效、受信版本迁移保留原效果、
大结果恢复、语义繁忙、影子与取消，以及旧未提交/仅 intent 提案不在新 revision 首次执行、
受影响的只读宿主检查刷新而原效果不重复。`git diff --check` 通过。
`npm run build:owned-agent` 通过。实际生产 SQLite/Policy/ToolGateway/workspace.read_text 与重开读回用例
`apps/runtime/test/owned-workflow-host-bridge.test.mjs` 已执行 **1/1 通过**；与上面图用例合计 **16/16**。
该用例确实读取新建公开合成文件、等待现有一次性 Policy、产生原执行 Evidence、来源签名续图，
重开后仅读回而执行次数仍为 1；模型选择器仍为明确替身，不能作为华为/Laya/MaaS 实测验收。

### 2026-10-15 开发增量与当前验证

F20_N01 现在只读取代码/契约来源，输出 `sourceReadback`，不将读取自报为差异计算。
F20_N02 根据实际来源比对，输出 `diffFields/docMarkdown/exampleArguments`；N03 沿原 Policy/ToolGateway
调用固定编译命令，以真实 TypeScript 编译和固定 fixture 的 `sourceDifferenceMatched` 检查实际候选。
N04 使用原来源与真实检查回执复核精确文档，交付 `synchronized:false` 的候选，不声明外部发布。

MaaS 和 Laya 现在接收同一当前节点边界与准确工具 Schema。Laya tokenizer 按实际序列动态申请完整 SDK 窗口，
受编码器 8192 token 上限约束，要求实际 usage、header/state/分隔符计数一致且 dropped=0；超限在推理前拒绝。
tokenizer 预检耗时后会重查原 deadline，父 worker 未启动的超时路径也不再等待不存在的收尾。
这些是已落地的源码修复，不能代替实际 ARM64 完整窗口验收；该增量镜像的独立实测尚未完成。

新源码受影响测试共 **75 项通过**：图 18、orchestrator 20、selector 14、manual/exporter 23。
其中图用例覆盖语义 review 后的合法 revision 恢复及已有写 operation 四种状态不重做；真实编译器用例
覆盖候选差异与实际 fixture 不符的拒绝。历史 `388a7e5` 全量检查为 3,108 项、3,090 通过、18 跳过；
本轮 `e4c87c1d` 的完整 `npm run check` 已 exit 0：3,111 项、3,093 通过、18 跳过、0 失败；
与上述历史计数分别记录，不累加。日志 SHA256 见[本轮开发 Evidence](../competition/evidence/OWNED_LAYA_DEVELOPMENT_20261015.json)。

原生 Windows 的真实 MaaS/Laya 样本 `live-wmFfjy` 在 N01 选择 `owned-review`，父任务 failed，
工具和 Evidence 均为 0，完整 F20 尚未跑通。提案 4,699 ms，MaaS 2,747.0691 ms，Laya SDK
`predict_batch` 1,917.7058 ms、selector 1,943.6092 ms；实际 1,007 tokens、dropped=0、未截断。
这是本地开发调用，不是华为调用或原生 ARM64 性能结论。

另有真实权重的固定 6 探针：两种提问 × 合法路径/错误路径/缺 Schema，全部选择 review；
它们使用手写公开 fixture、未调用 MaaS，不是领域准确率或泛化评估。
当前仍保留唯一 Laya；换为一个国内 MaaS 决策中枢只是建议，未经确认不替换实现。

下一步消费接线仍按原分工：goo122 负责现有 Runtime/ModelGateway/Policy/ToolGateway/
MCP/Skills/Knowledge 的公开 provider；Potatos498 负责业务工具与业务侧回执/显示；
zemeng 负责镜像云图、唯一 Laya、平台组合与部署验证。不会为图模块复制他们的数据库或工具宿主。

### 2026-10-14 镜像发布与真实调用增量

实现 PR：[#356](https://github.com/zemeng5208/PersonalAgent/pull/356)。镜像源码固定为
`fe886677d72a6f7a3312e054c68ef4d74a804fc4`，后续发布材料提交不改变这份已发布镜像。
SWR 客户端推送完成，并通过独立 `buildx imagetools inspect` 读回相同 ARM64 manifest：
`sha256:8120ad11915c5de9c6daa61b492d3228872978ccfbc0f9a79acf59432f42366c`。
AgentArts 实际保存新版本 `arm64-laya-fe886677`，`Latest` 访问方式已指向它；原生日志已开启。
完整发布位置、构建来源及调用方法见[发布说明](../competition/OWNED_LAYA_RELEASE_AND_CALLS.md)。

实际离线 ARM64 镜像验收加载、预热并调用了真实 Laya multilingual 权重；没有 MaaS、工具或网络调用。
Windows x86 上 QEMU 的耗时仅为仿真实测，不能作为华为原生 ARM64 延迟。
另一次真实 AgentArts HTTPS 调用读回 28 项目录，产生固定公开文件的准确工具提案；
原 Policy 等待审批后，验收程序仅对此文件使用一次 `allow_once`，生产 ToolGateway 实际读取一次。
原执行记录和一条 `conditional` Evidence 保留，独立文件摘要一致；签名回执被云图接纳，
原 F20_N01 为 completed。SQLite 关闭重开后，记录与 Evidence 均保留，没有新增网络或工具执行。
这不是 Desktop 人工点击或语音确认实测。

本次整体结果为 **partial_receipt_admitted_model_recheck**。F20_N02 的 Laya 选择了
`owned-review`，未激活后续执行，F20_N03/N04 仍 pending；网络未知列表为空。
平台真实日志关联到提案请求（裁决 881 ms）和续图请求（裁决 1477 ms），并记录 embedded Laya 已预热。
两个样本不构成稳定延迟承诺；HTTP 总耗时分别为目录 879 ms、提案 2726 ms、续图 3997 ms。
不通过重跑或强制选择消除该复核，也不将云图状态写成原本地任务终态。

公共材料经[Evidence 投影器](../../scripts/agentarts/export-owned-release-evidence.mjs)白名单处理；
原验收目录、SQLite、检查点和带机器路径的原回执不公开。来源完整 SHA 来自 buildx provenance，
部署摘要来自平台配置的准确镜像引用对应的 SWR 独立读回，不冒充平台直接报告完整 SHA/digest。
原调用回执未记录 invokeMode，最终公共材料保留此关联缺项。
28 个真实业务、平台 MCP/原生知识/完整 OTel Trace/效果评估及真实语音仍须各负责人独立接线验收。

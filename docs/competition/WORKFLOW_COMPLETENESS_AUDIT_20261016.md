# 镜像工作流完整性审计（2026-10-16）

**结论：28 图/185 节点和通用串行引擎已在镜像中；全部 28 条真实业务工作流尚未完成。**
本审计针对 `personal-agent:test-v4-workflow-wiring`，实际 image ID
`sha256:58c6fc1c8be1dbb14a0a2aae1140a1058d3a8126eb487d541145e8e956f9929d`，
`linux/arm64`，389559402 bytes。镜像模板、引擎、adapter、main 和 dispatcher 与当前源码的规范化文本已独立比对。
本轮没有修改生产代码或重建镜像，没有重新决定架构或模型资格。用户随后明确授权上传和云端整图验收：该既有镜像已上传 SWR，并发布到 AgentArts 精确版本 `arm64-v4-e38ef23d-r2`。

**后续真实验收更新：固定公开鹈鹕 F15 主图及独立隔离图已通过六节点整图检查和持久化核验；其余27图仍未由本轮证明完成。** 原始回执、平台日志、部署读回与失败边界见 [云端 Evidence](evidence/cloud-f15-v4-20261016/README.md)。

## 已有实现与缺口

- 镜像 `workflowVersion:1.0.0/advance` 进入真实 `OwnedWorkflowEngine.advance`，有串行推进、条件、检查点、控制与回执处理。这些不是纯静态图。
- 当前生成清单有 **111 个 host 和 41 个 guard 要求，共 152 项**。它们是节点接口要求，既不是 152 套独立业务，也不是每次任务都要执行 152 次。旧文档的 148 是旧清单数量。
- `createOwnedWorkflowAdapter` 需要宿主显式提供 `execute`、Schema、作用域和副作用类别；`getOwnedWorkflowAdapterRequirements` 只列要求。已有知识、通知、邮件等底座不会自动变成 `workflow.host.fXX_nXX` 或 `workflow.guard.fXX_nXX`。
- 原 Runtime 只注册受信 `options.tools` 和明确配置的工具。F23_N04/N05 有可选生产工厂，但还要求真实配置 CAS、scopes 和验证端口；默认 Desktop 没有传入该配置，不能称设备上两项已就绪。
- `decision.choose_candidate` 也需显式注册；主动责任的 `proactive.*` 工具不是同名替代品。缺少所选路径的工具或 guard 时应保持 unavailable，不能把目录声明当实际执行。
- 平台 MCP 仍要求本地已注册且匹配的工具；平台配置不能自动补齐上述节点接口。协作者应复用原底座，补准确 adapter/guard 与真实调用方，不新建任务库、调度器或授权源。

源码依据：[镜像入口](../../apps/agentarts-runtime/src/binding-dispatch.mjs)、[Engine](../../packages/agentarts/src/owned-workflows.ts)、
[节点映射](../../packages/agentarts/src/owned-workflow-templates.ts)、[Runtime 注册](../../apps/runtime/src/application/runtime-application.ts)、
[F23 工厂](../../apps/runtime/src/application/owned-workflow-application.ts)、[平台工具检查](../../apps/agentarts-runtime/src/platform-services.mjs)。
公开输入、输出、条件和 adapter 名称以重新生成的 [workflow-wiring.json](workflow-wiring.json) 为准；长期负责人仍见 [协作包](COLLABORATOR_WIRING_PACKAGE.md)。

## 两个编码案例的验收范围更正

孙悟空和鹈鹕的 `*-test-version.mjs` 确实运行了真实模型、原 Runtime/Policy/ToolGateway、隔离主/影子修复、实际检查和 CAS 写回。
但镜像侧走的是 `testVersion:1` 的 `capabilities/model_turn`，本地 `TaskRuntime.runTask` 内调用 `runAgent`，
**不是 `workflowVersion/advance`，不能据这些成功回执标记 F15 六节点整图通过。**

依据：[模型适配器](../../tests/manual/agentarts/test-image-model-provider.mjs)、[孙悟空 runner](../../tests/manual/agentarts/wukong-test-version.mjs)、
[鹈鹕 runner](../../tests/manual/agentarts/pelican-test-version.mjs)。另有 [F15 专用 runner](../../tests/manual/agentarts/pelican-repair-live.mjs) 真正调用 advance，
但不能把其他 runner 的报告移作其验收。28 主图及 28 隔离图的共同回归使用显式 Fake catalog/receipt，只证明推进机制。

## 逐图接线与真实整图证据

H/G 是 host/guard 要求数。下列“未验”指本轮证据没有证明该 F 图以真实依赖推进到 settled；已有组件测试仍有效，不因此宣称组件没有实现。

| 图 | H | G | 仍需绑定和验收的主要路径 | 真实整图 |
| --- | ---: | ---: | --- | --- |
| F01 主对话与责任 | 6 | 3 | Memory、责任快照、权限、图提交、补问；已有主动组件 | 未验 |
| F02 语音确认 | 10 | 3 | 当前问题、实际播报和最终转写、授权恢复/读回 | 未验；物理语音未验 |
| F03 世界与重规划 | 8 | 4 | 来源失效、原副作用核实、补偿、图调度 | 未验；最小修复算法仍暂停 |
| F04 Wiki 记忆 | 4 | 2 | 原知识/记忆的写入、note patch、投影失效 | 未验 |
| F05 来源检索 | 3 | 2 | 知识检索、Memory、引用版本、来源回答 | 未验 |
| F06 待办提醒 | 3 | 0 | 原 Todo、Scheduler、当前版本、通知投递 | 未验 |
| F07 日历 | 2 | 0 | 原账号读取、冲突新鲜度、受限写入与读回 | 未验 |
| F08 邮件 | 6 | 4 | 来源游标、分类/归档/发送、授权、未知发送核实 | 未验 |
| F09 订阅 | 2 | 0 | 持续来源、验证去重、研究入队 | 未验 |
| F10 研究 | 1 | 0 | 原 Research/Knowledge、主张支持检查 | 未验 |
| F11 天气与行程 | 2 | 2 | 外部天气输入、日历、补问、更新/提醒失效 | 未验；没有直接 weather.forecast 节点 |
| F12 安静通知 | 3 | 2 | 当前安静策略、配额、真实投递和到期 | 未验；CAS/额度组件已有 |
| F13 系统状态 | 2 | 0 | 受限系统探查、已确认恢复 | 未验 |
| F14 桌面浏览器 | 5 | 2 | 真实观察、输入锁、输入/提交、补问 | 未验；隔离浏览器组件有实测 |
| F15 编码补丁 | 3 | 0 | 源文件、patch 范围、应用/测试、交付 adapter | 固定公开鹈鹕主/独立隔离整图已验；非默认 Desktop/通用编码 |
| F16 CI 修复 | 2 | 0 | CI 失败来源、补丁/测试意图、受限命令 | 未验 |
| F17 测试定位 | 1 | 0 | 受限命令、原失败报告交付 | 未验 |
| F18 PR 审查 | 3 | 0 | 原 PR diff、当前 HEAD 门禁、授权合并 | 未验；开发子智能体操作不是本图运行 |
| F19 Issue | 4 | 0 | Issue 快照、修复队列、合并读回、关闭 | 未验 |
| F20 API 文档 | 0 | 0 | 原 workspace 读取、批准的命令 recipe、真实候选选择 | 未验；无需专用 H/G 不代表自动通过 |
| F21 MCP/Skills | 5 | 0 | 原 manifest、安装注册、健康检查、隔离探查/启用 | 未验 |
| F22 影子实验 | 6 | 5 | 触发/版本、历史 trace、隔离、反事实、机会收益 | 未验；策略/replay/双跑各有独立证据 |
| F23 评估晋升 | 5 | 0 | 数据集、防泄漏、真实评估、配置 CAS、读回 | 未验；仅 N04/N05 有可选生产工厂 |
| F24 调度恢复 | 11 | 6 | 原持久图、执行停止、未知核实、检查点恢复 | 未验；原 Runtime 生命周期已有 fixture |
| F25 配置凭据 | 2 | 0 | 出站范围、凭据引用的实际安全存储 | 未验 |
| F26 镜像部署 | 4 | 0 | 实际构建、部署读回、工具证据、覆盖发布 | F26图未验；V4已实际上传/部署读回，F15云调用已验 |
| F27 上下文 | 4 | 3 | 模型能力、Memory/Knowledge、来源映射/失效、压缩保真 | 未验 |
| F28 模型分工 | 4 | 3 | 原生配置、源码/完成检查、受限执行循环与多厂商 | 未验；DeepSeek 代理已用，不代表全厂商通过 |

## 本轮 GPU 复测

本机 RTX 4060 Laptop 8GB，驱动 591.86；默认 Python 为 Torch `2.14.0+cpu`，缓存的独立 CUDA 路径为 `2.14.0+cu130`。
实际 CUDA 矩阵运算已通过；直接复用缓存，没有改装默认环境。完整案例使用同一 V4 镜像、同一权重，SDK 自动 CUDA BF16，
没有 CPU/内存配额，Torch 线程仍 1，不等于限制 GPU 算力或证明所有 OS 线程只占一个。

- 孙悟空：本轮 `partial_one_branch_failed`；主分支模型返回非法工具 JSON，影子验证通过。flow 181.975s、外层190.504s，19 次模型 HTTP200 不等于任务成功。
- 鹈鹕：本轮 `verified_main_shadow_and_delivery`；主/影子及单 CAS 通过。外层148.996s。
- 孙悟空 5151/5033 tokens 的 Laya 选择墙时483.696/411.809ms，SDK 调用449.308/403.745ms。
- 鹈鹕2645/2538 tokens 的选择墙时484.324/273.801ms，SDK 调用457.156/269.273ms。**完整长输入仍未达150ms。**

上述案例各次模型生成内容不同，不能据总耗时计算 CPU/GPU 同输入加速比。独立固定输入对照、UTC/节点、原始失败和只读 SQLite 读回见 [本轮云端/GPU Evidence](evidence/cloud-f15-v4-20261016/README.md)；不补造任务成功或模型质量资格。固定短输入 CUDA 暖态样本低于150ms，但 CUDA packed 对照原生退出，完整长上下文 F15 决策214—654ms，目标仍未达。

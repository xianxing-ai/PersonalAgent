# 协作者实际接线交付总包（2026-10-15）

> 2026-10-16 实现增量见 [V4 生产接线](WORKFLOW_WIRING_V4.md)。新增实际 Runtime/桌面消费及恢复入口，
> 不改变下表长期负责人，不把本轮 offline/realHost 测试提升为真实账号、设备或云业务完成。
> 外部来源、配置 CAS、原生平台知识/MCP/评估仍需相应负责人按公开端口独立接入并交 Evidence。

目标 `huawei_ict_agentarts`。本包登记当前工作包，不重新分配历史作者或 MOD；长期归属唯一来源是 [MODULE_ASSIGNMENTS](../MODULE_ASSIGNMENTS.md)。当前设计与全图状态分别见 [当前设计](../design/CURRENT_DESIGN_20261015.md)、[28 项状态](../design/WORKFLOW_STATUS_20261015.md)。旧模块验收保留日期和范围，不能代替当前调用方读回。

## 交付责任与事实基线

所有负责人在自己的工作包/PR 按 [接线责任与华为优先验收](OWNER_WIRING_TEST_POLICY.md) 本人确认接线与测试责任。镜像/工作流先用华为 AgentArts 的评测集和评估任务验收；平台不能使用时先记录实际原因和证据，再考虑本地替代。下文 fixture 命令保留为必要工程验证入口，其通过不替代平台验收。

每个 MOD 负责人自己完成：实现 → 公开契约/exports → 真实调用方接线 → 必要消费测试 → 实际状态/Evidence → 文档和 PR。根 composition 只协调共享配置、依赖与边界，不替所有人实现适配或集中验收。需动共享入口时由该工作包随交付补接线并协调串行编辑；不能以“等中央接入”为完成条件。不得新增 Runtime、调度器、授权层、任务库或模型 fallback。

常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任意一位非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须明确记录，不能冒充独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步主线、无冲突且阻断意见已处理后合并；不得强推、直接推 main 或绕过技术检查。四位协作者跨 PR 均衡承担实质审查与合并；自审不替代独立批准。本包不执行提交、推送或发布。

截至本次文档核对，[V3](TEST_IMAGE_V3.md)、[运行说明](TEST_IMAGE_V3_RUN.md)、[完整实测汇总](evidence/test-image-v3-20261015/full-workflow-results.json) 与 [发布回执](evidence/test-image-v3-20261015/owned-release.json) 分别证明：

- 新 ARM64 镜像已上传 SWR，云 Runtime 精确版本目录与平台日志已读回；版本目录通过不等于远端业务闭环。
- 同一已发布镜像的本机 Docker + 本机真实 Runtime/Policy/ToolGateway/Laya + AgentArts DeepSeek 代理完成孙悟空及鹈鹕公共夹具主/影子与一次 CAS，共 41 条 Evidence；两条完整链并非在远端 Runtime 执行。
- 各分支父任务 succeeded；协调 checkpoint 锚点仍 created，不能把整个协调任务写成 succeeded。鹈鹕首次 partial 失败完整保留，第二次只补输入验收合同，没有放宽 checker 或增加预算。
- 本机 Laya 这六次输入约 182–618ms，未达 150ms；未校准站点均实际升级 DeepSeek。经验复用不等于训练。
- 原 28 图/185 节点仍保留并串行推进；图目录不证明 28 项业务真实闭环。本轮影子是专项串行双跑，日常机会/收益开关尚未真实验收。

DeepSeek 经 AgentArts 新代理，平台底层 MaaS 来源如实保留；客户端不直接 fallback MaaS。本机 Laya 与百炼语音保持既有端口。SIS 本机短音频 ASR/同步 TTS 与经 AgentArts 双工是不同能力，后者仍未验。密钥、私人账户数据和机器私有绝对路径不进入本包。

## 新的具体分工矩阵

下列状态均为工作包级 `in_progress`/`ready`，不提升接口冻结。每项只有一个交付负责人；依赖方提供公开端口，不能把该项调用方接线及验收移交依赖方。下表编号也供 ROADMAP 引用。

| 包 / 唯一负责人 / MOD | 文件范围与公开输入 → 输出 | 本人必须接到的实际调用方 | 当前状态、阻碍与下一可独立开工任务 |
| --- | --- | --- | --- |
| CW-01 本机 Laya 可信回执桥；zemeng5208；28/30 | `packages/agentarts/src/workflow-decision-tool.ts`、`owned-workflow-host-bridge.ts`；`apps/agentarts-runtime/src/local-laya.mjs`、`laya-selector.mjs`、`adaptive-decision.mjs`；封存候选/原 task+revision+deadline → 选择/Evidence/可信回执 | 把公开 `createWorkflowDecisionTool` 注册原 Runtime Application，`OwnedWorkflowHostBridge` 回传原镜像 checkpoint；依赖 goo 的 TaskRuntime/Policy/ToolGateway，不在模型里签授权 | in_progress；公共编码夹具真实模型链已验，资格/150ms未过；下一步为一个实际业务站点收集正反样本与可信 outcome，未合格仍升级 DeepSeek |
| CW-02 AgentArts 镜像、代理与平台；zemeng5208；29/30/32 | `apps/agentarts-runtime/`、`packages/agentarts/`、`tests/manual/agentarts/`；受信配置/CloudAgentPort 请求 → 版本/模型/trace/评估读回 | 本人接 main/server/image-services 到原 CloudAgentPort 与 Runtime，平台 MCP 调用仍交原 ToolExecutionPort；依赖 MOD05/06/08 的公开能力 | in_progress；SWR/云目录与代理已验，远端两条全链和平台知识/MCP/trace/评估各自仍缺专项证据；下一步在精确云版本执行一个已授权公开只读工具，记录平台请求与本地 Evidence 关联 |
| CW-03 主动事件与持续责任；zemeng5208；27/28/30 | `packages/agentarts/src/proactive-workflows.ts`、Runtime `proactive-cognition-host.ts`/`proactive-workflow-session.ts`、镜像 `proactive-controller.mjs`；四入口 eventRefs/原话/Goal → retrieve/classify/teacher/action proposal | 本人把 ConnectorHost 持久 eventId、用户指令、子任务回执、原 Scheduler wake 接入签名 advance；依赖 goo 记忆/Runtime、Potatos 业务来源，不直读私库 | in_progress；真实 HTTP/SQLite fixture 已验，真实账号责任闭环未验；下一步选一个来源和一条明确用户责任接四入口，保留未订阅重要事件，Laya-first 未验分类必须 teacher |
| CW-04 上下文、知识与记忆；goo122；08/09 | `packages/knowledge/`、`memory/`、`learning/`、`plugins/obsidian/`、Runtime `knowledge-*`/`memory-*`；带权限 source/version/citation → 当前事实/历史/引用/受控写回 | 本人向主动 retrieve、Goal 和 Competition 提供 `KnowledgePort`/`MemoryQueryPort`/`FactChangeFeed` 适配及消费测试；本地 Wiki 与平台 knowledge provider 分开注册 | in_progress；本地历史验收可复用但当前主动真实引用/平台原生知识未验；下一步用公开非私人测试 Vault 串 source correction/retract → 主动引用失效 → 重取，平台缺适配保持 unavailable |
| CW-05 无人值守及归来摘要；zemeng5208；28/30 | `proactive-workflows.ts`、Runtime `proactive-workflow-session.ts`、现 Desktop 控制消费方；enter/return/pause/cancel/实际设备状态 → done/changed/pending/blocked | 本人把会话控制接原 TaskRuntime checkpoint/atomic CAS 与 Scheduler；通知仅消费 Potatos 公开 host；本机离线 waiting_device，仅有真实 cloud_persistent port 才继续 | in_progress；重启、独立分支、return fixture 已验，关机后云持续执行未验；下一步接实际用户离开/回来命令，验证同 batch 重启无重复、归来不补弹，保持原 deadline |
| CW-06 主影子选择与收益记录；zemeng5208；30/31 | `workflow-shadow-policy.ts`、`workflow-shadow-release.ts`、镜像 `shadow-controller.mjs`/`trace-replay.mjs`；同次选择 metadata/可信资源/历史 receipt → run/defer/skip/need_teacher、比较、签名结果 | 本人把所选候选 shadowPlan 接原 Engine/HostBridge 与原 checkpoint 历史；高级隔离需同次 DeepSeek+Laya 参与 refs 与可信隔离证明；不额外起模型判断或调度器 | in_progress；专项串行双跑已验，日常 sampling/真实收益机会开关未验；下一步接一个非专项任务，记录同基线隔离及真实资源/质量，缺反事实明确 unknown，不把 run 当已执行 |
| CW-07 任务分配与主控升级；zemeng5208；04B/31 | `packages/agents/`、`packages/agentarts/`、Runtime 公开子任务派发消费方；子任务绑定/实际状态/Evidence → continue/summary/notify_controller/request_controller | 本人复用 `createRuntimeSubagentDispatchTool` 与原 runAgent/ModelGateway；父子持久绑定、报告引用和 task.progress 通知接主任务等待端；测试 helper 不代替生产装配 | in_progress；delegation 离线边界已验，完整真实模型委派未验；下一步把已绑定 child 的报告读回接一个实际主控，旧版本冲突拒绝，teacher建议不新增权限 |
| CW-08 业务连接器及来源持久性；Potatos498；20–26 | `packages/productivity/`、`packages/connectors/{calendar,mail,feeds,research,weather}/`、业务设置/展示；受限凭据/源变化/cursor → 规范事件/工具结果/读回 | 本人经 `register`/ConnectorHost 接原 Runtime tools、主动 event sink、业务 UI 和原 Scheduler；MOD05主动host公开端口由 goo维护，业务 source/provider/sink 接线仍由本人交付 | in_progress；各历史读回与当前 mock 分开，未选社交平台不自动开工；下一步逐来源交一个真实配置的增量批次→持久sink→cursor确认，断连/撤权/过期不能伪 no_changes |
| CW-09 通知静默与频次；Potatos498；23 | `packages/notifications/`、Runtime `notification-host.ts` 及实际通知渠道消费方；当前用户 policy/revision/source → feed/额度预占/真实渠道回执 | 本人把 `NotificationService`/`createRuntimeNotificationHost` 接主动 notify、用户设置、现 Scheduler 和桌面 delivery/ack；不只交 status 工具 | in_progress；静默0send、跨channel并发quota、重启/unknown/归来 fixture 已验；实际系统横幅/音频与真实账号未验；下一步接一条实际设备通知及回执，设置立即生效，unknown先核实不重发 |
| CW-10 语音询问与当前参数确认；zemeng5208；13/14/15 | `packages/voice/`、`voice-wake/`、Desktop voice/admin/preload及原 Runtime approval消费方；final transcript+revision+当前待确认参数 → 用户命令/原审批回执 | 本人经既有 IPC/Client 接原审批 revision/参数摘要与通知设置；partial/echo/silence/old final 不消费授权；provider/key只设置页，密钥不回Renderer | in_progress；百炼无mic握手、UI/IPC fixture已有证据，物理音频与生产final→通知设置桥未验；下一步在用户授权设备窗口验证一次当前参数询问→最终语音→原审批，SIS经AA缺流桥保持 unavailable |

### 各包必要测试、真实验收与 Evidence

命令从仓库根执行，使用仓库声明的 Node/npm；依赖已构建时优先单文件。下面是存在的复现入口，不表示本次重新运行或全部通过。`node --test --test-isolation=none` 用于当前 Windows fixture，其他环境可按项目正常隔离设置。涉及真实模型/账号/设备的入口必须另有该范围授权。每位负责人自己运行并提交对应证据。

| 包 | 最小现有 fixture / 消费测试命令 | 真实验收与应提交 Evidence |
| --- | --- | --- |
| CW-01 | `node --test --test-isolation=none packages/agentarts/test/local-workflow-decision.test.mjs apps/agentarts-runtime/test/adaptive-decision.test.mjs` | 原候选digest/站点资格、实际Laya/teacher来源、任务/run/Evidence、延迟；参考 full-workflow-results，不据短输入速度宣称150ms |
| CW-02 | `node --test --test-isolation=none apps/agentarts-runtime/test/platform-services.test.mjs apps/agentarts-runtime/test/model-proxy.test.mjs` | 精确版本/deployment/API/request/trace、本地目标读回；完整真实模型入口见 TEST_IMAGE_V3_RUN，平台四面各自验，不把模型代理当MCP |
| CW-03 | `node --test --test-isolation=none packages/agentarts/test/proactive-workflows.test.mjs tests/integration/proactive-image-host.test.mjs` | 来源event/原话引用、retrieve、Laya候选/DeepSeek接管、实际host receipt与阶段UTC/wall；fixture边界见 proactive-notification-coverage.json |
| CW-04 | `node --test --test-isolation=none apps/runtime/test/knowledge-tools.test.mjs apps/runtime/test/memory-projection-application.test.mjs` | source/config/事实版本、引用范围、撤回及写后读回；本地+平台两套provider各自证据，平台无port拒绝 |
| CW-05 | `node --test --test-isolation=none apps/runtime/test/proactive-workflow-session.test.mjs tests/integration/proactive-image-host.test.mjs` | 原deadline/control revision、同请求CAS一次提交、恢复/return摘要、waiting_device和真实cloud port；pure frontier重算不等于重发未知写 |
| CW-06 | `node --test --test-isolation=none packages/agentarts/test/workflow-shadow-policy.test.mjs packages/agentarts/test/workflow-shadow-release.test.mjs apps/agentarts-runtime/test/trace-replay.test.mjs` | 同基线/版本/隔离receipt、实际质量/耗时/调用量；历史pair一致，数据回放actualToolCalls=0；新候选反事实unknown |
| CW-07 | `node --test --test-isolation=none tests/manual/agentarts/test-version-delegation.test.mjs` | 原parent-child绑定、progress引用、真实模型分配/高级主控建议、取消/终态/版本冲突；不能以Fake证明模型质量 |
| CW-08 | `node --test --test-isolation=none apps/runtime/test/proactive-connector-host.test.mjs packages/connector-host/test/proactive.test.mjs` | 每个source/provider及真实工具分别记录cursor、幂等、失败/撤权/设备状态、Evidence和UI消费；业务各包测试见下方全MOD表 |
| CW-09 | `node --test --test-isolation=none apps/runtime/test/notification-host.test.mjs packages/notifications/test/interruption.test.mjs` | 当前设置revision、窗口额度、跨channel同轮、静默feed与未读、投递/unknown读回；coverage文件区分realHost/fixture/physicalDevice |
| CW-10 | `node --test --test-isolation=none apps/desktop/test/sis-config-wake-lifecycle.test.mjs apps/desktop/test/quit-task-preflight.test.mjs` | 真实final/当前参数与原approval版本、录音/播放释放、拒绝partial/echo/过期；需要物理设备证据，不把通知测试合成ledger当ASR实机 |

## 全 MOD 接线交付表

逐 MOD 的输入/输出、实际调用方、可复现入口和缺项见 [全 MOD 交付清单](../modules/CURRENT_MOD_WIRING_HANDOFF.md)。十个包是现有 MOD 的当前纵向切片，不替换 MOD-01～38，也不改变 MOD-33/36/37 归 goo122、MOD-34/35/38 归 Potatos498。根目录/exports 所有权不是免除本人接线的理由；共享入口协调后随工作包提交消费验证。

## 每次交回的最小证据字段

提供工作包/MOD/唯一负责人、固定源码SHA与profile、公开入口及版本、实际调用方文件、可信配置键（不含值）、命令与UTC起止/wall/exit/logSHA、任务/run/argumentsDigest/Evidence或外部readback引用、失败/unknown和恢复办法、fixture/realHost/realAccount/physicalDevice分类、未验项与下一任务。配置/注册/签名/目录/模型自报均不替代执行Evidence。任何 unavailable 要指出缺的port/配置/账号授权，不能静默Fake。

本次真实基线来自上述 full-workflow-results.json；更细主动/通知边界见 [覆盖审计](evidence/test-image-v3-20261015/proactive-notification-coverage.json)。后续验收可以增加证据但不得覆盖首次失败或把历史记录改成pass。完成一个包不等于整个MOD、所有28业务、合并或发布完成。

## 平台协作者权限边界

用户授权范围仅为 PersonalAgent AgentArts 项目及其关联资源的查看、编辑、部署、调用、调试、日志和效果评估管理，不包括全华为云、IAM管理或其他项目。项目授权需求不等于已实际获得访问；项目角色/入驻仍按 [平台协作访问记录](AGENTARTS_COLLABORATION_ACCESS.md) 核对。使用关联资源也不自动扩大工具/真实账号写入权限。不得在公开文档记录真实人员hid、密钥或持久凭据。部署和发布仍须本轮对应授权，保留实际回执。

协作者制品入口：`scripts/agentarts/release-owned-image.ps1` 与 `scripts/agentarts/package-test-kit.ps1` 由根本轮维护，先读取脚本参数和当前发布说明；本包不臆造默认环境、不替协作者执行部署。

# 28 图接线工作记录（2026-10-28，进行中）

Profile：`huawei_ict_agentarts`。隔离分支：`codex/image28-full-wiring`，基线 `4dbf01e1ffbb1179f8a600abf63db0fcd917afa5`。本记录不将历史云端、Synthetic 或配置存在视为当前真实验收。

Owner 本轮授权代实现其他协作者负责的公共口和业务接线；原长期维护归属不变。152 条节点级清单见 [清单](IMAGE28_HOST_GUARD_CHECKLIST_20261028.md)。当前每项保持未勾选，直到生产注册、真实宿主接线和约定测试证据具备。以下配置指本工作包是否完成可信生产装配，并非探测用户的凭据或账号。

| 图 | registered | configured | tested / evidence | still-blocked |
| --- | --- | --- | --- | --- |
| F01 | N02 可选工厂，默认不注册 | 未完成 | 原 HostTask、SQLite 来源与原选择绑定 14/14；F01/proactive/F15 相关回归 39/39；非整图验收 | 原生用户选择、责任生命周期授权与精确出机授权装配 |
| F02 | N01/N03/N05 可选工厂，默认不注册 | 未完成 | 原 Runtime 审批与合成图绑定 4/4，final transcript 守卫 2/2；非语音/整图验收 | 原问题选择、精确出机授权、声学防回声、播报证据与审批恢复装配 |
| F03 | N05/N07 可选工厂，默认不注册 | 未完成 | [F03 Evidence](F03_ORIGINAL_RECONCILIATION_20261029.md)：复用原效果核验，未知写不重试；非整图 | N06 原效果绑定、受信因果与读回、其余 host 和 Desktop 权限装配 |
| F04 | N05 可选工厂，默认不注册 | 未完成 | optional-graph-hosts 及 `workflow-memory-query-boundary.test.mjs` 验证无效期限及超出受信查询的结果被拒；非整图 | 版本冲突、N06/N03/N04/N07 其余 host 及独立授权引用装配 |
| F05 | N02 可选工厂，默认不注册 | 未完成 | optional-graph-hosts 合成测试核对 scope、网关调用口与缺口；非整图 | 知识检索受信网关调用口、引用验真、其余 host |
| F06 | N03/N04/N05 可选工厂；Desktop 已注入 `verifyWorkflowReminderBinding`（N04 可注册） | 未完成 | [F06 Evidence](F06_REMINDER_WIRING_20261029.md)；N03 现持久化 `f06:n03-todo:{session}` 含 revision；非整图或实机送达 | N03 生产 `invokeTodoCreate` 网关、N05 真实投递 |
| F07 | N04/N05 可选工厂，默认不注册 | 未完成 | [F07 Evidence](F07_FRESHNESS_20261029.md)：原图请求、确认回执与版本变化核验；写入权限和网关口合成测试；非整图 | Desktop 缺日历版本口、原读取绑定与 N05 受信网关、账户配置和写入读回 |
| F08 | N10 Desktop 条件注入（mail 宿主就绪时）；N13 可选；N03/N07/N12 显式 unavailable | 未完成 | [F08 Evidence](F08_MAIL_BOUNDARY_20261029.md)；非整图 | 真正归档与发送、N12 对账、审批及真实 Sent 读回 |
| F09 | Runtime 受限 worker；Desktop N02 + `f09WorkflowWorkerPorts`；AgentArts 在固定部署下合并 ownedImage | 未完成（缺部署时不注入；F10 仍 unavailable） | Desktop F09 定向与 ports 测试通过；Runtime F09 4/4；非整图真实源 | F10 入队宿主、真实订阅会话与云图联跑 |
| F10 | N05 可选工厂，默认不注册 | 未完成 | [F10 Evidence](F10_SUPPORTED_CLAIMS_20261029.md)：原来源与引用版本、独立审核口的合成测试；非整图 | N02–N04 确认回执、实际来源读回、ModelGateway 审核及出机权限装配 |
| F11 | N05 仅有独立回执验证器，未注册图工具 | 未完成 | [F11 Evidence](F11_CALENDAR_RECEIPT_GUARD_20261029.md)：已授权更新和提醒失效的合成验证；未执行写入 | 用户原确认、calendar.update 语义映射、真实日历写入/读回与提醒失效 |
| F12 | N02 Desktop 条件注入（NotificationHost）；N04 仍需投递读回 | 未完成 | optional-graph-hosts；非整图 | N04 真实投递读回及导出授权 |
| F13 | N02 Desktop 条件注入（system.observe）；云/配额/锁显式拒绝 | 未完成 | optional-graph-hosts；非整图 | 独立 cloud/quota/lock resolver；N04 confirmed_recovery |
| F14 | N01 可选工厂，默认不注册 | 未完成 | [F14 Evidence](F14_OBSERVATION_ADAPTER_20261029.md)：原观察与 HostTask 回执合成验证；非实机 | Desktop 受信观察入口、跨节点设备会话绑定、输入锁、确认及效果读回 |
| F15 | 既有 N04/N05/N06 与 host-only review 桥接；Desktop config/origin/native viewer 已接 main | 独立审查可配置，依赖用户公钥与签名目录 | 完整应用合成 28/28；worker 16/16；Desktop review hosts 12/12、workspace-controls 7/7；非真人审查/云验收 | 真实独立审核者签名、固定部署、Laya、实机 WinForms 目视 |
| F16 | 未核验新增注册 | 未完成 | 待本轮图路径验证 | 原 CI 失败与验证绑定 |
| F17 | 未核验新增注册 | 未完成 | 待本轮图路径验证 | 六项原失败、修复及逐项验证绑定 |
| F18 | 未核验新增注册 | 未完成 | 待本轮图路径验证 | 原 PR 差异、当前头和合并授权 |
| F19 | 未核验新增注册 | 未完成 | 待本轮图路径验证 | 原 Issue、修复与关闭读回 |
| F20 | 无 host/guard 要求；Runtime worker 有条件接线；Desktop case 加密存储 + `coding.f20.configure` IPC | 未完成（worker 未注入） | [F20 缺口](F20_WORKER_TRUST_GAPS_20261029.md)；此前 worker/runtime Synthetic 验证非候选真实编译 | 生成候选与原输入绑定、隔离真实检查、前沿与出机授权、完成校验、Renderer 入口 |
| F21 | N01/N03 可选工厂，默认不注册 | 未完成 | optional-graph-hosts：manifest/health 注入读；非整图 | 安装、隔离探测、启用许可与 Desktop MCP 宿主装配 |
| F22 | 未核验新增注册 | 未完成 | 待本轮图路径验证 | 影子快照、隔离、原 trace 与校验 |
| F23 | N04/N05 既有工厂；未生产装配 | 未完成 | 同库 Policy/acceptance/CAS、授权与验签测试合计 15/15；合成测量，非生产配置生效 | 现行配置消费者、可信测量和测试 Evidence 来源 |
| F24 | N09 可选工厂与 knowledge 只读对账端口，默认不注册 | 未完成 | [F24 Evidence](F24_KNOWLEDGE_READBACK_PORTS_20261029.md)：原知识写对账记录、Policy 和 verified observation 交叉核验；非整图 | 生产原目标身份绑定、图 worker、导出授权、停止与恢复装配 |
| F25 | N03 可选工厂，默认不注册 | 未完成 | optional-graph-hosts 含 F25 边界；非整图 | N04 save_credential_reference、出站范围与 Desktop 受信宿主装配 |
| F26 | 未核验新增注册 | 未完成 | 待本轮图路径验证 | 平台构建、部署及真实证据读回 |
| F27 | N01 可选工厂，默认不注册 | 未完成 | optional-graph-hosts 含 F27 边界；非整图 | N04/N05/N06/N07 guard 与来源映射、原文及工具 Evidence |
| F28 | N03 可选 host/guard 工厂，默认不注册 | 未完成 | optional-graph-hosts：`readNativeConfig`/`resolveGuardState` 边界；SQLite 计划竞态 13/13、原子代理 37/37 仍为 Synthetic | 执行前授权与目录 gate、Desktop/ModelGateway 生产注入、图整体验收 |

## 代实现及边界

- 原 goo122 维护范围：本轮新增 F23 Runtime SQLite 原子配置端口和版本化 acceptance 管理口；配置值和操作记录共同提交，原 Policy/acceptance 在同库事务内重验，未知提交按同一 operationId 读回。新增只验签的分支校验器，绑定原 Runtime 任务、上下文及可信测量回调。它们尚未接入实际配置消费者或可信测量与测试 Evidence 生产者，不代表 F23 已配置。
- F23 当前配置读取点及云消费者证据边界见 [F23 配置权威来源](F23_CONFIGURATION_AUTHORITY_20261028.md)。
- 原 Potatos498 维护范围：本轮新增 F06 提醒读取的可选图适配切片，调用现有待办存储与时钟，必须由可信宿主核对同图 N03 原回执；当前无该宿主注入，因此默认不注册。同轮补充 F06_N03/N05、F07_N04 等 Runtime 可选工厂（`workflow-f06-todo-graph-host.ts`、`workflow-f07-calendar-graph-host.ts`），分别委托 `todo.create` 与可信送达回调；默认不注册。
- 原 goo122 / 业务侧代实现：F04_N05、F05_N02、F13_N02、F25_N03、F27_N01 可选 Runtime 工厂（`workflow-f04-f05-recall-host.ts` 等）。2026-10-29 修复 F05/F07/F13 将 scope 合并后直接调用工具的问题：新增由组合层提供的原 Runtime Policy/ToolGateway 调用口，缺失时不注册，不代表网关已接线。F13 云/配额/锁仍须独立 `resolveProbeOutcome`，不能由 CPU/内存/uptime 推断。F07 和 F13 执行时绑定真实输入至原图意图。
- 原 Potatos498 维护范围：本轮新增 F09 N02 可选适配工厂，读取同图原采集操作的本地确认记录并保留分页、不同版本；feeds 宿主补了原来源执行许可、消费后结果许可和实际模型目标的复核口。模型目标无法证明一致则拒绝。Desktop `main.js` 已在 feeds 就绪时装配 `createF09FeedGraphHost` 并将 N02 工具并入 conversationTools，且在 `requestToolAuthorization` 调用 `prepareWorkflowFeedSource`；`f09WorkflowWorker` 仍因缺少可信 inputRef/resolveInput 与 F10 入队而不注入，不声称真实源已采集或整图完成。
- 原 goo122 维护范围：本轮补充 F01_N02 受限上下文读取工厂及责任、模型来源适配；必须注入原任务查询、责任生命周期及精确出机许可，Desktop 生产提供者尚未完整装配。
- 原 goo122 维护范围：F01 上下文截止时间校验拒绝无法解析的 deadline；F03/F04/F05 的 MemoryQuery 快照校验拒绝无效日期、无效版本以及超出受信查询的记录。此为本轮 Owner 授权代实现的输入验证，不改变真实来源及权限仍未完成的状态。
- 原 goo122 维护范围：本轮补充 F28 角色计划与 Runtime 事务预绑定底座；提交结果未知后可走独立授权的只读对账。执行前校验和原图调用链尚未接通，计划内 child 在创建前明确拒绝；普通子任务的原回归单独验证。
- 通用 Runtime 图驱动保留原 HostBridge、任务和工具链；结构化缺项只从本地模板和原目录投影，不信任云端任意诊断文本。
- `cloudPersistentHost` 未注入：尚无经验证的真实关机后云宿主，不能将本机存储或模拟宿主报为云常驻。

本文件随工作进展更新。未完成 28 图之前不以目录数、合成测试、云端 settled 或此表作为完整验收。

## 本轮检查记录

- Node 24.15.0 / npm 11.12.0：`npm run check` 的架构门禁 3/3、契约夹具 4/4 与生成类型检查通过，进入工作区测试后出现 `@personal-agent/coordination` 取消错误码不符（实际 `EXTERNAL_FAILURE`，预期 `CANCELLED`）以及 `packages/knowledge/test/bridge.test.mjs` 的 TLS 用例失败。knowledge 测试阶段长期无新输出，已中断；其后工作区与根集成检查未完成。首次检查使用的受限 PATH 未含 `C:\msys64\ucrt64\bin`，故环境影响待隔离确认；不能据此声称检查通过。
- 后续以含 OpenSSL 的 PATH 串行运行 `agentarts-proposal-invocations.test.mjs` 和 `agentarts-status-recovery.test.mjs`：54/54 通过；首次全量输出被截断，尚不能确定其失败正属于这两个文件，因此这不消除首错。
- 加入 OpenSSL PATH 后，`packages/knowledge/test/bridge.test.mjs` 仍有相同两项失败且进程无新输出，已中断。单独运行 `--test-name-pattern='pinned TLS rejects'` 得到 `KnowledgeError: SOURCE_UNAVAILABLE`，位置为测试第 26 行的有效连接；实际底层原因尚未确认，未将其归咎于本次改动或宣称通过。
- 使用 Node 24.15.0 与含 OpenSSL 的 PATH，在沙箱外针对本机回环复测：`agentarts-live-transport.test.mjs` 的 peer close、WS stall 与 HTTP stall 9/9，通过；`bridge.test.mjs` 的 pinned TLS 与 cancellation/deadline 两项 2/2，通过。该证据支持沙箱本机网络限制解释这些失败，但不能代替完整 `npm run check`。
- `node --test apps/runtime/test/workflow-shadow-configuration.test.mjs apps/runtime/test/workflow-shadow-acceptance.test.mjs apps/runtime/test/workflow-shadow-verifiers.test.mjs`：8/8，通过真实 Runtime SQLite 测试及合成授权/测量。
- 最新 Runtime 定向构建通过；串行运行 F15 frontier、F20 worker/driver 和 F28 role-plan 相关 7 个测试文件，47/47 通过；此前 F28 替换参数错误码不符的首轮 46/47 已修复并复测。
- F20 Desktop case 配置定向测试首次在 `realpathSync.native` 处遇到 `EPERM`；沙箱外重跑被中断，尚无通过结果。该配置尚未接主进程或启用图。
- F15 定向组合中，`coding-repair-worker-capability.test.mjs` 12/16：4 项旧 Synthetic 图夹具跳过新增前驱且预期旧 N05/N06 可运行，现被新 guard 拒绝；未删除或放宽断言。`coding-repair-application.test.mjs` 在 fixture 创建时因 `realpath` 的 `EPERM` 失败，未进入 guard；与新增 frontier 单测和 Engine/HostBridge 合成路径通过分开记录。
- 沙箱外 F20 case 测试 1/1 通过，证明隔离配置加密与工作区绑定，未证明 Desktop 装配。沙箱外单独复跑 F15 完整应用的 `normal main Agent dispatch runs`：失败于 `F15 independent redline review is unavailable`，旧断言期望成功；这是新 guard 缺少实际审查提供者造成的当前行为变化，尚未修复或改写断言。
- 为夹具接入明确 Synthetic 的签名审查后再次在沙箱外复跑同一 F15 完整图，仍失败：`UNAUTHORIZED: Original coding snapshot changed`，触及多轮快照衔接；当前在修复，不能据此声明完整图通过。
- 多轮快照修复后，沙箱外串行运行 `node --test --test-concurrency=1 apps/runtime/test/coding-repair-application.test.mjs`：28/28，通过真实 Runtime/Policy/HostBridge 与 Synthetic 模型、选择器和独立签名审查。旧 worker 快捷夹具补齐原前驱与合成签名审查后，`node --test apps/runtime/test/coding-repair-worker-capability.test.mjs` 为 16/16，保留原行为断言。这些本地合成图回归不证明当前云、真实审查者或设备验收。
- 仓库根构建首次运行因 npm 子进程 PATH 不包含 wrapper 而失败，修正当前进程 PATH 后通过 Runtime 定向构建；完整 `npm run check` 仍以以上结果为准。
- 2026-10-29 恢复：F15 Desktop review hosts 12/12、workspace-controls 7/7；Desktop F06/F09/F15/F20 定向合计 28/28；Runtime F01/F02/F09/F15/F20/F23/F24/F28 相关 85/85；F15 完整应用+worker+AgentArts/Live 回执 92/92；optional graph hosts（含 F08/F12/F21/F28 等）13/13。`main.js` 已装配 F09 N02、`prepareWorkflowFeedSource`、`coding.f20.configure` IPC；quit 夹具补 `f09FeedGraphHost` 后 33/33。
- 新增可选工厂默认不注册：F03–F08/F12/F13/F21/F25/F27/F28 相关 host；缺受信端口返回空 tools。`cloudPersistentHost` 仍未注入。
- 2026-10-29 含 OpenSSL PATH 完整 `npm run check`：**通过**（exit 0；含 architecture、workspace 测试与根集成）。此前 quit 失败已修复后重跑。
- 2026-10-29 继续后，使用 Node 24.15.0 直接编译 Runtime TypeScript 并运行 `apps/runtime/test/workflow-optional-graph-hosts.test.mjs`：13/13；Synthetic 受信调用回调不代表生产网关注入。`npm run build --workspace=@personal-agent/runtime` 的前两次调用因设置 `$env:PATH` 未正确传入 Windows cmd 子进程而找不到 `tsc`；改用 `$env:Path` 已定位环境问题。新改动后完整 `npm run check` 尚未重新执行。
- 2026-10-29 使用 `$env:Path` 修正进程环境后，`npm run build --workspace=@personal-agent/runtime` 通过；随后运行 F01、F07 freshness、memory-query-boundary 和 optional-graph-hosts 共 22/22 Synthetic 测试通过。不代表真实服务或整图通过。
- 2026-10-29 再次 Runtime 定向构建通过，F01/F03/F07/F10/F11/F14/F24、memory 边界及 optional hosts 共 45/45 本地测试通过。F24 集成使用真实 Runtime 与合成业务端口；其余为 Synthetic，不能当成云或设备验收。
- 2026-10-31：Desktop 注入 F06 `verifyWorkflowReminderBinding`、F09 `f09WorkflowWorkerPorts`（AgentArts 合并 ownedImage）、`workflow-graph-composition`（F08_N10/F12_N02/F13_N02，getApplication 惰性）；F06 N03 持久化 revision 绑定；导出 F16/F17。定向：optional hosts + F06/F09 Desktop/Runtime 与 quit-preflight **通过**。含 OpenSSL PATH 完整 `npm run check`：**通过**（exit 0）。F20 worker / F10 / cloudPersistent 仍未注入。

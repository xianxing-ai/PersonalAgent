# 28 图（F01–F28）可用化与 PR #531 未完成项四人分工清单（2026-11-19）

> 依据：[联合验收报告](JOINT_ACCEPTANCE_REPORT_20261119.md) · [卡顿项与分工简报](JOINT_ACCEPTANCE_BLOCKERS_BRIEF_20261119.md) · [联合验收可用化分工清单](JOINT_ACCEPTANCE_TASK_ASSIGNMENTS_20261119.md) · `docs/MODULE_ASSIGNMENTS.md`（主线 `f33ef383`，2026-10-31 责任分区修订，已恢复四人按模块分工） · `docs/competition/evidence/graph-capability-gaps.json` · 全部开放 PR（#531/#575/#614/#615/#618/#641/#645/#672/#673/#674）及线上镜像源码 `644c7416` 实测比对。
>
> **目标 Profile**：`huawei_ict_agentarts`。本文件补齐「为什么当前 28 图为 0/28 可运行」、全部开放 PR 与最新镜像的真实差异、**PR #531 / #641 全部未完成项按现行四人分工的承接清单**，以及 **F01–F28 逐图可用化分工**。本文件随 **Draft PR #675** 维护，未完成前禁止合并；**MOD-19 打包安装继续暂停**，**MOD-26 社交扩展未选平台不自动开工**。

---

## 1. 为什么当前 28 图是 0/28 可运行（四层代码与镜像事实）

1. **主线入口注册仅声明了 F15，其余 27 图无对话入口**：
   - 主线 `f33ef383` 的 `apps/desktop/electron/image-workflow-catalog.js` 第 36 行硬编码：仅 `F15` 绑定了 `entryName = 'coding.repair.workflow'`，其余 27 张图（F01–F14、F16–F28）连 `conversation_entry` 都未注册，目录判定直接返回 `conversation_entry_not_registered`。
   - 即使在 **PR #531** 中，`image-workflow-catalog.js` 相对 `main` 也没有任何改动；`workflow-graph-composition.js` 仅条件注入了 F08_N10 / F12_N02 / F13_N02 三个可选宿主。
2. **主线 `main` 存在 92 项图能力缺口（152 项节点适配器未齐备）**：
   - `origin/main` 的 `docs/competition/evidence/graph-capability-gaps.json` 登记：28 图共声明 **109 项能力**（对应 **185 个节点 / 152 项 host+guard 适配器需求**），主线仅提供 **23 项**，缺失 **92 项**（按原缺口表计：`goo122` 63 项、`zemeng5208` 19 项、`Potatos498` 12 项，含少量双归属）。
3. **大量已写好的 28 图代码滞留在开放 PR 中尚未回主线**：
   - **PR #531**（Draft，`zemeng5208`，100+ 文件，`CONFLICTING`）与 **PR #641**（Draft，`goo122`，延续 #531 其余代码的 `MERGEABLE` 基线）内包含超过 50 个 `apps/desktop/electron/f01-*.js`～`f28-*.js` 及对应 Runtime 接线，但因要求「全部接线与真实验收完成后才合并」，一直未拆入 `main`。
   - **PR #618**（OPEN，`Potatos498`，`MERGEABLE`）已实现 F06/F07/F08/F09/F11/F16 共 **10 项业务与开发 host 端口**，尚未审查合入 `main`。
4. **线上最新已发布镜像与主线 `main` 发生双向分叉漂移**：
   - 线上 AgentArts `Latest → v4` 运行的 SWR 镜像 `f26-644c7416f5b0e98d`（源码 `644c7416f5b0e98d5c90b8360cc4fd7d53224eda`，2026-11-05）经 `git merge-base --is-ancestor` 核实：**既不是 `origin/main@f33ef383` 的祖先，也不是 PR #531 / #641 当前 head 的祖先**。
   - 实测源码差异：
     - `644c7416` vs **PR #531**：`owned-workflow-data.ts` 与 `owned-workflow-templates.ts` **零差异**（仅 `owned-workflows.ts` 和 `repair-replay.mjs` 有增量），说明线上镜像实为早期 `#531` 分支产物；
     - `644c7416` vs **`origin/main@f33ef383`**：线上镜像包含 `#531` 的 `evaluation-controller.mjs`、`image-services.mjs` 增量和更新后的 F06/F08/F11 模板，但 **`main` 反过来缺少这些镜像服务端增量**；同时 **`main` 已更新 F10（`research.search`/`knowledge.search`）与 F20（`workspace.run_allowed_command`）能力名**，线上镜像仍停留在旧能力名，导致联调时模板摘要与能力名双双不匹配。

---

## 2. 全部开放 PR 盘点与处置分工（截至 2026-11-19）

除本追踪 PR **#675**（Draft，未完成前禁止合并）外，仓库当前共有 **10 个开放 PR**，必须先按依赖关系清理与拆分，避免继续积压冲突：

| PR | 状态 / 可合性 | 作者 | 内容与对 28 图/镜像的影响 | 处置动作与责任分工 |
| --- | --- | --- | --- | --- |
| **#672** | OPEN / MERGEABLE | `2511375597-lab` | 修复设置页 28 图目录后台刷新冲刷 DOM、工作区日历卡片状态、工作台 28 图/认知防重入 | **立即审查合并**（非作者任一审并，建议 `Potatos498` / `goo122`） |
| **#673** | OPEN / MERGEABLE | `2511375597-lab` | 保护 AgentArts 观测凭据表单草稿并兼容空快照（支撑 #671 观测设置） | **立即审查合并**（非作者任一审并） |
| **#674** | OPEN / MERGEABLE | `2511375597-lab` | 同步 MOD-10 自有镜像与多赛事研究文档至主线 | **立即审查合并**（纯文档） |
| **#618** | OPEN / MERGEABLE | `Potatos498` | 交付 **F06/F07/F08/F09/F11/F16 共 10 项业务/开发 host 端口** + 日历 `externalId` 幂等，并更新 `graph-capability-gaps.json` | **优先审查合并**（`goo122` / `zemeng5208` 审；合入后 `Potatos498` 补生产调用方接线与真实账号读回，`2511375597-lab` 补 Desktop 注入） |
| **#645** | OPEN / MERGEABLE | `goo122` | 从 #641 抽出的 Windows Job 原生辅助程序自包含包完整性校验（支撑 F15/F16/F17/F20/F21 原生隔离） | **优先审查并补 .NET 8 / Windows PSEC 实机复验后合并**（`zemeng5208` 审，`2511375597-lab` 合） |
| **#615** | Draft / MERGEABLE | `goo122` | 镜像内模型响应改为 Provider 解析后记录（防慢响应阻塞；涉及 `model_proxy_response` 日志事件迁移） | **发新镜像前审定日志消费者迁移**（`Potatos498` / `zemeng5208` 核对观测消费方后转 Ready 合并，随新镜像发布） |
| **#614** | Draft / MERGEABLE | `goo122` | AgentArts Runtime 强制内层入站鉴权（破坏性迁移，需平台转发 `X-PA-Agent-Token` 与全客户端迁移） | **暂不合并部署**；由 `zemeng5208` 先在受控环境验证平台头转发与全部调用方迁移后再解冻 |
| **#575** | OPEN | `zemeng5208` | 开源组件清单与原创性声明（比赛材料 #1） | 独立比赛文档 PR，不阻塞 28 图，按常规非作者审查合并 |
| **#531** | Draft / **CONFLICTING** | `zemeng5208` | IMAGE28 原始全量接线大包（含 #535 控制闸门、#543 云持续、#547 无人值守、#564/#566/#571 与 F01–F28 大量文件） | **严禁整包硬合**；作为代码/证据母库保留，按第 3 节清单由四位协作者拆成独立小 PR 逐批合入 `main` |
| **#641** | Draft / MERGEABLE | `goo122` | 延续 #531 其余代码的整洁基线（当前仍以已合入的 #642 为 base，与 #531 仅差 24 文件） | **由 `goo122` 将 base 切回 `main` 并同步最新 `main`**，随后与 #531 协同按模块/按图拆出可验收小 PR，全切片合完且验收后关闭 |

---

## 3. PR #531 / #641 未完成项按现行四人分工补录

### 3.1 已从 #531 / #641 拆出并合入 `main` 的 11 个前置切片（勿重复开发）
- `#640`（只读补丁范围核对）、`#642`（Live 播放排空防回声）、`#643`（F22 历史回放顺序）、`#644`（危险操作逐次内容确认）、`#646`（F11 待办条件更新保护）、`#647`（Desktop 冒烟启动清理与中文路径）、`#648`（F07 完整日历窗口摘要）、`#649`（F17 Node 语法检查定位器）、`#650`（F12 实时语音播报关联）、`#651`（F08 邮件发送只读核对）、`#664`（F27 上下文摘要原文约束保留）。
- **注意兼容衔接**：`#664` 合入后摘要与保留原文呈交织顺序，`#641` 中原 F27 来源映射假设“摘要在前”，拆出 F27 切片时必须适配 `#664` 交织顺序；`#644` 与 `#641` 的 standing autonomy 合流时必须保留原修复 `b21c5c83`（已要求内容确认的操作不能被长期授权越权放行）。

### 3.2 PR #531 / #641 剩余未完成项分工（逐项落到唯一主责人）

#### A. `goo122` 承接的 #531 / #641 剩余项（基础运行时、控制闸门、知识记忆、MCP/Skills、底座切片）

| 编号 | 来源（#531/#641 未完成项） | 具体交付内容 | 协同与验收门槛 |
| --- | --- | --- | --- |
| **S531-G1** | **#641 分支治理与控制闸门切片（#535 / #547 底座）** | 1. 将 `#641` base 从已合入的 `#642` 切回 `main` 并同步最新 `main@f33ef383`。<br>2. 把 `#535` 的执行世代/出机确认门禁、standing autonomy 防越过 `#644` 内容确认（`b21c5c83`）、`#547` 无人值守进入/归来 checkpoint（缺失即 `RESULT_UNKNOWN` + 控制版本校验）拆成独立可审 PR 合入 `main`。 | `zemeng5208` 审认知/控制语义；`2511375597-lab` 接 Desktop 消费；通过全量 `npm run check` |
| **S531-G2** | **F03 原子回执恢复 & F04/F24 Writer Journal 切片** | 1. 补齐 **F03 CAS 后、结果写入前崩溃的原子回执恢复**（#531/#641 明确遗留缺陷）。<br>2. 拆出并合入 F03/F04/F05/F24 的 Runtime 生产口：`memory.query`、`knowledge.source_and_write_check`、`knowledge.citation_revision_check`、`memory.invalidate_projection`、`memory.quarantine_candidate`、Writer Journal 与 `runtime.persist_graph`/`recover_checkpoint`/`reconcile_original_effect` 等 F24 调度/取消/恢复口。 | `zemeng5208` 对接 F03 认知重规划；真实文件/SQLite 崩溃恢复与重启读回测试通过 |
| **S531-G3** | **F01 / F10 / F21 / F25 / F27 Runtime 底座切片** | 1. **F01**：拆入 `responsibility.snapshot`、`model.capabilities`、`model.native_config_check`、`policy.scope_check`、`runtime.commit_task_graph`、`runtime.commit_responsibility`。<br>2. **F10**：拆入 `knowledge.check_supported_claims` 与研究来源读回底座。<br>3. **F21**：拆入 `mcp_skill.*` 5 项安装隔离、协议健康与授权启用后端口。<br>4. **F25**：拆入 `policy.outbound_context_check` 与 `configuration.save_credential_reference`。<br>5. **F27**：拆入 `model.context_source_map_check`、`runtime.invalidate_context_mapping`，并**适配 `#664` 原文交织顺序**解决 F27 兼容冲突。 | 口齐后交 `2511375597-lab` 注入 Desktop；补齐真实 Vault / 固定只读 MCP 验收 |
| **S531-G4** | **F16 / F17 / F18 / F19 / F23 Runtime 与 GitHub 底座切片** | 1. **F16/F17**：拆入 `runtime.deliver_failure_report` 及与 `Potatos498` 协同的 `github.bound_ci_failure` 底座。<br>2. **F18/F19**：拆入 `github.registered_merge`、`github.registered_close_issue`、`runtime.enqueue_issue_repair`。<br>3. **F23**：交付现行决策配置消费者、可信测量与 `configuration.promote_with_rollback`/`operation_readback`、`evaluation.temporal_leakage_check`（齐备前禁止生产 shadow release）。<br>4. 推进 **#645**（Windows Job 自包含校验）与 **#615**（模型响应观测）合入 `main`。 | `Potatos498` 对接 F16/F19 修复链；`zemeng5208` 对接 F18/F19/F23 真云与真 GitHub 读回 |

#### B. `Potatos498` 承接的 #531 / #641 剩余项（业务连接器生产口、真实账号与修复链）

| 编号 | 来源（#531/#641 未完成项） | 具体交付内容 | 协同与验收门槛 |
| --- | --- | --- | --- |
| **S531-P1** | **#618 合入与 F06/F07/F08/F09/F11 生产接线及真实账号读回** | 1. 推动 **PR #618** 审查合入 `main`（先落地 10 项业务/开发 host 端口）。<br>2. 将 10 项 host 端口接入真实 Runtime/Policy/ToolGateway 生产调用方，补齐：<br>   - **F06**：生产 `invokeTodoCreate` + 持久化原子幂等账本 + 到点投递回执；<br>   - **F07**：绑定账号/配置/来源的完整日历新鲜度校验（修复 `#648` 空窗口不含账号身份的缺口）与真实 CalDAV 写后读回；<br>   - **F08**：真归档、真 SMTP 发送、发前持久化原身份 + UIDPLUS 映射、结合 `#651` 独立 Sent 只读核实；<br>   - **F09**：真实 `feeds` 来源、持久游标与 `feed-source-grant` 会话租约；<br>   - **F11**：结合 `#646` 显式传入原 `revision` 的日历改期与旧提醒作废联动。 | 口齐后交 `2511375597-lab` 做 Desktop 注册与提问卡；产出隔离真实 CalDAV / 授权邮箱 / 公开 Feed 读回证据 |
| **S531-P2** | **F12 通知投递读回口 & F16/F19 开发修复链** | 1. **F12**：落地 `notification.deliver` / `notification.deliver_when_due`（对应 `#574` 与 CW-09）及真实设备投递/点击 `ack` 读回口。<br>2. **F16/F19**：联调 `#618` 的 `github.bound_ci_failure`、`workspace.test_intent_check` 与 F19 回归测试宿主，确认 F19 正向整链在 120s 绝对期限内稳定通过。 | 与 `goo122（S531-G4）`、`zemeng5208（S531-Z3）` 联调；真设备通知读回 + F19 真实仓库测试 |

#### C. `2511375597-lab` 承接的 #531 / #641 剩余项（28 图目录入口、Desktop 组合注入与前端 UI）

| 编号 | 来源（#531/#641 未完成项） | 具体交付内容 | 协同与验收门槛 |
| --- | --- | --- | --- |
| **S531-L1** | **修复 `image-workflow-catalog.js` 单入口硬编码 & 扩展 `workflow-graph-composition.js`** | 1. 解除 `apps/desktop/electron/image-workflow-catalog.js` 第 36 行仅硬编码 `F15` 入口的限制，改为从受信生产组合动态读回全部已注册的图入口（未注册仍诚实标 `unavailable`，严禁 Fake）。<br>2. 推动 **#672/#673/#674** 立即合入 `main`。<br>3. 从 `#531`/`#641` 按图分批把已有且后端口已齐备的 `apps/desktop/electron/f01-*.js`～`f28-*.js`、`business-workflow-*.js` 条件注入 `workflow-graph-composition.js` 与 `main.js`，同步更新 `before-quit` 资源清理夹具。 | 强依赖三人逐批交出已合入 `main` 的公开后端口；保持 `test:smoke`、`test:workspace-smoke`、`test:runtime-application-smoke` 全绿 |
| **S531-L2** | **#531 交互 UI 切片（补问卡、禁止项、观测/审核/F20 配置界面）** | 从 `#531`/`#641` 拆出并合入纯前端/IPC 消费切片：<br>- F01/F08/F11/F14 业务补问卡与确认卡（`business-workflow-question-*`、`f01-clarification-*`）；<br>- F15 审核配置与本地 viewer 启动入口、F18/F19 配置面板、F20 case 配置 UI（worker 信任闭环齐备后注入 `ownedWorkflowWorker`）；<br>- F27 对话禁止项侧栏（`conversation-prohibitions.js`）与 F22/F23 配置回读展示；<br>- F02 语音问题卡与通知/播报 UI 消费接线。 | 只消费公开口，不把 UI 可点标为整图 `done`；附带定向 UI smoke 与真实窗口读回 |

#### D. `zemeng5208` 承接的 #531 / #641 剩余项（镜像收敛发布、核心实现缺口与全部真机/真云/真人验收）

| 编号 | 来源（#531/#641 未完成项） | 具体交付内容 | 协同与验收门槛 |
| --- | --- | --- | --- |
| **S531-Z1** | **镜像双向漂移收敛与新版 ARM64 发布（F26）** | 1. 将 `#531`/`#641` 中 `apps/agentarts-runtime/src/{evaluation-controller,image-services,main,server}.mjs` 与 F06/F08/F11/F10/F20 模板差异**统一收口到 `main`**（解决线上 `644c7416` 与 `main` 双向漂移）。<br>2. 对接 `#615`（日志迁移）与评估 `#614`（内层鉴权平台转发）。<br>3. 基于最新 `main` 重新构建 ARM64 镜像、推送 SWR、更新固定版本与 `Latest`，补齐 **F26 五节点整图**（含 N02 构建/N03 运行时读回/N04 真实工具证据/N05 发布覆盖）并**安全轮换历史泄露凭据与 WSS 令牌**。 | 新部署源码 SHA 与 `main` 严格一致；11 项绑定与 F09/F10/F20 模板全部对齐无漂移 |
| **S531-Z2** | **F22 全 shadow 模式、F23 真实平台评估、F28 辅助模型与 #543 云持续宿主** | 1. **F22**：补齐除受控回放之外的其余 shadow 模式及日常 Competition sampling 真实接线（`#566`/`#571` 合回 `main`）。<br>2. **F23**：在真实 AgentArts 平台完成有效评估任务（解决 0 分列映射与模型访问问题）并完成真实配置晋升/回滚读回。<br>3. **F28**：合回 `executor.scoped_tool_loop`、`workspace.source_and_test_check` 与多模型路由真实回放证据。<br>4. **CW-05 / `cloudPersistentHost`**：把 `#543` 云持续宿主合回 `main`，联合 `Potatos498` 来源适配器完成**真实关机/断网后的云端续跑与归来对账**。 | 严禁以本地 fixture/占位分数替代平台评估或关机持续证据 |
| **S531-Z3** | **F15 真人签名/目视、F18/F19 真 GitHub、F20 worker 信任闭环与原生设备真机验收** | 1. **F15**：解决 WinForms viewer 窗口不可见（仅 `SHOWN` 但 CUA 未见）问题，完成**独立真人 Ed25519 签名**（验证作者自签拒绝）与实机目视验收。<br>2. **F18 / F19**：使用授权真实 GitHub token 与非作者批准，完成 PR 审查/合并与 Issue 修复/关闭的真实外部读回，复验 F19 正向整链 120s 期限闭环。<br>3. **F20**：补齐 `F20_WORKER_TRUST_GAPS` 闭环与本机决策工具公布，齐备后交 `2511375597-lab` 注入 `ownedWorkflowWorker`，跑通四节点真云闭环。<br>4. **F02 / F13 / F14 / MOD-16 / MOD-17**：完成物理麦克风/扬声器回声与取消、真实浏览器/桌面操作越界与取消、物理 F9 + 记事本 UIA 写后读回 + Pipe ACL、Windows 普通用户 `system.registered_probe` 与 AgentArts 联合读回。 | 每一项须留存独立 SQLite、目标端与平台 Trace 关联回执，方可在 152 项清单勾选 |

---

## 4. F01–F28 全 28 图逐图分工与可用化路线表

> 说明：**所有 28 图的 Desktop 消费组合、入口注册（`image-workflow-catalog.js`）与设置/交互 UI 统一由 `2511375597-lab` 在对应后端口合入 `main` 后条件注入**；下表明确每张图的节点数、`main` 当前缺失能力、开放 PR / 镜像现状、后端主责人与本图达到“实际可运行”的最短闭环条件。

| 图 | 名称 / 节点数 | `main` 缺失能力（`graph-capability-gaps.json`） | 开放 PR / 镜像 `644c7416` 现状 | 后端 / 能力主责 | 前端 / 组合主责 | 达到“可运行”的最短闭环条件 |
| --- | --- | --- | --- | --- | --- | --- |
| **F01** | 主对话与责任理解 / 9 | `memory.query`、`responsibility.snapshot`、`model.capabilities`、`policy.scope_check`、`model.native_config_check`、`runtime.commit_task_graph`、`runtime.commit_responsibility`、`voice.ask_question`（8） | `#531`/`#641` 已有 `f01-*.js`（6 文件）与补问卡接线；未入 `main` | **goo122**（7 项底座）+ **zemeng5208**（`voice.ask_question`） | `2511375597-lab`（注册 F01 入口与补问 UI） | 拆入 S531-G3 底座与 F01 补问卡，跑通真实会话→持久责任→子任务分派 |
| **F02** | 语音交互与确认 / 11 | `policy.pending_question`、`policy.confirmation_check`、`policy.resume_original_operation`、`runtime.invalidate_question`、`runtime.reject_operation`、`runtime.local_stop_observation`、`runtime.read_original_effect`、`voice.speak_question`、`voice.local_fallback`（9） | `#642` 已入 `main`；`#531`/`#641` 留有 `f02-*.js` 与问题卡语音绑定；实测缺 SIS/Live 配置与 `voice.play` UI | **zemeng5208**（语音原生/物理声学）+ **goo122**（7 项 Policy/Runtime 口） | `2511375597-lab`（补 `voice.play`、问题卡与唤醒设置修正） | 拆入 F02 端口 + 配通 SIS/Live + 真机物理麦/扬声器回声与释放验收 |
| **F03** | 世界状态、目标与局部重规划 / 10 | `memory.query`、`runtime.invalidate_affected_subgraph`、`runtime.original_effect_binding`、`runtime.reconcile_original_effect`、`policy.compensation_check`、`runtime.submit_bound_compensation`、`runtime.schedule_graph`、`voice.ask_question`（8） | `#531`/`#641` 已有 `f03-mail-review-workflow-ports.js`；仍缺 **CAS 后写入前崩溃原子回执恢复** | **goo122**（7 项底座 + 原子回执恢复）+ **zemeng5208**（认知重规划语义与 `voice.ask_question`） | `2511375597-lab`（F03 入口与变更审查 UI） | 补齐 CAS 崩溃原子恢复（S531-G2）并完成真实变化→局部重规划闭环 |
| **F04** | Wiki 与作用域记忆管理 / 7 | `memory.query`、`knowledge.source_and_write_check`、`memory.quarantine_candidate`、`memory.invalidate_projection`（4） | `#531`/`#641` 已有 `f04-*.js` 与 writer journal 读回；未入 `main` | **goo122**（全部 4 项） | `2511375597-lab`（F04 入口与出机确认 UI） | 拆入 S531-G2，在公开测试 Vault 验写回、更正/撤回与主动引用失效 |
| **F05** | 记忆搜索与来源回答 / 7 | `memory.query`、`knowledge.citation_revision_check`、`runtime.publish_sourced_answer`（3） | `#531`/`#641` 已有 `f05-workflow-worker-ports.js`；未入 `main` | **goo122**（全部 3 项） | `2511375597-lab`（F05 入口与来源引用展示） | 拆入 S531-G2，验证带来源版本核对的真实原文引用回答与重启一致 |
| **F06** | 待办、提醒与跟进 / 5 | `todo.registered_write`、`reminder.current_clock_and_revision`、`notification.deliver`（3） | **#618** 已实现前 2 项 host；`#531`/`#641` 含 `f06-*.js` 与 `#574` 通知；**线上镜像 `644c7416` 模板已更新但 `main` 为旧模板** | **Potatos498**（合入 #618 + 生产写/时钟/投递口）+ **goo122**（通知协同） | `2511375597-lab`（F06 入口与提醒 UI） | 合入 #618 + 对齐 `main`/镜像模板 + 真实待办创建/到期投递读回 |
| **F07** | 日历安排与冲突处理 / 5 | `calendar.freshness_check`、`calendar.registered_write`（2） | `#648` 已入 `main`；**#618** 已实现 2 项 host；`#531` 有 `f07-*.js`；**主线当前存在 #26 CalDAV `RESULT_UNKNOWN` 回归** | **Potatos498**（先修 #26 回归 + 合入 #618 + 补账号绑定新鲜度口） | `2511375597-lab`（F07 入口与日历设置/卡片接线，合入 #672） | 修 #26 回归 + 合入 #618 + 隔离 CalDAV 写入与独立 GET 读回通过 |
| **F08** | 邮件分类、草稿与发送 / 13 | `mail.registered_archive`、`mail.registered_send`、`policy.operation_scope_check`、`runtime.wait_reconciliation`、`runtime.versioned_replan`、`voice.ask_question`（6） | `#651` 已入 `main`；**#618** 已实现 2 项邮件 host；`#531` 有 `f08-*.js`（5 文件）；**线上镜像模板新于 `main`** | **Potatos498**（真归档/SMTP 发送/UIDPLUS/Sent 对账）+ **goo122**（3 项 Runtime/Policy 口）+ **zemeng5208**（`voice.ask_question`） | `2511375597-lab`（F08 入口、来源管理与补问卡） | 合入 #618 + 拆入 F08 底座 + 对齐模板 + 授权测试邮箱真读/归档/发后核实 |
| **F09** | 订阅、信号发现与筛选 / 4 | `feeds.validate_and_deduplicate`、`runtime.enqueue_research`（2） | **#618** 已实现 `feeds.validate_and_deduplicate`；`#531` 有 `f09-*.js`；**实测云端 `/invocations/f09` 返回 HTTP 404** | **zemeng5208**（修 `/invocations/f09` 404 + 云联跑）+ **Potatos498**（#618 + `feed-source-grant`）+ **goo122**（`runtime.enqueue_research`） | `2511375597-lab`（F09 入口与组合接线） | 修 404 + 合入 #618 + 交出 `enqueue_research`，跑通真公开源四节点与 F10 入队 |
| **F10** | 深度研究与证据汇总 / 6 | `knowledge.check_supported_claims`（1） | `#531`/`#641` 有 `f10-workflow-worker-ports.js`；**线上镜像 F10 模板仍用旧能力名，与 `main` 的 `research.search`/`knowledge.search` 不一致** | **goo122**（`knowledge.check_supported_claims`）+ **zemeng5208**（重发新镜像对齐 F10 模板） | `2511375597-lab`（F10 入口与引用展示） | 拆入 F10 1 项缺口 + 重发镜像对齐模板 + 跑通真实研究检索与引用读回 |
| **F11** | 天气、出行及计划影响 / 5 | `calendar.update_and_invalidate_reminder`、`voice.ask_question`（2） | `#646` 已入 `main`；**#618** 已实现 `calendar.update_and_invalidate_reminder`；`#531` 有 `f11-*.js`；**线上镜像模板新于 `main`** | **Potatos498**（合入 #618 + 查对话天气 `EXTERNAL_FAILURE` + 改期联动）+ **zemeng5208**（`voice.ask_question`） | `2511375597-lab`（F11 入口与地点补问卡） | 合入 #618 + 修天气对话报错 + 对齐模板 + 真实天气/日历改期与提醒作废读回 |
| **F12** | 通知、安静时段与主动服务 / 5 | `notification.deliver`、`notification.deliver_when_due`、`policy.quiet_hours`（3） | `#650` 已入 `main`；`#531` 有 `f12-*.js`（3 文件）与 `#574` 通知；`workflow-graph-composition` 已有 F12_N02 骨架 | **Potatos498**（真实通知投递/点击 ack 口）+ **goo122**（`policy.quiet_hours`） | `2511375597-lab`（F12 入口、归来摘要与系统通知导航） | 拆入 F12 通知/安静时段口 + 实机 Windows 通知展示/点击/ack 读回 |
| **F13** | 系统检查与故障诊断 / 4 | `system.registered_probe`、`runtime.confirmed_recovery`（2） | `#531` 有 `f13-workflow-worker-ports.js` 与 `workflow-graph-composition` 骨架；**实测 #11 系统观测出站因 `confirmDeveloperExport` 缺 `system_observation` 分支被拒** | **zemeng5208**（`system.registered_probe`）+ **goo122**（`runtime.confirmed_recovery` + 修 `system_observation` 出站） | `2511375597-lab`（F13 入口与探测结果展示） | 修 `system_observation` 出站（G-02）+ 拆入 F13 端口，完成 Desktop+AgentArts 联合读回 |
| **F14** | 浏览器与桌面操作 / 6 | `desktop.registered_input`、`desktop.registered_submit`、`voice.ask_question`（3） | `#531` 有 `f14-*.js`；隔离 Edge 11 项本机通过，但 **MOD-16 记事本 UIA 复核失败（#02）且悬浮球点击穿透（#04）** | **zemeng5208**（全部 3 项 + 修记事本 UIA 与原生输入锁） | `2511375597-lab`（F14 入口、观察确认与锁状态卡） | 修 #02 记事本 UIA + 拆入 F14 端口 + 真浏览器/桌面越界与写后读回验收 |
| **F15** | 代码修改、补丁与命令执行 / 6 | `workspace.patch_scope_check`、`runtime.patch_and_required_checks`、`runtime.deliver_patch_evidence`（3） | **`main` 唯一已声明 `entryName` 的图**；`#640` 已入 `main`；`#645` 待合；`#531` 有 `f15-review-*.js`；缺 WinForms 真机目视与**独立真人 Ed25519 签名** | **zemeng5208**（`workspace.patch_scope_check` + 真人签名/WinForms 目视 + 修组合围栏）+ **goo122**（2 项 Runtime 口 + #645） | `2511375597-lab`（F15 审核配置 UI 与 viewer 入口） | 拆入 2 项 Runtime 口 + 合入 #645 + 跑通真实工作区补丁/命令/真人签名整图 |
| **F16** | CI 检查与修复 / 5 | `github.bound_ci_failure`、`workspace.test_intent_check`（2） | **#618** 已实现全部 2 项 host；`#531` 有 `f16-*.js`（8 文件）；未入 `main` | **Potatos498**（合入 #618 + CI 修复链）+ **goo122**（GitHub 底座协同） | `2511375597-lab`（F16 入口与 case 配置 UI） | 合入 #618 + 拆入 F16 生产接线 + 真实 CI 失败日志绑定与受控修复读回 |
| **F17** | 测试失败定位 / 4 | `runtime.deliver_failure_report`（1） | `#649` 已入 `main`；`#531` 有 `f16-f17-*.js`；**实测 #658 `workflow.image.catalog` `source` 围栏失配阻塞 F17 云续传，且 #649 失败卡未接命令 `stderr`** | **goo122**（`runtime.deliver_failure_report` + 修 #658 围栏失配）+ **Potatos498**（#649 `test-locate` 行列输出） | `2511375597-lab`（F17 入口 + #649 失败卡跳转接线） | 修 #658 围栏 + 拆入 `deliver_failure_report` + 接通 #649 失败卡，最快可跑通的图之一 |
| **F18** | PR 审查、批准条件与合并 / 5 | `github.registered_merge`（1） | `#531` 有 `f18-f19-workflow-ports.js`、`f18-review-config-host.js`；未入 `main` | **goo122**（`github.registered_merge` 底座）+ **zemeng5208**（真实 GitHub 验收） | `2511375597-lab`（F18 入口与审查配置 UI） | 拆入 F18 端口 + 授权真实 GitHub token 与非作者 Approve 读回 |
| **F19** | Issue 分诊与关联修复 / 5 | `github.registered_close_issue`、`runtime.enqueue_issue_repair`（2） | `#531` 有 `f19-*.js`（5 文件）；正向整链 60s 曾超时（已改 120s 待复验） | **goo122**（2 项底座）+ **Potatos498**（MOD-38 分诊修复链）+ **zemeng5208**（真 GitHub 读回与 120s 复验） | `2511375597-lab`（F19 入口与 Issue 配置 UI） | 拆入 F19 端口 + 复验 120s 整链 + 真实 Issue 修复与关闭读回 |
| **F20** | API 文档与一致性检查 / 4 | `graph-capability-gaps.json` 0 项额外 host 缺口（依赖 `workspace.read_text`、`workspace.run_allowed_command`、`decision.choose_candidate`） | `#531` 有 `f20-*.js`（5 文件）；**实测首图 F20_N01 报未公布本机决策工具，且线上镜像 F20_N03 仍要旧 `coding.repair.trial`** | **zemeng5208**（补齐 F20 worker 信任闭环 + 决策工具 + 重发镜像对齐 F20_N03） | `2511375597-lab`（信任闭环齐备后注入 `ownedWorkflowWorker` 与 F20 入口） | 重发镜像对齐 F20_N03 + 公布决策工具 + 注入 worker，跑通四节点真云闭环 |
| **F21** | MCP、Skills 和连接器接入 / 5 | `mcp_skill.source_manifest`、`mcp_skill.install_registry`、`mcp_skill.protocol_health`、`mcp_skill.isolated_probe`、`mcp_skill.enable_authorized`（5） | `#531` 有 `f21-workflow-worker-ports.js`；**实测 #15 MCP 重连清空云 Skill 选择器，#27 缺 Draft 2020-12 Schema** | **goo122**（5 项 MCP/Skill 端口 + Draft 2020-12） | `2511375597-lab`（修 #15 云 Skill 选择器 + F21 入口） | 修 #15/#27 + 拆入 F21 5 项口 + 真实 stdio/HTTPS MCP 与 Skill 联跑 |
| **F22** | 工作流调试与影子实验 / 9 | `shadow.trigger_snapshot`、`shadow.versioned_snapshot`、`shadow.decision_snapshot`、`shadow.historical_trace`、`shadow.isolated_capabilities`、`shadow.counterfactual_evidence`（6，原标 `#571`） | `#643` 已入 `main`；`#531` 含 `#566`/`#571` 与 `f22-trace-replay-host.js`；**除受控回放外其余 shadow 模式未完成** | **zemeng5208**（全部 6 项 + 非回放 shadow 模式） | `2511375597-lab`（F22 入口与回放/影子展示） | 拆入 #571/#566 + 补全非回放 shadow 模式 + 真实非专项任务收益读回 |
| **F23** | 决策配置、评估与版本晋升 / 5 | `evaluation.dataset_snapshot`、`evaluation.temporal_leakage_check`、`evaluation.actual_result_dataset`、`configuration.promote_with_rollback`、`configuration.operation_readback`（5） | `#531` 有 `f23-decision-configuration.js` 与 `evaluation-controller.mjs`；**实测平台评估 4 条全 0 分且镜像缺 `evaluation.*` 代理** | **goo122**（配置消费者与 5 项底座）+ **zemeng5208**（镜像评估代理 + 平台有效评分与版本晋升/回滚） | `2511375597-lab`（goo 确认消费者齐备后注入 `workflowShadowRelease` 与 F23 入口） | 先修平台评估 0 分与镜像评估代理 + 拆入 F23 消费者，再做真实晋升/回滚验收 |
| **F24** | 调度、并发、取消与恢复 / 12 | `runtime.persist_graph`、`policy.operation_scope_check`、`runtime.execute_published_operation`、`runtime.selected_branch_evidence`、`runtime.local_stop_observation`、`runtime.stop_not_started`、`runtime.stop_in_flight`、`runtime.reconcile_original_effect`、`runtime.keep_confirmed_effect`、`runtime.recover_checkpoint`、`runtime.publish_actual_status`（11） | `#531`/`#641` 已有 `F24` writer journal 与恢复 worker，且含 `#543` 云持续宿主与 `#547` 归来 checkpoint；未入 `main` | **goo122**（全部 11 项 Runtime/Policy 口）+ **zemeng5208**（#543 云持续交接与关机续跑） | `2511375597-lab`（F24 入口与总暂停/恢复 UI） | 拆入 S531-G1/G2 恢复与调度口 + 真实重启/取消/未知结果不重放验收 |
| **F25** | 配置、账户、凭据和数据范围 / 4 | `policy.outbound_context_check`、`configuration.save_credential_reference`（2） | `#531`/`#641` 已接主链与 `F25_ORIGINAL_PAYLOAD` 边界；未入 `main` | **goo122**（全部 2 项） | `2511375597-lab`（F25 入口与安全配置/凭据设置页，合入 #673） | 拆入 S531-G3 的 2 项口 + 实测凭据保存/撤销/出站脱敏读回 |
| **F26** | 镜像、部署与比赛验收 / 5 | `deployment.build_arm64_image`、`deployment.runtime_readback`（原标 `#571`）、`deployment.real_tool_evidence`、`deployment.publish_verified_coverage`（4） | `#531` 有 `agentarts-deployment-readback.js`；**线上镜像 `644c7416` 落后 `main`、缺观测代理且 11 绑定 5 项失败** | **zemeng5208**（全部 4 项 + 重发最新 `main` ARM64 镜像 + 轮换 WSS 令牌） | `2511375597-lab`（F26 入口与观测/部署读回展示） | 按 S531-Z1 统一从 `main` 发版并完成 F26 五节点整图 + 真实 Trace/费用读回 |
| **F27** | 上下文预算、压缩与恢复 / 7 | `model.capabilities`、`memory.query`、`model.context_source_map_check`、`runtime.invalidate_context_mapping`（4） | `#664` 已入 `main`；`#531`/`#641` 有 `F27` worker 与侧栏禁止项，但**存在与 `#664` 交织顺序的兼容冲突待适配** | **goo122**（全部 4 项 + 适配 `#664` 交织顺序） | `2511375597-lab`（F27 入口与对话禁止项侧栏） | 适配 `#664` 解决冲突 + 拆入 F27 端口 + 真实长对话压缩/恢复保真验收 |
| **F28** | 多厂商模型、思考深度与主对话分配 / 12 | `model.native_config_check`、`runtime.completion_check`、`workspace.source_and_test_check`、`executor.scoped_tool_loop`（原标 `#571`）（4） | `#655`/`#658` 已入 `main`；`#531` 有 F28 N12 与候选正文查看；**#658 插话 `REVISION_CONFLICT` 待修** | **zemeng5208**（2 项执行/源码检查 + 多模型回放）+ **goo122**（2 项模型/完成口 + 修 #658） | `2511375597-lab`（F28 入口、模型档位与流式/思考展示） | 修 #658 + 拆入 F28 4 项口 + 实测多厂商/思考深度与子任务分配读回 |

---

## 5. 从 0/28 到可运行的四步执行路线

1. **Step 1 — 清仓现成可合并 PR（立刻执行，零额外开发）**：
   - 审并 `#672`、`#673`、`#674`（`2511375597-lab` 前端与 MOD-10）；
   - 审并 `#618`（`Potatos498` 10 项业务/开发 host 端口，直接消除 F06/F07/F08/F09/F11/F16 大部分后端缺口）；
   - 复验并审并 `#645`（`goo122` Windows Job 自包含校验）；
   - `goo122` 将 `#641` base 切回 `main` 并同步最新 `main`。
2. **Step 2 — 解除 `image-workflow-catalog.js` 硬编码 + 优先打通第一批 8 张高价值图**：
   - `2511375597-lab` 修复 `image-workflow-catalog.js`（不再硬编码只认 F15）与 `workflow-graph-composition.js` 动态注册；
   - 第一批优先打通：**F15**（已有入口）、**F17**（仅缺 1 口 + 修 #658 围栏）、**F20**（0 额外 host 缺口，修镜像模板与决策工具）、**F09**（#618 + 修 404 + `enqueue_research`）、**F13**（修 `system_observation` 出站）、**F06 / F07 / F11**（基于 #618 + 修 #26 CalDAV 回归 + #646/#648）。
3. **Step 3 — 统一收敛 `main` 并发布最新 ARM64 镜像（解除镜像双向漂移）**：
   - `zemeng5208` 将 `#531`/`#641` 中的镜像服务端代码与模板收口回 `main`，结合 `#615`、5 项失败绑定修复、`/invocations/f09` 404 修复与观测/评估代理，统一从 `main` 构建发布新版 SWR ARM64 镜像并更新 `Latest`，同步轮换历史泄露 WSS 令牌。
4. **Step 4 — 从 `#641` 分批拆图回主线并收口全量真机/真云/真人验收**：
   - 第二批解锁：**F01 / F03 / F04 / F05 / F08 / F10 / F12 / F14 / F16 / F18 / F19 / F21 / F24 / F25 / F27 / F28**；
   - 第三批解锁：**F02**（真机声学）、**F22**（全 shadow 模式）、**F23**（真实平台评估与晋升）、**F26**（五节点部署闭环）；
   - 每图完成「`main` 注册入口 + 生产后端口 + Desktop 注入 + 真实执行与独立读回 Evidence」后再逐项勾选 152 清单，不批量标 `done`。

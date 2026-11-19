# PersonalAgent 联合验收卡顿项与可用化分工清单（2026-11-19）

> 依据：[卡顿项与分工简报](JOINT_ACCEPTANCE_BLOCKERS_BRIEF_20261119.md) · **[28 图逐图与 PR #531 未完成项分工清单](IMAGE28_AND_PR531_TASK_ASSIGNMENTS_20261119.md)** · [真机与 AgentArts 联合验收报告](JOINT_ACCEPTANCE_REPORT_20261119.md) · 现行分工基线 `docs/MODULE_ASSIGNMENTS.md`（主线 `f33ef383`，2026-10-31 责任分区修订，已恢复四人按模块分工） · `docs/competition/evidence/IMAGE28_COLLABORATOR_OPEN_WORK_20261031.md`（另参考测试机原始记录 `JOINT_CHECKLIST_STATUS_20261112.md` 与 `JOINT_LIVE_PREPARATION_20261111.md`）。
>
> **目标 Profile**：`huawei_ict_agentarts`。本文件将 2026-11-19 联合验收（原清单 27 项 + 新合并 PR 增量 7 组，共 34 项）中尚未“实际能用可用”的卡顿项按现有四人分工拆解为可独立推进、可验收的交付工作包。本文件不改变 `MODULE_ASSIGNMENTS.md` 长期模块归属，不替代技术 CI 与非作者审查，也不把任务计划记作已完成；**MOD-19（第 6、7 项打包与安装）按安排继续暂停**，**MOD-26 社交扩展未选平台继续不自动开工**。

---

## 1. 现行四人责任边界（分工依据）

| 协作者 | 现行责任分区 | 本轮可用化主责重点 | 不越界约束 |
| --- | --- | --- | --- |
| **goo122** | 基础运行时、协议、存储/迁移、Policy/ToolGateway/ConnectorHost（MOD-01～03、04A、05）、本地/远程 MCP（MOD-06）、本地 Skills（MOD-07）、知识库与记忆（MOD-08、09）、MOD-33/36/37 | 修复工具出站围栏失配、插话续传 `REVISION_CONFLICT`、自主来源透传与预算记账、系统观测出站分支、远程 MCP Draft 2020-12 Schema 与跨重启审批规则、隐私物理擦除与偏好出站验证 | 不代做 Desktop Renderer / 设置 UI |
| **2511375597-lab** | **全部前端**（MOD-12/13、`apps/desktop/src/**`）、**全部前端/Desktop 组合接线**（MOD-11 前端/组合、`main.js` 中对话工具/设置 IPC/图 host/活动/看板/简报/用量条件注入、`workspace-controls`）、MOD-10 参赛研究 | 修复云 Skill 选择器重连丢失、简报审批卡跳转 IPC 错配、看板初始化顺序、活动时间线三来源接线、目录排程来源标记与 WSS 记账接线、`#649` 失败卡诊断接线、`#669` 宠物等待授权状态映射、`voice.play` 与唤醒 UI 冲突、配合悬浮球命中与 `IMAGE28` 组合注入 | 只消费公开后端口；不伪造后端/云部署/账号结果 |
| **Potatos498** | MOD-20～25 业务连接器后端口与真实账号读回（待办/日历/邮件/订阅/通知/研究/天气）、MOD-34/35/38 修复与定位链 | 修复主线回归的 `calendar.update` `RESULT_UNKNOWN`、修复日历 `sessionAllowed=false` 与邮件看板会话 scope、补齐 `business_source_adapters` 与 F09 生产宿主/会话授权、核查对话天气 `EXTERNAL_FAILURE` 与 `#649` 行列诊断 | 不代做设置页/对话 UI 组合；不伪造真实账号写回 |
| **zemeng5208** | 核心认知/编排/自治（MOD-04B、27、28 含 `autonomy`/`activity`/`cognition`/`goals`）、AgentArts 云端与自有镜像/部署/评估/观测（MOD-29～32）、语音原生包（MOD-14/15）、Windows 原生设备与受控执行宿主（MOD-11 主进程设备宿主、MOD-16～18） | 对齐 HEAD 重建并发布 ARM64 镜像、修复 5 项失败绑定与 `/invocations/f09` 404、修复平台观测 Trace 匹配与评估 0 分问题、轮换泄露 WSS 令牌、攻克记事本 UIA 身份复核与悬浮球原生点击穿透、补齐 `cloudPersistentHost` 与主动日历/邮件任务绑定、推进语音/唤醒与重点 28 图真机真云闭环 | 不再默认揽回前端 UI 与 Desktop 常规组合接线 |

---

## 2. 具体卡顿项分级总览

按“为什么现在还不可用”归为四类，优先解决 **A 类（明确代码缺陷/回归）** 与 **B/C 类中的核心链路阻塞**。

### A. 明确代码缺陷与主线回归（修完即可立刻解锁功能）

1. **CalDAV 日历修改主线回归 `RESULT_UNKNOWN`（第 26 项，P0）**：外部已写入成功且 `SEQUENCE 0→1`，但 `calendar.update` 顶层 `summary` 存固定成功文案、实际事件标题在 `item`，通用试运行校验比对顶层 `summary` 失配，导致父子任务卡在 `waiting_reconciliation` 且无失配字段诊断。
2. **PR #658 两条续传阻断（P0）**：
   - `workflow.image.catalog` 本机已 `confirmed`，但结果 `source` 被内容围栏包裹，与出站投影重算值不一致，触发 `competition-export-withheld=true` 拒放；
   - 运行中插话消费队列写入 `competition-inject-2` 并进入第 2 步后，下一轮续传报 `phase=continuation / protocol_error / REVISION_CONFLICT`，第二次云请求无法发出。
3. **系统观测结果出站拒放（第 3 / 11 项，P0）**：本机 `node:os` 采样成功，但正式 `confirmDeveloperExport` 缺少 `system_observation` 分支，结果被拒出站，父子任务停在 `waiting_reconciliation`。
4. **云 Skill 选择器被 MCP 重连清空（第 15 项，P0）**：连接 MCP 时先调 `stop()` 清空云 Skill 选择器，连接成功与启用本机参考摘要 Skill 均未恢复该端口，子任务 `cloudSkillCatalog()` 直接早退，目录缺 `skill.workspace_reference_summary`；另直接 MCP 单次批准续传后模型重复提出相同读取提案，单次批准终结未收敛。
5. **每日简报「查看审批卡」点击报错（第 21 项，P0）**：按钮放在主面板，`briefing.openDecision` IPC 却只允许管理后台主框架调用；管理后台简报页同时清空了按钮正文，且系统通知点击导航目标与清单不一致。
6. **用量超限门禁漏放自主任务 + WSS 漏记账（第 22 项，P0）**：主动目录排程提交到 `desktop-panel` 会话，账本标为 `origin=user`，绕过按主动前缀/检查点识别的预算门禁；且 WSS 通道缺少 `onCloudRun` 回调，仅 HTTPS 记时长。
7. **个人数据看板装配即报错（第 24 项，P0）**：看板宿主初始化早于 Competition Runtime 创建，改周期即报 `stage=ipc; code=EXTERNAL_FAILURE`；同时日历宿主固定 `sessionAllowed=false`，邮件读取缺正式会话 scope。
8. **主动日历/邮件来源身份绑定错误（第 18 项，P1）**：直接调用业务工具时把会话 ID 当作 taskId / runId / 授权标识，不符合生产工具的原任务绑定；目录触发后的文件读取亦被 Policy 拒放。
9. **活动时间线三大来源未接线（第 20 项，P1）**：仅接入了插件目录事件；#630 风险档、#631 主动目录、#633 失败自愈均未接 `openDesktopActivity` 与补偿执行器，导致真实触发事件在活动页零记录。
10. **远程 MCP Schema 编译阻塞与待批退出门禁（第 27 项，P1）**：生产验证器 `validateToolValue`（AJV）未加载 JSON Schema Draft 2020-12，导致 Cloudflare / OpenAI / Wikimedia / Context7 等主流公开 MCP 均无法编译 Schema；有效审批期内正常退出被 `EBUSY` 阻断，跨重启审批规则待定。
11. **Node 语法诊断未接入正式失败卡（#649，P1）**：命令 `stderr` 留在工具结果中，浮动对话定位按钮只读 `task.error.message`，失败卡与命令诊断断链；诊断缺列号且云端未稳定提出 `workspace.node_check`。
12. **桌面宠物等待授权状态漏投影（#669，P1）**：子任务等待审批期间，悬浮球仅绑定运行中的父任务并保持显示「执行中」，未聚合展示「等待授权」。

### B. Windows 原生宿主、交互与语音设备硬卡顿

13. **MOD-16 记事本目标复核失败与无障碍确认缺失（第 1、2 项，P0）**：全权限脚本 6 次观察仍以 `MetadataRejected` + `IdentityChanged` 拒放且无具体失败约束日志；正式桌面仅提供物理 F9 确认，通用电脑操作确认按钮不消费 Notepad 确认。
14. **MOD-11 悬浮球核心点击穿透与拖拽失败（第 4 项，P0）**：2560×1600 单屏 150%/125%/100% 缩放下球心点击全部点穿到下层窗口，150% 拖拽目标核对返回另一 Electron 窗口被拒且合成画面未观察到球体像素。
15. **语音与唤醒整链不可用（第 8、9 项 + #642/#650，P1）**：
    - 隔离环境缺 SIS 与原生 Live 有效配置；
    - 正式桌面把 SIS 固定为听写草稿模式，**界面没有 `voice.play` 调用方**；
    - Windows `zh-CN` 本机唤醒被强绑在 SIS 就绪条件之后；
    - 默认「直到关闭应用」（8h）高于麦克风宿主 120 分钟许可上限；面板隐藏处理会请求停止，与 UI「收起后不关闭」文案冲突。

### C. AgentArts 云端部署漂移、平台观测/评估与云持续卡顿

16. **AgentArts 镜像落后主线与云端绑定/前缀/评估全链阻塞（第 13、14、16 项，P0）**：
    - 线上 `Latest → v4` 仍为 11-05 镜像 `f26-644c7416`，落后最新主线 `f33ef383`；
    - 11 项绑定中 5 项失败（`plan`/`controller_repair` 报 `EXTERNAL_FAILURE`，`review_1`/`router`/`controller_router` 修复候选不达标）+ 1 项未发；
    - `/invocations/f09` 返回 HTTP 404，线上 F10/F20 模板能力名已漂移，F20_N01 报受信 Runtime 未公布本机决策工具；
    - 平台观测与评估的镜像内代理未装配（`observation.reader`、`evaluation.*` 均 `unavailable`）；`packages/agentarts/src/observability/index.mjs` 要求 `requestId === traceId` 导致真实华为云 Trace 必报 `mismatch`；
    - 平台离线评估 4 条全 0 分（评测集列 `output` vs 评估器 `actual_output` 映射未生效）；评估调用配置 `x-pa-deadline` 与会话头槽位冲突未解；费用中心无按请求关联字段；历史泄露 WSS 令牌仍待轮换。
17. **CW-05 关机后云持续不可用（第 12 项，P1）**：缺 `business_source_adapters` 与主进程 `cloudPersistentHost` 生产端口注入。
18. **28 图工作流 0/28 可用（#671，P1）**：185 节点 / 152 适配器均停留在设计目录与不可用提示，需按优先级分批打通高频业务图与产品独立观测。

### D. 缺真实闭环验收 / 边界复验项（代码主体已通，缺真实场景收口）

- 第 5 项（MOD-18 复杂真实工作区与内容围栏/拒绝路径联合证据）、第 10 项（MOD-27 隐私物理擦除真人授权与图谱断链）、第 17 项（PR #630 可补偿中风险通知点击与补偿读回）、第 19 项（PR #633 可重试只读失败、高风险失败卡与父重规划）、第 23 项（PR #637 托盘触发暂停与待对账恢复）、第 25 项（PR #639 最小权限正例与符号链接边界）、#657（偏好注入与撤回的真实模型出站读回）。
- **明确暂停项**：第 6、7 项（MOD-19 打包后 SQLite、安装/覆盖升级/卸载）。

---

## 3. 分协作者任务清单（可直接认领开分支）

> 协作原则：每个任务包由**唯一主责人**负责“实现/修复 → 公开契约或调用方接线 → 定向回归测试 → 真机/真云复验或明确交接证据”。跨人依赖在「协同与依赖」列明确标出，先按公开契约/Fake 独立推进，不因等待他人 PR 而停工。

### 3.1 `goo122`（基础运行时、Policy/出站、MCP/Skills、记忆底座）

| 任务包 | 对应报告项 | 优先级 | 涉及模块 / 文件线索 | 具体改造内容 | 协同与依赖 | 验收 / 完成标准 |
| --- | --- | --- | --- | --- | --- | --- |
| **G-01** | **#658**（工具出站围栏失配 + 插话 `REVISION_CONFLICT`） | **P0** | `apps/runtime/src/application/`、出站投影与内容围栏模块 | 1. 核对并修正工具结果内容围栏包裹时机与出站投影重算顺序，使 `workflow.image.catalog` 等受信只读工具的 `source` 校验一致，不误触发 `competition-export-withheld`；拆分出站预检/投影/JSON 校验错误诊断，定位具体拒因。<br>2. 定位运行中插话消费队列写入 `competition-inject-2` 后第 2 步续传报 `phase=continuation / REVISION_CONFLICT` 的比较点，修正续传上下文修订绑定并补回归测试。 | 与 **zemeng5208** 对齐协调循环修订契约；修复后 **2511375597-lab** 复验前端展示 | 1. F17 `workflow.image.catalog` 工具 `confirmed` 后正常投影出站并完成第 2 轮续传。<br>2. 同一助手任务插话后发出第 2 次 HTTPS 请求、匹配 AgentArts Trace、答复实际采用插话内容。 |
| **G-02** | **#03 / #11**（系统观测结果出站门控） | **P0** | `apps/runtime/src/application/`、`confirmDeveloperExport`、Policy 出站策略 | 为 `confirmDeveloperExport`（或对应生产出站门控）接入 `system_observation` 分支，严格绑定原任务授权、只读观测范围与允许投影字段，拒绝未授权或超范围内容，保留 `conditional` 证据级别。 | 与 **zemeng5208** 对齐 `system_observation` 投影字段规范 | 正式 Desktop 经 WSS 派发 `computer.system.observe` 后，本机采样与云端续传在同一请求链闭环，父子任务 `succeeded`，无 `competition-export-withheld`。 |
| **G-03** | **#22**（自主任务来源透传与 token 记账） | **P0** | `apps/runtime` 排程/任务提交与预算账本、`packages/models` | 1. 从可信排程/主动触发事件透传不可伪造的 `origin`（如 `autonomous` / `proactive`）到任务派发与用量账本，不再仅依赖会话 ID 前缀推断。<br>2. 补齐 ModelGateway 独立 token 计量入账端口，与时长估算分字段落账。 | **2511375597-lab** 同步在 Desktop 组合层修正目录排程传参与 WSS `onCloudRun` 回调 | 同一超限日限条件下：手动任务仍可执行并通知；真实目录排程自主任务被门禁拦在云调用之前（零新增云请求），重启后明细一致。 |
| **G-04** | **#27**（远程 MCP Draft 2020-12 Schema & 跨重启审批规则） | **P1** | `packages/mcp`、`packages/contracts`（`validateToolValue` / AJV）、`apps/runtime` | 1. 为生产验证器加载 JSON Schema Draft 2020-12 元 Schema（保留严格白名单与目录绑定，不放宽安全校验），使 Cloudflare/OpenAI/Context7 等标准远端工具 Schema 可正常编译校验。<br>2. 明确并实现“有效待批任务遇正常退出/重启”的 Runtime 规则（要么持久化安全挂起并在新会话强校验 nonce/有效期后拒绝旧审批，要么明确产品退出前处置协议并同步测试）。<br>3. 配合可审计 HTTPS MCP 测试服务补齐服务端 `tools/call` 独立计数读回。 | **2511375597-lab** 同步更新远程 MCP 管理页与退出提示文案 | 1. Draft 2020-12 远端 MCP 预检与单次只读闭环通过，零误放行。<br>2. 有效审批跨重启行为与规则文档、SQLite、退出码完全一致，无未预期 `EBUSY` 卡死。 |
| **G-05** | **#10 / #657**（隐私物理擦除 & 偏好出站验证） | **P1** | `packages/memory`、`apps/runtime` 记忆/偏好上下文注入 | 1. 对可处置公开样本跑通 `memory.erase` 物理擦除路径，提供 `physicalErasure` 核对脚本/证据，确保重启后历史版本与索引彻底清除且零残留。<br>2. 补齐偏好（#657）进入真实模型出站上下文及撤回后立即停止注入的自动化与真云读回验证。 | **zemeng5208** 配合 MOD-27 图谱版本断链（`erasedGraphRevisions`）核对；物理擦除需现场授权 | 1. 现场授权后 `physicalErasure` 与图谱断链读回一致，重启后查无记录。<br>2. 偏好启用时出站可见、撤回后出站零注入。 |
| **G-06** | **#14 / #26 / #671**（公共底座后端口协同） | **P1** | `apps/runtime`、`packages/tool-gateway`、`packages/knowledge` | 1. 核查 ToolGateway / 试运行通用校验器与 `calendar.update` 等工具输出结构的契约，确保校验器记录具体失配字段而非笼统 `RESULT_UNKNOWN`。<br>2. 交付 F09 所需 `runtime.enqueue_research` 生产宿主口及 `IMAGE28` 清单中归属 goo122 的优先底座口（F03/F04/F05 `knowledge.search`/`MemoryQuery` Gateway `invoke*`、F10 底座、F16/F17）。 | 与 **Potatos498** 联调 #26 与 F09；口齐后交 **2511375597-lab** 注入 Desktop | 工具校验失配有精确字段诊断；已交付底座口具备真实宿主测试与非 Fake Evidence。 |

---

### 3.2 `2511375597-lab`（全部前端 UI、Desktop 组合与 IPC 接线、MOD-10）

| 任务包 | 对应报告项 | 优先级 | 涉及模块 / 文件线索 | 具体改造内容 | 协同与依赖 | 验收 / 完成标准 |
| --- | --- | --- | --- | --- | --- | --- |
| **L-01** | **#15**（云 Skill 选择器重连生命周期修复） | **P0** | `apps/desktop/electron/main.js`（MCP 连接/重连与 Skill 装配路径） | 修复连接 MCP 时调用 `stop()` 清空云 Skill 选择器且未恢复的缺陷：在 MCP 连接成功、重连以及本机参考摘要 Skill 启用时正确重建/恢复云 Skill 选择器端口，确保子任务 `cloudSkillCatalog()` 能公布 `skill.workspace_reference_summary`。 | **goo122** 复核 MCP/Skill 宿主端口契约；**zemeng5208** 联合复验云端 Skill 续传 | 连接 stdio MCP 并启用参考摘要后，云端任务目录稳定读回 `skill.workspace_reference_summary`，完成原生选源、单次授权、读取与续传闭环。 |
| **L-02** | **#21**（每日简报审批卡跳转与通知导航统一） | **P0** | `apps/desktop/electron/`（`briefing.openDecision` IPC）、`apps/desktop/src/`（主面板简报、管理后台简报与审批卡焦点） | 1. 统一「查看审批卡」的入口与受信 IPC 校验（允许受控主面板/管理后台合法调用，或统一路由到约定窗口并保留原按钮正文），消除主面板点击报错。<br>2. 修复 `approvalFocus` 精确定位到原 `taskId` / `approvalId` 审批卡。<br>3. 对齐 Windows 系统通知点击后的窗口展开与导航目标。 | **Potatos498** 核对通知 `clickedAt` / ack 账本记录 | 同一真实待审批简报任务：点击简报内按钮及系统通知均能无报错精准定位原审批卡，`clickedAt` 与原卡 ID 一致。 |
| **L-03** | **#24**（个人数据看板装配顺序与 UI/IPC 修复） | **P0** | `apps/desktop/electron/main.js`（看板宿主与 Competition Runtime 初始化顺序）、看板设置与展示 UI | 1. 调整主进程装配顺序，确保看板宿主在 Competition Runtime 就绪后绑定或支持延迟重绑，消除 `available=false` 及切周期报 `stage=ipc; code=EXTERNAL_FAILURE`。<br>2. 在 Potatos498 交付日历/邮件正式会话授权口后，接通周期保存、真实排程触发、合计展示与撤销停止 UX。 | 依赖 **Potatos498（P-02）** 解除日历 `sessionAllowed=false` 与邮件会话 scope；装配顺序可先独立修复并验证周期保存 | 切换「每周 ↔ 每天」保存成功无报错，重启后保持新周期，SQLite 落盘真实看板排程与汇总检查点；接入专用日历/邮箱后显示正确合计。 |
| **L-04** | **#22**（Desktop 自主任务来源标记与 WSS 用量记账接线） | **P0** | `apps/desktop/electron/`（目录排程提交、WSS 传输包装器、用量设置页） | 1. 修正主动目录排程提交任务时的来源标记，不再沿用 `desktop-panel` 用户会话覆盖自主来源。<br>2. 为 WSS 配置补齐 `onCloudRun` 记账回调，使 WSS 与 HTTPS 均写入时长账本并受统一预算门禁约束。 | 配合 **goo122（G-03）** 的 Runtime 来源透传与 token 计量 | 超限状态下目录排程自主任务零云调用；WSS 正常任务在 `usage-budget.json` 准确记账且跨重启一致。 |
| **L-05** | **#20**（活动时间线三大来源接线） | **P1** | `apps/desktop/electron/`（`openDesktopActivity` 启动装配）、管理后台「活动」页 | 按 `docs/modules/CW-05-ACTIVITY-TIMELINE.md` 对接规范，在主进程将以下三路回调接入 `activity-ledger.jsonl` 并注册对应补偿执行器：<br>- #630 `fromAutonomyAudit`（`rollback === 'available'` 接入 `revert`）；<br>- #631 `fromProactiveOutcome`（不传 `summary` 正文）；<br>- #633 `fromRepairDecision`（接入 `stop_retry`，不传 `message`）。 | 依赖 **zemeng5208** 确认三路事件字段与补偿接口就绪 | 真实主动目录、风险档自动执行、失败修复三类事件均出现在活动页与 JSONL 账本，可展开原因、执行补偿撤销并跨重启保留。 |
| **L-06** | **#649 / #669 / #666**（失败卡诊断、宠物审批态与天气异常渲染） | **P1** | `apps/desktop/src/features/conversation/`、`apps/desktop/src/features/orb/`、天气卡片组件 | 1. **#649**：打通正式失败卡与浮动对话定位按钮到可信命令工具诊断结果（不再只读 `task.error.message`），支持按文件/行号/列号跳转。<br>2. **#669**：修改悬浮球/桌面宠物任务状态聚合映射，当父任务运行且存在 `waiting_approval` 子任务时显示「等待授权」标签与动效；补物理系统减少动效开关复验。<br>3. **#666**：补天气错误文本包含特殊字符的纯文本安全渲染验证（无活动 HTML 注入）。 | **Potatos498（P-05）** 确认 `test-locate` 行列输出；**zemeng5208** 确认 `workspace.node_check` 工具结果投影 | 1. 正式任务触发语法错后，失败卡展示诊断并准确跳转第 3 行（有列号则对列号）。<br>2. 子任务待批期间悬浮球自动切换「等待授权」。<br>3. 特殊字符错误文本安全渲染。 |
| **L-07** | **#08 / #09 / #642 / #650**（语音播放调用方与唤醒设置修正） | **P1** | `apps/desktop/src/` 语音面板与设置页、`apps/desktop/electron/` 语音宿主装配 | 1. 在对话/语音界面接入 `voice.play` 正式调用方（支持播报、队列与打断），解除 SIS/Live 仅有草稿无播报消费方的问题。<br>2. 修复唤醒设置默认时长选项（对齐麦克风 120 分钟许可上限或提供明确分段续期策略），并统一「隐藏面板时唤醒行为」与界面提示文案。<br>3. 明确 `#642` 快照中 `configured` 字段恒为明确布尔值；在 **zemeng5208** 解耦本机唤醒后调整唤醒宿主启用条件。 | 与 **zemeng5208（Z-07）** 紧密配合，UI/IPC 归 lab，原生声学/麦克风宿主归 zemeng | 语音设置无时长/文案冲突；SIS/Live 配置就绪后界面可实际触发播报、打断并正确反映 `configured` 状态。 |
| **L-08** | **#01 / #04 / #12 / #17 / #19 / #23 / #671**（桌面交互与组合接线协同） | **P1** | `apps/desktop/electron/main.js`、`apps/desktop/src/`、`workflow-graph-composition` | 1. **#04**：配合 zemeng5208 排查悬浮球 150% DPI 合成不可见像素与 Renderer 命中区边界。<br>2. **#12**：在 zemeng5208 交付 `cloudPersistentHost`、Potatos498 交付来源适配器后，注入主进程组合并更新值守页状态。<br>3. **#17 / #19 / #23**：验证中风险通知点击补偿、高风险失败卡/重试放弃交互、系统托盘总暂停与面板同步。<br>4. **#671**：按三人新交付的后端口，分批将齐备的重点业务图注入 `workflow-graph-composition` 并实测观测设置页 AK/SK 表单。<br>5. **#01**：若产品决定提供受信无障碍确认入口，实现绑定 task/text/window 的对话确认卡。 | 按对应后端口就绪节奏分批合入，严格执行 fail-closed，缺口保持 `unavailable` | 相关 Desktop smoke（`test:smoke`、`test:workspace-smoke`、`test:runtime-application-smoke`）全绿，并取得对应真机复验回执。 |
| **L-09** | **MOD-10**（参赛研究同步更新） | **P2** | `docs/research/agentarts/`、`docs/research/model-training/` | 同步记录 2026-11-19 实测暴露的 AgentArts 评估器列映射、调用头槽位与账单关联限制，为比赛材料与平台评估方案提供证据支撑。 | 与 **zemeng5208（Z-03）** 共享平台实测数据 | 文档口径与实测证据完全一致，无夸大。 |

---

### 3.3 `Potatos498`（MOD-20～25 业务连接器后端口、真实来源与测试定位）

| 任务包 | 对应报告项 | 优先级 | 涉及模块 / 文件线索 | 具体改造内容 | 协同与依赖 | 验收 / 完成标准 |
| --- | --- | --- | --- | --- | --- | --- |
| **P-01** | **#26**（修复主线 CalDAV 修改 `RESULT_UNKNOWN` 回归） | **P0** | `packages/connectors/calendar/`、`calendar.update` 输出投影与校验适配 | 1. 解决 `calendar.update` 顶层 `summary` 存固定成功文案与 `item` 存实际事件标题的同名冲突，将结果校验精确绑定到原 UID、请求摘要及 `item` 中的实际事件字段。<br>2. 补齐受限模式与全权限模式的回归测试，确保外部写入后 Runtime 准确确认结果并推进续传。 | 与 **goo122（G-06）** 核对试运行通用校验器字段匹配逻辑 | 在主线最新代码 + 回环 Radicale 新集合上，受限模式与全权限模式均通过：`calendar.update` 为 `confirmed`，独立 GET 验证强 ETag 变更及 `SEQUENCE +1`，父子任务 `succeeded`。 |
| **P-02** | **#24**（日历/邮件看板真实来源授权口） | **P0** | `packages/connectors/calendar/`、`packages/connectors/mail/`、看板来源宿主适配 | 1. 移除/修复日历宿主中固定 `sessionAllowed = false` 的硬编码限制，改走正式可信连接器会话授权检查。<br>2. 为邮件看板读取补齐正式会话 scope 与受限只读投影（仅汇总元数据，不泄露正文/密钥）。<br>3. 使用专用隔离 Radicale 与测试邮箱完成真实汇总、独立合计和撤销后停读验证。 | 交付公开后端口后交 **2511375597-lab（L-03）** 接通 Desktop 看板装配与 UI | 真实日历与邮箱在授权后完成周期汇总且独立合计一致；撤销授权后下一周期零读取。 |
| **P-03** | **#12 / #18**（主动来源与云持续所需业务来源适配器） | **P1** | `packages/connectors/{calendar,mail,feeds}/`、`business_source_adapters` | 1. 交付 CW-05 所需的 `business_source_adapters` 生产实现（优先覆盖日历/邮件/订阅公开受控来源），消除 `missing=[business_source_adapters]`。<br>2. 配合 #18 主动日历与邮件触发链路，确保 `calendar.events` / `mail.inbox` 经正式任务/连接器会话绑定可读回新会议、改期、会前窗口与新信头。 | 配合 **zemeng5208（Z-08）** 与 **2511375597-lab（L-08）** 联调 | 1. CW-05 状态不再报缺 `business_source_adapters`。<br>2. 专用日历事件与测试邮箱真实触发根任务，且高风险改期先问、静默与关闭均生效。 |
| **P-04** | **#14**（F09 订阅生产宿主与会话租约） | **P1** | `packages/connectors/feeds/`、MOD-22 宿主接线 | 补齐 F09 模板所需的 `feeds.validate_and_deduplicate` 生产宿主读回，落实 `feed-source-grant` 会话授权绑定与持久游标，配合云端 F09 四节点联跑。 | 与 **zemeng5208（Z-02）** 联跑云端 `/invocations/f09`，与 **goo122（G-06）** 对接 `runtime.enqueue_research` | 同一来源会话绑定 `feed-source-grant`，真源增量去重并实际驱动 F09 四节点与 F10 入队。 |
| **P-05** | **#19 / #649 / #666**（天气异常归因、错误码分类与 Node 列号定位） | **P1** | `packages/connectors/weather/`、`packages/coding-tools/src/test-locate/` | 1. **#666**：排查 11-18 对话 1017 路径调用 `weather.forecast` 返回 `EXTERNAL_FAILURE` 的原因（对比 11-19 卡片直调青岛成功路径），规范失败错误返回以支持安全展示。<br>2. **#19**：核对日历/天气/订阅连接器的瞬时超时/限流错误码（区分可重试瞬时错与不可恢复 `EXTERNAL_FAILURE`），支撑 #633 真实可重试只读失败路径。<br>3. **#649**：核对 `locateTestFailures` 对 Node `--check` stderr 的解析，尽可能提取或明确声明列号字段规范，供失败卡跳转消费。 | 配合 **2511375597-lab（L-06）** 与 **zemeng5208（Z-09）** | 对话路径与卡片路径天气查询稳定通过；可重试瞬时错误可触发 #633 重试闭环；Node 诊断结构化输出稳定。 |
| **P-06** | **#21 / #671**（通知点击回执核对 & IMAGE28 业务后端口） | **P2** | `packages/notifications/`、`packages/productivity/`、`packages/connectors/{mail,calendar}/` | 1. 核对 MOD-23 通知账本的真实点击 `clickedAt` / ack 持久化与去重。<br>2. 按 `IMAGE28` 待办清单补齐高频图业务后端口：F06 `invokeTodoCreate`、F07 日历版本口与写读回、F08 真归档/真 SMTP 发送与 Sent 对账、F12 N04 投递读回。 | 口齐后交 **2511375597-lab** 做 Desktop 注入 | 对应业务后端口通过消费测试并产出非 Fake 真实来源读回证据。 |

---

### 3.4 `zemeng5208`（AgentArts 云端/部署/观测/评估、核心认知/自治、Windows 原生与语音）

| 任务包 | 对应报告项 | 优先级 | 涉及模块 / 文件线索 | 具体改造内容 | 协同与依赖 | 验收 / 完成标准 |
| --- | --- | --- | --- | --- | --- | --- |
| **Z-01** | **#13**（对齐最新主线重发 ARM64 镜像、修复 5 项失败绑定 & 轮换 WSS 令牌） | **P0** | `apps/agentarts-runtime/`、`packages/agentarts/`、`scripts/agentarts/release-owned-image.ps1` | 1. 定位并修复 11 项绑定中失败的 5 项：`plan`/`controller_repair`（`EXTERNAL_FAILURE` 根因）与 `review_1`/`router`/`controller_router`（`EXPECTED_REPAIR_CANDIDATE` 业务候选达标），顺带解锁跳过的 `review`。<br>2. 对齐 F10/F20 线上模板能力名与主线一致（含 F20_N03 工具契约），补齐 F20 worker 信任闭环与本机决策工具公布。<br>3. 基于最新主线构建 ARM64 镜像、推送 SWR、更新 AgentArts 固定版本与 `Latest` 指向，记录源码 SHA + ARM64 摘要 + 版本号。<br>4. 安全轮换历史泄露的 WSS 令牌（兼顾旧检查点/回执验证兼容性）。 | F20 信任闭环齐备后通知 **2511375597-lab** 注入 `ownedWorkflowWorker` | 1. 云端 `Latest` 源码 SHA 与本机 HEAD 一致。<br>2. 11 项绑定全部通过并匹配平台 Trace。<br>3. F20 四节点真实联跑闭环；旧泄露令牌失效。 |
| **Z-02** | **#14**（修复 `/invocations/f09` 404 与 F09 云端联跑） | **P0** | `apps/agentarts-runtime/` 路由/网关配置、`packages/agentarts/` | 1. 定位并修复 AgentArts 部署下 `/invocations/f09` 返回 HTTP 404 的路由/前缀配置问题，随新版本镜像一并发布验证。<br>2. 联合 Potatos498/goo122 验证 `feed-source-grant` 会话租约、F09 四节点执行与实际 F10 入队。 | 依赖 **Potatos498（P-04）** 与 **goo122（G-06）** 提供本地生产宿主口 | `/invocations/f09` 返回 HTTP 200，完成真实公开源 F09 四节点运行、F10 入队及平台 Trace 读回。 |
| **Z-03** | **#16 / #671**（修复 Trace ID 匹配缺陷、补齐观测/评估代理与平台 0 分排查） | **P0** | `packages/agentarts/src/observability/index.mjs`、`apps/agentarts-runtime/` 观测/评估代理、AgentArts 平台评估配置 | 1. 修复 `observability/index.mjs` 强制 `requestId === traceId` 才判 `exact_id_match` 的缺陷，改为按真实平台运行时日志/Span 关联键匹配。<br>2. 装配镜像内 `observation.reader` 与 `evaluation.*` 代理，解除 `platformVersion=1` 读回全 `unavailable`。<br>3. 核查并修复平台离线评估 4 条全 0 分问题（验证评测集 `output` 列与评估器 `actual_output` 映射，确保能区分正例与负例对照）；解决评估调用配置 `x-pa-deadline` 与会话头冲突。<br>4. 补齐同输入单工作流对照、可关联请求的计费核对方案及受控环境版本回滚实测。 | **2511375597-lab** 配合观测设置页 AK/SK 实测与 MOD-10 记录 | 1. 产品独立观测不再 `unavailable`，真实请求准确匹配平台 Trace。<br>2. 平台离线评估可区分正例与错误对照。<br>3. 完成受控版本回滚前后调用读回。 |
| **Z-04** | **#01 / #02**（MOD-16 记事本全权限 UIA 复核修复 & 受信确认闭环） | **P0** | `apps/windows-host/`、`packages/windows-client/` | 1. 在 WindowsHost 目标复核链路中补齐细粒度诊断日志，逐项记录新窗口身份、进程信任、前台关联、唯一选中标签、可写 UIA 控件及 `ValuePattern` 的具体判定结果。<br>2. 根治 `MetadataRejected` + `IdentityChanged` 导致 6 次观察全拒的问题，在 Windows 11 现代多标签记事本上跑通官方全权限脚本（单次写入 + 独立 UIA 读回 SHA-256 一致）。<br>3. 明确第 1 项是否新增绑定任务/文本/窗口的受信无障碍确认入口，或完成一次现场 F9 实体确认闭环取证。 | 若新增无障碍确认入口，由 **2511375597-lab（L-08）** 接 UI/IPC | 官方全权限记事本脚本退出码 0，唯一写入与独立 UIA 读回匹配；正式桌面确认闭环通过。 |
| **Z-05** | **#04**（MOD-11 悬浮球原生点击穿透与混合 DPI 修复） | **P0** | `apps/desktop/electron/` 原生悬浮球窗口宿主（`setIgnoreMouseEvents` / 透明命中 / 坐标换算 / 拖拽捕获） | 1. 同步打点原生窗口矩形、物理像素与 DIP 坐标、系统顶层命中窗口与实际收件人，定位 150%/125%/100% 缩放下球心点击全穿及 150% 合成不可见像素的根因。<br>2. 修复透明角穿透与球心可命中/可拖拽的精确区域判定，确保拖拽目标核对命中悬浮球窗口本身。<br>3. 补齐单屏三档复验；具备第二块不同缩放实体屏后补跨屏混合 DPI、边缘抖动与崩溃恢复验收。 | 与 **2511375597-lab（L-08）** 联合核对 Renderer 绘制区域与球心几何 | 单屏 100%/125%/150% 三档下透明角穿透、球心点击与拖拽 100% 命中悬浮球，无点穿。 |
| **Z-06** | **#11 / #15**（MOD-04B 多角色/出站规范与直接 MCP 重复提案收敛） | **P0** | `packages/coordination/`、`packages/agents/`、`packages/agentarts/` 提示与续传协议 | 1. 协同 **goo122（G-02）** 明确 `system_observation` 出站投影规范并复验 WSS 续传。<br>2. 明确普通对话单 `user-work` 何时按需公布 `subagent.dispatch`（对比开发者 Harness 路径）。<br>3. 优化直接 MCP 工具结果续传格式/云端提示词，消除“结果已成功续传但模型仍重复提出完全相同只读提案”的问题，确保单次批准即可正常收束答复。 | 与 **goo122（G-02）**、**2511375597-lab（L-01）** 联调 | 系统观测云续传成功；直接 MCP 单次 `allow_once` 批准后模型直接输出含目标标记的最终答复（零重复提案、零文件写入）。 |
| **Z-07** | **#08 / #09 / #642 / #650**（语音/唤醒解耦与真机声学闭环） | **P1** | `packages/voice/`、`packages/voice-wake/`、原生音频/麦克风宿主 | 1. 解除 Windows 本机 `zh-CN` 唤醒宿主对 SIS 已配置的硬绑定（或提供清晰独立启动条件），解决唤醒不可用问题。<br>2. 统一麦克风许可 120 分钟上限与默认唤醒时长策略，消除 8 小时配置与 120 分钟上限的冲突。<br>3. 在授权 SIS 与原生 Live 真实配置下，完成真云 ASR 听写填草稿、实际扬声器播报（#650）、播放排空防回声与旧通知隔离（#642）、唤醒命中/误触抑制及隐藏/撤销/退出后的物理麦克风释放验证。 | 与 **2511375597-lab（L-07）** 协同完成 `voice.play` UI 与唤醒设置对齐 | 真机获得完整音频设备/云请求/排空防回声/物理释放独立读回证据。 |
| **Z-08** | **#12 / #18**（CW-05 `cloudPersistentHost` & CW-03 主动日历/邮件任务绑定修复） | **P1** | `packages/cognition/`、`packages/agentarts/src/proactive-workflows.ts`、云常驻宿主端口 | 1. **#18**：修复主动日历与邮件触发层把会话 ID 当作 taskId/runId/授权标识的缺陷，改为经正式任务/对话/连接器会话绑定调用公开工具；同时排查目录触发后子任务文件读取被 Policy 拒放的原因，打通内容分析闭环。<br>2. **#12**：交付生产可用的 `cloudPersistentHost` 端口，支持检查点交接给云端常驻宿主，完成“交接检查点 → 断开测试设备 → 云端继续执行 → 归来对账与副作用计数核对”闭环。 | 依赖 **Potatos498（P-03）** 的 `business_source_adapters`；接口就绪后交 **2511375597-lab（L-08）** 注入 Desktop | 1. 主动日历/邮件/目录均跑通真实来源触发与分析。<br>2. CW-05 完成真实离线云续跑（云开始时间晚于断网时间）与归来零重复对账。 |
| **Z-09** | **#05 / #17 / #19 / #25 / #649**（原生沙箱、自治补偿、失败自愈与插件沙箱真机收口） | **P1** | `packages/coding-tools/`、`packages/autonomy/`、`packages/agentarts/`、`packages/plugin-catalog/` | 1. **#05**：排查组合任务中补丁后 `workspace.npm_test` 被内容围栏挡住的触发点，补复杂真实工作区及同任务拒绝场景联合证据。<br>2. **#17**：使用明确可恢复测试变更跑通“中风险执行 → Windows 通知 → 点击 → 补偿任务 → 独立读回”及不可逆动作拒绝。<br>3. **#19**：跑通可恢复只读失败重试、高风险终态失败卡与 `request_parent_replan` 实际派发。<br>4. **#25**：准备声明最小权限的专用测试插件，验证声明内可访问、越界路径/符号链接被拒及高风险启用授权读回。<br>5. **#649**：确认 `workspace.node_check` 工具诊断字段投影与 1017 稳定提案。 | 与 **2511375597-lab（L-05/L-06/L-08）**、**Potatos498（P-05）** 协同 | 五项分别取得带独立 SQLite/文件/系统读回的真机闭环证据。 |
| **Z-10** | **#10 / #23 / #671**（图谱断链、托盘宿主 & 28 图分批解锁统筹） | **P2** | `packages/goals/`、`apps/desktop/electron/` 原生托盘、28 图整图统筹 | 1. **#10**：配合 goo122 验证 `memory.erase` 物理擦除后的图谱版本断链与重查一致。<br>2. **#23**：确认 Windows 托盘图标窗口可观测/可交互并完成托盘总暂停闭环。<br>3. **#671**：按比赛演示优先级（建议先通 F06/F07/F08/F09/F15/F17/F20）统筹四人把 `IMAGE28` 从 0/28 推进到核心图真实可执行并逐节点读回。 | 四人协同推进 | 核心演示业务图真实可执行并具备逐节点与目标读回证据。 |

---

## 4. 建议推进波次与共享文件串行规则

为避免互相等待和多人同时改 `apps/desktop/electron/main.js` 等共享文件产生冲突，建议按三波推进：

### Wave 1：立即并行（零上游阻塞，集中清空回归与单点硬伤）
- **`Potatos498`**：`P-01`（#26 CalDAV 回归）→ `P-02`（#24 日历/邮件看板授权口）
- **`goo122`**：`G-01`（#658 围栏失配 + 插话 `REVISION_CONFLICT`）→ `G-02`（#11 `system_observation` 出站）→ `G-03`（#22 来源透传）
- **`2511375597-lab`**：`L-01`（#15 云 Skill 选择器）→ `L-02`（#21 简报审批跳转）→ `L-03`（#24 看板装配顺序先修）→ `L-04`（#22 排程来源 + WSS 记账）→ `L-06`（#649/#669/#666）
- **`zemeng5208`**：`Z-04`（#02 记事本 UIA 诊断修复）→ `Z-05`（#04 悬浮球点击穿透）→ `Z-01`（修复 5 项失败绑定 + 准备新 ARM64 镜像）→ `Z-03`（`observability/index.mjs` + 评估 0 分排查）

### Wave 2：跨人接线与新镜像统一发布
- **镜像发布窗口（zemeng5208）**：待 `Z-01`、`Z-02`（`/invocations/f09` 404）、`Z-03`（观测/评估代理）与 `Z-06`（MCP 重复提案收敛）就绪后，统一构建发布最新 HEAD ARM64 镜像至 SWR 并切换 AgentArts 版本，同步安全轮换 WSS 令牌。
- **Desktop 组合注入窗口（2511375597-lab 串行收口 `main.js`）**：按序合入 `L-05`（#20 活动三来源接线）、`L-03` 后半段（对接 `P-02` 真实日历/邮件看板）、`L-07`（对接 `Z-07` 语音播放与唤醒解耦）、`L-08`（对接 `P-03`/`Z-08` 的 CW-05 宿主与适配器）。
- **底座与业务扩展**：`goo122` 推进 `G-04`（Draft 2020-12 远程 MCP 与跨重启规则）与 `G-06`；`Potatos498` 推进 `P-03`/`P-04`/`P-05`；`zemeng5208` 推进 `Z-07`/`Z-08`/`Z-09`。

### Wave 3：真机 / 真云 / 真实账号联合复验与重点 28 图收口
- 按原报告每项「复验条件」逐项产出同一任务/请求/版本关联的独立 SQLite、目标端与平台 Trace 回执；
- 在有真实账号/授权环境条件下完成 #01（F9/无障碍确认）、#08/#09/#642/#650（真云 SIS/Live 声学）、#10（真人授权物理擦除）、#12（断网云持续）、#16（平台有效评分与受控回滚）及重点业务图（#671）验收。

### 共享热点文件协调约定
- `apps/desktop/electron/main.js` 与 `apps/desktop/src/**`：由 **`2511375597-lab`** 统一串行合入组合接线，其余三人以公开 `exports` + 契约测试交付后端口，不并发直接改同一块装配代码。
- `apps/runtime/src/application/` 与 `packages/contracts/`：由 **`goo122`** 把关状态机、修订与 Schema 兼容，跨模块小改动须附消费方测试与兼容说明。
- `apps/agentarts-runtime/` 与云端版本切换：由 **`zemeng5208`** 统一收敛发版，禁止多个未对齐提交碎片化覆盖 `Latest`。

---

## 5. 验收报告 34 项全量追溯矩阵

| 报告项 | 模块 / PR | 当前状态 | 对应任务包 | 主责人 | 协同方 |
| --- | --- | --- | --- | --- | --- |
| 01 | MOD-16 正式桌面 F9 记事本 | 部分通过 | Z-04 | zemeng5208 | 2511375597-lab |
| 02 | MOD-16 全权限记事本脚本 | 未通过 | Z-04 | zemeng5208 | — |
| 03 | MOD-17 只读系统观测 | 本机通过（出站卡在 11） | G-02 / Z-06 | goo122 | zemeng5208 |
| 04 | MOD-11 悬浮球 DPI 与命中 | 核心未通过 | Z-05 | zemeng5208 | 2511375597-lab |
| 05 | MOD-18 Windows 原生沙箱 | 主路径通过（缺组合边界） | Z-09 | zemeng5208 | goo122 |
| 06 | MOD-19 打包后 SQLite | **暂停** | （暂停） | zemeng5208 | — |
| 07 | MOD-19 安装/升级/卸载 | **暂停** | （暂停） | zemeng5208 | — |
| 08 | MOD-14 华为云 SIS 听写与播放 | 实测不可用 | Z-07 / L-07 | zemeng5208 | 2511375597-lab |
| 09 | MOD-15 / CW-10 唤醒与释放 | 实际唤醒不可用 | Z-07 / L-07 | zemeng5208 | 2511375597-lab |
| 10 | MOD-27 隐私删除 | 拒绝通过（物理擦除未验） | G-05 / Z-10 | goo122 | zemeng5208 |
| 11 | MOD-04B 多 Agent 与续传 | 双角色通过（出站/部署缺） | G-02 / Z-06 / Z-01 | zemeng5208 | goo122 |
| 12 | CW-05 云持续与归来对账 | 实测不可用 | Z-08 / P-03 / L-08 | zemeng5208 | Potatos498、2511375597-lab |
| 13 | MOD-29 HEAD 部署与绑定 | 未通过（5/11 失败 + 镜像旧） | Z-01 | zemeng5208 | 2511375597-lab |
| 14 | F09 订阅云前缀与会话授权 | 专用前缀 404 | Z-02 / P-04 / G-06 | zemeng5208 | Potatos498、goo122、2511375597-lab |
| 15 | MOD-30 MCP、Skill 与目标系统 | 云 Skill 未通过 / 单次未收敛 | L-01 / Z-06 | 2511375597-lab、zemeng5208 | goo122 |
| 16 | MOD-31/32 评分、观测、账单与回滚 | 评分 0 分 / 观测不可用 | Z-03 / L-09 | zemeng5208 | 2511375597-lab |
| 17 | PR #630 风险档与补偿 | 读操作通过（中风险未验） | Z-09 / L-08 | zemeng5208 | 2511375597-lab |
| 18 | PR #631 目录/日历/邮件主动来源 | 目录通过（日历/邮件绑定错） | Z-08 / P-03 | zemeng5208 | Potatos498、goo122 |
| 19 | PR #633 失败重试与回放 | 只读通过（重试/重规划未验） | Z-09 / P-05 / L-08 | zemeng5208 | Potatos498、2511375597-lab |
| 20 | PR #634 活动时间线 | 仅插件通过（三来源缺接线） | L-05 | 2511375597-lab | zemeng5208 |
| 21 | #635 每日简报与审批跳转 | 补跑通过（审批跳转失败） | L-02 | 2511375597-lab | Potatos498 |
| 22 | PR #636 日月用量上限 | 自主超限未拦 + WSS 未记账 | G-03 / L-04 | goo122、2511375597-lab | zemeng5208 |
| 23 | PR #637 总暂停 | 面板与在途取消通过（缺托盘） | L-08 / Z-10 | 2511375597-lab | zemeng5208、goo122 |
| 24 | PR #638 真实日历与邮件看板 | 周期保存报错（不可用） | L-03 / P-02 | 2511375597-lab、Potatos498 | goo122 |
| 25 | PR #639 插件权限与沙箱 | 空权限拒绝通过（缺正例） | Z-09 | zemeng5208 | 2511375597-lab、goo122 |
| 26 | 专用 CalDAV 日历修改 | 主线回归 `RESULT_UNKNOWN` | P-01 / G-06 | Potatos498 | goo122 |
| 27 | 远程 MCP 真实只读 | 单次过（缺 2020-12 / 跨重启） | G-04 | goo122 | 2511375597-lab |
| #642 | 实时语音回声防护 | 播报排空不可执行 | Z-07 / L-07 | zemeng5208 | 2511375597-lab |
| #649 | 正式 Node 语法诊断 | 独立通过（正式失败卡未接） | L-06 / P-05 / Z-09 | 2511375597-lab、Potatos498 | zemeng5208 |
| #650 | 实时语音播报 | 实际播报未验 | Z-07 / L-07 | zemeng5208 | 2511375597-lab |
| #657/#659/#666 | 偏好、默认权限与天气 | 主路径过（出站/异常缺口） | G-05 / P-05 / L-06 | goo122、Potatos498 | 2511375597-lab |
| #658 | 流式回答、独立助手与插话 | 围栏失配 + 插话修订冲突 | G-01 | goo122 | zemeng5208、2511375597-lab |
| #669 | 桌面宠物与任务状态 | 绘制过（子任务审批态漏映射） | L-06 | 2511375597-lab | goo122 |
| #671 | 28 图、观测设置与真实答案 | 目录过（28 图 0/28 可运行与观测不可用） | Z-10 / Z-03 / G-06 / P-06 / L-08 + `S531-*`（详见 [28 图与 #531 分工清单](IMAGE28_AND_PR531_TASK_ASSIGNMENTS_20261119.md)） | zemeng5208（统筹） | 全员按图分工 |

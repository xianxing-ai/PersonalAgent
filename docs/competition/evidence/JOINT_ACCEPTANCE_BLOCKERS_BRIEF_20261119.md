# PersonalAgent 联合验收卡顿项与分工简报（2026-11-19）

> 目标 Profile：`huawei_ict_agentarts` · 主线基线：`f33ef383` · 分工依据：`docs/MODULE_ASSIGNMENTS.md`（已恢复四人按模块分工）
>
> 详细任务包、文件线索、依赖与验收门槛见：[联合验收卡顿项与可用化分工清单](JOINT_ACCEPTANCE_TASK_ASSIGNMENTS_20261119.md) · **28 图逐图与 PR #531 未完成项专项分工见**：[28 图与 PR #531 四人分工清单](IMAGE28_AND_PR531_TASK_ASSIGNMENTS_20261119.md) · 实测依据见：[真机与 AgentArts 联合验收报告](JOINT_ACCEPTANCE_REPORT_20261119.md)。
>
> **状态说明**：本简报与清单对应的 PR 为 **Draft（未完成前禁止合并）**，用于统筹四位协作者将当前模块推进到“实际能用可用”。**MOD-19（第 6、7 项打包与安装）继续暂停**，**MOD-26 社交扩展未选平台继续不自动开工**。

---

## 一、核心卡顿项速览

### 1. 明确代码缺陷与主线回归（P0，修完立刻恢复可用）

1. **#26 CalDAV 修改主线回归 `RESULT_UNKNOWN`**（主责 `Potatos498`，协同 `goo122`）：外部写入已成功且 `SEQUENCE 0→1`，但 `calendar.update` 顶层 `summary` 存固定成功文案、真实标题在 `item`，通用试运行校验比对顶层 `summary` 失配，父子任务卡在 `waiting_reconciliation`。
2. **#658 两条续传阻断**（主责 `goo122`）：① `workflow.image.catalog` 结果 `source` 被内容围栏包裹，与出站投影重算值不一致触发 `competition-export-withheld=true`；② 运行中插话写入 `competition-inject-2` 进入第 2 步后，下一轮续传报 `REVISION_CONFLICT`，第二次云请求发不出。
3. **#03 / #11 系统观测结果出站拒放**（主责 `goo122`、`zemeng5208`）：本机 `node:os` 采样通过，但 `confirmDeveloperExport` 缺少 `system_observation` 分支，结果被拒出站。
4. **#15 云 Skill 选择器被 MCP 重连清空 + 直接 MCP 重复提案**（主责 `2511375597-lab`、`zemeng5208`，协同 `goo122`）：连接 MCP 时 `stop()` 清空云 Skill 选择器且未恢复，子任务目录缺 `skill.workspace_reference_summary`；直接 MCP 单次批准续传后模型仍重复提出相同读取提案。
5. **#21 每日简报审批卡跳转报错**（主责 `2511375597-lab`，协同 `Potatos498`）：「查看审批卡」按钮放在主面板，`briefing.openDecision` IPC 却只放行管理后台主框架；管理后台简报页同时清空了按钮正文。
6. **#22 超限后自主任务漏放 + WSS 漏记账**（主责 `goo122`、`2511375597-lab`）：目录排程落入 `desktop-panel` 会话并标为 `origin=user`，绕过自主任务预算门禁；WSS 缺 `onCloudRun` 回调，仅 HTTPS 写时长账本。
7. **#24 个人数据看板装配即报错**（主责 `2511375597-lab`、`Potatos498`）：看板宿主初始化早于 Competition Runtime 创建，改周期即报 `EXTERNAL_FAILURE`；同时日历宿主固定 `sessionAllowed=false`，邮件读取缺正式会话 scope。
8. **其余 5 处功能断链（P1）**：
   - **#18 主动日历/邮件**：直接调业务工具时把会话 ID 当作 taskId/runId/授权标识，违反生产工具任务绑定（`zemeng5208` + `Potatos498`）；
   - **#20 活动时间线**：仅接了插件事件，#630 风险档 / #631 主动目录 / #633 失败自愈三来源均未接线（`2511375597-lab` + `zemeng5208`）；
   - **#27 远程 MCP**：生产验证器（AJV）未加载 JSON Schema Draft 2020-12，导致 Cloudflare/OpenAI/Wikimedia/Context7 等主流公网 MCP 均无法编译 Schema；有效审批期内正常退出被 `EBUSY` 阻断（`goo122`）；
   - **#649 Node 语法诊断**：命令 `stderr` 留在工具结果中，浮动对话定位按钮只读 `task.error.message`，失败卡与诊断断链（`2511375597-lab` + `Potatos498`）；
   - **#669 桌面宠物**：子任务等待审批期间，悬浮球仍绑定父任务显示「执行中」，未切「等待授权」（`2511375597-lab`）。

### 2. Windows 原生宿主与语音硬卡顿

- **#01 / #02 MOD-16 记事本写入**（`zemeng5208`）：全权限脚本 6 次观察以 `MetadataRejected` + `IdentityChanged` 被拒且无逐项约束日志；桌面端仅支持物理 F9，缺受信无障碍等效确认入口。
- **#04 MOD-11 悬浮球核心点击穿透**（`zemeng5208` 主责、`2511375597-lab` 协同）：150%/125%/100% 三档缩放球心点击全穿到下层窗口，150% 拖拽目标核对失败且合成画面未观察到球体像素。
- **#08 / #09 / #642 / #650 语音与唤醒不可用**（`zemeng5208` + `2511375597-lab`）：缺 SIS/Live 有效配置；界面没有 `voice.play` 调用方；本机 Windows `zh-CN` 唤醒强绑在 SIS 就绪之后；默认「直到关闭应用」（8h）超过麦克风 120 分钟许可上限，且面板隐藏停止行为与提示文案冲突。

### 3. AgentArts 云端部署漂移、观测/评估与云持续卡顿

- **#13 / #14 / #16 云端镜像落后与平台代理缺失**（`zemeng5208`）：
  - 线上 `Latest → v4` 仍为 11-05 镜像 `f26-644c7416`，落后主线 `f33ef383`；
  - 11 项绑定失败 5 项 + 1 项未发，`/invocations/f09` 返回 HTTP 404，F10/F20 模板能力名漂移，F20_N01 报未公布本机决策工具；
  - 镜像内未装配 `observation.reader` 与 `evaluation.*` 代理；`observability/index.mjs` 要求 `requestId === traceId` 导致真实华为云 Trace 必判 `mismatch`；
  - 平台离线评估 4 条全 0 分（评测集 `output` 与评估器 `actual_output` 列映射未生效），评估调用头 `x-pa-deadline` 与会话头槽位冲突，历史泄露 WSS 令牌待轮换。
- **#12 CW-05 云持续不可用**（`zemeng5208` + `Potatos498` + `2511375597-lab`）：缺 `business_source_adapters` 与主进程 `cloudPersistentHost` 生产端口注入。
- **#671 28 图目录 0/28 可用**（四人按 `IMAGE28` 清单分批解锁）：185 节点 / 152 适配器均停留在设计目录与不可用提示。

### 4. 仅缺真实闭环复验项 & 暂停项

- **缺真机/真人复验**：#05（复杂工作区与内容围栏拒绝）、#10（真人现场授权物理擦除 + 图谱断链）、#17（中风险通知点击补偿）、#19（可重试只读失败/高风险失败卡/父重规划）、#23（托盘总暂停与待对账恢复）、#25（声明最小权限正例与符号链接边界）、#657（偏好注入/撤回的真实模型出站读回）。
- **继续暂停**：#06/#07（MOD-19 打包后 SQLite、安装/覆盖升级/卸载）；MOD-26 社交扩展未选平台不自动开工。

---

## 二、四位协作者认领总览与 Wave 1 优先入口

| 协作者 | 任务包范围 | Wave 1 立即并行开工项（无上游阻塞） |
| --- | --- | --- |
| **goo122** | `G-01`～`G-06` + `S531-G1`～`G4` | `G-01`（#658 围栏失配 + 插话 `REVISION_CONFLICT`）→ `G-02`（#11 `system_observation` 出站）→ `G-03`（#22 自主来源透传）→ `#641` base 切回 `main` 与 `#645` 推进 |
| **2511375597-lab** | `L-01`～`L-09` + `S531-L1`～`L2` | `L-01`（#15 云 Skill 选择器）→ `L-02`（#21 简报审批跳转）→ `L-03`（#24 看板装配顺序）→ `L-04`（#22 排程来源 + WSS 记账）→ `S531-L1`（解除 `image-workflow-catalog.js` 单入口硬编码）+ 审并 `#672/#673/#674` |
| **Potatos498** | `P-01`～`P-06` + `S531-P1`～`P2` | `P-01`（#26 CalDAV `RESULT_UNKNOWN` 回归）→ `P-02`（#24 日历 `sessionAllowed` 与邮件看板会话 scope）→ 推动 **#618**（10 项业务/开发 host）合入 `main` 并补生产调用方接线 |
| **zemeng5208** | `Z-01`～`Z-10` + `S531-Z1`～`Z3` | `Z-04`（#02 记事本 UIA 诊断修复）→ `Z-05`（#04 悬浮球点击穿透）→ `S531-Z1` / `Z-01`（收敛镜像漂移 + 5 项失败绑定 + 最新 `main` ARM64 镜像发布 + 轮换 WSS 令牌）→ `Z-03`（Trace 匹配修复 + 评估 0 分排查） |

> **共享文件串行约定**：`apps/desktop/electron/main.js` 与 `apps/desktop/src/**` 组合接线由 `2511375597-lab` 串行收口；`apps/runtime/src/application/` 与 `packages/contracts/` 由 `goo122` 把关兼容；`apps/agentarts-runtime/` 与云端 `Latest` 切换由 `zemeng5208` 统一发版。

---

## 三、28 图 0/28 根因、开放 PR 与 PR #531 未完成项速览

1. **为什么 28 图目前是 0/28 可运行**：
   - `main` 的 `apps/desktop/electron/image-workflow-catalog.js` 仅硬编码声明了 `F15` 入口，其余 27 图无 `conversation_entry`；
   - `origin/main` 的 `graph-capability-gaps.json` 仍有 **92 项能力缺口**（共声明 109 项、主线仅提供 23 项）；
   - 大量已写好的 `f01-*.js`～`f28-*.js` 与 10 项业务 host 仍滞留在未合并的 **#531（CONFLICTING）/ #641（延续基线）/ #618（Potatos498）** 中；
   - 线上最新镜像 `f26-644c7416f5b0e98d`（源码 `644c7416`）出自早期 `#531` 分支，既不是 `main` 祖先也不是 `#531` 当前 head 祖先，与 `main` 存在双向模板/服务端代码漂移（`644c7416` 有 `evaluation-controller.mjs` 和新版 F06/F08/F11，但 F10/F20 模板能力名落后于 `main`）。
2. **开放 PR 优先清仓**：先审并 `#672/#673/#674`（前端/MOD-10）、`#618`（10 项业务/开发 host）与 `#645`（Windows Job 完整性）；`#615` 随新镜像审并，`#614`（破坏性内层鉴权）待平台转发核实后解冻；`#531` 严禁整包硬合，由 `goo122` 将 `#641` base 切回 `main` 后按四人模块拆图回主线。
3. **#531 / #641 剩余未完成项归属**：
   - **`goo122`（`S531-G1`～`G4`）**：`#641` 切回 `main`、#535/#547 控制闸门与无人值守 checkpoint、**F03 CAS 崩溃原子回执恢复**、F01/F04/F05/F10/F16–F19/F21/F23–F25/F27（含适配 `#664` 交织顺序）Runtime 底座切片；
   - **`Potatos498`（`S531-P1`～`P2`）**：合入 `#618` 并补齐 F06/F07（修 `#648` 空窗口账号绑定）/F08（真发送与 UIDPLUS）/F09/F11/F12 真实账号/设备读回与 F16/F19 修复链；
   - **`2511375597-lab`（`S531-L1`～`L2`）**：解除 `image-workflow-catalog.js` 单入口硬编码、分批条件注入 `f01-f28` 到 `workflow-graph-composition.js`、`#531` 补问卡/审核/禁止项/F20 UI 切片；
   - **`zemeng5208`（`S531-Z1`～`Z3`）**：收口镜像双向漂移并从 `main` 发布新版 ARM64 镜像（F26）与轮换泄露凭据、补齐 F22 非回放 shadow 模式与 F23 真实平台评估、合回 `#543` 云持续宿主并完成真关机续跑、完成 F15 独立真人 Ed25519 签名与 WinForms 真机目视、F18/F19 真 GitHub 读回、F20 worker 信任闭环与 F02/F13/F14/MOD-16/MOD-17 真机验收。

> 完整的 F01–F28 逐图分工表与四步解锁路线见 [IMAGE28_AND_PR531_TASK_ASSIGNMENTS_20261119.md](IMAGE28_AND_PR531_TASK_ASSIGNMENTS_20261119.md)。

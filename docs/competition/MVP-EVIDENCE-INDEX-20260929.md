# 华为 ICT 创新赛 AgentArts MVP 比赛证据与交付目录

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- 版本：1.0
- 日期：2026-09-29
- 交付基线：`origin/main`（包含已合入的 PR #206 `ea8e9b8590fd293b4e413f1d64a34977c4598320`）
- 依据标准：[HUAWEI_ICT_AGENTARTS_PROFILE.md](HUAWEI_ICT_AGENTARTS_PROFILE.md)、[MVP_EXECUTION_GOAL.md](MVP_EXECUTION_GOAL.md)、[CURRENT_INTERFACE_CATALOG.md](../interfaces/CURRENT_INTERFACE_CATALOG.md)
- 分工依据：GitHub Issue [#212](https://github.com/zemeng5208/PersonalAgent/issues/212)、Issue [#213](https://github.com/zemeng5208/PersonalAgent/issues/213)
- 整理与维护人：Gemini（代表 zemeng，专注非线上证据目录与演示材料映射）

---

## 1. 协作职责与当前边界声明

按 GitHub Issue #212/#213 当前记录的分工边界：

1. **Potatos498**：当前负责 P0～P4；P5～P8 委派已撤回。业务连接器、语音与通用 Desktop 接线仍按各包边界推进。
2. **zemeng**：统筹 P5、P6、P8 和线上 AgentArts；P5～P7 的新执行者须先登记。云凭据及真实云运行仍需单独授权。
3. **goo122**：负责公共协议兼容及在途 PR #209～#211；P7 剩余工作在明确交接前不转派。
4. **Gemini（代表 zemeng）**：维护证据索引与演示脚本；只把可查证的代码、测试和真实运行记录分别标注，不以提交或 CI 代替外部验收。

---

## 2. 证据可信度分级标准

| 级别 | 定义 | 认定标准 |
| :--- | :--- | :--- |
| **`verified`（真实已验证）** | 在实际目标系统、真实外部 API 或真实硬件设备上完成闭环，具备可重复执行日志或落盘数据 | 具备真实网络请求回执、真实 DPAPI 解密调用、真实进程管道通信或落盘 SQLite 证据；不含 mock 标记 |
| **`provisional` / `mock`（离线/模拟可用）** | 生产代码与端口已就绪，但仅通过 Fake 宿主、离线夹具、单元测试或内存模拟进行了可复现验证 | 具有完整的 TypeScript 类型与实现，在测试套件中通过，但尚未连接真实账号/真实硬件 |
| **`unavailable` / `unverified`（未就绪/未验证）** | 契约存在或部分编码，但未接入生产应用、缺少外部账号/服务支持，或尚未进行真实闭环验证 | UI 显示为不可用；调用返回 `UNSUPPORTED_CAPABILITY`；不得假冒已完成 |

### 2.1 已知证据误用判定与纠正表

为了确保比赛答辩与工程验收的事实真实性，特此澄清并纠正以下历史误用：

1. **关键词匹配 + sleep 延迟 $\neq$ Laya 本地大模型性能**：`FakeLaya` 内部使用规则正则与固定延时进行的测试仅能作为前端管道测试，不能作为本地 Laya SLM 真实吞吐与推理时延的证据。
2. **FakeWindowsHostAdapter $\neq$ 真机 Windows 操控**：内存中虚拟窗口对象与模拟确认不能代表 C# `WindowsHost.Host.exe` 与 Windows UI Automation 的真实执行。
3. **运行时步骤上限 (`maxSteps: 8`) $\neq$ 模型原生 CoT 推理**：应用层循环步数预算属于调度控制，不代表盘古或 AgentArts 原生支持带思维链的思考参数。
4. **本地配置已保存 (`configured: true`) $\neq$ 外部数据已同步 (`synced: true`)**：DPAPI 本地密文落盘仅证明凭据存在，不等于远端日历/邮件已拉取。
5. **云端 HTTP 200 / `taskEnd` $\neq$ 本地任务终态成功**：AgentArts 返回文字或提案仅是云端步骤，本地写入与执行必须经过本地 Policy 授权并产生本地 TaskRuntime 检查点。

---

## 3. 功能交付与真实证据矩阵

### 3.1 文字与桌面交互交付链 (Text & Desktop)

| 约定功能 | 对应实现与关键提交 | 当前证据状态 | 实际证据来源与位置 | 剩余缺口 | 责任人 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Desktop 桌面面板与工作区** | `apps/desktop/src/`、`apps/desktop/electron/main.js`；提交 `717af33`、`9164259`、`ea8e9b8` (#206) | `provisional` | 源码与自动化检查覆盖面板、工作区和历史视图；本索引未附可复现的实机 UI 记录 | 多屏分辨率适配及人工桌面验收 | Potatos498 |
| **AgentArts 文字请求** | `packages/coordination/src/agentarts.ts`、`apps/desktop/electron/main.js`；提交 `ea8e9b8` | `unverified` | 真实部署的 trace 与本地任务读回记录尚未随此索引提供；凭据已配置不代表请求成功 | 经授权完成一次真实请求、trace 核验和本地持久读回 | zemeng（云端）/ goo122（本地） |
| **任务状态与持久执行历史** | Runtime SQLite 与 Desktop 数据路径实现；提交 `ea8e9b8` | `provisional` | Runtime 与 Desktop 自动化测试覆盖持久化及重启读回；不记录个人会话轮数 | 跨版本数据库迁移读回验收 | Potatos498 |
| **AgentArts 凭据管理与撤销** | `apps/desktop/electron/agentarts-config.js`；提交 `37da0c3` | `provisional` | 源码与测试覆盖安全存储接口和撤销状态；此处没有真实凭据读回记录 | 经授权在目标 Windows 系统验证安全存储与撤销 | Potatos498 |

### 3.2 语音与 Live 实时音频交付链 (Voice & Live)

| 约定功能 | 对应实现与关键提交 | 当前证据状态 | 实际证据来源与位置 | 剩余缺口 | 责任人 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SIS 听写转文字 (Dictation)** | `apps/desktop/electron/voice-input.js`；提交 `ea8e9b8` | `provisional` | 自动化测试覆盖录音输入边界；真实 SIS 请求与麦克风读回未在此处提供 | 经授权完成 SIS 请求及实体麦克风验收 | Potatos498 |
| **原生 Live 实时双向语音** | `packages/voice`、`apps/desktop/electron/live-voice-host.js`；提交 `ea8e9b8` | `provisional` | [live-proactive-20260927.md](../../apps/desktop/docs/live-proactive-20260927.md) 与自动化测试覆盖协议、分帧和切换逻辑；本索引未附真实服务或声卡闭环记录 | 经授权验收真实服务、双向音频与打断恢复 | Potatos498 |
| **文字与 Live 共享对话历史** | `apps/desktop/electron/conversations.js`；提交 `ea8e9b8` | `provisional` | 自动化测试覆盖共享会话读写；本索引未附真实 Live 服务的转写记录 | 真实 Live 会话的持久读回 | Potatos498 |

### 3.3 业务能力与连接器交付链 (Connectors)

| 约定功能 | 对应实现与关键提交 | 当前证据状态 | 实际证据来源与位置 | 剩余缺口 | 责任人 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **天气查询 (`weather.forecast`)** | `packages/connectors/weather`、`public-connector-host.js`；提交 `ea8e9b8` | `provisional` | Provider 与自动化测试已在仓库；此索引未附真实 Open-Meteo 请求回执 | 经授权核验真实响应及桌面读回 | Potatos498 |
| **文献检索 (`research.search`)** | `packages/connectors/research`、`public-connector-host.js`；提交 `ea8e9b8` | `provisional` | Provider 与自动化测试已在仓库；此索引未附真实 OpenAlex 请求回执 | 经授权核验真实响应及结果展示 | Potatos498 |
| **待办与提醒 (`todo.*`)** | `packages/productivity`、`todo-host.js`；提交 `ea8e9b8` | `provisional` | [todo-reminders.md](../../apps/desktop/docs/todo-reminders.md) 与自动化测试；本索引未附真实 Windows Toast 读回 | 实机通知及日历关联验收 | Potatos498 |
| **订阅源收集 (`feeds.*`)** | `apps/desktop/electron/feeds-host.js`；提交 `ea8e9b8` | `provisional` | [feeds-settings.md](../../apps/desktop/docs/feeds-settings.md) 与自动化测试；未附真实来源同步记录 | 经授权核验真实订阅源与更新读回 | Potatos498 |
| **邮件处理 (`mail.*`)** | `apps/desktop/electron/mail-config.js`；提交 `ea8e9b8` | `provisional` | [mail-analysis.md](../../apps/desktop/docs/mail-analysis.md)；IMAP 配置与离线邮件提取框架就绪 | 真实企业/个人邮箱（QQ/163/Outlook）在线连接与大批量拉取 | Potatos498 |
| **日历与会议 (Calendar/CalDAV)** | `packages/connectors/calendar`（待扩展） | `unavailable` | 契约存在，但尚无完整生产 CalDAV Provider 实现与在线同步（已在 Issue #212 提出 P1） | 完整实现生产 CalDAV 协议连接器与会议变更通知 | Potatos498 |

### 3.4 编程工具与 Windows 操作交付链 (Coding & Windows Host)

| 约定功能 | 对应实现与关键提交 | 当前证据状态 | 实际证据来源与位置 | 剩余缺口 | 责任人 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **受限工作区补丁操作** | `packages/coding-tools`；提交 `ea8e9b8` | `provisional` | [workspace-command-config.md](../../apps/desktop/docs/workspace-command-config.md) 与自动化测试覆盖检查、预览和应用边界；未附独立实机记录 | 在隔离的真实工作区完成读回验收 | Potatos498 |
| **受限命令执行** | `packages/coding-tools`；提交 `ea8e9b8` | `provisional` | 自动化测试覆盖命令白名单与参数拒绝；未附用户工作区执行记录 | 目标 Windows 环境的受限执行读回 | Potatos498 |
| **Windows Host 记事本操作** | `apps/windows-host`、`apps/desktop/electron/notepad-host.js`；提交 `6264d19`、`ea8e9b8` | `provisional` | [notepad-operation.md](../../apps/desktop/docs/notepad-operation.md) 与离线管道测试；当前尚无真实 UIA 读回证据 | 在具备 .NET 8 的 Windows 上编译并完成隔离实机验收 | zemeng 侧统筹，执行者待登记 |
| **系统状态只读观测** | `packages/windows-client`；提交 `ea8e9b8` | `provisional` | 源码与自动化测试覆盖只读采集边界；未附异构设备的读回记录 | 目标 Windows 设备验收 | zemeng 侧统筹，执行者待登记 |

### 3.5 创新机制与主动认知交付链 (Cognition & Laya)

| 约定功能 | 对应实现与关键提交 | 当前证据状态 | 实际证据来源与位置 | 剩余缺口 | 责任人 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **版本化目标图谱 (Goal Graph)** | `packages/goals`；提交 `ea8e9b8` | `provisional` | CAS、依赖追踪与冲突拒绝由自动化测试覆盖；未附真实比赛流程证据 | 复杂 DAG 展示及目标写回实机读回 | zemeng 侧统筹，执行者待登记 |
| **事实变化流 (Fact Feed)** | `packages/memory`；提交 `ea8e9b8` | `provisional` | SQLite 水位、续传与重放由自动化测试覆盖；未附真实来源同步记录 | 真实来源变更的端到端读回 | goo122（在途记忆工作）；其余 P7 工作待登记 |
| **Laya 主动决策与计划修复** | `packages/cognition`、`apps/desktop/electron/goal-cognition-host.js`；提交 `717af33`、`ea8e9b8` | `provisional` (Fake/离线宿主) / `unverified` (真实 Laya) | [proactive-composition.md](../../apps/desktop/docs/proactive-composition.md) 与自动化测试；未附真实 Laya 推理或恢复读回 | 接通已授权的真实 Laya 服务后完成连续推理与持久恢复验收 | zemeng 侧统筹，执行者待登记 |

### 3.6 产品内多 Agent 分配交付链 (Multi-Agent Dispatch)

| 约定功能 | 对应实现与关键提交 | 当前证据状态 | 实际证据来源与位置 | 剩余缺口 | 责任人 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **次级智能体分派 (`subagent.dispatch`)** | `packages/agents`、`apps/runtime/src/application/subagents.ts`；提交 `890c195`、`717af33`、`ea8e9b8` | `provisional` | Fake/自动化测试覆盖角色分派、预算和结果聚合；真实模型与比赛闭环未验证 | 经授权完成真实模型与用户可见结果读回 | Potatos498 |
| **多 Agent 状态与证据隔离** | `apps/desktop/electron/main.js`；提交 `ea8e9b8` | `provisional` | 架构门禁与自动化测试覆盖投影边界；未附真实子任务流程记录 | 目标运行环境中的状态与证据读回 | Potatos498 |

### 3.7 知识库与记忆管理交付链 (Knowledge & Memory)

| 约定功能 | 对应实现与关键提交 | 当前证据状态 | 实际证据来源与位置 | 剩余缺口 | 责任人 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **本地只读知识库搜索** | `packages/knowledge`、`apps/desktop/src/app/knowledge-controls.js`；提交 `717af33`、`ea8e9b8` | `provisional` | 自动化测试覆盖本地检索与投影限制；未附真实 Obsidian 库的授权读回 | 目标用户目录的只读检索验收 | zemeng 侧统筹，执行者待登记 |
| **私人记忆控制器与擦除** | `packages/memory`；在途 PR #209～#211 | `provisional` (分支实现) / `unverified` (生产 UI 与真实来源) | 部分受信 Runtime 擦除能力已并入 main；私人控制器仍在 PR 中，真实来源与完整 UI 不可据此宣称可用 | 完成评审合并后，再做授权来源、UI 与恢复读回验收 | goo122（在途范围）；交接后由 P7 登记执行者承接 |

### 3.8 华为云 AgentArts 比赛主链路 (Competition Profile)

| 约定功能 | 对应实现与关键提交 | 当前证据状态 | 实际证据来源与位置 | 剩余缺口 | 责任人 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **AgentArts 云端构建与编排** | 华为云 AgentArts 控制台；MOD-30 Workflow | `unverified` | 本索引未附可核验的部署版本、trace、工具闭环或评估读回；配置状态不等于已发布或可运行 | 按授权完成部署版本、trace、工具闭环和评估读回 | zemeng |
| **本地 Coordination 协议交互** | `packages/coordination`；提交 `ea8e9b8` | `provisional` | Fake/自动化测试覆盖安全信封与诊断解析；云端多轮工具闭环尚无 trace 证据 | 单独核验真实云端 trace 与本地任务结果 | goo122（本地协议）/ zemeng（云端） |

---

## 4. 交付总结与各方交接建议

1. **Potatos498**：按 Issue #212 负责 P0～P4；日历、Desktop、语音与多 Agent 的真实验收按各自证据行推进。P5～P8 不属于当前委派。
2. **zemeng**：统筹 P5、P6、P8 及线上 AgentArts。日历、Windows、Laya 等真实设备或服务结果在取得授权并完成读回前保持未验证。
3. **goo122**：继续收尾明确登记的 #209～#211 私人记忆在途范围；其他 P7 工作须在交接后登记执行者。
4. **Gemini（代表 zemeng）**：更新索引前逐条附上可复现来源；状态变化后重新核对 main、CI、真实运行记录与责任人。

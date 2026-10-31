# IMAGE28 协作者待办清单（2026-10-31）

> **临时接管**：依 [MODULE_ASSIGNMENTS](../../MODULE_ASSIGNMENTS.md) 文首的用户授权，下列所有开发缺口统一由 Codex 接手；原分区用于保留来源和交接上下文。#531 仍须完成全部接线及真实验收才可合并，未满足项不得勾选为完成。

> Profile：`huawei_ict_agentarts`。归属与开放缺口登记（可随分工文档合入 main）。  
> 接线代码在 [#531](https://github.com/xianxing-ai/PersonalAgent/pull/531) / `codex/image28-full-wiring`，**接线未完成前勿合并该 PR**。  
> 对照：[28 图工作记录](https://github.com/xianxing-ai/PersonalAgent/blob/600f341d8cfff9aad0e831357663510c382aeaf9/docs/competition/evidence/IMAGE28_FULL_WIRING_20261028.md) · [152 节点清单](https://github.com/xianxing-ai/PersonalAgent/blob/600f341d8cfff9aad0e831357663510c382aeaf9/docs/competition/evidence/IMAGE28_HOST_GUARD_CHECKLIST_20261028.md) · [接线总包](../COLLABORATOR_WIRING_PACKAGE.md) · [MODULE_ASSIGNMENTS](../../MODULE_ASSIGNMENTS.md)。#531 尚未合入的资料链接固定到交接时提交，避免本分工文档先合入后出现断链。
> **规则**：缺受信口保持 unavailable，禁止 Fake/静默回退 Local；每人交付「生产口 → 实际调用方 → 测试 → Evidence」；勾选 152 项须具备生产注册 + 真实宿主 + 约定证据。  
> **分工修订（Owner，2026-10-31）**：**`2511375597-lab` 负责全部前端与前端接线**（Renderer/设置页/工作区 UI、Desktop 组合层把图 host/worker/IPC 接到对话与设置、相关 smoke）。Electron 受信设备宿主（语音/键鼠/WinForms 原生能力本身）、Runtime/Policy、业务连接器实现、AgentArts 云端仍归原负责人；lab 只接公开口，不伪造后端。  
> #531 已代实现大量 fail-closed 工厂与部分 Desktop 条件接线；**下表是仍须各负责人本人完成的缺口**。

## 总览

| 负责人 | 主责缺口（摘要） | 图 / 面 |
| --- | --- | --- |
| **2511375597-lab** | **全部前端 + 前端/Desktop 消费接线**（UI、IPC、`main.js`/`workspace-controls` 组合、图 host 条件注入、设置入口） | 全图 Desktop 消费面；与三人公开口对接 |
| **Potatos498** | 真实业务**后端口**与账号读回（邮件/日历/待办/订阅/通知工具语义） | F06–F09、F11–F12、F08 工具 |
| **goo122** | Policy/ToolGateway、知识记忆、GitHub/CI 底座、F23 配置消费者等**后端口** | F01、F03–F05、F16–F17、F21、F23–F25、F27、F10 底座 |
| **zemeng5208** | AgentArts 部署联跑、语音/Windows **原生能力**、编码/F15 真实验收、F20 worker 信任闭环、cloudPersistent、整图协调 | F02/F14–F15/F18–F20/F22/F26/F28（能力与云，非 UI） |

当前：**configured 0/28**；**152 清单 0/152**。`npm run check` 已在本工作树通过，不等于整图验收。

---

## 2511375597-lab（前端与前端接线 · IMAGE28 消费面唯一前端负责人）

### 范围

- `apps/desktop/src/**` Renderer、主题/工作区/设置页、图配置 UI（含 F15 审核、F20 case、业务设置展示）。
- Desktop 组合接线：`apps/desktop/electron/main.js` 中 `conversationTools` / availability / exports 合并；`workspace-controls.js`；相关 IPC（如 `coding.review.*`、`coding.f20.configure`）。
- 在 goo/Potatos/zemeng **已提供公开受信口**后，把 `createRuntimeF*` / worker ports / binding verifier **条件注入**生产组合；缺口保持 empty/`unavailable`，禁止 Fake。
- Desktop/UI smoke：`test:text-smoke` / `test:smoke` / `test:workspace-smoke` / 相关定向测试；Evidence 标明 UI/composition 级，不冒充云或账号验收。
- 继续参与 PR 审查与合并轮值。

### 必须交付（按图消费接线）

1. **总组合**
   - 维护/扩展 `workflow-graph-composition`（或等价）：F08_N10、F12_N02、F13_N02 已有条件注入；继续把齐备的 F01/F04–F07/F10/F14/F16+/F21/F23–F25/F27–F28 等并入 `conversationTools`。
   - quit/startup 夹具同步声明新宿主变量，避免 before-quit 回归。

2. **F06 / F07 / F08 / F09 / F11 / F12（对接 Potatos 口）**
   - UI：待办/日历/邮件/订阅/通知设置与状态展示；缺配置明确提示 unavailable。
   - 接线：Potatos 交出 `invokeTodoCreate`、日历版本口、真归档/发送工具、feeds 会话后，完成 Desktop 注册与授权提问卡展示；N04/N05 投递读回 UI 与导出确认。
   - 本 PR 已接：F06 N04 binding、F09 N02 + worker ports、F08_N10；**勿重复造后端工具**。

3. **F01 / F03–F05 / F10 / F16–F17 / F21 / F23–F25 / F27（对接 goo 口）**
   - 用户选择/出机确认/知识公开范围等 **前端授权与设置 UX**。
   - goo 提供 Gateway invoke、配置消费者、CI 失败解析口后，注入对应 host 与 developer 设置页读回展示。
   - F23：仅当 goo 确认消费者齐备后，由 lab 注入 `workflowShadowRelease` 的 Desktop 组合（不发明测量源）。

4. **F02 / F14 / F15 / F20（对接 zemeng 能力）**
   - F02：语音询问/确认的 **UI 与 IPC 展示**（声学/设备能力本身仍归 zemeng）。
   - F14：观察确认/锁状态的界面与任务卡；原生 `browser.observe` 能力归 zemeng。
   - F15：审核配置 UI、native viewer 启动入口（本 PR 已有骨架）；真人签名与目视验收流程与 zemeng 协作记录。
   - F20：Renderer/`coding.f20.configure` 与 case 状态展示；**worker 信任闭环未齐前不得注入 `ownedWorkflowWorker`**（见 F20 gaps）；齐备后由 lab 做 Desktop options 接线。

5. **F13 / catalog**
   - 系统探测结果与 unavailable（云/配额/锁）在 UI 诚实展示；`workflow.image.catalog` 消费体验。

6. **Evidence**
   - 每个接线 PR：列出调用方文件、截图或 smoke 命令、依赖的后端口 SHA/负责人；注明未验账号/云项。

### 不要做的

- 不实现邮件 SMTP/归档、MemoryQuery、AgentArts 部署、cloudPersistent 等后端。
- 不把 UI 可点或设置能保存写成整图 done。
- 不在缺公开口时硬注册 host 并返回假成功。

---

## Potatos498（业务连接器 MOD-20～26、34/35/38）

### 必须交付的受信口（后端；UI 交 lab）

1. **F06**：生产 `invokeTodoCreate`（Policy/ToolGateway）；N05 真实投递回执；对齐 `f06:n03-todo:{session}`。参考 [F06_REMINDER_WIRING_20261029.md](https://github.com/xianxing-ai/PersonalAgent/blob/600f341d8cfff9aad0e831357663510c382aeaf9/docs/competition/evidence/F06_REMINDER_WIRING_20261029.md)。
2. **F07**：日历版本口、账户配置、写入外部读回、N05 网关。参考 [F07_FRESHNESS_20261029.md](https://github.com/xianxing-ai/PersonalAgent/blob/600f341d8cfff9aad0e831357663510c382aeaf9/docs/competition/evidence/F07_FRESHNESS_20261029.md)。
3. **F08**：Gateway **真归档**与 **真 SMTP 发送**（`mark_seen`/`save_draft` 不可冒充）；N12 Sent 对账。参考 [F08_MAIL_BOUNDARY_20261029.md](https://github.com/xianxing-ai/PersonalAgent/blob/600f341d8cfff9aad0e831357663510c382aeaf9/docs/competition/evidence/F08_MAIL_BOUNDARY_20261029.md)。口齐后通知 lab 注册 Desktop。
4. **F09**：真实 feeds 提供者与会话授权；配合 zemeng 云联跑、lab 组合。
5. **F11**：`calendar.update` 语义与真实写读回、提醒失效（守卫已有，缺生产工具链）。
6. **F12 N04**：真实渠道投递读回端口（供 lab 接线与展示）。

### 不要做的

- Fake 成功 send/archive；不代替 lab 做设置页/对话组合。

---

## goo122（底座 MOD-01～09、33/36/37 等）

### 必须交付的受信口（后端；Desktop 注入交 lab）

1. **F01**：责任生命周期、出机许可等生产提供者（供 lab 接到 F01 host）。
2. **F03/F04/F05**：MemoryQuery / knowledge.search 的受信 Gateway `invoke*`；版本冲突、引用验真、原效果绑定。
3. **F10 底座**：原来源读回、ModelGateway 独立审核绑定。
4. **F16/F17**：真实 `resolveFailure` / `readCurrentHead` / 失败报告 checkpoint 口（工厂已导出）。
5. **F21**：Skills/MCP 安装隔离与启用许可的后端口。
6. **F23**：现行配置消费者 + 可信测量 + 测试 Evidence 生产者；齐备前禁止 production shadow release。见 F23 evidence。
7. **F24/F25/F27**：知识对账身份、出站凭据、Model 能力 guard/Evidence。
8. **契约**：F20 等若需新 Schema，随包更新 contracts。

### 不要做的

- 合成测试升格 frozen；缺消费者注入 F23 release；不代替 lab 做 Renderer。

---

## zemeng5208（核心 / AgentArts / 原生设备与编码）

### 必须交付（能力与云；前端接线交 lab）

1. **AgentArts**：固定 deployment、评测集整图联跑；禁止静默 Local 回退；F09 前缀云验收。
2. **F02 原生语音能力**：声学防回声、final 回执、设备证据（UI 接线归 lab）。
3. **F14 原生观察能力**：`browser.observe`、输入锁、会话绑定（UI 归 lab）。
4. **F15 真实验收**：真人独立审核签名、实机 WinForms 目视（配置 UI 归 lab）。
5. **F18/F19**：PR/Issue 图路径与平台/授权读回。
6. **F20 worker 信任闭环**：按 [F20_WORKER_TRUST_GAPS_20261029.md](https://github.com/xianxing-ai/PersonalAgent/blob/600f341d8cfff9aad0e831357663510c382aeaf9/docs/competition/evidence/F20_WORKER_TRUST_GAPS_20261029.md)；齐备后 lab 注入 Desktop；此前禁止 `ownedWorkflowWorker`。
7. **F22/F26/F28 能力与 gate**、**cloudPersistent**（有关机后云证据才允许；Desktop 组合由 lab 在口齐后接线）。
8. **整图协调**：汇总三人+lab Evidence；勾选 152 与矩阵；华为优先验收。

### 不要做的

- 不把前端/Desktop 消费接线默认揽回（已交 lab）；不代替 Potatos/goo 造业务/底座口。

---

## 本 PR 已落地（供对照，勿重复劳动）

- Runtime：大量 `createRuntimeF*` fail-closed、F09/F20 worker capability、F15 frontier/signed-review、F23 shadow、F06 revision checkpoint、AgentArts `f09WorkflowWorkerPorts`→ownedImage、F16/F17 导出。
- Desktop（后续由 lab 接管演进）：F15 review、F09 feed+worker ports、F06 binding、workflow-graph-composition、F20 case configure。
- 验证：本工作树 `npm run check` 通过（2026-10-31）。  
- **未勾 152；未宣称 28 图完成；未注入 F20 worker / F10 enqueue / cloudPersistent。**

## 建议开工顺序

1. Potatos：F08 真发送/归档 + F06 `invokeTodoCreate` + F12 N04 投递口。  
2. goo：F04/F05 Gateway invoke + F23 配置消费者。  
3. lab：在已有口上补齐设置/对话组合与 smoke；跟进三人新口做注入。  
4. zemeng：固定部署联跑 F09；F15 真人签名；F20 信任闭环设计。  
5. Evidence 回填后再勾 152 / 整图 done。

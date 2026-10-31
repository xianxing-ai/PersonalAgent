# IMAGE28 协作者待办清单（2026-10-31）

> Profile：`huawei_ict_agentarts`。分支：`codex/image28-full-wiring`。  
> 对照：[28 图工作记录](IMAGE28_FULL_WIRING_20261028.md) · [152 节点清单](IMAGE28_HOST_GUARD_CHECKLIST_20261028.md) · [接线总包](../COLLABORATOR_WIRING_PACKAGE.md) · [MODULE_ASSIGNMENTS](../../MODULE_ASSIGNMENTS.md)。  
> **规则**：缺受信口保持 unavailable，禁止 Fake/静默回退 Local；每人交付「生产口 → Desktop/Runtime 实际调用方 → 测试 → Evidence」；勾选 152 项须具备生产注册 + 真实宿主 + 约定证据。  
> 本 PR 已代实现大量 fail-closed 工厂与部分 Desktop 条件接线；**下表是仍须原负责人本人完成的缺口**，长期归属不变。

## 总览

| 负责人 | 主责缺口（摘要） | 图 |
| --- | --- | --- |
| **Potatos498** | 真实业务源配置、邮件/日历/待办/订阅/通知生产口与读回 | F06–F09、F11–F12、部分 F08 |
| **goo122** | Policy/ToolGateway 调用口、知识记忆、GitHub/CI 底座、F23 配置消费者 | F01、F03–F05、F16–F17、F21、F23–F25、F27、部分 F10/F24 |
| **zemeng5208** | AgentArts 部署联跑、Desktop 设备/语音/编码、F15/F20/F22/F26/F28、cloudPersistent | F02、F10 联跑、F14–F15、F18–F20、F22、F26、F28、整图验收 |
| **2511375597-lab** | 本 PR 及后续接线 PR 的审查与合并轮值（非口承包） | — |

当前：**configured 0/28**；**152 清单 0/152**。`npm run check` 已在本工作树通过，不等于整图验收。

---

## Potatos498（业务连接器 MOD-20～26、34/35/38）

### 必须交付的受信口

1. **F06 待办/提醒**
   - 生产 `invokeTodoCreate`：经 Runtime Policy/ToolGateway 调用 `todo.create`，稳定 operationId + 读回；勿在图宿主内直调 `tool.execute`。
   - N03 输出与提醒字段对齐后，保证 Desktop 已注入的 `verifyWorkflowReminderBinding` 能读到同图 `f06:n03-todo:{session}`。
   - N05：真实渠道投递 + 回执；不得把排队/fixture 当「用户已收到」。
   - Evidence：真实待办账号或本机 productivity 存储读回；参考 [F06_REMINDER_WIRING_20261029.md](F06_REMINDER_WIRING_20261029.md)。

2. **F07 日历**
   - Desktop 注入日历版本口、原读取绑定、N05 受信网关。
   - 账户配置 + `calendar.create`/更新后的外部读回。
   - Evidence：参考 [F07_FRESHNESS_20261029.md](F07_FRESHNESS_20261029.md)。

3. **F08 邮件（语义正确工具）**
   - 提供经 Gateway 的**真归档**、**真 SMTP 发送**公开工具（`mail.mark_seen` ≠ 归档，`mail.save_draft` ≠ 发送）。
   - N12：原发送身份绑定 + Sent 读回对账；N03/N07/N12 工厂当前显式 unavailable，见 [F08_MAIL_BOUNDARY_20261029.md](F08_MAIL_BOUNDARY_20261029.md)。
   - Desktop 在口齐备后注册对应 `createRuntimeF08*`；本 PR 仅条件注入了 N10 操作 scope。

4. **F09 订阅源**
   - 真实 feeds 提供者（非仅 Synthetic fixture）、用户会话授权、精确结果出机。
   - 与 Desktop 已接的 N02 / `f09WorkflowWorkerPorts` 联跑；配合 zemeng 做云图至 F10 前缀验收。
   - F10 入队宿主若落在研究连接器，需公开 enqueue 口或明确交接 goo/zemeng。

5. **F11 日历变更/提醒失效**
   - 用户原确认 → `calendar.update` 语义映射 → 真实写入/读回与提醒失效。
   - 现有仅有 `verifyF11ConfirmedCalendarAndReminder` 守卫，未注册图工具。

6. **F12 通知投递**
   - N04：真实横幅/语音投递读回 + 导出授权；本 PR 仅条件注入了 N02 quiet-hours。
   - Evidence：物理设备或明确 device 级回执，见 CW-09。

7. **业务设置与展示**
   - 邮件/日历/订阅/待办设置页与对话工具注册保持可用；缺配置返回明确 unavailable，不假装已授权。

### 不要做的

- 不要用 Fake CAS / 永远成功的 send/archive。
- 不要把 connector 「配置成功」写成整图 done。

---

## goo122（底座 MOD-01～09、33/36/37 等）

### 必须交付的受信口

1. **F01 上下文**
   - Desktop 生产：原生用户选择、责任生命周期授权、精确出机许可，接到 `createRuntimeF01ContextHost`。
   - 工厂已有；缺生产提供者则保持不注册。

2. **F03 / F04 / F05 记忆与知识**
   - MemoryQuery / knowledge.search 的**受信 Gateway 调用口**（组合层 `invoke*`，非直调）。
   - F03 N06 原效果绑定、因果读回；F04 版本冲突与其余 host；F05 引用验真。
   - 对接已有 knowledge/Desktop 公开源；平台 knowledge provider 缺口单列。
   - Evidence：参考 F03/F24 相关 evidence；公开 Vault 更正/撤回链。

3. **F10 主张校验（底座侧）**
   - 原来源读回端口、ModelGateway 独立审核绑定（与 zemeng Desktop 出机配合）。
   - N02–N04 确认回执投影；工厂 `createRuntimeF10SupportedClaimsHost` 已导出未生产注入。

4. **F16 / F17 开发者 CI/失败报告**
   - GitHub Actions 原失败绑定、workspace HEAD、导出授权；本 PR 已导出工厂，需 Desktop/developer 宿主注入真实 `resolveFailure` / `readCurrentHead`。
   - F17：图 driver checkpoint + workspace 根解析；与 Potatos MOD-34/35 修复链对齐但不代其业务验收。

5. **F21 Skills/MCP**
   - 安装、隔离探测、启用许可；Desktop MCP 宿主接到 `createRuntimeF21*`。

6. **F23 影子配置权威**
   - **现行配置消费者** + 可信测量 + 测试 Evidence 生产者接到 shadow 口。
   - 仅有 SQLite CAS/验签工厂不够；见 [F23_CONFIGURATION_AUTHORITY_20261028.md](F23_CONFIGURATION_AUTHORITY_20261028.md)、[F23_CONSUMER_EVALUATION_GAPS_20261029.md](F23_CONSUMER_EVALUATION_GAPS_20261029.md)。
   - Desktop 注入 `workflowShadowRelease` 须在消费者齐备后，由 goo 口 + zemeng Desktop 协作。

7. **F24 / F25 / F27**
   - F24：知识写对账生产身份、导出授权；[F24_KNOWLEDGE_READBACK_PORTS_20261029.md](F24_KNOWLEDGE_READBACK_PORTS_20261029.md)。
   - F25：出站凭据扫描与 `save_credential_reference`、Desktop 受信宿主。
   - F27：ModelGateway 能力读回与 N04–N07 guard/Evidence 映射。

8. **公共契约**
   - 若 F20 候选检查等需要新 Schema，由工作包说明兼容后更新 contracts（随变更人，长期 contracts 归 goo）。

### 不要做的

- 不要把合成 MemoryQuery 测试标成 frozen 接口。
- 不要在缺消费者时注入 F23 production release。

---

## zemeng5208（核心 / Desktop / AgentArts / 语音设备 / 编码）

### 必须交付的受信口与联跑

1. **AgentArts Competition 联跑**
   - 固定 `deploymentVersion`、评测集、镜像/运行时版本；整图 advance 读回（deployment/API/trace）。
   - F09 worker 仅在固定部署下合并 ownedImage；需真实订阅会话联跑并记录 F10 前 unavailable。
   - 禁止 AgentArts 失败后静默 Local 回退。

2. **F02 语音**
   - 原问题选择、精确出机、声学防回声、播报证据、审批恢复；接 `createF02*` 与 Live final 回执。
   - 物理麦/扬声器证据；SIS 经 AA 流桥缺则 unavailable。

3. **F14 浏览器观察**
   - Desktop 受信 `browser.observe` 入口、跨节点设备会话、输入锁、确认与效果读回。
   - 工厂已有；见 [F14_OBSERVATION_ADAPTER_20261029.md](F14_OBSERVATION_ADAPTER_20261029.md)。

4. **F15 独立审核（真实验收）**
   - 真人独立审核者签名、固定部署、实机 WinForms 目视；本 PR 已接 Desktop config/origin/viewer（Synthetic 配置 ≠ 真人身份）。

5. **F18 / F19（PR/Issue 产品链）**
   - 原 PR 差异、当前头、合并授权；Issue 修复关闭读回（可与 Potatos MOD-38 协作，Competition 图消费归本线）。

6. **F20 coding case worker**
   - 按 [F20_WORKER_TRUST_GAPS_20261029.md](F20_WORKER_TRUST_GAPS_20261029.md) 补齐：候选绑定、隔离 `coding.repair.trial`、frontier/export/completion；**齐备前不得注入 `ownedWorkflowWorker`**。
   - Renderer/`coding.f20.configure` 入口完善。

7. **F22 / F26**
   - 影子快照隔离与原 trace；平台构建/部署真实证据读回。

8. **F28**
   - 执行前授权与目录 gate、Desktop/ModelGateway 生产注入；角色计划底座已有，图 N03 默认不注册直至 gate 齐。

9. **cloudPersistentHost**
   - 仅在有**经验证的关机后云宿主**时注入；禁止本机存储冒充。

10. **整图验收与清单**
    - 协调三人 Evidence；逐项勾选 [IMAGE28_HOST_GUARD_CHECKLIST_20261028.md](IMAGE28_HOST_GUARD_CHECKLIST_20261028.md)；更新 [IMAGE28_FULL_WIRING_20261028.md](IMAGE28_FULL_WIRING_20261028.md)。
    - 华为优先：评测集 + 评估任务；本地替代须记录平台不可用依据。

### Desktop 组合（本 PR 已做 / 仍待你确认）

已做（条件注入，缺口仍 empty）：F15 review、F09 N02+worker ports、F06 N04 binding、F08_N10、F12_N02、F13_N02（云/配额/锁拒绝）、F20 case IPC。  
仍待：F01/F02/F04–F05/F07/F10/F14/F16+/F20 worker/F23 release 等生产注入与真机云验收。

---

## 2511375597-lab

- 参与本 PR 及后续 IMAGE28 接线 PR 的**实质审查与合并轮值**（与 goo/Potatos/zemeng 均衡）。
- 不替代三人交付受信口；审查时核对：无 Fake 升格、unavailable 诚实、Evidence 分级（fixture / realHost / realAccount / physicalDevice）。

---

## 本 PR 已落地（供对照，勿重复劳动）

- Runtime：大量 `createRuntimeF*` fail-closed 工厂、F09/F20 worker capability、F15 frontier/signed-review、F23 shadow 口、F06 N03 revision checkpoint、AgentArts `f09WorkflowWorkerPorts`→ownedImage 合并、F16/F17 导出。
- Desktop：F15 hosts、F09 feed graph + worker ports、F06 reminder binding、workflow-graph-composition（F08_N10/F12_N02/F13_N02）、F20 case configure。
- 验证：本工作树 `npm run check` 通过（2026-10-31）。  
- **未勾 152；未宣称 28 图完成；未注入 F20 worker / F10 enqueue / cloudPersistent。**

## 建议开工顺序

1. Potatos：F08 真发送/归档工具语义 + F06 `invokeTodoCreate` + F12 N04 投递读回。  
2. goo：F04/F05 Gateway invoke + F23 配置消费者。  
3. zemeng：固定部署联跑 F09 前缀；F15 真人签名；规划 F20 worker 信任闭环。  
4. 三人各自 Evidence 回填矩阵后，再谈勾选清单与整图 done。

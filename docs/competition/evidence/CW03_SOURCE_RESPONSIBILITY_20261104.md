# CW-03 主动事件与持续责任真实来源接线证据（2026-11-04）

目标 Profile：`huawei_ict_agentarts`。负责人：`zemeng5208`。
分支：`zemeng/cw03-proactive-event-source`（基于 PR #543 head `codex/pr531-cloud-persistent`）。
本轮在本地 Fixture 闭环完成 CW-03：将 ConnectorHost/feeds 的 confirmed receipt 路由真实路径，通过 `sourceResponsibilityBinding` 绑定至用户原话生成的 current 显式责任，接入 Runtime `eventSink.persist` 事件入口并驱动签名 advance。未连接真实账号、云端或外部服务。

---

## 1. 覆盖矩阵（条目 → 实现文件 → 测试）

| 条目 / 契约规范 | 实现文件 | 测试文件与用例 | 覆盖结论 |
| --- | --- | --- | --- |
| **sourceResponsibilityBinding 显式约束**<br>（仅绑定指定 sourceId，且责任必须为 explicit_instruction 且 lifecycle 状态为 current） | `apps/runtime/src/application/proactive-workflow-application.ts`<br>`apps/desktop/electron/proactive-workflow-host.js` | `apps/runtime/test/proactive-workflow-application.test.mjs`<br>`apps/desktop/test/proactive-source-responsibility-binding.test.mjs` | **生产已接入**：Desktop `start()` 允许并校验 `sourceResponsibilityBinding`，持久化至 `desktop-proactive-workflow-v1` checkpoint；`bind()` 自动透传至 Runtime `createProactiveWorkflowHost` |
| **四入口 1：ingestUserInstruction**<br>（用户原话产生 explicit_instruction 责任与 user_instruction 事件条目） | `apps/runtime/src/application/proactive-workflow-application.ts`<br>`apps/desktop/electron/proactive-workflow-host.js` | `apps/desktop/test/proactive-workflow-host.test.mjs`<br>`apps/desktop/test/proactive-source-responsibility-binding.test.mjs` | **已覆盖**：启动持续工作流时通过 `session.host.ingestUserInstruction` 消费用户原话任务，生成带 quote 的 explicit 责任，绑定责任 ID |
| **四入口 2：eventSink.persist（本包重点）**<br>（持久化来源批次，严格校验责任绑定，阻断非 current 责任与游标推进） | `apps/runtime/src/application/proactive-workflow-application.ts`<br>`apps/desktop/electron/proactive-confirmed-source-router.js` | `apps/desktop/test/proactive-confirmed-source-router.test.mjs`<br>`apps/desktop/test/proactive-source-responsibility-binding.test.mjs` | **已闭环**：通过 `routeConfirmedFeed` 将 confirmed receipt 经 durable batch 注入 `host.eventSink.persist`，自动附带 `responsibilityRefs: [boundId]`；非 current 或未绑定时 fail-closed 抛错，保留 pending 批次，不提交游标 |
| **四入口 3：ingestSubtaskFeedback**<br>（子任务执行回执与 task.progress 入口） | `apps/runtime/src/application/proactive-workflow-application.ts`<br>`apps/desktop/electron/proactive-controller-host.js` | `tests/integration/proactive-image-host.test.mjs`<br>`apps/desktop/test/proactive-controller-wiring.test.mjs` | **基线已接入**：由 CW-07 / controller host 负责，消费子任务 progress/report，校验 parent-child 绑定 |
| **四入口 4：ingestWake**<br>（Scheduler 定时唤醒入口） | `apps/runtime/src/application/proactive-workflow-application.ts`<br>`apps/desktop/electron/proactive-runtime-pump.js` | `apps/desktop/test/proactive-runtime-pump.test.mjs`<br>`tests/integration/proactive-image-host.test.mjs` | **基线已接入**：由 CW-05 / Desktop pump 负责，将 Scheduler 到期唤醒通过 `session.host.ingestWake` 注入同会话 |
| **签名 Advance 闭环**<br>（仅向 advancePort 交付绑定且 current 的责任及事件条目） | `apps/runtime/src/application/proactive-workflow-application.ts`<br>`packages/agentarts/src/proactive-workflows.ts` | `apps/desktop/test/proactive-source-responsibility-binding.test.mjs`<br>`packages/agentarts/test/proactive-workflows.test.mjs` | **已闭环**：`advanceFrontier` 过滤只投递 `sourceResponsibilityBinding.responsibilityId` 且当前 current 的责任，签名提案携带绑定的 `responsibilityRefs` |
| **Fail-closed 拒绝与游标保护**<br>（未绑定、未激活、已撤回、已过期、版本不匹配拒绝且不推进游标） | `apps/runtime/src/application/proactive-workflow-application.ts`<br>`apps/desktop/electron/proactive-confirmed-source-router.js` | `apps/desktop/test/proactive-source-responsibility-binding.test.mjs` | **已覆盖**：各种非法/非 current 状态均拒绝（抛出 `UNAUTHORIZED` / `UNSUPPORTED_CAPABILITY`），`state.pending` 保持未提交，`recoverPending` 准确记录错误码（含 `UNAUTHORIZED`），游标不提交 |
| **重要事件不得静默丢弃**<br>（未订阅/重要事件保留 priority: 'unknown'） | `apps/runtime/src/application/proactive-workflow-application.ts` | `apps/desktop/test/proactive-source-responsibility-binding.test.mjs`<br>`apps/runtime/test/proactive-workflow-application.test.mjs` | **已覆盖**：来源事件注入时一律保留 `priority: 'unknown'`，在订阅筛选阶段绝不静默丢弃 |
| **公开 Receipt 校验**<br>（不读私库或连接器内部，校验 public transport / credentialFree） | `apps/desktop/electron/proactive-confirmed-source-router.js` | `apps/desktop/test/proactive-confirmed-source-router.test.mjs` | **已覆盖**：严格消费 `createKnowledgeFeedReceiptFromConfirmedExecution` 产生之公开回执，校验 `publicFetch`、`nativeFetch` 与 `credentialFree` |
| **重启与去重防重放**<br>（SQLite 重启不重复 advance，重复 receipt 幂等返回 already_persisted） | `apps/desktop/electron/proactive-workflow-host.js`<br>`apps/desktop/electron/proactive-confirmed-source-router.js` | `apps/desktop/test/proactive-source-responsibility-binding.test.mjs` | **已覆盖**：`desktop-proactive-workflow-v1` 检查点持久恢复绑定，重启后相同 requestId 幂等读回，相同 receiptId 识别为 `already_persisted` 不产生二次事件 |

---

## 2. 代码改动与目的

### 2.1 `apps/desktop/electron/proactive-workflow-host.js`
- **目的**：在 Desktop/宿主侧正式接通 `sourceResponsibilityBinding` 消费通路。
- **改动详情**：
  1. `createDesktopProactiveWorkflowApplication` 选项新增可选 `sourceResponsibilityBinding`。
  2. `bind(taskId, request)` 时，从检查点 `binding.sourceResponsibilityBinding` 或工厂选项读取，透传给 `application.createProactiveWorkflowHost({..., sourceResponsibilityBinding})`。
  3. `start(input, request)` 时，参数白名单扩充支持 `sourceResponsibilityBinding`（格式校验：非空字符串 `{sourceId, responsibilityId}`），并持久化存入 `desktop-proactive-workflow-v1` checkpoint；同时传递 `responsibilityId` 给 `session.host.ingestUserInstruction`，确保用户指令注册的显式责任与绑定一致。
  4. `instruction(taskId, sourceTaskId, request, responsibilityId)` 允许透传显式责任 ID。

### 2.2 `apps/desktop/electron/proactive-confirmed-source-router.js`
- **目的**：保持 fail-closed 错误语义完整。
- **改动详情**：
  - 在 `recoverPending` 捕获异常的合法错误码列表中增加 `'UNAUTHORIZED'`，确保当未绑定来源被拒绝时，保留原本的 `code: 'UNAUTHORIZED'`（而不是退化为 `HOST_UNAVAILABLE`），便于上层审计与对账。

### 2.3 `apps/desktop/test/proactive-source-responsibility-binding.test.mjs`（新增）
- **目的**：针对 CW-03 完整的「真实来源路径 → 绑定 current 责任 → 签名 advance」提供全覆盖闭环测试。
- **覆盖测试用例**：
  1. `CW-03: real source event -> bound explicit current responsibility -> signed advance closed loop`：验证从用户原话任务启动、未激活时拒绝、激活后成功 persist、生成绑定 current 责任的 connector entry、签名 advance 并交付提案。
  2. `CW-03 fail-closed: unbound source is rejected and pending cursor is preserved without commit`：验证非绑定来源被 `UNAUTHORIZED` 明确拒绝，游标不推进，`recoverPending` 保持 `unavailable`。
  3. `CW-03 fail-closed: revoked, expired or revision-changed responsibility rejects feed persist`：验证责任撤回、过期、版本不匹配均被 `UNSUPPORTED_CAPABILITY` 拒绝。
  4. `CW-03 fail-closed: foreign conversation / scope denied cannot persist source`：验证跨会话任务及未授权追踪均被 `SCOPE_DENIED` 拒绝。
  5. `CW-03 duplicate receipt deduplication and SQLite restart preserves binding without repeat advance`：验证重复回执识别为 `already_persisted`，SQLite 重启后恢复绑定且不产生重复 advance。

---

## 3. 本地实际运行命令与结果

### 3.1 Workspace 构建
```bash
npm run build --workspace=@personal-agent/agentarts && npm run build --workspace=@personal-agent/runtime
```
**结果**：Exit code 0，TypeScript 编译与产物生成全部成功。

### 3.2 专项测试套件
```bash
# 1. Runtime 与 AgentArts 主动工作流测试
node --test apps/runtime/test/proactive-workflow-application.test.mjs packages/agentarts/test/proactive-workflows.test.mjs
# 结果：32 项测试全部通过（32 pass, 0 fail, 0 skip, 耗时 3.57s）

# 2. 离线全链路集成测试（proactive-image-host）
node --test --test-isolation=none tests/integration/proactive-image-host.test.mjs
# 结果：2 项集成测试全部通过（2 pass, 0 fail, 耗时 1.76s）

# 3. Desktop 宿主侧测试（含新增 CW-03 专项测试）
node --test apps/desktop/test/proactive-source-responsibility-binding.test.mjs apps/desktop/test/proactive-confirmed-source-router.test.mjs apps/desktop/test/proactive-workflow-host.test.mjs
# 结果：16 项测试全部通过（16 pass, 0 fail, 耗时 1.70s）
```

### 3.3 架构规范与 Diff 检查
```bash
npm run check:architecture && git diff --check
```
**结果**：
- 架构门禁 3 项测试全部通过（workspace 依赖与架构边界合规）。
- `git diff --check` 无任何冲突标记或空白违规（Exit code 0）。

---

## 4. 仍未完成的真实验收项

本轮仅在离线 Synthetic / Fixture 环境完成接线闭环与契约校验，不代表以下真实外部能力已验收：

1. **真实业务账号与连接器**：
   - 真实 GitHub、真实邮箱（IMAP/SMTP/Exchange）、真实订阅及社交平台需依赖 Potatos498 的业务连接器交付真实凭据与物理网络拉取。
2. **真实系统通知**：
   - 真实 Windows 物理横幅通知与音频通道仍需物理机环境及通知配额系统联合验收。
3. **AgentArts 远端云编排**：
   - 当前测试使用本地 Fake/HTTP Server 模拟 AgentArts 镜像，尚未包含华为 AgentArts 云端部署版本的真实网络调度、原生知识库和远端 MCP 链路。
4. **关机持续执行（Cloud Persistent Host）**：
   - 本地离线环境无真实 cloudPersistentHost，保持显式 `unavailable` 状态；关机后的云端接管及状态同步仍需真实云端 Profile 验收。
5. **Desktop 主进程组合尚未传入绑定**：
   - 本 PR 只让 `createDesktopProactiveWorkflowApplication` 能接受并持久化 `sourceResponsibilityBinding`（构造参数或可信调用方 `start` 入参），并透传给 Runtime。`main.js` 组合与模型可见的 `proactive.workflow.start` 工具都未传入该绑定，因此模型不能自选绑定；生产上选定哪个来源和哪条责任，仍待组合 owner 接入。Runtime 仍校验责任须为 `explicit_instruction` 且生命周期为 current，不满足即拒绝。

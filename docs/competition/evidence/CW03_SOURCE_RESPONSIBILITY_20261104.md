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
  1. `createDesktopProactiveWorkflowApplication` 选项新增可选 `sourceResponsibilityBinding`，**只接受按任务解析的函数** `({taskId, sourceTaskId}) => binding | undefined`；传对象会在构造时抛 `TypeError`（理由见 2.4）。
  2. `start(input, request)`：入参 `sourceResponsibilityBinding` 优先；未给时调用一次解析函数。结果按与 Runtime `lifecycleCommand` 相同的规则校验，然后只把 `{sourceId, responsibilityId}` 两个字段写入 `desktop-proactive-workflow-v1` checkpoint，并以同一 `responsibilityId` 调用 `session.host.ingestUserInstruction`。
  3. `bind(taskId, request)` **只读 checkpoint 里持久化的绑定**，并再校验一次后透传给 `application.createProactiveWorkflowHost`；重启/恢复时不重新调用解析函数，所以绑定不会因进程重启而漂移。
  4. `instruction(taskId, sourceTaskId, request, responsibilityId)`：第 4 参数可选；给了就必须满足同一 ID 规则，否则抛错（原实现对非文本值静默忽略）。
  5. 校验规则（`validSourceResponsibilityBinding`）：必须是普通对象（原型为 `Object.prototype` 或 `null`，不接受数组）；自有键恰好为 `sourceId`、`responsibilityId`；两个值都必须是非空白文本、长度 ≤256，且不是 `__proto__` / `constructor` / `prototype`。规则对齐 `apps/runtime/src/application/proactive-workflow-application.ts` 中 `lifecycleCommand` 对 `responsibilityId` 的检查，没有修改 Runtime。

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
  6. `CW-03 start: custom responsibilityId ...`：非默认的自定义责任 ID 会写入 checkpoint、注册为责任，并出现在 connector entry 的 `responsibilityRefs` 里。
  7. `CW-03 start: binding identities follow the Runtime rule ...`：`__proto__` / `constructor` / `prototype`（`sourceId` 和 `responsibilityId` 都测）、257 字符、多余键、缺键、空白、数组、带继承原型的对象、`null`，以及 JSON 解析出的自有 `__proto__` 键，全部被拒；256 字符边界被接受。
  8. `CW-03 constructor: object form is refused; resolver runs once ...`：对象形式构造参数抛 `TypeError`；函数形式只在 `start` 时以 `{taskId, sourceTaskId}` 被调用一次，结果写入 checkpoint；重启后即使函数返回值变了也不再调用，绑定不变；`start` 显式入参优先于函数；函数返回非法 ID 时 `start` 被拒。
  9. `CW-03 instruction(): optional 4th responsibilityId ...`：非法第 4 参数（保留名、257 字符、空串、非字符串）被拒；合法自定义 ID 会注册对应责任。

  反向验证：把 `proactive-workflow-host.js` 换回本次修复前的版本，用例 7、8、9 失败；用例 6 本来就能通过，它覆盖的是能力本身，不是修复点。

### 2.4 信任边界与构造参数形式的取舍
- **IPC 信任边界（已核实，需人工确认）**：`apps/desktop/electron/main.js` L4643–4646 中，`proactive.workflow.*` 只检查 sender 是 panel 或 admin、`competitionMode` 已开启、主帧一致。随后 `proactive.workflow.start` 把 renderer 发来的 `payload` **原样**交给 `proactiveWorkflowApplication.start(payload)`。因此 panel/admin renderer 可以自行指定 `sourceResponsibilityBinding`。本 PR 只在宿主侧做格式和 ID 校验；Runtime 仍要求责任是 `explicit_instruction` 且 lifecycle 为 current。**是否允许 renderer 自选绑定，需要 main.js / Renderer owner 人工确认**；本 PR 不修改 main.js。
- 模型可见的 `proactive.workflow.start` 工具（`apps/desktop/electron/proactive-conversation-tools.js` L49–50）只传 `sourceTaskId`、`commandId` 和 `taskDeadline`，不能传绑定。
- **构造参数只接受函数**：原来的对象形式会把同一个 `{sourceId, responsibilityId}` 套用到每个会话，导致 Runtime 过滤掉其他会话自己的责任。我在「只接受函数」和「首次绑定时持久化」之间没有二选一，而是两个都做：
  - 只接受函数，从接口层面杜绝全局对象；
  - 函数只在 `start` 时求值一次，结果随原 checkpoint 一次写入。这一步本来就由 `start` 用 `saveCheckpointOnce` 写 checkpoint，不需要事后覆盖已存在的 checkpoint；
  - `bind` 和 resume 只读持久化的值，所以重启不会让绑定漂移。

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
# 结果：20 项测试全部通过（20 pass, 0 fail）——修复提交后重跑，原 16 项 + 新增 4 项

# 4. PR 描述中的 6 文件组合（上面 1 与 3，加 proactive-conversation-tools）
node --test apps/runtime/test/proactive-workflow-application.test.mjs packages/agentarts/test/proactive-workflows.test.mjs apps/desktop/test/proactive-source-responsibility-binding.test.mjs apps/desktop/test/proactive-confirmed-source-router.test.mjs apps/desktop/test/proactive-workflow-host.test.mjs apps/desktop/test/proactive-conversation-tools.test.mjs
# 结果：54/54 通过（原 50 + 新增 4）

# 5. Desktop 全部主动工作流测试
node --test apps/desktop/test/proactive*.test.mjs
# 结果：77/77 通过
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
   - 本 PR 让 `createDesktopProactiveWorkflowApplication` 能接受并持久化 `sourceResponsibilityBinding`（来源可以是构造参数的解析函数，也可以是 `start` 入参），并透传给 Runtime。`main.js` 组合没有传构造参数；模型可见的 `proactive.workflow.start` 工具不能传绑定，所以模型无法自选。但 main.js 的 IPC `proactive.workflow.start` 会把 panel/admin renderer 的 payload 原样传进来，renderer 能指定绑定（见 2.4，需人工确认）。生产上选定哪个来源和哪条责任，仍待组合 owner 接入。Runtime 仍校验责任须为 `explicit_instruction` 且生命周期为 current，不满足即拒绝。

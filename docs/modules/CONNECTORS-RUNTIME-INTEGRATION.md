# 连接器与服务模块的 Runtime 接线方案

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

版本：1.3（按 goo122/zemeng 2026-09-22 三轮评审修订）· 日期：2026-09-22 · 作者：`Potatos498` · 评审：`goo122`（根装配负责人）

## 0. 目的、现状与 Profile 边界

MOD-20/21/22/23/24/25 六个模块源码已全部合并，但 `apps/runtime` 目前只装配了 weather（PR #9）。本方案给出其余五个包（feeds / mail / productivity / notifications / research）接入 Runtime 的设计。**组合入口只定义 Competition（`huawei_ict_agentarts`）侧装配；Local 全量入口属未授权后续项，仅记录。**

## 1. 接线模式与工具注入路径（待 goo122 复核的代码事实）

计划沿用 weather 的两段式（数组宿主收集 `RegisteredTool[]` → `createRuntimeApplication({tools, profile, …})`）。

**关于「Competition Profile 是否接受 `tools`」**：goo122 二轮评审指出会直接 `INVALID_ARGUMENT`；zemeng 按当前 `main@b979eb5` 源码核对得出相反结论。代码事实（本版再次核对一致）：

- `runtime-application.ts` 构造器只拒绝两种组合：`local + coordination` 与 `huawei_ict_agentarts + text`——**不拒绝 Competition + tools**；
- `options.tools` 存在时构造 `ToolGateway` + `RuntimeToolInvoker`，两个 Profile 行为相同；
- `AgentArtsRuntimeApplicationOptions` 仅 Omit `profile | coordination | text`，未 Omit `tools`；`startCoordinationTask` 会把 `this.tools` 传入 coordination 路径。

**本节结论为「待复核」而非定论**：若 goo122 复核后确认 Competition + tools 成立，Phase 1 按 §5 执行；若结论仍是应走 CoordinationPort 专属路径（或该行为属无意泄漏、将收紧），则本方案的注入路径需按其裁定改写或另提接口/ADR 变更——不沿用 weather 接法作为既定前提。

## 2. 各包接线规格（工具名与 scope 逐一经源码核实）

五包合计 **9 个工具**：

| 包 | register 必填项 | 工具（scope） | 配置来源 |
| --- | --- | --- | --- |
| `@personal-agent/feeds` | `provider: new HttpFeedProvider()`；`subscriptions` | `feeds.collect`、`feeds.subscriptions`（均 `feeds:read`） | 订阅列表：宿主设置持久化 |
| `@personal-agent/mail` | 凭据经 §3 受信路径 | `mail.inbox`、`mail.accounts`（均 `mail:read`） | 授权码：`qq-mail-authcode`（§3） |
| `@personal-agent/productivity` | `storage: StoragePort`；`conversationId` | `todo.list`（`todo:read`）；`todo.create`、`todo.update`（`todo:write`） | storage：§4 适配器 |
| `@personal-agent/notifications` | `storage`；`policy` | `notifications.status`（`notifications:read`） | policy：宿主设置，缺省 `{}` |
| `@personal-agent/research` | `provider: new OpenAlexProvider()` | `research.search`（`research:read`） | 免 key |

配置缺失时：**连接器不注册、不报错**，任务侧看到 `UNSUPPORTED_CAPABILITY`。

## 3. 凭据注入与脱敏（v1.3：单一受信路径 + 明确存储异常规范化）

**v1.1 的错误**：同时主张「组合代码永不经手明文」与「装配层 `await secretStore.read` 后构造 Provider」——读取后丢弃局部变量不等于未持有明文，且裸调 `SecretStorePort.read` 绕过了 `ConnectorHost` 的 secretRefs 范围检查与取消检查。v1.2 已收敛为一条受信路径；v1.3 进一步修正“凭据存储异常已被现有实现自动脱敏”的错误描述。

**责任主体二分**：

| 主体 | 职责 | 明文接触 |
| --- | --- | --- |
| 普通组合层（Competition 组合代码） | 注册 `ConnectorFactory`（manifest + `create`）并**声明 `secretRefs: ['qq-mail-authcode']`**；持有 ConnectorHost 句柄；触发 `connect(id, signal)` | **永不** |
| 受信边界（`ConnectorHost.open` 构造的 `ConnectorFactoryContext`） | 在 `factory.create(context)` 内部经 `context.readSecret(ref)` 取得凭据并构造 `QQMailProvider` | 仅在此出现一次 |

当前 `ConnectorFactoryContext.readSecret`（`packages/connector-host/src/index.ts`）已经具备：

- **范围检查**：请求未声明的 ref → `SCOPE_DENIED`；
- **取消检查**：signal 中止 → `CANCELLED`；
- **缺失语义**：SecretStore 返回 `undefined` → `UNAUTHORIZED`（固定协议错误码，无原始错误正文）。

**当前尚未具备的保证**：`SecretStorePort.read(ref, signal)` 若抛出普通异常，`ConnectorHost.open` 会原样向上传播；现有代码并不会自动转成固定错误码，也不能保证原始异常正文不泄漏。因此 Phase 1 若获 goo122 对共享根边界的批准，需包含一个最小 ConnectorHost 加固：在 `context.readSecret` 内捕获 SecretStore 抛错；若 signal 已取消仍返回 `CANCELLED`，否则统一映射为固定 `EXTERNAL_FAILURE`（例如 `Connector credential store unavailable`），**不附带原始异常 message/cause**。该变化只规范化受信凭据读取失败，不改变 factory/provider 自身错误语义。

**失败语义**：

- 凭据缺失：`UNAUTHORIZED`；
- 凭据存储异常：`EXTERNAL_FAILURE`；
- 未声明 ref：`SCOPE_DENIED`；
- 取消：`CANCELLED`。

四种情况都不得把连接器记为已连接，也不得让原始凭据或 SecretStore 原始错误正文进入 Runtime 事件、工具描述或日志；某个连接器失败不阻断其他连接器继续装配。这里的“一致出口”仅指**连接器保持不可用并返回受控 ProtocolError**，不是把不同失败伪装成同一个错误码。

后续合成验收仅使用占位值：断言工具描述/Runtime 事件/日志均不含占位凭据；未声明 `readSecret` 被拒；signal 取消不半构造；SecretStore 返回 `undefined` 得到 `UNAUTHORIZED`；SecretStore 抛出包含哨兵正文的 Error 时得到脱敏 `EXTERNAL_FAILURE` 且输出不含哨兵正文。不得读取真实凭据或真实用户数据。

## 4. 已识别缺口：StoragePort 适配器

`@personal-agent/storage` 的 `openStorage(path)` 返回 SQLite `DatabaseSync`，而 productivity/notifications 需要契约的 KV 式 `StoragePort`（get/set/delete）。**缺 ~30 行适配器**（归属请 goo122 定）：`kvNamespace(db, table)` 单表 `(namespace, key, value JSON)`，UPSERT 写，与两包「单键一次写入」原子语义对齐。契约一致性测试 + 并发读写冒烟。

## 5. 分阶段落地

**Phase 1——Competition 工具注册（本方案批准后可开）**
- 组合层（与 `application/agentarts.ts` 同层）：五包按 §2 装配、mail 按 §3 走 ConnectorHost 工厂；注入路径以 §1 的 goo122 复核结论为准。
- 在 goo122 明确批准共享边界修改后，包含 §3 的 ConnectorHost SecretStore 异常规范化及针对性合成回归；不读取真实密钥。
- 含 §4 适配器；每包至少一条「审批流调用成功 + scope 拒绝 + 无配置不注册」集成测试，并覆盖 §3 的 `SCOPE_DENIED`/`CANCELLED`/`UNAUTHORIZED`/脱敏 `EXTERNAL_FAILURE`（预计 +13~15 项）。
- 验收：`npm run check` 全绿；无凭据环境启动正常、工具列表只含已配置连接器。

**Phase 2——调度闭环**：`planSchedules`/`ReminderTrigger` → `runtime.createSchedule()`；schedule 触发调 `drain()` 写入事件流（`acknowledge` 由桌面调用）。验收：安静时段结束自动裁定、提醒到点触发（fake 时钟）。

**Phase 3——桌面设置 UI（`zemeng`）**：订阅管理、邮箱绑定（授权码写入 SecretStore 加密实现）、通知策略页；绑定后热更新。

**未授权后续项（仅记录）**：Local Profile 全量入口；weather GeoNames 环境变量装配。

## 6. 边界与不做

- 根 `package.json`/锁文件不动；除 §3 在 goo122 批准后允许的最小 ConnectorHost 错误规范化外，不改其他公共接口。
- 普通组合层不以任何形式经手明文凭据（§3 的受信 `ConnectorFactoryContext` 是唯一读取通道）。
- 设计、Fake 或 CI 均不构成真实邮箱/AgentArts/设备/Evidence 验收，也不授权真实数据出机。

## 7. 请求

1. **@goo122**：按当前 `main` 源码复核 §1 的工具注入结论；若维持拒绝结论请指出对应代码或裁定走 CoordinationPort 专属路径/ADR。
2. **@goo122**：确认 §3 的单一受信路径，以及“在 ConnectorHost 内最小规范化 SecretStore 异常”为共享边界允许的 Phase 1 修改。
3. 适配器归属（§4）；Phase 1 授权与否。

# Settings/Connector 宿主 wire 契约（MOD-13，契约修订 1）

状态：**已公布（宿主/包侧）**。实现：`packages/connector-host/src/settings-wire.ts`（`SettingsConnectorWireApi`，包 `@personal-agent/connector-host`）。
测试：`packages/connector-host/test/settings-wire.test.mjs`。本契约**不实现任何业务连接器**（mail/calendar/todo/feeds 等仍由各自负责人交付）；设置页 UI 不在本 PR 范围（lab 负责接入）。

## 操作目录（修订 1）

| 操作 | 允许字段 | 语义 | 返回 |
| --- | --- | --- | --- |
| `settings.connector.list` | 无 | 仅列出已注册连接器的元数据与 health | `{revision,connectors:[{id,version,capabilities,authentication,verification,syncStrategy,health}]}` |
| `settings.connector.describe` | `connectorId` | 单连接器详情 + 该连接器的 proactive 来源绑定（含显式 `unavailable` 降级原因） | `{revision,connector,proactiveSources}` |
| `settings.connector.connect` | `connectorId` | 经真实 factory 建立连接；须传 `AbortSignal` | `{revision,connectorId,sessionRef,interactionRequired}` |
| `settings.connector.disconnect` | `connectorId` | 断开并回报清理状态 | `{revision,connectorId,disconnected,cleanupState}` |

## 生产语义（fail-closed）

- **未注册的 connectorId** → `UNSUPPORTED_CAPABILITY`（显式不可用，绝不伪装成可用能力）。
- **factory 真实失败**（如生产连接器尚未实现）→ 原样向上传播，wire 层不吞错、不降级、不假成功。
- **中止**：`context.signal` 已中止时 `connect` 直接 `CANCELLED`；连接中取消沿用 host 语义。
- **载荷校验**：未知操作、数组/非对象载荷、未知字段、非字符串 `connectorId` → `INVALID_ARGUMENT`。
- **秘密不外泄**：返回值只含元数据；secret 值只存在于 host 内部（测试断言 JSON 序列化不含 secret）。
- `revision` 恒为 `1`（`SETTINGS_CONNECTOR_WIRE_REVISION`）。

## 边界与非目标

- 不实现业务连接器、不接设置页 UI、不写跨任务持续授权（MOD-05，goo122）。
- 未注册域名的 list 永远诚实返回空数组，不发明占位连接器。
- 真实云/真实账号验收仍待（保持 MOD-13 in_progress）。

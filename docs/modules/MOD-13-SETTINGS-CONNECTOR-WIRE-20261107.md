# MOD-13 生产 settings/connector 宿主契约（2026-11-07 交付记录）

负责人：zemeng（zemeng5208）。基线：main `0e7f3aa1`。对应清单缺口：ROADMAP MOD-13「生产 settings/connector wire API、跨任务持续授权与真实云验收仍未完成」。

## 交付

- `packages/connector-host/src/settings-wire.ts`（新文件）：`SettingsConnectorWireApi` — 公布生产设置面可调用的操作目录（list/describe/connect/disconnect，契约修订 1），严格载荷校验、编码错误（`ProtocolError`）、JSON 安全返回。
- `packages/connector-host/src/index.ts`：仅新增一行 `export * from './settings-wire.js'`。
- 契约文档 `docs/interfaces/CONNECTOR_SETTINGS_WIRE_CONTRACT.md`。
- 测试 `packages/connector-host/test/settings-wire.test.mjs`（6 项）。

## 生产语义

- 未注册 connectorId → `UNSUPPORTED_CAPABILITY`（显式不可用）；factory 真实失败原样传播（不假成功）；已中止信号 → `CANCELLED`；秘密不进返回值。
- 不实现业务连接器（mail/calendar/todo/feeds 归 Potatos/goo），不接设置页 UI（归 lab），不碰跨任务持续授权（MOD-05 归 goo）。

## 怎么测的

- `node --test test/*.test.mjs`（connector-host）**20/20 通过**（含既有 14 项 + 新 6 项：目录公布、list 空态诚实、describe 未注册拒绝、connect 真实结果/真实失败传播、disconnect 清理状态、中止与畸形载荷编码拒绝、JSON 不含 secret）。
- `npm run typecheck --workspace=@personal-agent/connector-host` 通过。

## 没法测的 / 显式不可用

- 真实云连接器、真实账号授权读回：需真实环境，仍待验收；本契约显式不提供任何假实现。
- 设置页 UI 接线：归 lab（前端），本 PR 未触碰。

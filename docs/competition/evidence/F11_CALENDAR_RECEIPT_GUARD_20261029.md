# F11 日程改写与旧提醒失效验证边界（2026-10-29）

- `apps/runtime/src/application/workflow-f11-calendar-receipt-guard.ts` 是供将来 F11_N05 调用的只读 guard：必须找到原任务中 Policy allow、已启动且 confirmed 的 `calendar.update` 执行记录，校验版本、原参数和授权引用，再通过可信端口分别检查原图决策与授权、同一事件更新读回以及同一旧提醒已失效。重新检查以发现验证期间变化。仅有 `calendar.events` 读回不能证明日程改写。
- 该 guard **不注册 workflow.host.f11_n05、不调用 calendar.update、不取消提醒**。缺少上述可信口时 unavailable。日历连接器 `calendar.update` 公共输入没有 `newType` 字段：后续必须基于产品语义和经用户授权的实际日程属性建立可验证映射，不得猜测把类型塞入其他字段。需处理授权、并发版本、部分成功、未知结果与恢复，不得重复盲写。
- 可信回调由组合层负责原 N03/N04 的事件身份和用户授权、实际日历更新结果/读回及本地提醒的精确绑定；连续读回并非跨系统事务，不能取代调用方的并发控制。当前无 Desktop 注入、无真实账号/设备测试、无 F11 全图回执，因此不勾选清单。
- Node 24.15：`node node_modules/typescript/bin/tsc -p apps/runtime/tsconfig.json` 通过；`node --test apps/runtime/test/workflow-f11-calendar-receipt-guard.test.mjs` Synthetic 测试 4/4 通过，覆盖只读冒充、授权/输入不符、未知写、失效缺证和验证期间变化。
- 归属：Runtime/Policy guard 按 Owner 授权代 goo122 实现；日历工具和业务接线需与 Potatos498 对齐。

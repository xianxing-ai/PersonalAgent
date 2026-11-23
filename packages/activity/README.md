# 活动时间线

目标 profile：`huawei_ict_agentarts`。工程责任：CW-05 / MOD-28（zemeng5208）。接口状态：`provisional`。

这个包只保存「它替我做了什么」。记录只追加：撤销是一条新的补偿结果，不改原来的行。摘要不含消息正文和参数明文。

## 来源

| 来源 | 现在 | 合入后 |
| --- | --- | --- |
| `plugin` | `fromPluginAction`，由插件目录的 `onActivity` 接入 | 已在 main |
| `autonomy` | `fromAutonomyAudit` | #630 的 `AutonomyAuditRecord`：传 `auditId`、`toolName`、`tier`、`disposition`、`rollback`、`reason` 和补偿工具名。不传 `argumentsDigest` 或补偿参数 |
| `proactive` | `fromProactiveOutcome` | #631 的 `TriggerOutcome`：传 `eventId`、`source`、`kind`、`status`、`ruleId`、`risk`。不传 `SourceChangeEvent.summary` |
| `repair` | `fromRepairDecision` | #633 的 `RepairDecision`：传 `fingerprint`、`strategy`、`classification`、`risk`、`result` 和决策 `reason`。不传 `FailureSignal.message` |

没有补偿动作时 `undo` 拒绝。已撤销的记录不能再撤。补偿真正执行由调用方注入；本包不调用 Runtime、Policy 或插件安装器。

`list` 只把已接入补偿执行器的来源标成可撤销。视图默认返回最新 40 条，更早的记录留在文件里。

## 验证

`npm test --workspace=@personal-agent/activity`

没有云端调用，也不把 Fake 记录写成冻结接口。

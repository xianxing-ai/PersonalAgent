# MOD-28-PERSISTENT-CONSUMER-01：持久图影响消费闭环

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- 日期：2026-09-12；Profile：huawei_ict_agentarts；MOD-28 / PA-025。
- 负责人 zemeng；待非作者评审者 goo122；状态 review（本地验证通过，待评审与集成）。
- 分支 `codex/zemeng/mod27-28-persistent-consumer`；实现基线 `87ee444`（PR #38），
  已同步 `188f925`（PR #39）。
- 所有权：`packages/cognition`；跨模块测试位于 `tests/integration`。
- 消费接口：`@personal-agent/goals/store` 的 provisional CoordinationStorePort；
  只接收可信宿主已经绑定的端口，不选择 namespace，不导入 Runtime 私有实现。

## 行为

`analyzeStoredImpact` 读取一次持久快照并执行既有 KEEP/RECHECK 分析。
`commitStoredPlanRevision` 对显式 Plan 候选、目标版本及依赖重新校验，只追加一个 Plan
版本。图 revision 已过期或提交瞬间发生 CAS 竞争时返回最新快照与影响报告，不自动重试
写入；仅 Plan revision 过期时沿用 `proposePlanRevision` 的 `REVISION_CONFLICT` 错误，
不返回 graph revision 相等的误导性冲突结构。调用方必须重新审阅并提交新请求。存储不可用、
非法内容及不适用目标仍明确失败；完整请求校验在读取绑定存储前完成。

该函数不修改 TaskRuntime 终态、不调度提醒、不执行工具、不决定语义是否正确。
只改 summary 而不重绑旧依赖不会消除 RECHECK；只有调用方显式更新完整依赖链后，
当前图才可能回到 KEEP。KEEP 仍不代表任务完成或外部动作已发生。

## 验收与限制

- Fake：绑定读取、副本隔离、显式追加、无关节点保留、陈旧请求、提交时竞争仅写一次、
  最新影响重算、额外字段/非受影响目标拒绝。
- SQLite：临时 Runtime 数据库中重放会议改期，显式更新 Goal/Decision，制造并发版本，
  冲突后刷新再提交 Plan；关闭重启后 revision 10、修订内容及全 KEEP 状态读回。
- 全部使用合成数据；没有云、真实账号、外部执行或私人图谱。
- MemoryQueryPort/FactChangeFeed 仍 unavailable；真实事实订阅、物理删除、审批 UI、
  大图性能和 AgentArts 语义修复不在本工作包。

验证（2026-09-13 收尾，Node 26.3.0 / npm 11.16.0）：

- `npm.cmd run typecheck --workspace=@personal-agent/cognition`：通过。
- `npm.cmd test --workspace=@personal-agent/cognition`：15/15 通过，其中新增消费者断言
  仍在 5 个测试中。
- `node --test tests/integration/mod-27-28-persistent-cognition.test.mjs`：1/1 通过；
  SQLite 关闭重启后的 revision、修订正文与影响状态均完成读回。
- `git diff --check` 通过。首次集成断言把已显式重绑的 Decision 误列为 RECHECK，
  实际报告只剩 Plan，修正测试预期后重新运行通过；生产代码无需因此修改。
- 受限执行环境首次运行两个 Node 测试命令时报告 `spawn EPERM`；按最小权限重试后取得
  上述通过结果。根 `npm run check`、真实 AgentArts、事实订阅与外部 Evidence 本次未重跑，
  不作为本工作包当前证据。

当前环境不同于项目要求的 Node 24.15.x / npm 11.12.x，目标版本与干净 CI 待后续 PR 验证。
根公共协议、迁移、Runtime 实现、package/lock 均未修改。没有云调用或外部副作用。

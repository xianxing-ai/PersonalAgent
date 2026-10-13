# MVP-TWIN-B-MAIL-ANALYSIS-01：邮件分类到 AgentArts 的持久交接

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；负责人 zemeng；状态：`review`，待主任务集成及非作者评审。
- 工作树：`2972/PersonalAgent`；分支：`codex/mvp-twin-b-mail-analysis-outbox`；基线：`8df399b`。
- 文件范围：Runtime Application 的 `inbox-triage.ts`、`mail-triage.ts` 及专属测试。本包不修改 Desktop、公共 wire Schema、连接器或 Runtime 任务库。

已确认的信头页经现有 Laya 分类、`prepareTriageDispatch` 回执校验后，将需进一步机器推理的项目与分类结果一起持久保存。`main_agent` 和 `review` 均用于 AgentArts 消费；`review` 不代表人工审批。普通已授权事项自动推进，执行权限仍由 Runtime/Policy 判断。

## 宿主接线

QQ 宿主提供三个同步方法，均接受 `{deadline, signal}`：

- `pendingAnalyses(context)`：返回当前版本的 `pending`、`deferred` 项，附当前本地 `sessionId`；消费方只提交 `pending`。
- `readAnalysis(workKey, context)`：读回当前版本，包括已 `accepted` 的项目，供每次云端发送前检查。
- `confirmAnalysisAccepted({sessionId, workKey, sourceRevision, receiptId, projectionDigest, taskId}, context)`：Runtime 受理任务后绑定回执。相同绑定可重复确认；不同任务、旧版本、不同投影及 deferred 均拒绝。

项目包含稳定 `workKey`、原分类 `receipt`、来源版本、路由及仅信头的 private `projection` 和摘要。账号/目录留在本地存储，不随公开分析返回。接线宿主由 workKey 派生既有 Runtime 的幂等键，并在恢复时查找真实任务，覆盖提交成功但确认尚未落盘的间隙；本包不创建第二个任务库。

首次云发送可能早于任务提交响应和 accepted 确认，因此发送前回读可看到 pending。接线方必须将真实 Runtime 任务绑定到原会话、workKey、版本、回执及投影，并检查独立的当前云分析许可；本地读取许可不等于出云许可。后续发送仍要逐次同步回读 accepted。旧会话任务不得借新的许可恢复发送。

## 持久状态与失效

使用原模块存储键，将 payload 从 v1 升级为 v2，保留原分类和 cursor。没有 receiptId 的旧分类在下次获得当前信头页时重分类，不从旧统计数据编造 outbox。调用方继续注入现有加密存储；没有数据库迁移或清库。旧版本程序不支持新 payload，回退代码前需保留对应版本的存储备份。

新来源 head 在等待分类前先持久记录，并使旧 analysis 失效。每块分类和 outbox 先保存，完整页完成后才推进 cursor；暂不可用的分类保留 deferred 并允许现有重试入口继续。已观察的历史版本回放不会重新激活旧分析。

正常读取完成后，分析会话保留至本次期限；取消、关闭、读取失败、读取取消或返回错误账号/目录时撤销。重启不恢复分析会话；新的本地授权会话才能读取保留的 outbox。accepted 表示 Runtime 已受理绑定，不代表 AgentArts、工具执行或用户目标已完成。

## 验证与限制

Runtime 构建通过；`node --test --test-isolation=none apps/runtime/test/inbox-triage.test.mjs apps/runtime/test/mail-triage-analysis.test.mjs` 为 3/3 通过；`git diff --check` 通过。专属用例使用实际 Laya 分类代码、生产加密存储代码和真实 Runtime SQLite；推理、mail.inbox 及 safeStorage 为显式 Fake，不连接 IMAP，不运行真实模型。

覆盖持久恢复、部分分类与 deferred、回执和任务绑定、旧版本失效、同步 accepted 读回、会话撤销与期限。未证明真实 DPAPI/Electron、邮箱、AgentArts、Desktop 云许可或真实发送行为；这些由主任务整合验收。未运行全仓检查。

当前环境 Node 26.3.0 / npm 11.16.0 与仓库约束 24.15.x / 11.12.x 不一致。为当前工作树补齐已有模型依赖的 ws 及类型，仅修改 node_modules，未变更依赖声明或锁文件。

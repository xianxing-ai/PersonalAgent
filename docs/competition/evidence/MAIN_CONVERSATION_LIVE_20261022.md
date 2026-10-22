# 默认主对话真实连通性复验

2026-10-22，工作树 `D:/worktree/f809/PersonalAgent`，Competition profile。源码基线 `cb120aca` 合入当前 main `c15855f5`，另含原邮件批次资源 generation 与授权卡会话归属的 Main 接线；这些邮件路径未在本次触发。完整 `npm run build` 退出 0，Node 24.15.0 / npm 11.12.0。

用户反馈另一台“刚同步仓库”的电脑所有对话一直待核实；尚未提供那台电脑的具体 SHA、任务 ID 或日志。本记录只验证本机新会话，不能证明另一台电脑已修复。

入口 `tests/manual/desktop/main-conversation-live.cjs` 通过原 Electron Desktop 面板发送两条公开文本，使用原加密 AgentArts 配置与 Local State 的隔离副本。没有复制历史、邮箱配置或私人数据库，没有启动 Laya、Fake Provider 或发布新部署。

| 原任务 | 最终状态 | SQLite 原回答 |
| --- | --- | --- |
| `515c3227-1670-4e56-8c9f-66f0112d9c66` | succeeded | 链路正常 |
| `33f5f370-651a-4644-bf5c-1f325eb0a7df` | succeeded | 第二轮正常 |

原持久摘要附带 `profile=huawei_ict_agentarts; verification=unverified`；普通对话回复不冒充外部业务写入验证。原 inflight/received 已消费为 null。回执与原隔离 Runtime 数据库位于忽略目录 `.cache/main-conversation-live-CrBnnA/`，原 runner 退出 0，创建的独立应用已关闭。后续补强 runner 的持久回答断言，与这次 SQLite 独立读回一致，没有为补强断言重复模型调用。

相关 Main 合并及邮件资源门禁的针对性检查 34/34，0 fail/skip，日志 `.cache/main-merge-focused-20261022.log`。这些离线检查与本次真实两轮对话分别记账，不计为所有连接器、设备或全部工作流完成。

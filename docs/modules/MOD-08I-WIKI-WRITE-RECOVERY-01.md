# MOD-08I：Wiki 受控写回与来源投影恢复

- Profile：`huawei_ict_agentarts`，真实云验收继续暂缓
- 负责人：`goo122`；非作者评审：其他已登记协作者
- 状态：`review`；实现、专项验收及完整门禁已完成；2026-10-11 已获 Git 交付授权，待非作者评审和集成
- 基线：`main@e86bac53`；工作树：`.worktrees/goo122-wiki-source-revisions`
- 分支：`codex/goo122-wiki-source-revisions`；依赖同分支 MOD-08G/H
- 决策：[ADR-0016](../adr/0016-wiki-write-projection-recovery.md)，proposed

## 实现范围

复用现有 `knowledge.apply_note_patch`，正文仍经过 Runtime/ToolGateway/Policy、精确
expectedSha256/edits、选中文件范围、原操作持久备份和 Windows 锁定读回。
没有第二套模型、工具或写入循环。BOM、frontmatter、链接保护及用户改动冲突语义不变。

受信工具工厂可注入 `KnowledgeWriteProjectionPort`。正文派发前在原 TaskRuntime
保存各 run 的来源绑定与参数摘要；已验证回执将投影置 pending。投影失败保留待恢复记录，
正文已知结果继续按原执行回执交付，不触发第二次写入。无变更/冲突回执不更新记忆。

Desktop 对同 sourceId/configRevision/path 的已确认活跃事实进行分页重校验；真实读回
证明变化才追加观察撤回。保留原摘要与历史，缺失/不确定读回保留 pending；不自动确认新
正文、不更新无关来源。原事实已撤回或已重新确认时，恢复不会重复追加旧观察。

重启遍历 Runtime 的分页任务检查点，只恢复已知 pending。unknown 必须先经过既有
`reconcileKnowledgeWriteTask` 核对原 intent/execution/参数摘要、取得真实 Evidence 并
finalize。管理页“核实原整理任务”同时返回投影是否待恢复。TaskRuntime 继续持有终态，
投影不会重开已完成任务。来源切换、撤销、过期、取消均不以历史回执恢复读取许可。

接口为 host-only provisional，无新 wire capability、数据库迁移或依赖。
正文与 SQLite 不具备跨存储原子事务；这是可核实的恢复链路，不是跨库原子性保证。

## 已执行的专项验收（2026-10-10）

- 正确基线依赖构建及 Runtime 构建通过。
- 合并执行受影响工具、投影、原核实器、Desktop Wiki 来源及真实写回集成：**18/18**，
  **0 skip**，日志 `.cache/wiki-p4-focused-tests.log`。
- 新投影测试 **4/4**：失败持久恢复、unknown 不派发投影、旧任务兼容、摘要替换拒绝、
  来源撤销/替换/取消/过期、并发去重、读取中撤销不确认完成。
- 新真实 Windows 合成文件集成 **2/2**：
  1. 正文真实写入成功、模拟投影失败，Runtime 保持 succeeded；重启后仅恢复投影。
  2. 正文真实写入后模拟进程路径中断，Runtime 保持 waiting_reconciliation；重启后
     单独投影恢复仍 unknown，原操作读回/finalize 后才完成并恢复投影。
  两条链路正文写入均 **1 次**，恢复新增正文写入 **0 次**；恢复前后字节一致。
  失效事实追加到 revision 2，重复恢复及随后按需检查不增版；无关事实、笔记保留。
- 最终 `npm run check` **exit 0**：架构、生成类型、类型检查、工作区测试和根集成全部
  通过；共 **2662 项，2637 pass、25 skip、0 fail**。其中 Desktop **709 pass/2 skip**、
  Runtime **443/443**、根集成 **25/25**；跳过项不计为真实服务能力。
- 最终 Competition Electron 私人记忆 smoke 通过：隔离合成 Vault/SQLite、显式 Fake
  原生决定；保存、更正、撤回、重启、删除及来源失效展示均成功，云传输尝试 **0**。
- Electron 源码及管理控件 JavaScript 语法、`git diff --check` 通过。

完整日志：`.cache/wiki-p4-full-check.log`；最终窗口日志：
`.cache/wiki-p4-private-memory-smoke.log`。原 Git 夹具及通用窗口复验见 MOD-08H 续记。

原生决定与配置绑定使用显式 Fake；真实写入/读回发生在独立公开合成 Vault，使用实际
SQLite、Runtime 和 Windows helper。未读取或写入 `D:\test\知识库`，未调用 AgentArts。

## 范围外与下一阶段

MOD-08/09 仍 `in_progress`。完整 LLM Wiki、后台 watcher/全库索引、可安装 Obsidian
插件、生产私人 Feed/Goal 投影及真实 AgentArts 验收仍未交付。确认新摘录继续逐条进行。

原写入工具保存的正文备份不等于已纳入私人记忆删除协调器；私人备份与跨库派生副本需
进入宿主管理清单后，按明确范围验证删除、WAL 和混合批次保留。本包没有清除任何原备份、
私人文件或他人数据，不能据此宣称整套删除覆盖完成。

本分支联合交付 MOD-08G/H/I 与必要门禁修复；2026-10-11 用户已授权提交、推送和创建 PR。

# MOD-08J：Wiki 后台只读来源监视

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


- Profile：`huawei_ict_agentarts`；负责人：`goo122`；非作者评审：其他已登记协作者
- 状态：`review`；实现、专项、完整门禁及原生窗口复验通过，已交付 [PR #321](https://github.com/zemeng5208/PersonalAgent/pull/321)，尚未非作者评审及集成
- 依赖：[PR #320](https://github.com/zemeng5208/PersonalAgent/pull/320)，`a871664b`
- 分支：`codex/goo122-wiki-source-monitor`；复用本任务工作树 `.worktrees/goo122-wiki-source-revisions`
- 拥有目录：Runtime Application、Desktop 可信组合/来源管理 UI、相关测试与文档
- 决策：[ADR-0017](../adr/0017-wiki-source-monitor.md)，proposed

## 实现与边界

通过公开进程内 `createWikiSourceMonitor` 装配只读监视，由 Desktop 现有 tick 驱动，
每 30 秒最多启动一次检查，同实例不并发扫描。启用所选知识源后取得当前来源 lease；
切库、撤销、期限到期、取消或关闭阻止迟到投影。

目录快照只在本进程保留页面身份、路径、正文 revision；首次检查或重启会重校验
同来源绑定的既有确认事实。后续按变化路径、移动旧路径和替换页面的位置批量校验，
复用 Memory 的原失效事务；新页面不自动形成事实，也不发送云端。

扫描或局部投影失败时不推进目录快照，保留 retry_pending，之后仅重试只读校验。
暂时缺失与空目录不推导删除，旧事实和历史保留。重复校验不重复增版。界面仅显示
检查状态和页面数，不回显私人路径或原始异常。未新建任务库、调度器或持久正文索引。

`revalidateSource` 与批量 `revalidateSources` 共用原写回恢复投影；前者兼容既有调用。
没有 wire capability、数据库迁移或新增依赖；接口仍 provisional。

## 验证记录

- Runtime 构建、Electron JavaScript 语法及 `git diff --check` 通过。
- 受影响监视器、Desktop Wiki 来源、既有写回投影及真实写回集成：**18/18**、**0 skip**；
  日志 `.cache/wiki-monitor-focused.log`。
- 新监视器测试 **4/4**：首次全量既有事实检查、无变化零投影、移动/同路径替换、扫描与
  局部投影失败不推进快照、源切换、定时节流、并发共享、关闭/撤销/取消/过期。
- 新本机合成文件/SQLite 测试 **2/2**：不打开 Memory UI 即失效旧事实，扫描失败后恢复
  不增重复版本；真实 SQLite 已提交失效后再模拟投影失败，重试仍保持 revision 2；新页面
  不自动存长期记忆；缺失/空目录保留确认历史，页面重新可核实后
  才按真实身份变化使旧事实失效。原生决定及安全存储为显式 Fake。
- 实际 Competition Electron 后台定时链路通过：保存合成确认事实后改写合成笔记，
  不刷新 Memory UI、只读独立 SQLite，30 秒监视检查使旧事实失效；后续界面展示、删除及
  原生命周期回归通过，云传输尝试 **0**。日志 `.cache/wiki-monitor-electron-smoke.log`。
- 首次完整 check 的 Desktop 阶段 **4 fail**：退出测试的 VM 未声明新增监视器，导致
  清理提前报错。已补齐 Fake 声明、保留原断言，并新增拒绝退出不关闭、接受退出先关闭
  监视器再关闭 Runtime 的顺序断言；专项 **11/11**，日志 `.cache/wiki-monitor-quit-tests.log`。
  首次完整日志 `.cache/wiki-monitor-full-check.log` 保留失败记录。
- 最终 `npm run check` **exit 0**：**2669 项，2644 pass、25 skip、0 fail**；其中
  Desktop **712 pass/2 skip**、Runtime **447/447**、根集成 **25/25**。架构、生成类型、
  类型检查与构建通过；日志 `.cache/wiki-monitor-final-check.log`。跳过项不计为真实能力。
- SQLite 部分提交后的重试专项 **8/8**，日志 `.cache/wiki-monitor-partial-projection.log`。
  最终 `git diff --check` 通过；未修改 root 工作树及其他协作者文件。

## 剩余范围与交付

本包已在 [PR #321](https://github.com/zemeng5208/PersonalAgent/pull/321) 提交并推送；
目标为父 PR #320 分支，父分支保持不变。两条 PR 均未集成，
整个 MOD-08/09 保持 in_progress。
后续本地 [MOD-08K](MOD-08K-BACKUPS-INDEX-PLUGIN-01.md) 补充临时全文索引、可安装
只读插件及应用 SQLite 备份协调；持久索引、插件真实宿主/Runtime 配对、其他绑定跨库
副本和真实云消费尚未实现或验收。
本次未读取、修改或删除私人 Vault，也未调用 AgentArts。

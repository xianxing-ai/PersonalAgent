# MOD-08K：应用备份删除协调、临时索引和 Obsidian 插件

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


- Profile：`huawei_ict_agentarts`
- 负责人：`goo122`；评审者：`zemeng` 或其他已登记非作者协作者
- 状态：`review`；已提交推送 [PR #321](https://github.com/zemeng5208/PersonalAgent/pull/321)，尚未非作者评审或集成
- 工作树：`.worktrees/goo122-wiki-source-revisions`
- 分支：`codex/goo122-wiki-source-monitor`
- 基线：PR #320 `a871664b`；同时保留本地 MOD-08J 来源监视器增量
- 交付：`9c31fac6`，目标分支为 PR #320 的 `codex/goo122-wiki-source-revisions`
- 方案：[ADR-0018](../adr/0018-managed-backups-and-volatile-index.md)

## 交付范围

1. 用真实目录清单替换正式私人消费/删除宿主的空备份数组。已登记失联副本拒绝，
   不将缺失视为清理成功。SQLite 备份重用权威删除标记，逐事实清理和读回，保留无关数据。
   被占用、损坏、非 unbound 或版本冲突副本保持 pending，重启继续，不重复工具写入。
2. 用户选择保留整篇 Wiki 写回镜像。清单包含原恢复目录；不能证明无关时删除显示未完成，
   不移除原镜像、回执或锁。界面与原生删除确认展示此范围。
3. 文件系统和 Obsidian API 共用 8 MiB 上限的临时全文行索引。正文不持久化；新扫描失败
   清空缓存；编辑、移动、删除反映在后续查询。私人事实删除和撤销清除当前缓存。
4. 原交付桌面插件包：`main.js`、`manifest.json`、`knowledge-obsidian.cjs`；文件夹选择、
   本机检索、旧版本引用拒绝、跳转、清索引、撤销和卸载。没有自动存长期记忆或云调用。

## 验收

- 完整 `npm run check` **exit 0**：**2679 项，2654 pass、25 skip、0 fail**；
  Desktop **717 pass/2 skip**、Knowledge **42 pass/1 skip**、Runtime **447/447**、
  插件 **3/3**、根集成 **25/25**。日志 `.cache/wiki-backup-final-check.log`。
- 最后原恢复镜像格式校对后的备份/删除/索引/插件专项 **12/12**，
  日志 `.cache/wiki-backup-final-focused.log`；来源/备份/插件生命周期专项 **15/15**，
  日志 `.cache/wiki-backup-lifecycle.log`。
- 独立插件实际产物加载和命令窗口 **3/3**：显式文件夹选择、纯文本展示恶意 HTML
  摘录、引用旧版拒绝、读中撤销不导航、关闭窗口并撤销请求。
  使用显式 Fake Obsidian API/DOM，不冒充真实 Obsidian 应用验收。
  日志 `.cache/wiki-plugin-ui-final.log`。
- 实际隔离 Competition Electron 验收通过：保存/更正/撤回/重启/删除、后台来源检查；
  测试从实际活动库生成合成 SQLite 备份，界面删除后读回备份无目标事实。
  原生决定与安全存储为显式 Fake；云传输尝试 **0**。
  日志 `.cache/wiki-backup-electron-smoke.log`。
- 首次完整门禁因插件 README 尚未落盘在架构检查失败，补齐后原门禁通过；原日志
  `.cache/wiki-backup-full-check.log` 保留。专项最初发现测试 SQL 误用 summary 列及
  VM 跨 realm 对象比较；按真实 payload/值修正后通过。插件 UI Fake 缺标准
  AbortController 亦已补齐，未放宽安全断言。
- `git diff --check` 与改动 JS 语法检查通过；插件包生成于
  `.cache/personal-agent-knowledge-0.1.0.zip`，含 main/manifest/原适配器 CJS。
  所有夹具为合成数据；没有访问或改写用户真实 Vault，没有云调用。

## 继续入口

真实 Obsidian 宿主验收在 [MOD-08L](MOD-08L-OBSIDIAN-INSTALLATION-01.md) 补齐：真实宿主发现
旁置模块加载失败，改为单文件内联包并通过合成 Vault 安装/检索/卸载验收。
精确恢复镜像关联、跨库 Feed 和插件 Runtime 配对继续保留；云端验收按用户要求暂缓，MOD-08/09 不标 done。

# MOD-08H：Desktop Wiki 来源与确认记忆投影

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


- Profile：`huawei_ict_agentarts`
- 负责人：`goo122`；非作者评审：其他已登记协作者
- 状态：`review`；本地实现、相关回归及 Wiki 专项窗口验收完成；下列既有阻塞已修复并专项复验，完整 check 的最新结果见 MOD-08I；2026-10-11 已获 Git 交付授权，待非作者评审及集成
- 基线：`main@e86bac53`；实际工作树：`.worktrees/goo122-wiki-source-revisions`
- 分支：`codex/goo122-wiki-source-revisions`，与同一分支的 [MOD-08G](MOD-08G-WIKI-SOURCE-REVISIONS-01.md) 联合交付
- 目录：Knowledge/Memory 公开端口、Runtime Application、Desktop 可信组合与管理界面、必要测试与文档
- 决策：[ADR-0022](../adr/0022-wiki-source-identity.md)，proposed；接口仍 provisional

## 行为与权限

Desktop 私人记忆管理使用已有 `knowledge-source-config` 的原生目录选择、加密持久配置、
根目录身份及 sourceId/configRevision。知识源设置与记忆检索共用来源；切库、停用、撤销和
宿主关闭使在途 Wiki lease 失效。读取许可释放后不可复用。重启可恢复有效知识源配置，
不会恢复云端出机许可，也不会自动保存摘录。正式组合不回退到另一套会话 Vault。

摘录及更正继续经过原生逐条确认和确认后的精确读回。事实身份绑定 sourceId/pageId/行号，
保留来源 namespace/configRevision/dataLevel/页面 ID/相对位置/正文 revision。
`wiki-v1:` 引用是证据，不是读取权限：持久引用不保存短时读许可的 validUntil，重新读取必须
由可信宿主授予有效 lease。相同来源和摘要在许可续期或重启后不产生重复事实版本。
事实的语义有效期仍由既有 Memory 字段记录；不能从永久有效事实推导永久文件读取权。

新鲜第一页管理查询及任务消费前验证来源。版本或身份变化、成功读回证明的同卷移动，
使原确认事实增加一个 `withdrawn/external_observation` 版本，保留原摘要、证据与历史；
界面显示“来源已变化”。该观察不是用户确认，不生成新摘要。新摘录仍需逐条确认才能
重新激活。确认窗口期间再次修改正文或来源配置，保存与消费均拒绝旧数据。

临时读取失败、缺失文件、空扫描、配置不匹配不会证明删除，不修改事实历史；
任务消费仍拒绝该不可用来源。已有分页快照保持固定，新鲜第一页刷新后的版本用于新的
查询；后续分页中的事实也会在实际消费前重新校验。本包无后台 watcher 或全库持续同步。
旧格式事实保持历史管理与删除可用；正式消费需从当前知识源重新检索和确认。

## Feed、迁移及兼容性

`invalidateUserFactSource` 是 SQLite 可信写端口，要求已有用户创建记录、精确头版本和
sourceRef，在事务内追加观察撤回及现有 Feed 序列。已撤回版本重验不再追加；未知字段、
跨 namespace、来源替换、过期、取消和旧版本均拒绝。管理员仍可发现和彻底删除该事实历史。
没有 Schema、wire capability、依赖或数据库迁移；原 Knowledge 工具 wire 输出不变。

Runtime `revalidateWikiFact` 复用 Wiki 与 Memory 公开端口，既有 FactChangeFeed 和
MemoryProjectionApplication 可处理变化。合成验收显式绑定私人 Feed，并验证依赖目标
RECHECK、无关目标 KEEP。Desktop 私人库保持既有未绑定删除保障，**不自动注册到公共
Feed 或 Goal 投影**；生产私人跨库投影需先接通对应擦除协调及数据授权。
任务仍走既有逐任务原生消费确认；云调用保持暂缓。

## 验证

2026-10-10，专项合成回归 31/31：Wiki 12、Memory 新事务边界 1、根 Feed/Goal 集成 1、
Desktop Wiki 来源 6、既有私人记忆 4、既有来源配置 7；0 失败、0 跳过。
Windows 首次测试的 SQLite 观察连接清理顺序已修正；Cognition 断言按 RECHECK/KEEP
语义校对，没有改动既有 Cognition 行为。

最终结果：

- 根 build、架构、契约夹具、生成类型及全部类型检查成功。
- `npm run check` **退出 1**：本轮合计 2633 项、2605 通过、3 失败、25 跳过。
  其中 Knowledge 40/41（1 跳过）、Memory 45/45、Runtime 439/439。
  两项既有 Coding Tools Git 测试在替换夹具目录时遇到 Windows `rename EPERM`；
  `packages/coding-tools` 与基线无 diff。单独复跑 `git-tools.test.mjs` 为 29/30，
  仍有 unknown-ref/index-lock 夹具 EPERM；未改生产代码、放宽断言或隐去失败。
- 另一项关闭检索的失败来自本次 lifetime 取消改变了既有报错文字，已恢复关闭错误边界。
  专项生命周期复跑 9/9；最终按完整门禁相同 .NET 8/helper 环境复跑全部 Desktop：
  **711 项、709 通过、2 跳过、0 失败**。中途一次单独复跑漏配 .NET 8 的两个 helper
  构建失败已在正确环境复验通过。未将这次环境失败当作代码缺陷修复。
- 因工作区测试失败而未进入的根集成单独执行：**23/23**，包含 Wiki→确认 Memory→
  Feed→Goal 的合成验收。
- `node apps/desktop/test/private-memory-smoke.cjs` 成功：真实 Electron 窗口、隔离合成
  Vault/SQLite、明确 Fake 原生决定；保存、更正、撤回、重启、删除及 Wiki 编辑失效
  展示均通过，云传输尝试 **0**。
- 既有 Runtime Application 窗口脚本默认启动 Competition 页面，查找 Local 的
  `#model-add` 超时；按其保留流程显式设置 `PA_RUNTIME_PROFILE=local` 后通过：
  7 次本机合成模型服务请求、2 次取消。这是既有兼容性证据，不计入 Competition 云验收。
- 通用 `test:smoke` 退出 1：显式 Fake Runtime、隔离 userData，模型菜单第二次
  `#model` 点击被 `#model-notice` 遮挡，等待 30 秒超时。该脚本及 conversation 目录
  与基线无 diff；未用 force click、改断言或改无关菜单代码绕过。Wiki 专项原生窗口
  验收成功不替代该通用失败，后续应按 Desktop 所属工作包处理。
- 最终 JavaScript 语法及 `git diff --check` 成功；根工作树及其他协作者文件保留。

日志位于本工作树忽略目录：`.cache/wiki-wiring-build.log`、`.cache/wiki-wiring-tests.log`、
`.cache/wiki-wiring-check.log`、`.cache/wiki-git-fixture-recheck.log`、
`.cache/wiki-desktop-final-sdk8-tests.log`、`.cache/wiki-lifecycle-final-tests.log`、
`.cache/wiki-wiring-integration.log`、`.cache/wiki-private-memory-smoke.log`、
`.cache/wiki-runtime-smoke.log`、`.cache/wiki-runtime-local-smoke.log`、`.cache/wiki-window-smoke.log`。
合成文件、SQLite 与明确 Fake 原生决定不构成真实用户确认或 AgentArts 验收。

## 交付与后续

2026-10-11 用户授权提交、推送和创建 PR；MOD-08G/H/I 联合交付及评审其必要依赖，
整个 MOD-08/09 尚未完成。没有修改私人 Vault、调用云端、创建可安装 Obsidian 插件或完整 LLM Wiki。

2026-10-10 续记：先修复既有门禁，再实现 [MOD-08I](MOD-08I-WIKI-WRITE-RECOVERY-01.md)。
Git 文件复制后重命名增加 Windows EPERM 有限重试，复用已有独立 PR #319 的夹具修复；
保留全部根身份与未知副作用断言，专项 **30/30**、0 skip。模型菜单改为相对输入工具栏
定位，正常点击不再被动态状态文字遮挡；新增按钮实际命中检查，通用 Fake Runtime
Electron `test:smoke` 通过。原失败记录保留，复验日志为 `.cache/wiki-gate-git-tests.log`
与 `.cache/wiki-gate-window-smoke.log`。

已进入既有 `knowledge.apply_note_patch` 的 Wiki 版本衔接、未知写入核实、恢复与来源
投影一致性；正文与 SQLite 无跨存储原子事务。确认删除来源、后台同步及真实服务验收
需按各自工作包定义继续，不能从缺失扫描推导物理清除权限。

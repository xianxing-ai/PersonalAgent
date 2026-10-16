# MOD-08I：Wiki 受控写回与来源投影恢复

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


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

## 2026-10-12：PR #320 原结果确认与投影恢复分离

非作者审查指出，同 Vault 配置 revision 从 1 升至 2 后，原正文已写入并真实读回/finalize，
但投影当前 binding 检查抛 SCOPE_DENIED，阻止 Runtime 原任务确认。原 #320～#323 都继承该问题。

新增 Windows 原生 writer/真实 SQLite 回归先复现上述失败（`.cache/pr320-projection-repro.log`）。
修复保留普通回执的当前完整 binding 检查；原 Runtime 核实器通过 intent/execution/参数摘要/
Evidence/finalize 后，按投影检查点的原 sourceId/configRevision/path 及摘要接受已知结果。
只将 unknown 转 pending，不更新旧绑定或授予读取许可。finalize 不再读取投影；先提交原
Runtime 结果，再由已有 Desktop/启动 `recoverProjection` 入口独立恢复。

定向 Runtime 构建及原核实/工具/投影/真实写回组合最终 **15/15、0 skip**：
`.cache/pr320-projection-final-tests.log`。实际同 Vault 升版、原路径仍获许可时，原任务
succeeded、execution confirmed、可信 readback Evidence 保留，正文只写一次；旧投影
pending=1/unknown=0，0 次投影读取。重复核实/恢复仍不重写；无关笔记/事实保留。
原配置信息、参数摘要、来源或路径替换仍拒绝，来源撤销/期限/取消检查保持。

本增量无新 wire operation、数据库迁移或依赖，接口仍 provisional；合成原生决定为
explicit Fake，云调用 0，原 Vault 未访问/修改。将按 #320→#321→#322→#323 传播并进行
最终组合门禁；原评审的 CHANGES_REQUESTED 不由作者自行撤销，须更新 head 后重审。

最终修复源为 `5918e706`，已通过本地合并同步全部四分支，生产修复内容一致。
在最终 #323 组合 `503c41e3` 上 `npm run check` 退出 0：**2717 tests / 2692 pass /
25 skip / 0 fail / 0 cancelled**，包括架构、生成类型、类型检查、workspace 与根集成。
日志 `.cache/pr320-stack-full-check.log`；使用既有隔离 .NET SDK 8，保留中文 TEMP。

同一组合实际 Obsidian/Electron 双进程合成复验退出 0，日志
`.cache/pr320-stack-dual-process.log`，证据 `.cache/obsidian-installed-host/case-j4wtpj/evidence.json`
为 verified：配对/撤销、旧码拒绝、实际重启后重新配对、已存引用读回、重复保存不增版、
再次撤回和指定事实删除均通过。Fake 原生决定、云调用 0、原 Vault 未访问/修改的边界不变；
进程已关闭、合成插件已卸载。该组合证据不冒充各历史 head 的测试或真实人工/云验收。
后续补充仅为文档记录，不改变已验证生产代码；远程检查以更新后各 PR head 为准。

## 范围外与下一阶段

MOD-08/09 仍 `in_progress`。完整 LLM Wiki、后台 watcher/全库索引、可安装 Obsidian
插件、生产私人 Feed/Goal 投影及真实 AgentArts 验收仍未交付。确认新摘录继续逐条进行。

原写入工具保存的正文备份不等于已纳入私人记忆删除协调器；私人备份与跨库派生副本需
进入宿主管理清单后，按明确范围验证删除、WAL 和混合批次保留。本包没有清除任何原备份、
私人文件或他人数据，不能据此宣称整套删除覆盖完成。

本分支联合交付 MOD-08G/H/I 与必要门禁修复；2026-10-11 用户已授权提交、推送和创建 PR。

### 2026-10-13：#317 主线后的根包冲突修复

- 工作树 `.worktrees/goo122-wiki-main-conflict-20261013`，从 #320 `a8fa8a9f` 保留全部提交。
  主线合入 #317 至 `5b581139` 后产生六处冲突；生产代码仅 Desktop 装配点一处。
  同时保留 `createTrustedKnowledgeTools` 的私人投影重验 callback 与新
  `createAgentArtsTransportConfig` / 状态初始化；五处 Markdown 保留双方内容。
- 主线已占用 ADR-0015 为 owned bindings；Wiki 只读来源 ADR 移至唯一 ADR-0022，
  相关路径和标题引用同步。含冲突的 README 门槛对齐当前 AGENTS/CONTRIBUTING 的一位
  非作者有效批准，不保留过期“两人均确认”约束；未修改设计或读取权限。
- 该组合完整 `npm run check` 退出 0：**2952 tests / 2921 pass / 31 skip / 0 fail/取消**，
  `.cache-pr320-new-main-full-check.log`；真实 Windows Job helper 启用。传输 Schema、根
  工作区和锁文件继承 #317；本修复没有额外契约、迁移或依赖增量，不手改生成类型。
- 随后正常接入 main `dd639d42` 的 #327 六个学习指导文件，无冲突。仅受影响回归
  **16/16、0 skip** 与 Desktop 类型/语法检查通过；分别为 `.cache-pr320-guidance-focused.log`
  和 `.cache-pr320-guidance-typecheck.log`。上一完整门禁属于 #327 之前的实际快照，
  不冒称最后新 head 又运行了同一完整命令；远端 Foundation 仍需核对。
- 原 Vault 未访问或修改，真实云调用 0；修复向 #321/#322 传递后再核对各包当前 head、
  CI 与非作者批准。本次不自动合并 GitHub PR、不发布，整个 MOD-08/09 不标 done。

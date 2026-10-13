# MOD-09：真实来源与原生本地生命周期验收（2026-10-08）

## 范围与基线

目标 profile：`huawei_ict_agentarts`，负责人 goo122，状态 `in_progress`，接口仍为 provisional。
工作树 `.worktrees/goo122-mod09-integration-acceptance`，分支
`codex/goo122-mod09-integration-acceptance`，本次基线
`74b64c356debe04a2f54c59d83dfa22f5e9ba55b`（main，包含 #307）。
共享根工作区及其他协作者的文件、工作树均保留。
验收后远端 main 前进到 `e86bac5382180495854923dbcf4ca9bbaf3a9b55`；
与上述验收基线相比，#309/#310/#311 仅增加 Desktop、Live Model 和业务连接器交接文档，未改变生产代码。

#304 原生检索刷新与 #305 来源切换、已保存列表及草稿保护已进入 main；本次使用合并后的正式装配。
用户逐条确认了摘录 A、更正 B，以及这条测试记忆的保存、更正、重启、撤回和删除，
并委托 Agent 操作真实原生界面。原生确认由 Agent 按此明确授权点击，不宣称用户亲自点击。
本公开记录只使用 A/B 代号，不包含私人正文、原文、Vault 绝对路径或实际事实 ID。

使用独立 userData 和 SQLite 验收库，真实 Electron 44.2、正式 Desktop/Runtime/Memory 装配，
真实本机 Vault 只读来源。启动环境不继承云凭据，不配置 Authorization，也不提交云任务。
本轮未修改生产代码、公共协议、Schema、数据库迁移或依赖；未新增 Local Profile 能力。

## 实际验收结果

| 步骤 | 原生交互与持久读回 | 结果 |
| --- | --- | --- |
| 选择来源、检索 | 原生选择已授权 Vault；实际检索命中来源，预览对应摘录 | 通过 |
| 保存 A | 原生确认对话展示来源、摘录和 A；确认保存后 SQLite 为同一事实 v1/active，创建回执 1 条 | 通过 |
| 更正 B | 原生更正确认后，同一事实保留 v1/A、v2/B；创建回执 1 条、更正回执 1 条 | 通过 |
| 第一次重启 | 来源未自动重新选择；管理列表显示 v2/B；实际公开 `MemoryQueryPort.listCurrent` 仅返回 v2/B | 通过 |
| 撤回 | 原生确认撤回后追加 v3/withdrawn；管理入口仍可见，消费查询为空 | 通过 |
| 第二次重启 | 未重新选择 Vault，管理列表仍能找到撤回头 v3；消费查询仍为空 | 通过 |
| 删除全部版本 | 原生确认后显示全部版本删除完成；事实历史、创建/更正回执和 feed delivery 均为 0，删除标记为 completed | 通过 |
| 第三次重启 | 原生已保存列表为空；实际端口有效查询与历史查询均为 0，v1/v2/v3 均不可读取（`SCOPE_DENIED`） | 通过 |
| 删除范围读回 | 仅扫描该独立 userData 中四个应用 SQLite 文件及其 WAL；A/B 的完整 UTF-8、UTF-16LE 字节均未发现 | 通过，限该范围 |
| 原来源保护 | 来源文件 SHA-256 与操作前一致 | 通过 |

最终库保留 1 条 completed 删除标记及查询快照元数据，不将“事实删除”描述为所有表清空。
Runtime 读回工具执行记录、授权记录、事实投影均为 0；没有用真实账号写入或云调用替代本地验收。
未做网络抓包，因此不声称证明了系统级零网络包。

本轮仅操作用户确认的这一条事实，没有额外插入无关私人事实。
混合批次逐条重写、检查点及无关事实/任务保留仍由此前实际 SQLite/Runtime、合成数据回归提供证据，
不能将它描述为本轮真实多事实验收。无应用自动备份/恢复生产路径；外部独立副本、已外发正文和磁盘介质恢复
不属于这次数据库/WAL 字节检查的保证。

## 验证记录与门禁

| 验证 | 实际结果与基线 |
| --- | --- |
| Memory 模块测试与类型检查 | main@`cc64ebdf`：44/44 通过，类型检查通过 |
| Runtime/Memory 相关定向回归 | 同基线：49/49 通过，0 跳过；包括来源历史、投影、feed、父子副本及删除恢复 |
| Desktop 模块测试与类型检查 | 同基线：705 项，703 通过、0 失败、2 跳过；类型检查通过 |
| #307 Windows Job Host 变更定向验证 | 当前基线：实际 helper 的取消与 deadline 进程树用例 2/2 通过，0 跳过 |
| 当前主线 CI 失败用例本机复验 | 原始 `default-coordination-subagents` 审批重启协议用例 5/5 通过，0 跳过；HTTP 为显式 Fake |
| 本次文档验证 | `git diff --check` 通过；范围、相对链接、编号与脱敏内容校对通过 |

`cc64ebdf` 到本次 `74b64c35` 仅改变 `packages/coding-tools/test/workspace-command.test.mjs`
的 Windows helper 启动等待时间，生产代码未变。因此保留并复用上轮相关结果，
不宣称本次在新 head 重跑了完整 `npm run check`。
本机 helper 使用仓库构建及缓存 .NET 8；仅验证进程指定 SDK/Runtime 和项目缓存 TEMP/TMP，不改系统环境。

当前 main 的 Foundation [run 37759208594](https://github.com/zemeng5208/PersonalAgent/actions/runs/37759208594)
attempt 1 失败于 Runtime 的 `persistent default children retain the original AgentArts candidate protocol across approval restarts`
中 `disabled -> disabled`：预期 succeeded，实际 failed。该用例源代码本机复验通过；
运行耗时不足以单独证明根因，不修改断言或生产 deadline。仅重跑失败 job 一次，
随后核对 attempt 2 为 `completed/success`，覆盖精确 head `74b64c35`。
中途一次状态查询报 `net/http: TLS handshake timeout`，重新查询成功；原失败日志保留在忽略目录。
不把该结果描述为后续文档提交或本次工作包新 head 的远程 CI。

本地分阶段脱敏读回、查询与最终审计收据位于
`.cache/mod09-postmerge-20261008/`：`v1-readback.json`、`v2-readback.json`、
`v2-restarted-query.json`、`withdrawn-restarted-query.json`、
`deleted-restarted-readback.json`、`deleted-restarted-query.json`、`final-audit.json`。
这些本机验收文件不提交 Git。验收窗口在最终读回后关闭，仅停止本次已核实身份的实例。

## 下一步与完成边界

1. 用户已于 2026-10-08 明确授权本包提交、推送和创建 PR；交付这份记录及当前矩阵更新，核对新 head 的 CI。
   #304/#305 已合并，但本轮查询其 GitHub reviews 为空；合并事实不代替用户工作规范要求的登记协作者非作者评审。
2. 与 P8/认知负责人明确私人 parent→child 的任务范围、真实 ancestry 与逐任务许可。
   当前私人派生提案保持拒绝，父许可不传递；本地历史/副本清除通过不构成子任务消费支持。
3. 在可用 AgentArts deployment、任务目的地、最小发送内容和独立云调用/出机授权齐备后，
   验证主对话逐任务确认、最终发送门禁、deployment/version/trace 与本地 Evidence/读回。
   当前没有真实 AgentArts 消费证据，不自动调用本机已有密钥。
4. 真实用户流程的原生验证、启用、回退另做独立工作包；此前官方 MCP 与合成流程通过不能替代它。

本次完成的是已确认事实的真实本地原生生命周期；整个 MOD-09 尚未达到 done。
本记录随独立文档工作包交付，实际提交、PR、当前 head CI 与评审状态以 Git/GitHub 为准，不扩大到新模块待办。

# MOD-33-GITHUB-01：GitHub 连接器源码增量

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：Local（DEV-WORKFLOWS-PLAN-20261002 #276 的明确范围）。
- 状态：review / provisional；源码、构建和受控测试已交付，真实部分只读已验证；账号写入、Windows 与完整消费者验收未完成，不标 done/frozen。
- 当前负责人：goo122（2026-10-07 接续）；自行完成实现、接线、验证与自审，同行评审按需。原 zemeng 实现和历史评审归属保留。
- 独占：packages/connectors/github/** 与本文件；其他模块只消费公开 package exports。
- 初始基线：3d4d917；初始工作树 .worktrees/dev-github、分支 codex/dev-github。
  历史续接沿 PR #290，当前沿已有 PR #297；精确提交和证据见下方续接清单。
- 依赖：contracts ToolHost/ToolDescriptor/ConnectorPort/ProtocolError；Runtime Policy、
  ToolGateway、Connector Host 凭据注入；不私设授权、任务库或模型入口。

提供 repo、Actions run/job 与失败日志、issue get/list/追加标签、PR get/diff/create、
普通评论与 inline review comment。公开 DTO 在包 src/provider.ts，由 index.ts 导出。
register(host,{provider}) 真正注册 13 个工具并返回幂等 dispose。
GhCliProvider 使用受限 token accessor、显式 repo 白名单及无 shell argv runner；
生产 SpawnGhCommandRunner 不继承环境，支持字节上限、deadline、取消和释放。
每个 Provider 构造时固定原 runner 引用，API、日志读取和释放均使用该依赖；
宿主复用 options 创建新实例不会让旧请求换 runner 或错释放新实例。原 runner
方法与 options 的凭据/白名单检查保持实时。公开合成复现旧2失败→新2通过，
独立同探针旧2失败→新2通过；正式新增回归旧1失败/1通过，修后固定Node24.15
GitHub模块 build/typecheck 和完整105/105通过。这是生命周期绑定证据，不冒充
账号写入或原Windows现场验收。
Fake 与 JSON/测试夹具覆盖分页、过滤 PR、404、限流、脱敏、job 归属、revision冲突、
unknown 写入、取消、工具注册和 scope 防误调用；后续受控执行结果见下方。

显式 `registerGitHubRepairLinks` 才增加 `actions.repair.link/get`，默认13工具不变。
link绑定原失败run/attempt/sourceSHA、修复PR/head和原workflow执行hash，创建独立neutral
CheckRun并读同一ID核对完整固定回执，不修改原CI、不提供success/status fallback。
需要受信账号Checks(write)、exact参数新审批与实时presence；旧PR权限不推导新许可。
POST进入后不确定结果保持unknown，已知partial ID只作为未核实候选；同步observeUnknown
在合法unknown校验后观察克隆原输入/候选响应和原ToolContext，异常或异步误用不改变unknown。
get仅核对明确已知原ID，不能自动确认另一task或授权重新写入；缺ID不查列表猜测。

公共端口 GitHubPort.execute 是可信装配/测试边界，业务和模型只通过 ToolGateway。
工具名、输入输出、安全边界与集中验收命令见
[包 README](../../packages/connectors/github/README.md)。无根依赖/锁文件修改，整合者
需按仓库 workspace 规范准备依赖与执行集中验收。

限制：GitHub 预读不是原子条件写；时间戳不是 issue 完整指纹；列表不是稳定快照；
1 MiB 以上日志/diff 明确失败；inline COMMENT 不代替人工 approve；不提供 run comment、
commit/push、merge、自动关闭或模型归因。verified 等级与生产 host capability 公布仍需
非作者评审、集中门禁和真实服务闭环，不能仅凭源码提升状态。

初稿按当时用户限制仅静态交付；后续用户已授权持续实现与必要构建、受控测试。
历史source提交 `2eda73d` 的固定Node24.15完整check实际exit0：GitHub96/96，
跨模块Runtime347、根集成19及全build/typecheck/架构/契约/生成检查通过。
原unknown候选恢复独立复核14/14；完整31workspace1990/0/50跳过。
这是明确Fake/合成Gh/SQLite证据，不是实际Checks凭据或真实账号写入读回。

2026-10-06 本人实际公开 Provider 已完成 repo.get、issue.get #212、pr.get #296
三种读取，正式 Schema 与官方身份独立核对。真实失败 CI run `37474438969` / job
`112306058042` 的 run/job 元数据及标准 CLI 的 11 个 step 匹配；旧 gh2.46.0 的
空日志根因由官方 parser 与非空、CRC 完整的缓存归档证明：旧版仅匹配逐步骤文件，
当前合并 job 文件布局零匹配，故 exit0/text0 不表示取得了失败日志。

可信宿主注入官方 gh2.102.0 后，原 GhCliProvider/SpawnGhCommandRunner 实际
actions.log.read 正式 Schema 六页通过，连续 offset，末页 nextOffset:null，全文
348224 UTF-16 字符 / 356938 UTF-8 字节，SHA256
`334b89ed82dc50fd73546b104ce4d760e2ca1c526ada1f6c565e4696245a253d`。
固定 Node24.15、每页有效 deadline、全 GET；token 仅内存，未输出或保存凭据、
签名 URL 或日志正文，未改系统 CLI，也未增加连接器 parser 或改变公共协议。
gh2.102.0 是本次有证兼容版本，不声明最早支持版本。真实 Calendar 断言仍待原
负责人修复；以上读取不提升 COMMENT/labels/Checks(write)、Windows 现场或原
MOD34/36/38 可信 Runtime/账号闭环状态。

当前Windows与剩余真实验收以
[统一续接清单](DEV-WORKFLOWS-CONTINUATION-20261005.md)和PR精确head为准，
不另复制进度表。真实MOD34/36/38 Gateway闭环仍由原可信场景持有者验收。

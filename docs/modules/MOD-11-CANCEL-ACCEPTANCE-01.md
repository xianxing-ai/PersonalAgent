# MOD-11-CANCEL-ACCEPTANCE-01：取消受理与终态分离

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：huawei_ict_agentarts；MOD-11/12，PA-004；负责人 zemeng，待非作者评审 goo122。
- 状态：review；基线 main `72cc76b`。等待非作者评审与集成，不代表模块整体完成。
- 工作树：`.worktrees/zemeng-desktop-cancel-acceptance`。
- 分支：`codex/zemeng/desktop-cancel-acceptance`。
- 所有权：Desktop 主进程取消接线及对应定向检查；不修改 Runtime 或公共协议。

## 问题与行为

公开 `task.cancel` 的 `cancelAccepted` 表示取消请求受理，不保证任务立即进入终态。
Runtime 可以保持 cancelling，或者在外部结果不确定时保持 waiting_reconciliation。
旧桌面 IPC 在取消受理后仍强制等待五秒终态，导致合法的待核实状态被误报为超时失败。

取消请求仍经原有发送者及任务归属校验，再调用公开 Client。受理后只回读一次真实快照，
返回受理结果与该状态；后续变化由已有事件订阅驱动，不重复请求，不伪造 cancelled。
拒绝与快照读取失败保持失败，不吞掉错误。该工作不声称可以强制终止云端执行。

## 交付与验证边界

- 不新增 capability、DTO、任务库或 Runtime 执行循环。
- 保留已有 UI 对 cancelling / waiting_reconciliation 的状态映射。
- 只验证受理、非终态与失败透传；桥接检查复用现有本地模拟入口。
- 不读取凭据，不连接云端，不进行真实外部副作用。
- 非作者评审和集成仍是完成条件，但不阻塞其他独立工作包。

## 当前验证

- `node --test --test-isolation=none apps/desktop/test/cancel.test.mjs`：5/5 通过，
  覆盖 cancelling、waiting_reconciliation、已取消以及快照读取失败透传。
- 修改的主进程、辅助函数与两个测试文件通过 `node --check`，`git diff --check` 通过。
- 默认测试进程隔离受本机 `spawn EPERM` 限制；使用同一测试的单进程模式通过，未更改断言。
- `node apps/desktop/test/runtime-application-smoke.cjs`：通过，7 次本地模拟请求、2 次取消；
  验证 IPC 到 Runtime 的受理与事件推进终态，未调用真实云服务。
- 该次运行后补充退出提示清除的显式等待断言，仅做语法与差异检查，未再次启动 Electron；
  不把新增断言记为已动态通过。
- 独立工作树通过被忽略的逐包 junction 只读复用已安装第三方依赖；内部包指向本工作树，
  仅生成本树 dist，无依赖安装、锁文件修改或共享数据库。验证环境 Node 26.3.0，
  仓库目标 Node 24.15.x 的验证以 CI 为准。
- 未进行真实 AgentArts 或外部工具调用；不能据此声称云端取消成功。

## 取消后的迟到状态读回（2026-10-07 续接）

现有 PR #302 的 Desktop 消费增量保留同一 Task 的较新 revision。原 `task.get`
已捕获 running/revision3、回执被显式延后时，原停止按钮通过公开 Runtime 接受取消，
新读回及实际取消事件推进至 cancelled/revision5。此前释放旧 get 会把界面画回运行中，
即使 SQLite 仍为 cancelled；现在 `refresh` 返回已有较新 Task，不重复发布旧投影。
初次、新版及相同 revision 的读回继续沿原 set、退出提示清理和发布路径处理。
没有修改 TaskRuntime、取消受理、审批、公共协议或 `applyEvent`。

新回归与原取消测试共 7/7、Desktop typecheck、原完整 panel/CSP AFTER 均实际 exit0。
原面板保持已取消、停止按钮消失、发送可用，等待期间新草稿保留；真实本地公开
get/cancel/get 共三次调用、取消一次，console/pageerror 为零。
源码固定 main blob `66127a66d2d1b0d7dc1eca3589133a3398588c76`，
新测试 blob `b53ab4426ad0a86c432d519136d79d9c7719e9cd`。
证据在 `.worktrees/mod15-host-20261007/.cache/review-evidence/20261007/`
的 `panel-task-refresh-order-*`；环境恢复前未保留退出码的产物与各错误调用日志继续保留，
续接仅使用有实际退出码的新证据。

该验证使用实际 RuntimeApplication/Client/SQLite、合成可取消只读 worker 与原 panel；
回执延后、IPC 和窗口宿主为显式 Fake。此处没有验证 EventCursor/pump 传输、
真实 Electron/Windows 或云端取消，也不把定向检查称为根完整检查。

随后独立核对原 `pumpEvents`、公开 EventCursor 与实际 Runtime 事件流：
在较新 cancelled/revision5 的 get 已读回后，合法历史事件1–3仍可能包含 running/revision3。
同 Task 更低 revision 现在仅跳过快照替换及退出提示清理，未提前退出整个 event；
原 task.created 分派、通知、审批与取消审批清理继续执行。游标正常从0到3再到6，
完整重复事件被原 EventCursor 拒绝，不重放或重新发布。

新增实际 pump 测试与上一包 refresh/取消测试共10/10、typecheck均实际 exit0，
覆盖低 revision、正常前进、相同 revision、重复事件及真实只读审批取消后的清理。
原完整 panel/CSP AFTER 实际 exit0，仍已取消、stopfalse、发送可用、草稿保留，
console/pageerror 为零；没有手工伪造 cancelled 快照或运行工具/签发 grant。
固定 main blob `059d73be5e72acb78ea50c76a21f978c4b1f4db2`，
新测试 blob `8ca985d39e69a23ae7ba06a9faac582463feebc0`，
证据在同 Desktop 私有目录的 `panel-event-readback-order-*`。

生产组合当前提供同步 `RuntimeApplication.readEvents`；证据通过显式 Fake
runtimeConnection 延后已捕获的合法批次，证明原消费者可保护快照合流，
没有声称在真实进程内 Electron 或物理传输复现长时间延迟。

上述两包与依赖原因文案集成后，受影响 Desktop 检查固定
`4407f4c0c3c5c43bc6ffb73fceab9f04829b23f3` / tree
`09f23bc10b8335d27dd0dbed622dfae228032a73`：typecheck 与全部工作区测试均实际 exit0，
599 项中588通过、0失败/取消、11跳过；Node24.15.0、两核，
完成于2026-10-07 21:05:23 UTC，日志 `core-desktop129-check.log`。
后续纯记录变更不当新源码重跑；根完整、当前 Windows CI及物理验收另记。

## 公开进度事件的权威步骤读回（2026-10-07 续接）

生产同步 `readEvents` 的实际消费对照发现：Runtime `recordProgress` 已持久化
running/revision4 的 Step，合法 `task.progress` 事件推进游标到4，面板投影却仍为
running/revision3、无步骤；公开 get 读回后才显示实际标签。progress payload 只有
stepId/label/可选完成单位，没有 Task revision，不能直接当 TaskSnapshot。

原 pump 现在在普通事件分支完整处理后，按 accepted progress 的 taskId 批内去重，
复用公开 `refresh` 取得实际 Task。多个读回分别等待结算；一个失败不会跳过同批终态
或取消审批清理，也不会阻断另一个 Task 的成功读回。错误沿原路径显示，重放事件不
触发额外 get；不造 Step/revision/百分比，不新增队列或盲重试。

新增四个公开消费者测试与前两包/原取消检查共14/14，最终冻结测试实际 exit0；
原 panel/CSP AFTER 自动显示真实步骤标签、无手工 refresh，停止仍取消本地合成只读
worker，发送与草稿正常，console/pageerror 为零。main blob
`741f8f42595baf2ddc3d697203bc5e3ea63e258d`，新测试 blob
`4a3a86513080d4566aa63630e37f3c0ed2357787`；私证据 `panel-task-progress-*`。
get 失败及旧回执延后为明确 Fake，公共 Task/Step/events 为实际本地 Runtime 读回。
未验证真实云 worker、完整 Electron/Windows 或物理桌面，不借上一599项覆盖新源码。

## 原输入框的迟到提案取消与面板尺寸（2026-10-07 续接）

独立原 composer 消费者使用真实本地 Runtime/Client/Policy 和实际 AgentArts HTTP
adapter，明确 Fake HTTP 故意忽略 AbortSignal 并延后合法 Node 提案。原停止按钮一次
公共 cancel 的回执为 accepted/cancelling；实际本地 adapter signal race 停止等待，
Runtime 确认 cancelled 后才放回执。实际 discardUnreadResponse 的 native reader
cancel1/read0，原 panel 保持已取消、新草稿及发送可用；Node、执行记录、grant、续发均0。
这是本地停止与迟到输入丢弃，不是远端取消 ACK。corrected-observer 进程实际exit0；
初次错误观察 body.cancel 的exit1及改为转发原getReader方法的纠正均保留，未放宽断言。
私 workspace-node-proposal-cancel-consumer-*，main741f8f4及七个相关公开编译出口各次
前后同字节，无源码修复或重复正式测试；native IPC/窗口/凭据/safeStorage 为明确Fake。

另按 actual panelBounds 的420×640和小工作区320×480，在原panel/CSP分别完成独立
公开 progress/stop消费和12行草稿/model菜单开关，两个进程实际exit0。每种尺寸八个
控件及菜单在界内，document scrollWidth等于viewport，thread.bottom等于composer.top；
320的thread约82px并内部滚动，不声称旧消息同时全显。两种尺寸的自动步骤和取消后
截图均已核看，草稿完整、发送恢复、console/pageerror零。私 panel-bounds-consumer-*
保留JSON/日志/截图，Browser插件不可用时使用现有Playwright/Chromium；不把1100尺寸
功能证明当真实420几何，也不当Electron焦点、高DPI、多屏、Windows无障碍或物理验收。

原 renderer 初始化另有独立消费者证据：先 subscribe 再 invoke首次snapshot，合法
running3 首回执被明确Fake IPC延后；实际公共事件及原stop把Task推进到cancelled5、
Cursor6后放回执，原receivedUpdate guard保留终态、草稿与发送，不恢复运行控件。
同样时序的迟到初读错误被抑制；无任何订阅更新时相同初读错误准确显示，不能据此
声称所有初始化错误被吞掉。三个原panel进程各实际exit0、console/pageerror零，四个
公共编译出口各次前后稳定，renderer084eaf2未改。私panel-bootstrap-readback/failure-*
保存真公共Runtime与Fake IPC边界及首helper语法错误尝试；不当真实Electron IPC验收。

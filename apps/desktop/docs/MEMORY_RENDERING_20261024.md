# Desktop 内存与渲染性能工作包（2026-10-24）

状态：可集成的离线增量，独立工作树实现、自审、定向检查及真实 Electron / 合成数据验收已完成。完整文字 smoke 仍保留一处既有模型标签失败；统一整合、根 `npm run check` 和真实 Competition 运行由主集成工作树负责，不能据本包标记整个产品完成。

目标为 `huawei_ict_agentarts` 的现有 Windows Electron 主线。测试显式使用 Fake Model / 合成数据；这些测试不构成 AgentArts、盘古、真实邮件、真实 Laya 权重或实体设备验收。基线提交 `0abefff257c8e45136886e1cafa8bd3b830c751a`；依据原静态审查 `08_RENDERING_MEMORY_PERFORMANCE.md`，没有将建议预算当成既有产品 SLO。

实际工作树 `<source-worktree>`，分支 `codex/memory-rendering-performance`。没有修改根工作树、CCB 子代理线或电脑控制线。版本化[测量回执](evidence/memory-rendering-20261024.json)保存原始样本、各轮源码哈希、检查日志摘要、失败事实与限制；本地完整日志和截图保留在 `.cache/performance/`。

## 实现边界

- Main 仅保留至多 200 个可回收终态显示缓存，加当前三个页面及审批引用；未结束、审批中和 `waiting_reconciliation` 任务继续保留。每页 40 个任务/Live 消息，并额外展示当前会话最近 8 个未结束任务。旧记录仍在原 SQLite/Conversations 中，按需翻页；翻页不改变模型历史读取范围。
- Runtime host-only `readTaskDisplayPage` 在 SQL 中 LIMIT，按创建时间与 task id 稳定排序；固定 snapshot watermark 支持向前、向后、返回最新。原 `task.list` 与 `conversation.list` 协议保持兼容，后者先筛选会话身份再加载对应历史。
- host-only `readEventBatch` 每批最多 128 条（端口上限 512），固定 throughSequence；批间让出事件循环。`event.subscribe` 验证游标而不重复加载全部事件。仍使用原 `EventCursor` 去重与 gap 拒绝，逐条处理真实事件。
- `listSubagentConversations` 先在 SQLite 筛选原 checkpoint 候选，避免解析每个无关任务。候选仍经过原 parent/idempotency/sibling 验证；checkpoint 存在不构成授权。
- 主窗口按 tasks / approvals / notifications / resources topic 合并发布。每窗口最多一个待 ACK 快照，后续只保留脏 topic，不积累旧快照或定时重发。隐藏、最小化窗口不生成显示快照；显示、恢复或显式 resync 读取完整当前状态。旧 generation 的 ACK 不能释放新一代快照。ORB 只接收一个轻量任务状态、音量和资源预算。
- Renderer 合并连续补丁后才 ACK。错代、缺基线或缺号请求完整重同步；旧直接读取不能覆盖更新的广播。任务 DOM 按键复用，插入/移除时保留未改变节点和按住的停止按钮；历史导航在输入区和授权卡外。
- 最终显示边界检查 `private-copy-erasure`，支持“revision 相同而可见正文已改变”。当前旧页、晚到回执、Main 与 Renderer 的截断正文缓存都不能覆盖可信擦除读回。
- 资源控制只降低显示与可延后的维护负担。依据真实可用内存、CPU 并行度、电池、系统 CPU 限速与可得温度状态，选择 30 / 20 / 12 FPS、DPR 上限 2 / 1.5 / 1、发布间隔 16 / 32 / 50 ms、可选维护间隔 120 / 250 / 500 ms。失焦窗口最多 12 FPS；保留现有隐藏暂停与减少动态效果偏好。恢复需要持续 30 秒余量，critical 逐级恢复；不自动取消任务、卸载已用模型或删除记录。
- Laya 使用一个活动推理槽和可移除 FIFO，待执行上限随资源状态为 16 / 8 / 4。排队取消立即移除引用；降档不撤销已受理请求。原身份校验、deadline、generation 与 `stop_unconfirmed` 保留。

这些上限约束显示工作量和队列，不承诺软件固定 MB：未结束任务、已启用模型、模块权威状态和各窗口进程仍有真实内存成本。

## 存储与兼容

Runtime 有序迁移 11 仅增加五个查询索引：任务会话/状态、任务状态、创建事件 task/sequence、创建事件 display 顺序、checkpoint key/task。没有搬迁或重写正文、Evidence、审批或幂等记录，也没有第二套 Runtime/writer。迁移在原事务中完成；测试覆盖版本 10 内容保留、建索引中途错误回滚和旧二进制拒绝新 schema。

首次使用新 schema 前应保留原数据库备份；回退旧二进制须恢复升级前备份。不能修改已发布 migration 校验和、删除 schema 标记或假装存在无损自动降级。

Conversations v4 和邮件 metadata 加密格式未改变，草稿的关闭前同步确认保持原语义。本工作包没有引入异步 writer、数据库清理、依赖升级或 utilityProcess。测得的大 metadata 同步 clone/encrypt/write 仍是残余风险，见测量边界。

## 测量与验证入口

固定仓库 Node 24.15.x / npm 11.12.x；先在当前工作树构建依赖与 Runtime。所有生成物写入该工作树被忽略的 `.cache/performance/`，脚本拒绝复用已有 fixture 数据库。

```powershell
node apps/desktop/test-support/performance-benchmark.mjs --output .cache/performance/after-node-final.json
node apps/desktop/test-support/performance-runtime-benchmark.mjs .cache/performance/runtime-after-10000.json 10000
node apps/desktop/test-support/performance-electron.cjs .cache/performance/electron-final
node --test --test-concurrency=1 apps/runtime/test/event-batch.test.mjs apps/runtime/test/display-pagination.test.mjs
node --test --test-concurrency=1 apps/desktop/test/history-pages.test.mjs apps/desktop/test/snapshot-publisher.test.mjs apps/desktop/test/resource-policy.test.mjs apps/desktop/test/inference-admission.test.mjs
```

Node 投影基准执行 production function + Fake host + structuredClone，100/1000/10000 条，每场景独立进程，5 次预热后 30 次测量；不能称为实际 Electron Main 耗时。邮件加密使用合成 AES-GCM 替代器，不是 DPAPI 性能。实际 SQLite 与 Electron 另测，记录原始样本、源码哈希、进程内存、事件循环、DOM、IPC 和功能断言；不丢弃慢样本或失败。

## 实测结果

同一台 Windows x64，物理内存 15.63 GiB、20 个逻辑 CPU；显示器为 1920×1080、DPR 1、165 Hz。没有加载真实模型，也没有读取用户任务库。时间单位均为 ms；P95 不代表跨设备 SLO。

| 合成历史条数 | 原 Node 全量投影 P95 | 最终 Node 有界投影 P95 | 实际 SQLite 最近 40 条 P95 | Electron 快照往返 P50 / P95 |
| --- | ---: | ---: | ---: | ---: |
| 100 | 2.36 | 1.29 | 0.75 | 16.05 / 26.55 |
| 1,000 | 22.52 | 1.51 | 0.84 | 17.00 / 27.01 |
| 10,000 | 275.26 | 1.48 | 1.21 | 17.79 / 27.55 |

Node 前后执行相同的任务更新场景，优化后只投影脏 topic，ORB 不再复制历史。每个场景 5 次预热、30 次测量；它包含 Fake host / structuredClone，排除了实际子对话查询与 IPC，不能把 1.48 ms 写成实际 Main 耗时。1 万条时 fixture 中常驻任务投影为 201 条，原始 1 万条权威 fixture 记录保留。最早基线回执记录了基线提交但没有逐文件哈希；后续回执有逐文件哈希。

SQLite 每项 2 次预热、6 次测量，样本少，P95 等于该组最大值。查询索引优化前的**中间分页实现**在 1 万条时最近页 P95 为 71.18 ms，未找到子对话时的摘要查询 P95 为 2,746.66 ms；最终分别为 1.21 ms 和 0.10 ms。这里比较的是同工作包的前后 SQL 路径，不是旧版完整 Electron 启动。

6 万条事件分为 469 个 128 条批次全部读完，末游标和固定水位均为 60,000，总耗时 1,099.41 ms；单批 P95 为 4.17 ms、最大约 5.57 ms。批间让出事件循环，不会把总扫描时间变为零。这项测量只含 Runtime 事件读取、校验与公开投影，不含 Main 各业务事件的处理耗时。

| 合成历史条数 | 启动到历史可见（秒） | Main RSS / heapUsed（MiB，采样） | Panel 回合 / DOM 节点 | Main 事件循环延迟 P95 / 最大 |
| --- | ---: | ---: | ---: | ---: |
| 100 | 1.39 | 310.7 / 87.5 | 40 / 1,044 | 22.28 / 114.29 |
| 1,000 | 1.36 | 291.8 / 71.0 | 40 / 1,044 | 19.15 / 123.93 |
| 10,000 | 1.35 | 314.2 / 88.6 | 40 / 1,044 | 22.56 / 121.31 |

没有取得旧版完整 Electron 的内存对照，不能宣称产品总内存降低某百分比。回执另存各进程 working set / CPU、Renderer CDP heap，不能把含共享页面的进程 working set 简单相加当作独占内存。Electron 的 `eventLoopUtilization` 在本环境全为零，标为不可用，不解释成 CPU 为零。

每档使用新建数据库、真实 TaskRuntime、真实 Electron、显式 Fake Model，均通过：历史翻页和返回最新、历史后继续提交、新旧记录保留、中文草稿与合成 composition 事件、插入回合时保留已按住的停止按钮、阻断 ACK 时只发一个快照、隐藏窗口不投影、恢复后完整快照、工作区和管理页有界显示。退出后核实全部原记录和一个新任务仍在 SQLite，三个进程组均正常关闭。1 万条场景 ORB 单次快照最多 361 字节，Panel/Workspace 约 71 KB；这里是 JSON 估计和发送尝试次数，阻断用例会故意丢掉一次发送。

该 Electron 矩阵播种的是 TaskRuntime 历史；显式 Fake Model 的 Conversations 使用内存存储，未同时播种同规模 Live 消息与会话元数据。因此启动与进程内存结果不覆盖“1 万条 SQLite 加 1 万条 Conversations 文件”的组合。Conversations 的实际同步写入单独由 Node 文件基准覆盖，不能相互替代。

注入 critical 事件后 ORB 在 1.1 秒内绘制 13 次，DPR 上限 1，工作区装饰动画停止。该事件与 composition 均为测试注入，不能代表真实温控或系统 IME 验收。实际 panel / workspace 截图已检查，路径为 `.cache/performance/electron-final/{panel,workspace}-10000.png`；没有修改原生窗口合成策略。短观察期间 Renderer 未记录 long task，但 Main 最大延迟仍约 114–124 ms，不能宣称所有卡顿已经消失。

最终 Electron 矩阵后仅收紧终态缓存计数、补同时间 taskId 顺序，并修复测试等待逻辑；随后相关 6 项测试和文字交互诊断通过，Node 投影三档重新测量。未重复无关存储基准或整套 Electron 矩阵，回执分别标明源码版本。

## 检查结果与已知失败

- Runtime 分页、迁移、事件、原状态机：18/18；子对话和 conversation integrity：23/23。最终有序查询改动后的分页组：3/3。
- Desktop 历史、投影、资源、推理队列、Laya 生命周期、停止反馈、DOM 与关闭草稿：44/44；最后缓存修订相关组：6/6。这些计数有重叠，不相加成总用例数。
- 当前工作树构建通过，Runtime 最终增量构建通过；Desktop 语法检查通过，架构门禁 3/3，`git diff --check` 通过。根组合 `npm run check` 未在本树运行，由最终集成树执行。
- 完整 `npm run test:text-smoke --workspace=@personal-agent/desktop` 在 `test/text-chat-smoke.cjs:78` 失败：期望“模型未配置”，实际“AgentArts 默认模型”。当时 `fake=false`、`fakeModel=true`、`model.configured=true`、`model.status=ready`、`model.label=Fake Model · 离线测试`、`agentArts.configured=false`、catalog 不存在。模型选择生产文件未在本包修改；root 集成负责修复显示事实与相应断言。完整失败保留在 `.cache/performance/text-smoke-corrected.log`。
- 原 smoke 的异步 `waitForFunction` 返回 Promise，被 Playwright 1.63 的同步真值判断提前接受。已改为同步 DOM 条件，再独立核对 Runtime 成功态、用户正文和完整回答。诊断仅把上述标签断言改为记录，其余长 10,001 字、Enter/按钮发送、复制、点赞、滚动及 Fake/catalog 断言全部通过；详见 `.cache/performance/text-interaction-final.log`。这不是完整 smoke 通过声明。
- 初期性能测试驱动出现过动态 import 限制、窗口加载竞态和隐藏截图超时，已修复测试驱动并保留原失败日志。最终三档矩阵通过，不删除慢样本或把失败改记为成功。

## 明确保留的缺口

1 万条 Conversations 同步保存 P95 为 13.37 ms；合成 metadata 的 clone / AES-GCM / 同步写 P95 为 67.44 ms、最大 69.73 ms。两条格式和 writer 均未修改。下一包应单独设计批量/异步写入、崩溃回读和隐私擦除语义，不能以延迟写入丢失关闭前草稿或 outbox 状态。

本包没有给全部活动任务、通知 Map、模块权威状态、模型进程设置全局内存硬上限；活动任务和未核实副作用不能为降内存而丢弃。Conversations 的 turns/messages Map 仍整体驻留，Live 历史翻页仍扫描消息元数据、只保留一页候选。真实低内存、不同 GPU / DPI、多显示器、电池/限速、真实模型及长时间运行仍为 `not_run`。子对话窗口自己的 500 ms 轮询也保持原实现，后续按独立所有权测量和收敛。

## 集成注意事项

2026-10-24 主树集成补充：主负责人已在原 `f809` 工作树合入本包，并为显示子对话增加 host-only 可见父任务范围过滤和索引迁移 12。父范围游标绑定、105 个无关父任务与当前合法续聊的组合回归已通过；该结果是合成协调器下真实 Runtime/SQLite 的行为验证，尚不能替代大量真实云子任务的资源测量。本文原测量保持 `0c4179a1` 的来源，不改写原始样本或将新增索引冒充原基准成绩。

主树已修复 Fake Model 的模型标签事实投影，完整文字 smoke exit 0；仍明确使用 Fake Model，不将其记成真实云验收。Main 同批任务进度读取失败现逐项隔离，后续任务继续刷新并保留首个具体错误。第二轮整仓完整日志记录 5,957 pass／29 skip／0 fail；第三轮在默认对话和 WSS／恢复修正后进行。主树真实默认桌面的工作区修复另有独立回执，不能据单次云任务改写本包的内存测量或消除已列 metadata 同步写入风险。

10 月 25 日主树实际窗口复验补充：`snapshot-publisher` 在窗口 `closed` 时重新读取已销毁的 `webContents` 会抛原生异常，旧 EventEmitter 夹具未模拟该 getter。主树现于 attach 捕获原 emitter、释放时不重读销毁窗口；新增三条先失败的销毁路径反例，连同资源／进度组 15/15 通过。实际生产 Electron 的现有 Local 兼容路径完成窗口关闭重开、模型停用重启、原请求取消及正常退出（回环 HTTP 夹具 7 请求／2 中断）；这不是原内存样本的重测，也不证明真实 Provider。新证据见[桌面集成复验](../../../docs/competition/evidence/desktop-integration-20261025/README.md)。

主集成工作树须把 `conversationProjection` 抽取与其最新 CCB/team、电脑/视觉快照字段手工合并。保留 `computerControlSnapshot`、`computer.control.*`、`computer.vision.configure` 私有动作，电脑/浏览器自有进程关闭确认须先于 Runtime.close；本包不编辑其 Host/vision/native 实现。

`runtime-application.ts` 仅增加有界事件委托与子对话候选分页；不能覆盖 CCB 的团队逻辑。`main.js` 的 `snapshot`、窗口装配、事件泵、启动缓存、退出释放是主要共享段。`renderer.js` 的完整快照/补丁适配须保留其他线原入口与授权卡接线。

本包不推送、创建 PR、合并或发布。集成后仍须在最终源码运行根 `npm run check`，并核对 Competition 原对话工具、授权、停止、未知结果、子对话与电脑/视觉组合，不以独立树 Fake 验收替代这些检查。

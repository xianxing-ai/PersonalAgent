# Desktop 历史资源修复（2026-10-26）

目标为 `huawei_ict_agentarts` Desktop 的本地显示层。执行工作树：`.worktrees/large-history-20261026`，分支 `codex/large-history-repair-20261026`。基线是主集成 A10 的未提交源码快照，HEAD `b2fb20dd094743c411656b7e7703c8aae7571a8e` **不是**本包精确源码基线；逐文件 SHA-256 以 `.cache/subagent-baseline-20261026.json` 为准。前任代理实现、记录反例与缓存测量，Astra High 接续复核、补充 GC/双向分页回归与最终交付。主代理拥有 Main 装配和集成验收。

## 修复与数据边界

`TaskProjectionCache` 原来只使排序版本失效，删除、逐出或替换后的旧 `sorted` 数组仍强引用旧正文；隐藏窗口不再读快照时，引用可能长期存在。现在这些操作立即丢弃失效的排序数组及位置 Map；同排序键的更新仍可原位更新。保留终态显示预算、活动任务、待批准、待核实和可见页引用。Runtime 原历史、Evidence 与任务终态未改动。

`Conversations.readMessageDisplayPage({conversationId,limit,before,after,messageThrough})` 是 Desktop 宿主私有端口，返回至多 `limit` 个 `{id,createdAt}`，大小范围为 1–128。首次调用从完整权威消息 Map 构建全局及分会话排序索引；两类数组共用不含正文的元数据对象。后续用二分定位游标及水位，只读候选页。新消息在原同步保存成功后增量插入；修订正文保留原时间与归属，不重建排序，及时解除对旧 Map 的引用。保存失败不推进索引，不出现未持久化消息。

`createHistoryPages` 接受可选 `readMessagePage`，有该端口时绝不枚举旧 `readMessages`；缺失结果或返回超限明确失败。未传端口的原调用者保留兼容扫描行为。固定任务快照、消息时间水位、同时间 `message:`/`task:` 键顺序、每页 40 条及显式“最新”动作保留。

权威 `turns/messages` Map 仍完整驻留；原 Conversations v4、模型历史读取、完整正文、用户草稿和同步 JSON 保存均保留。没有公共 Schema、数据库迁移、权限或出机范围变化。新消息插入在旧时间位置时仍可能移动数组元素；保存仍复制完整 Map 并同步写文件。此包不声称解决这些剩余成本。

## 本地行为验证

固定 Node `v24.15.0`，依赖为本树独立安装，已有 dist 来自 A10 独立副本。本次没有新构建或真实服务调用。

- 原缓存 3 条独立进程 GC/WeakRef 回归在旧源码全部失败：删除、逐出、排序键替换后正文仍存活；原始 `.cache/large-history-cache-before-20261026.log` 保留。
- 原消息读页 4 条回归在旧源码失败；`.cache/large-history-message-page-before-20261026.log` 保留。其中方法不存在表示原代码尚未实现新私有端口，不作为旧公开兼容性故障。
- Astra 接续聚焦组 17/17：两个新测试文件、原 `history-pages.test.mjs`、`conversations.test.mjs`。验证未知/批准/pinned 保留、同 revision 擦除、旧页水位、会话隔离、双向分页完整且无重复、保存失败无幻影、正文修订后旧 Map/旧正文 GC，以及读页不改磁盘内容。日志 `.cache/large-history-astra-focused-20261026.log`。先前组与本组有重叠，不相加成独立总数。
- npm 的 Desktop `typecheck` 启动两次均受子进程 PATH 影响，报 `'node' is not recognized`，失败日志保留为 `.cache/large-history-typecheck-20261026{,-a2}.log`。改用固定 Node 绝对路径逐条执行同一 package script 的 `--check` 列表，并额外检查两个新宿主文件；结果见交付 manifest 与 `.cache/large-history-direct-typecheck-20261026.log`。不将 npm 启动失败抹成成功。

## 缓存测量

原始回执 `.cache/large-history-cache-benchmark-20261026/receipt.json`，起止 UTC `2026-10-26T05:09:41.425Z`–`05:09:45.008Z`。前后各用独立 Node 进程、显式合成任务；没有 Runtime、Electron、模型或真实设备。旧缓存 SHA-256 `2cacf1c597ae315673a00a767d644e655ff150d0f0f7ea35c58a0eab2cfbb8a8`，修复后 `43cdf392aaa6106e46c5814025accd98cb6ed296460b7b0b0fc780edb1875c12`。

| 场景 | 旧版 | 修复后 |
| --- | ---: | ---: |
| 1k，逐出后 heap 增量，8 KiB 正文 | 8.01 MiB | 1.63 MiB |
| 10k，逐出后 heap 增量，8 KiB 正文 | 79.76 MiB | 1.62 MiB |
| 10k，逐出后 RSS 增量 | 162.51 MiB | 127.92 MiB |
| 10k，失效排序数组保留对象数 | 10002 | 0 |
| 10k，已逐出正文 WeakRef | 仍存活 | 已释放 |
| 10k，终态化 P50 / P95 / max | 5.93 / 7.92 / 8.25 ms | 6.50 / 9.26 / 10.04 ms |

延迟测量使用 256 B 正文、5 次预热、30 样本和 nearest-rank 分位，内存测量用 8 KiB 正文。两者不混为同一场景。10k 终态化延迟有回退；此修复是释放不再使用的正文引用，不是全面提速。两版都保留 202 个 Map 条目（200 个终态显示项及 unknown/approval）。RSS 包含运行时保留页等，不能直接解释为应用独占 OS 内存或全应用 SLO。

## 消息索引测量

已完成四个串行独立 Node 进程，UTC `2026-10-26T05:23:39.673Z`–`05:23:40.837Z`。驱动 `.cache/large-history-message-benchmark-20261026.mjs`，回执 `.cache/large-history-message-benchmark-20261026/receipt.json`。每条合成正文 1024 B、约三分之二属当前会话，实际 Conversations 文件加载，任务端口为显式空 Fake；每页显示 40 条。持续读页每次令显示页失效，5 次预热/30 样本，nearest-rank 分位；冷读仅一个样本，包含首次索引构建/排序。四组均断言前后历史文件 SHA-256 相同，原消息数量不变。

| 消息数与指标 | A10 扫描 | 元数据索引 |
| --- | ---: | ---: |
| 1k，首次读页 | 2.047 ms | 0.804 ms |
| 1k，持续读页 P50 / P95 / max | 0.698 / 1.082 / 1.099 ms | 0.011 / 0.021 / 0.047 ms |
| 1k，首次读页后 heap / RSS 增量 | 0.025 / 2.523 MiB | 0.161 / 0.234 MiB |
| 10k，首次读页 | 8.585 ms | 3.134 ms |
| 10k，持续读页 P50 / P95 / max | 7.762 / 10.429 / 11.924 ms | 0.012 / 0.019 / 0.071 ms |
| 10k，首次读页后 heap / RSS 增量 | 0.034 / 0.203 MiB | 1.342 / 0.742 MiB |
| 两档，36 次读页完整 Map 枚举次数 | 36 | 1 |

新索引以额外常驻元数据换取后续读页不全扫；10k 有 10000 个元数据对象、全局与会话数组各 10000 个引用，不复制正文。首次文件加载仍约 55–56 ms（10k，本次单样本），索引没有优化它。持续读页不包含消息保存、IPC、DOM 或真实模型，因此不能把极低页耗时视为窗口响应或整应用性能。RSS 是本次进程采样，不能给出全环境上限。

## 装配与交付限制

主代理须在既有 `createHistoryPages` 装配中加 `readMessagePage:input=>conversations?.readMessageDisplayPage(input)??[]`，保留其余参数。当前子树 Main 保持 A10；在该接线集成前，生产入口仍走旧扫描路径。最终装配与集成检查由主代理的独立回执说明，本文件不代报已完成。

本子树不修改 Main、Renderer 主装配、Runtime、公共契约或锁文件，不提交、不推送、不建 PR。交付仅包含三个源码、两个新测试与本文件相对 A10 的增量。华为评测/部署、真实模型/设备、Electron/IPC/DOM、长时间运行、低内存和不同 GPU/DPI 验收均 `not_run`；本包属于本地缓存与消息索引验证，不是云端工作流验收，也不提升 MOD 冻结或发布状态。

交付目录 `.cache/large-history-delivery-20261026/` 包含仅六文件的 `large-history-A10.patch`、before/after 副本、原始日志/测量与 `manifest.json`。本包三个源码的 before 均与 A10 字节哈希严格相等。全树审计发现其他 33 个未编辑文件因 Windows checkout 的 CRLF 与基线 LF 字节不同，逐个 LF 归一化哈希均相等；只记录，未重写这些文件，也未将它们放入增量。

# 共用待核实分类修复与只读定位入口

- Profile：`huawei_ict_agentarts`。
- 工作树：`D:\worktree\f809\PersonalAgent\.worktrees\connector-real-completion`；分支 `codex/connector-real-completion`。
- 集成基线 `8699ed74a1e56c672fcdab1327c3b4b4b1365039`，包含主控 `966ec4c5` 及协作者的 typed before-invoke 接口 `df50f61d` / `a163675a`。Coordination 包由对应协作者交付，本工作包只消费该已合入接口。
- 本包生产范围：`apps/runtime/src/index.ts`、`application/coordination.ts`、`application/runtime-application.ts`；另有定向测试与只读诊断脚本。没有修改授权核心、Policy、F15/coding glue、真实配置或数据库。

## 已复现的问题

在显式 Synthetic 内存 Runtime 中，让工具目录的 availability 永不返回。两次均为云调用 0、工具执行 0、工具记录 0、无 cloud inflight；仅把已注册工具的 sideEffect 从 `read` 改为 `external_write`，原结果从 `failed / TIMEOUT` 变为 `waiting_reconciliation / RESULT_UNKNOWN`。原因是目录最坏副作用被作为整个协调 worker 的副作用，原 `runTask` 到期据此分类，即使未跨执行边界。

另一个真实代码边界的 Synthetic 复现是：子任务先待批准，批准后原写入结果未知，父任务却仍显示 `waiting_approval`。原父聚合只在子任务全部终态时刷新，未投影新出现的真实 child unknown。

主控提供的 [Issue #497](https://github.com/xianxing-ai/PersonalAgent/issues/497) 描述的是另一台设备的 pre-invoke `EXTERNAL_FAILURE`，不是上述 timeout。本包还通过实际 `AgentArtsCloudAgentPort → CompetitionCoordinator → Runtime`、Synthetic WebSocket 复现：最终摘要尚未发送的连接失败也会被已有 continuation 的通用 export hold 改成待核实。没有读取那台设备的私人数据库、配置或日志；这些本地复现不构成远端根因或修复后的远端验收。WSS pin 等假设不在此确认为事实。

## 精确处理边界

仅实际进入原 `runCoordinationWorker` 的可信 worker 声明本地效果由 Runtime 记录。任意其他 host worker 保留原有保守分类，不能借目录或模型自报证明无副作用。声明是有界进程内 provenance，不是 grant、持久授权或新任务日志；新 worker/resume 必须重新声明，旧进程/未声明 child 不继承证明。

到期分类读取原 cloud holds、实际 tool records、精确注册工具 descriptor、结果 checkpoint，以及原 idempotency / conversation 绑定的 child。证明遍历至多 64 个任务；缺证、读取失败、未注册 pending worker、未声明的其他执行路径、任何 unknown 或实际开始的写入均保守保留待核实。进程内 provenance 上限 4096，淘汰只使证明失效，不放行执行。已经处于待核实的任务不会由此重开或改成成功。

| 场景 | 当前结果 |
| --- | --- |
| 原协调路径目录等待或普通文本到期，确证没有实际写入/未知在途 | `failed / TIMEOUT` |
| 任意未声明的写 worker 到期 | 原 `waiting_reconciliation / RESULT_UNKNOWN` |
| 真实 Gateway 记录已开始写入，或 cloud inflight/received/unknown、export-withheld 尚未收束 | 保留待核实 |
| 适配器以 `AgentArtsBeforeInvokeError` 明确证明当前 invoke 尚未发送，原树又可证明无实际写/unknown（可含已确认只读） | 正常 `failed / EXTERNAL_FAILURE`，保留原只读结果记录 |
| 已确认 local write 后，下一次 invoke 尚未发送但失败 | 保留原 export-withheld 待核实；不重放写入 |
| 普通 `EXTERNAL_FAILURE`、缺失 inflight 或模型自报未发送 | 不取得 typed never-sent 豁免；原 export guard 保持 |
| 原 child 变为待核实，父仍待批准 | 复用原 confirmed dispatch、wait/runId、参数 digest 和 child 身份后，只把父投影为待核实；不执行/恢复任何循环 |
| 篡改原 dispatch digest 或外部 child 冒名 | 不能推进父状态 |

“尚未发送”必须来自适配器真实类型；没有 inflight 本身不能证明没发，尤其不能把已 fetch 的 HTTPS 当作未发。`AgentArtsResultUnknownError`、已发 WSS 未知结果和其他出机权限拒绝不获得豁免。

## 只读诊断

`scripts/diagnostics/reconciliation-readonly.mjs` 仍要求用户明确选定 SQLite 与原 taskId，不自动发现私库，不导入 Runtime 或恢复任务。新增一层 parent / 最多 32 个直接 child 的相同白名单投影，超出明确标记；不递归读取孙任务，不返回参数、goal、模型、结果或会话正文。原 UI 父任务本身没有 cloud receipt 时，可在直接 child 找到其原安全 stage。

新增目录/父子等待 checkpoint 的存在布尔值，以及实际解析入口旁 Runtime 核心制品 hash。磁盘源代码、解析到树外的模块和现有进程的 loaded build 仍明确区分；`runningApplicationBuild` 保持 `not_observed`。Git 同步或 package 版本相同不能证明 dist / 运行进程已更新。用户运行方法与隐私边界见 [诊断说明](../../../scripts/diagnostics/RECONCILIATION_READONLY.md)。

## 验证

- PATH 的 Node `v26.3.0`：定向 Runtime、目录、父子、云回执、未知写恢复与诊断共 190 项通过，0 fail / skip；分两组运行（77 + 113）。此记录不冒称 Node 24.15 验证。
- 仓库指定 Node `D:\PersonalAgent\.cache\toolchains\node-v24.15.0-win-x64\node.exe`：重新编译本树 Coordination 与 Runtime；新增分类 20 项和自建 SQLite 诊断 5 项共 **25/25，通过且 0 skip**。没有扩大到重复全套测试。
- 架构检查 3/3 通过；`git diff --check` 通过。
- 新 20 项覆盖目录无执行超时、普通文本、默认 host 语义、实际 started write、已确认只读、各种原 cloud hold、未知 worker/证据读取失败、active/failed 未声明 child、实际父子聚合正反例、真正 never-sent 与真正 sent-unknown、generic error 不得豁免。
- 首轮工作区与诊断 fixture 在沙箱内 native realpath 被拒；按工具许可原样重跑自建 fixture 后通过，未放宽 canonical 检查。旧父聚合测试唯一行为预期从待批准改为真实待核实；原“重复提交只执行一次写入”断言保持通过。
- 为避免 workspace 相同版本 Package ID 将新类型去重到根旧 dist，隔离树仅给本树 Coordination 建立 ignored dependency junction，并用 ignored `.cache/tsconfig.runtime-reconciliation.json` 显式映射本树新声明完成 Runtime 编译；未修改根依赖、安装包或放宽类型检查。主控集成应先构建 Coordination，再构建其消费者。

以上均为离线 Synthetic 输入及自建工作区/SQLite，无真实模型、外部服务、邮件或私人数据调用；其他设备与真实业务验收不在本次通过声明中。测试/编译槽已释放给主控。

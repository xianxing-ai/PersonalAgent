# 对话截断、引导与排队验收

日期：2026-10-21（北京时间）。Profile：`huawei_ict_agentarts`。工作树 `D:/worktree/3def/PersonalAgent`，初始实现基线 `e7d4e0c6`。用户已授权提交、创建 PR、独立审查及满足仓库门槛后合并，再运行最新版；实时提交、PR、审查和合并状态以 GitHub 回执为准。

## 行为和边界

- 主停止立即冻结回答显示、解除提交占位并暂停未发送队列；Runtime 取消与语音停止分别请求，不等待慢读回。停止受理前的请求若迟到返回，宿主会取消其真实 taskId，旧回执不能释放新提交锁。
- 输入区可选择「引导 / 排队」。引导经现有 Runtime 取消后提交新一轮，由既有会话上下文提供原目标/状态；没有伪称云端原生热插话。排队项为未发送草稿，可依次发送、逐条立即发送或移回输入框编辑。停止后保留队列；退出保存回原草稿，不在重启后自动重发。
- 卡片停止只针对该 taskId；历史卡「重试停止」不能打断当前新回答、停止其语音或废弃其提交代次。未确认的定向取消可超时重试，迟到响应不能解开另一轮的按钮锁。
- 历史 `cancelRequested=true` 任务在加载后同样不阻塞发送。展示截断状态，保留 Runtime 原状态、checkpoint、工具结果和 Evidence。缺少可信云端读回时显示核实阻塞原因；原生 Harness 和已验证失败回执的原恢复入口保留。
- 公共 wire/Schema、Runtime 状态机、依赖和数据库迁移均无改动。没有清理任务表、删 cloud unknown 标记或自动重放旧工具操作。

## 源码审查

`tasks` 表是快照真源，但这不构成直接 SQL 修改终态的充分依据。现有 `requestCancel` 对 `waiting_reconciliation` 只置取消标记；启动恢复优先保留未消费的 cloud inflight/unknown。`finishNativeReconciliation` 和原 receipt 终止入口仍要求对应的真实停止/失败/工具证据，不能仅凭取消和 deadline 到期虚构 cancelled。

独立审查发现并修复了历史卡重试误调用整个对话停止的 P2；改为独立的 `stopTask(task)` 与每任务请求身份。其余队列、迟到提交和 UNKNOWN 投影未发现其他可复现 P1/P2。

PR 提交前的第二轮独立审查补充发现“已受理、首个状态读回前停止”竞态：任务 ID 尚未进入 Desktop 缓存时可能漏取消。修复后受理 ID 立即绑定到交付请求；主停止和引导均取消该绑定 ID，不等待首读回，迟到读回也不会恢复输出。增加两个定向回归分别覆盖主停止与引导。

## 验证

环境为 Node 24.15.0、npm 11.12.0、Electron 44.2.0。Browser skill 未提供（`Browser plugin not available`），使用仓库已有 Playwright/Electron 流程，没有安装新的浏览器依赖。

| 检查 | 结果 |
| --- | --- |
| 根 `npm run build` | 通过 |
| Desktop typecheck、两个新增模块语法 | 通过 |
| 架构门禁 | 3/3 通过 |
| Desktop 全套，仓库外独立 TEMP/TMP | 1570 通过，7 跳过，0 失败；最后定向卡片修复另做受影响回归 |
| 停止、定向旧卡重试、迟到回执、刷新/事件顺序、阻塞说明回归 | 首轮最终 54/54 通过；PR 审查补充两个受理后首读回竞态用例，原命令扩为 56 项。命令为 `node --test apps/desktop/test/task-action-focus-order.test.mjs apps/desktop/test/conversation-main-actions.test.mjs apps/desktop/test/panel-task-feedback-order.test.mjs apps/desktop/test/panel-task-refresh-order.test.mjs apps/desktop/test/panel-event-readback-order.test.mjs apps/desktop/test/reconciliation-status.test.mjs` |
| 原 `test:text-smoke` | 通过，真实本地 Runtime + 显式 Fake Model |
| 原 `test:smoke` | 通过，实际 Electron 窗口 / Preload + 显式 Fake Runtime；断言读回真实取消标记和状态，再检查即时截断与输入解锁 |
| 实际 Electron 交互 | 九项通过，默认 420px 与窄窗 340×700；页面 identity、非空、无错误覆盖层、console/pageerror 均通过 |
| 实际 AgentArts、实体麦克风/扬声器、日历读写 | 本轮未调用、未代验 |

九项交互为：排队不提前提交、指定队列项立即发送、真实终态后 FIFO 发送、运行中引导、停止保留草稿、停止后新消息、历史停止重试保留新任务、编辑排队项、窄窗口布局。额外回归使用 11 张合成的已取消待核实卡，确认仍可提交新消息且原状态不变；这不是用户真实账本的验收。

首轮沙箱内全套遇到 `EPERM realpath` 和相关原生夹具级联失败（1318 通过、238 失败、7 跳过）。使用最小提权、独立仓库外临时目录复核后得到上述 1570/0/7；没有放宽权限/Schema/工具执行断言。最后定向取消修复依照受影响范围验证，不重复无关重型检查。

## 用户事件和原状备份

用户报告已完成一次经批准的离线收账：11 张任务转为 cancelled，审计事件 1074–1084，主对话已由用户实测解锁。该结果记录为用户实测；本轮没有重复手术，也没有修改任何用户 SQLite 文件。

用户提供的术前单文件备份以只读 immutable 模式核验，前后 SHA256 均为 `00520fbb002902078c2e3d641b77db098604a580b949da0cc5a49bd2cd195042`，大小 5,292,032 bytes。没有对应 WAL/SHM；主库可见的最后事件为 1046，非终态为 2 created + 9 waiting_reconciliation（后九张均已取消）。它尚不包含用户描述的最新主父 rev15/16、后续成功日历子任务或收账事件，不能用该备份独立证明最新现场。私人文件路径、真实任务 UUID、日历内容和原始 checkpoint 不进入公开证据。

本轮只读确认了“已结束父任务仍有待核实子任务”的备份实例。日历真实读写、Radicale `.ics` 和 HTTP/HTTPS 验收均为用户提供的既有证据，本轮未重做。ToolGateway 对已进入非只读 execute/输出校验阶段的异常保守归类为 RESULT_UNKNOWN；简单暴露原错误文本或把短耗时异常改成可重试会引入泄密/重复写风险，宿主脱敏诊断应作为独立工作包处理。

后续任何真实账本写入遵循用户规定：关闭应用 → 三件套备份 → 事务内改账并补事件 → 校验零未终态 → 重启。工作区源码修改不触碰该账本。

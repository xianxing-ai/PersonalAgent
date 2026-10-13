# MOD-09：比赛主对话上下文边界回归

日期：2026-10-08；目标 profile `huawei_ict_agentarts`；负责人 goo122；状态 `in_progress`。
基线 `e86bac5382180495854923dbcf4ca9bbaf3a9b55`，工作树
`.worktrees/goo122-competition-context-regression`，分支 `codex/goo122-competition-context-regression`。
本包接续真实本地记忆生命周期记录 PR #312；不修改该 PR 分支或共享工作区。

## 实施前方案与兼容边界

复用 Runtime 原任务事件水位、成功历史查询和现有 Competition 上下文 reader，不新增历史库或公共 DTO。
带 `taskId` 的宿主补充消息只能来自当前会话、当前任务创建之前且仍可消费的成功任务历史；
其他会话、失败/取消、待完成、后建/当前及未知任务的补充消息均忽略。
无 `taskId` 的 Live 消息仍由受信宿主完成会话/来源范围校验，本 reader 不向外部数据授予这种信任。
当前任务已请求取消时读取拒绝，保持既有 deadline、signal 和会话检查。
消息 ID 合并、20 条消息上限、withheld 过滤和不可信数据封装保持原语义。

这是现有 host-only 过滤的必要收紧，无公共 operation、Schema、迁移或依赖变化；
调用方若给补充消息绑定任务，该任务须出现在原 Runtime 的可用成功历史内。
保留无任务 Live 补充入口，不扩展 Local Profile；Memory/Agent/Cloud 接口仍 provisional。

## 验收目标

- 直接覆盖 reader 的会话/任务水位隔离、撤回与私人派生标记、消息合并、结果副本及 20 条边界。
- 覆盖会话范围、未知/过期 deadline、取消信号、Runtime 取消及消息格式拒绝。
- 实际 SQLite 重启恢复公开历史，不恢复 withheld 私人历史。
- 正式 AgentArts Runtime 工厂加显式 Fake HTTP，检查最终 goal 的 `untrusted_data` 消息与临时补充正文不进入任务检查点。
- await 历史读取期间取消，零凭据读取、零 HTTP。
- 实际私人消费 host/Runtime 持久绑定的重启失效；确认器与数据为显式合成，不是真实云许可。

## 验证与交付

修复前新增 7 项测试中 5 通过、2 失败：带任务绑定的 overlay 混入其他会话、失败/取消、
待完成及后建/未知任务；Runtime 当前任务请求取消后 reader 未拒绝读取。
最初另有测试收集器误返回数组长度而违反同步 void guard 的夹具问题，修正后正式工厂发送用例通过，
未将该夹具问题记为生产缺陷。原始日志保留在忽略目录。

生产补修仅位于原 `RuntimeApplication.readConversationContext`：
当前任务取消检查、从原成功历史建立可用任务集合、忽略集合外的 task-bound overlay。
不改变无任务 Live 消息、消息 ID 合并、持久任务或云端状态。

定向命令：

```powershell
node --test apps/runtime/test/competition-conversation-context.test.mjs tests/integration/private-memory-runtime-copies.test.mjs
```

实际 13/13 通过、0 失败、0 跳过：新 Competition reader/HTTP/取消/超时 8 项，
原私人副本/分派 4 项，以及新增真实 host/SQLite Runtime 的旧私人许可重启拒绝 1 项。
后者显式调用原 `recoverInterruptedTasks` 后，metadata 仍存在但旧内存 lease 不恢复；
旧 prepare/send 拒绝且零新确认/HTTP。重新选择合成 Vault 后，新任务必须再次确认才能取得新许可。
测试资料、确认器与 HTTP 均为显式合成，实际 SQLite/host 实现不替代原生或真实账号验收。

Node 24.15.0；`npm ci --ignore-scripts --no-audit --no-fund`、根 build 及修复后 Runtime build 通过。
首次 `npm run check` 的架构、协议夹具、生成检查及类型检查通过；workspace 测试
2615 项，2589 通过、1 失败、25 跳过；Runtime 447/447、Desktop 703 通过/2 跳过、Memory 44/44。
唯一失败为未修改的 `packages/coding-tools/test/git-tools.test.mjs:181`：
Windows `renameSync` 拒绝根目录替换夹具，报 `EPERM`。同一环境单独复验该用例 1/1 通过。
首次 check 退出 1，未执行后置根集成，不能以单独通过替代完整门禁。
未改源码/环境，完整 `npm run check` 第二次退出 0：架构、协议夹具、生成检查、全 workspace 类型检查通过；
workspace 2615 项，2590 通过、0 失败、25 跳过，后置根集成 23/23 通过。
仅验证进程使用项目缓存 .NET 8 和既有实际 Windows Job helper，
TEMP/TMP 位于工作树外项目缓存，未修改系统环境。
日志位于 `.cache/competition-context/`：`before-fix-confirmed.log`、`targeted-final.log`、
`check.log`、`git-root-retest.log`、`check-retest.log`。

#312 的两项同 head Foundation 首次为一成功、一失败；失败为原 Windows grandchild 启动及
Runtime 审批重启用例，均不在该纯文档 PR 的代码 diff 中。失败日志已保留，失败 job 仅 rerun 一次，
2026-10-08 最后核对 attempt 2 已成功，两项同 head Foundation 均为 SUCCESS；
#312 仍为 OPEN、无非作者评审，CI 成功不等于批准或已合并。
本地 A/B 验收授权不扩大到云端；本包无真实模型、真实账号或私人来源操作。
用户已授权本工作包提交、推送及创建独立 PR；交付状态以 Git/GitHub 为准，
独立非作者评审与当前 head CI 另行核对。
MOD-09 保持 `in_progress`；本包不完成真实 AgentArts 消费、私人子任务许可或用户真实流程学习。

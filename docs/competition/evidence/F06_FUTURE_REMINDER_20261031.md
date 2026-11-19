# F06 原调度未来提醒增量

目标 profile：`huawei_ict_agentarts`。需求依据为 PRD PA-009：创建、修改、取消可读回，休眠恢复按约定补跑或标记错过，不重复提醒。

## 实施方案与兼容边界

- F06_N03 继续通过原 Runtime/Policy 子工具 `todo.create`，保存原条目、revision 和完整 reminderTrigger；不新建调度器或任务库。
- F06_N04 继续读取实际时钟与原条目。F06_N05 增加仅本地可信宿主能决定的 guard：未到期且原条目与 pending schedule 完整匹配时跳过通知节点；到期时保留现有真实持久投递读回。
- 完成结果明确包含 `reminderState: scheduled | delivered` 和一致的 `delivered`。`scheduled` 只表示本机原调度已持久安排，绝不声称已送达；未来执行由现有 Scheduler 和通知宿主负责。整图不跨原 deadline 等待未来时间。
- F06 配置版本升级为 `business-20261031-f06-v2`，模板摘要随生成源变化。旧配置与旧模板任务保留原 checkpoint，不迁移、不换 operation 重发；不改变 F07 等其他业务图。
- 用户编辑、取消、提醒时间变更、schedule 替换或原结果未知均不能借旧 revision 完成。自动到期只接受已有的精确 revision+1 和真实持久投递证据。
- 修改 reviewed architecture.json 的 F06 段后用仓库原生成器更新投影，不直接编辑生成类型/模板数据。

## 验证状态

在 `.worktrees/pr531-business` 实施并验证。F06/F07 集成使用实际 `OwnedWorkflowEngine`、签名回执校验、原配置 worker、Runtime/Policy/ToolGateway、AuthorizationQuestions 和相同 Desktop 预检。F06 同时使用文件 SQLite、Todo 安全存储适配和原 Scheduler；候选内容/selector、远端传输/外层出机许可、OS 通知显示及 F07 日历账号为显式 Fixture。无时钟注入或人工推进：未来提醒在实际约 8 秒后由原 tick 投递。

| 检查 | 结果与证据 |
| --- | --- |
| AgentArts、Runtime workspace build | 通过；`f06-future-agentarts-build.log`、`f06-future-runtime-build.log` |
| 生成投影 `check:workflows` | 通过；源与生成投影一致，只有 F06 字段/条件变化 |
| AgentArts workspace tests | 242/242；含候选不能绕过 F06 本机 guard、全部 28 图控制/恢复测试；`f06-future-agentarts-tests-final.log` |
| 实际 F06/F07 图与生产原来源预检 | 23/23（F06 8、F07 4、原 decision helper 11）；`f06-future-production-source-tests-final.log` |
| Runtime bridge/configured worker/guard、Desktop Todo/端口/预检 | 65/65；`f06-future-boundary-tests.log` |
| 架构检查、diff whitespace | 架构 3/3，`git -c core.whitespace=cr-at-eol diff --check` 通过 |

日志均在本工作树忽略目录 `.cache/pr531-business/`。本增量未另跑一轮完整 `npm run check`：根集成负责人已在统一集成树运行全仓检查，源码冻结完成后将合入此增量并按最终集成 head 再验证；本记录不能代替该最终检查。

F06 实际行为覆盖：到期原自动 revision+1 与通知持久回执、未来 `scheduled/false` 后重启仍为原 pending schedule、真实时间到期投递一次及再次重启不重复、最终许可期间取消/编辑拒绝、原业务子工具拒绝时零创建、提问卡准备后原 decision 来源变更导致 stale 且零创建、最终许可期间自然到期拒绝旧 scheduled 结果且原提醒仍可投递、设备结果未知跨重启不重发。守卫/端口测试另覆盖原完整条目与 schedule 替换、提醒时间改变、取消、范围不足及出口许可中状态变化。

生产 helper `configured-workflow-decision-source.js` 与其单元测试逐字复用根提交 `471e70eb`，不包含其 Main 修改。真实 F06/F07 引擎均经过该 helper：语义、host/tool 候选选择分别读取原图来源，不借 F15/F20 工作区许可。真实引擎另外暴露 F07 的旧 `find(nodeId)` 会先取到 N04 的 decision 回执；本增量将其限定为 `workflow.host.f07_n04`，不把候选选择当作日历版本检查。原四次独立日历读取、一次创建、拒绝、unknown 和结果出口拒绝均通过。

首轮新增候选绕过测试误用了对象而非现有数组形态的 `branches`，得到 EXECUTOR_FAILURE；修正测试输入为公开分支数组后，专门断言 EXTERNAL_FAILURE 且 N05 保持 pending。上述最终 242/242 是修正后的验证，没有修改或放宽生产拒绝逻辑。

## 未验证与交付边界

未运行真实 AgentArts 部署/评测/云整图、真实 Laya/模型选择、真实 Windows OS 通知呈现或真实 CalDAV 账号写入。不存在账号写入或真实收件人发送。此增量只完成 F06 本机纵向实现与上述分层证据；#531 全部接线、平台及设备验收仍由整体交付跟踪，不能据此标记整 PR 可合并。

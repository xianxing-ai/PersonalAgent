# F11 完整显式改期方案接线

目标 profile：`huawei_ict_agentarts`。本增量在原 F11 calendar.update/提醒失效端口及 `708d4395` revision 保护上，接入实际 configured worker，不新增调度、任务或授权体系。

## 方案、范围与兼容

公开 worker 为 `workflow.business.f11`，配置 `business-20261031-v1`。严格输入包括原 `calendarReadArguments`、至少一个变更字段的 `calendar.update` 参数及原 `{todoId,revision,scheduleId,conversationId}` 提醒身份。只有在原 N02 完整日历窗口找到精确事件、原 N03 选择的替代方案与此输入一致、且无需新增业务决定时，进入完整参数路径。

N04/N05 使用实际受信 guard。N04 只判断是否还缺决定，完整方案可跳过语音补问；N05 的 selected 只允许进入原 Policy 路径，日历更新与条件清除提醒仍分别走原提问卡/Policy/Gateway。F11 模板条件文字据此澄清，并将两节点标为 hostGuard，模型候选不能自行选择分支。缺参数、需要补充决定或语音来源缺失的路径保持 unavailable，未删去该需求。

N05 在原节点下增加一次独立 `calendar.events` 读，核对原窗口版本；然后单次 calendar.update，按原 revision 清除旧提醒，再核对原 Gateway 执行与 provider 回执及确切 cancelled schedule。版本检查覆盖原窗口，不能声称跨审批等待或多个 Provider 调用的事务锁；CalDAV 自身 GET/If-Match/PUT/读回语义保持不变。

N05 结果出口与整图完成出口均重读原日历/提醒证据，并在异步许可之后再次核对。部分副作用、未知结果或出口拒绝均保留原操作，不重放写入。Runtime F11 factory 新增必要 `readChangeBinding` 端口和 `authorizeReceipt`，依赖不全仍不注册；Desktop 生产组合实际注入该端口。原公开 factory 为 provisional，此变更不升级冻结状态。

模板源使用原 generator 更新投影。无 Core wire、数据库迁移或新依赖；旧模板/配置摘要变更保持拒绝恢复，不重新解释旧操作。`readBusinessAvailability('F11',scope)` 必须由 Main 注入当前真实 calendar 配置与 Todo 原宿主绑定；本工厂不自造可用状态。

## 验证与未验项

实际图引擎/Runtime/SQLite/Todo/Scheduler/AuthorizationQuestions/Policy 的本地组合共 9 项通过：完整方案成功、缺决定拒绝、原日历窗口变化、拒绝日历子卡、拒绝 Todo 子卡、日历未知结果、清提醒卡等待期间编辑、完成出口拒绝、完成出口期间编辑。各写入独立审批，拒绝/未知/并发变化保留已发生副作用与原提醒事实，不产生成功完成回执。日历 Provider、候选内容/selector、云端传输与外层出机许可是显式 Fixture，没有真实账号写入。

验证：AgentArts/Runtime 构建通过；上述 F11 用例与 F06/F07 实际图、工厂、原提醒并发审批及 decision source 边界合计 **50/50**；AgentArts **242/242**；原模板生成器 `check:workflows`、架构门禁及 diff 检查通过。日志在本工作树忽略目录 `.cache/pr531-business/f11-worker-final-tests.log`、`f11-agentarts-tests.log`、`f11-architecture.log`。按集成分工，本增量不独立重复全仓 check，由根集成分支在合入后执行最终全量检查。

主集成的 `createBusinessWorkflowAvailability` 已为 F11 绑定当前 calendar account/URL/revision，并调用原 Todo `todo.update` availability 校验该原任务的宿主 generation；未签发工具权限。日历版本变化或原 Todo 绑定撤销会阻止继续。集成树 AgentArts/Runtime build 与 F11/真实 Todo 并发审批/可用性定向 **14/14** 通过。

本包只交付完整显式方案分支。缺决定时的原语音补问、真实天气来源与行程影响映射、真实 CalDAV、华为 AgentArts 部署/评测、真实模型选择仍未验证或未接通；不得将其写成 F11 全功能完成或 #531 可合并。

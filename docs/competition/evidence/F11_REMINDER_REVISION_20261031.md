# F11 原提醒 revision 保护

目标 profile：`huawei_ict_agentarts`。F11 清除旧提醒必须保护原条目，不能在日历写入或审批等待后覆盖用户的新编辑。

实施方案：给既有 `TodoUpdateInput` 和 `todo.update` 描述符 Schema 兼容增加可选 `expectedRevision`（正整数）。由现有同步 `TodoService.update` 在读取当前条目后、任何写入前校验；不同返回 `REVISION_CONFLICT`，保留条目与原/新提醒。省略参数的旧消费者行为不变。此工具契约原来就在 `packages/productivity/src/index.ts`，不属于生成的 Core wire Schema；类型由原 workspace TypeScript build 生成，不手改 dist。

F11 固定传原 revision，保存完整原条目、trigger 和 Runtime pending schedule；清除后只接受精确 revision+1、原 Gateway 子任务的确认结果和同一 schedule 的 cancelled 状态。原日历变更未知或部分完成保留原 operation，不自动重试，也不因其他来源清除了提醒而宣布成功。无新增数据库、调度器或授权层。

验证结果：productivity workspace build 通过；公开 Schema/服务兼容、F11 端口/原执行读回、原 TodoHost 与 Runtime 守卫等共 46/46 通过（`.cache/pr531-business/f11-revision-final-tests.log`）。其中 4 项使用实际文件 SQLite、Runtime/ToolGateway/Policy、Desktop TodoHost 与 AuthorizationQuestions：未改变原 revision 的清除成功；提问卡等待期间标题编辑、改提醒时间、取消分别使旧清除获批后仍因 `REVISION_CONFLICT` 拒绝，当前条目和所有原/新 schedule 保持不变。改期情形确认原 schedule 已由用户操作取消、新 schedule 仍 pending。没有手工注入允许 grant。

F11 端口测试为显式 bridge/日历 Fixture，覆盖日历完成后、提醒清除前发生用户编辑时零 clear 派发；确认后的 clear 只读原结果，不重复调用；后续编辑不能利用 `revision > original` 冒充完成。该阶段尚未装配完整 F11 条件图，后续工厂工作包继续处理；没有真实 CalDAV、语音或 AgentArts 调用。本地 CAS 只能证明当前单进程同步存储边界，不声明跨进程数据库锁。

新增审批测试首轮误把 `submitHostToolTask` 的 HostToolTaskReadback 当成 TaskSnapshot，等待不到目标卡；修正测试使用其正式 `.task` 后 4/4 通过，未改变生产审批路径。最终全仓检查由根统一集成树覆盖，本增量不重复独立启动全仓。

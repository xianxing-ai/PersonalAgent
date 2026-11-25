# F11 原任务地点补问兼容方案

目标为 Competition Profile。当前 F02 与 AuthorizationQuestions 证明的是原工具参数的审批决定，没有自由文本业务回答槽；不能将 allow/语音“同意”改成地点，也不能跨 run 借用批准。本增量只补 F11 weather.query.location：原 N01 host 在原 TaskRuntime 生命周期中等待本机明确文字答复，取得地点后才派发原 weather.forecast child。日期、单位、事件、日历方案和提醒仍来自原显式输入。N03 仍消费 N01 实际天气结果，N05 仍核对同一查询与新鲜度。没有新图节点或调度。

原 N01 task checkpoint 保存题目、原 graph/session/operation、参数摘要、用户 sourceTask、conversation、deadline、revision；Main 在原可信对话文字入口调用 submitReply，持久消息 commandId、origin=desktop_explicit_text、单一 location 字段与 CAS revision。该答复不创建或消费批准卡，不签发天气或写入 grant，不生成新云任务；已有 Runtime/Policy 继续独立审批。完整显式地点路径不变；只在构造注入原答复宿主时允许 location 缺省，缺日期/单位仍拒绝。不从正文、contentRef、定位设备或模型猜地点。

公开 Desktop 口：createF11LocationQuestionHost({getApplication,onUpdate,now})，readQuestion({taskId,conversationId}) 与 submitReply({taskId,questionId,expectedRevision,sourceTaskId,commandId,location},{conversationId})。taskId 是原 N01 host，sourceTaskId 是其原用户任务；Main 必须先核验原 panel/workspace 文字事件及当前会话，再传入真实提交 commandId。重复同 command/同答案只读，替换答案、过期、取消、换会话、来源擦除、原参数或 revision 漂移拒绝。等待期间不直接写任务终态；原 signal/deadline 停止等待，未知结果不自动重提。

readQuestion 也接受原 root 或 graph taskId，只通过公开 readSubagentTasks/readPendingOwnedWorkflowHostTask 和原 graph→N01 checkpoint 关系发现题目，不让 UI 猜私有 host key。回传原 N01 taskId、graphTaskId、boundUserTaskId（字段名 sourceTaskId）、questionId/revision/state/deadline 和固定问题；sourceTaskId 只证明原用户任务上下文，不声称原任务文字已经包含新地点。新地点来自 Main 后续真实文字事件，commandId 是该消息的稳定身份。回答由原 checkpoint 的 saveCheckpointOnce 原子单次落库；普通 task.submit 和模型输出不能调用这个 host-only recorder。

F11 工厂注入 f11LocationQuestion，同实例供 Main 读/答。该注入使 weather.query.location 可缺省，但缺地点时不接受模型填充的 locationQuery 别名；原日期/单位必填。配置版本更新 business-20261101-f11-v3，旧配置摘要不恢复为新图。原 query 始终不变，后续 weather child 的完整参数按原答复只读构造，并再次通过独立 Policy 与原 prepare/project/final accepts 出口。

文字回答与真实语音是不同来源。本包不改变 F02 声学/播放证据缺口，不将 Fixture 或明确文字回复当作真实语音验收。Main 集成和真实云/日历/设备证据另行记录。

本地验证：F11 实际 Engine/Runtime/SQLite/Policy/AuthorizationQuestions 与原 Todo/scheduler 的完整显式、天气、地点及失败场景 26 项通过；F11 原端口与过滤后文件启动合计 28/28，另未过滤的业务工厂与 F06/F07/F11 端口 9/9。天气 HTTP、日历、云图/candidate/selector、审批回答和文字输入事件是显式 Fixture。覆盖地点单次答复、错误会话/revision/替换拒绝，天气独立拒批、取消、grant 撤销、原来源擦除、问题期限（专用时钟 Fixture），未知天气结果保留原答复和原提醒；SQLite 重开仅证明持久只读/拒绝重提，不宣称未知工具已恢复执行。未调用真实云、真实日历或设备。

原问题参数摘要采用公开 toolArgumentsDigest，读取与提交都核对原 N01 execution、仍有效 grant 的精确参数摘要/weather:read/期限；最后地点身份回归 7/7，架构 3/3、diff 检查通过。完整仓库检查由根集成统一执行。F11 缺决定与 F08 问答/重规划仍为后续独立包，本包不宣称这些分支完成。

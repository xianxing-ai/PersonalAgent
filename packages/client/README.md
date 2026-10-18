# 公共客户端（MOD-02）

<!-- architecture-scope-20261013 -->
## 当前架构职责

目标profile：huawei_ict_agentarts。工程责任：MOD-02（goo122）。产品流程：F01、F02、F24、F25、F28；逐节点流程见[WORKFLOWS](../../docs/design/workflow-architecture-20261013/WORKFLOWS.md)，主架构见[DESIGN](../../docs/design/workflow-architecture-20261013/DESIGN.md)，模块接线见[MODULES](../../docs/design/workflow-architecture-20261013/MODULES.md)。

复用既有公开契约与宿主注册，将所列功能的节点输入/输出映射到实际能力，交付必要消费接线。

当前实验由本机Laya提供有限候选判断，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用，本模块提供实际能力或候选，模型不能代签授权/宣布主任务成功。调用仍经既有公开端口、Runtime/Policy/ToolGateway或ModelGateway；同资源写入、取消、版本、结果未知与Evidence沿用既有语义。模板依赖由自有ARM64镜像串行推进；并行和机会影子尚需实际验收，架构未最终定型。

本轮仅重写架构说明。具体方法/配置/真实证据以当前源码与下面技术参考为准；这些参考的历史阶段不覆盖[当前接口状态](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)，也不证明新责任/语音/影子接线已经完成。

## 现有API、运行说明与历史验证参考
<!-- /architecture-scope-20261013 -->

消费 @personal-agent/contracts 0.1.0-alpha.1；wire 1.0.0。Core Runtime Profile 1 的消息、任务、会话和审批只读查询子集已冻结；Transport、事件生命周期及其余 operation 仍按[当前接口目录](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)登记。Client 接受注入的 Transport，不导入 Node 系统 API、密钥或 Runtime 实现。

当前新增 Client 消费面只服务 [Huawei ICT AgentArts Competition Profile](../../docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)，包括 profile、deployment/trace 引用和可信工具闭环所需状态；它不负责选择 AgentArts 或 Local，也不实现失败回退。Local 仅为可选留存，不产生当前新增接口义务。

先 await client.connect() 握手，再 client.call(operation, payload, options)。客户端发现未注册能力后拒绝调用；task.submit 必须显式提供 idempotencyKey。超时和 AbortSignal 传给传输层；错误保留 code、retryable、retryAfterMs；客户端不自动重试。

Transport.send 应关联请求、序列化消息并实现实际 IPC；此包目前只定义传输接口。Electron preload 和 C# Named Pipe 适配由 zemeng 实现，实际桌面运行未验证。

取消 RPC 等待与取消业务任务不同。停止业务使用 task.cancel，返回 cancelling 仅表示受理；等待后续 cancelled 或 waiting_reconciliation。外部未知结果需要读回，不能根据超时自动重发。

`Client.call` 的可选 `taskId` 用于需要任务绑定的内部操作（例如 MOD-05 的 `tool.invoke`）。`scopeRef` 只是已有授权引用，客户端不能通过自报 scope 获得权限。

EventCursor 每实例绑定一个 streamId。accept 批量验证、排序、去重；序号缺口抛 CURSOR_EXPIRED，不推进游标。重连使用 afterSequence 续订。回放已过期时由宿主协调快照和续订位置，再显式 reset；本包不假定一个无序快照能够解决并发快照/订阅竞争。当前历史冲突检查窗口 512 条，超窗旧事件按序号丢弃。服务端尚未实现事件裁剪、unsubscribe 和真实 CURSOR_EXPIRED 生命周期，因此事件通道整体仍为 `provisional`。

根目录 npm run demo:protocol 展示消费者调用和取消往返，输出明确标记 mock。它使用进程内 Fake，不能替代真实跨进程 Host 或外部能力验收。PR #34 已验证 Desktop 通过本 Client 的 `task.list`、`conversation.list`、`approval.list` 恢复公开状态，不再读取 Runtime 私有 checkpoint。

# 公共客户端（MOD-02）

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

消费 @personal-agent/contracts 0.1.0-alpha.1；wire 1.0.0。Core Runtime Profile 1 的消息、任务、会话和审批只读查询子集已冻结；Transport、事件生命周期及其余 operation 仍按[当前接口目录](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)登记。Client 接受注入的 Transport，不导入 Node 系统 API、密钥或 Runtime 实现。

当前新增 Client 消费面只服务 [Huawei ICT AgentArts Competition Profile](../../docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)，包括 profile、deployment/trace 引用和可信工具闭环所需状态；它不负责选择 AgentArts 或 Local，也不实现失败回退。Local 仅为可选留存，不产生当前新增接口义务。

先 await client.connect() 握手，再 client.call(operation, payload, options)。客户端发现未注册能力后拒绝调用；task.submit 必须显式提供 idempotencyKey。超时和 AbortSignal 传给传输层；错误保留 code、retryable、retryAfterMs；客户端不自动重试。

Transport.send 应关联请求、序列化消息并实现实际 IPC；此包目前只定义传输接口。Electron preload 和 C# Named Pipe 适配由 zemeng 实现，实际桌面运行未验证。

取消 RPC 等待与取消业务任务不同。停止业务使用 task.cancel，返回 cancelling 仅表示受理；等待后续 cancelled 或 waiting_reconciliation。外部未知结果需要读回，不能根据超时自动重发。

`Client.call` 的可选 `taskId` 用于需要任务绑定的内部操作（例如 MOD-05 的 `tool.invoke`）。`scopeRef` 只是已有授权引用，客户端不能通过自报 scope 获得权限。

EventCursor 每实例绑定一个 streamId。accept 批量验证、排序、去重；序号缺口抛 CURSOR_EXPIRED，不推进游标。重连使用 afterSequence 续订。回放已过期时由宿主协调快照和续订位置，再显式 reset；本包不假定一个无序快照能够解决并发快照/订阅竞争。当前历史冲突检查窗口 512 条，超窗旧事件按序号丢弃。服务端尚未实现事件裁剪、unsubscribe 和真实 CURSOR_EXPIRED 生命周期，因此事件通道整体仍为 `provisional`。

根目录 npm run demo:protocol 展示消费者调用和取消往返，输出明确标记 mock。它使用进程内 Fake，不能替代真实跨进程 Host 或外部能力验收。PR #34 已验证 Desktop 通过本 Client 的 `task.list`、`conversation.list`、`approval.list` 恢复公开状态，不再读取 Runtime 私有 checkpoint。

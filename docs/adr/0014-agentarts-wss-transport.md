# ADR-0014：AgentArts 自有镜像的 WSS 主通道

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

状态：实施中（provisional），2026-10-09。用户已选择 WSS 主通道、HTTPS 备用并授权继续实现；这不等于公开网关已经验收。

## 边界与协议

官方允许同一 ARM64、0.0.0.0:8080 容器提供 `/invocations` 和 `/ws`。本工作包在现有 HTTP 宿主上增加 WebSocket Upgrade，TLS 由可信平台/代理终止，本地客户端只接受生产 WSS 地址。官方依据：[入站协议](https://support.huaweicloud.com/highcode-agentarts/agentarts_10_070.html)。

公开网关路径另行验收：平台[自定义路径文档](https://support.huaweicloud.com/highcode-agentarts/agentarts_10_131.html)说明前缀匹配`/runtimes/{name}/invocations/{custom}`映射容器`/{custom}`，但未明确承诺该路径支持Upgrade。容器/ws和现有SDK的HTTP路由不能证明公网`/runtimes/{name}/ws`已存在。客户端要求受信宿主显式配置地址，精确绑定同网关/运行时的直接/ws或/invocations/ws路径；后者只有普通路由映射依据。部署前后须读回真实路由，不生成猜测地址、静默尝试多个地址或改到其他运行时。

独立 `@personal-agent/contracts/agentarts-transport` 0.1.0 提供严格信封与生成类型；不修改已冻结的本地 wire 1.0.0 operation。调用使用现有单键 HTTP payload，绑定 session、request、幂等键、UTF-8 payload digest 与原 deadline。accepted 只表示云编排受理；result 仍通过既有 application JSON/Coordination 校验，本地 Runtime 负责终态。

云服务只保留有界、进程内传输回执，用于同输入去重、只读状态和结果重放；它不是任务库，不持久授权或本地工具记录。ready 明示 restartRecovery:false。重启或缓存失效后的 unknown 不许可重发；原本地工具回执也不能证明新云续答未受理。

## 认证、降级与核实

受信 Host 读取凭据；外层 AgentArts Authorization 保留，额外可配置 X-PA-Agent-Token 用于自有服务鉴权，不进入 URL、模型、Renderer、日志或证据。没有自有入站 token 时 WSS 关闭，现有 HTTP 平台路径保持兼容。Session ID 只做路由/关联，不是授权或租户声明。

每次发送前重新核验导出与工具目录。HTTPS 备用只限同 profile/部署、显式允许、且能证明尚未发送 invoke 的连接失败；401/403、协议错误和发送后的未知结果不能降级重发。降级状态对宿主可见。发送后结果未知由可信本机错误分类传入 Runtime waiting_reconciliation，并保存不含 payload/凭据的 checkpoint，阻止重启或既有恢复入口盲发。匹配终帧只持久received身份/摘要，原inflight直到Runtime持久消费提案或提交原任务succeeded后才清除；传输受理/返回不能提前解除意图，崩溃窗口保守进入核实。

## 兼容与验证

现有未配置消费者保留 HTTP；配置 WSS 的 Competition 消费者使用新传输，同一镜像保留 HTTP 健康和备用端点。新增 ws 8.22.0 为服务端/Node 客户端共享的生产依赖，@types/ws 8.18.2 仅开发类型；不增加第二个模型入口或本地执行循环。

必要检查覆盖公开 schema、握手/认证、期限/取消、并发、去重/输入替换、进程重启未知、发送边界双重导出核验、备用条件、Runtime 审批/工具读回与未知状态恢复。实际 ARM64/AMD64 镜像和真实 AgentArts WSS/HTTPS 网关分别验收，合成测试不能替代 deployment/trace/usage/评估证据。Wiki 具体实现仍交 goo122，本工作包不私设 Wiki 系统。

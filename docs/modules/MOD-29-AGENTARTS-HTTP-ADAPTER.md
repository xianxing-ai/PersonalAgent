# MOD-29：AgentArts 文本 HTTP 适配器

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts` Competition Profile。
- 负责人：`zemeng`；工作树：`.worktrees/zemeng-agentarts-http-adapter`。
- 本增量基于已同步的 `origin/main`（PR #39 合并后的 `188f925`）；不提交、不推送，交由非作者评审后集成。
- 文件所有权：`packages/coordination/src/agentarts.ts`、`src/index.ts`、对应离线测试、
  Coordination README 与本文档。

## 交付范围

`AgentArtsCloudAgentPort` 实现现有 provisional `CloudAgentPort.invoke` 文本边界，
不改变 `packages/contracts`、TaskRuntime 或公共 wire Schema。构造参数包含 HTTPS
网关 origin、受校验的 runtime 名称、`debug`/`published` 调用模式和宿主注入的
`AgentArtsAuthorizationProvider`。每次调用都实时读取一次授权，并把 taskId/revision
只用于受限的 session/request header；发送给 AgentArts 的 body 只有：

```json
{"query":"<goal>"}
```

请求固定使用 `POST /runtimes/{runtime_name}/invocations`、
`Content-Type: application/json`、`Accept: application/json,text/event-stream`、
`Authorization`、`x-hw-agentarts-session-id`、`X-Invoke-Mode` 和 `X-Request-Id`。
不实现 IAM 签名，也不携带本地 deadline、任务 revision、凭据或私密上下文到 body。
Session/request ID 只使用 ASCII 安全字符并限制在 64 字符内；过长或空 taskId
使用稳定的确定性 hash，不把原始值放入 body。

响应只接受单个 JSON 事件、JSON 事件数组或 `text/event-stream` 的 `data: {json}`
事件，且必须带有 `application/json` 或 `text/event-stream` content type。仅消费
`event: "message"` 的 `data.text`；有安全非负整数 index 时排序并去重，同 index
的不同文本拒绝，无 index 的片段按接收顺序追加。标准 SSE 按空行分隔事件并以换行
连接多行 `data:`；对省略空行的网关仅兼容每个 `data:` 行都是完整 JSON 事件的情况，
不会提前拆分合法的标准多行 JSON。总响应最多 1 MiB，最终文本最多 16,000 个字符，
空文本、结构错误、越界和非 UTF-8 均拒绝；返回前再次经过
`parseCoordinationTextResult`，结果始终是 `verification: "unverified"` 的纯文本。

## 取消、截止时间与错误边界

请求的 `AbortSignal` 与 deadline 合并到一个内部 `AbortController`，每次调用结束时
清理父 signal listener 和 deadline timer。适配器不把底层异常、响应正文、goal 或
Authorization 值写入错误消息，并拒绝 Authorization 中的控制字符（包括 CR/LF）。
当前 contracts 没有 `DEADLINE_EXCEEDED` 或
`EXTERNAL_SERVICE_ERROR`，因此映射为：

| 场景 | 合同错误码 |
| --- | --- |
| 调用者取消 | `CANCELLED` |
| deadline 已过或内部截止计时器触发 | `TIMEOUT` |
| 授权读取、网络、HTTP 非 2xx 或响应格式失败 | `EXTERNAL_FAILURE` |

HTTP 5xx 和网络错误标记可重试，但本适配器不自动重试；未知副作用不得盲目重放。

## 安全与可用性状态

这是根据 2026-09-08 官方 Huawei Cloud Invoke Runtime 文档编写的离线适配器，
Fake fetch 测试不代表真实服务已接通。真实 AgentArts 项目/runtime、deployment、
认证链路、流格式、trace/usage 读回，以及本地 Policy/ToolGateway 经过云端结果的
闭环都尚未验证，能力仍为 `unavailable`。宿主没有明确配置时不得静默回退到 Local
或 Fake；Renderer、日志、仓库和示例中均不得出现 API key。正式 Competition 运行
仍须由受信 composition root 显式选择并由后续 MOD-32 完成真实目标系统验收。

## 离线验收

新增测试覆盖：published/debug 请求头和 body 精确性、逐次授权读取、JSON/SSE 乱序与
去重及标准多行/无分隔兼容、配置拒绝、取消/截止、授权和网络失败、底层错误与
401/500 脱敏、授权 CR/LF 拒绝、1 MiB/16,000 字符边界、流式提前限流、严格 UTF-8、
错误 JSON、冲突 index、空文本、受限 request ID 和 hash session id。真实 API、
deployment、账号和云成本本次均未执行。

## 2026-10-05 下一增量：失败响应流释放

按本人邮件继续指令与 #212 文件登记，在已合入 #277 的 main `53e6274` 内容上
补齐 HTTP 适配器生命周期。原实现对超限 reader 仅释放锁、对未读取的 HTTP 失败
直接返回，忽略取消的 transport 迟到响应也未关闭；三个真实 `ReadableStream`/
注入 reader 回归及一个迟到响应回归分别先证明旧清理调用为零。

现在未完成读取的 reader 先尝试 cancel 再 release；未消费的失败响应以及取消/期限
之后到达的响应只清理，不读取私有正文、不继续执行或自动重发。清理抛错、拒绝或
永久等待不会覆盖原 CANCELLED/TIMEOUT/EXTERNAL_FAILURE，也不拖住原调用。
完整成功流只释放锁，不额外取消。接口不授予新权限、不改变公共 wire/Schema、
云配置或响应解析标准；不能据此声称远端工作已停止或真实云验收完成。

Node 24.15.0 的 coordination build 与模块测试 110/110 通过（HTTP 适配器52项）。
这是实际本地 Web Streams API 与显式注入 transport 的生命周期验证，没有云调用。

# WSS Upgrade 未发送时恢复同版 HTTPS（2026-10-22）

Profile：`huawei_ict_agentarts`。工作树 `.worktrees/psec-real-completion`，分支
`codex/psec-real-completion`，从 `abe478534d42a2726c9254c26e287d8c24901cdd` 开始。
只读核对根已提交 `966ec4c5` 后，本包生产传输/配置文件与目标直测无基线差异。
保留主控和其他协作者对 main、应用层 timeout、授权和 coding glue 的所有权。

## 已确认缺口及修复

原 `AgentArtsWebSocketTransport.canFallback()` 只识别本地建立连接失败。
`unexpected-response` 在 invoke 和持久 dispatch 之前返回明确 HTTP Upgrade 失败，
却不能进入已经启用的 HTTPS 备用分支。此事实不能证明任何具体部署已删除或失效；
也不能推断固定版本 r3 已死亡。本包没有读取真实用户配置或连接真实部署。

修复仍经过原 `AgentArtsCloudAgentPort` 发送主链，仅扩大原 never-send 分类：

| 传输事实 | 行为 |
| --- | --- |
| 本地连接建立失败，或有效 HTTP 4xx/5xx Upgrade 拒绝；401/403 除外；invoke 从未 send | 仅已显式启用备用时，按原 requestId、payload、期限及同网关/运行时/原 pin 尝试一次 HTTPS。 |
| 401/403、3xx、无效 status、不兼容 ready/protocol、未启用备用 | 原明确失败；不尝试 HTTPS，不猜另一个地址或版本。 |
| invoke 已尝试 send，无论是否已有 accepted | 继续原 `AgentArtsResultUnknownError` 和核实路径；不 fallback、不回放。 |
| 最终目录/导出 guard 拒绝、配置改变/撤销或原取消/期限失效 | 原 guard/期限规则生效，不能靠备用通道放行。 |

`breakConnection()` 对已尝试 send 的 pending 仍优先产生本地 ResultUnknown；即使
收到伪装成 Upgrade 的后续事件，也不会被新增分类接纳。握手不发送 query，TLS 校验、
禁止重定向、完整目的地绑定、受信凭据注入和原 terminal/unknown 处理均保留。
未改 Runtime 状态机、重试、恢复、授权来源或公开请求/响应 Schema。

## 实际传输可见性及主控接口

继续使用原 `onTransportState`，`https_fallback` 兼容增加可选固定字段：

```text
state: https_fallback
sessionId: 原哈希会话标识
requestId: 原传输请求标识，与 HTTPS X-Request-Id 相同
transport: https
deploymentSelection: pinned | latest
deploymentVersion: 仅 pinned 时为原精确版本
```

事件发生在最终 guard 和 fetch 入口之后，不能把 guard 拒绝误报为已经使用备用。
最终 guard 与 fetch 之间不新增 await 或观察回调。原 `agentArtsTransportNotice()`
消费该事件，明确显示“WSS 调用尚未发送，正在尝试 HTTPS 备用连接（固定部署 …）”，
并说明执行结果以原任务回执为准；不宣称原 pin 已在 WSS 执行成功。
未钉版请求仅显示“默认 Latest，实际版本尚未读回”。版本只允许受限字符和长度，
其他 URL、正文、header、token 或外部错误字段不进入提示。

main 已使用原 notice 函数，无需新增执行/审批入口。本包未编辑 main；主控可继续通过
同 requestId 关联固定传输字段，不能记录原 endpoint 或凭据来代替该投影。

## 配置与 Latest 边界

没有修改 `agentarts-config.js` 的生产逻辑，因为原配置已经支持在同一目的地通过
`configure({gatewayUrl,runtimeName,allowHttpsFallback:true})` 显式启用备用，保留原
精确 WSS/pin 和受信凭据并加密保存；新直接测试确认重启后有效。旧 transport 绑定
立即失效，需要沿原重新装配流程使用新 options；不能在旧实例偷偷换配置。
本包只对公开合成夹具执行该操作，未改真实用户设置。

当前配置只提供确切 `deploymentVersion` 或显式未钉版地址，没有受信 Latest resolver，
也没有原 HTTP 结果到实际 deployment version 的可靠读回。原 pin 不会在失败后被删去。
用户手动改为未钉版是配置变更，不是同版恢复；不能把它称为原部署完成。

若后续增加 Latest 恢复，需先由原受信配置/平台读回能力给出：同 gateway/runtime 的
实际具体版本、读回来源和时间/有效期、当前配置绑定，以及实际使用 transport/version
与原 requestId 的关联。发送前须再核当前配置和目录/导出权限；目的地或版本变化必须
沿原装配绑定，且仅适用于原 invoke 从未发送的任务。没有该真实读回就保持不可用，
不根据名称、控制台截图、用户转贴建议或远端模型输出猜一个版本。本段是后续所需事实，
没有新增 resolver、DTO、平台 API 或自动部署选择逻辑。

## 定向验证

使用 pinned Node 24.15.0，仅构建 `@personal-agent/coordination` TypeScript 产物，
无安装、全仓构建、模型、账号或服务启动。配置测试使用本树 `.cache/wss-fallback-tests`
隔离 TEMP/TMP 和公开合成 safeStorage，不读取真实 userData 或私有数据库。

```text
node node_modules/typescript/bin/tsc -p packages/coordination/tsconfig.json
passed

node --test packages/coordination/test/agentarts-websocket.test.mjs packages/coordination/test/agentarts-websocket-error.test.mjs packages/coordination/test/agentarts-status.test.mjs apps/desktop/test/agentarts-transport-config.test.mjs apps/desktop/test/agentarts-config.test.mjs apps/desktop/test/agentarts-transport-composition.test.mjs
97 passed / 0 failed / 0 skipped / 0 cancelled / 0 todo

git diff --check
passed
```

覆盖 400/404/405/410/426/429/500/502/503/504 never-send 正例、认证/重定向/无效状态/
禁用备用拒绝、发送后 Upgrade 事件仍 unknown、受信 pin/凭据/配置撤销、目录/导出 guard、
只读 status 与取消期限。实际 Desktop main AST 的传输装配加原 Runtime 工厂使用明确
Fake socket/HTTP：WSS invoke=0、同 pin HTTPS=1，原 task succeeded 且无 cloud-unknown
checkpoint；这证明离线生产消费接线，不代表真实公网或模型验收。

首次检查中，旧 Upgrade 诊断用例的配置启用了备用但断言始终拒绝；现明确关闭备用，
继续验证全部原脱敏错误与 HTTP status 断言，新增用例单独验证允许恢复的行为。
默认沙箱 TEMP 的 rename 还使原加密配置夹具出现 EPERM；改为本树隔离 TEMP 后全部通过，
未更改生产文件操作或降低沙箱。

本包没有断言所有 waiting_reconciliation 均已恢复。启动/应用层的总期限和 never-send
终态归属由另一工作包修复；真实已发送未知仍需要原核实。没有云调用、私有配置读写、
部署更换或真实状态恢复验收，合入后仍须按授权验证真实故障和实际传输回执。

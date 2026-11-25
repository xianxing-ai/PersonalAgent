# F26 固定部署的控制面读回

Profile：`huawei_ict_agentarts`。当前为 F26 生产读回实现增量，尚未完成 N02 构建、N04 真实工具证据、N05 发布以及 Main 图消费链，不能据此标记 F26 完成。

依据华为官方 [ShowCoreRuntime](https://support.huaweicloud.com/api-agentarts/ShowCoreRuntime.html) 与 [ShowCoreRuntimeEndpoint](https://support.huaweicloud.com/api-agentarts/ShowCoreRuntimeEndpoint.html)，使用固定西南二区 GET `/v1/core/runtimes/{runtime_id}?version=...` 和 `/v1/core/runtimes/{runtime_id}/endpoints/{endpoint_id}`。运行时与 endpoint 使用 UUID；与官方 SDK 较旧的 endpoint-name 参数不同，本实现按当前 API 的 endpoint ID 请求。

`readAgentArtsDeployment` 绑定 runtime ID/name、endpoint ID/name、固定版本与 SWR SHA256 镜像引用。拒绝 Latest、其他架构、其他版本、其他镜像及有流量的其他版本；再次读回运行时及路由以检查变化。控制面原始响应可能包含环境凭据，最多读取 1 MiB，仅返回明列的非秘密部署字段与摘要。响应/签名错误不回显原正文。

单独的 `createAgentArtsDeploymentRequestAuth` 只签这两个原固定 GET；复用现有 HMAC 实现，但不扩展原观测签名器的 URL 权限，不接受 invoke Bearer 或写请求。调用方仍必须提供原授权和同步 `assertCurrent`，凭据存在不构成许可。

官方 `READY` 仅表示运行时就绪；返回 `runtimeReady`，`containerExecution` 与 `readinessProbe` 均保持 `unverified`。控制面匹配不能代替容器实际调用、镜像字节读回、语义工具闭环或平台评估。后续 F26 worker 须分别接这些真实来源，不能直接将 READY 填为 podRunning。

唯一新增检查 `agentarts-deployment-readback.test.mjs`：1/1 通过，实际 HMAC 与真实 Response 流解析，HTTP 响应为 Fixture。覆盖精确版本/路由读回、正文秘密零导出、路由变化拒绝，以及原观测 signer 不可签部署接口、新 signer 不可换版本/写请求。尚未使用实际 AK/SK 请求平台。

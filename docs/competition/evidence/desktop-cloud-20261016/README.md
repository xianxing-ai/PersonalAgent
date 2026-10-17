# Desktop 调用已发布自有镜像

2026-10-16，Competition Profile，CW-02 / MOD-30。桌面原任务入口已真实调用 AgentArts 的固定版本，原任务完成；没有重建或再次发布镜像，没有切换模型或授予 Laya 新的决策资格。

## 接线

- 复用 Desktop 主进程的 `agentarts-config.js`、原 Runtime Application / CloudAgentPort 和 HTTPS 调用入口。
- 原 version 1 安全配置新增可选 `appToken`、`deploymentVersion`，旧三字段记录继续有效；两个凭据均仅由主进程安全存储读取，不进入 Renderer 快照。当前 Windows 实际保存后重新解密读回一致。
- HTTPS 请求只在当前绑定的网关、运行时和 `/invocations` 路径附加内部鉴权，并固定 `?endpoint=arm64-v4-e38ef23d-r2`。目的地变化、配置撤销/读取失败、重定向及调用方伪造内部鉴权均拒绝发送。
- 原 WSS 路径保留；当前不支持 WSS 固定版本，显式配置时拒绝。此次真实测试使用 HTTPS，没有静默切换或 Local/Fake 回退。
- 不修改公共 wire Schema、数据库、依赖或镜像。主进程只增加原配置消费闭包。

## 真实测试

真实 Electron 主进程启动后，受信测试驱动带真实 panel / mainFrame 身份调用其原 `desktop:action` 注册处理函数，执行 `task.submit` 并持续 `task.refresh` 读回原任务。没有模拟 Renderer 点击或麦克风，也没有另建模型调用循环。

| 项目 | 结果 |
| --- | --- |
| 固定部署版本 | `arm64-v4-e38ef23d-r2` |
| Runtime | `pa-owned-bindings-0dae0ff5-api` |
| 本地启动 | `ready`，`fake:false`、`fakeModel:false` |
| 原任务 | `f9501f62-d93f-4509-a2bf-176f9b9337b1`，`succeeded` |
| 真实请求 | HTTP 200，显式 endpoint 为上述版本 |
| 请求耗时 | 23842.9774 ms |
| 提交至终态读回 | 24163.3727 ms |
| 请求关联 | `7a9596d3-368a-4cca-8077-ab291e286889` |
| 实际回答 | `桌面应用已连接云端镜像` |

见 [原任务与请求记录](receipt.json)。本轮未独立读取这一次请求的平台日志，不能将客户端关联标识当作平台日志读回。回答原有的 `verification=unverified` 标记保留；本次只证明实际调用与原任务终态。

此前一次仅用于写入配置的 Windows GUI stdin 引导器在解析输入时失败，未调用生产任务入口；改用受信子进程内存捕获后完成本次测试。失败记录在本机私有缓存保留，未作为成功样本。

## 验证和使用

配置、传输及实际 main 组合的定向测试 **38/38 通过，0 跳过**；三处生产 JS 语法与 `git diff --check` 通过，见 [定向测试日志](targeted-tests.txt)。其中自动化传输用例使用明确的离线夹具，与上述真实云端调用分开计数。

当前本机配置已加密保存，真实应用留在前台。之后在具有依赖和现有构建产物的该工作树运行 `npm run start:desktop` 即可继续使用；凭据不会随源码/交接包分发，其他机器需各自在受信主进程安全配置。当前固定版本配置使用 `PA_AGENTARTS_TRANSPORT=https`，不要同时保留 WSS 地址或开启 HTTPS 备用开关。

**范围限制：本次不是 F15 的 Desktop 整图接线，也不证明全部 28 个工作流已从 UI 接入。** 原独立宿主 F15 主图/隔离图的云端验收仍以 [原记录](../cloud-f15-v4-20261016/README.md) 为准。语音账号、麦克风与其他业务宿主没有在本次启用或验收。

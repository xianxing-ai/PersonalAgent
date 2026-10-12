# 当前 ARM64 镜像真实华为验收与兼容修复

目标 profile：`huawei_ict_agentarts`。本轮仅交付和验收 `linux/arm64`；AMD64 撤销独立记录，不改变历史双架构验证含义。

## 已读回的外部事实

2026-10-12，当前发布源码 `0dae0ff5c1553b855825a29934b22270b675bb48` 的 ARM64 tar 已导入贵阳一区 SWR。新建 `pa-owned-bindings-0dae0ff5`（IAM）和 `pa-owned-bindings-0dae0ff5-api`（API Key）两个 Runtime，均配置相同镜像、8080、前缀匹配，控制台为 `正常`、版本 `v1`。IAM 实例保留，实际诊断只调用后者，不调用历史 Studio Workflow / 多智能体。

模型 Key 仅限 DeepSeek-V4-Flash；模型、独立 WSS 令牌、Runtime 入站 Key 在可信宿主内通过 Windows DPAPI 加密保存，未打印、未进 Git 或镜像。API Key 身份通过该 Runtime 的官方 URN 访问，DEW 按需托管已获用户确认。

| 独立表面 | 实际结果 | 可作出的结论 |
| --- | --- | --- |
| Runtime 控制台创建/版本/镜像配置 | 正常、v1 | 托管配置已创建；不能证明模型或工具闭环 |
| 公开 `/invocations?endpoint=Latest` | 404 / NOT_FOUND | 当前镜像错误地用完整 URL 比较接口路径 |
| 默认 Latest、去掉可选查询的 `/invocations` | 502 / EXTERNAL_FAILURE | 进入镜像后的下游处理仍失败，无工具执行 |
| 公开前缀 `/invocations/ws?endpoint=Latest` Upgrade | HTTP 500；零 invoke 帧 | 公开 WSS 未通过，不能宣称主通道可用 |
| MaaS 合成直连，无 reasoning_effort | 200、返回预期标记；usage 23+37=60 | Key/模型可用；独立诊断不计为镜像验收 |
| MaaS 合成直连，发送镜像的 reasoning_effort:none | 400、错误指向 reasoning 参数 | 参数兼容缺陷已复现 |

诊断脚本不自动重试、不重放未知任务。普通 MaaS 诊断的两个 Node 子进程在收到并保存完整结构化响应后异常退出，退出码 `-1073740791`；HTTP 响应事实仍保留，宿主执行不得记为全程成功。后续诊断移除显式 `process.exit()`；结果单独记录。

## 修复方案与兼容边界

1. 镜像宿主只对官方 MaaS `/openai/v1` 的 DeepSeek-V4-Flash / V4.1-Flash，将 `reasoning_effort:none` 转为官方 `chat_template_kwargs:{thinking:false}`。其他端点、模型和推理强度原样透传；保持 ModelGateway、取消、deadline、Bearer 注入、HTTPS 和禁止重定向，不扩展原生工具调用能力。
2. HTTP 与 WS 共用内部路径解析：允许单个合法的 `endpoint` 查询；拒绝未知查询、URL 凭据、重复 endpoint 和路径遍历。不做路径规范化来扩大接受范围。
3. 支持平台公布的 `/invocations/{custom_path}` 前缀别名：`ws`、`bindings`、`invocation-status`。原内部 `/ws`、`/bindings`、`/invocation-status` 保持兼容；鉴权和帧契约保持不变。
4. 这些变化不修改本地 wire Schema、绑定信封、授权语义、数据库、工具执行或 Evidence。云端仍只产生不可信提案；真实工具必须经过本地 Runtime / Policy / ToolGateway 及读回。

本地路由测试、合成 Provider 测试和 ARM64 构建不自动提高公开 WSS、云模型、工具闭环或 trace 状态。修复镜像发布、部署新版本并获得实际响应后，按对应证据更新本表；当前真实整链仍未通过。

## 修复后验证

- 官方 `chat_template_kwargs:{thinking:false}` 的独立 MaaS 合成诊断返回 200 和预期标记，usage 为 23+9=32；可信凭据宿主退出 0。此项仍不计为镜像验收。
- 固定 Node `24.15.0`、npm `11.12.1`、PowerShell `7.6.6` 的根 `npm run check` 退出 0，含架构、契约夹具、生成类型、类型检查、工作区测试与 38 项根集成测试。新增兼容测试 3/3，通过受授权的 Windows 回环网络执行；最初受限沙箱中的网络测试失败未算通过。
- 复核协作者已生成的 ARM64 本地镜像和生产传输日志：实际容器 `arm64`、UID 1000、`--network none`；10 个合成模型请求、TLS 校验、错误脱敏及关闭测试通过，stderr 0 字节。编译后的 AgentArts core 和 main/server/websocket-transport/model-fetch/request-path 六个文件的镜像 SHA256 与当前工作树逐项一致。未重复构建，也未把合成端点当作 MaaS 或公开 WSS。
- 没有数据库迁移、依赖或公共 wire Schema 变更。需要新的 ARM64 发布与华为版本替换，旧 `0dae0ff5` 镜像的 404/502/500 不能由本地测试结果改写。

官方依据：[MaaS OpenAI 兼容规范](https://support.huaweicloud.com/model-call-maas/model-call-021.html)、[运行时调用规范](https://support.huaweicloud.com/highcode-agentarts/agentarts_10_066.html)、[IAM 签名与 API Key 区别](https://support.huaweicloud.com/api-agentarts/agentarts_07_0033.html)。

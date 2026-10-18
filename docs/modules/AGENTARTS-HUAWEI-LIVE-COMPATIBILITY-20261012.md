# 当前 ARM64 镜像真实华为验收与兼容修复

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


目标 profile：`huawei_ict_agentarts`。本轮仅交付和验收 `linux/arm64`；AMD64 撤销独立记录，不改变历史双架构验证含义。

## 当前结果：新版镜像真实 WSS 与本地工具闭环通过

2026-10-12 22:30（UTC+08），源码固定为 `194799c6979ed47d20dfd2d3ea17bbfd16f63fd6` 的 ARM64 镜像完成一条真实读取链路。此版本是 [PR #317](https://github.com/zemeng5208/PersonalAgent/pull/317) 的未合并预览，不代表 main 已集成，也不代表全部模块完成。

- [ARM64 发布 Actions](https://github.com/zemeng5208/PersonalAgent/actions/runs/38260971500) 成功；导出的 tar 为 298,141,696 字节。实际镜像配置为 `linux/arm64`、用户 `node`、revision 与固定源码一致，镜像环境不含模型、WSS 或入站凭据。
- 固定 GHCR 标签：`ghcr.io/zemeng5208/personal-agent-owned:sha-194799c6979ed47d20dfd2d3ea17bbfd16f63fd6`。
- 同一 tar 已导入贵阳一区 SWR，标签后缀为上述固定源码。控制台读回更新时间 22:23:34、大小 284.3 MB；独立 SWR 拉取与 GHCR/SWR manifest 字节等价未验证。
- API Key Runtime `pa-owned-bindings-0dae0ff5-api` 保留原名称，实际 Latest 已指向 `arm64-194799c6`，控制台正常，更新时间 22:27:55。原 IAM Runtime 和旧 ARM64 版本保留。

| 验收表面 | 实际结果 | 范围 |
| --- | --- | --- |
| 真实主通道 | `wss://<当前可信网关>/runtimes/pa-owned-bindings-0dae0ff5-api/invocations/ws` 完成模型提案和工具结果续答；HTTPS 应用调用 0 | 关闭自动备用和自动重试，没有调用旧 Studio 资源或 Fake 模型 |
| 本地授权与执行 | 审批前读取次数 0；可信验收程序经 `authorization.respond` 提交一次性授权；生产 `workspace.read_text` 确认执行 1 次，Policy 为 allow | 仅固定公开合成文件，未读取私人项目；审批 actor 为 `authorized-acceptance-harness`，不是人工 Desktop 点击 |
| 本地终态与证据 | TaskRuntime 为 `succeeded`，执行记录 `confirmed`，Evidence 1 条，云端续答含仅由工具读回得到的预期标记 | 文件另行读回一致；云端模型自报不作为终态依据 |
| 重开 Runtime Application 后持久读回 | 再打开同一 SQLite，仍为 succeeded / confirmed / 1 条 Evidence；新增网络和工具执行均为 0，宿主关闭退出 0 | 只读回原任务，没有再次提交、补审批或重放读取；没有重启操作系统 |
| 云端绑定目录 | 带平台 Session 头的 `GET /invocations/bindings?endpoint=Latest` 返回 200，精确 8 Workflow / 3 Controller | 仅目录发现，不表示 11 个入口全部经过真实模型逐项调用 |

真实任务 ID：`b52828fe-65b7-4783-bb40-eae36935251f`。模型工具链实际时间为 22:30:02–22:30:07；持久读回为 22:34:52–22:34:53；目录发现为 22:37:34。云端模型为实际 MaaS `deepseek-v4-flash`，云端只产生提案，本地 Runtime / Policy / ToolGateway / Evidence 负责授权、执行、读回和任务终态。

原在线验收程序在成功结果保存后调用不存在的 `client.disconnect()`，宿主退出 1；这次退出不能记录为全程通过。随后修正清理调用，以**持久读回、不重放任务**验证正确关闭，退出 0。原回执中的 transportStates 两项为空对象，不能作为 ready 状态捕获证据；WSS 配置、实际云端请求结果与零 HTTPS 应用调用分别有回执。最初目录请求缺平台 Session 头返回 400，补齐后返回 200，失败记录保留。

忽略目录 `.cache/owned-bindings-20261012/huawei/` 保存原诊断、`tool-loop-wss-WplBhv/receipt.json`、持久读回回执、`live-catalog-session-receipt.json`、SQLite 及加密凭据。凭据、数据库和原始私人宿主文件不提交 Git 或 Release。公开证据只列上述固定测试事实。

仍未验收：全部 11 个入口逐项真实调用、真实写入/命令/其它业务连接器、Wiki、Desktop 人工审批、世界状态触发的完整自主增量修复、断线重连与平台重启恢复、HTTPS 备用整链、平台 trace/评估和本轮费用。接口保持 provisional；不冻结整个 Agent/Model/Tool 链，不把本场景通过转为完整 MOD done。

## 修复前已读回的外部事实（保留历史）

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

本地路由测试、合成 Provider 测试和 ARM64 构建不自动提高公开 WSS、云模型、工具闭环或 trace 状态。上方当前结果来自替换后的新版实际云端调用；本节旧镜像失败保留，不被后续通过改写。

## 修复后验证

- 官方 `chat_template_kwargs:{thinking:false}` 的独立 MaaS 合成诊断返回 200 和预期标记，usage 为 23+9=32；可信凭据宿主退出 0。此项仍不计为镜像验收。
- 固定 Node `24.15.0`、npm `11.12.1`、PowerShell `7.6.6` 的根 `npm run check` 退出 0，含架构、契约夹具、生成类型、类型检查、工作区测试与 38 项根集成测试。新增兼容测试 3/3，通过受授权的 Windows 回环网络执行；最初受限沙箱中的网络测试失败未算通过。
- 复核协作者已生成的 ARM64 本地镜像和生产传输日志：实际容器 `arm64`、UID 1000、`--network none`；10 个合成模型请求、TLS 校验、错误脱敏及关闭测试通过，stderr 0 字节。编译后的 AgentArts core 和 main/server/websocket-transport/model-fetch/request-path 六个文件的镜像 SHA256 与当前工作树逐项一致。未重复构建，也未把合成端点当作 MaaS 或公开 WSS。
- 没有数据库迁移、依赖或公共 wire Schema 变更。新的 ARM64 发布与华为版本替换已完成，旧 `0dae0ff5` 镜像的 404/502/500 保留为修复前事实。

官方依据：[MaaS OpenAI 兼容规范](https://support.huaweicloud.com/model-call-maas/model-call-021.html)、[运行时调用规范](https://support.huaweicloud.com/highcode-agentarts/agentarts_10_066.html)、[IAM 签名与 API Key 区别](https://support.huaweicloud.com/api-agentarts/agentarts_07_0033.html)。

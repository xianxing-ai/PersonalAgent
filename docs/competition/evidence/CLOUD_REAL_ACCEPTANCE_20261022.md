# Competition 云端真实验收（2026-10-22）

执行者：受 Owner 委派的 cloud-real-acceptance 执行 Agent；profile `huawei_ict_agentarts`；源码 `c15855f5ccceb76d6bf794203d9ebfbe9cb83cb3`。本记录仅证明本次实际读取，不替模块负责人签署完成确认。机器回执见 [receipt](CLOUD_REAL_ACCEPTANCE_20261022.receipt.json)。

环境正常连接，配置 revision 393 的观察为 current，HTTP unrestricted/enforced；secrets、runtime_variables、outbound_identities、capabilities 均为空。已读取 cloud-environment-runtime skill、networking 规则及 `/etc/codex/network-policy.json`；VPN 未配置，TCP 域名/IP 授权列表为空。未读取秘密文件、环境转储或聊天账号，未替换身份。

| 验收项 | 本次结果 | 实际依据 / 恢复条件 |
| --- | --- | --- |
| 仓库对象、Issue459 | read | clean 独立树基线；连接 GitHub 插件读取 Issue459，open，updated 2026-10-21T10:52:56Z |
| owned runtime `/ping` | HTTP 404 | 历史 manifest 的网关与 runtimeName；不证明容器不健康，网关未暴露该路径也可能导致此响应 |
| Latest 目录发现 | HTTP 401 / blocked | 原 GET `/invocations/bindings?endpoint=Latest`；无可信入站凭据，未尝试绕过鉴权 |
| 历史 pin 目录发现 | HTTP 401 / blocked | 同路由指定 `arm64-v5-d92a17a4-r3`；这是请求参数，未读回实际部署版本 |
| SWR 固定 ARM64 index manifest | HTTP 401 / blocked | 原 repository、digest `e99a4865…b1c004`；无当前 SWR 身份，不能以历史 manifest 充本次取回 |
| 当前 deployment / image / API 能力 | blocked | 需原受信控制面会话及入站/WSS 配置；当前未读回版本、目录或能力 |
| 平台 Trace、工具闭环、评估 | not_run / blocked | 无账号/SDK/凭据绑定、无本次平台 task/run/report；不使用本地 Fake 或旧评分代替 |
| 真实防静默回退 | not_run / blocked | 未发起真实 Competition 任务；本次 HTTP 读不证明 Runtime 终态或无回退 |
| manual 计划前置检查 | blocked | `node tests/manual/agentarts/owned-binding-live.mjs --plan --group all` exit 1，`ERR_MODULE_NOT_FOUND @personal-agent/contracts`；独立树未安装依赖。Node 实际 24.19.0，仓库声明 24.15.0 |

本次 04:20:54–04:21:05 UTC 执行四次无凭据 GET，无 redirect、重试、模型调用、工具执行、构建、安装、Laya 启动、部署或发布。curl 使用继承代理与正常 TLS 校验，25 秒上限。回执仅保留状态、类型、字节数与响应摘要，不保存返回正文或请求头。401 仅证明本次路径收到鉴权拒绝，不证明底层 Runtime 存在、版本正确或业务已执行。

沿原 README 的真实入口需要受信宿主 stdin 提供 gatewayUrl/runtimeName/inboundAuthorization/wssToken；本环境没有这些可信绑定。构建不能补足鉴权，因此本次未申请 build 槽。恢复原受信配置后，先读回当前实际部署及目录，再按原精确 Policy 验收真实 API/Trace/工具与平台评估；禁止将源码 1.8 或历史 pin 写成已部署 1.8。此前 socket ECONNRESET 根因仍为 unknown。

Issue459 的历史镜像/source 追踪记录保留：已有固定 ARM64 index/member/config 摘要及111输入映射，不构成唯一历史 Git source 或本次 deployment 证明。未取回的 sourceConnector d9d07/db808 不推测协议。

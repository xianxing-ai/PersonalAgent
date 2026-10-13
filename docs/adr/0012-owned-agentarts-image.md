# ADR-0012：自有云端编排代码与 AgentArts 托管镜像

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

- 日期：2026-10-08；状态：accepted（用户本轮明确授权；部署验收未完成）。
- 负责人：zemeng；实际工作树：`.worktrees/agentarts-owned-image`。
- 基线：已 fetch 的 `origin/main@e86bac53`，不是从旧研究工作树复制。

## 决定与兼容

云端路由、快速工具提案、World → Plan → Review 迁入可审查的 TypeScript 包，
由 Linux ARM64 镜像在 AgentArts Runtime 内运行。复用现有 ModelGateway/ModelPort、
Coordination 解析器和应用 JSON；不复制 TaskRuntime、Policy、审批、工具执行或数据库。
镜像不包含 Electron、Windows Host、私有库、凭据、仓库完整源码或平台内部镜像。

本轮新增“赛后可迁移”要求，修订 ADR-0007 及 PRD/Profile 中“Local 不扩展”的范围：
允许同一云端编排包在显式独立验证模式运行；它是镜像代码的可移植性验证，
不新增本地任务执行循环，不替代比赛 `huawei_ict_agentarts` 主路径。
比赛仍要求真实 AgentArts 托管、编排、部署、trace、评估和本地读回，失败明确传播。

宿主继续使用 `/invocations`、`{query}` 或既有 Workflow `inputs`；响应使用已有
`message/task_end/end` 事件和严格 text/tool_proposal/repair_candidate JSON。
新增受信 `X-PA-Deadline` 头把原期限传入自有服务，旧平台可忽略。
普通 confirmed continuation 不再被全局 candidate 模式强制改写成修复请求；
仅包含 repairContext 的投影沿修复链处理。不会扩大已有数据出机范围。

云镜像无持久任务状态，依靠原本地 checkpoint/receipt 恢复工具续接；
session 头只关联请求，不作为授权、持久化或跨会话历史已迁移的证明。
模型由受信组合入口注入 ModelGateway，不从用户输入接受模型 URL/凭据。
平台 Memory/Gateway/Identity 等独立服务按实际资产清单逐项迁移或保留适配。

## 镜像与发布

固定 Node/npm 与锁文件依赖；使用最小 allowlist 构建上下文和无凭据镜像。
默认 8080，提供 POST /invocations 与 GET /ping，HTTP 足以满足当前路径；
可选 WS 不属于本轮协议能力声明。独立验证仅绑定 loopback；云模式依赖
AgentArts 入站认证，直接暴露时须另配置服务认证。
不修改旧 runtime 或删除云资产，部署采用新的 runtime/version 后显式切换。
回滚恢复旧受信 endpoint 配置，保留所有本地任务和已发生的执行结果。

## 来源与未验证边界

- [官方运行时规范](https://support.huaweicloud.com/highcode-agentarts/agentarts_10_029.html)：ARM64、8080、HTTP 调用、沙箱本地磁盘不可靠。
- [制作镜像](https://support.huaweicloud.com/highcode-agentarts/agentarts_10_079.html)：构建、ping 与同区域 SWR。
- [官方 SDK](https://github.com/huaweicloud/agentarts-sdk-python/tree/v0.1.6)：2026-10-08 查得最高公开 tag 为 v0.1.6；不是本项目 TypeScript 的强制依赖。
- [工作流导出](https://support.huaweicloud.com/lowcode-agentarts/agentarts_05_0058.html)：JSONL 和关联资源可能缺失，不能推定一键独立运行。
- [入站认证](https://support.huaweicloud.com/highcode-agentarts/agentarts_10_227.html)。

控制台当前读回 3 个多智能体、8 个工作流。工具下载曾在 OBS 地址被拦截/取消，
用户随后提供8个工作流已下载的 JSONL；原件哈希、资产清点及剩余缺口见迁移记录。
原内部 jiuwen-runtime 的
拉取权与再分发许可未知，不作为依赖。高代码路线为官方支持产品能力，
不等同组委会审批或比赛验收通过；最新比赛规则还需读回。

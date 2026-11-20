# G-06 日历回执与 IMAGE28 Runtime 底座

目标 Profile 为 `huawei_ict_agentarts`。本工作包对应 [联合验收 #675](https://github.com/xianxing-ai/PersonalAgent/pull/675) 的 G-06，代码基于 `f33ef383`。端口由 `goo122` 交付，Desktop 注册和工作流接线交 `2511375597-lab`。CalDAV 回执由 `Potatos498` 复核。

## 端口与调用方

| 路径 | 接入及回执 |
| --- | --- |
| `calendar.update` | Desktop 在内容围栏处理之前核对 CalDAV 读回。检查 `state`、`item.source` 和 `item.externalId`，诊断仅包含失配字段名。未知结果沿原运行待对账，确认预览只在任务、运行及参数摘要一致时复用。 |
| F09 → F10 | `createRuntimeF09ResearchEnqueue` 受信注册 `workflow.host.f09_n04`。从原 F09 回执解析确认信号和已配置的 F10 输入引用，通过现有 Policy 和 ToolGateway 后在同一 Runtime 原子受理一个 F10 任务。同一 F09 图会话重送读回已受理任务。按 `readF09ResearchLaunch(runtime, taskId)` 读回原来源、会话、部署输入引用与期限。 |
| F03/F04/F05 | `createRuntimeF03MemoryQueryHost`、`createRuntimeF04MemoryQueryHost` 与 `createRuntimeF05JointRecallHost` 校验原图、查询范围与事实时效。F05 通过注入的正式 `knowledge.search` Gateway 调用读取绑定来源，出站前后比较原引用版本。 |
| F10 | `createRuntimeF10SupportedClaimsHost` 读取 N02–N04 的事实与来源回执。宿主按精确引用修订读回来源，取得本次模型数据出站许可后调用独立 ModelGateway，后续核对原审核回执与出站授权。 |
| F16 | `createF16CiFailurePorts` 从原 HostBridge 子任务核对 Actions run/job/log，使用同一个 Policy/ToolGateway 读取当前 `workspace.git.head`。将两个端口注入 `createRuntimeF16CiFailureHost`，读回与出站前后均核对原失败来源和 HEAD。 |
| F17 | 对原 N03 固定命令，使用 `createF17ReproductionPorts` 绑定命令、前后 Git HEAD 与工作区指纹。 `createRuntimeF17FailureReportHost` 从原任务驱动的 `confirmedHost` 读取原失败命令，持久化报告并核对原运行证据。 |

以上 Runtime 工厂从 `@personal-agent/runtime/application` 导出。F09 仅在可信 feeds 会话和 F10 消费者可用时注册，`accepted` 表示任务入队。F16/F17 当前接入原图直接子执行，保持原失败来源和原运行绑定。无数据库迁移，端口的接口状态维持 provisional。

## 本地证据及真实验收缺口

- CalDAV 路径使用正式适配器与回环合成端点，读回一次外部写入，并验证未知结果保持待对账。
- F09 通过真实本地 Runtime、审批、ToolGateway 和 SQLite 验证入队、重投、拒绝及重启恢复。受信 feeds 和 F10 选择使用合成夹具。
- F03–F05 和 F10 使用合成数据验证内存范围、引用修订、审核输入和精确回执的消费契约。
- F16/F17 使用真实本地 Git 仓库、固定 Node 测试命令、Runtime 和 SQLite，Actions 来源使用合成响应。覆盖 HEAD 变化拒绝、报告重启读回、结果未知后保留原报告和零重跑。
- 待 Desktop 接通 feeds 授权、F10 消费和工作流工具目录，待原云部署通过 F09/F10 真源整图回执验证。F16/F17 需以授权 CI 来源及匹配 HEAD 的工作区复验。 [业务来源与开发宿主 PR #618](https://github.com/xianxing-ai/PersonalAgent/pull/618) [IMAGE28 草稿 #531](https://github.com/xianxing-ai/PersonalAgent/pull/531)

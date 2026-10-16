# Desktop 的 AgentArts WSS、语音与多模型选择

目标 profile 为 `huawei_ict_agentarts`。本工作包保留本机 Runtime、Policy、ToolGateway、任务状态与 Evidence；不改变本机 Laya 的选型或质量结论。

## 调用路径

- 文字主任务、子任务：Desktop → 原 Runtime → 固定版本 AgentArts WSS → 自有镜像原 Orchestrator/ModelGateway。HTTPS 只作为显式启用的备用，结果未知不重新发送。
- 实时语音：原 Live Host → Runtime 的 `AgentArtsRealtimeModelGateway` → 相同网关、运行时与版本的 `/ws`，子协议 `pa.realtime.v1` → 镜像转发原生百炼实时语音协议。任务调用帧与语音帧不混用；不新增独立任务执行循环。
- `agentarts-proxy` 模型条目使用现有 AgentArts 原生推理代理；`runtime-bailian` 条目由自有运行时调用受信北京百炼接口。后者是运行时转发，不冒充平台原生推理代理。两种路由均在 AgentArts 内执行，不由 Desktop 直接调用供应商，不因错误切换供应商。

## 设置与原 API 的兼容

设置中的 AgentArts 模型区可读取当前部署目录，并保存默认主模型、默认子模型及目录明确支持的原生推理强度。偏好使用现有安全存储加密；部署或目录 revision 改变时，旧选择不能继续当作有效绑定。应用启动会后台尝试读取元数据，设置中也可手动刷新；目录不可用时任务明确失败，不静默换用旧 API。主通道、精确 WSS 地址与 HTTPS 备用开关同样保存，重开应用可恢复；显式环境配置仍优先，旧 HTTPS 配置兼容。

原独立 API 字段和加密凭据保留。Competition Live 只要求有效 AgentArts 配置、音频用途同意与原快捷键，不再要求用户先填写独立百炼密钥。保存设置不启动麦克风。Local 原 API 路径仍使用原有配置。

旧 0–5 控件表示执行步骤/输出预算，不是原生推理强度。没有公布原生强度的模型使用供应商默认值，不把缺少字段解释成“关闭思考”。

## 模型目录与子任务

镜像可通过 `PA_AGENT_MODEL_CATALOG_FILE` 读取受信 JSON 文件；它与内联 `PA_AGENT_MODEL_CATALOG` 互斥。默认文件为 `apps/agentarts-runtime/src/default-model-catalog.json`。2026-10-16 的目录来自账号实际返回的 176 个百炼条目，加上既有 AgentArts DeepSeek 条目去重，共 177 项；可见性与文本类别只用于发现，不证明全部模型已授权、协议兼容或推理通过，默认均标为 `unverified`。

模型条目不携带 URL、密钥或请求头。元数据查询经已有鉴权 `/invocations`，query 为 `{modelCatalogVersion:"1.0",action:"list"}`，不触发推理。规范化内容的 SHA256 revision 绑定 `executionModel:{catalogRevision,modelId,reasoningEffort?}`。非文本或 unavailable 条目不能作为思考模型；未知模型、旧 revision、未公布强度明确拒绝。

主模型可看到目录元数据，并通过原 `subagent.dispatch` 提出子任务、模型与可选 `reasoningEffort`。新增字段兼容旧输入；缺省时旧摘要不变。Runtime 校验并将最终选择写入原任务 checkpoint，恢复使用原选择。`thinkingDepth` 继续表示预算，不代替原生 effort。工作区从 `readSubagentTasks()` 展示真实父子任务、模型、状态和 Evidence 引用，不另建调度器。

## 部署与验收

镜像保持 ARM64、8080、`/ping`、`/invocations` 和 `/ws`。语音的受信 `PA_AGENT_REALTIME_WORKSPACE_ID`、`PA_AGENT_REALTIME_API_KEY` 由部署宿主提供；不得放入镜像、Git、模型提示或公开日志。目录文件可设置为 `/opt/personal-agent/apps/agentarts-runtime/src/default-model-catalog.json`。

真实语音 runner 位于 `tests/manual/agentarts/agentarts-realtime-probe.mjs`，只发送公开合成音频，不录音、不播放。它分别记录 session ready、输入转写、首段音频、输出转写、轮次完成及关闭时间；全部观测齐备才通过。此项不能代替实体麦克风、扬声器、唤醒或用户听感验收。

代码、离线检查、镜像构建、云端固定版本、应用接线与真实音频验收分别记录。新版本真实回执尚未生成时，不能以旧 HTTP 成功或离线 Fake 代替。
